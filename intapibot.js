// -----------------------------------------------------------
//  API GOOGLE CALENDAR — Clínica SaúdeSim
//  • Service Account
//  • Availability pronto para BotConversa
//  • Create / Update / Delete padronizados
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
    "/create-event",
    "/update-event",
    "/delete-event"
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

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

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
      message: "Token inválido",
      status: "failure",
      summary: "Falha de autenticação",
      variables: {}
    });
  }
  next();
}

// -----------------------------------------------------------
//  UTILITÁRIOS DE DATA
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

const startOfDayISO = d => `${d.split("/").reverse().join("-")}T00:00:00-03:00`;
const endOfDayISO   = d => `${d.split("/").reverse().join("-")}T23:59:59-03:00`;
const toISODateTime = (d, h) => `${d.split("/").reverse().join("-")}T${h}:00-03:00`;

function addOneHourISO(startISO) {
  const date = new Date(startISO);
  date.setHours(date.getHours() + 1);
  return date.toISOString();
}

// -----------------------------------------------------------
//  CONFLITO DE HORÁRIO
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
//  AVAILABILITY (PRONTO PARA BOTCONVERSA)
// -----------------------------------------------------------
app.post("/availability", validateToken, async (req, res) => {
  try {
    const { data } = req.body;

    if (!validateBRDate(data)) {
      return res.json({
        message: "Data inválida. Use o formato DD/MM/AAAA.",
        status: "failure",
        summary: "Data inválida",
        variables: {}
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

    const occupied = (response.data.items || [])
      .filter(e => e.start?.dateTime)
      .map(e =>
        new Date(e.start.dateTime).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: TIMEZONE
        })
      );

    const allHours = [];
    for (let h = 8; h < 23; h++) {
      allHours.push(`${String(h).padStart(2, "0")}:00`);
    }

    const available = allHours.filter(h => !occupied.includes(h));

    if (!available.length) {
      return res.json({
        message: `Não há horários disponíveis para ${data}. Deseja consultar outra data?`,
        status: "failure",
        summary: "Sem horários disponíveis",
        variables: { data_consultada: data }
      });
    }

    return res.json({
      message: `Tenho horários disponíveis para ${data}:\n${available.join(", ")}\n\nQual horário você prefere?`,
      status: "success",
      summary: "Horários disponíveis",
      variables: {
        data_consultada: data,
        horarios_disponiveis: available.join(",")
      }
    });

  } catch (err) {
    console.error(err);
    return res.json({
      message: "Erro ao consultar horários. Tente novamente.",
      status: "failure",
      summary: "Erro interno availability",
      variables: {}
    });
  }
});

// -----------------------------------------------------------
//  CREATE EVENT
// -----------------------------------------------------------
app.post("/create-event", validateToken, async (req, res) => {
  try {
    const { nome, email, data, hora } = req.body;

    if (!nome || !email || !data || !hora) {
      return res.json({
        message: "Dados obrigatórios não informados.",
        status: "failure",
        summary: "Campos ausentes",
        variables: {}
      });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const startISO = toISODateTime(data, hora);
    const endISO = addOneHourISO(startISO);

    if (await checkTimeSlot(calendar, startISO, endISO)) {
      return res.json({
        message: "Esse horário já está ocupado. Escolha outro.",
        status: "failure",
        summary: "Conflito de horário",
        variables: {}
      });
    }

    const response = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      resource: {
        summary: `Consulta Clínica SaúdeSim - ${nome}`,
        start: { dateTime: startISO, timeZone: TIMEZONE },
        end: { dateTime: endISO, timeZone: TIMEZONE }
      }
    });

    return res.json({
      message: `Consulta agendada com sucesso para ${data} às ${hora}.`,
      status: "success",
      summary: "Evento criado",
      variables: {
        event_id: response.data.id,
        data,
        hora
      }
    });

  } catch (err) {
    console.error(err);
    return res.json({
      message: "Erro ao criar agendamento.",
      status: "failure",
      summary: "Erro interno create",
      variables: {}
    });
  }
});

// -----------------------------------------------------------
//  UPDATE EVENT
// -----------------------------------------------------------
app.post("/update-event", validateToken, async (req, res) => {
  try {
    const { event_id, data, hora } = req.body;

    if (!event_id) {
      return res.json({
        message: "event_id não informado.",
        status: "failure",
        summary: "ID ausente",
        variables: {}
      });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    const event = (await calendar.events.get({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    })).data;

    if (data && hora) {
      event.start = { dateTime: toISODateTime(data, hora), timeZone: TIMEZONE };
      event.end = { dateTime: addOneHourISO(event.start.dateTime), timeZone: TIMEZONE };
    }

    await calendar.events.update({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id,
      resource: event
    });

    return res.json({
      message: "Agendamento atualizado com sucesso.",
      status: "success",
      summary: "Evento atualizado",
      variables: { event_id }
    });

  } catch (err) {
    return res.json({
      message: "Erro ao atualizar agendamento.",
      status: "failure",
      summary: "Erro interno update",
      variables: {}
    });
  }
});

// -----------------------------------------------------------
//  DELETE EVENT
// -----------------------------------------------------------
app.post("/delete-event", validateToken, async (req, res) => {
  try {
    const { event_id } = req.body;

    if (!event_id) {
      return res.json({
        message: "event_id não informado.",
        status: "failure",
        summary: "ID ausente",
        variables: {}
      });
    }

    const auth = getJwtClient();
    await auth.authorize();
    const calendar = google.calendar({ version: "v3", auth });

    await calendar.events.delete({
      calendarId: GOOGLE_CALENDAR_ID,
      eventId: event_id
    });

    return res.json({
      message: "Agendamento cancelado com sucesso.",
      status: "success",
      summary: "Evento deletado",
      variables: { event_id }
    });

  } catch (err) {
    return res.json({
      message: "Erro ao cancelar agendamento.",
      status: "failure",
      summary: "Erro interno delete",
      variables: {}
    });
  }
});

// -----------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 API Google Calendar pronta para BotConversa na porta", PORT);
});
