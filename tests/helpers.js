/**
 * Shared helpers for process-flow unit tests (node:test).
 */
const assert = require("node:assert/strict");

function daysFromNow(days, base = new Date("2026-08-12T12:00:00+03:00")) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertOutcome(actual, expectedOutcome, extras = {}) {
  assert.equal(actual.outcome, expectedOutcome);
  for (const [key, value] of Object.entries(extras)) {
    assert.equal(actual[key], value, `${key} mismatch`);
  }
}

module.exports = {
  assert,
  daysFromNow,
  assertOutcome,
};
