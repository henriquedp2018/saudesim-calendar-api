// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Service Account
//  • Consulta de horários disponíveis
//  • Retorno em STRING (BotConversa compatível)
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// -----------------------------------------------------------
//  PING
// -----------------------------------------------------------
app.get("/ping", (_, res) => {
  return res.status(200).json({ status: "alive" });
});

// -----------------------------------------------------------
//  BLOQUEIO DE ROTAS
// -----------------------------------------------------------
app.use((req, res, next) => {
  const allowed = ["/ping", "/availability"];
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

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key.replace(/\\n/g, "\n");

// -----------------------------------------------------------
//  CONFIG
// -----------------------------------------------------------
const GOOGLE_CALENDAR_ID =
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const TIMEZONE = "America/Sao_Paulo";

// -----------------------------------------------------------
//  AUTH
// -----------------------------------------------------------
function getJwtClient() {
  return new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/calendar"]
  );
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
//  DATE UTILS
// -----------------------------------------------------------
function validateBRDate(dateStr) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr);
}

function startOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T00:00:00-03:00`;
}

function endOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T23:59:59-03:00`;
}

// -----------------------------------------------------------
//  AVAILABILITY
// -----------------------------------------------------------
app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;

    if (!validateBRDate(data)) {
      return res.status(400).json({
        horarios_disponiveis: ""
      });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const response = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: startOfDayISO(data),
      timeMax: endOfDayISO(data),
      singleEvents: true,
      orderBy: "startTime"
    });

    const events = response.data.items || [];

    const occupied = events
      .filter(e => e.start?.dateTime)
      .map(e => {
        const d = new Date(e.start.dateTime);
        return d.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: TIMEZONE
        });
      });

    const allHours = [];
    for (let h = 8; h < 23; h++) {
      allHours.push(`${String(h).padStart(2, "0")}:00`);
    }

    const available = allHours.filter(h => !occupied.includes(h));

    // 🔥 STRING FINAL (BOTCONVERSA)
    const horarios_disponiveis = available.length
      ? available.join(" | ")
      : "Nenhum horário disponível";

    return res.json({
      horarios_disponiveis
    });

  } catch (err) {
    console.error("❌ AVAILABILITY ERROR:", err);
    return res.status(500).json({
      horarios_disponiveis: ""
    });
  }
});

// -----------------------------------------------------------
//  START
// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});
