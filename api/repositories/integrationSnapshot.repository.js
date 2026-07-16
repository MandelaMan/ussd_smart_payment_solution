const { query } = require("../config/db");
const customerRepo = require("./customer.repository");

const DEFAULT_MAX_AGE_HOURS = Number(
  process.env.INTEGRATION_SNAPSHOT_MAX_AGE_HOURS || 168
);

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Pull due date from common TISP payload key variants. */
function extractTispDueDateRaw(payload) {
  if (!payload || typeof payload !== "object") return null;
  const raw =
    payload.dueDate ??
    payload.duedate ??
    payload.DueDate ??
    payload.DUE_DATE ??
    payload.expiryDate ??
    payload.ExpiryDate ??
    payload.due_date ??
    null;
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim();
}

/**
 * Normalize TISP due dates (e.g. "13 Jul 2026 12:00 AM") to YYYY-MM-DD for storage/UI.
 * Falls back to the original string if parsing fails.
 */
function normalizeTispDueDateValue(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  try {
    const moment = require("moment-timezone");
    const formats = [
      "DD MMM YYYY hh:mm A",
      "DD MMM YYYY h:mm A",
      "D MMM YYYY hh:mm A",
      "D MMM YYYY h:mm A",
      "DD MMM YYYY",
      "D MMM YYYY",
      "DD-MMM-YYYY",
      "D-MMM-YYYY",
      "DD-MMM-YYYY hh:mm A",
      "D-MMM-YYYY h:mm A",
      "DD/MM/YYYY",
      "D/M/YYYY",
      "YYYY-MM-DD",
      moment.ISO_8601,
    ];
    const strict = moment(s, formats, true);
    if (strict.isValid()) return strict.format("YYYY-MM-DD");
    const loose = moment(s);
    if (loose.isValid()) return loose.format("YYYY-MM-DD");
  } catch {
    /* moment unavailable — fall through */
  }

  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) {
    return native.toISOString().slice(0, 10);
  }
  return s;
}

function extractTispDueDate(payload) {
  return normalizeTispDueDateValue(extractTispDueDateRaw(payload));
}

/** Resolve due date from a stored snapshot row (column or nested raw_json). */
function dueDateFromTispSnapshotRow(row) {
  if (!row) return null;
  const fromColumn = normalizeTispDueDateValue(row.due_date);
  if (fromColumn) return fromColumn;
  const raw = parseJson(row.raw_json, null);
  return extractTispDueDate(raw);
}

function isFresh(syncedAt, maxAgeHours = DEFAULT_MAX_AGE_HOURS) {
  if (!syncedAt) return false;
  const ageMs = Date.now() - new Date(syncedAt).getTime();
  return ageMs >= 0 && ageMs < maxAgeHours * 60 * 60 * 1000;
}

function mapStoredInvoice(row) {
  const raw = parseJson(row.raw_json, {});
  return {
    id: String(row.invoice_id || raw.invoice_id),
    invoiceNumber: row.invoice_number || raw.invoice_number || null,
    date: row.invoice_date || raw.date || null,
    dueDate: row.due_date || raw.due_date || null,
    status: row.status || raw.status || "unknown",
    total: row.total != null ? Number(row.total) : raw.total != null ? Number(raw.total) : null,
    balanceDue:
      row.balance_due != null
        ? Number(row.balance_due)
        : raw.balance != null
          ? Number(raw.balance)
          : null,
  };
}

function mapStoredPayment(row) {
  return {
    id: String(row.payment_id),
    source: "zoho",
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.reference_number || String(row.payment_id),
    paidAt: row.payment_date || null,
    invoiceNumber: row.invoice_number || null,
  };
}

function mapStoredRecurring(row) {
  return {
    id: String(row.recurring_invoice_id),
    status: row.status || "unknown",
    nextInvoiceDate: row.next_invoice_date || null,
    lastSentDate: row.last_sent_date || null,
  };
}

