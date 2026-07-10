const axios = require("axios");
const { logApiCall } = require("./apiCallLogger");

const ZOHO_AUTH_URL = process.env.ZOHO_AUTH_URL || "https://accounts.zoho.com/oauth/v2/token";
const ZOHO_MAIL_REFRESH_TOKEN =
  process.env.ZOHO_MAIL_REFRESH_TOKEN || process.env.ZOHO_REFRESH_TOKEN;
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_MAIL_API_BASE = process.env.ZOHO_MAIL_API_BASE || "https://mail.zoho.com/api";
const ZOHO_MAIL_ACCOUNT_ID = process.env.ZOHO_MAIL_ACCOUNT_ID;
const ZOHO_MAIL_FROM_ADDRESS = process.env.ZOHO_MAIL_FROM_ADDRESS;
const ZOHO_MAIL_FROM_NAME = process.env.ZOHO_MAIL_FROM_NAME || "Starlynx Billing";

let cachedToken = null;
let tokenExpiresAt = 0;
let refreshingPromise = null;

async function refreshAccessToken() {
  if (!ZOHO_MAIL_REFRESH_TOKEN || !ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    throw new Error(
      "Zoho Mail OAuth not configured — set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and a refresh token with ZohoMail.messages.CREATE scope"
    );
  }

  const { data } = await axios.post(ZOHO_AUTH_URL, null, {
    params: {
      refresh_token: ZOHO_MAIL_REFRESH_TOKEN,
      client_id: ZOHO_CLIENT_ID,
      client_secret: ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token",
    },
    timeout: 10000,
  });

  const ttlSec = Number(data.expires_in || 3600);
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Math.max(30_000, (ttlSec - 300) * 1000);
  return cachedToken;
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;
  if (!refreshingPromise) {
    refreshingPromise = refreshAccessToken().finally(() => {
      refreshingPromise = null;
    });
  }
  return refreshingPromise;
}

function isZohoMailConfigured() {
  return Boolean(ZOHO_MAIL_ACCOUNT_ID && ZOHO_MAIL_FROM_ADDRESS && ZOHO_MAIL_REFRESH_TOKEN);
}

function getZohoMailConfig() {
  return {
    configured: isZohoMailConfigured(),
    fromAddress: ZOHO_MAIL_FROM_ADDRESS || null,
    fromName: ZOHO_MAIL_FROM_NAME,
    accountId: ZOHO_MAIL_ACCOUNT_ID ? "***" : null,
  };
}

/**
 * Send email via Zoho Mail API.
 * @see https://www.zoho.com/mail/help/api/post-send-an-email.html
 */
async function sendZohoMail({ toAddress, subject, content, ccAddress, bccAddress, mailFormat = "html" }) {
  if (!isZohoMailConfigured()) {
    throw new Error(
      "Zoho Mail is not configured — set ZOHO_MAIL_ACCOUNT_ID and ZOHO_MAIL_FROM_ADDRESS in .env"
    );
  }

  const to = String(toAddress || "").trim();
  if (!to || !to.includes("@")) {
    throw new Error("Valid recipient email is required");
  }

  const token = await getAccessToken();
  const url = `${ZOHO_MAIL_API_BASE}/accounts/${ZOHO_MAIL_ACCOUNT_ID}/messages`;

  const payload = {
    fromAddress: ZOHO_MAIL_FROM_ADDRESS,
    toAddress: to,
    subject: String(subject || "").trim(),
    content,
    mailFormat,
  };
  if (ccAddress) payload.ccAddress = ccAddress;
  if (bccAddress) payload.bccAddress = bccAddress;

  let data;
  let httpStatus = null;
  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 20000,
      validateStatus: () => true,
    });
    data = response.data;
    httpStatus = response.status;
  } catch (error) {
    await logApiCall({
      service: "zoho",
      operation: "send_mail",
      method: "POST",
      endpoint: url,
      status: "failure",
      httpStatus: error.response?.status ?? null,
      requestPayload: {
        toAddress: to,
        subject: payload.subject,
        mailFormat,
        hasCc: Boolean(ccAddress),
      },
      responsePayload: error.response?.data ?? null,
      errorMessage: error.message,
      retryable: true,
    }).catch(() => {});
    throw error;
  }

  const code = data?.status?.code ?? data?.code;
  const success = !code || Number(code) === 200;

  await logApiCall({
    service: "zoho",
    operation: "send_mail",
    method: "POST",
    endpoint: url,
    status: success ? "success" : "failure",
    httpStatus,
    requestPayload: {
      toAddress: to,
      subject: payload.subject,
      mailFormat,
      hasCc: Boolean(ccAddress),
    },
    responsePayload: data,
    errorMessage: success
      ? null
      : data?.status?.description || data?.message || `Zoho Mail API error (${code})`,
    referenceId: data?.data?.messageId || data?.data?.mailId || null,
    retryable: !success,
  }).catch(() => {});

  if (!success) {
    const msg = data?.status?.description || data?.message || JSON.stringify(data);
    throw new Error(`Zoho Mail API error: ${msg}`);
  }

  return {
    ok: true,
    messageId: data?.data?.messageId || data?.data?.mailId || null,
    toAddress: to,
    subject: payload.subject,
  };
}

module.exports = {
  sendZohoMail,
  isZohoMailConfigured,
  getZohoMailConfig,
};
