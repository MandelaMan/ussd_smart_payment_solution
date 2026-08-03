/**
 * Detect monthly customers who paid an earlier cycle then skipped a later one.
 * Uses raised Zoho invoices (and payments as supporting evidence).
 */

const {
  isExcludedZohoInvoiceStatus,
  isOverdueZohoInvoice,
} = require("./zohoInvoiceStatus");

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function invoiceDate(inv) {
  return parseDate(inv?.date || inv?.invoiceDate || inv?.invoice_date || inv?.dueDate);
}

function formatShortDate(value) {
  const d = value instanceof Date ? value : parseDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function formatKes(amount) {
  return `KES ${roundMoney(amount).toLocaleString("en-KE")}`;
}

function isActiveAccount(customer) {
  return String(customer?.status || customer?.accountStatus || "").toLowerCase() === "active";
}

function isMonthlyFrequency(customer) {
  return String(customer?.paymentFrequency || customer?.payment_frequency || "monthly")
    .toLowerCase() === "monthly";
}

function isOnActiveTrial(customer) {
  const enabled =
    customer?.trialPeriodEnabled === true ||
    customer?.trial_period_enabled === true ||
    customer?.trialPeriod === true;
  if (!enabled) return false;
  const ends = parseDate(customer?.trialEndsAt || customer?.trial_ends_at);
  if (!ends) return true;
  return ends.getTime() > Date.now();
}

function isSettledInvoice(inv) {
  if (!inv) return false;
  if (isExcludedZohoInvoiceStatus(inv.status)) return false;
  const status = String(inv.status || "").toLowerCase();
  if (status === "paid") return true;
  return roundMoney(inv.balanceDue ?? inv.balance ?? 0) <= 0.01;
}

/** Fully (or nearly fully) unpaid — not a small remainder after partial pay. */
function isFullyUnpaidInvoice(inv) {
  if (!inv || isExcludedZohoInvoiceStatus(inv.status)) return false;
  const total = roundMoney(inv.total ?? 0);
  const bal = roundMoney(inv.balanceDue ?? inv.balance ?? 0);
  if (bal <= 0.01) return false;
  if (total <= 0.01) return bal > 0.01;
  return bal >= total * 0.9;
}

function eligibleInvoices(invoices = []) {
  return (invoices || [])
    .filter((inv) => inv && !isExcludedZohoInvoiceStatus(inv.status))
    .filter((inv) => invoiceDate(inv))
    .slice()
    .sort((a, b) => invoiceDate(a) - invoiceDate(b));
}

function paymentCoversInvoiceWindow(payments, invoice, nextInvoiceDate) {
  const start = invoiceDate(invoice);
  if (!start) return false;
  const end = nextInvoiceDate
    ? new Date(nextInvoiceDate.getTime())
    : new Date(start.getTime() + 40 * 24 * 60 * 60 * 1000);
  // Allow a few days before invoice date (advance pay)
  const windowStart = new Date(start.getTime() - 5 * 24 * 60 * 60 * 1000);

  const expected = roundMoney(invoice.total ?? 0);
  let paid = 0;
  for (const p of payments || []) {
    const paidAt = parseDate(p.paidAt || p.payment_date || p.date);
    if (!paidAt) continue;
    if (paidAt < windowStart || paidAt > end) continue;
    paid += roundMoney(p.amount ?? 0);
  }
  if (expected <= 0) return paid > 0;
  return paid >= expected * 0.9;
}

/**
 * @returns {{
 *   skipped: boolean,
 *   code?: string,
 *   message?: string,
 *   skippedInvoice?: object,
 *   lastPaidInvoice?: object,
 *   unpaidBalance?: number,
 * }}
 */
function detectSkippedMonthlyPayment({
  customer = {},
  invoices = [],
  zohoPayments = [],
  mpesaPayments = [],
} = {}) {
  if (!isActiveAccount(customer)) return { skipped: false };
  if (!isMonthlyFrequency(customer)) return { skipped: false };
  if (isOnActiveTrial(customer)) return { skipped: false };

  const raised = eligibleInvoices(invoices);
  if (!raised.length) return { skipped: false };

  const payments = [...(zohoPayments || []), ...(mpesaPayments || [])];

  // Walk invoices oldest → newest and find unpaid overdue cycles after a settled one.
  let lastSettled = null;
  for (let i = 0; i < raised.length; i += 1) {
    const inv = raised[i];
    const nextDate = i + 1 < raised.length ? invoiceDate(raised[i + 1]) : null;

    if (isSettledInvoice(inv) || paymentCoversInvoiceWindow(payments, inv, nextDate)) {
      lastSettled = inv;
      continue;
    }

    // Need established payment history before calling it a "skip"
    if (!lastSettled) continue;

    // Partial payments are a different status — don't treat as a full skip
    if (!isFullyUnpaidInvoice(inv)) continue;

    // Only flag once the unpaid cycle is actually overdue (past due / Zoho overdue)
    if (!isOverdueZohoInvoice(inv)) continue;

    const unpaidBalance = roundMoney(inv.balanceDue ?? inv.balance ?? 0);
    const skippedLabel = inv.invoiceNumber || inv.id || "invoice";
    const paidLabel = lastSettled.invoiceNumber || lastSettled.id || "prior invoice";
    const skippedWhen = formatShortDate(invoiceDate(inv));
    const paidWhen = formatShortDate(invoiceDate(lastSettled));

    return {
      skipped: true,
      code: "skipped_monthly_cycle",
      skippedInvoice: inv,
      lastPaidInvoice: lastSettled,
      unpaidBalance,
      message:
        `Paid ${paidLabel}${paidWhen ? ` (${paidWhen})` : ""} then skipped ` +
        `${skippedLabel}${skippedWhen ? ` (${skippedWhen})` : ""} — ` +
        `${formatKes(unpaidBalance)} still unpaid`,
    };
  }

  // Secondary: settled history exists, latest raised invoice is overdue & unpaid,
  // and no payment landed in the latest cycle window.
  const latest = raised[raised.length - 1];
  let priorSettled = null;
  for (let i = raised.length - 2; i >= 0; i -= 1) {
    if (isSettledInvoice(raised[i])) {
      priorSettled = raised[i];
      break;
    }
  }

  if (
    priorSettled &&
    isFullyUnpaidInvoice(latest) &&
    isOverdueZohoInvoice(latest) &&
    !paymentCoversInvoiceWindow(payments, latest, null)
  ) {
    const unpaidBalance = roundMoney(latest.balanceDue ?? latest.balance ?? 0);
    return {
      skipped: true,
      code: "skipped_latest_monthly_cycle",
      skippedInvoice: latest,
      lastPaidInvoice: priorSettled,
      unpaidBalance,
      message:
        `Monthly customer paid earlier cycle then left ` +
        `${latest.invoiceNumber || latest.id} unpaid (${formatKes(unpaidBalance)})`,
    };
  }

  return { skipped: false };
}

module.exports = {
  detectSkippedMonthlyPayment,
  isSettledInvoice,
  isFullyUnpaidInvoice,
  eligibleInvoices,
};
