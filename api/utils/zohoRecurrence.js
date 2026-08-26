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

const CANONICAL_UNITS = new Set(["days", "weeks", "months", "years"]);

/**
 * Normalize Zoho frequency values ("month", "months", "Every 3 Months")
 * to canonical units used on create: days | weeks | months | years.
 */
function normalizeRecurrenceFrequency(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (CANONICAL_UNITS.has(s)) return s;
  if (s === "day" || s === "week" || s === "month" || s === "year") {
    return `${s}s`;
  }
  if (s.includes("year")) return "years";
  if (s.includes("month")) return "months";
  if (s.includes("week")) return "weeks";
  if (s.includes("day")) return "days";
  return null;
}

function parseRepeatEvery(existing) {
  if (existing?.repeat_every != null && existing.repeat_every !== "") {
    const n = Number(existing.repeat_every);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const display = String(
    existing?.frequency || existing?.recurrence_frequency || existing?.repeat_unit || "",
  );
  const everyMatch = display.match(/every\s+(\d+)/i);
  if (everyMatch) return Number(everyMatch[1]);
  if (/^(monthly|yearly|weekly|daily)$/i.test(display.trim())) return 1;
  return null;
}

/**
 * Whether an existing Zoho profile already uses the expected cadence.
 * Zoho's list endpoint omits recurrence_frequency / repeat_every — missing
 * fields must NOT be treated as a mismatch (that recreates the profile).
 * Only return false when we can positively confirm a different cadence.
 */
function recurrenceMatches(existing, expected) {
  if (!existing || !expected) return true;
  const freq = normalizeRecurrenceFrequency(
    existing.recurrence_frequency || existing.repeat_unit || existing.frequency,
  );
  if (!freq) return true;
  if (freq !== expected.recurrence_frequency) return false;

  const every = parseRepeatEvery(existing);
  if (every == null) return true;
  return every === Number(expected.repeat_every);
}

function isActiveRecurring(recurring) {
  const status = String(
    recurring?.status || recurring?.recurrence_status || "active",
  ).toLowerCase();
  return !["stopped", "expired", "inactive"].includes(status);
}

function selectRecurringProfileToUpdate(profiles = []) {
  const list = Array.isArray(profiles) ? profiles : [];
  const active = list.filter(isActiveRecurring);
  if (active.length) {
    return { existing: active[0], extraActives: active.slice(1) };
  }
  return { existing: list[0] || null, extraActives: [] };
}

module.exports = {
  mapPaymentFrequencyToRecurrence,
  computeRecurringStartDate,
  normalizeRecurrenceFrequency,
  recurrenceMatches,
  isActiveRecurring,
  selectRecurringProfileToUpdate,
};
