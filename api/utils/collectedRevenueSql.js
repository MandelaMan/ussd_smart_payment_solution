/**
 * Zoho customer payments are stored per local customer.
 * Agency / bank remittances reuse one Zoho payment_id across every customer on
 * that contact, with the full remittance amount on each row. Company-wide
 * collected revenue must count each payment_id once.
 */
function zohoDistinctPaymentsSql(whereSql = "") {
  return `(
    SELECT
      payment_id,
      MIN(payment_date) AS payment_date,
      MAX(amount) AS amount,
      MIN(customer_id) AS customer_id
    FROM zoho_customer_payments
    ${whereSql}
    GROUP BY payment_id
  )`;
}

/** Used in tests to mirror the SQL grouping: keep the largest amount per payment_id. */
function uniqueZohoPaymentRevenue(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = String(row.payment_id || "").trim();
    if (!id) continue;
    const amount = Number(row.amount) || 0;
    const prev = byId.get(id);
    if (prev == null || amount > prev) byId.set(id, amount);
  }
  let total = 0;
  for (const amount of byId.values()) total += amount;
  return total;
}

module.exports = {
  zohoDistinctPaymentsSql,
  uniqueZohoPaymentRevenue,
};
