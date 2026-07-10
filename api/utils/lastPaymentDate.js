function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function pickLatestPaymentDate(...values) {
  let best = null;
  for (const value of values) {
    const date = formatDateOnly(value);
    if (!date) continue;
    if (!best || date > best) best = date;
  }
  return best;
}

function lastPaymentFromZohoInvoices(invoices) {
  let best = null;
  for (const inv of invoices || []) {
    const status = String(inv.status || "").toLowerCase();
    const balance = inv.balance != null ? Number(inv.balance) : null;
    const isPaid =
      status === "paid" ||
      (status === "partially_paid" && balance != null && balance <= 0);

    const candidate =
      inv.last_payment_date ||
      inv.payment_date ||
      (isPaid ? inv.date : null);

    const date = formatDateOnly(candidate);
    if (date && (!best || date > best)) best = date;
  }
  return best;
}

function lastPaymentFromZohoPayments(payments) {
  let best = null;
  for (const payment of payments || []) {
    const date = formatDateOnly(
      payment.date || payment.payment_date || payment.created_time
    );
    if (date && (!best || date > best)) best = date;
  }
  return best;
}

module.exports = {
  formatDateOnly,
  pickLatestPaymentDate,
  lastPaymentFromZohoInvoices,
  lastPaymentFromZohoPayments,
};
