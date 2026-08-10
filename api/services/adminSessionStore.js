const crypto = require("crypto");
const { query } = require("../config/db");
const { clientIp } = require("../utils/authLogger");

/** Laptop + phone + tablet + PWA is common; 2 caused surprise mid-day logouts. */
const DEFAULT_MAX_ACTIVE_SESSIONS = 5;

function maxActiveSessions() {
  const raw = Number(process.env.MAX_ADMIN_SESSIONS);
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  return DEFAULT_MAX_ACTIVE_SESSIONS;
}

function newSessionId() {
  return crypto.randomUUID();
}

/**
 * Persist a new session row for the given JWT jti.
 */
async function createSession({ jti, userId, expiresAt, req }) {
  await query(
    `INSERT INTO admin_sessions (jti, user_id, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      jti,
      userId,
      clientIp(req)?.slice(0, 45) || null,
      req?.headers?.["user-agent"]?.slice(0, 500) || null,
      expiresAt,
    ]
  );
}

/**
 * Keep at most `limit` newest active sessions for the user; revoke the rest.
 * Returns the number of sessions revoked.
 */
async function enforceSessionLimit(userId, limit = maxActiveSessions()) {
  const active = await query(
    `SELECT id FROM admin_sessions
     WHERE user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC, id DESC`,
    [userId]
  );

  if (active.length <= limit) return 0;

  const toRevoke = active.slice(limit).map((row) => row.id);
  if (!toRevoke.length) return 0;

  const placeholders = toRevoke.map(() => "?").join(", ");
  await query(
    `UPDATE admin_sessions
     SET revoked_at = NOW()
     WHERE id IN (${placeholders}) AND revoked_at IS NULL`,
    toRevoke
  );
  return toRevoke.length;
}

async function isSessionActive(jti, userId) {
  if (!jti || userId == null) return false;
  const rows = await query(
    `SELECT id FROM admin_sessions
     WHERE jti = ?
       AND user_id = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [String(jti), userId]
  );
  return Boolean(rows[0]);
}

async function revokeSession(jti, userId) {
  if (!jti || userId == null) return;
  await query(
    `UPDATE admin_sessions
     SET revoked_at = NOW()
     WHERE jti = ? AND user_id = ? AND revoked_at IS NULL`,
    [String(jti), userId]
  );
}

async function revokeAllSessionsForUser(userId) {
  await query(
    `UPDATE admin_sessions
     SET revoked_at = NOW()
     WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
}

module.exports = {
  DEFAULT_MAX_ACTIVE_SESSIONS,
  maxActiveSessions,
  newSessionId,
  createSession,
  enforceSessionLimit,
  isSessionActive,
  revokeSession,
  revokeAllSessionsForUser,
};
