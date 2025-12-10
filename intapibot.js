// -----------------------------------------------------------
//  API COMPLETA - CREATE, UPDATE, DELETE Google Calendar
//  Adaptada para:
//  GOOGLE_CLIENT_EMAIL = botagenda@api-botconversa-para-agenda-iam.gserviceaccount.com
//  GOOGLE_CALENDAR_ID  = 2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// -----------------------------------------------------------
//  VARIÁVEIS DO AMBIENTE
// -----------------------------------------------------------

const {
  WEBHOOK_SECRET,
  GOOGLE_PRIVATE_KEY,
  TIMEZONE
} = process.env;

// CLIENT EMAIL e CALENDAR ID segundo os dados que você enviou:
const GOOGLE_CLIENT_EMAIL = "botagenda@api-botconversa-para-agenda-iam.gserviceaccount.com";

const CALENDAR_ID = "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

if (!WEBHOOK_SECRET || !GOOGLE_PRIVATE_KEY) {
  console.error("❌ ERRO: Variáveis do .env faltando!");
  process.exit(1);
}

// -----------------------------------------------------------
//  GOOGLE AUTH
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
//  FUNÇÕES AUXILIARES
// -----------------------------------------------------------

function toISODateTime(dateStr, timeStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${timeStr}:00-03:00`;
}

function addOneHourISO(startISO) {
  const date = new Date(startISO);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

// -----------------------------------------------------------
//  MIDDLEWARE DE VALIDAÇÃO DO TOKEN DO WEBHOOK
// -----------------------------------------------------------

function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");

  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Unauthorized - invalid token" });
  }

  next();
}

// -----------------------------------------------------------
//  ROTA: CRIAR EVENTO
// -----------------------------------------------------------

app.post("/create-event", validateToken, async (req, res) => {
  try {
    const {
      nome, email, fone, tipo_atd, data, hora,
      pagto, libras, res_id, valor, local
    } = req.body;

    if (!nome || !email || !data || !hora) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

    const event = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      location: local || "",
      description: `Paciente: ${nome}\nTelefone: ${fone}\nAtendimento: ${tipo_atd}\nPagamento: ${pagto}\nLibras: ${libras}\nValor: ${valor}\nID Reserva: ${res_id}`,
      start: { dateTime: startISO, timeZone: TIMEZONE || "America/Sao_Paulo" },
      end: { dateTime: endISO, timeZone: TIMEZONE || "America/Sao_Paulo" },
      attendees: [{ email }]
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event
    });

    res.json({ status: "created", event_id: response.data.id });

  } catch (err) {
    console.error("Erro ao criar:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
//  ROTA: ATUALIZAR EVENTO
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
      calendarId: CALENDAR_ID,
      eventId: event_id
    });

    const event = original.data;

    if (nome) event.summary = `Consulta Clínica SaúdeSim - ${nome}`;
    if (email) event.attendees = [{ email }];
    if (local) event.location = local;

    if (data && hora) {
      const startISO = toISODateTime(data, hora);
      const endISO = addOneHourISO(startISO);
      event.start = { dateTime: startISO, timeZone: TIMEZONE || "America/Sao_Paulo" };
      event.end = { dateTime: endISO, timeZone: TIMEZONE || "America/Sao_Paulo" };
    }

    const response = await calendar.events.update({
      calendarId: CALENDAR_ID,
      eventId: event_id,
      resource: event
    });

    res.json({ status: "updated", event: response.data });

  } catch (err) {
    console.error("Erro ao atualizar:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
//  ROTA: REMOVER EVENTO
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
      calendarId: CALENDAR_ID,
      eventId: event_id
    });

    res.json({ status: "deleted", event_id });

  } catch (err) {
    console.error("Erro ao deletar:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------
//  SERVER ONLINE
// -----------------------------------------------------------

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API Rodando na porta " + PORT);
});
