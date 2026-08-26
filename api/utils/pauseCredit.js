const moment = require("moment-timezone");
const { DEFAULT_TZ, computeRecurringStartBeforeDue } = require("./billingPeriod");
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
  computePauseCredit,
  resolveStoredPauseCredit,
  nextRecurringStartAfterPause,
};
