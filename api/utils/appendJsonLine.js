"use strict";
const fs = require("fs/promises");
const path = require("path");

const locks = new Map();

function withLock(filePath, fn) {
  const prev = locks.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(filePath, next);
  next.finally(() => {
    if (locks.get(filePath) === next) locks.delete(filePath);
  });
  return next;
}

/**
 * Append one JSON object as a single line (NDJSON). Never truncates the file.
 * @param {string} absPath
 * @param {Record<string, unknown>} obj
 */
async function appendJsonLine(absPath, obj) {
  const p = path.resolve(absPath);
  const line = JSON.stringify(obj) + "\n";
  await fs.mkdir(path.dirname(p), { recursive: true });
  return withLock(p, () => fs.appendFile(p, line, "utf8"));
}

/**
 * Read all valid JSON lines from a file. Ignores blank lines and malformed lines.
 * @param {string} absPath
 */
async function readJsonLineEntries(absPath) {
  const p = path.resolve(absPath);
  try {
    const raw = await fs.readFile(p, "utf8");
    if (!raw.trim()) return [];
    const out = [];
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        out.push(JSON.parse(s));
      } catch {
        /* skip */
      }
    }
    return out;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

module.exports = { appendJsonLine, readJsonLineEntries, withLock };
