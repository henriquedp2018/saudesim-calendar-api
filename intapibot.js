require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const app = express();

app.use(express.json());

// -----------------------------------------------------------
//  BLOQUEIO DE ROTAS – permite apenas as rotas da API
// -----------------------------------------------------------
app.use((req, res, next) => {
  const allowed = ["/create-event", "/update-event", "/delete-event"];

  if (!allowed.includes(req.path)) {
    return res.status(200).send("OK");
  }

  next();
});

// -----------------------------------------------------------
//  SERVICE ACCOUNT - carregado via secret file
// -----------------------------------------------------------
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;

if (!SERVICE_ACCOUNT_PATH) {
  console.error("❌ ERRO: GOOGLE_SA_KEY_FILE não definido no .env!");
  process.exit(1);
}

let serviceAccount = null;

try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (error) {
  console.error("❌ ERRO ao carregar o service account:", error);
  process.exit(1);
}

const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key;

// -----------------------------------------------------------
//  VARIÁVEIS DO ENV
// -----------------------------------------------------------
const { WEBHOOK_SECRET, GOOGLE_CALENDAR_ID, TIMEZONE } = process.env;

if (!WEBHOOK_SECRET || !GOOGLE_CALENDAR_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error("❌ ERRO: Variáveis obrigatórias ausentes!");
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
    [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events"
    ]
  );
}

// -----------------------------------------------------------
//  FUNÇÕES DE DATA/HORA
// -----------------------------------------------------------
function toISODateTime(dateStr, timeStr) {
  // dateStr: DD/MM/AAAA
  // timeStr: HH:MM
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${timeStr}:00-03:00`;
}

function addOneHourISO(startISO) {
  const date = new Date(startISO);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

// -----------------------------------------------------------
//  MIDDLEWARE DE AUTENTICAÇÃO
// -----------------------------------------------------------
function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Unauthorized - invalid token" });
  }
  next();
}

// -----------------------------------------------------------
//  ROTA — CRIAR EVENTO
// -----------------------------------------------------------
app.post("/create-event", validateToken, async (req, res) => {
  try {
    const {
      nome, fone, email, tipo_atd, data, hora,
      pagto, libras, valor, local, res_id
    } = req.body;

    if (!nome || !email || !data || !hora) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes!" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

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

    // Se atendimento for online → gerar Google Meet
    if (tipo_atd === "online") {
      event.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      };
    }

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: event,
      conferenceDataVersion: 1
    });

    const meetLink =
      response.data.conferenceData?.entryPoints?.[0]?.uri || null;

    return res.json({
      status: "created",
      event_id: response.data.id,
      meet_link: meetLink
    });

  } catch (err) {
    console.error("❌ ERRO AO CRIAR EVENTO:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// -----------------------------------------------------------
//  ROTA — ATUALIZAR EVENTO
// -----------------------------------------------------------
app.post("/update-event", validateToken, async (req, res) => {
  try {
    const { event_id, nome, email, data, hora, tipo_atd, pagto, libras, valor, local } = req.body;

    if (!event_id) return res.status(400).json({ error: "event_id obrigatório" });

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const original = await calendar.events.get({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    });

    const event = original.data;

    if (nome) event.summary = `Consulta Clínica SaúdeSim - ${nome}`;
    if (local) event.location = local;

    if (data && hora) {
      const startISO = toISODateTime(data, hora);
      const endISO = addOneHourISO(startISO);

      event.start = { dateTime: startISO, timeZone: TIMEZONE };
      event.end = { dateTime: endISO, timeZone: TIMEZONE };
    }

    const updated = await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id,
      resource: event,
      conferenceDataVersion: 1
    });

    return res.json({ status: "updated", event: updated.data });

  } catch (err) {
    console.error("❌ ERRO AO ATUALIZAR EVENTO:", err);
    return res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// -----------------------------------------------------------
//  ROTA — DELETAR EVENTO
// -----------------------------------------------------------
app.post("/delete-event", validateToken, async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!event_id) return res.status(400).json({ error: "event_id obrigatório" });

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    });

    res.json({ status: "deleted", event_id });

  } catch (err) {
    console.error("❌ ERRO AO DELETAR EVENTO:", err);
    res.status(500).json({ error: "internal_error", details: err.message });
  }
});

// -----------------------------------------------------------
//  INICIAR SERVIDOR
// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 API Rodando na porta " + PORT);
});