async function getZohoContact(customerId) {
  const rows = await query(
    `SELECT * FROM zoho_customer_contacts WHERE customer_id = ? LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

async function upsertZohoContact(customerId, contact) {
  if (!customerId || !contact?.contact_id) return;
  const credit =
    contact.outstanding_receivable_amount != null &&
    Number(contact.outstanding_receivable_amount) < 0
      ? Math.abs(Number(contact.outstanding_receivable_amount))
      : 0;

  await query(
    `INSERT INTO zoho_customer_contacts
      (customer_id, zoho_contact_id, company_name, email, credit_balance, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      zoho_contact_id = VALUES(zoho_contact_id),
      company_name = VALUES(company_name),
      email = VALUES(email),
      credit_balance = VALUES(credit_balance),
      raw_json = VALUES(raw_json),
      synced_at = NOW()`,
    [
      customerId,
      String(contact.contact_id),
      contact.company_name || contact.customer_name || null,
      contact.email || null,
      credit,
      JSON.stringify(contact),
    ]
  );
}

async function listInvoicesForCustomer(customerId) {
  const rows = await query(
    `SELECT * FROM zoho_customer_invoices
     WHERE customer_id = ?
     ORDER BY invoice_date DESC, updated_at DESC
     LIMIT 100`,
    [customerId]
  );
  return rows.map(mapStoredInvoice);
}

async function replaceZohoPayments(customerId, payments = []) {
  await query(`DELETE FROM zoho_customer_payments WHERE customer_id = ?`, [customerId]);
  for (const p of payments) {
    const paymentId = p.payment_id || p.id;
    if (!paymentId) continue;
    const invoiceNumber = Array.isArray(p.invoices)
      ? p.invoices[0]?.invoice_number || null
      : null;
    await query(
      `INSERT INTO zoho_customer_payments
        (customer_id, payment_id, payment_date, amount, reference_number, invoice_number, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        customerId,
        String(paymentId),
        p.date || p.payment_date || p.created_time || null,
        p.amount != null ? Number(p.amount) : null,
        p.reference_number || p.payment_number || null,
        invoiceNumber,
        JSON.stringify(p),
      ]
    );
  }
}

async function listZohoPayments(customerId) {
  const rows = await query(
    `SELECT * FROM zoho_customer_payments
     WHERE customer_id = ?
     ORDER BY payment_date DESC, synced_at DESC
     LIMIT 100`,
    [customerId]
  );
  return rows.map(mapStoredPayment);
}

