require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { loadEnv } = require("../api/config/env");
const { connectRedis, pingRedis } = require("../api/config/redis");
const { startAllWorkers, closeAllWorkers } = require("../api/workers/registry");
const { registerRepeatableJobs, triggerInitialSync } = require("../api/queue/schedulers");
const { closeQueues } = require("../api/queue/manager");
const { syncLog } = require("../api/lib/structuredLogger");

async function main() {
  const env = loadEnv();
  syncLog.info("worker_process_starting", { pid: process.pid });

  try {
    await connectRedis();
    const ok = await pingRedis();
    if (!ok) {
      throw new Error("Redis is not reachable");
    }
  } catch (err) {
    syncLog.error("worker_redis_connection_failed", {
      error: err?.message || String(err),
      code: err?.code,
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      hint: "Is Redis running? Try: yarn docker:up  (or docker compose up -d redis)",
    });
    process.exit(1);
  }

  startAllWorkers();
  await registerRepeatableJobs();
  await triggerInitialSync();

  syncLog.info("worker_process_ready", {
    concurrency: env.WORKER_CONCURRENCY,
    integrations: 5,
  });

  const shutdown = async (signal) => {
    syncLog.info("worker_shutdown", { signal });
    await closeAllWorkers();
    await closeQueues();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Worker process failed to start:", err);
  process.exit(1);
});
