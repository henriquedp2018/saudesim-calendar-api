// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Service Account
//  • Consulta de horários disponíveis
//  • Retorno COMPATÍVEL com BotConversa
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
    return res.status(403).json({
      status: "failure",
      summary: "Token inválido"
    });
  }
  next();
}

// -----------------------------------------------------------
//  UTILITÁRIOS
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

function startOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T00:00:00-03:00`;
}

function endOfDayISO(dateStr) {
  const [d, m, y] = dateStr.split("/");
  return `${y}-${m}-${d}T23:59:59-03:00`;
}

// -----------------------------------------------------------
//  ROTA: AVAILABILITY (VERSÃO FINAL BOTCONVERSA)
// -----------------------------------------------------------

app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;

    if (!validateBRDate(data)) {
      return res.status(200).json({
        date: String(data || ""),
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

    // Horários ocupados
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

    // Horários padrão (08h às 22h)
    const allHours = [];
    for (let h = 8; h < 23; h++) {
      allHours.push(`${String(h).padStart(2, "0")}:00`);
    }

    const available = allHours.filter(h => !occupied.includes(h));

    // -----------------------------------------------------------
    //  FORÇA STRING PLANA (CRÍTICO PARA BOTCONVERSA)
    // -----------------------------------------------------------

    const horariosTexto = String(
      available
        .map(h => `${h}`)
        .join(", ")
    );

    return res.status(200).json({
      date: String(data),
      horarios_disponiveis: horariosTexto
    });

  } catch (err) {
    console.error("❌ ERRO AVAILABILITY:", err);
    return res.status(200).json({
      date: "",
      horarios_disponiveis: ""
    });
  }
});

// -----------------------------------------------------------
//  START SERVER
// -----------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API SaúdeSim rodando na porta", PORT);
});
