const moment = require("moment-timezone");
const { isB2BCustomer } = require("./b2bBilling");

const DEFAULT_TZ = process.env.TZ || "Africa/Nairobi";

const INVOICE_DUE_DAYS = { c2b: 7, b2b: 30 };
const TRIAL_PERIOD_DAYS = 30;

const FREQUENCY_LABELS = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  custom: "Custom",
};

function billingFrequencyLabel(paymentFrequency, customPeriodDays) {
  if (paymentFrequency === "custom") {
    const days = Number(customPeriodDays);
    return days > 0 ? `Custom (${days} days)` : "Custom";
  }
  return FREQUENCY_LABELS[paymentFrequency] || "Monthly";
}

/**
 * Billing window anchored at start-of-day in local TZ.
 * Monthly billing is calendar month-to-month (e.g. 07 Jul → 07 Aug).
 */
function computeBillingPeriod({
  anchorDate = new Date(),
  paymentFrequency = "monthly",
  customPeriodDays = null,
  timeZone = DEFAULT_TZ,
} = {}) {
  const start = moment.tz(anchorDate, timeZone).startOf("day");
  let end;

  switch (paymentFrequency) {
    case "quarterly":
      end = start.clone().add(3, "months");
      break;
    case "yearly":
      end = start.clone().add(1, "year");
      break;
    case "custom": {
      const days = Number(customPeriodDays);
      end = start.clone().add(days > 0 ? days : 30, "days");
      break;
    }
    case "monthly":
    default:
      end = start.clone().add(1, "month");
      break;
  }

  const periodDays = Math.max(1, end.diff(start, "days"));

  return {
    startDate: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD"),
    startLabel: start.format("DD MMM YYYY"),
    endLabel: end.format("DD MMM YYYY"),
    periodDays,
    frequencyLabel: billingFrequencyLabel(paymentFrequency, customPeriodDays),
  };
}

/** Payment terms: 7 days for C2B, 30 days for B2B. */
function computeInvoiceDueDate(customer, anchorDate = new Date(), timeZone = DEFAULT_TZ) {
  const days = isB2BCustomer(customer) ? INVOICE_DUE_DAYS.b2b : INVOICE_DUE_DAYS.c2b;
  return moment.tz(anchorDate, timeZone).startOf("day").add(days, "days").format("YYYY-MM-DD");
}

/**
 * Zoho Books payment terms (Net 7 / Net 30) for invoice + recurring payloads.
 * Always pair with due_date from computeInvoiceDueDate when creating invoices.
 */
function resolveZohoPaymentTerms(customer) {
  const days = isB2BCustomer(customer) ? INVOICE_DUE_DAYS.b2b : INVOICE_DUE_DAYS.c2b;
  return {
    payment_terms: days,
    payment_terms_label: `Net ${days}`,
  };
}

function buildPackageLabel(customer) {
  const product = String(customer.productName || "").trim();
  const plan = String(customer.planName || "").trim();
  const categoryCode = customer.categoryCode || customer.category_code || "";
  const categoryName = customer.categoryName || customer.category_name || "";
  const { isDstvOnlyCategory, DSTV_ONLY_PRODUCT_NAME } = require("../services/packageCatalogStore");
  if (
    isDstvOnlyCategory(categoryCode) ||
    isDstvOnlyCategory(categoryName) ||
    isDstvOnlyCategory(product) ||
    String(product).toLowerCase() === "dstv only"
  ) {
    return DSTV_ONLY_PRODUCT_NAME;
  }
  const mbps = Number(customer.productMbps ?? customer.mbps ?? 0);
  const extraBandwidth = Number(customer.productExtraBandwidth ?? customer.extraBandwidth ?? 0);
  const totalBandwidth = mbps + (extraBandwidth > 0 ? extraBandwidth : 0);
  const speedSuffix =
    totalBandwidth > 0
      ? extraBandwidth > 0
        ? `${totalBandwidth} Mbps (${mbps} + ${extraBandwidth} extra bandwidth)`
        : `${totalBandwidth} Mbps`
      : "";
  if (product) {
    return speedSuffix ? `${product} — ${speedSuffix}` : product;
  }
  if (plan && speedSuffix) return `${plan} — ${speedSuffix}`;
  return customer.customerNumber || "Internet subscription";
}

