// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Retorno direto em TEXTO (sem mapeamento)
//  • 100% compatível com BotConversa
// -----------------------------------------------------------

require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// -----------------------------------------------------------
app.get("/ping", (_, res) => {
  res.json({ status: "alive" });
});

// -----------------------------------------------------------
const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

const GOOGLE_CALENDAR_ID =
  "2d896e5ad2fcc150e10efe24cce9156ab577442a74b70d9fcd89f7d166c8479c@group.calendar.google.com";

const TIMEZONE = "America/Sao_Paulo";

// -----------------------------------------------------------
function getJwtClient() {
  return new google.auth.JWT(
    serviceAccount.client_email,
    null,
    serviceAccount.private_key.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/calendar"]
  );
}

function validateToken(req, res, next) {
  if (req.get("X-Webhook-Token") !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "unauthorized" });
  }
  next();
}

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
app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;

    if (!validateBRDate(data)) {
      return res.json({
        message: "Data inválida. Use o formato DD/MM/AAAA."
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

    const texto =
      available.length > 0
        ? `Horários disponíveis para ${data}:\n\n${available.join(" | ")}`
        : `Não há horários disponíveis para ${data}.`;

    // 👉 RETORNO DIRETO EM TEXTO
    return res.json({
      message: texto
    });

  } catch (err) {
    console.error(err);
    return res.json({
      message: "Erro ao consultar a agenda. Tente novamente."
    });
  }
});

// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});
