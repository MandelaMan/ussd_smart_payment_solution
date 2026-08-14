const { query } = require("../config/db");
const { computeRecurringStartDate } = require("../utils/zohoRecurrence");
const { unitWeight } = require("../utils/b2bDocumentAttribution");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthYearLabel(isoDate) {
  const d = dateOnly(isoDate);
  if (!d) return "";
  const month = Number(d.slice(5, 7));
  const year = d.slice(0, 4);
  if (month < 1 || month > 12) return "";
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Label the calendar months covered by a date window (e.g. "August–September 2026"). */
function windowMonthLabel(start, end) {
  const s = dateOnly(start);
  const e = dateOnly(end) || s;
  if (!s) return "";
  const sm = Number(s.slice(5, 7));
  const sy = s.slice(0, 4);
  const em = Number(e.slice(5, 7));
  const ey = e.slice(0, 4);
  if (sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTH_NAMES[sm - 1]}–${MONTH_NAMES[em - 1]} ${sy}`;
  return `${MONTH_NAMES[sm - 1]} ${sy}–${MONTH_NAMES[em - 1]} ${ey}`;
}

function addFrequency(dateStr, frequency, customPeriodDays) {
  return computeRecurringStartDate({
    paymentFrequency: frequency || "monthly",
    customPeriodDays,
    anchorDate: dateStr,
  });
}

/**
 * Walk a recurring cadence forward until it lands in [windowStart, windowEnd], or null.
 */
function firstOccurrenceInWindow(
  startDate,
  frequency,
  customPeriodDays,
  windowStart,
  windowEnd
) {
  let d = dateOnly(startDate);
  if (!d) return null;
  let guard = 0;
  while (d < windowStart && guard < 48) {
    const next = addFrequency(d, frequency, customPeriodDays);
    if (!next || next <= d) break;
    d = next;
    guard += 1;
  }
  if (d >= windowStart && d <= windowEnd) return d;
  return null;
}

function mapForecastRow(row, extras = {}) {
  const scheduledDate = dateOnly(row.scheduled_date);
  const customerType = String(row.customer_type || extras.customerType || "C2B").toUpperCase();
  const expectedAmount =
    extras.expectedAmount != null
      ? roundMoney(extras.expectedAmount)
      : roundMoney(row.package_price);
  return {
    customerId: Number(row.customer_id),
    customerNumber: row.customer_number,
    customerName: String(row.customer_name || "").trim(),
    buildingName: row.building_name || null,
    agencyName: row.agency_name || extras.agencyName || null,
    customerType,
    expectedAmount,
    paymentFrequency: row.payment_frequency || "monthly",
    scheduledDate,
    month: monthYearLabel(scheduledDate),
    source: row.source || extras.source,
  };
}

async function loadB2bForecastItems(windowStart, windowEnd) {
  const [houses, agencyRecurring, lastInvoices] = await Promise.all([
    query(
      `SELECT
         c.id AS customer_id,
         c.customer_number,
         CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         b.name AS building_name,
         a.name AS agency_name,
         c.agency_id,
         c.package_price,
         a.discount_percent,
         c.payment_frequency,
         c.custom_period_days,
         c.trial_period_enabled,
         c.trial_ends_at,
         c.customer_type
       FROM customers c
       LEFT JOIN buildings b ON b.id = c.building_id
       LEFT JOIN agencies a ON a.id = c.agency_id
       WHERE c.status = 'active'
         AND c.customer_type = 'B2B'
         AND COALESCE(c.package_price, 0) > 0
       ORDER BY c.customer_number ASC
       LIMIT 15000`
    ),
    query(
      `SELECT
         c.agency_id,
         MIN(zri.next_invoice_date) AS next_invoice_date
       FROM zoho_recurring_invoices zri
       INNER JOIN customers c ON c.id = zri.customer_id
       WHERE c.customer_type = 'B2B'
         AND c.agency_id IS NOT NULL
         AND LOWER(COALESCE(zri.status, '')) IN ('active', 'live')
         AND zri.next_invoice_date IS NOT NULL
       GROUP BY c.agency_id`
    ),
    query(
      `SELECT
         c.id AS customer_id,
         c.agency_id,
         MAX(zi.invoice_date) AS last_invoice_date
       FROM zoho_customer_invoices zi
       INNER JOIN customers c ON c.id = zi.customer_id
       WHERE c.customer_type = 'B2B'
         AND c.status = 'active'
         AND zi.invoice_date IS NOT NULL
         AND LOWER(TRIM(COALESCE(zi.status, ''))) <> 'draft'
         AND LOWER(TRIM(COALESCE(zi.status, ''))) NOT LIKE '%void%'
       GROUP BY c.id, c.agency_id`
    ),
  ]);

  /** @type {Map<number, string>} */
  const nextByAgency = new Map();
  for (const row of agencyRecurring) {
    const agencyId = Number(row.agency_id);
    const next = dateOnly(row.next_invoice_date);
    if (Number.isFinite(agencyId) && agencyId > 0 && next) {
      nextByAgency.set(agencyId, next);
    }
  }

  /** @type {Map<number, string>} */
  const lastByCustomer = new Map();
  /** @type {Map<number, string>} */
  const lastByAgency = new Map();
  for (const row of lastInvoices) {
    const customerId = Number(row.customer_id);
    const agencyId = Number(row.agency_id);
    const last = dateOnly(row.last_invoice_date);
    if (!last) continue;
    if (Number.isFinite(customerId) && customerId > 0) {
      lastByCustomer.set(customerId, last);
    }
    if (Number.isFinite(agencyId) && agencyId > 0) {
      const existing = lastByAgency.get(agencyId);
      if (!existing || last > existing) lastByAgency.set(agencyId, last);
    }
  }

  const items = [];
  for (const house of houses) {
    const customerId = Number(house.customer_id);
    const agencyId = Number(house.agency_id);
    const freq = house.payment_frequency || "monthly";
    const customDays = house.custom_period_days;
    const amount = unitWeight({
      package_price: house.package_price,
      discount_percent: house.discount_percent,
    });
    if (!(amount > 0)) continue;

    let scheduled = null;
    let source = "b2b";

    const agencyNext = Number.isFinite(agencyId) ? nextByAgency.get(agencyId) : null;
    if (agencyNext) {
      scheduled = firstOccurrenceInWindow(
        agencyNext,
        freq,
        customDays,
        windowStart,
        windowEnd
      );
      if (scheduled) source = "b2b_recurring";
    }

    if (!scheduled) {
      const last =
        lastByCustomer.get(customerId) ||
        (Number.isFinite(agencyId) ? lastByAgency.get(agencyId) : null);
      if (last) {
        const nextFromLast = addFrequency(last, freq, customDays);
        scheduled = firstOccurrenceInWindow(
          nextFromLast,
          freq,
          customDays,
          windowStart,
          windowEnd
        );
        if (scheduled) source = "b2b_cadence";
      }
    }

    if (!scheduled && Number(house.trial_period_enabled) === 1) {
      const trialEnd = dateOnly(house.trial_ends_at);
      if (trialEnd && trialEnd >= windowStart && trialEnd <= windowEnd) {
        scheduled = trialEnd;
        source = "trial";
      }
    }

    if (!scheduled) continue;

    items.push(
      mapForecastRow(
        {
          ...house,
          scheduled_date: scheduled,
          source,
        },
        { expectedAmount: amount, customerType: "B2B" }
      )
    );
  }

  return items;
}

/**
 * Invoices expected to go out in the next N days (Zoho recurring + trial first invoices + B2B houses).
 * Uses DB snapshots — scales with customer count via indexed date filters.
 */
async function getUpcomingInvoiceForecast({ days = 7, startDate } = {}) {
  const windowStart = startDate || ymdLocal();
  const windowEnd = addDaysIso(windowStart, days);

  const [recurringRows, trialRows, b2bItems] = await Promise.all([
    query(
      `SELECT
         c.id AS customer_id,
         c.customer_number,
         CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         b.name AS building_name,
         c.package_price,
         c.payment_frequency,
         c.customer_type,
         zri.next_invoice_date AS scheduled_date,
         'recurring' AS source
       FROM zoho_recurring_invoices zri
       INNER JOIN customers c ON c.id = zri.customer_id
       LEFT JOIN buildings b ON b.id = c.building_id
       WHERE c.status = 'active'
         AND c.customer_type = 'C2B'
         AND LOWER(COALESCE(zri.status, '')) IN ('active', 'live')
         AND zri.next_invoice_date >= ?
         AND zri.next_invoice_date <= ?
       ORDER BY zri.next_invoice_date ASC, c.customer_number ASC`,
      [windowStart, windowEnd]
    ),
    query(
      `SELECT
         c.id AS customer_id,
         c.customer_number,
         CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         b.name AS building_name,
         c.package_price,
         c.payment_frequency,
         c.customer_type,
         c.trial_ends_at AS scheduled_date,
         'trial' AS source
       FROM customers c
       LEFT JOIN buildings b ON b.id = c.building_id
       WHERE c.status = 'active'
         AND c.customer_type = 'C2B'
         AND c.trial_period_enabled = 1
         AND c.trial_ends_at IS NOT NULL
         AND c.trial_ends_at >= ?
         AND c.trial_ends_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM zoho_recurring_invoices zri
           WHERE zri.customer_id = c.id
             AND LOWER(COALESCE(zri.status, '')) IN ('active', 'live')
             AND zri.next_invoice_date >= ?
             AND zri.next_invoice_date <= ?
         )
       ORDER BY c.trial_ends_at ASC, c.customer_number ASC`,
      [windowStart, windowEnd, windowStart, windowEnd]
    ),
    loadB2bForecastItems(windowStart, windowEnd),
  ]);

  const items = [
    ...recurringRows.map((row) => mapForecastRow(row, { customerType: "C2B" })),
    ...trialRows.map((row) => mapForecastRow(row, { customerType: "C2B" })),
    ...b2bItems,
  ].sort((a, b) => {
    const byDate = String(a.scheduledDate).localeCompare(String(b.scheduledDate));
    if (byDate) return byDate;
    return String(a.customerNumber).localeCompare(String(b.customerNumber));
  });

  const anticipatedAmount = roundMoney(
    items.reduce((sum, item) => sum + item.expectedAmount, 0)
  );

  return {
    windowDays: days,
    windowStart,
    windowEnd,
    monthsLabel: windowMonthLabel(windowStart, windowEnd),
    invoiceCount: items.length,
    anticipatedAmount,
    items,
  };
}

module.exports = {
  getUpcomingInvoiceForecast,
  windowMonthLabel,
  monthYearLabel,
  firstOccurrenceInWindow,
};
