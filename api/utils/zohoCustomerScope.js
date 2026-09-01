const moment = require("moment-timezone");
const { isB2BCustomer } = require("./b2bBilling");

const DEFAULT_TZ = process.env.TZ || "Africa/Nairobi";
const CONTACT_AGE_SKEW_MS = 120_000;

function contactCreatedRaw(contact) {
  return contact?.created_time || contact?.created_at || null;
}

function customerCreatedRaw(customer) {
  return customer?.createdAt || customer?.created_at || null;
}

function invoiceIssuedRaw(invoice) {
  return invoice?.created_time || invoice?.date || invoice?.createdAt || null;
}

/**
 * Calendar day in the billing timezone. Date-only Zoho values (`YYYY-MM-DD`)
 * stay as that civil date — they must not be parsed as UTC midnight, which
 * makes a same-day signup invoice look older than the customer row.
 */
function calendarDateInTz(value, timeZone = DEFAULT_TZ) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return moment(value).tz(timeZone).format("YYYY-MM-DD");
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = moment.tz(raw, timeZone);
  if (!parsed.isValid()) return null;
  return parsed.format("YYYY-MM-DD");
}

/**
 * True when a Zoho contact predates this dashboard customer — i.e. it belonged
 * to a former apartment tenant (or was wrongly reactivated for the new one).
 */
function isZohoContactOlderThanCustomer(
  contact,
  customer,
  skewMs = CONTACT_AGE_SKEW_MS
) {
  const customerCreated = customerCreatedRaw(customer);
  const contactCreated = contactCreatedRaw(contact);
  if (!customerCreated || !contactCreated) return false;
  const custMs = new Date(customerCreated).getTime();
  const zohoMs = new Date(contactCreated).getTime();
  if (Number.isNaN(custMs) || Number.isNaN(zohoMs)) return false;
  return zohoMs < custMs - skewMs;
}

function invoicesPredateCustomer(invoices, customer, timeZone = DEFAULT_TZ) {
  const custDate = calendarDateInTz(customerCreatedRaw(customer), timeZone);
  if (!custDate) return false;
  return (invoices || []).some((inv) => {
    const invDate = calendarDateInTz(invoiceIssuedRaw(inv), timeZone);
    return Boolean(invDate && invDate < custDate);
  });
}

/**
 * True when the linked Zoho contact still looks like the previous tenant's
 * record (old contact and/or invoices from an earlier calendar day).
 * A contact created for this tenant is never "reused", even on a unit that
 * previously had a cancelled occupant.
 */
function zohoContactLooksReusedByFormerTenant(
  contact,
  customer,
  invoices,
  timeZone = DEFAULT_TZ
) {
  if (!invoicesPredateCustomer(invoices, customer, timeZone)) return false;
  if (contactCreatedRaw(contact) && !isZohoContactOlderThanCustomer(contact, customer)) {
    return false;
  }
  return true;
}

/**
 * Hide invoices issued on an earlier calendar day than this tenant.
 * Same-day signup invoices stay visible. The replace-contact banner is a
 * separate check (`zohoContactLooksReusedByFormerTenant`).
 */
function filterInvoicesForCurrentTenant(
  invoices,
  customer,
  { isChangeover = false, timeZone = DEFAULT_TZ } = {}
) {
  const list = invoices || [];
  if (!isChangeover) return list;
  const custDate = calendarDateInTz(customerCreatedRaw(customer), timeZone);
  if (!custDate) return list;
  return list.filter((inv) => {
    const invDate = calendarDateInTz(invoiceIssuedRaw(inv), timeZone);
    if (!invDate) return true;
    return invDate >= custDate;
  });
}

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

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

/** True when two phone strings share the same significant digits (last 9+). */
function phonesMatch(a, b) {
  const left = normalizePhoneDigits(a);
  const right = normalizePhoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const tail = (d) => (d.length >= 9 ? d.slice(-9) : d);
  return tail(left) === tail(right) && Math.min(left.length, right.length) >= 9;
}

function looksLikePhoneKey(value) {
  const s = String(value || "").trim();
  if (!s || s.includes("@")) return false;
  const digits = normalizePhoneDigits(s);
  return (
    digits.length >= 9 &&
    digits.length <= 15 &&
    /^[\d\s+\-().]+$/.test(s)
  );
}

function contactRefFields(contact) {
  return [
    contact?.company_name,
    contact?.contact_name,
    contact?.customer_name,
  ].filter(Boolean);
}

/**
 * Soft identity match for onboarding: email or phone, even when company_name
 * does not yet equal our customer number (pre-existing Zoho contacts).
 * Rejects contacts whose company_name is a different customer number.
 */
function zohoContactMatchesCustomerIdentity(contact, customer) {
  if (!contact?.contact_id || !customer) return false;

  const company = String(contact.company_name || "").trim();
  const ourNumber = String(
    customer.customerNumber || customer.customer_number || ""
  ).trim();
  if (
    looksLikeCustomerNumber(company) &&
    ourNumber &&
    normalizeCustomerRef(company) !== normalizeCustomerRef(ourNumber)
  ) {
    return false;
  }

  const custEmail = String(customer.email || "")
    .trim()
    .toLowerCase();
  const contactEmail = String(contact.email || "")
    .trim()
    .toLowerCase();
  if (custEmail && contactEmail && custEmail === contactEmail) {
    return true;
  }

  const custPhone =
    customer.phone || customer.mobile || customer.phoneNumber || null;
  if (
    phonesMatch(custPhone, contact.phone) ||
    phonesMatch(custPhone, contact.mobile)
  ) {
    return true;
  }

  return false;
}

/**
 * True when a Zoho contact belongs to this dashboard customer (C2B: company_name
 * must match customer number; B2B: agency name).
 *
 * Stored contact id is trusted only when company_name is empty (legacy Zoho
 * contacts). A leftover agency contact must not keep showing B2B invoices after
 * the house converts to C2B.
 */
function zohoContactMatchesDashboardCustomer(
  contact,
  customer,
  storedContactId = null
) {
  if (!contact?.contact_id || !customer) return false;

  if (isB2BCustomer(customer)) {
    const agency = String(
      customer.agencyName || customer.agency_name || ""
    ).trim();
    if (
      storedContactId &&
      String(contact.contact_id) === String(storedContactId)
    ) {
      return true;
    }
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
  const identityMatch = contactRefFields(contact).some(
    (field) => normalizeCustomerRef(field) === target
  );
  if (identityMatch) return true;

  if (
    storedContactId &&
    String(contact.contact_id) === String(storedContactId)
  ) {
    const company = String(contact.company_name || "").trim();
    // Empty company_name: keep the prior sync link. Any other name that is not
    // this customer number is a different Zoho customer (typically the agency).
    return !company;
  }

  return false;
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
  looksLikePhoneKey,
  phonesMatch,
  normalizePhoneDigits,
  zohoContactMatchesDashboardCustomer,
  zohoContactMatchesCustomerIdentity,
  filterZohoInvoicesForContact,
  filterZohoPaymentsForContact,
  zohoRecordContactId,
  calendarDateInTz,
  isZohoContactOlderThanCustomer,
  invoicesPredateCustomer,
  zohoContactLooksReusedByFormerTenant,
  filterInvoicesForCurrentTenant,
};
