const { query } = require("../config/db");
const { syncLog } = require("../lib/structuredLogger");

const DEFAULT_PAGE_SIZE = 100;

async function countActiveCustomers(updatedAfter = null) {
  const params = [];
  let sql = `SELECT COUNT(*) AS total FROM customers WHERE status != 'cancelled'`;
  if (updatedAfter) {
    sql += ` AND updated_at >= ?`;
    params.push(updatedAfter);
  }
  const [row] = await query(sql, params);
  return Number(row?.total || 0);
}

async function listCustomersPage({ page = 1, pageSize = DEFAULT_PAGE_SIZE, updatedAfter = null } = {}) {
  const limit = Math.min(500, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;
  const params = [];
  let sql = `
    SELECT c.*, b.name AS building_name
    FROM customers c
    LEFT JOIN buildings b ON b.id = c.building_id
    WHERE c.status != 'cancelled'`;
  if (updatedAfter) {
    sql += ` AND c.updated_at >= ?`;
    params.push(updatedAfter);
  }
  sql += ` ORDER BY c.id ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return query(sql, params);
}

async function updateCustomerSubscriptionStatus(customerId, subscriptionStatus, tispSyncStatus = "synced") {
  const started = Date.now();
  await query(
    `UPDATE customers
     SET subscription_status = ?, tisp_sync_status = ?, updated_at = updated_at
     WHERE id = ?`,
    [subscriptionStatus, tispSyncStatus, customerId]
  );
  syncLog.dbOp({
    operation: "update",
    table: "customers",
    durationMs: Date.now() - started,
    rows: 1,
  });
}

async function upsertZohoInvoice(customerId, invoice, zohoContactId = null) {
  await query(
    `INSERT INTO zoho_customer_invoices
      (customer_id, zoho_contact_id, invoice_id, invoice_number, invoice_date, due_date,
       status, total, balance_due, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       zoho_contact_id = VALUES(zoho_contact_id),
       invoice_number = VALUES(invoice_number),
       invoice_date = VALUES(invoice_date),
       due_date = VALUES(due_date),
       status = VALUES(status),
       total = VALUES(total),
       balance_due = VALUES(balance_due),
       raw_json = VALUES(raw_json),
       synced_at = NOW()`,
    [
      customerId,
      zohoContactId,
      String(invoice.invoice_id || invoice.id),
      invoice.invoice_number || null,
      invoice.date || null,
      invoice.due_date || null,
      invoice.status || null,
      invoice.total != null ? Number(invoice.total) : null,
      invoice.balance != null ? Number(invoice.balance) : null,
      JSON.stringify(invoice),
    ]
  );
}

async function listUnmatchedMpesaPayments() {
  return query(
    `SELECT pt.*
     FROM payment_transactions pt
     WHERE pt.status = 'SUCCESS'
       AND pt.mpesa_receipt IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM integration_events ie
         WHERE ie.source = 'zoho' AND ie.status = 'paid'
           AND (
             ie.reference_id = pt.mpesa_receipt
             OR JSON_UNQUOTE(JSON_EXTRACT(ie.raw_payload, '$.meta.transactionId')) = pt.mpesa_receipt
           )
       )
     ORDER BY pt.transaction_date DESC
     LIMIT 5000`
  );
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  countActiveCustomers,
  listCustomersPage,
  updateCustomerSubscriptionStatus,
  upsertZohoInvoice,
  listUnmatchedMpesaPayments,
};
