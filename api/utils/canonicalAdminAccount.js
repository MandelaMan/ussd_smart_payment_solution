const CANONICAL_ADMIN_EMAIL = "it@sulsolutions.biz";
const CANONICAL_ADMIN_NAME = "IT";
const LEGACY_ADMIN_EMAILS = ["admin@sulsolutions.biz"];
const LEGACY_ADMIN_NAMES = new Set(["admin", "administrator"]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Canonical administrator login. Legacy `admin@` is always rewritten to `it@`,
 * even if ADMIN_EMAIL is still set to the old address on staging.
 */
function resolveAdminEmail(envValue = process.env.ADMIN_EMAIL) {
  const fromEnv = normalizeEmail(envValue);
  if (!fromEnv || LEGACY_ADMIN_EMAILS.includes(fromEnv)) {
    return CANONICAL_ADMIN_EMAIL;
  }
  return fromEnv;
}

function resolveAdminName(envValue = process.env.ADMIN_NAME) {
  const fromEnv = String(envValue || "").trim();
  if (!fromEnv || LEGACY_ADMIN_NAMES.has(fromEnv.toLowerCase())) {
    return CANONICAL_ADMIN_NAME;
  }
  return fromEnv;
}

function nextAdminName(currentName, targetName = CANONICAL_ADMIN_NAME) {
  const current = String(currentName || "").trim();
  if (!current || LEGACY_ADMIN_NAMES.has(current.toLowerCase())) {
    return targetName;
  }
  return current;
}

async function ensureCanonicalAdminAccount() {
  const { query } = require("../config/db");
  const targetEmail = resolveAdminEmail();
  const targetName = resolveAdminName();

  const existingTarget = await query(
    `SELECT id, name, email FROM admin_users WHERE email = ? LIMIT 1`,
    [targetEmail]
  );
  if (existingTarget[0]) {
    const nextName = nextAdminName(existingTarget[0].name, targetName);
    if (nextName !== existingTarget[0].name) {
      await query(`UPDATE admin_users SET name = ? WHERE id = ?`, [
        nextName,
        existingTarget[0].id,
      ]);
    }
    return { renamed: false, email: targetEmail, name: nextName };
  }

  for (const legacy of LEGACY_ADMIN_EMAILS) {
    if (legacy === targetEmail) continue;
    const rows = await query(
      `SELECT id, email, name FROM admin_users WHERE email = ? LIMIT 1`,
      [legacy]
    );
    if (!rows[0]) continue;
    const nextName = nextAdminName(rows[0].name, targetName);
    await query(
      `UPDATE admin_users
       SET email = ?, name = ?, token_version = token_version + 1
       WHERE id = ?`,
      [targetEmail, nextName, rows[0].id]
    );
    return {
      renamed: true,
      from: rows[0].email,
      to: targetEmail,
      name: nextName,
    };
  }

  return { renamed: false, email: targetEmail };
}

module.exports = {
  CANONICAL_ADMIN_EMAIL,
  CANONICAL_ADMIN_NAME,
  LEGACY_ADMIN_EMAILS,
  resolveAdminEmail,
  resolveAdminName,
  nextAdminName,
  ensureCanonicalAdminAccount,
};
