const fs = require("fs");
const path = require("path");

function getLogDir() {
  const override = process.env.ERROR_LOG_DIR;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  return path.join(__dirname, "..", "..", "logs");
}

function errorLogFilePath() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(getLogDir(), `errors-${y}-${m}-${day}.log`);
}

function ensureLogDir() {
  fs.mkdirSync(getLogDir(), { recursive: true });
}

function errorPayload(err) {
  if (!err) return { message: "Unknown error" };
  const base = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  if (err.status != null) base.status = err.status;
  if (err.code != null) base.code = err.code;
  return base;
}

/**
 * Append one error as a JSON line to logs/errors-YYYY-MM-DD.log
 * @param {Error|unknown} err
 * @param {Record<string, unknown>} [context]
 */
function logError(err, context = {}) {
  try {
    ensureLogDir();
    const normalized =
      err instanceof Error ? err : new Error(String(err));
    const mergedContext = {
      ...(process.env.NODE_ENV === "production" && process.env.GIT_COMMIT
        ? { commit: process.env.GIT_COMMIT }
        : {}),
      ...context,
    };
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...errorPayload(normalized),
        context: mergedContext,
      }) + "\n";
    fs.appendFileSync(errorLogFilePath(), line, "utf8");
  } catch (writeErr) {
    console.error("errorLogger: failed to write log file:", writeErr);
  }
}

/**
 * One-line audit for prod: process start (errors already go to errors-*.log).
 * @param {Record<string, unknown>} [meta]
 */
function logServerStart(meta = {}) {
  if (process.env.NODE_ENV !== "production") return;
  try {
    ensureLogDir();
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        event: "server_start",
        commit: process.env.GIT_COMMIT || null,
        ...meta,
      }) + "\n";
    fs.appendFileSync(path.join(getLogDir(), "runtime.log"), line, "utf8");
  } catch (_) {
    /* ignore */
  }
}

module.exports = { logError, errorLogFilePath, getLogDir, logServerStart };
