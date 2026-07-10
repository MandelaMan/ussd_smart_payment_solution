const { loadEnv } = require("../config/env");
const { connectRedis } = require("../config/redis");
const { syncLog } = require("./structuredLogger");

class ZohoBudgetExhaustedError extends Error {
  constructor(message, status = {}) {
    super(message);
    this.name = "ZohoBudgetExhaustedError";
    this.status = 429;
    this.budget = status;
  }
}

const memoryCounts = new Map();

function withRedisTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("redis_timeout")), ms),
    ),
  ]);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function redisKey() {
  return `zoho:api:count:${todayKey()}`;
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.max(60, Math.ceil((end - now) / 1000));
}

function getLimits() {
  const env = loadEnv();
  return {
    enabled: env.ZOHO_API_BUDGET_ENABLED,
    dailyLimit: env.ZOHO_DAILY_API_LIMIT,
    reserve: env.ZOHO_DAILY_API_RESERVE,
    backgroundLimit: Math.max(0, env.ZOHO_DAILY_API_LIMIT - env.ZOHO_DAILY_API_RESERVE),
  };
}

async function getUsedCount() {
  const key = todayKey();
  try {
    const redis = await withRedisTimeout(connectRedis(), 2500);
    const raw = await withRedisTimeout(redis.get(redisKey()), 2500);
    return Number(raw || 0);
  } catch {
    return Number(memoryCounts.get(key) || 0);
  }
}

async function recordZohoApiCall(count = 1) {
  const { enabled } = getLimits();
  if (!enabled) return;

  const key = todayKey();
  try {
    const redis = await withRedisTimeout(connectRedis(), 2500);
    const rk = redisKey();
    const next = await withRedisTimeout(redis.incrby(rk, count), 2500);
    if (next === count) {
      await withRedisTimeout(redis.expire(rk, secondsUntilUtcMidnight()), 2500);
    }
  } catch {
    memoryCounts.set(key, Number(memoryCounts.get(key) || 0) + count);
  }
}

/**
 * @param {'interactive' | 'background'} priority
 * @param {number} [needed=1]
 */
async function canMakeZohoCall(priority = "interactive", needed = 1) {
  const { enabled, dailyLimit, backgroundLimit } = getLimits();
  if (!enabled) return true;

  const used = await getUsedCount();
  if (used + needed > dailyLimit) return false;
  if (priority === "background" && used + needed > backgroundLimit) return false;
  return true;
}

async function assertCanMakeZohoCall(priority = "interactive", needed = 1) {
  const status = await getZohoBudgetStatus();
  const ok = await canMakeZohoCall(priority, needed);
  if (!ok) {
    const msg =
      priority === "background"
        ? `Zoho daily API budget reserved for interactive use (${status.used}/${status.dailyLimit} used)`
        : `Zoho daily API limit reached (${status.used}/${status.dailyLimit})`;
    throw new ZohoBudgetExhaustedError(msg, status);
  }
}

async function getZohoBudgetStatus() {
  const { enabled, dailyLimit, reserve, backgroundLimit } = getLimits();
  const used = await getUsedCount();
  const remaining = Math.max(0, dailyLimit - used);
  const backgroundRemaining = Math.max(0, backgroundLimit - used);

  return {
    enabled,
    day: todayKey(),
    dailyLimit,
    reserve,
    backgroundLimit,
    used,
    remaining,
    backgroundRemaining,
    percentUsed: dailyLimit > 0 ? Math.round((used / dailyLimit) * 100) : 0,
    resetsAtUtc: `${todayKey()}T23:59:59.999Z`,
  };
}

/**
 * Estimate whether a background batch can run.
 * @param {number} estimatedCalls
 */
async function canRunBackgroundBatch(estimatedCalls) {
  return canMakeZohoCall("background", estimatedCalls);
}

function logBudgetSkip(integration, reason, status) {
  syncLog.warn("zoho_budget_skip", {
    integration,
    reason,
    used: status.used,
    dailyLimit: status.dailyLimit,
    backgroundRemaining: status.backgroundRemaining,
  });
}

module.exports = {
  ZohoBudgetExhaustedError,
  recordZohoApiCall,
  canMakeZohoCall,
  assertCanMakeZohoCall,
  getZohoBudgetStatus,
  canRunBackgroundBatch,
  logBudgetSkip,
};
