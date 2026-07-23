const { loadEnv } = require("../config/env");

const env = loadEnv();

const ALLOWED_ORIGINS = [
  env.ADMIN_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://app.sulsolutions.biz",
  "https://staging-app.sulsolutions.biz",
].filter(Boolean);

const PUBLIC_MUTATION_PREFIXES = [
  "/api/public/leads",
  "/api/public/zoho/webhook",
  "/api/public/whatsapp/webhook",
  "/api/ussd",
  "/api/payment/callback",
  "/api/payment/validation",
  "/api/payment/confirmation",
  "/api/payment/b2c",
];

function isPublicMutationPath(path) {
  return PUBLIC_MUTATION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Rejects cross-origin state-changing requests in production when Origin
 * is missing or not on the admin allowlist. Complements SameSite cookies.
 */
function originGuard(req, res, next) {
  if (env.NODE_ENV !== "production") return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const path = req.originalUrl?.split("?")[0] || req.path || "";
  if (isPublicMutationPath(path)) return next();

  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

module.exports = { originGuard, ALLOWED_ORIGINS };
