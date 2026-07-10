const SYNC_COOLDOWN_MS = 30_000;

/** @type {Map<number, number>} */
const lastSyncAtByCustomer = new Map();

function getRemainingMs(customerId) {
  const last = lastSyncAtByCustomer.get(Number(customerId));
  if (!last) return 0;
  return Math.max(0, SYNC_COOLDOWN_MS - (Date.now() - last));
}

function assertSyncAllowed(customerId) {
  const remainingMs = getRemainingMs(customerId);
  if (remainingMs <= 0) return;

  const retryAfterSeconds = Math.ceil(remainingMs / 1000);
  const err = new Error(
    `Sync cooldown active. Try again in ${retryAfterSeconds} seconds.`
  );
  err.status = 429;
  err.retryAfterSeconds = retryAfterSeconds;
  throw err;
}

function recordSync(customerId) {
  lastSyncAtByCustomer.set(Number(customerId), Date.now());
}

module.exports = {
  SYNC_COOLDOWN_MS,
  SYNC_COOLDOWN_SECONDS: SYNC_COOLDOWN_MS / 1000,
  getRemainingMs,
  assertSyncAllowed,
  recordSync,
};
