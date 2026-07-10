const { query } = require("../config/db");
const integrationSnapshot = require("./integrationSnapshot.repository");
const customerRepo = require("./customer.repository");
const { parseZohoModifiedTime } = require("../services/zoho/zohoListApi");

const ALLOWED_PREFIXES = ["CL-", "ET-", "SKY-", "GM-"];

function normCompany(value) {
  return String(value || "").trim().toUpperCase();
}

function contactMatchesCustomer(companyName, customerNumber) {
  const company = normCompany(companyName);
  const number = normCompany(customerNumber);
  if (!company || !number) return false;
  if (company === number) return true;
  return company.startsWith(number) || number.startsWith(company);
}

async function findCustomerIdByZohoContactId(zohoContactId) {
  if (!zohoContactId) return null;
  const rows = await query(
    `SELECT customer_id FROM zoho_customer_contacts WHERE zoho_contact_id = ? LIMIT 1`,
    [String(zohoContactId)]
  );
  return rows[0]?.customer_id ? Number(rows[0].customer_id) : null;
}

async function findCustomerIdByCompanyName(companyName) {
  const company = String(companyName || "").trim();
  if (!company) return null;

  const exact = await query(
    `SELECT id FROM customers WHERE customer_number = ? AND status != 'cancelled' LIMIT 1`,
    [company]
  );
  if (exact[0]?.id) return Number(exact[0].id);

  const upper = company.toUpperCase();
  if (!ALLOWED_PREFIXES.some((p) => upper.startsWith(p))) return null;

  const prefix = upper.split("-")[0] + "-";
  const rows = await query(
    `SELECT id, customer_number FROM customers
     WHERE status != 'cancelled' AND customer_number LIKE ?
     ORDER BY LENGTH(customer_number) DESC
     LIMIT 20`,
    [`${prefix}%`]
  );

  for (const row of rows) {
    if (contactMatchesCustomer(company, row.customer_number)) {
      return Number(row.id);
    }
  }
  return null;
}

async function resolveCustomerIdForZohoRecord(record, zohoContactId) {
  const contactId = zohoContactId || record.customer_id || record.contact_id;
  const fromContact = await findCustomerIdByZohoContactId(contactId);
  if (fromContact) return fromContact;

  const company =
    record.company_name ||
    record.customer_name ||
    record.contact_name ||
    record.reference_number ||
    null;

  return findCustomerIdByCompanyName(company);
}

async function upsertContactRecord(contact) {
  const customerId = await resolveCustomerIdForZohoRecord(contact, contact.contact_id);
  if (!customerId) return { updated: false, reason: "no_local_customer" };

  const modified = parseZohoModifiedTime(contact.last_modified_time);
  await integrationSnapshot.upsertZohoContact(customerId, contact);

  if (modified) {
    await query(
      `UPDATE zoho_customer_contacts
       SET zoho_last_modified_time = ?, sync_status = 'synced'
       WHERE customer_id = ?`,
      [modified, customerId]
    );
  }

  return { updated: true, customerId, created: false };
}

async function upsertInvoiceRecord(invoice) {
  const zohoContactId = invoice.customer_id || invoice.contact_id;
  const customerId = await resolveCustomerIdForZohoRecord(invoice, zohoContactId);
  if (!customerId) return { updated: false, reason: "no_local_customer" };

  const modified = parseZohoModifiedTime(invoice.last_modified_time);
  await customerRepo.upsertZohoInvoice(customerId, invoice, zohoContactId);

  if (modified) {
    await query(
      `UPDATE zoho_customer_invoices
       SET zoho_last_modified_time = ?, sync_status = 'synced'
       WHERE customer_id = ? AND invoice_id = ?`,
      [modified, customerId, String(invoice.invoice_id)]
    );
  }

  return { updated: true, customerId };
}

async function upsertPaymentRecord(payment) {
  const zohoContactId = payment.customer_id || payment.contact_id;
  const customerId = await resolveCustomerIdForZohoRecord(payment, zohoContactId);
  if (!customerId) return { updated: false, reason: "no_local_customer" };

  const paymentId = payment.payment_id || payment.id;
  const invoiceNumber = Array.isArray(payment.invoices)
    ? payment.invoices[0]?.invoice_number || null
    : payment.invoice_number || null;

  const modified = parseZohoModifiedTime(payment.last_modified_time);

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
      payment.date || payment.payment_date || null,
      payment.amount != null ? Number(payment.amount) : null,
      payment.reference_number || payment.payment_number || null,
      invoiceNumber,
      JSON.stringify(payment),
    ]
  );

  if (modified) {
    await query(
      `UPDATE zoho_customer_payments
       SET zoho_last_modified_time = ?, sync_status = 'synced'
       WHERE customer_id = ? AND payment_id = ?`,
      [modified, customerId, String(paymentId)]
    );
  }

  return { updated: true, customerId };
}

