const { loadEnv } = require("../config/env");
const { buildRedisOptions } = require("../config/redis");

function getBullConnection() {
  const opts = buildRedisOptions();
  return {
    host: opts.host,
    port: opts.port,
    password: opts.password,
    db: opts.db,
    maxRetriesPerRequest: null,
  };
}

function defaultJobOptions(integration) {
  const env = loadEnv();
  return {
    attempts: env.MAX_RETRIES + 1,
    backoff: {
      type: "exponential",
      delay: env.RETRY_BASE_DELAY_MS,
    },
    removeOnComplete: { age: 86400, count: 500 },
    removeOnFail: false,
    jobId: undefined,
  };
}

function workerOptions(concurrency) {
  const env = loadEnv();
  return {
    connection: getBullConnection(),
    concurrency: concurrency || env.WORKER_CONCURRENCY,
  };
}

module.exports = {
  getBullConnection,
  defaultJobOptions,
  workerOptions,
};
