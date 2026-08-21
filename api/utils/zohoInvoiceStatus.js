const { filterZohoInvoicesForContact } = require("./zohoCustomerScope");

function normalizeZohoInvoiceStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isExcludedZohoInvoiceStatus(status) {
  const normalized = normalizeZohoInvoiceStatus(status);
  return normalized === "draft" || normalized.includes("void");
}

/**
 * Overdue = positive balance, past due date (or Zoho "overdue" status).
 * Excludes draft and voided invoices.
 */
function isOverdueZohoInvoice(invoice) {
  if (!invoice) return false;
  if (isExcludedZohoInvoiceStatus(invoice.status)) return false;

  const balance = Number(invoice.balanceDue ?? invoice.balance ?? 0);
  if (!Number.isFinite(balance) || balance <= 0) return false;

  const status = normalizeZohoInvoiceStatus(invoice.status);
  if (status.includes("overdue")) return true;

  const dueDate = invoice.dueDate ?? invoice.due_date;
  if (dueDate) {
    const due = new Date(dueDate);
    if (!Number.isNaN(due.getTime()) && due < new Date()) return true;
  }

  return false;
}

function summarizeOverdueZohoInvoices(invoices) {
  const overdue = (invoices || []).filter(isOverdueZohoInvoice);
  return {
    overdueInvoices: overdue,
    overdueCount: overdue.length,
    totalOverdueBalance: overdue.reduce(
      (sum, inv) => sum + (Number(inv.balanceDue ?? inv.balance) || 0),
      0
    ),
  };
}

/**
 * Overdue invoices that belong to this Zoho contact (and, for B2B, this
 * customer number only) — candidates to void when a subscription is cancelled.
 */
function selectOverdueZohoInvoicesToVoid(invoices, contactId, customer = null) {
  if (!contactId) return [];
  return filterZohoInvoicesForContact(invoices, contactId, customer).filter(
    isOverdueZohoInvoice
  );
}

module.exports = {
  normalizeZohoInvoiceStatus,
  isExcludedZohoInvoiceStatus,
  isOverdueZohoInvoice,
  summarizeOverdueZohoInvoices,
  selectOverdueZohoInvoicesToVoid,
};