function buildSubscriptionInvoiceDescription(_customer, period) {
  return `Billing cycle: ${period.startLabel} to ${period.endLabel}`;
}

/**
 * Zoho Books expands these placeholders when each recurring invoice is generated
 * (relative to that invoice's date). Use only on recurring profiles — not one-off invoices.
 * @see https://www.zoho.com/books/kb/invoices/add-date-recurring-invoice.html
 */
const ZOHO_RECURRING_DATE_START = "%(d)% %(m)% %(y)%";

function buildZohoRecurringEndDatePlaceholder(
  paymentFrequency = "monthly",
  customPeriodDays = null
) {
  switch (String(paymentFrequency || "monthly").toLowerCase()) {
    case "quarterly":
      return "%(d)% %(m+3)% %(y)%";
    case "yearly":
      return "%(d)% %(m)% %(y+1)%";
    case "custom": {
      const days = Number(customPeriodDays);
      const n = days > 0 ? days : 30;
      // Combined placeholder so day overflow rolls month/year with the period length.
      return `%(d+${n})(m)(y)%`;
    }
    case "monthly":
    default:
      return "%(d)% %(m+1)% %(y)%";
  }
}

/**
 * Dynamic line-item description for Zoho recurring invoices.
 * Renders as e.g. "Billing cycle: 5 Aug 2026 to 5 Sep 2026" on each generated invoice.
 */
function buildRecurringSubscriptionInvoiceDescription(
  paymentFrequency = "monthly",
  customPeriodDays = null
) {
  const end = buildZohoRecurringEndDatePlaceholder(
    paymentFrequency,
    customPeriodDays
  );
  return `Billing cycle: ${ZOHO_RECURRING_DATE_START} to ${end}`;
}

/** Trial ends at start-of-day, TRIAL_PERIOD_DAYS after anchor (default: today). */
function computeTrialEndDate(anchorDate = new Date(), timeZone = DEFAULT_TZ) {
  return moment
    .tz(anchorDate, timeZone)
    .startOf("day")
    .add(TRIAL_PERIOD_DAYS, "days")
    .format("YYYY-MM-DD");
}

/**
 * Service / TISP due date = payment (or signup) date + billing frequency period.
 * Quarterly → +3 months, yearly → +1 year, monthly → +1 month, custom → +N days.
 * TISP BillingCycle stays Monthly; only DueDate reflects the real period.
 */
function computeServiceDueDate({
  anchorDate = new Date(),
  paymentFrequency = "monthly",
  customPeriodDays = null,
  timeZone = DEFAULT_TZ,
} = {}) {
  return computeBillingPeriod({
    anchorDate,
    paymentFrequency,
    customPeriodDays,
    timeZone,
  }).endDate;
}

/** Zoho recurring profile starts this many days before the TISP/service due date. */
const RECURRING_LEAD_DAYS_BEFORE_DUE = 7;

function computeRecurringStartBeforeDue(
  dueDate,
  leadDays = RECURRING_LEAD_DAYS_BEFORE_DUE,
  timeZone = DEFAULT_TZ
) {
  if (!dueDate) return null;
  return moment
    .tz(dueDate, timeZone)
    .startOf("day")
    .subtract(Number(leadDays) > 0 ? Number(leadDays) : RECURRING_LEAD_DAYS_BEFORE_DUE, "days")
    .format("YYYY-MM-DD");
}

module.exports = {
  DEFAULT_TZ,
  INVOICE_DUE_DAYS,
  TRIAL_PERIOD_DAYS,
  RECURRING_LEAD_DAYS_BEFORE_DUE,
  billingFrequencyLabel,
  computeBillingPeriod,
  computeInvoiceDueDate,
  resolveZohoPaymentTerms,
  computeTrialEndDate,
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
  buildPackageLabel,
  buildSubscriptionInvoiceDescription,
  ZOHO_RECURRING_DATE_START,
  buildZohoRecurringEndDatePlaceholder,
  buildRecurringSubscriptionInvoiceDescription,
};
