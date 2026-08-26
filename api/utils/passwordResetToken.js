/**
 * High-entropy password reset tokens. Only SHA-256 hashes are stored.
 * Completing a reset also unlocks the account (see PASSWORD_RESET_USER_SQL).
 */

const crypto = require("crypto");

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_TTL_MINUTES = 60;

/** Applied when a staff member sets a new password via reset link. */
const PASSWORD_RESET_USER_SQL =
  "password_hash = ?, must_change_password = 0, failed_login_count = 0, locked_until = NULL";

function generateResetToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function resetTokenExpiresAt(from = new Date()) {
  return new Date(from.getTime() + TOKEN_TTL_MS);
}

function isResetTokenExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= now.getTime();
}

function isResetTokenRowValid(row, now = new Date()) {
  if (!row) return false;
  if (row.used_at) return false;
  return !isResetTokenExpired(row.expires_at, now);
}

module.exports = {
  TOKEN_BYTES,
  TOKEN_TTL_MS,
  TOKEN_TTL_MINUTES,
  PASSWORD_RESET_USER_SQL,
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  isResetTokenExpired,
  isResetTokenRowValid,
};
