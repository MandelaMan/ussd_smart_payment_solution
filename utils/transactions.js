// utils/transactions.js
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "transactions.json");

// --- tiny in-process write queue (prevents concurrent lost writes) ---
let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task); // ensure chain continues on error too
  return _queue;
}

// Atomic write: write to temp file then rename
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
    // Always return an array
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeTransactions(all) {
  // Keep for backward compatibility, but serialize + atomic
  await ensureLogFile();
  return withLock(async () => {
    // Re-read to merge in case someone else wrote between caller's read and now
    const current = await readTransactions();
    // If caller passed only their copy (potentially stale), prefer caller's `all`
    // but you can also choose to merge. Here we overwrite to match original semantics:
    await safeWriteJSON(LOG_FILE, all);
  });
}

// New: append atomically (use this instead of read+push+write at call sites)
async function appendTransaction(txn) {
  await ensureLogFile();
  return withLock(async () => {
    const all = await readTransactions();
    all.push({ ...txn });
    await safeWriteJSON(LOG_FILE, all);
  });
}

// New: update by CheckoutRequestID atomically; append if not found
async function upsertByCheckoutId(checkoutId, patch) {
  if (!checkoutId) return appendTransaction({ ...patch });
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

// Helper you already had
function mostRecentForPhone(all, phone) {
  const cleaned = (phone || "").replace(/^(\+|0)+/, "");
  const list = all.filter((t) => (t.PhoneNumber || "").endsWith(cleaned));
  return list.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
}

module.exports = {
  readTransactions,
  writeTransactions, // still available
  appendTransaction, // prefer this for "add a record"
  upsertByCheckoutId, // prefer this in the M-Pesa callback
  mostRecentForPhone,
};
