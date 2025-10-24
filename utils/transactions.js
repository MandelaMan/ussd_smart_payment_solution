// src/utils/transactions.js
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "transactions.json");

async function ensureLogFile() {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  try {
    await fs.promises.access(LOG_FILE, fs.constants.F_OK);
  } catch (_) {
    await fs.promises.writeFile(LOG_FILE, "[]", "utf8");
  }
}

async function readTransactions() {
  await ensureLogFile();
  const content = await fs.promises.readFile(LOG_FILE, "utf8");
  try {
    return JSON.parse(content || "[]");
  } catch {
    return [];
  }
}

async function writeTransactions(all) {
  await ensureLogFile();
  await fs.promises.writeFile(LOG_FILE, JSON.stringify(all, null, 2), "utf8");
}

function mostRecentForPhone(all, phone) {
  const cleaned = (phone || "").replace(/^(\+|0)+/, "");
  const list = all.filter((t) => (t.PhoneNumber || "").endsWith(cleaned));
  return list.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
}

module.exports = {
  LOG_FILE,
  readTransactions,
  writeTransactions,
  mostRecentForPhone,
};
