// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Criar consulta
//  • Reagendar por res_id
//  • Cancelar consulta por res_id
//  • Verificar consulta por res_id
//  • Ver disponibilidade
//  • Horário 24h real (SEM bug de timezone)
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
//  BLOQUEIO DE ROTAS (ATUALIZADO)
// -----------------------------------------------------------
app.use((req, res, next) => {
  const allowed = [
    "/ping",
    "/availability",
    "/create-event",
    "/reschedule-by-reservation",
    "/check-by-reservation",
    "/cancel"
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

function buildISO(dateStr, hourStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T${hourStr}:00-03:00`;
}

function buildISOPlusOneHour(dateStr, hourStr) {
  const [h] = hourStr.split(":").map(Number);
  const hh = String(h + 1).padStart(2, "0");
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

    return res.json({
      date: data,
      available_hours: available
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
      nome,
      data,
      hora,
      email,
      fone,
      tipo_atd,
      pagto,
      valor,
      libras,
      res_id
    } = req.body;

    if (!nome || !data || !hora || !res_id) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    if (!validateBRDate(data)) {
      return res.status(400).json({ error: "Data inválida" });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const startISO = buildISO(data, hora);
    const endISO   = buildISOPlusOneHour(data, hora);

    if (await checkTimeSlot(calendar, startISO, endISO)) {
      return res.status(409).json({ error: "Horário já ocupado" });
    }

    const event = {
      summary: `Consulta - ${nome}`,
      description:
`Reserva: ${res_id}
Telefone: ${fone}
Email: ${email}
Pagamento: ${pagto}
Valor: ${valor}
Libras: ${libras}`,
      start: { dateTime: startISO, timeZone: TIMEZONE },
      end:   { dateTime: endISO,   timeZone: TIMEZONE },
      location:
        tipo_atd === "online"
          ? "Atendimento Online (Google Meet)"
          : "Rua Archimedes Naspolini, 2119, Criciúma - SC"
    };

    if (tipo_atd === "online") {
      event.conferenceData = {
        createRequest: {
          requestId: `meet-${res_id}`
        }
      };
    }

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: event,
      conferenceDataVersion: 1
    });

    return res.json({
      status: "created",
      res_id: String(res_id),
      meet_link: response.data.hangoutLink || ""
    });

  } catch (err) {
    console.error("❌ ERRO CREATE:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: CANCELAR CONSULTA
// -----------------------------------------------------------
app.post("/cancel", validateToken, async (req, res) => {
  try {
    const { res_id } = req.body;

    if (!res_id) {
      return res.status(400).json({ error: "res_id obrigatório" });
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
      return res.status(404).json({ error: "Consulta não encontrada" });
    }

    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event.id
    });

    return res.json({
      status: "cancelled",
      res_id: String(res_id)
    });

  } catch (err) {
    console.error("❌ ERRO CANCEL:", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

// -----------------------------------------------------------
//  ROTA: CHECK POR RESERVA
// -----------------------------------------------------------
app.post("/check-by-reservation", validateToken, async (req, res) => {
  try {
    const { res_id } = req.body;

    if (!res_id) {
      return res.status(400).json({ error: "res_id obrigatório" });
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
      return res.status(404).json({ error: "Consulta não encontrada" });
    }

    const start = new Date(event.start.dateTime);

    return res.json({
      data: start.toLocaleDateString("pt-BR", { timeZone: TIMEZONE }),
      hora: start.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: TIMEZONE
      }),
      res_id: String(res_id),
      local: event.location || "Não informado"
    });

  } catch (err) {
    console.error("❌ ERRO CHECK:", err);
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
