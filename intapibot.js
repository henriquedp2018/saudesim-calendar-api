require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");
const app = express();
app.use(express.json());

// -----------------------------------------------------------
//  CARREGAR SERVICE ACCOUNT DO SECRET FILE
// -----------------------------------------------------------

const SERVICE_ACCOUNT_PATH = process.env.GOOGLE_SA_KEY_FILE;

if (!SERVICE_ACCOUNT_PATH) {
  console.error("❌ ERRO FATAL: GOOGLE_SA_KEY_FILE não definido no .env!");
  process.exit(1);
}

let serviceAccount = null;

try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
  console.log("✅ Service Account carregado via Secret File:", SERVICE_ACCOUNT_PATH);
} catch (error) {
  console.error("❌ ERRO ao carregar o arquivo service-account.json:");
  console.error(error);
  process.exit(1);
}

// Extrair credenciais do JSON
const GOOGLE_CLIENT_EMAIL = serviceAccount.client_email;
const GOOGLE_PRIVATE_KEY = serviceAccount.private_key;

if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
  console.error("❌ ERRO FATAL: service-account.json está incompleto (falta client_email ou private_key).");
  process.exit(1);
}

// -----------------------------------------------------------
//  VARIÁVEIS DO .ENV
// -----------------------------------------------------------

const {
  WEBHOOK_SECRET,
  GOOGLE_CALENDAR_ID,
  TIMEZONE
} = process.env;

if (!WEBHOOK_SECRET) {
  console.error("❌ ERRO: WEBHOOK_SECRET ausente no .env");
  process.exit(1);
}

if (!GOOGLE_CALENDAR_ID) {
  console.error("❌ ERRO: GOOGLE_CALENDAR_ID ausente no .env");
  process.exit(1);
}

if (!TIMEZONE) {
  console.error("❌ ERRO: TIMEZONE ausente no .env");
  process.exit(1);
}

console.log("✅ Variáveis do .env carregadas com sucesso!");

// -----------------------------------------------------------
//  GOOGLE AUTH
// -----------------------------------------------------------

function getJwtClient() {
  try {
    return new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL,
      null,
      GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/calendar"]
    );
  } catch (err) {
    console.error("❌ ERRO ao criar JWT Client:", err);
    throw err;
  }
}
