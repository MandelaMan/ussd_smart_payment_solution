const fs = require("fs/promises");
const path = require("path");
const { appendJsonLine, readJsonLineEntries } = require("./appendJsonLine");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "tisp-set-isp-payment.jsonl");
const LEGACY_LOG_FILE = path.join(LOG_DIR, "tisp-set-isp-payment.json");

let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

let _legacyMigrated = false;
let _migratePromise = null;

async function migrateLegacyTispLogOnce() {
  if (_legacyMigrated) return;
  if (!_migratePromise) {
    _migratePromise = (async () => {
      try {
        const st = await fs.stat(LOG_FILE).catch(() => null);
        if (st && st.size > 0) return;
        const raw = await fs.readFile(LEGACY_LOG_FILE, "utf8");
        const parsed = JSON.parse(raw || "[]");
        const arr = Array.isArray(parsed) ? parsed : [];
        if (!arr.length) return;
        await fs.mkdir(LOG_DIR, { recursive: true });
        let blob = "";
        for (const row of arr) {
          blob += JSON.stringify(row) + "\n";
        }
        await fs.appendFile(LOG_FILE, blob, "utf8");
        await fs.rename(LEGACY_LOG_FILE, LEGACY_LOG_FILE + ".bak").catch(() => {});
      } catch {
        /* no legacy or parse error */
      } finally {
        _legacyMigrated = true;
      }
    })();
  }
  await _migratePromise;
}

/**
 * Append one SetISPPayment attempt (success or failure) to logs/tisp-set-isp-payment.jsonl
 * @param {Record<string, unknown>} entry — must include outcome: "success" | "failure" | "skipped_duplicate"
 */
function logSetIspPaymentAttempt(entry) {
  return withLock(async () => {
    await migrateLegacyTispLogOnce();
    await appendJsonLine(LOG_FILE, {
      loggedAt: new Date().toISOString(),
      ...entry,
    });
  });
}

/**
 * Full history (NDJSON + one-time migrated legacy array).
 */
async function readTispSetIspLog() {
  return withLock(async () => {
    await migrateLegacyTispLogOnce();
    const lines = await readJsonLineEntries(LOG_FILE);
    if (lines.length) return lines;
    try {
      const raw = await fs.readFile(LEGACY_LOG_FILE, "utf8");
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
}

module.exports = {
  logSetIspPaymentAttempt,
  readTispSetIspLog,
  LOG_FILE,
  LEGACY_LOG_FILE,
};
