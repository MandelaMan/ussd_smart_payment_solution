const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/** @typedef {'interactive' | 'background'} ZohoCallPriority */

/**
 * Run async work with a Zoho API priority context.
 * Interactive = user-initiated (uses reserved budget).
 * Background = scheduled workers (stops before reserve is consumed).
 */
function runWithZohoPriority(priority, fn) {
  return storage.run({ priority }, fn);
}

function getZohoCallPriority() {
  return storage.getStore()?.priority || "interactive";
}

module.exports = {
  runWithZohoPriority,
  getZohoCallPriority,
};
