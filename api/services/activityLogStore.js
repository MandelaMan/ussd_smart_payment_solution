const { query } = require("../config/db");
const { findPaymentTransactionId } = require("./transactionStore");

/**
 * Persist a dashboard activity entry (production payment & integration actions).
 */
async function logActivity({
  eventType,
  title,
  message = null,
  source,
  status = "success",
  customerRef = null,
  amount = null,
  referenceId = null,
  checkoutRequestId = null,
  metadata = {},
}) {
  let paymentTransactionId = null;
  if (checkoutRequestId) {
    paymentTransactionId = await findPaymentTransactionId(checkoutRequestId);
  }

  await query(
    `INSERT INTO activity_logs
      (event_type, title, message, source, status, customer_ref, amount,
       reference_id, payment_transaction_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventType,
      title,
      message,
      source,
      status,
      customerRef,
      amount != null ? Number(amount) : null,
      referenceId,
      paymentTransactionId,
      JSON.stringify(metadata),
    ]
  );
}

async function listActivity({ limit = 40 } = {}) {
  const rows = await query(
    `SELECT id, event_type, title, message, source, status, customer_ref,
            amount, reference_id, created_at
     FROM activity_logs
     ORDER BY created_at DESC
     LIMIT ?`,
    [Math.min(100, Math.max(1, limit))]
  );

  return rows.map(formatActivity);
}

function formatActivity(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    source: row.source,
    status: row.status,
    customerRef: row.customer_ref,
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.reference_id,
    createdAt: row.created_at,
  };
}

module.exports = { logActivity, listActivity, formatActivity };
