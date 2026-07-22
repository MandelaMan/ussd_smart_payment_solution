const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Validates password strength for admin accounts.
 * Returns null if valid, or an error message string.
 */
function validatePassword(password) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  if (!/[a-z]/i.test(value) || !/\d/.test(value)) {
    return "Password must include at least one letter and one number";
  }
  return null;
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  validatePassword,
};