async function upsertRecurringRecord(recurring) {
  const zohoContactId = recurring.customer_id || recurring.contact_id;
  const customerId = await resolveCustomerIdForZohoRecord(recurring, zohoContactId);
  if (!customerId) return { updated: false, reason: "no_local_customer" };

  const recurringId = recurring.recurring_invoice_id || recurring.id;
  const modified = parseZohoModifiedTime(recurring.last_modified_time);

  await query(
    `INSERT INTO zoho_recurring_invoices
      (customer_id, recurring_invoice_id, status, next_invoice_date, last_sent_date, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      next_invoice_date = VALUES(next_invoice_date),
      last_sent_date = VALUES(last_sent_date),
      raw_json = VALUES(raw_json),
      synced_at = NOW()`,
    [
      customerId,
      String(recurringId),
      recurring.status || null,
      recurring.next_invoice_date || null,
      recurring.last_sent_date || null,
      JSON.stringify(recurring),
    ]
  );

  if (modified) {
    await query(
      `UPDATE zoho_recurring_invoices
       SET zoho_last_modified_time = ?, sync_status = 'synced'
       WHERE customer_id = ? AND recurring_invoice_id = ?`,
      [modified, customerId, String(recurringId)]
    );
  }

  return { updated: true, customerId };
}

async function upsertEstimateRecord(estimate) {
  const zohoContactId = estimate.customer_id || estimate.contact_id;
  const customerId = await resolveCustomerIdForZohoRecord(estimate, zohoContactId);
  const estimateId = estimate.estimate_id || estimate.id;
  const modified = parseZohoModifiedTime(estimate.last_modified_time);

  await query(
    `INSERT INTO zoho_estimates
      (zoho_estimate_id, zoho_contact_id, customer_id, estimate_number, estimate_date,
       status, total, zoho_last_modified_time, sync_status, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, NOW())
     ON DUPLICATE KEY UPDATE
      zoho_contact_id = VALUES(zoho_contact_id),
      customer_id = VALUES(customer_id),
      estimate_number = VALUES(estimate_number),
      estimate_date = VALUES(estimate_date),
      status = VALUES(status),
      total = VALUES(total),
      zoho_last_modified_time = VALUES(zoho_last_modified_time),
      raw_json = VALUES(raw_json),
      synced_at = NOW()`,
    [
      String(estimateId),
      zohoContactId ? String(zohoContactId) : null,
      customerId,
      estimate.estimate_number || null,
      estimate.date || estimate.estimate_date || null,
      estimate.status || null,
      estimate.total != null ? Number(estimate.total) : null,
      modified,
      JSON.stringify(estimate),
    ]
  );

  return { updated: true, customerId };
}

async function upsertCreditNoteRecord(creditNote) {
  const zohoContactId = creditNote.customer_id || creditNote.contact_id;
  const customerId = await resolveCustomerIdForZohoRecord(creditNote, zohoContactId);
  const creditNoteId = creditNote.creditnote_id || creditNote.credit_note_id || creditNote.id;
  const modified = parseZohoModifiedTime(creditNote.last_modified_time);

  await query(
    `INSERT INTO zoho_credit_notes
      (zoho_credit_note_id, zoho_contact_id, customer_id, credit_note_number, credit_note_date,
       status, total, balance, zoho_last_modified_time, sync_status, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, NOW())
     ON DUPLICATE KEY UPDATE
      zoho_contact_id = VALUES(zoho_contact_id),
      customer_id = VALUES(customer_id),
      credit_note_number = VALUES(credit_note_number),
      credit_note_date = VALUES(credit_note_date),
      status = VALUES(status),
      total = VALUES(total),
      balance = VALUES(balance),
      zoho_last_modified_time = VALUES(zoho_last_modified_time),
      raw_json = VALUES(raw_json),
      synced_at = NOW()`,
    [
      String(creditNoteId),
      zohoContactId ? String(zohoContactId) : null,
      customerId,
      creditNote.creditnote_number || creditNote.credit_note_number || null,
      creditNote.date || creditNote.credit_note_date || null,
      creditNote.status || null,
      creditNote.total != null ? Number(creditNote.total) : null,
      creditNote.balance != null ? Number(creditNote.balance) : null,
      modified,
      JSON.stringify(creditNote),
    ]
  );

  return { updated: true, customerId };
}

async function refreshSingleCustomerFromZoho(customer, billingService) {
  const contact = await billingService.findContact(customer);
  if (!contact?.contact_id) {
    return { ok: false, error: "Zoho contact not found" };
  }

  await integrationSnapshot.upsertZohoContact(customer.id, contact);

  const [invoicesRes, paymentsRes, recurringRes] = await Promise.all([
    billingService.fetchInvoices(contact.contact_id, { perPage: 50 }),
    billingService.fetchPayments(contact.contact_id),
    billingService.fetchRecurringInvoices(contact.contact_id),
  ]);

  await integrationSnapshot.saveZohoBillingSnapshot(customer.id, {
    contact,
    invoices: invoicesRes.invoices || [],
    payments: paymentsRes.payments || [],
    recurring: recurringRes.recurring || [],
  });

  return {
    ok: true,
    zohoContactId: contact.contact_id,
    invoiceCount: (invoicesRes.invoices || []).length,
    paymentCount: (paymentsRes.payments || []).length,
    recurringCount: (recurringRes.recurring || []).length,
    syncedAt: new Date().toISOString(),
  };
}

module.exports = {
  resolveCustomerIdForZohoRecord,
  upsertContactRecord,
  upsertInvoiceRecord,
  upsertPaymentRecord,
  upsertRecurringRecord,
  upsertEstimateRecord,
  upsertCreditNoteRecord,
  refreshSingleCustomerFromZoho,
};
