const path = require("path");
const { appendJsonLine } = require("./appendJsonLine");

const LOG_FILE = path.join(__dirname, "..", "..", "logs", "xtream-sync.jsonl");

function logXtreamSyncEvent(entry) {
  return appendJsonLine(LOG_FILE, {
    loggedAt: new Date().toISOString(),
    ...entry,
  });
}

module.exports = { logXtreamSyncEvent, LOG_FILE };
