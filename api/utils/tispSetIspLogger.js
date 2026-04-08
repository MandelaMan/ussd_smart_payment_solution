const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "tisp-set-isp-payment.json");

let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

/**
 * Append one SetISPPayment attempt (success or failure) to logs/tisp-set-isp-payment.json
 * @param {Record<string, unknown>} entry — must include outcome: "success" | "failure" | "skipped_duplicate"
 */
function logSetIspPaymentAttempt(entry) {
  return withLock(async () => {
    await fs.promises.mkdir(LOG_DIR, { recursive: true });
    let all = [];
    try {
      const raw = await fs.promises.readFile(LOG_FILE, "utf8");
      const parsed = JSON.parse(raw || "[]");
      all = Array.isArray(parsed) ? parsed : [];
    } catch {
      all = [];
    }
    all.push({
      loggedAt: new Date().toISOString(),
      ...entry,
    });
    const tmp = LOG_FILE + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await fs.promises.rename(tmp, LOG_FILE);
  });
}

module.exports = { logSetIspPaymentAttempt, LOG_FILE };
