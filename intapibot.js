// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Agendamento
//  • Consulta de horários disponíveis (availability)
//  • Service Account
//  • Sem Google Meet
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
    "/ping",
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
  console.error("❌ ERRO ao carregar service account:", err);
  process.exit(1);
}

const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key;

// -----------------------------------------------------------
//  CONFIGURAÇÕES
// -----------------------------------------------------------
const GOOGLE_CALENDAR_ID =
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const TIMEZONE = "America/Sao_Paulo";

// -----------------------------------------------------------
//  AUTH
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
//  DATAS
// -----------------------------------------------------------
function toISO(dateStr, hour) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${hour}:00-03:00`;
}

function addOneHour(iso) {
  const d = new Date(iso);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

// -----------------------------------------------------------
//  TOKEN
// -----------------------------------------------------------
function validateToken(req, res, next) {
  const token = req.get("X-Webhook-Token");
  if (!token || token !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

// -----------------------------------------------------------
//  HORÁRIOS PADRÃO (08h–23h)
// -----------------------------------------------------------
function generateDaySlots() {
  const slots = [];
  for (let h = 8; h < 23; h++) {
    slots.push(String(h).padStart(2, "0") + ":00");
  }
  return slots;
}

// -----------------------------------------------------------
//  ROTA: CONSULTAR HORÁRIOS DISPONÍVEIS
// -----------------------------------------------------------
app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) {
      return res.status(400).json({ error: "data obrigatória (DD/MM/AAAA)" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const dayStart = toISO(data, "08:00");
    const dayEnd = toISO(data, "23:00");

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: dayStart,
      timeMax: dayEnd,
      singleEvents: true,
      orderBy: "startTime",
    });

    const busyHours = response.data.items.map((event) => {
      const date = new Date(event.start.dateTime);
      return String(date.getHours()).padStart(2, "0") + ":00";
    });

    const allSlots = generateDaySlots();
    const available = allSlots.filter(
      (slot) => !busyHours.includes(slot)
    );

    return res.json({
      date: data,
      available_hours: available,
    });
  } catch (err) {
    console.error("❌ ERRO AVAILABILITY:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  VERIFICAR CONFLITO
// -----------------------------------------------------------
async function checkTimeSlot(calendar, startISO, endISO) {
  const res = await calendar.events.list({
    calendarId: GOOGLE_CALENDAR_ID,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
  });
  return res.data.items.length > 0;
}

// -----------------------------------------------------------
//  ROTA: CRIAR EVENTO
// -----------------------------------------------------------
app.post("/create-event", validateToken, async (req, res) => {
  try {
    const { nome, data, hora, local, fone, tipo_atd, pagto, libras, valor, res_id } =
      req.body;

    if (!nome || !data || !hora) {
      return res.status(400).json({ error: "campos obrigatórios ausentes" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const startISO = toISO(data, hora);
    const endISO = addOneHour(startISO);

    const busy = await checkTimeSlot(calendar, startISO, endISO);
    if (busy) {
      return res.status(409).json({
        error: "conflict",
        message: "Horário já ocupado",
      });
    }

    const event = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      location: local,
      description:
        `Paciente: ${nome}\nTelefone: ${fone}\nAtendimento: ${tipo_atd}` +
        `\nPagamento: ${pagto}\nLibras: ${libras}\nValor: ${valor}\nID: ${res_id}`,
      start: { dateTime: startISO, timeZone: TIMEZONE },
      end: { dateTime: endISO, timeZone: TIMEZONE },
    };

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: event,
    });

    return res.json({
      status: "created",
      event_id: response.data.id,
    });
  } catch (err) {
    console.error("❌ ERRO CREATE:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  SERVER
// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 API rodando na porta", PORT));
