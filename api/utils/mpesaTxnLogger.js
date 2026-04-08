const fs = require("fs");
const path = require("path");

function getLogDir() {
  const override = process.env.ERROR_LOG_DIR;
  if (override && String(override).trim()) {
    return path.resolve(String(override).trim());
  }
  return path.join(__dirname, "..", "..", "logs");
}

function successLogPath() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(getLogDir(), `mpesa-stk-success-${y}-${m}-${day}.log`);
}

function ensureLogDir() {
  fs.mkdirSync(getLogDir(), { recursive: true });
}

/**
 * Append one JSON line after a successful STK callback (before/after TISP post).
 * @param {Record<string, unknown>} entry
 */
function logSuccessfulStkCallback(entry) {
  try {
    ensureLogDir();
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      }) + "\n";
    fs.appendFileSync(successLogPath(), line, "utf8");
  } catch (e) {
    console.error("mpesaTxnLogger: failed writing success log:", e.message);
  }
}

module.exports = { logSuccessfulStkCallback };
