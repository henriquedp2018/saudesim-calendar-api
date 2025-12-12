// -----------------------------------------------------------
// API GOOGLE CALENDAR — Clínica SaúdeSim
// 100% CORRIGIDA — SEM CONFERENCE DATA
// Compatível com BotConversa + Render
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const app = express();

app.use(express.json());

// -----------------------------------------------------------
// BLOQUEIO DE ROTAS
// -----------------------------------------------------------
app.use((req, res, next) => {
  const allowed = ["/create-event", "/update-event", "/delete-event"];
  if (!allowed.includes(req.path)) {
    return res.status(200).send("OK");
  }
  next();
});

// -----------------------------------------------------------
// SERVICE ACCOUNT (Render — Secret File)
// -----------------------------------------------------------
const SERVICE_ACCOUNT_PATH = "/etc/secrets/service-account.json";

let serviceAccount = null;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (error) {
  console.error("❌ ERRO ao carregar service-account.json:", error);
  process.exit(1);
}

const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key;

const {
  WEBHOOK_SECRET,
  GOOGLE_CALENDAR_ID,
  TIMEZONE
} = process.env;

// -----------------------------------------------------------
// GOOGLE AUTH
// -----------------------------------------------------------
function getJwtClient() {
  return new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );
}

// -----------------------------------------------------------
// FUNÇÕES DE DATA
// -----------------------------------------------------------
function toISODateTime(dateStr, timeStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${timeStr}:00-03:00`;
}

function addOneHourISO(startISO) {
  const dt = new Date(startISO);
  dt.setHours(dt.getHours() + 1);
  return dt.toISOString();
}

// -----------------------------------------------------------
// VALIDAR TOKEN DO BOTCONVERSA
// -----------------------------------------------------------
function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Unauthorized - invalid token" });
  }
  next();
}

// -----------------------------------------------------------
// ROTA: CRIAR EVENTO
// -----------------------------------------------------------
app.post("/create-event", validateToken, async (req, res) => {
  try {
    const {
      nome, email, fone, tipo_atd, data, hora,
      pagto, libras, res_id, local, valor
    } = req.body;

    if (!nome || !email || !data || !hora) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes!" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    // Datas
    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

    // Evento sem conferenceData e sem attendees
    const event = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      location: local || "",
      description:
        `Paciente: ${nome}\n` +
        `Telefone: ${fone}\n` +
        `Atendimento: ${tipo_atd}\n` +
        `Pagamento: ${pagto}\n` +
        `Libras: ${libras}\n` +
        `Valor: ${valor}\n` +
        `ID Reserva: ${res_id}`,
      start: { dateTime: startISO, timeZone: TIMEZONE },
      end: { dateTime: endISO, timeZone: TIMEZONE }
    };

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: event
    });

    return res.json({
      status: "created",
      event_id: response.data.id
    });

  } catch (err) {
    console.error("❌ ERRO AO CRIAR EVENTO:", err);
    return res.status(500).json({
      error: "internal_error",
      details: err.message
    });
  }
});

// -----------------------------------------------------------
// ROTA: ATUALIZAR EVENTO
// -----------------------------------------------------------
app.post("/update-event", validateToken, async (req, res) => {
  try {
    const {
      event_id, nome, email, data, hora,
      tipo_atd, pagto, libras, valor, local
    } = req.body;

    if (!event_id) {
      return res.status(400).json({ error: "event_id obrigatório" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const original = await calendar.events.get({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    });

    const ev = original.data;

    if (nome) ev.summary = `Consulta Clínica SaúdeSim - ${nome}`;
    if (local) ev.location = local;

    if (data && hora) {
      const startISO = toISODateTime(data, hora);
      ev.start = { dateTime: startISO, timeZone: TIMEZONE };
      ev.end = { dateTime: addOneHourISO(startISO), timeZone: TIMEZONE };
    }

    const updated = await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id,
      resource: ev
    });

    return res.json({ status: "updated", event: updated.data });

  } catch (err) {
    console.error("❌ ERRO AO ATUALIZAR EVENTO:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// -----------------------------------------------------------
// ROTA: DELETAR EVENTO
// -----------------------------------------------------------
app.post("/delete-event", validateToken, async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!event_id) {
      return res.status(400).json({ error: "event_id obrigatório" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    });

    return res.json({ status: "deleted", event_id });

  } catch (err) {
    console.error("❌ ERRO AO DELETAR EVENTO:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// -----------------------------------------------------------
// INICIAR SERVIDOR
// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API Rodando na porta " + PORT);
});
