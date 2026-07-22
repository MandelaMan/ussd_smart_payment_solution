const { query } = require("../config/db");

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
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
