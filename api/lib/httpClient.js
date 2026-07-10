const axios = require("axios");
const Bottleneck = require("bottleneck");
const { loadEnv } = require("../config/env");
const { syncLog } = require("./structuredLogger");

const env = loadEnv();

const limiters = new Map();

function getLimiter(integration) {
  if (!limiters.has(integration)) {
    limiters.set(
      integration,
      new Bottleneck({
        maxConcurrent: env.API_CONCURRENCY,
        minTime: Math.ceil(1000 / Math.max(1, env.API_CONCURRENCY)),
      })
    );
  }
  return limiters.get(integration);
}

function isRetryableError(err) {
  if (!err) return false;
  const status = err.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  const code = err.code;
  return (
    code === "ECONNABORTED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt, baseMs = 1000) {
  const exp = Math.min(baseMs * 2 ** attempt, 60000);
  const jitter = Math.floor(Math.random() * 500);
  return exp + jitter;
}

/**
 * HTTP client with timeout, retry, rate limiting, and structured logging.
 */
async function requestWithRetry(config, options = {}) {
  const {
    integration = "external",
    correlationId = null,
    maxRetries = env.MAX_RETRIES,
    timeoutMs = env.API_TIMEOUT_MS,
  } = options;

  const limiter = getLimiter(integration);
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const started = Date.now();
    try {
      const response = await limiter.schedule(() =>
        axios({
          timeout: timeoutMs,
          ...config,
          signal: config.signal,
        })
      );

      syncLog.apiCall({
        integration,
        method: (config.method || "GET").toUpperCase(),
        url: config.url,
        durationMs: Date.now() - started,
        status: response.status,
        correlationId,
        attempt: attempt + 1,
      });

      return response;
    } catch (err) {
      lastError = err;
      const retryable = isRetryableError(err);
      syncLog.apiCall({
        integration,
        method: (config.method || "GET").toUpperCase(),
        url: config.url,
        durationMs: Date.now() - started,
        status: err.response?.status || 0,
        correlationId,
        attempt: attempt + 1,
      });

      if (!retryable || attempt >= maxRetries) {
        throw err;
      }

      const delayMs = backoffDelay(attempt);
      syncLog.retry({
        integration,
        attempt: attempt + 1,
        maxAttempts: maxRetries,
        reason: err.message,
        correlationId,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

module.exports = {
  requestWithRetry,
  isRetryableError,
  getLimiter,
};
