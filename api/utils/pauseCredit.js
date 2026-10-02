const moment = require("moment-timezone");
const {
  DEFAULT_TZ,
  computeBillingPeriod,
  computeRecurringStartBeforeDue,
} = require("./billingPeriod");
const { formatDateOnly } = require("./lastPaymentDate");

function parseDay(value, timeZone = DEFAULT_TZ) {
  const date = formatDateOnly(value);
  if (!date) return null;
  const m = moment.tz(date, timeZone).startOf("day");
  return m.isValid() ? m : null;
}

function addCalendarDays(date, days, timeZone = DEFAULT_TZ) {
  const m = parseDay(date, timeZone);
  if (!m) return null;
  const n = Number(days);
  if (!Number.isFinite(n) || n === 0) return m.format("YYYY-MM-DD");
  return m.clone().add(n, "days").format("YYYY-MM-DD");
}

function diffCalendarDays(from, to, timeZone = DEFAULT_TZ) {
  const start = parseDay(from, timeZone);
  const end = parseDay(to, timeZone);
  if (!start || !end) return null;
  return end.diff(start, "days");
}

function maxDateOnly(...values) {
  let best = null;
  for (const value of values) {
    const date = formatDateOnly(value);
    if (!date) continue;
    if (!best || date > best) best = date;
  }
  return best;
}

function normalizePauseFrequency(paymentFrequency) {
  const freq = String(paymentFrequency || "monthly").trim().toLowerCase();
  if (freq === "quarterly" || freq === "yearly" || freq === "custom") return freq;
  return "monthly";
}

/**
 * Max pause length by billing frequency:
 * monthly → 1 week, quarterly → 2 weeks, yearly → 1 month.
 * Custom follows the closest standard period.
 */
function pauseMaxDuration(paymentFrequency, customPeriodDays = null) {
  const freq = normalizePauseFrequency(paymentFrequency);
  if (freq === "yearly") {
    return { frequency: freq, unit: "months", amount: 1, label: "1 month" };
  }
  if (freq === "quarterly") {
    return { frequency: freq, unit: "weeks", amount: 2, label: "2 weeks" };
  }
  if (freq === "custom") {
    const days = Number(customPeriodDays);
    if (Number.isFinite(days) && days >= 360) {
      return { frequency: freq, unit: "months", amount: 1, label: "1 month" };
    }
    if (Number.isFinite(days) && days >= 80) {
      return { frequency: freq, unit: "weeks", amount: 2, label: "2 weeks" };
    }
  }
  return { frequency: freq, unit: "weeks", amount: 1, label: "1 week" };
}

function maxPauseEndDate(
  pauseStart,
  paymentFrequency,
  customPeriodDays = null,
  timeZone = DEFAULT_TZ
) {
  const start = parseDay(pauseStart, timeZone);
  if (!start) return null;
  const max = pauseMaxDuration(paymentFrequency, customPeriodDays);
  if (max.unit === "months") {
    return start.clone().add(max.amount, "months").format("YYYY-MM-DD");
  }
  return start.clone().add(max.amount, "weeks").format("YYYY-MM-DD");
}

/** Fixed day pool for the billing period (monthly = 7, quarterly = 14, yearly = 1 month). */
function pauseAllowanceDays(
  paymentFrequency,
  customPeriodDays = null,
  fromDate = null,
  timeZone = DEFAULT_TZ
) {
  const start =
    formatDateOnly(fromDate) ||
    moment.tz(timeZone).startOf("day").format("YYYY-MM-DD");
  const maxEnd = maxPauseEndDate(
    start,
    paymentFrequency,
    customPeriodDays,
    timeZone
  );
  return Math.max(0, diffCalendarDays(start, maxEnd, timeZone) || 0);
}

function minDateOnly(...values) {
  let best = null;
  for (const value of values) {
    const date = formatDateOnly(value);
    if (!date) continue;
    if (!best || date < best) best = date;
  }
  return best;
}

function remainingPauseEndDate(pauseStart, remainingDays, timeZone = DEFAULT_TZ) {
  const start = formatDateOnly(pauseStart);
  const days = Number(remainingDays);
  if (!start || !Number.isFinite(days) || days <= 0) return null;
  return addCalendarDays(start, days, timeZone);
}

function effectiveMaxPauseEndDate({
  pauseStart,
  paymentFrequency,
  customPeriodDays = null,
  remainingDays = null,
  timeZone = DEFAULT_TZ,
} = {}) {
  const freqCap = maxPauseEndDate(
    pauseStart,
    paymentFrequency,
    customPeriodDays,
    timeZone
  );
  if (remainingDays == null) return freqCap;
  if (Number(remainingDays) <= 0) return formatDateOnly(pauseStart);
  const remainCap = remainingPauseEndDate(pauseStart, remainingDays, timeZone);
  return minDateOnly(freqCap, remainCap);
}

