const { loadEnv } = require("../config/env");
const { connectRedis } = require("../config/redis");
const { getUsedCount } = require("./zohoApiBudget");

const memoryBuckets = new Map();

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  const d = new Date();
  return `${d.toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.max(60, Math.ceil((end - now) / 1000));
}

function secondsUntilNextHour() {
  const now = new Date();
  const end = new Date(now);
  end.setMinutes(59, 59, 999);
  return Math.max(60, Math.ceil((end - now) / 1000));
}

async function incrRedis(key, count, ttlSeconds) {
  try {
    const redis = await connectRedis();
    const next = await redis.incrby(key, count);
    if (next === count) await redis.expire(key, ttlSeconds);
    return next;
  } catch {
    const prev = Number(memoryBuckets.get(key) || 0);
    const next = prev + count;
    memoryBuckets.set(key, next);
    return next;
  }
}

async function getRedis(key) {
  try {
    const redis = await connectRedis();
    return Number((await redis.get(key)) || 0);
  } catch {
    return Number(memoryBuckets.get(key) || 0);
  }
}

/**
 * Track Zoho API usage by module and source (scheduled, webhook, manual, interactive).
 */
async function recordZohoApiUsage({ module = "unknown", source = "unknown", count = 1 }) {
  const day = todayKey();
  const hour = hourKey();
  await Promise.all([
    incrRedis(`zoho:api:module:${module}:${day}`, count, secondsUntilUtcMidnight()),
    incrRedis(`zoho:api:source:${source}:${day}`, count, secondsUntilUtcMidnight()),
    incrRedis(`zoho:api:hour:${hour}`, count, secondsUntilNextHour()),
  ]);
}

async function getModuleUsageDay(module) {
  return getRedis(`zoho:api:module:${module}:${todayKey()}`);
}

async function getSourceUsageDay(source) {
  return getRedis(`zoho:api:source:${source}:${todayKey()}`);
}

async function getHourlyUsage() {
  return getRedis(`zoho:api:hour:${hourKey()}`);
}

function resolveAlertLevel(used, env) {
  const warning = env.API_WARNING_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.7);
  const critical = env.API_CRITICAL_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.85);
  const emergency = env.API_EMERGENCY_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.95);

  if (used >= emergency) return { level: "emergency", threshold: emergency };
  if (used >= critical) return { level: "critical", threshold: critical };
  if (used >= warning) return { level: "warning", threshold: warning };
  return { level: "ok", threshold: warning };
}

async function getZohoApiUsageReport() {
  const env = loadEnv();
  const used = await getUsedCount();
  const hourly = await getHourlyUsage();
  const remaining = Math.max(0, env.ZOHO_DAILY_API_LIMIT - used);
  const alert = resolveAlertLevel(used, env);

  const modules = [
    "zoho-contacts",
    "invoices",
    "zoho-payments",
    "zoho-recurring",
    "zoho-estimates",
    "zoho-credit-notes",
    "reconciliation",
    "manual",
    "webhook",
    "interactive",
  ];

  const byModule = {};
  for (const mod of modules) {
    byModule[mod] = await getModuleUsageDay(mod);
  }

  const bySource = {
    scheduled: await getSourceUsageDay("scheduled"),
    webhook: await getSourceUsageDay("webhook"),
    manual: await getSourceUsageDay("manual"),
    interactive: await getSourceUsageDay("interactive"),
  };

  return {
    day: todayKey(),
    hour: hourKey(),
    dailyLimit: env.ZOHO_DAILY_API_LIMIT,
    used,
    remaining,
    hourly,
    percentUsed: env.ZOHO_DAILY_API_LIMIT
      ? Math.round((used / env.ZOHO_DAILY_API_LIMIT) * 100)
      : 0,
    alert,
    thresholds: {
      warning: env.API_WARNING_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.7),
      critical: env.API_CRITICAL_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.85),
      emergency: env.API_EMERGENCY_THRESHOLD || Math.floor(env.ZOHO_DAILY_API_LIMIT * 0.95),
    },
    byModule,
    bySource,
  };
}

module.exports = {
  recordZohoApiUsage,
  getZohoApiUsageReport,
  getModuleUsageDay,
  getSourceUsageDay,
  getHourlyUsage,
};
