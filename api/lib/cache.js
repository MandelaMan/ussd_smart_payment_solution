const { connectRedis } = require("../config/redis");
const { loadEnv } = require("../config/env");
const { syncLog } = require("./structuredLogger");

const env = loadEnv();
const memoryFallback = new Map();
const CACHE_OP_TIMEOUT_MS = 2500;

function cacheKey(namespace, key) {
  return `cache:${namespace}:${key}`;
}

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}_timeout`)),
        CACHE_OP_TIMEOUT_MS
      );
    }),
  ]);
}

async function getCache(namespace, key) {
  const fullKey = cacheKey(namespace, key);
  try {
    const redis = await withTimeout(connectRedis(), "cache_connect");
    const raw = await withTimeout(redis.get(fullKey), "cache_get");
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
    const redis = await withTimeout(connectRedis(), "cache_connect");
    if (ttlSeconds > 0) {
      await withTimeout(redis.set(fullKey, payload, "EX", ttlSeconds), "cache_set");
    } else {
      await withTimeout(redis.set(fullKey, payload), "cache_set");
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
    const redis = await withTimeout(connectRedis(), "cache_connect");
    let cursor = "0";
    do {
      const [next, keys] = await withTimeout(
        redis.scan(cursor, "MATCH", pattern, "COUNT", 100),
        "cache_scan"
      );
      cursor = next;
      if (keys.length) await withTimeout(redis.del(...keys), "cache_del");
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
