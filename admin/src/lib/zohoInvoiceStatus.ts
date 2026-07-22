import type { ZohoInvoice } from "./api";

function normalizeZohoInvoiceStatus(status: string | null | undefined) {
  return String(status || "").trim().toLowerCase();
}

function isExcludedZohoInvoiceStatus(status: string | null | undefined) {
  const normalized = normalizeZohoInvoiceStatus(status);
  return normalized === "draft" || normalized.includes("void");
}

/** Overdue only — excludes draft and voided invoices. */
export function isOverdueZohoInvoice(invoice: ZohoInvoice | null | undefined) {
  if (!invoice) return false;
  if (isExcludedZohoInvoiceStatus(invoice.status)) return false;

  const balance = Number(invoice.balanceDue ?? 0);
  if (!Number.isFinite(balance) || balance <= 0) return false;

  const status = normalizeZohoInvoiceStatus(invoice.status);
  if (status.includes("overdue")) return true;

  if (invoice.dueDate) {
    const due = new Date(invoice.dueDate);
    if (!Number.isNaN(due.getTime()) && due < new Date()) return true;
  }

  return false;
}

export function summarizeOverdueZohoInvoices(invoices: ZohoInvoice[]) {
  const overdue = invoices.filter(isOverdueZohoInvoice);
  return {
    overdueCount: overdue.length,
    totalOverdueBalance: overdue.reduce(
      (sum, inv) => sum + (Number(inv.balanceDue) || 0),
      0
    ),
  };
}
