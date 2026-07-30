const crypto = require("crypto");
const { clientIp } = require("../utils/authLogger");

const TIMING_SAFE_FALLBACK = Buffer.alloc(32);

/**
 * Verifies Meta WhatsApp Cloud API webhook signature (X-Hub-Signature-256).
 * Requires req.rawBody to be set by express.json verify callback.
 */
async function verifyWhatsAppSignature(req) {
  const whatsappLeadBot = require("../services/whatsappLeadBot");
  const settings = await whatsappLeadBot.loadWhatsAppSettings();
  const appSecret = settings.appSecret;
  const whatsappConfigured = Boolean(
    settings.accessToken && settings.phoneNumberId
  );

  if (!appSecret) {
    if (process.env.NODE_ENV === "production" && whatsappConfigured) {
      return { ok: false, reason: "WhatsApp app secret not configured" };
    }
    return { ok: true, skipped: true };
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") {
    return { ok: false, reason: "missing signature" };
  }

  const rawBody = req.rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return { ok: false, reason: "missing raw body" };
  }

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return { ok: false, reason: "invalid signature" };
  }

  return { ok: true };
}

/** Known Safaricom Daraja callback egress IPs (override via env). */
const DEFAULT_MPESA_CALLBACK_IPS = [
  "196.201.214.200",
  "196.201.214.206",
  "196.201.213.217",
  "196.201.214.207",
  "196.201.214.208",
  "196.222.214.148",
  "196.222.214.149",
  "196.222.214.161",
  "196.222.214.162",
  "196.222.214.20",
  "196.222.214.21",
];

function getMpesaAllowedIps() {
  const raw = process.env.MPESA_CALLBACK_IP_ALLOWLIST;
  if (!raw || !String(raw).trim()) {
    return DEFAULT_MPESA_CALLBACK_IPS;
  }
  return String(raw)
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function normalizeIp(ip) {
  if (!ip) return "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isMpesaIpAllowed(req) {
  const ip = normalizeIp(clientIp(req));
  if (!ip) return false;
  return getMpesaAllowedIps().includes(ip);
}

function verifyMpesaCallbackSecret(req) {
  const configured = process.env.MPESA_CALLBACK_SECRET;
  if (!configured) return { ok: false, skipped: true };

  const provided =
    req.headers["x-mpesa-callback-secret"] ||
    req.query?.secret ||
    req.body?.secret;

  if (!provided) return { ok: false, reason: "missing callback secret" };

  const providedBuf = Buffer.from(String(provided));
  const configuredBuf = Buffer.from(String(configured));
  const a =
    providedBuf.length === configuredBuf.length
      ? providedBuf
      : TIMING_SAFE_FALLBACK;
  const b =
    configuredBuf.length === providedBuf.length
      ? configuredBuf
      : TIMING_SAFE_FALLBACK;

  if (!crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid callback secret" };
  }
  return { ok: true };
}

/**
 * Guards M-Pesa Daraja webhook endpoints.
 * In production: IP must match allowlist OR valid MPESA_CALLBACK_SECRET.
 * In development: open when neither is configured.
 */
function requireMpesaCallbackAuth(req, res, next) {
  const isProd = process.env.NODE_ENV === "production";
  const hasSecret = Boolean(process.env.MPESA_CALLBACK_SECRET);
  const ipAllowed = isMpesaIpAllowed(req);
  const secretCheck = verifyMpesaCallbackSecret(req);

  if (secretCheck.ok) return next();
  if (ipAllowed) return next();

  if (!isProd && !hasSecret) {
    return next();
  }

  if (isProd && !hasSecret && !ipAllowed) {
    console.warn("[mpesa] callback rejected — IP not allowlisted:", clientIp(req));
  }

  return res.status(401).json({ error: "Unauthorized" });
}

module.exports = {
  verifyWhatsAppSignature,
  requireMpesaCallbackAuth,
  getMpesaAllowedIps,
};
