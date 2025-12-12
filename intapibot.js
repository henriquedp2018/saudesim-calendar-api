// ==============================================
// API SAÚDESIM - GOOGLE CALENDAR INTEGRATION
// CORRIGIDA COM: 
// - Google Meet funcionando
// - Bloqueio de horário duplicado
// - Conversões de data e hora
// ==============================================

import express from "express";
import bodyParser from "body-parser";
import { google } from "googleapis";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

// ===========================
// 1) CARREGA SERVICE ACCOUNT
// ===========================
const serviceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/service-account.json", "utf8")
);

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.readonly"
];

const auth = new google.auth.JWT(
  serviceAccount.client_email,
  null,
  serviceAccount.private_key,
  SCOPES
);

const calendar = google.calendar({ version: "v3", auth });

// ===========================
// 2) FUNÇÃO PARA BLOQUEAR DUPLICIDADE
// ===========================
async function horarioOcupado(calendarId, startISO, endISO) {
  const resp = await calendar.events.list({
    calendarId,
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: true,
    orderBy: "startTime"
  });

  return resp.data.items.length > 0;
}

// ===========================
// 3) ROTA PRINCIPAL
// ===========================
app.post("/create-event", async (req, res) => {
  try {
    const {
      nome,
      email,
      fone,
      tipo_atd,
      data,
      hora,
      pagto,
      libras,
      local,
      valor,
      res_id
    } = req.body;

    // ===========================
    // VALIDAÇÃO SIMPLES
    // ===========================
    if (!nome || !email || !data || !hora) {
      return res.status(400).json({
        error: "Campos obrigatórios ausentes!"
      });
    }

    // ===========================
    // FORMATAR DATAS
    // ===========================
    const [dia, mes, ano] = data.split("/");
    const startISO = `${ano}-${mes}-${dia}T${hora}:00-03:00`;

    // término fixo = +1 hora
    const endISO = `${ano}-${mes}-${dia}T${
      String(Number(hora.split(":")[0]) + 1).padStart(2, "0")
    }:${hora.split(":")[1]}:00-03:00`;

    // ===========================
    //  BLOQUEIO DE HORÁRIO
    // ===========================
    const calendarId = process.env.CALENDAR_ID;

    const ocupado = await horarioOcupado(calendarId, startISO, endISO);
    if (ocupado) {
      return res.status(409).json({
        error: "Horário indisponível!"
      });
    }

    // ===========================
    // 4) CRIAR EVENTO COM MEET
    // ===========================
    const eventBody = {
      summary: `Consulta Clínica SaúdeSim - ${nome}`,
      location: local,
      description:
        `Paciente: ${nome}\n` +
        `Telefone: ${fone}\n` +
        `Atendimento: ${tipo_atd}\n` +
        `Pagamento: ${pagto}\n` +
        `Libras: ${libras}\n` +
        `Valor: ${valor}\n` +
        `ID Reserva: ${res_id}`,

      start: {
        dateTime: startISO,
        timeZone: "America/Sao_Paulo"
      },
      end: {
        dateTime: endISO,
        timeZone: "America/Sao_Paulo"
      },

      // GOOGLE MEET
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: {
            type: "hangoutsMeet"
          }
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId,
      resource: eventBody,
      conferenceDataVersion: 1
    });

    const meetLink = response.data?.conferenceData?.entryPoints?.[0]?.uri || null;

    console.log("MEET GERADO:", meetLink);

    return res.json({
      status: "success",
      message: "Evento criado com sucesso!",
      meet_link: meetLink
    });

  } catch (err) {
    console.error("❌ ERRO AO CRIAR EVENTO:", err);
    return res.status(500).json({
      error: "internal_error",
      details: err.message
    });
  }
});

// ===========================
// 5) START SERVER
// ===========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