function usedPauseDays(customer = {}) {
  const appliedAt =
    customer.pauseCreditAppliedAt || customer.pause_credit_applied_at || null;
  if (appliedAt) return 0;
  return Math.max(
    0,
    Number(customer.pauseCreditDays ?? customer.pause_credit_days ?? 0) || 0
  );
}

function resolvePauseBalance(customer = {}, options = {}) {
  const paymentFrequency =
    options.paymentFrequency ||
    customer.paymentFrequency ||
    customer.payment_frequency ||
    "monthly";
  const customPeriodDays =
    options.customPeriodDays ??
    customer.customPeriodDays ??
    customer.custom_period_days ??
    null;
  const fromDate =
    options.fromDate ||
    customer.lastPaymentDate ||
    customer.last_payment_date ||
    null;
  const allowance = pauseAllowanceDays(
    paymentFrequency,
    customPeriodDays,
    fromDate,
    options.timeZone
  );
  const used = usedPauseDays(customer);
  const remaining = Math.max(0, allowance - used);
  return {
    allowance,
    used,
    remaining,
    exhausted: allowance > 0 && remaining <= 0,
  };
}

function exhaustedPauseDaysMessage(balance = {}) {
  const used = Math.max(0, Number(balance.used) || 0);
  const allowance = Math.max(0, Number(balance.allowance) || 0);
  if (allowance > 0) {
    return `This customer has exhausted pause days (${used} of ${allowance} used this billing period)`;
  }
  return "This customer has exhausted pause days";
}

function pauseFrequencyLabel(paymentFrequency) {
  const freq = normalizePauseFrequency(paymentFrequency);
  if (freq === "yearly") return "yearly";
  if (freq === "quarterly") return "quarterly";
  if (freq === "custom") return "custom-period";
  return "monthly";
}

function assertPauseDurationAllowed({
  pauseStart,
  pauseEnd,
  paymentFrequency,
  customPeriodDays = null,
  remainingDays = null,
  timeZone = DEFAULT_TZ,
} = {}) {
  const start = formatDateOnly(pauseStart);
  const end = formatDateOnly(pauseEnd);
  const max = pauseMaxDuration(paymentFrequency, customPeriodDays);
  const remaining =
    remainingDays == null ? null : Math.max(0, Number(remainingDays) || 0);
  if (remaining === 0) {
    throw new Error("This customer has exhausted pause days");
  }
  const maxEnd = effectiveMaxPauseEndDate({
    pauseStart: start,
    paymentFrequency,
    customPeriodDays,
    remainingDays: remaining,
    timeZone,
  });
  if (!start || !end || !maxEnd) {
    throw new Error("Pause dates are invalid");
  }
  if (end <= start) {
    throw new Error("Pause end date must be after the start date");
  }
  const daysAway = Math.max(0, diffCalendarDays(start, end, timeZone) || 0);
  if (remaining != null && daysAway > remaining) {
    throw new Error(
      `Only ${remaining} pause day${remaining === 1 ? "" : "s"} remaining this billing period (return by ${maxEnd})`
    );
  }
  if (end > maxEnd) {
    if (remaining != null) {
      throw new Error(
        `Only ${remaining} pause day${remaining === 1 ? "" : "s"} remaining this billing period (return by ${maxEnd})`
      );
    }
    throw new Error(
      `This ${pauseFrequencyLabel(paymentFrequency)} customer can pause for ${max.label} only (return by ${maxEnd})`
    );
  }
  return { max, maxEnd, daysAway, remainingDays: remaining };
}

/** Unused pause days as a KES credit against the current package price. */
function computePauseCreditAmount({
  packagePrice,
  paymentFrequency,
  customPeriodDays = null,
  creditDays = 0,
} = {}) {
  const days = Math.max(0, Number(creditDays) || 0);
  const price = Number(packagePrice);
  if (!Number.isFinite(price) || price <= 0 || days <= 0) return 0;
  const period = computeBillingPeriod({
    paymentFrequency: normalizePauseFrequency(paymentFrequency),
    customPeriodDays,
  });
  return Math.round((price * days) / period.periodDays);
}

/**
 * Days the customer is away (return date exclusive) and the next-subscription
 * due date after those days are credited onto the current paid period.
 */
