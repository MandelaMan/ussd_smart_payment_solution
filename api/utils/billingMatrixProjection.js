/**
 * Cadence helpers for the customer × month billing matrix.
 * Dates are projected both forward and back from a Zoho next-invoice
 * (or last-invoice) anchor so already-billed months still count as expected.
 */

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function daysInMonth(year, monthNum) {
  return new Date(Number(year), Number(monthNum), 0).getDate();
}

function recurringMonthStep(frequency, customPeriodDays) {
  const freq = String(frequency || "monthly").toLowerCase();
  if (freq === "quarterly") return 3;
  if (freq === "yearly") return 12;
  if (freq === "custom") {
    const days = Math.max(Number(customPeriodDays) || 30, 1);
    return Math.max(1, Math.round(days / 30));
  }
  return 1;
}

function shiftYearMonth(year, month, step) {
  let y = Number(year);
  let m = Number(month) + Number(step);
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
}

function dateInMonth(year, month, dayOfMonth) {
  const dim = daysInMonth(year, month);
  const d = Math.min(Number(dayOfMonth) || 1, dim);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Project recurring invoice dates across a year month span.
 * Walks forward and backward from the anchor (next_invoice_date or last invoice).
 * @param {string} notBefore YYYY-MM-DD — do not emit dates before this (usually first of last-invoice month)
 * @returns {Map<string, string>} month key "MM" → YYYY-MM-DD
 */
function projectRecurringDatesInSpan(
  nextInvoiceDate,
  year,
  monthFrom,
  monthTo,
  frequency,
  customPeriodDays,
  { notBefore = "" } = {}
) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const start = dateOnly(nextInvoiceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return out;

  const step = recurringMonthStep(frequency, customPeriodDays);
  const periodStart = `${year}-${String(monthFrom).padStart(2, "0")}-01`;
  const periodEnd = `${year}-${String(monthTo).padStart(2, "0")}-${String(
    daysInMonth(year, monthTo)
  ).padStart(2, "0")}`;
  const floor = dateOnly(notBefore);

  const record = (y, m) => {
    const dateStr = dateInMonth(y, m, Number(start.slice(8, 10)));
    if (floor && dateStr < floor) return;
    if (dateStr > periodEnd || dateStr < periodStart) return;
    if (y === Number(year) && m >= monthFrom && m <= monthTo) {
      const mm = String(m).padStart(2, "0");
      if (!out.has(mm)) out.set(mm, dateStr);
    }
  };

  const startY = Number(start.slice(0, 4));
  const startM = Number(start.slice(5, 7));
  const dayOfMonth = Number(start.slice(8, 10));

  let y = startY;
  let m = startM;
  let guard = 0;
  while (guard < 240) {
    const dateStr = dateInMonth(y, m, dayOfMonth);
    if (floor && dateStr < floor) break;
    if (dateStr < periodStart) break;
    record(y, m);
    const prev = shiftYearMonth(y, m, -step);
    y = prev.year;
    m = prev.month;
    guard += 1;
  }

  y = startY;
  m = startM;
  guard = 0;
  while (guard < 240) {
    const dateStr = dateInMonth(y, m, dayOfMonth);
    if (dateStr > periodEnd) break;
    record(y, m);
    const next = shiftYearMonth(y, m, step);
    y = next.year;
    m = next.month;
    guard += 1;
  }

  return out;
}

module.exports = {
  dateOnly,
  daysInMonth,
  recurringMonthStep,
  shiftYearMonth,
  projectRecurringDatesInSpan,
};
