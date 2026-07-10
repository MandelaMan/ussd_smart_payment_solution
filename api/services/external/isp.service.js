const { getTISPCustomer } = require("../../controllers/tisp.controller");
const { requestWithRetry } = require("../../lib/httpClient");
const { syncLog } = require("../../lib/structuredLogger");
const { normalizeSubscriptionStatus } = require("../../utils/subscriptionStatus");

/**
 * ISP (TISP) external API service.
 */
async function fetchCustomerStatus(customerNumber, options = {}) {
  const { correlationId, timeoutMs } = options;
  try {
    const result = await getTISPCustomer(customerNumber, { timeoutMs });
    return {
      ok: true,
      status: normalizeSubscriptionStatus(result?.status || result?.subscriptionStatus),
      raw: result,
    };
  } catch (err) {
    syncLog.error("tisp_fetch_failed", {
      integration: "customers",
      customerNumber,
      correlationId,
      error: err,
    });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  fetchCustomerStatus,
  requestWithRetry,
};
