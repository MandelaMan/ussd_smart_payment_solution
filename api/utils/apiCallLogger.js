const { insertApiCallLog } = require("../services/apiCallLogStore");

/**
 * Persist an outbound API call attempt for the admin Logs module.
 */
async function logApiCall(entry) {
  try {
    return await insertApiCallLog(entry);
  } catch (e) {
    console.error("api call log failed:", e.message);
    return null;
  }
}

module.exports = { logApiCall };
