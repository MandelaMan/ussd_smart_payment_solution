const { query, getPool } = require("../config/db");

function rowToLegacyTxn(row) {
  if (!row) return null;
  return {
    id: row.id,
    Status: row.status,
    PhoneNumber: row.phone || "",
    Amount: row.amount != null ? Number(row.amount) : null,
    MerchantRequestID: row.merchant_request_id,
    CheckoutRequestID: row.checkout_request_id,
    AccountReference: row.account_reference,
    MpesaReceiptNumber: row.mpesa_receipt,
    ResultCode: row.result_code,
    ResultDesc: row.result_desc,
    TransactionDate: row.transaction_date,
    Timestamp: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : new Date(row.created_at).toISOString(),
    channel: row.channel,
  };
}

function legacyToRow(txn = {}) {
  return {
    checkout_request_id: txn.CheckoutRequestID || null,
    merchant_request_id: txn.MerchantRequestID || null,
    mpesa_receipt: txn.MpesaReceiptNumber || null,
    phone: txn.PhoneNumber ? String(txn.PhoneNumber) : null,
    amount: txn.Amount != null ? Number(txn.Amount) : null,
    account_reference: txn.AccountReference || null,
    status: txn.Status || "PENDING",
    result_code: txn.ResultCode != null ? Number(txn.ResultCode) : null,
    result_desc: txn.ResultDesc || null,
    transaction_date: txn.TransactionDate
      ? String(txn.TransactionDate)
      : null,
    channel: txn.channel || null,
    raw_payload: JSON.stringify(txn),
  };
}

function materializeTransactionsFromTrail(entries) {
  const byCheckout = new Map();
  const order = [];

  function touch(id, record) {
    const key = String(id || `anon-${order.length}`);
    if (!byCheckout.has(key)) order.push(key);
    byCheckout.set(key, { ...byCheckout.get(key), ...record });
  }

  for (const row of entries) {
    if (row.event === "append" && row.txn) {
      touch(row.txn.CheckoutRequestID, row.txn);
    } else if (row.event === "upsert" && row.checkoutId) {
      touch(row.checkoutId, row.patch || {});
    }
  }

  return order.map((id) => byCheckout.get(id));
}

async function readTransactions() {
  const rows = await query(
    `SELECT * FROM payment_transactions ORDER BY created_at ASC`
  );
  return rows.map(rowToLegacyTxn);
}

async function findByCheckoutId(checkoutId) {
  if (!checkoutId) return null;
  const rows = await query(
    `SELECT * FROM payment_transactions WHERE checkout_request_id = ? LIMIT 1`,
    [checkoutId]
  );
  return rowToLegacyTxn(rows[0]);
}

async function findPaymentTransactionId(checkoutId) {
  if (!checkoutId) return null;
  const rows = await query(
    `SELECT id FROM payment_transactions WHERE checkout_request_id = ? LIMIT 1`,
    [checkoutId]
  );
  return rows[0]?.id || null;
}

async function appendTransaction(txn) {
  const row = legacyToRow(txn);
  await query(
    `INSERT INTO payment_transactions
      (checkout_request_id, merchant_request_id, mpesa_receipt, phone, amount,
       account_reference, status, result_code, result_desc, transaction_date,
       channel, raw_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.checkout_request_id,
      row.merchant_request_id,
      row.mpesa_receipt,
      row.phone,
      row.amount,
      row.account_reference,
      row.status,
      row.result_code,
      row.result_desc,
      row.transaction_date,
      row.channel,
      row.raw_payload,
    ]
  );
  // Callers discard the return value; avoid SELECT * of the full table after every write.
  return findByCheckoutId(row.checkout_request_id);
}

async function upsertByCheckoutId(checkoutId, patch) {
  if (!checkoutId) return null;

  const existing = await findByCheckoutId(checkoutId);
  const merged = { ...(existing || {}), ...patch, CheckoutRequestID: checkoutId };
  const row = legacyToRow(merged);

  if (existing) {
    await query(
      `UPDATE payment_transactions SET
        merchant_request_id = COALESCE(?, merchant_request_id),
        mpesa_receipt = COALESCE(?, mpesa_receipt),
        phone = COALESCE(?, phone),
        amount = COALESCE(?, amount),
        account_reference = COALESCE(?, account_reference),
        status = ?,
        result_code = ?,
        result_desc = COALESCE(?, result_desc),
        transaction_date = COALESCE(?, transaction_date),
        channel = COALESCE(?, channel),
        raw_payload = ?
       WHERE checkout_request_id = ?`,
      [
        row.merchant_request_id,
        row.mpesa_receipt,
        row.phone,
        row.amount,
        row.account_reference,
        row.status,
        row.result_code,
        row.result_desc,
        row.transaction_date,
        row.channel,
        row.raw_payload,
        checkoutId,
      ]
    );
  } else {
    await query(
      `INSERT INTO payment_transactions
        (checkout_request_id, merchant_request_id, mpesa_receipt, phone, amount,
         account_reference, status, result_code, result_desc, transaction_date,
         channel, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.checkout_request_id,
        row.merchant_request_id,
        row.mpesa_receipt,
        row.phone,
        row.amount,
        row.account_reference,
        row.status,
        row.result_code,
        row.result_desc,
        row.transaction_date,
        row.channel,
        row.raw_payload,
      ]
    );
  }

  return findByCheckoutId(checkoutId);
}

const normalizePhone = (phone = "") => phone.replace(/^(\+|0)+/, "");

async function findLatestTxnByCheckoutOrPhone(checkoutId, phone) {
  if (checkoutId) {
    const hit = await findByCheckoutId(checkoutId);
    if (hit) return hit;
  }
  const cleaned = normalizePhone(phone);
  if (!cleaned) return null;
  const rows = await query(
    `SELECT * FROM payment_transactions
     WHERE phone LIKE ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [`%${cleaned}`]
  );
  return rowToLegacyTxn(rows[0]);
}

function mostRecentForPhone(all, phone) {
  const cleaned = normalizePhone(phone);
  const list = all.filter((t) => (t.PhoneNumber || "").endsWith(cleaned));
  return list.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
}

/** Persist a successful C2B paybill confirmation for reconciliation retries. */
async function recordC2BConfirmation({
  mpesaReceipt,
  phone,
  amount,
  accountReference,
  transactionDate,
  rawPayload,
}) {
  const receipt = String(mpesaReceipt || "").trim();
  if (!receipt) return null;

  const existing = await query(
    `SELECT id FROM payment_transactions WHERE mpesa_receipt = ? LIMIT 1`,
    [receipt]
  );
  if (existing[0]?.id) return existing[0].id;

  const result = await query(
    `INSERT INTO payment_transactions
      (mpesa_receipt, phone, amount, account_reference, status, transaction_date, channel, raw_payload)
     VALUES (?, ?, ?, ?, 'SUCCESS', ?, 'C2B', ?)`,
    [
      receipt,
      phone ? String(phone) : null,
      amount != null ? Number(amount) : null,
      accountReference ? String(accountReference) : null,
      transactionDate ? String(transactionDate) : null,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ]
  );
  return result.insertId;
}

module.exports = {
  readTransactions,
  appendTransaction,
  upsertByCheckoutId,
  findLatestTxnByCheckoutOrPhone,
  findPaymentTransactionId,
  findByCheckoutId,
  mostRecentForPhone,
  normalizePhone,
  rowToLegacyTxn,
  materializeTransactionsFromTrail,
  recordC2BConfirmation,
};
