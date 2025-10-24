// utils/transactions.js
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "transactions.json");

// ---- tiny in-process write queue to avoid concurrent clobbering ----
let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task); // keep the chain even if the prior task failed
  return _queue;
}

// Atomic write: temp file -> rename
async function safeWriteJSON(filePath, data) {
  const tmpPath = filePath + ".tmp";
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

async function ensureLogFile() {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  try {
    await fs.promises.access(LOG_FILE);
  } catch {
    await fs.promises.writeFile(LOG_FILE, "[]", "utf8");
  }
}

async function readTransactions() {
  await ensureLogFile();
  const data = await fs.promises.readFile(LOG_FILE, "utf8");
  try {
    const parsed = JSON.parse(data || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeTransactions(all) {
  await ensureLogFile();
  return withLock(async () => {
    await safeWriteJSON(LOG_FILE, all);
  });
}

async function appendTransaction(txn) {
  await ensureLogFile();
  return withLock(async () => {
    const all = await readTransactions();
    all.push({ ...txn });
    await safeWriteJSON(LOG_FILE, all);
  });
}

async function upsertByCheckoutId(checkoutId, patch) {
  await ensureLogFile();
  return withLock(async () => {
    const all = await readTransactions();
    const idx = all.findIndex((t) => t.CheckoutRequestID === checkoutId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...patch };
    } else {
      all.push({ ...patch });
    }
    await safeWriteJSON(LOG_FILE, all);
  });
}

// ----- convenience lookups used by USSD flow -----
const normalizePhone = (phone = "") => phone.replace(/^(\+|0)+/, "");

function mostRecentForPhone(all, phone) {
  const cleaned = normalizePhone(phone);
  const list = all.filter((t) => (t.PhoneNumber || "").endsWith(cleaned));
  return list.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
}

async function findLatestTxnByCheckoutOrPhone(checkoutId, phone) {
  const all = await readTransactions();
  if (checkoutId) {
    const hit = [...all]
      .reverse()
      .find((t) => t.CheckoutRequestID === checkoutId);
    if (hit) return hit;
  }
  const cleaned = normalizePhone(phone);
  return [...all]
    .reverse()
    .find((t) => String(t.PhoneNumber || "").endsWith(cleaned));
}

module.exports = {
  // IO
  readTransactions,
  writeTransactions,
  appendTransaction,
  upsertByCheckoutId,
  // helpers
  mostRecentForPhone,
  findLatestTxnByCheckoutOrPhone,
  normalizePhone,
};
