const { query } = require("../config/db");

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapForecastRow(row) {
  return {
    customerId: row.customer_id,
    customerNumber: row.customer_number,
    customerName: String(row.customer_name || "").trim(),
    buildingName: row.building_name || null,
    expectedAmount: roundMoney(row.package_price),
    paymentFrequency: row.payment_frequency || "monthly",
    scheduledDate: row.scheduled_date,
    source: row.source,
  };
}

/**
 * Invoices expected to go out in the next N days (Zoho recurring + trial first invoices).
 * Uses DB snapshots — scales with customer count via indexed date filters.
 */
async function getUpcomingInvoiceForecast({ days = 7, startDate } = {}) {
  const windowStart = startDate || new Date().toISOString().slice(0, 10);
  const windowEnd = addDaysIso(windowStart, days);

  const recurringRows = await query(
    `SELECT
       c.id AS customer_id,
       c.customer_number,
       CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
       b.name AS building_name,
       c.package_price,
       c.payment_frequency,
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
  );

  const trialRows = await query(
    `SELECT
       c.id AS customer_id,
       c.customer_number,
       CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
       b.name AS building_name,
       c.package_price,
       c.payment_frequency,
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
  );

  const items = [...recurringRows, ...trialRows].map(mapForecastRow);
  const anticipatedAmount = roundMoney(
    items.reduce((sum, item) => sum + item.expectedAmount, 0)
  );

  return {
    windowDays: days,
    windowStart,
    windowEnd,
    invoiceCount: items.length,
    anticipatedAmount,
    items,
  };
}

module.exports = { getUpcomingInvoiceForecast };
