const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 500;

/** @type {Map<number, { expiresAt: number, data: object }>} */
const cache = new Map();

function getCachedCustomerZoho(customerId) {
  const entry = cache.get(Number(customerId));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(Number(customerId));
    return null;
  }
  return entry.data;
}

function setCachedCustomerZoho(customerId, data, ttlMs = DEFAULT_TTL_MS) {
  const id = Number(customerId);
  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey != null) cache.delete(oldestKey);
  }
  cache.set(id, { expiresAt: Date.now() + ttlMs, data });
}

function invalidateCustomerZoho(customerId) {
  cache.delete(Number(customerId));
}

module.exports = {
  DEFAULT_TTL_MS,
  getCachedCustomerZoho,
  setCachedCustomerZoho,
  invalidateCustomerZoho,
};
