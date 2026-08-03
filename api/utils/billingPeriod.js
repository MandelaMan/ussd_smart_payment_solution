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

function buildPackageLabel(customer) {
  const product = String(customer.productName || "").trim();
  const plan = String(customer.planName || "").trim();
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
  computeTrialEndDate,
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
  buildPackageLabel,
  buildSubscriptionInvoiceDescription,
};
