const { connectRedis } = require("../config/redis");
const { loadEnv } = require("../config/env");
const { syncLog } = require("./structuredLogger");

const env = loadEnv();
const memoryFallback = new Map();

function cacheKey(namespace, key) {
  return `cache:${namespace}:${key}`;
}

async function getCache(namespace, key) {
  const fullKey = cacheKey(namespace, key);
  try {
    const redis = await connectRedis();
    const raw = await redis.get(fullKey);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (err) {
    syncLog.warn("cache_get_fallback", { namespace, key, error: err.message });
    const entry = memoryFallback.get(fullKey);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      memoryFallback.delete(fullKey);
      return null;
    }
    return entry.value;
  }
}

async function setCache(namespace, key, value, ttlSeconds = env.CACHE_TTL_SECONDS) {
  const fullKey = cacheKey(namespace, key);
  const payload = JSON.stringify(value);
  try {
    const redis = await connectRedis();
    if (ttlSeconds > 0) {
      await redis.set(fullKey, payload, "EX", ttlSeconds);
    } else {
      await redis.set(fullKey, payload);
    }
  } catch (err) {
    syncLog.warn("cache_set_fallback", { namespace, key, error: err.message });
    memoryFallback.set(fullKey, {
      value,
      expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
  }
}

async function invalidateNamespace(namespace) {
  const pattern = cacheKey(namespace, "*");
  try {
    const redis = await connectRedis();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    syncLog.warn("cache_invalidate_fallback", { namespace, error: err.message });
    for (const k of memoryFallback.keys()) {
      if (k.startsWith(`cache:${namespace}:`)) memoryFallback.delete(k);
    }
  }
}

async function invalidateDashboardCaches() {
  await Promise.all([
    invalidateNamespace("dashboard"),
    invalidateNamespace("reconciliation"),
    invalidateNamespace("billing"),
  ]);
}

module.exports = {
  getCache,
  setCache,
  invalidateNamespace,
  invalidateDashboardCaches,
};
