// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Reagendamento por res_id
//  • Hora normalizada (HH:MM)
//  • Valor recalculado corretamente
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// -----------------------------------------------------------
//  ROTA /ping
// -----------------------------------------------------------
app.get("/ping", (_, res) => {
  return res.status(200).json({ status: "alive" });
});

// -----------------------------------------------------------
//  BLOQUEIO DE ROTAS
// -----------------------------------------------------------
app.use((req, res, next) => {
  const allowed = [
    "/ping",
    "/availability",
    "/reschedule-by-reservation"
  ];
  if (!allowed.includes(req.path)) {
    return res.status(200).send("OK");
  }
  next();
});

// -----------------------------------------------------------
//  SERVICE ACCOUNT
// -----------------------------------------------------------
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (err) {
  console.error("❌ ERRO AO CARREGAR SERVICE ACCOUNT:", err);
  process.exit(1);
}

const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key;

// -----------------------------------------------------------
//  CONFIGURAÇÕES
// -----------------------------------------------------------
const GOOGLE_CALENDAR_ID =
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const TIMEZONE = "America/Sao_Paulo";

// -----------------------------------------------------------
//  AUTENTICAÇÃO GOOGLE
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
//  TOKEN BOTCONVERSA
// -----------------------------------------------------------
function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

// -----------------------------------------------------------
//  UTILITÁRIOS
// -----------------------------------------------------------
function validateBRDate(dateStr) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr);
}

// 🔒 NORMALIZA A HORA (21 → 21:00 | 9 → 09:00)
function normalizeHour(hora) {
  if (!hora) return null;

  if (/^\d{1,2}$/.test(hora)) {
    return `${String(hora).padStart(2, "0")}:00`;
  }

  if (/^\d{2}:\d{2}$/.test(hora)) {
    return hora;
  }

  return null;
}

function toISODateTime(dateStr, hora) {
  const horaNormalizada = normalizeHour(hora);
  if (!horaNormalizada) throw new Error("Hora inválida");

  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${horaNormalizada}:00-03:00`;
}

function addOneHourISO(dateStr, hora) {
  const horaNormalizada = normalizeHour(hora);
  const h = Number(horaNormalizada.split(":")[0]) + 1;
  const hh = String(h).padStart(2, "0");

  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${hh}:00:00-03:00`;
}

// -----------------------------------------------------------
//  VERIFICAR CONFLITO
// -----------------------------------------------------------
async function checkTimeSlot(calendar, startISO, endISO) {
  const response = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true
  });
  return response.data.items.length > 0;
}

// -----------------------------------------------------------
//  ROTA: AVAILABILITY
// -----------------------------------------------------------
app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;

    if (!validateBRDate(data)) {
      return res.status(400).json({ error: "Data inválida" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const isoDate = data.split("/").reverse().join("-");

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: `${isoDate}T00:00:00-03:00`,
      timeMax: `${isoDate}T23:59:59-03:00`,
      singleEvents: true
    });

    const occupied = (response.data.items || [])
      .filter(e => e.start?.dateTime)
      .map(e => e.start.dateTime.substring(11, 16));

    const available = [];
    for (let h = 8; h < 23; h++) {
      const hh = `${String(h).padStart(2, "0")}:00`;
      if (!occupied.includes(hh)) available.push(hh);
    }

    return res.json({ date: data, available_hours: available });

  } catch (err) {
    console.error("❌ ERRO AVAILABILITY:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: RESCHEDULE POR RESERVA
// -----------------------------------------------------------
app.post("/reschedule-by-reservation", validateToken, async (req, res) => {
  try {
    const { res_id, data, hora, tipo_atd } = req.body;

    if (!res_id || !data || !hora) {
      return res.status(400).json({
        error: "res_id, data e hora são obrigatórios"
      });
    }

    if (!validateBRDate(data)) {
      return res.status(400).json({ error: "Data inválida" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      singleEvents: true,
      maxResults: 50
    });

    const event = (response.data.items || []).find(e =>
      e.description && e.description.includes(`Reserva: ${res_id}`)
    );

    if (!event) {
      return res.status(404).json({ error: "Reserva não encontrada" });
    }

    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(data, hora);

    if (await checkTimeSlot(calendar, startISO, endISO)) {
      return res.status(409).json({ error: "Horário já ocupado" });
    }

    // 🔹 Valor recalculado corretamente
    const hourNum = Number(normalizeHour(hora).split(":")[0]);
    const valor = hourNum >= 18 ? 625 : 500;

    // 🔹 Local opcional
    if (tipo_atd === "online") {
      event.location = "Atendimento Online (Google Meet)";
    }
    if (tipo_atd === "presencial") {
      event.location = "Rua Archimedes Naspolini, 2119, Criciúma - SC";
    }

    // 🔹 Atualizar valor na descrição
    if (event.description) {
      event.description = event.description.replace(
        /Valor:\s?.*/i,
        `Valor: ${valor}`
      );
    }

    event.start = { dateTime: startISO, timeZone: TIMEZONE };
    event.end = { dateTime: endISO, timeZone: TIMEZONE };

    await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event.id,
      resource: event
    });

    // 🔹 RETORNO PARA BOTCONVERSA
    return res.json({
      status: "rescheduled",
      res_id,
      data,
      hora: normalizeHour(hora),
      valor
    });

  } catch (err) {
    console.error("❌ ERRO RESCHEDULE:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  START SERVER
// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API Google Calendar rodando na porta", PORT);
});
