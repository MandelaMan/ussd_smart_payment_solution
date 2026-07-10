const moment = require("moment-timezone");
const { DEFAULT_TZ } = require("./billingPeriod");

/**
 * Map internal payment frequency to Zoho Books recurring invoice fields.
 */
function mapPaymentFrequencyToRecurrence(paymentFrequency, customPeriodDays) {
  switch (paymentFrequency) {
    case "quarterly":
      return { recurrence_frequency: "months", repeat_every: 3 };
    case "yearly":
      return { recurrence_frequency: "years", repeat_every: 1 };
    case "custom": {
      const days = Number(customPeriodDays);
      return {
        recurrence_frequency: "days",
        repeat_every: days > 0 ? days : 30,
      };
    }
    case "monthly":
    default:
      return { recurrence_frequency: "months", repeat_every: 1 };
  }
}

/** Next billing cycle start (after the current/signup period). */
function computeRecurringStartDate({
  paymentFrequency,
  customPeriodDays,
  anchorDate = new Date(),
  timeZone = DEFAULT_TZ,
} = {}) {
  const start = moment.tz(anchorDate, timeZone).startOf("day");
  switch (paymentFrequency) {
    case "quarterly":
      return start.add(3, "months").format("YYYY-MM-DD");
    case "yearly":
      return start.add(1, "year").format("YYYY-MM-DD");
    case "custom": {
      const days = Number(customPeriodDays);
      return start.add(days > 0 ? days : 30, "days").format("YYYY-MM-DD");
    }
    case "monthly":
    default:
      return start.add(1, "month").format("YYYY-MM-DD");
  }
}

function recurrenceMatches(existing, expected) {
  if (!existing) return false;
  const freq = String(
    existing.recurrence_frequency || existing.repeat_unit || "",
  ).toLowerCase();
  const every = Number(existing.repeat_every || 1);
  return (
    freq === expected.recurrence_frequency &&
    every === expected.repeat_every
  );
}

module.exports = {
  mapPaymentFrequencyToRecurrence,
  computeRecurringStartDate,
  recurrenceMatches,
};
