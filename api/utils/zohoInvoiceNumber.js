const customerStore = require("../services/customerModuleStore");

/**
 * Build a Zoho invoice number prefixed with the customer reference.
 * Zoho Books only allows alphabets and numbers (no hyphens).
 * Format: ET444INV00345 — customer ref + INV + 5-digit sequence per customer.
 */
function getBuildingCode(ctx, customerType) {
  const type = customerType || ctx?.customer_type;
  if (type === "B2B") return String(ctx?.b2b_code || "").trim().toUpperCase();
  return String(ctx?.c2b_code || "").trim().toUpperCase();
}

function sanitizeZohoInvoiceToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function buildCustomerInvoicePrefix({ customerNumber, buildingCode } = {}) {
  const code = sanitizeZohoInvoiceToken(buildingCode);
  const ref = sanitizeZohoInvoiceToken(customerNumber);
  const base = ref || code;
  if (code && base && !base.startsWith(code) && base !== code) {
    return `${code}${base}`;
  }
  return base;
}

async function buildZohoInvoiceNumber({
  customerId,
  customerNumber,
  buildingCode,
} = {}) {
  if (!customerId) {
    throw new Error("customerId is required to allocate a Zoho invoice number");
  }

  const prefix = buildCustomerInvoicePrefix({ customerNumber, buildingCode });
  const seq = await customerStore.allocateZohoInvoiceSequence(customerId, prefix);
  return `${prefix}INV${String(seq).padStart(5, "0")}`.slice(0, 100);
}

module.exports = {
  getBuildingCode,
  buildCustomerInvoicePrefix,
  buildZohoInvoiceNumber,
};