function computePauseCredit({
  pauseStart,
  pauseEnd,
  originalDueDate = null,
  timeZone = DEFAULT_TZ,
} = {}) {
  const start = formatDateOnly(pauseStart);
  const end = formatDateOnly(pauseEnd);
  const originalDue = formatDateOnly(originalDueDate);
  const daysAway = start && end ? Math.max(0, diffCalendarDays(start, end, timeZone) || 0) : 0;
  const creditedDueDate = originalDue
    ? addCalendarDays(originalDue, daysAway, timeZone)
    : end
      ? addCalendarDays(end, daysAway, timeZone)
      : null;

  return {
    daysAway,
    creditDays: daysAway,
    originalDueDate: originalDue,
    creditedDueDate,
  };
}

function resolveStoredPauseCredit(customer = {}) {
  const appliedAt = customer.pauseCreditAppliedAt || customer.pause_credit_applied_at || null;
  const storedDays = Number(
    customer.pauseCreditDays ?? customer.pause_credit_days ?? 0
  );
  const start = customer.pauseStartDate || customer.pause_start_date || null;
  const end = customer.pauseEndDate || customer.pause_end_date || null;
  const originalDue =
    customer.pauseOriginalDueDate ||
    customer.pause_original_due_date ||
    customer.tispDueDate ||
    customer.tisp_due_date ||
    null;
  const computed =
    storedDays > 0
      ? {
          daysAway: storedDays,
          creditDays: storedDays,
          originalDueDate: formatDateOnly(
            customer.pauseOriginalDueDate || customer.pause_original_due_date || originalDue
          ),
          creditedDueDate: formatDateOnly(
            customer.pauseCreditedDueDate || customer.pause_credited_due_date
          ),
        }
      : computePauseCredit({
          pauseStart: start,
          pauseEnd: end,
          originalDueDate: originalDue,
        });

  return {
    ...computed,
    applied: Boolean(appliedAt),
    appliedAt: appliedAt ? String(appliedAt) : null,
    pending: computed.creditDays > 0 && !appliedAt,
  };
}

function latestPauseLifecycleEvent(events) {
  for (const event of events || []) {
    const type = String(event?.eventType || event?.event_type || "").trim();
    if (type === "pause" || type === "resume") return event;
  }
  return null;
}

function isPauseResumeEvent(event) {
  const type = String(event?.eventType || event?.event_type || "");
  const notes = String(event?.notes || "");
  if (type === "resume") return true;
  return /resumed|restarted/i.test(notes);
}

/**
 * Status to write back when a TISP refresh cleared an open pause.
 * Returns "Paused", "Paused Indefinitely", or null.
 * An explicit resume/restart event keeps the account active.
 */
function pauseStatusToRestore(customer = {}, events = [], today = null) {
  if (!customer || customer.status === "cancelled") return null;
  const latest = latestPauseLifecycleEvent(events);
  if (latest && isPauseResumeEvent(latest)) return null;

  const indefinite =
    customer.pauseIndefinite === true || Number(customer.pause_indefinite) === 1;
  const status = String(
    customer.subscriptionStatus || customer.subscription_status || ""
  ).trim();
  const normalized = status.toLowerCase();

  if (indefinite) {
    return normalized.includes("indefinite") ? null : "Paused Indefinitely";
  }

  if (normalized.includes("pause")) return null;

  const start = formatDateOnly(customer.pauseStartDate || customer.pause_start_date);
  const end = formatDateOnly(customer.pauseEndDate || customer.pause_end_date);
  const applied = customer.pauseCreditAppliedAt || customer.pause_credit_applied_at;
  if (!start || !end || applied) return null;
  const day = formatDateOnly(today || new Date());
  if (!day || end < day) return null;
  if (!latest || String(latest.eventType || latest.event_type) !== "pause") return null;
  return "Paused";
}

function nextRecurringStartAfterPause({
  nextInvoiceDate,
  pauseEnd,
  creditDays = 0,
  creditedDueDate = null,
} = {}) {
  const creditedNext = nextInvoiceDate
    ? addCalendarDays(nextInvoiceDate, creditDays)
    : creditedDueDate
      ? computeRecurringStartBeforeDue(creditedDueDate)
      : null;
  return maxDateOnly(creditedNext, pauseEnd, nextInvoiceDate);
}

module.exports = {
  addCalendarDays,
  diffCalendarDays,
  maxDateOnly,
  minDateOnly,
  pauseMaxDuration,
  pauseAllowanceDays,
  maxPauseEndDate,
  remainingPauseEndDate,
  effectiveMaxPauseEndDate,
  usedPauseDays,
  resolvePauseBalance,
  exhaustedPauseDaysMessage,
  assertPauseDurationAllowed,
  computePauseCreditAmount,
  computePauseCredit,
  resolveStoredPauseCredit,
  pauseStatusToRestore,
  nextRecurringStartAfterPause,
};
