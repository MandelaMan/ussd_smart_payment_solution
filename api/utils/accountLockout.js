const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

function isAccountLocked(user) {
  if (!user?.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

function lockoutMessage(user) {
  const until = user?.locked_until
    ? new Date(user.locked_until).toISOString()
    : null;
  return {
    error:
      "Account temporarily locked due to too many failed login attempts. Try again later.",
    lockedUntil: until,
  };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  isAccountLocked,
  lockoutMessage,
};
