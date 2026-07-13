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
    const rawStatus = result?.status ?? result?.Status ?? result?.subscriptionStatus ?? null;
    return {
      ok: true,
      status: rawStatus ? normalizeSubscriptionStatus(String(rawStatus)) : null,
      raw: result,
    };
  } catch (err) {
    const shortError = String(err?.message || "TISP lookup failed")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    syncLog.error("tisp_fetch_failed", {
      integration: "customers",
      customerNumber,
      correlationId,
      error: shortError,
    });
    return { ok: false, error: shortError };
  }
}

module.exports = {
  fetchCustomerStatus,
  requestWithRetry,
};
