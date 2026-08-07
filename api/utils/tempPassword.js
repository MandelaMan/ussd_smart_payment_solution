/**
 * Temporary password generator for new users / admin resets.
 * Strong mixed-character secrets (e.g. hJ8}N6V9j) that meet password policy.
 * Users must still change password on first login (must_change_password).
 */

const CRYPTO = require("crypto");
const { validatePassword } = require("./passwordPolicy");

const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O
const DIGITS = "23456789"; // no 0/1
const SYMBOLS = "!@#$%^&*{}[]?+-=";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const TEMP_PASSWORD_LENGTH = 9;

function pick(alphabet) {
  const bytes = CRYPTO.randomBytes(1);
  return alphabet[bytes[0] % alphabet.length];
}

function shuffle(chars) {
  const arr = [...chars];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = CRYPTO.randomBytes(1)[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

/**
 * Generate a temporary password like "hJ8}N6V9j".
 * Guarantees lower, upper, digit, and symbol; remaining chars from full alphabet.
 */
function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH) {
  const size = Math.max(8, Number(length) || TEMP_PASSWORD_LENGTH);
  for (let attempt = 0; attempt < 20; attempt++) {
    const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
    const rest = [];
    for (let i = required.length; i < size; i++) {
      rest.push(pick(ALL));
    }
    const password = shuffle([...required, ...rest]);
    if (!validatePassword(password)) return password;
  }
  // Extremely unlikely fallback
  return shuffle([
    pick(LOWER),
    pick(UPPER),
    pick(DIGITS),
    pick(SYMBOLS),
    ...Array.from({ length: size - 4 }, () => pick(ALL)),
  ]);
}

function isTemporaryPasswordFormat(password) {
  const value = String(password || "");
  if (value.length < 8 || value.length > 128) return false;
  return (
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

module.exports = {
  generateTemporaryPassword,
  isTemporaryPasswordFormat,
  TEMP_PASSWORD_LENGTH,
};
