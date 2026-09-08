/**
 * Zoho Books contact-person helpers.
 *
 * Payment reminders email the contact persons associated on the invoice
 * (contact_persons / contact_persons_associated), not the customer-level
 * email. Contacts must therefore keep a person with an email, and invoices
 * / recurring profiles must associate those person IDs with email enabled.
 */

function isZohoEmail(value) {
  return String(value || "").trim().includes("@");
}

function isZohoPrimaryContactPerson(value) {
  // Zoho may return boolean, 0/1, or the strings "true"/"false".
  // Never use Boolean(value) — Boolean("false") === true.
  if (value === true || value === 1 || value === "1") return true;
  if (typeof value === "string" && value.trim().toLowerCase() === "true") {
    return true;
  }
  return false;
}

function pickPrimaryZohoContactPerson(contact) {
  const persons = contact?.contact_persons || [];
  if (!Array.isArray(persons) || persons.length === 0) return null;
  return (
    persons.find((p) => isZohoPrimaryContactPerson(p.is_primary_contact)) ||
    persons[0]
  );
}

function buildZohoContactPersonPayload(existingContact, personFields) {
  const existingPerson = pickPrimaryZohoContactPerson(existingContact);
  // Zoho rejects is_primary_contact:false on contact PUT for many orgs —
  // only send true on the designated primary person.
  const person = { ...personFields, is_primary_contact: true };
  if (existingPerson?.contact_person_id) {
    person.contact_person_id = existingPerson.contact_person_id;
  }
  return person;
}

/**
 * Zoho deletes omitted contact_persons on PUT. Preserve non-primary persons
 * so updates do not look like deletes (error 3043 on contacts with recurring invoices).
 *
 * Do not send is_primary_contact:false — Zoho returns code 2
 * "Invalid value passed for is_primary_contact" for that on contact updates
 * (seen on apartment moves when billing CC persons are preserved).
 */
function buildZohoContactPersonsPayload(existingContact, primaryFields) {
  const persons = Array.isArray(existingContact?.contact_persons)
    ? existingContact.contact_persons
    : [];
  const primary = buildZohoContactPersonPayload(existingContact, primaryFields);
  if (persons.length <= 1) return [primary];

  const primaryId = primary.contact_person_id
    ? String(primary.contact_person_id)
    : null;
  return persons.map((p) => {
    const id = p?.contact_person_id ? String(p.contact_person_id) : null;
    const isPrimaryRow =
      (primaryId && id === primaryId) ||
      (!primaryId && isZohoPrimaryContactPerson(p.is_primary_contact));
    if (isPrimaryRow) {
      return primary;
    }
    const secondary = {
      contact_person_id: p.contact_person_id,
      first_name: p.first_name || "",
      last_name: p.last_name || "",
    };
    if (p.email) secondary.email = p.email;
    if (p.phone) secondary.phone = p.phone;
    if (p.mobile || p.phone) secondary.mobile = p.mobile || p.phone;
    // Intentionally omit is_primary_contact on secondaries.
    return secondary;
  });
}

function uniqueContactPersonIds(ids) {
  return [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
}

/**
 * Contact person IDs Zoho can email for invoice communications / reminders.
 * Only persons with an email qualify — associating a person without one
 * produces: "you haven't associated the contact person's email address".
 */
function invoiceEmailContactPersonIds(contact) {
  const persons = Array.isArray(contact?.contact_persons)
    ? contact.contact_persons
    : [];
  const withEmail = persons.filter(
    (p) => p?.contact_person_id && isZohoEmail(p.email)
  );
  if (!withEmail.length) return [];

  const primary = pickPrimaryZohoContactPerson(contact);
  const primaryId =
    primary?.contact_person_id && isZohoEmail(primary.email)
      ? String(primary.contact_person_id)
      : null;
  const rest = withEmail
    .map((p) => String(p.contact_person_id))
    .filter((id) => id !== primaryId);
  return uniqueContactPersonIds(primaryId ? [primaryId, ...rest] : rest);
}

function buildInvoiceEmailContactPersonsPayload(contactPersonIds) {
  const ids = uniqueContactPersonIds(contactPersonIds);
  if (!ids.length) return null;
  return {
    contact_persons: ids,
    contact_persons_associated: ids.map((contact_person_id) => ({
      contact_person_id,
      communication_preference: { is_email_enabled: true },
    })),
  };
}

function invoiceAlreadyHasEmailContactPersons(invoice, personIds = []) {
  const associated = invoice?.contact_persons_associated;
  if (Array.isArray(associated) && associated.length) {
    return associated.some(
      (p) =>
        p?.communication_preference?.is_email_enabled !== false &&
        isZohoEmail(p.contact_person_email || p.email)
    );
  }
  const existingIds = Array.isArray(invoice?.contact_persons)
    ? invoice.contact_persons.map(String)
    : [];
  if (!existingIds.length) return false;
  const wanted = new Set(uniqueContactPersonIds(personIds));
  if (wanted.size) return existingIds.some((id) => wanted.has(String(id)));
  return true;
}

const OPEN_REMINDER_INVOICE_STATUSES = new Set([
  "draft",
  "sent",
  "viewed",
  "unpaid",
  "overdue",
  "partially_paid",
]);

function isOpenReminderInvoice(invoice) {
  if (!invoice?.invoice_id) return false;
  const status = String(invoice.status || "").trim().toLowerCase();
  if (status.includes("void") || status === "paid" || status === "written_off") {
    return false;
  }
  const balance = Number(invoice.balance ?? invoice.balanceDue ?? 0);
  if (Number.isFinite(balance) && balance > 0) return true;
  return OPEN_REMINDER_INVOICE_STATUSES.has(status);
}

module.exports = {
  isZohoEmail,
  isZohoPrimaryContactPerson,
  pickPrimaryZohoContactPerson,
  buildZohoContactPersonPayload,
  buildZohoContactPersonsPayload,
  invoiceEmailContactPersonIds,
  buildInvoiceEmailContactPersonsPayload,
  invoiceAlreadyHasEmailContactPersons,
  isOpenReminderInvoice,
};
