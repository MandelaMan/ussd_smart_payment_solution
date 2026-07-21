const { isB2BCustomer } = require("./b2bBilling");

/** Compact compare: ET-RG02, etrg02, ET RG02 → ETRG02 */
function normalizeCustomerRef(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]+/g, "");
}

function looksLikeCustomerNumber(value) {
  const s = String(value || "").trim();
  if (!s) return false;
  return /^[A-Z]{2,4}-[\w\d]+$/i.test(s);
}

function contactRefFields(contact) {
  return [
    contact?.company_name,
    contact?.contact_name,
    contact?.customer_name,
  ].filter(Boolean);
}

/**
 * True when a Zoho contact belongs to this dashboard customer (C2B: company_name
 * must match customer number; B2B: agency name).
 * When storedContactId matches contact_id, always trust the prior sync link
 * (e.g. Zoho company_name still empty).
 */
function zohoContactMatchesDashboardCustomer(
  contact,
  customer,
  storedContactId = null
) {
  if (!contact?.contact_id || !customer) return false;

  if (
    storedContactId &&
    String(contact.contact_id) === String(storedContactId)
  ) {
    return true;
  }

  if (isB2BCustomer(customer)) {
    const agency = String(
      customer.agencyName || customer.agency_name || ""
    ).trim();
    if (!agency) return false;
    const target = normalizeCustomerRef(agency);
    return contactRefFields(contact).some(
      (field) => normalizeCustomerRef(field) === target
    );
  }

  const customerNumber = String(
    customer.customerNumber || customer.customer_number || ""
  ).trim();
  if (!customerNumber) return false;

  const target = normalizeCustomerRef(customerNumber);
  return contactRefFields(contact).some(
    (field) => normalizeCustomerRef(field) === target
  );
}

function zohoRecordContactId(record) {
  if (!record || typeof record !== "object") return null;
  return (
    record.customer_id ??
    record.customer?.customer_id ??
    record.contact_id ??
    null
  );
}

/** Keep only invoices that belong to the resolved Zoho contact. */
function filterZohoInvoicesForContact(invoices, contactId, customer = null) {
  const id = contactId != null ? String(contactId) : null;
  if (!id) return [];

  const customerNumber = customer
    ? normalizeCustomerRef(
        customer.customerNumber || customer.customer_number || ""
      )
    : null;

  return (invoices || []).filter((inv) => {
    const invContactId = zohoRecordContactId(inv);
    if (invContactId && String(invContactId) !== id) return false;

    if (customerNumber && isB2BCustomer(customer)) {
      const refs = [
        inv.order_number,
        inv.salesorder_number,
        inv.reference_number,
        inv.invoice_number,
      ]
        .filter(Boolean)
        .map(normalizeCustomerRef);
      if (refs.length && !refs.some((ref) => ref.includes(customerNumber))) {
        return false;
      }
    }

    return true;
  });
}

/** Keep only payments that belong to the resolved Zoho contact. */
function filterZohoPaymentsForContact(payments, contactId) {
  const id = contactId != null ? String(contactId) : null;
  if (!id) return [];

  return (payments || []).filter((payment) => {
    const paymentContactId = zohoRecordContactId(payment);
    if (!paymentContactId) return true;
    return String(paymentContactId) === id;
  });
}

module.exports = {
  normalizeCustomerRef,
  looksLikeCustomerNumber,
  zohoContactMatchesDashboardCustomer,
  filterZohoInvoicesForContact,
  filterZohoPaymentsForContact,
  zohoRecordContactId,
};
