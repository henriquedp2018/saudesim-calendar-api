// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// -----------------------------------------------------------
//  /ping
// -----------------------------------------------------------
app.get("/ping", (_, res) => {
  res.json({ status: "alive" });
});

// -----------------------------------------------------------
//  CONFIG / AUTH
// -----------------------------------------------------------
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

const GOOGLE_CALENDAR_ID =
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const TIMEZONE = "America/Sao_Paulo";

function getJwtClient() {
  return new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );
}

function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

function validateBRDate(dateStr) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr);
}

function buildISO(date, hora) {
  const [d, m, y] = date.split("/");
  return `${y}-${m}-${d}T${hora}:00-03:00`;
}

function buildISOPlusOneHour(date, hora) {
  const h = Number(hora.split(":")[0]) + 1;
  const [d, m, y] = date.split("/");
  return `${y}-${m}-${d}T${String(h).padStart(2, "0")}:00:00-03:00`;
}

// -----------------------------------------------------------
//  AVAILABILITY
// -----------------------------------------------------------
app.post("/availability", validateToken, async (req, res) => {
  const { data } = req.body;
  if (!validateBRDate(data)) return res.status(400).json({ error: "Data inválida" });

  const auth = getJwtClient();
  await auth.authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const iso = data.split("/").reverse().join("-");
  const r = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: `${iso}T00:00:00-03:00`,
    timeMax: `${iso}T23:59:59-03:00`,
    singleEvents: true
  });

  const occupied = (r.data.items || [])
    .map(e => e.start?.dateTime?.substring(11, 16))
    .filter(Boolean);

  const available = [];
  for (let h = 8; h < 23; h++) {
    const hh = `${String(h).padStart(2, "0")}:00`;
    if (!occupied.includes(hh)) available.push(hh);
  }

  res.json({ date: data, available_hours: available });
});

// -----------------------------------------------------------
//  CREATE EVENT
// -----------------------------------------------------------
app.post("/create-event", validateToken, async (req, res) => {
  const { nome, data, hora, tipo_atd, res_id } = req.body;
  if (!nome || !data || !hora || !res_id)
    return res.status(400).json({ error: "Dados obrigatórios ausentes" });

  const auth = getJwtClient();
  await auth.authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary: `Consulta - ${nome}`,
    description: `Reserva: ${res_id}`,
    start: { dateTime: buildISO(data, hora), timeZone: TIMEZONE },
    end: { dateTime: buildISOPlusOneHour(data, hora), timeZone: TIMEZONE },
    location:
      tipo_atd === "online"
        ? "Atendimento Online (Google Meet)"
        : "Rua Archimedes Naspolini, 2119"
  };

  if (tipo_atd === "online") {
    event.conferenceData = { createRequest: { requestId: `meet-${res_id}` } };
  }

  const r = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    resource: event,
    conferenceDataVersion: 1
  });

  res.json({ status: "created", res_id, meet_link: r.data.hangoutLink || "" });
});

// -----------------------------------------------------------
//  RESCHEDULE (ADIAR) — CORRIGIDO
// -----------------------------------------------------------
app.post("/reschedule-by-reservation", validateToken, async (req, res) => {
  const { res_id, data, hora } = req.body;

  const auth = getJwtClient();
  await auth.authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const r = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    singleEvents: true
  });

  const event = r.data.items.find(e =>
    e.description?.includes(`Reserva: ${res_id}`)
  );

  if (!event) return res.status(404).json({ error: "Reserva não encontrada" });

  event.start.dateTime = buildISO(data, hora);
  event.end.dateTime = buildISOPlusOneHour(data, hora);

  await calendar.events.update({
    calendarId: GOOGLE_CALENDAR_ID,
    eventId: event.id,
    resource: event
  });

  res.json({ status: "rescheduled", res_id, data, hora });
});

// -----------------------------------------------------------
//  CANCEL
// -----------------------------------------------------------
app.post("/cancel", validateToken, async (req, res) => {
  const { res_id } = req.body;

  const auth = getJwtClient();
  await auth.authorize();
  const calendar = google.calendar({ version: "v3", auth });

  const r = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    singleEvents: true
  });

  const event = r.data.items.find(e =>
    e.description?.includes(`Reserva: ${res_id}`)
  );

  if (!event) return res.status(404).json({ error: "Consulta não encontrada" });

  await calendar.events.delete({
    calendarId: GOOGLE_CALENDAR_ID,
    eventId: event.id
  });

  res.json({ status: "cancelled", res_id });
});

// -----------------------------------------------------------
//  BLOQUEIO DE ROTAS — SEM QUEBRAR
// -----------------------------------------------------------
app.use((req, res) => {
  res.status(200).send("OK");
});

// -----------------------------------------------------------
app.listen(process.env.PORT || 3000);
