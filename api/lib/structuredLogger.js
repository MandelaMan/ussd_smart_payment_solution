const { logError } = require("../utils/errorLogger");

function logSync(level, message, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    if (fields.error instanceof Error) {
      logError(fields.error, { source: "sync", ...fields });
    }
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
  return entry;
}

const syncLog = {
  info: (message, fields) => logSync("info", message, fields),
  warn: (message, fields) => logSync("warn", message, fields),
  error: (message, fields) => logSync("error", message, fields),
  debug: (message, fields) => {
    if (process.env.NODE_ENV !== "production") {
      logSync("debug", message, fields);
    }
  },
  apiCall: ({ integration, method, url, durationMs, status, correlationId, attempt }) =>
    logSync("info", "external_api_call", {
      integration,
      method,
      url,
      durationMs,
      status,
      correlationId,
      attempt,
    }),
  dbOp: ({ operation, table, durationMs, correlationId, rows }) =>
    logSync("info", "database_operation", {
      operation,
      table,
      durationMs,
      correlationId,
      rows,
    }),
  job: ({ integration, jobId, event, durationMs, correlationId, ...rest }) =>
    logSync("info", "sync_job", {
      integration,
      jobId,
      event,
      durationMs,
      correlationId,
      ...rest,
    }),
  retry: ({ integration, attempt, maxAttempts, reason, correlationId, delayMs }) =>
    logSync("warn", "sync_retry", {
      integration,
      attempt,
      maxAttempts,
      reason,
      correlationId,
      delayMs,
    }),
};

module.exports = { syncLog, logSync };
