const crypto = require("crypto");

/**
 * Constant-time string compare. Rejects length mismatches without
 * substituting a shared fallback buffer (which would always match).
 */
function timingSafeEqualString(provided, expected) {
  const a = Buffer.from(String(provided ?? ""), "utf8");
  const b = Buffer.from(String(expected ?? ""), "utf8");
  if (a.length !== b.length) return false;
  if (a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { timingSafeEqualString };
