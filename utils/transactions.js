// utils/transactions.js
const fs = require("fs");
const path = require("path");
const {
  appendJsonLine,
  readJsonLineEntries,
} = require("../api/utils/appendJsonLine");

const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "transactions.json");
const TRAIL_FILE = path.join(LOG_DIR, "transactions-trail.jsonl");

let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

let _jsonTrailMigrated = false;

async function safeWriteJSON(filePath, data) {
  const tmpPath = filePath + ".tmp";
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

async function ensureLogDir() {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  try {
    await fs.promises.access(LOG_FILE);
  } catch {
    await fs.promises.writeFile(LOG_FILE, "[]", "utf8");
  }
}

function materializeTransactionsFromTrail(entries) {
  const byCheckout = new Map();
  const order = [];

  function touch(id, record) {
    const key = String(id || `anon-${order.length}`);
    if (!byCheckout.has(key)) order.push(key);
    byCheckout.set(key, { ...byCheckout.get(key), ...record });
  }

  for (const row of entries) {
    if (row.event === "append" && row.txn) {
      touch(row.txn.CheckoutRequestID, row.txn);
    } else if (row.event === "upsert" && row.checkoutId) {
      touch(row.checkoutId, row.patch || {});
    }
  }

  return order.map((id) => byCheckout.get(id));
}

let _migratePromise = null;

async function migrateJsonSnapshotToTrailOnce() {
  if (_jsonTrailMigrated) return;
  if (!_migratePromise) {
    _migratePromise = (async () => {
      try {
        const trail = await readJsonLineEntries(TRAIL_FILE);
        if (trail.length > 0) return;

        let json = [];
        try {
          const raw = await fs.promises.readFile(LOG_FILE, "utf8");
          const parsed = JSON.parse(raw || "[]");
          if (Array.isArray(parsed)) json = parsed;
        } catch {
          return;
        }
        if (!json.length) return;

        let blob = "";
        for (const txn of json) {
          blob +=
            JSON.stringify({
              event: "append",
              loggedAt: txn.Timestamp || new Date().toISOString(),
              txn,
              migrated: true,
            }) + "\n";
        }
        await fs.promises.appendFile(TRAIL_FILE, blob, "utf8");
      } finally {
        _jsonTrailMigrated = true;
      }
    })();
  }
  await _migratePromise;
}

async function persistFromTrail() {
  const all = materializeTransactionsFromTrail(
    await readJsonLineEntries(TRAIL_FILE)
  );
  await safeWriteJSON(LOG_FILE, all);
  return all;
}

async function readTransactions() {
  await ensureLogDir();
  await migrateJsonSnapshotToTrailOnce();

  const trail = await readJsonLineEntries(TRAIL_FILE);
  if (trail.length > 0) {
    return materializeTransactionsFromTrail(trail);
  }

  try {
    const data = await fs.promises.readFile(LOG_FILE, "utf8");
    const parsed = JSON.parse(data || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeTransactions(all) {
  await ensureLogDir();
  return withLock(async () => {
    await safeWriteJSON(LOG_FILE, Array.isArray(all) ? all : []);
  });
}

async function appendTransaction(txn) {
  await ensureLogDir();
  return withLock(async () => {
    await migrateJsonSnapshotToTrailOnce();
    await appendJsonLine(TRAIL_FILE, {
      event: "append",
      loggedAt: new Date().toISOString(),
      txn: { ...txn },
    });
    return persistFromTrail();
  });
}

async function upsertByCheckoutId(checkoutId, patch) {
  await ensureLogDir();
  return withLock(async () => {
    await migrateJsonSnapshotToTrailOnce();
    await appendJsonLine(TRAIL_FILE, {
      event: "upsert",
      loggedAt: new Date().toISOString(),
      checkoutId,
      patch: { ...patch },
    });
    return persistFromTrail();
  });
}

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
  readTransactions,
  writeTransactions,
  appendTransaction,
  upsertByCheckoutId,
  materializeTransactionsFromTrail,
  mostRecentForPhone,
  findLatestTxnByCheckoutOrPhone,
  normalizePhone,
  LOG_FILE,
  TRAIL_FILE,
};