async function replaceRecurringInvoices(customerId, recurring = []) {
  await query(`DELETE FROM zoho_recurring_invoices WHERE customer_id = ?`, [customerId]);
  for (const inv of recurring) {
    const id = inv.recurring_invoice_id || inv.recurringinvoice_id || inv.id;
    if (!id) continue;
    await query(
      `INSERT INTO zoho_recurring_invoices
        (customer_id, recurring_invoice_id, status, next_invoice_date, last_sent_date, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        customerId,
        String(id),
        inv.recurrence_status || inv.status || null,
        inv.next_invoice_date || null,
        inv.last_sent_date || null,
        JSON.stringify(inv),
      ]
    );
  }
}

async function listRecurringInvoices(customerId) {
  const rows = await query(
    `SELECT * FROM zoho_recurring_invoices WHERE customer_id = ? ORDER BY synced_at DESC`,
    [customerId]
  );
  return rows.map(mapStoredRecurring);
}

async function getTispSnapshot(customerId) {
  const rows = await query(
    `SELECT * FROM tisp_customer_snapshots WHERE customer_id = ? LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

async function upsertTispSnapshot(customerId, tispPayload) {
  if (!customerId || !tispPayload) return;
  const status =
    tispPayload.status ??
    tispPayload.Status ??
    tispPayload.subscriptionStatus ??
    null;
  const dueDate = extractTispDueDate(tispPayload);
  const packageLabel =
    tispPayload.package ?? tispPayload.Package ?? tispPayload.package_label ?? null;
  const amount =
    tispPayload.amount ?? tispPayload.Amount ?? tispPayload.monthlyAmount ?? null;

  await query(
    `INSERT INTO tisp_customer_snapshots
      (customer_id, subscription_status, due_date, package_label, monthly_amount, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      subscription_status = COALESCE(VALUES(subscription_status), subscription_status),
      due_date = COALESCE(VALUES(due_date), due_date),
      package_label = COALESCE(VALUES(package_label), package_label),
      monthly_amount = COALESCE(VALUES(monthly_amount), monthly_amount),
      raw_json = VALUES(raw_json),
      synced_at = NOW()`,
    [
      customerId,
      status ? String(status) : null,
      dueDate,
      packageLabel ? String(packageLabel) : null,
      amount != null ? Number(amount) : null,
      JSON.stringify(tispPayload),
    ]
  );
}

/**
 * Load persisted Zoho + TISP billing data for a customer (no API calls).
 */
async function loadCustomerBillingSnapshot(customerId, options = {}) {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const requireFresh = options.requireFresh === true;

  const [contactRow, tispRow] = await Promise.all([
    getZohoContact(customerId),
    getTispSnapshot(customerId),
  ]);

  const contactFresh = contactRow && isFresh(contactRow.synced_at, maxAgeHours);
  const tispFresh = tispRow && isFresh(tispRow.synced_at, maxAgeHours);

  if (requireFresh && contactRow && !contactFresh) {
    return { hasData: false, stale: true };
  }

  const invoices = await listInvoicesForCustomer(customerId);
  const payments = await listZohoPayments(customerId);
  const recurring = await listRecurringInvoices(customerId);

  const hasZoho =
    Boolean(contactRow?.zoho_contact_id) ||
    invoices.length > 0 ||
    payments.length > 0;

  const hasData = hasZoho || Boolean(tispRow);

  return {
    hasData,
    stale: Boolean(contactRow && !contactFresh),
    zohoContactId: contactRow?.zoho_contact_id || null,
    creditBalance:
      contactRow?.credit_balance != null ? Number(contactRow.credit_balance) : 0,
    invoices,
    zohoPayments: payments,
    recurringInvoices: recurring,
    tisp: tispRow
      ? {
          subscriptionStatus: tispRow.subscription_status,
          dueDate: dueDateFromTispSnapshotRow(tispRow),
          packageLabel: tispRow.package_label,
          amount: tispRow.monthly_amount,
          fresh: tispFresh,
        }
      : null,
    syncedAt: contactRow?.synced_at || tispRow?.synced_at || null,
  };
}

/**
 * Persist Zoho billing data after a successful API fetch.
 */
async function saveZohoBillingSnapshot(customerId, {
  contact,
  invoices = [],
  payments = [],
  recurring = [],
}) {
  if (contact?.contact_id) {
    await upsertZohoContact(customerId, contact);
  }
  for (const inv of invoices) {
    await customerRepo.upsertZohoInvoice(customerId, inv, contact?.contact_id);
  }
  await replaceZohoPayments(customerId, payments);
  await replaceRecurringInvoices(customerId, recurring);
}

/**
 * Update stored invoice/payment rows after a Zoho payment (no API fetch).
 */
async function recordZohoPaymentSnapshot(customerId, {
  invoiceId,
  invoiceNumber,
  paymentId,
  amount,
  referenceId,
  paidAt,
  remainingBalance,
}) {
  if (!customerId) return;

  if (invoiceId) {
    const balance =
      remainingBalance != null ? Number(remainingBalance) : null;
    const status =
      balance != null && balance <= 0
        ? "paid"
        : balance != null
          ? "partially_paid"
          : null;
    const sets = ["synced_at = NOW()"];
    const params = [];
    if (balance != null) {
      sets.unshift("balance_due = ?");
      params.push(balance);
    }
    if (status) {
      sets.unshift("status = ?");
      params.push(status);
    }
    params.push(customerId, String(invoiceId));
    await query(
      `UPDATE zoho_customer_invoices SET ${sets.join(", ")}
       WHERE customer_id = ? AND invoice_id = ?`,
      params
    );
  }

  if (paymentId) {
    await query(
      `INSERT INTO zoho_customer_payments
        (customer_id, payment_id, payment_date, amount, reference_number, invoice_number, raw_json, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
        payment_date = VALUES(payment_date),
        amount = VALUES(amount),
        reference_number = VALUES(reference_number),
        invoice_number = VALUES(invoice_number),
        raw_json = VALUES(raw_json),
        synced_at = NOW()`,
      [
        customerId,
        String(paymentId),
        paidAt || null,
        amount != null ? Number(amount) : null,
        referenceId || null,
        invoiceNumber || null,
        JSON.stringify({
          payment_id: paymentId,
          amount,
          reference_number: referenceId,
          invoice_number: invoiceNumber,
        }),
      ]
    );
  }
}

async function recordZohoPaymentByCustomerNumber(customerNumber, paymentData) {
  const customerStore = require("../services/customerModuleStore");
  const customer = await customerStore.findCustomerByNumber(customerNumber);
  if (!customer?.id) return;
  await recordZohoPaymentSnapshot(customer.id, paymentData);
  try {
    const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
    invalidateCustomerZoho(customer.id);
  } catch {
    /* best-effort */
  }
}

module.exports = {
  DEFAULT_MAX_AGE_HOURS,
  isFresh,
  getZohoContact,
  upsertZohoContact,
  listInvoicesForCustomer,
  replaceZohoPayments,
  listZohoPayments,
  replaceRecurringInvoices,
  listRecurringInvoices,
  getTispSnapshot,
  upsertTispSnapshot,
  extractTispDueDate,
  normalizeTispDueDateValue,
  dueDateFromTispSnapshotRow,
  loadCustomerBillingSnapshot,
  saveZohoBillingSnapshot,
  recordZohoPaymentSnapshot,
  recordZohoPaymentByCustomerNumber,
  mapStoredInvoice,
};
