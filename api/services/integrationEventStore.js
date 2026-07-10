const { query } = require("../config/db");
const { findPaymentTransactionId } = require("./transactionStore");

async function insertIntegrationEvent({
  source,
  status = "unknown",
  customerNo = null,
  amount = null,
  referenceId = null,
  outcome = null,
  channel = null,
  checkoutRequestId = null,
  rawPayload = {},
}) {
  let paymentTransactionId = null;
  if (checkoutRequestId) {
    paymentTransactionId = await findPaymentTransactionId(checkoutRequestId);
  }

  const result = await query(
    `INSERT INTO integration_events
      (source, payment_transaction_id, status, customer_no, amount,
       reference_id, outcome, channel, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      source,
      paymentTransactionId,
      status,
      customerNo,
      amount != null ? Number(amount) : null,
      referenceId,
      outcome,
      channel,
      JSON.stringify(rawPayload),
    ]
  );

  return result.insertId;
}

async function listIntegrationEvents({
  source,
  status,
  search,
  from,
  to,
  page = 1,
  limit = 20,
}) {
  const conditions = [];
  const params = [];

  if (source) {
    conditions.push("source = ?");
    params.push(source);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (from) {
    conditions.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("created_at <= ?");
    params.push(to);
  }
  if (search) {
    conditions.push(
      "(customer_no LIKE ? OR reference_id LIKE ? OR outcome LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (Math.max(1, page) - 1) * limit;

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM integration_events ${where}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const rows = await query(
    `SELECT ie.*, pt.checkout_request_id, pt.mpesa_receipt, pt.phone AS mpesa_phone
     FROM integration_events ie
     LEFT JOIN payment_transactions pt ON pt.id = ie.payment_transaction_id
     ${where}
     ORDER BY ie.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(formatEvent),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

function formatEvent(row) {
  let payload = {};
  try {
    payload =
      typeof row.raw_payload === "string"
        ? JSON.parse(row.raw_payload)
        : row.raw_payload || {};
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    customerNo: row.customer_no,
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.reference_id,
    outcome: row.outcome,
    channel: row.channel,
    checkoutRequestId: row.checkout_request_id,
    mpesaReceipt: row.mpesa_receipt,
    phone: row.mpesa_phone,
    payload,
    createdAt: row.created_at,
  };
}

module.exports = {
  insertIntegrationEvent,
  listIntegrationEvents,
  formatEvent,
};
