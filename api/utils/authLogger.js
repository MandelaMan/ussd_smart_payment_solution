const { query } = require("../config/db");

/**
 * Client IP for rate limits / audit logs.
 * Prefer Express `req.ip` when `trust proxy` is set so the reverse proxy's
 * resolved address is used instead of a spoofable leftmost X-Forwarded-For hop.
 */
function clientIp(req) {
  if (req?.ip) return req.ip;
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    // Rightmost hop is typically the proxy-adjacent client when the edge strips spoofed values.
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || null;
  }
  return req?.socket?.remoteAddress || null;
}

/**
 * Records admin login attempts without storing passwords or tokens.
 */
async function logAuthEvent({
  email,
  userId = null,
  outcome,
  req,
  reason = null,
}) {
  try {
    await query(
      `INSERT INTO auth_login_logs (email, user_id, outcome, ip_address, user_agent, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        email ? String(email).trim().toLowerCase().slice(0, 191) : null,
        userId,
        outcome,
        clientIp(req)?.slice(0, 45) || null,
        req?.headers?.["user-agent"]?.slice(0, 500) || null,
        reason ? String(reason).slice(0, 255) : null,
      ]
    );
  } catch (err) {
    console.warn("[auth] failed to write login log:", err.message);
  }
}

module.exports = { logAuthEvent, clientIp };
