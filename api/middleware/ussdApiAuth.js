/**
 * Optional shared-secret guard for USSD integration endpoints.
 * When USSD_API_SECRET is set, callers must send X-USSD-Secret header.
 * In production the secret is required to be configured.
 */
function requireUssdSecret(req, res, next) {
  const configured = process.env.USSD_API_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!configured) {
    if (isProd) {
      console.error("[ussd] USSD_API_SECRET is not configured in production");
      return res.status(503).json({ error: "Service unavailable" });
    }
    return next();
  }

  const provided =
    req.headers["x-ussd-secret"] ||
    req.body?.secret ||
    req.query?.secret;

  if (provided !== configured) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

module.exports = { requireUssdSecret };
