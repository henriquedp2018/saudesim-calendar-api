// -----------------------------------------------------------
//  API COMPLETA GOOGLE CALENDAR — Clínica SaúdeSim
//  • Service Account via arquivo
//  • Sem Google Meet
//  • Bloqueio de horários duplicados
//  • Consulta de horários disponíveis (availability)
//  • Rota /ping para manter servidor ativo
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const app = express();

app.use(express.json());

// -----------------------------------------------------------
//  ROTA /ping
// -----------------------------------------------------------

app.get("/ping", (req, res) => {
  return res.status(200).json({ status: "alive" });
});

// -----------------------------------------------------------
//  BLOQUEIO DE ROTAS
// -----------------------------------------------------------

app.use((req, res, next) => {
  const allowed = [
    "/create-event",
    "/update-event",
    "/delete-event",
    "/availability",
    "/ping"
  ];
  if (!allowed.includes(req.path)) return res.status(200).send("OK");
  next();
});

// -----------------------------------------------------------
//  SERVICE ACCOUNT
// -----------------------------------------------------------

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;

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
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

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
//  UTILITÁRIOS DE DATA (DD/MM/AAAA)
// -----------------------------------------------------------

function validateBRDate(dateStr) {
  if (!dateStr) return false;
  const regex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!regex.test(dateStr)) return false;

  const [d, m, y] = dateStr.split("/").map(Number);
  const date = new Date(y, m - 1, d);

  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

function toISODateTime(dateStr, timeStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${timeStr}:00-03:00`;
}

function startOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T00:00:00-03:00`;
}

function endOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T23:59:59-03:00`;
}

function addOneHourISO(startISO) {
  const date = new Date(startISO);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

// -----------------------------------------------------------
//  VALIDAÇÃO TOKEN BOTCONVERSA
// -----------------------------------------------------------

function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}

// -----------------------------------------------------------
//  VERIFICAR DUPLICIDADE
// -----------------------------------------------------------

async function checkTimeSlot(calendar, startISO, endISO) {
  const response = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
    orderBy: "startTime"
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
      return res.status(400).json({
        error: "Data inválida. Use DD/MM/AAAA"
      });
    }

    const auth = getJwtClient();
    await auth.authorize();

    const calendar = google.calendar({ version: "v3", auth });

    const timeMin = startOfDayISO(data);
    const timeMax = endOfDayISO(data);

    console.log("📅 AVAILABILITY:", data);

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime"
    });

    const events = response.data.items || [];

    const occupiedHours = [
      ...new Set(
        events
          .filter(e => e.start?.dateTime)
          .map(e => {
            const start = new Date(e.start.dateTime);
            return start.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: TIMEZONE
            });
          })
      )
    ];

    const allHours = [];
    for (let h = 8; h < 23; h++) {
      allHours.push(`${String(h).padStart(2, "0")}:00`);
    }

    const availableHours = allHours.filter(
      h => !occupiedHours.includes(h)
    );

    return res.json({
      date: data,
      available_hours: availableHours
    });

  } catch (err) {
    console.error("❌ ERRO AVAILABILITY:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: CREATE EVENT
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

    if (!validateBRDate(data)) {
      return res.status(400).json({ error: "Data inválida" });
    }

    const auth = getJwtClient();
    await auth.authorize();

    const calendar = google.calendar({ version: "v3", auth });

    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

    if (await checkTimeSlot(calendar, startISO, endISO)) {
      return res.status(409).json({
        error: "conflict",
        details: "Horário já ocupado"
      });
    }

    const event = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      location: local || "",
      description:
        `Paciente: ${nome}\nTelefone: ${fone}\nAtendimento: ${tipo_atd}` +
        `\nPagamento: ${pagto}\nLibras: ${libras}\nValor: ${valor}\nID Reserva: ${res_id}`,
      start: { dateTime: startISO, timeZone: TIMEZONE },
      end: { dateTime: endISO, timeZone: TIMEZONE }
    };

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: event
    });

    return res.json({ status: "created", event_id: response.data.id });

  } catch (err) {
    console.error("❌ ERRO CREATE:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: UPDATE EVENT
// -----------------------------------------------------------

app.post("/update-event", validateToken, async (req, res) => {
  try {
    const { event_id, nome, data, hora, local } = req.body;

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

    const event = original.data;

    if (nome) event.summary = `Consulta Clínica SaúdeSim - ${nome}`;
    if (local) event.location = local;

    if (data && hora) {
      if (!validateBRDate(data)) {
        return res.status(400).json({ error: "Data inválida" });
      }

      const startISO = toISODateTime(data, hora);
      const endISO = addOneHourISO(startISO);

      event.start = { dateTime: startISO, timeZone: TIMEZONE };
      event.end = { dateTime: endISO, timeZone: TIMEZONE };
    }

    const response = await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id,
      resource: event
    });

    return res.json({ status: "updated", event: response.data });

  } catch (err) {
    console.error("❌ ERRO UPDATE:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: DELETE EVENT
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
    console.error("❌ ERRO DELETE:", err);
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
