const { query } = require("../config/db");
const customerStore = require("./customerModuleStore");
const reconciliationStore = require("./reconciliationStore");
const { logActivity } = require("./activityLogStore");
const { sendZohoMail, isZohoMailConfigured, getZohoMailConfig } = require("../utils/zohoMail");
const {
  buildEmail,
  resolveTemplateKey,
  listTemplateOptions,
  buildTemplateContext,
} = require("../utils/billingCommunicationTemplates");
const { findContactByLookupKeys_JS } = require("../controllers/zoho.controller");
const { getZohoContactLookupKeys, resolveInvoiceEmail, isB2BCustomer } = require("../utils/b2bBilling");

const COMMUNICABLE_STATUSES = new Set([
  "overdue",
  "partial_payment",
  "skipped_payment",
  "missing_invoice",
  "stale_billing",
  "recurring_invoice_stopped",
  "disconnected_not_invoiced",
  "paid_but_disconnected",
  "connected_without_payment",
  "payment_under_review",
  "billing_frequency_mismatch",
  "no_zoho_link",
  "manual_review_required",
  "credit_balance",
  "cancelled_still_active",
]);

async function resolveCustomerEmail(customer, record, options = {}) {
  if (isB2BCustomer(customer)) {
    const agencyEmail = resolveInvoiceEmail(customer);
    if (agencyEmail.includes("@")) {
      return { email: agencyEmail, source: "agency" };
    }
  }

  if (customer?.email && String(customer.email).includes("@")) {
    return { email: String(customer.email).trim(), source: "dashboard" };
  }

  if (options.allowZohoLookup === false) {
    return { email: null, source: null };
  }

  try {
    const keys = getZohoContactLookupKeys(customer || { customerNumber: record.customerNumber });
    const contact = await findContactByLookupKeys_JS(keys, { customer });
    if (contact?.email && String(contact.email).includes("@")) {
      return { email: String(contact.email).trim(), source: "zoho" };
    }
  } catch {
    /* Zoho lookup optional for preview */
  }

  return { email: null, source: null };
}

async function loadEligibilityContacts(ids) {
  const byId = new Map();
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await query(
      `SELECT c.id, c.email, c.customer_type, a.email AS agency_email
       FROM customers c
       LEFT JOIN agencies a ON a.id = c.agency_id
       WHERE c.id IN (${placeholders})`,
      chunk
    );
    for (const row of rows) {
      byId.set(Number(row.id), {
        id: Number(row.id),
        email: row.email,
        customerType: row.customer_type,
        agencyEmail: row.agency_email,
      });
    }
  }
  return byId;
}

async function loadLastSentMap(customerNumbers = []) {
  if (!customerNumbers.length) return new Map();
  const placeholders = customerNumbers.map(() => "?").join(",");
  const rows = await query(
    `SELECT customer_ref, MAX(created_at) AS last_sent, COUNT(*) AS send_count
     FROM activity_logs
     WHERE event_type = 'billing_email_sent' AND customer_ref IN (${placeholders})
     GROUP BY customer_ref`,
    customerNumbers
  ).catch(() => []);

  const map = new Map();
  for (const row of rows) {
    map.set(row.customer_ref, {
      lastSentAt: row.last_sent,
      sendCount: Number(row.send_count || 0),
    });
  }
  return map;
}

function isCommunicableRecord(record) {
  if (!record) return false;
  if (record.primaryStatus === "current" || record.primaryStatus === "paid") return false;
  const statuses = record.statuses || [];
  return statuses.some((s) => COMMUNICABLE_STATUSES.has(s)) || COMMUNICABLE_STATUSES.has(record.primaryStatus);
}

