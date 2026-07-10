const {
  getCustomerByCompanyName_JS,
  getInvoices_JS,
  getCustomerPayments_JS,
  getRecurringInvoices_JS,
} = require("../../controllers/zoho.controller");
const { syncLog } = require("../../lib/structuredLogger");
const { getZohoContactLookupKeys } = require("../../utils/b2bBilling");

/**
 * Zoho Books billing external API service.
 */
async function findContact(customer, options = {}) {
  const { correlationId } = options;
  const lookupKeys = getZohoContactLookupKeys(customer);
  for (const key of lookupKeys) {
    try {
      const result = await getCustomerByCompanyName_JS(key);
      if (result?.contact_id) return result;
    } catch (err) {
      syncLog.warn("zoho_contact_lookup_failed", {
        integration: "invoices",
        key,
        correlationId,
        error: err.message,
      });
    }
  }
  return null;
}

async function fetchInvoices(contactId, options = {}) {
  const { page = 1, perPage = 50, correlationId } = options;
  try {
    const invoices = await getInvoices_JS({
      customer_id: contactId,
      page,
      per_page: perPage,
    });
    return { ok: true, invoices: invoices || [] };
  } catch (err) {
    syncLog.error("zoho_invoices_fetch_failed", {
      integration: "invoices",
      contactId,
      correlationId,
      error: err,
    });
    return { ok: false, error: err.message, invoices: [] };
  }
}

async function fetchPayments(contactId, options = {}) {
  const { correlationId } = options;
  try {
    const payments = await getCustomerPayments_JS({ customer_id: contactId });
    return { ok: true, payments: payments || [] };
  } catch (err) {
    syncLog.error("zoho_payments_fetch_failed", {
      integration: "invoices",
      contactId,
      correlationId,
      error: err,
    });
    return { ok: false, error: err.message, payments: [] };
  }
}

async function fetchRecurringInvoices(contactId, options = {}) {
  const { correlationId } = options;
  try {
    const recurring = await getRecurringInvoices_JS({ customer_id: contactId });
    return { ok: true, recurring: recurring || [] };
  } catch (err) {
    syncLog.error("zoho_recurring_fetch_failed", {
      integration: "invoices",
      contactId,
      correlationId,
      error: err,
    });
    return { ok: false, error: err.message, recurring: [] };
  }
}

module.exports = {
  findContact,
  fetchInvoices,
  fetchPayments,
  fetchRecurringInvoices,
};
