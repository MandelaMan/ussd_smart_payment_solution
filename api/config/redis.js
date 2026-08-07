const Redis = require("ioredis");
const { loadEnv } = require("./env");

let client = null;
let subscriber = null;

function buildRedisOptions() {
  const env = loadEnv();
  const password = String(env.REDIS_PASSWORD || "").trim();
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    // Only send AUTH when a password is actually configured. Local Redis often
    // has no auth; sending one floods warnings and slows connection setup.
    ...(password ? { password } : {}),
    db: env.REDIS_DB,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5000,
    // Prevent cache / session helpers from hanging the HTTP request forever
    // while Redis is reconnecting (BullMQ still needs maxRetriesPerRequest: null).
    commandTimeout: 3000,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 300, 3000);
    },
  };
}

function getRedis() {
  if (!client) {
    client = new Redis(buildRedisOptions());
    client.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
  }
  return client;
}

function getRedisSubscriber() {
  if (!subscriber) {
    subscriber = new Redis(buildRedisOptions());
    subscriber.on("error", (err) => {
      console.error("[redis-subscriber] connection error:", err.message);
    });
  }
  return subscriber;
}

async function connectRedis() {
  const redis = getRedis();
  if (redis.status === "wait") {
    await Promise.race([
      redis.connect(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("redis_connect_timeout")), 5000)
      ),
    ]);
  }
  return redis;
}

async function pingRedis() {
  try {
    const redis = await connectRedis();
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

async function closeRedis() {
  const closes = [];
  if (client) {
    closes.push(client.quit().catch(() => client.disconnect()));
    client = null;
  }
  if (subscriber) {
    closes.push(subscriber.quit().catch(() => subscriber.disconnect()));
    subscriber = null;
  }
  await Promise.all(closes);
}

module.exports = {
  getRedis,
  getRedisSubscriber,
  connectRedis,
  pingRedis,
  closeRedis,
  buildRedisOptions,
};
