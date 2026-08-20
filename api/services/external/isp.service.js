const { getTISPCustomer, isTispAccountMissingError } = require("../../controllers/tisp.controller");
const { requestWithRetry } = require("../../lib/httpClient");
const { syncLog } = require("../../lib/structuredLogger");
const { normalizeSubscriptionStatus } = require("../../utils/subscriptionStatus");
const { alternateTypeCustomerNumber } = require("../../utils/customerNumber");

/**
 * ISP (TISP) external API service.
 */
async function fetchCustomerStatus(customerNumber, options = {}) {
  const { correlationId, timeoutMs, alternateCustomerNumber } = options;
  const tryNumbers = [customerNumber, alternateCustomerNumber]
    .map((n) => String(n || "").trim().toUpperCase())
    .filter(Boolean)
    .filter((n, i, arr) => arr.indexOf(n) === i);

  let lastErr = null;
  for (const num of tryNumbers) {
    try {
      const result = await getTISPCustomer(num, { timeoutMs });
      const rawStatus = result?.status ?? result?.Status ?? result?.subscriptionStatus ?? null;
      return {
        ok: true,
        status: rawStatus ? normalizeSubscriptionStatus(String(rawStatus)) : null,
        raw: result,
      };
    } catch (err) {
      lastErr = err;
      if (!isTispAccountMissingError(err)) break;
    }
  }

  const shortError = String(lastErr?.message || "TISP lookup failed")
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

function alternateNumberForCustomer(customer) {
  if (!customer) return "";
  return alternateTypeCustomerNumber(
    {
      c2b_code: customer.c2bCode || customer.c2b_code,
      b2b_code: customer.b2bCode || customer.b2b_code,
      building_code: customer.buildingCode || customer.building_code,
    },
    customer.customerType || customer.customer_type,
    customer.apartmentNumber || customer.apartment_number,
    customer.premiseType || customer.premise_type
  );
}

module.exports = {
  fetchCustomerStatus,
  alternateNumberForCustomer,
  requestWithRetry,
};
