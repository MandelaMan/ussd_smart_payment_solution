const { query } = require("../config/db");
const { clientIp } = require("../utils/authLogger");
const {
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
} = require("../utils/passwordResetToken");

async function invalidateUnusedTokens(userId) {
  await query(
    `UPDATE admin_password_reset_tokens
     SET used_at = NOW()
     WHERE user_id = ? AND used_at IS NULL`,
    [userId]
  );
}

/**
 * Issue a new reset token for the user. Any unused tokens are invalidated first.
 * Returns the raw token (show once in the email) and its expiry.
 */
async function issuePasswordResetToken({
  userId,
  createdByUserId = null,
  req = null,
}) {
  await invalidateUnusedTokens(userId);

  const raw = generateResetToken();
  const tokenHash = hashResetToken(raw);
  const expiresAt = resetTokenExpiresAt();

  await query(
    `INSERT INTO admin_password_reset_tokens
      (user_id, token_hash, expires_at, created_by_user_id, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      tokenHash,
      expiresAt,
      createdByUserId || null,
      clientIp(req)?.slice(0, 45) || null,
    ]
  );

  return { raw, expiresAt };
}

async function findValidResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const rows = await query(
    `SELECT id, user_id, expires_at, used_at
     FROM admin_password_reset_tokens
     WHERE token_hash = ?
       AND used_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [hashResetToken(token)]
  );
  return rows[0] || null;
}

/**
 * Atomically consume a valid unused token. Returns the row or null.
 */
async function consumeValidResetToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  const tokenHash = hashResetToken(token);
  const result = await query(
    `UPDATE admin_password_reset_tokens
     SET used_at = NOW()
     WHERE token_hash = ?
       AND used_at IS NULL
       AND expires_at > NOW()`,
    [tokenHash]
  );
  if (!result?.affectedRows) return null;
  const rows = await query(
    `SELECT id, user_id FROM admin_password_reset_tokens WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

module.exports = {
  invalidateUnusedTokens,
  issuePasswordResetToken,
  findValidResetToken,
  consumeValidResetToken,
};
