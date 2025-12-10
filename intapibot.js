// intapibot.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const { DateTime } = require('luxon');
const fs = require('fs');

const app = express();
app.use(bodyParser.json());

// ===================== CONFIG ==========================
const PORT = process.env.PORT || 3000;
const SERVICE_ACCOUNT_KEY_FILE = process.env.GOOGLE_SA_KEY_FILE || './service-account.json';
const CALENDAR_ID =
  process.env.GOOGLE_CALENDAR_ID ||
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "supersecreto123";
const TIMEZONE = process.env.TIMEZONE || "America/Sao_Paulo";
const CONFERENCE_VERSION = 1;

// ===================== GOOGLE AUTH ==========================
function getJwtClient() {
  const key = require(SERVICE_ACCOUNT_KEY_FILE);

  return new google.auth.JWT(
    key.client_email,
    null,
    key.private_key,
    ["https://www.googleapis.com/auth/calendar"],
    process.env.GOOGLE_IMPERSONATE || null
  );
}

// ===================== DATE CONVERSION ==========================
function toISODateTime(dateDDMMYYYY, timeHHMM, timezone = TIMEZONE) {
  const [day, month, year] = dateDDMMYYYY.split("/");
  const [hour, minute] = timeHHMM.split(":");

  const dt = DateTime.fromObject(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute)
    },
    { zone: timezone }
  );

  if (!dt.isValid) throw new Error("Data/Hora inválida");

  return dt.toISO();
}

function addOneHourISO(iso, timezone = TIMEZONE) {
  return DateTime.fromISO(iso, { zone: timezone }).plus({ hours: 1 }).toISO();
}

// ===================== ROUTE: CREATE EVENT ==========================
app.post("/create-event", async (req, res) => {
  try {
    // Segurança
    const token = req.get("X-Webhook-Token");
    if (!token || token !== WEBHOOK_SECRET) {
      return res.status(403).json({ error: "Unauthorized - invalid token" });
    }

    // Campos obrigatórios
    const {
      nome,
      email,
      fone,
      tipo_atd,
      data,
      hora,
      pagto,
      libras,
      res_id,
      valor,
      local
    } = req.body;

    if (!nome || !email || !data || !hora || !tipo_atd || !res_id) {
      return res.status(400).json({ error: "Campos obrigatórios faltando." });
    }

    // Converte data/hora para ISO
    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

    const isOnline = String(tipo_atd).toLowerCase() === "online";
    const finalLocation = isOnline
      ? "Atendimento Online (Google Meet)"
      : (local || process.env.PHYSICAL_ADDRESS);

    const description = `
Atendimento: ${tipo_atd}
Pagamento: ${pagto}
Valor: R$${valor}
LIBRAS: ${libras}
Telefone: ${fone}
Reserva: ${res_id}
`.trim();

    // Google Auth
    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    // Montar evento
    const event = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      description,
      location: finalLocation,
      start: { dateTime: startISO, timeZone: TIMEZONE },
      end: { dateTime: endISO, timeZone: TIMEZONE },
      attendees: [{ email, displayName: nome }],
      conferenceData: isOnline
        ? {
            createRequest: {
              requestId: `saudesim-${Date.now()}`,
              conferenceSolutionKey: { type: "hangoutsMeet" }
            }
          }
        : undefined,
      extendedProperties: {
        private: { res_id }
      }
    };

    // Criar no Google Calendar
    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
      conferenceDataVersion: CONFERENCE_VERSION
    });

    const createdEvent = response.data;

    // Extrair link do Meet
    let meetLink = null;

    if (createdEvent.conferenceData?.entryPoints) {
      const entry = createdEvent.conferenceData.entryPoints.find(
        e => e.entryPointType === "video" && e.uri.includes("meet.google.com")
      );
      if (entry) meetLink = entry.uri;
    }

    if (!meetLink && createdEvent.hangoutLink) {
      meetLink = createdEvent.hangoutLink;
    }

    res.json({
      status: "ok",
      meet_link: meetLink || "",
      event_id: createdEvent.id,
      raw: createdEvent
    });
  } catch (err) {
    console.error("ERRO AO CRIAR EVENTO:", err);
    res.status(500).json({
      error: "internal_error",
      details: err.message
    });
  }
});

// ===================== RUN SERVER ==========================
app.listen(PORT, () => {
  console.log(`✅ intapibot.js iniciado na porta ${PORT}`);
});