async function listCandidates(filters = {}) {
  let records = reconciliationStore.getRecords().filter(isCommunicableRecord);

  if (filters.status) {
    const { recordMatchesStatusFilter } = require("../utils/reconciliationEngine");
    records = records.filter((r) => recordMatchesStatusFilter(r, filters.status));
  }

  if (filters.search) {
    const term = String(filters.search).trim().toLowerCase();
    if (term) {
      records = records.filter(
        (r) =>
          String(r.customerNumber || "").toLowerCase().includes(term) ||
          String(r.customerName || "").toLowerCase().includes(term)
      );
    }
  }

  const { STATUS_PRIORITY } = require("../utils/reconciliationEngine");
  records.sort(
    (a, b) =>
      (STATUS_PRIORITY[b.primaryStatus] || 0) - (STATUS_PRIORITY[a.primaryStatus] || 0)
  );

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;
  const slice = records.slice(offset, offset + limit);

  const lastSentMap = await loadLastSentMap(slice.map((r) => r.customerNumber));

  const enriched = [];
  for (const record of slice) {
    const customer = await customerStore.getCustomerById(record.customerId);
    const { email, source } = await resolveCustomerEmail(customer, record);
    const templateKey = resolveTemplateKey(record);
    const lastSent = lastSentMap.get(record.customerNumber);
    const validations = record.validations || [];
    const issueBasis =
      validations.find((v) => v.severity === "critical")?.message ||
      validations.find((v) => v.severity === "high")?.message ||
      validations[0]?.message ||
      null;

    if (filters.hasEmail === "true" && !email) continue;

    enriched.push({
      customerId: record.customerId,
      customerNumber: record.customerNumber,
      customerName: record.customerName,
      primaryStatus: record.primaryStatus,
      statuses: record.statuses || [],
      outstandingBalance: record.metrics?.outstandingBalance ?? 0,
      expectedAmount: record.metrics?.expectedAmount ?? 0,
      subscriptionStatus: record.metrics?.subscriptionStatus || null,
      issueBasis,
      email,
      emailSource: source,
      canSend: Boolean(email && templateKey && isZohoMailConfigured()),
      templateKey,
      templateLabel: templateKey
        ? listTemplateOptions().find((t) => t.id === templateKey)?.label || templateKey
        : null,
      lastSentAt: lastSent?.lastSentAt || null,
      sendCount: lastSent?.sendCount || 0,
    });
  }

  return {
    data: enriched,
    pagination: {
      page,
      limit,
      total: records.length,
      pages: Math.ceil(records.length / limit) || 1,
    },
    mailConfig: await getZohoMailConfig(),
  };
}

async function previewCommunication(customerId, templateKey) {
  const record = reconciliationStore.getRecords().find((r) => r.customerId === Number(customerId));
  if (!record) {
    const err = new Error("Customer not found in reconciliation snapshot — run Sync first");
    err.status = 404;
    throw err;
  }

  const customer = await customerStore.getCustomerById(Number(customerId));
  const { email, source } = await resolveCustomerEmail(customer, record);
  const emailContent = buildEmail(record, customer, templateKey);

  if (!emailContent) {
    throw new Error("No email template matches this customer's billing gap");
  }

  return {
    customerId: record.customerId,
    customerNumber: record.customerNumber,
    customerName: record.customerName,
    email,
    emailSource: source,
    canSend: Boolean(email && isZohoMailConfigured()),
    mailConfig: await getZohoMailConfig(),
    ...emailContent,
  };
}

async function sendCommunication(customerId, { templateKey, user } = {}) {
  const preview = await previewCommunication(customerId, templateKey);

  if (!preview.email) {
    throw new Error("Customer has no email on dashboard or Zoho Books contact");
  }
  if (!isZohoMailConfigured()) {
    throw new Error("Zoho Mail is not configured");
  }

  const result = await sendZohoMail({
    toAddress: preview.email,
    subject: preview.subject,
    content: preview.html,
    mailFormat: "html",
  });

  await logActivity({
    eventType: "billing_email_sent",
    title: `Billing email: ${preview.templateLabel}`,
    message: `Sent "${preview.subject}" to ${preview.email}`,
    source: "zoho",
    status: "success",
    customerRef: preview.customerNumber,
    metadata: {
      templateKey: preview.templateKey,
      templateLabel: preview.templateLabel,
      toAddress: preview.email,
      emailSource: preview.emailSource,
      messageId: result.messageId,
      sentBy: user?.email || null,
      primaryStatus: preview.primaryStatus,
    },
  });

  return {
    ok: true,
    message: `Email sent to ${preview.email}`,
    ...result,
    templateKey: preview.templateKey,
    customerNumber: preview.customerNumber,
  };
}

async function sendBulkCommunication({ customerIds = [], user } = {}) {
  const ids = [...new Set(customerIds.map(Number).filter(Boolean))];
  if (!ids.length) throw new Error("No customers selected");

  const results = [];
  for (const id of ids) {
    try {
      const sent = await sendCommunication(id, { user });
      results.push({ customerId: id, ok: true, message: sent.message });
    } catch (e) {
      results.push({ customerId: id, ok: false, error: e.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  return {
    ok: ok > 0,
    sent: ok,
    failed: results.length - ok,
    results,
  };
}

async function countEligible() {
  const records = reconciliationStore.getRecords().filter(isCommunicableRecord);
  const total = records.length;
  if (!total || !isZohoMailConfigured()) {
    return { total, eligible: 0 };
  }

  // Dashboard/agency emails only — never Zoho. Summary is polled every few
  // seconds during sync; a live Books lookup per gap customer times out the page.
  const contacts = await loadEligibilityContacts(records.map((r) => r.customerId));
  let eligible = 0;
  for (const record of records) {
    if (!resolveTemplateKey(record)) continue;
    const customer = contacts.get(Number(record.customerId));
    const { email } = await resolveCustomerEmail(customer, record, { allowZohoLookup: false });
    if (email) eligible += 1;
  }
  return { total, eligible };
}

module.exports = {
  listCandidates,
  previewCommunication,
  sendCommunication,
  sendBulkCommunication,
  countEligible,
  listTemplateOptions,
  getZohoMailConfig,
  isZohoMailConfigured,
};
