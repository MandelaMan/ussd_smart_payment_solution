const { query } = require("../config/db");
const {
  getTISPCustomer,
  postSetClientDetails,
  buildTispCreateClientPayload,
  buildTispUpdateClientDetailsPayload,
  resolveTispPackageType,
  formatTispError,
  accountExistsOnTisp,
  formatTispDueDate,
  isTispDuplicateAccountError,
  isTispAccountMissingError,
  extractTispClientAccountId,
  hasLocalTispAccountEvidence,
  shouldAllowTispCreateFallback,
} = require("./tisp.controller");
const store = require("../services/customerModuleStore");
const oltEmsService = require("../services/oltEmsService");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const { onboardNewCustomerBilling } = require("../services/customerBillingOnboarding");
const { logActivity } = require("../services/activityLogStore");
const {
  buildCustomerImportTemplateCsv,
  parseCustomerImportCsv,
} = require("../utils/customerImportTemplate");
const {
  calculateUpgradeQuote,
  calculateDowngradeQuote,
  estimateDueDateFromLastPayment,
  recommendPaymentMethod,
} = require("../utils/upgradeQuote");
const {
  TISP_STANDARD_DUE_DATE,
  TISP_RELEASE_PLACEHOLDER_IP,
  TISP_PPOE_PLACEHOLDER_STATIC_IP,
  isTispPlaceholderIp,
} = require("../utils/tispConstants");
const {
  DEFAULT_TZ,
  computeTrialEndDate,
  computeInvoiceDueDate,
  computeSignupRecurringWindow,
  resolveTispDueDateForEditBilling,
  resolveZohoPaymentTerms,
} = require("../utils/billingPeriod");
const {
  isDstvOnlyCategory,
} = require("../services/packageCatalogStore");
const moment = require("moment-timezone");
const {
  classifyPackageChangeByPrice,
  resolveBaselinePriceAtFrequency,
} = require("../utils/packageChange");
const { initiateSTKPush } = require("./mpesa.controller");
const {
  getCustomerByCompanyName_JS,
  findContactByLookupKeys_JS,
  createInvoice_JS,
  createCreditNote_JS,
  createContact_JS,
  getInvoices_JS,
  getCustomerPayments_JS,
  getRecurringInvoices_JS,
  stopRecurringInvoice_JS,
  voidInvoice_JS,
  updateRecurringInvoice_JS,
  markContactInactive_JS,
  invalidateZohoContactLookupCache,
} = require("./zoho.controller");
const zohoEntityRepo = require("../repositories/zohoEntity.repository");
const pendingUpgradeStore = require("../services/pendingUpgradeStore");
const {
  normalizeSubscriptionStatus,
} = require("../utils/subscriptionStatus");
const { listUnifiedTransactions } = require("./admin.controller");
const { mapWithConcurrency } = require("../utils/mapWithConcurrency");
const syncCooldown = require("../utils/syncCooldown");
const {
  getCachedCustomerZoho,
  setCachedCustomerZoho,
  invalidateCustomerZoho,
} = require("../utils/zohoInvoiceCache");
const { sendTableExport } = require("../utils/tableExportResponse");
const { alternateTypeCustomerNumber } = require("../utils/customerNumber");
const {
  formatDateOnly,
  pickLatestPaymentDate,
  lastPaymentFromZohoInvoices,
  lastPaymentFromZohoPayments,
} = require("../utils/lastPaymentDate");
const {
  computePauseCredit,
  nextRecurringStartAfterPause,
} = require("../utils/pauseCredit");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  resolveAgencyForCustomer,
  filterAgencyInvoicesForCustomer,
  resolveEffectiveCustomerEmail,
  resolveEffectiveCustomerPhone,
  resolveInvoiceEmail,
  resolveInvoicePhone,
  b2bBillingMeta,
} = require("../utils/b2bBilling");
const {
  filterZohoInvoicesForContact,
  filterZohoPaymentsForContact,
  zohoContactMatchesDashboardCustomer,
  isZohoContactOlderThanCustomer,
  invoicesPredateCustomer,
  zohoContactLooksReusedByFormerTenant,
  filterInvoicesForCurrentTenant,
} = require("../utils/zohoCustomerScope");
const {
  summarizeOverdueZohoInvoices,
  selectOverdueZohoInvoicesToVoid,
} = require("../utils/zohoInvoiceStatus");
const { emitAdminUpdate } = require("../lib/adminEvents");

function notifyCustomersChanged(customerId, action = "updated") {
  emitAdminUpdate("customers", {
    action,
    customerId: customerId != null ? Number(customerId) : null,
  });
}

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";
const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;

async function findZohoContactForCustomer(customer, options = {}) {
  const keys = getZohoContactLookupKeys(customer);
  const prev = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim()
    : "";
  // After apartment move, Zoho company_name is still the old number until we
  // update it — look that up first so we refresh the same contact.
  if (prev) {
    const prevUpper = prev.toUpperCase();
    const withoutPrev = keys.filter(
      (k) => String(k).trim().toUpperCase() !== prevUpper
    );
    keys.length = 0;
    keys.push(prev, ...withoutPrev);
  }
  const identityFallback =
    options.identityFallback === false
      ? false
      : options.identityFallback === true || Boolean(prev);
  return findContactByLookupKeys_JS(keys, {
    customer,
    identityFallback,
    previousCustomerNumber: prev || undefined,
  });
}

/** Load Zoho contact by stored snapshot id first, then live lookup. */
async function loadZohoContactForCustomer(customer) {
  const customerId = customer?.id ? Number(customer.id) : null;
  const { getContactFull_JS } = require("./zoho.controller");

  let storedContactId = null;
  if (customerId) {
    storedContactId = await integrationSnapshot.getStoredZohoContactId(customerId);
    if (storedContactId) {
      const byStoredId = await getContactFull_JS(storedContactId);
      if (byStoredId?.contact_id) {
        return { contact: byStoredId, storedContactId, fromSnapshot: true };
      }
    }
  }

  const contact = await findZohoContactForCustomer(customer);
  if (contact?.contact_id) {
    if (customerId) {
      try {
        const full =
          (await getContactFull_JS(contact.contact_id)) || contact;
        await integrationSnapshot.upsertZohoContact(customerId, full);
      } catch {
        /* best-effort */
      }
    }
    return {
      contact,
      storedContactId: storedContactId || String(contact.contact_id),
      fromSnapshot: false,
    };
  }

  return null;
}

function formatZohoPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

/** Title-case a person name part — "JOHN" / "john" → "John" (not ALL CAPS). */
function capitalizeZohoPersonName(value) {
  const trimmed = String(value || "").trim();
  // TISP uses "-" as empty-name placeholder — never forward that to Zoho.
  if (!trimmed || trimmed === "-") return "";
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Resolve and title-case person name fields from camelCase or snake_case customer objects. */
function resolveZohoPersonNames(customer) {
  const blankToEmpty = (v) => {
    const s = String(v ?? "").trim();
    return !s || s === "-" ? "" : s;
  };
  let first = blankToEmpty(customer?.firstName ?? customer?.first_name);
  let middle = blankToEmpty(customer?.middleName ?? customer?.middle_name);
  let last = blankToEmpty(customer?.lastName ?? customer?.last_name);

  if (!String(first).trim() && !String(last).trim()) {
    const full = String(
      customer?.fullName ??
        customer?.full_name ??
        customer?.customerName ??
        customer?.customer_name ??
        ""
    ).trim();
    if (full) {
      const parts = full.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        first = parts[0];
        last = parts[0];
      } else if (parts.length === 2) {
        first = parts[0];
        last = parts[1];
      } else {
        first = parts[0];
        middle = parts.slice(1, -1).join(" ");
        last = parts[parts.length - 1];
      }
    }
  }

  return {
    firstName: capitalizeZohoPersonName(first),
    middleName: capitalizeZohoPersonName(middle),
    lastName: capitalizeZohoPersonName(last),
  };
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
  return persons.find((p) => isZohoPrimaryContactPerson(p.is_primary_contact)) || persons[0];
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

const { buildZohoBillingAddress } = require("../utils/zohoBillingAddress");

async function buildZohoContactPayload(customer, existingContact = null) {
  const { firstName, middleName, lastName } = resolveZohoPersonNames(customer);
  const displayName = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  const isB2B = isB2BCustomer(customer);
  const customerNumber = String(
    customer.customerNumber || customer.customer_number || ""
  ).trim();

  // C2B: company_name = customer number (lookup key). contact_name (Display Name)
  // = person name when available. enforceZohoCompanyName re-asserts company_name
  // if Zoho copies Display Name into Company Name.
  const companyName = isB2B
    ? String(customer.agencyName || customer.agency_name || "").trim()
    : customerNumber;

  if (!companyName) {
    throw new Error(
      isB2B
        ? "Agency name is required before syncing to Zoho Books"
        : "Customer number is required before syncing to Zoho Books"
    );
  }

  const contactDisplayName = isB2B
    ? companyName
    : displayName || companyName;

  const payload = {
    contact_name: contactDisplayName,
    company_name: companyName,
    contact_type: "customer",
    customer_sub_type: "business",
  };

  let phone = formatZohoPhone(resolveEffectiveCustomerPhone(customer));
  let email = customer.email ? String(customer.email).trim() : undefined;

  if (isB2B && (customer.agencyId || customer.agency_id)) {
    const agency = await store.getAgencyById(
      customer.agencyId || customer.agency_id
    );
    if (agency) {
      phone =
        formatZohoPhone(resolveInvoicePhone(customer, agency)) || phone;
      email = resolveInvoiceEmail(customer, agency) || email;
    }
  }

  if (phone) {
    payload.phone = phone;
    payload.mobile = phone;
  }
  if (email) payload.email = email;

  const billingAddress = buildZohoBillingAddress(customer);
  if (billingAddress) {
    payload.billing_address = billingAddress;
  }

  if (!isB2B && (firstName || lastName || displayName)) {
    payload.contact_persons = buildZohoContactPersonsPayload(existingContact, {
      first_name: firstName || displayName,
      last_name: lastName || firstName || displayName,
      email,
      phone,
      mobile: phone,
    });
  } else if (isB2B && displayName && displayName !== companyName) {
    payload.contact_persons = buildZohoContactPersonsPayload(existingContact, {
      first_name: firstName || displayName,
      last_name: lastName || companyName,
      email,
      phone,
      mobile: phone,
    });
  }

  return payload;
}

/**
 * True apartment changeover: a cancelled local tenant was archived as
 * {number}-CXL-{id} so this live number could be reused. Imports / long Zoho
 * history alone must NOT count (no -CXL- predecessor).
 */
async function customerHasPriorCancelledTenant(customer) {
  const number = String(
    customer?.customerNumber || customer?.customer_number || ""
  ).trim();
  if (!number || /-CXL-\d+$/i.test(number)) return false;

  const base = number.toUpperCase().replace(/-CXL-\d+$/i, "");
  if (!base) return false;

  const excludeId = customer?.id != null ? Number(customer.id) : null;
  const formerId = await store.findArchivedCancelledTenantIdForNumber(
    base,
    excludeId
  );
  return Boolean(formerId);
}

/**
 * Rename Zoho company_name to the cancelled BIX number ({POP}-{APT}-CXL-{id},
 * e.g. ET-H302-CXL-237), stop recurring, mark inactive. Frees the live
 * apartment number for a new Zoho customer + invoices.
 */
async function retireFormerZohoTenantContact(contact, options = {}) {
  if (!contact?.contact_id) return null;

  const {
    updateContact_JS,
    getContactFull_JS,
  } = require("./zoho.controller");
  const { normalizeCustomerRef } = require("../utils/zohoCustomerScope");

  const liveNumber = String(
    options.customerNumber || contact.company_name || ""
  )
    .trim()
    .toUpperCase()
    .replace(/-CXL-\d+$/i, "");

  let formerId = options.formerCustomerId
    ? Number(options.formerCustomerId)
    : null;
  if (!formerId || !Number.isFinite(formerId) || formerId <= 0) {
    formerId = await store.findMostRecentCancelledTenantIdForNumber(
      liveNumber,
      options.excludeCustomerId || null
    );
  }
  if (!formerId || !Number.isFinite(formerId) || formerId <= 0) {
    formerId = Number(String(Date.now()).slice(-8));
  }

  // Prefer the cancelled row's actual BIX number (already ET-H302-CXL-237 after
  // the new tenant claimed the apartment) so Zoho matches BIX exactly.
  let archivedCompany = options.archivedCompanyName
    ? String(options.archivedCompanyName).trim().toUpperCase()
    : null;
  if (!archivedCompany && formerId) {
    try {
      const former = await store.getCustomerById(formerId);
      const formerNumber = String(former?.customerNumber || "").trim().toUpperCase();
      if (formerNumber && /-CXL-\d+$/i.test(formerNumber)) {
        archivedCompany = formerNumber;
      }
    } catch {
      /* fall through */
    }
  }
  if (!archivedCompany) {
    archivedCompany = store.archiveCancelledCustomerNumber(
      liveNumber,
      formerId
    );
  }

  const linkedCustomerIds = await integrationSnapshot
    .listCustomerIdsByZohoContactId(contact.contact_id)
    .catch(() => []);

  try {
    await stopZohoRecurringForCustomer(contact.contact_id, liveNumber);
  } catch (e) {
    console.warn(
      `retire Zoho tenant: stop recurring failed for ${liveNumber}:`,
      e.message || e
    );
  }

  let updatedContact = null;
  try {
    const full = (await getContactFull_JS(contact.contact_id)) || contact;
    const displayName = String(
      full.contact_name || full.customer_name || archivedCompany
    ).trim();
    await updateContact_JS(contact.contact_id, {
      contact_type: "customer",
      customer_sub_type: "business",
      company_name: archivedCompany,
      contact_name: displayName.includes("(former)")
        ? displayName
        : `${displayName} (former)`.slice(0, 200),
    });
    updatedContact = await getContactFull_JS(contact.contact_id);
  } catch (e) {
    console.warn(
      `retire Zoho tenant: rename ${liveNumber} → ${archivedCompany} failed:`,
      e.message || e
    );
  }

  try {
    await markContactInactive_JS(contact.contact_id);
    updatedContact =
      (await getContactFull_JS(contact.contact_id)) || updatedContact;
  } catch (e) {
    console.warn(
      `retire Zoho tenant: mark inactive failed for ${contact.contact_id}:`,
      e.message || e
    );
  }

  invalidateZohoContactLookupCache(liveNumber);
  invalidateZohoContactLookupCache(contact.company_name);
  invalidateZohoContactLookupCache(archivedCompany);

  // Keep cancelled tenants linked to the archived inactive contact; clear the
  // link for any other (active) dashboard customer so they get a fresh Zoho contact.
  const archivePayload = {
    ...(updatedContact && typeof updatedContact === "object"
      ? updatedContact
      : { contact_id: contact.contact_id }),
    contact_id: contact.contact_id,
    company_name: archivedCompany,
    status: "inactive",
  };

  for (const linkedId of linkedCustomerIds) {
    try {
      if (
        options.excludeCustomerId &&
        Number(linkedId) === Number(options.excludeCustomerId)
      ) {
        await integrationSnapshot.clearZohoContact(linkedId);
        invalidateCustomerZoho(linkedId);
        continue;
      }
      const linked = await store.getCustomerById(linkedId);
      if (String(linked?.status || "").toLowerCase() === "cancelled") {
        await integrationSnapshot.upsertZohoContact(linkedId, archivePayload);
      } else if (
        normalizeCustomerRef(linked?.customerNumber) ===
        normalizeCustomerRef(liveNumber)
      ) {
        // Active tenant who was wrongly sharing this contact — clear so onboard creates new.
        await integrationSnapshot.clearZohoContact(linkedId);
      } else {
        await integrationSnapshot.upsertZohoContact(linkedId, archivePayload);
      }
      invalidateCustomerZoho(linkedId);
    } catch (e) {
      console.warn(
        `retire Zoho tenant: snapshot update failed for customer ${linkedId}:`,
        e.message || e
      );
    }
  }

  // Ensure the cancelled former row is snapshotted even if it was not linked yet.
  if (formerId && !linkedCustomerIds.includes(Number(formerId))) {
    try {
      await integrationSnapshot.upsertZohoContact(formerId, archivePayload);
      invalidateCustomerZoho(formerId);
    } catch {
      /* best-effort */
    }
  }

  return {
    contactId: String(contact.contact_id),
    previousCompanyName: liveNumber,
    archivedCompanyName: archivedCompany,
    formerCustomerId: formerId,
  };
}

/**
 * Zoho sometimes ignores company_name on the first write (especially when the
 * contact was created as Individual). Force company_name + business subtype
 * without overwriting Display Name (contact_name).
 */
async function enforceZohoCompanyName(contactId, expectedCompanyName, getContactFull_JS, updateContact_JS) {
  const expected = String(expectedCompanyName || "").trim();
  if (!contactId || !expected) return null;

  const { normalizeCustomerRef } = require("../utils/zohoCustomerScope");
  const expectedNorm = normalizeCustomerRef(expected);

  let contact = await getContactFull_JS(contactId);
  const currentCompany = String(contact?.company_name || "").trim();
  const subtype = String(contact?.customer_sub_type || "").toLowerCase();

  const companyOk = normalizeCustomerRef(currentCompany) === expectedNorm;
  const subtypeOk = subtype === "business";

  if (companyOk && subtypeOk) return contact;

  // Step 1: switch to business if needed (Individual often blocks company_name).
  if (!subtypeOk) {
    await updateContact_JS(contactId, {
      contact_type: "customer",
      customer_sub_type: "business",
      company_name: expected,
    });
  }

  // Step 2: re-assert company_name only — keep person Display Name intact.
  await updateContact_JS(contactId, {
    contact_type: "customer",
    customer_sub_type: "business",
    company_name: expected,
  });

  contact = await getContactFull_JS(contactId);
  const afterCompany = String(contact?.company_name || "").trim();
  if (normalizeCustomerRef(afterCompany) !== expectedNorm) {
    throw new Error(
      `Zoho company_name did not update (expected "${expected}", got "${afterCompany || "(empty)"}")`
    );
  }
  return contact;
}

async function ensureZohoContactForCustomer(customer, options = {}) {
  if (isB2BCustomer(customer)) {
    const { ensureZohoContactForAgency } = require("./agencies.controller");
    const agency = await resolveAgencyForCustomer(customer, store);
    return ensureZohoContactForAgency(agency);
  }

  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim().toUpperCase()
    : null;
  // New apartment tenants must not reuse the cancelled tenant's Zoho contact /
  // invoices. Apartment moves keep previousCustomerNumber and still update.
  const replaceFormerTenant =
    options.replaceFormerTenant === true && !previousCustomerNumber;
  const skipStoredContact = options.skipStoredContact === true;
  const excludeContactIds = new Set(
    (options.excludeContactIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const identityFallback =
    options.identityFallback !== false && !replaceFormerTenant;

  function isExcludedContact(contact) {
    const id = contact?.contact_id ? String(contact.contact_id) : "";
    return Boolean(id && excludeContactIds.has(id));
  }

  const { updateContact_JS, getSpecificCustomer_JS, getContactFull_JS, markContactActive_JS } = require("./zoho.controller");

  function markCreated(contact, created) {
    if (contact && typeof contact === "object") {
      Object.defineProperty(contact, "_wasCreated", {
        value: Boolean(created),
        enumerable: false,
        configurable: true,
      });
      if (options._retiredFormer) {
        Object.defineProperty(contact, "_retiredFormerTenant", {
          value: options._retiredFormer,
          enumerable: false,
          configurable: true,
        });
      }
    }
    return contact;
  }

  async function loadContactForUpdate(contactId) {
    const full = await getContactFull_JS(contactId);
    if (full?.contact_id) return full;
    const lean = await getSpecificCustomer_JS(String(contactId));
    return lean && typeof lean === "object" && lean.contact_id ? lean : null;
  }

  async function shouldRetireContact(existing) {
    if (!replaceFormerTenant || !existing?.contact_id) return false;
    let contact = existing;
    if (!contact.created_time) {
      contact = (await loadContactForUpdate(existing.contact_id)) || existing;
    }
    if (String(contact.status || "").toLowerCase() === "inactive") {
      return true;
    }
    const company = String(contact.company_name || "").trim().toUpperCase();
    if (/-CXL-\d+$/i.test(company)) return true;

    // Only force-retire when this apartment actually had a cancelled tenant
    // archived for reuse — not for imports with older Zoho invoice history.
    const hasChangeover = await customerHasPriorCancelledTenant(customer);
    if (!hasChangeover) return false;

    // Former tenant contact (even if reactivated + details updated for the new person).
    if (isZohoContactOlderThanCustomer(contact, customer)) {
      return true;
    }
    // A contact created for this tenant is not a reuse. Do not retire it just
    // because a same-day signup invoice looks older under UTC date parsing.
    if (contact.created_time || contact.created_at) {
      return false;
    }
    // created_time missing — fall back to invoice calendar dates.
    if (customer.createdAt || customer.created_at) {
      try {
        const { getInvoices_JS } = require("./zoho.controller");
        const invoices = await getInvoices_JS({
          customer_id: contact.contact_id,
          per_page: 50,
          page: 1,
        });
        if (invoicesPredateCustomer(invoices, customer)) {
          return true;
        }
      } catch {
        /* ignore — fall through */
      }
    }
    return false;
  }

  async function retireIfFormer(existing) {
    if (!(await shouldRetireContact(existing))) return false;
    const retired = await retireFormerZohoTenantContact(existing, {
      customerNumber:
        customer.customerNumber || customer.customer_number || existing.company_name,
      excludeCustomerId: customer.id,
      formerCustomerId: options.formerCustomerId,
    });
    options._retiredFormer = retired;
    return true;
  }

  async function refreshExisting(existing) {
    if (!existing?.contact_id || isExcludedContact(existing)) {
      return null;
    }
    if (await retireIfFormer(existing)) {
      return null; // caller creates a new contact
    }

    let contactBase = existing;
    // Reactivate inactive Zoho contacts when linking an active dashboard customer
    // so we update the existing record instead of creating a duplicate.
    // (Skipped for replaceFormerTenant — those contacts are retired above.)
    if (
      String(existing.status || "").toLowerCase() === "inactive" &&
      existing.contact_id
    ) {
      try {
        const activated = await markContactActive_JS(existing.contact_id);
        if (activated?.contact_id || activated?.status) {
          contactBase = {
            ...existing,
            ...(activated.contact_id ? activated : {}),
            status: activated.status || "active",
          };
        } else {
          contactBase = { ...existing, status: "active" };
        }
      } catch (e) {
        console.warn(
          "Zoho contact reactivate failed:",
          e.message || e
        );
      }
    }

    try {
      const fullContact = await loadContactForUpdate(contactBase.contact_id);
      const payload = await buildZohoContactPayload(
        customer,
        fullContact || contactBase
      );
      await updateContact_JS(contactBase.contact_id, payload);

      const expectedCompany = String(
        customer.customerNumber || customer.customer_number || ""
      ).trim();
      const afterUpdate =
        (await enforceZohoCompanyName(
          contactBase.contact_id,
          expectedCompany,
          getContactFull_JS,
          updateContact_JS
        )) ||
        (await getContactFull_JS(contactBase.contact_id)) ||
        fullContact ||
        contactBase;

      if (customer.id) {
        await integrationSnapshot.upsertZohoContact(customer.id, afterUpdate);
      }
      return markCreated(afterUpdate, false);
    } catch (e) {
      console.warn("Zoho contact refresh failed:", e.message);
      throw e;
    }
  }

  // Prefer stored Zoho contact id — works even when company_name is empty in Books.
  // B2B → C2B conversion skips this so we never refresh the agency contact.
  if (customer.id && !skipStoredContact) {
    try {
      const snapId = await integrationSnapshot.getStoredZohoContactId(customer.id);
      if (snapId && !excludeContactIds.has(String(snapId))) {
        const byId = await loadContactForUpdate(snapId);
        if (byId?.contact_id && !isExcludedContact(byId)) {
          const refreshed = await refreshExisting(byId);
          if (refreshed) return refreshed;
          // Former tenant retired — fall through to create.
        }
      }
    } catch {
      /* fall through to live lookup */
    }
  }

  // Live lookup by previous number (apartment move) / customer number / email /
  // phone / name — update if found, never duplicate (unless replacing tenant).
  const existing = await findZohoContactForCustomer(customer, {
    identityFallback,
    previousCustomerNumber: previousCustomerNumber || undefined,
  });
  if (existing?.contact_id && !isExcludedContact(existing)) {
    const refreshed = await refreshExisting(existing);
    if (refreshed) return refreshed;
  }

  const payload = await buildZohoContactPayload(customer);
  let created = null;
  try {
    created = await createContact_JS(payload);
  } catch (e) {
    // Duplicate / race: resolve the existing contact and update it instead.
    // If it is still a former tenant, retire and retry create once.
    const retry = await findZohoContactForCustomer(customer, {
      identityFallback,
      previousCustomerNumber: previousCustomerNumber || undefined,
    });
    if (retry?.contact_id && !isExcludedContact(retry)) {
      const refreshed = await refreshExisting(retry);
      if (refreshed) return refreshed;
      try {
        created = await createContact_JS(payload);
      } catch (retryErr) {
        throw new Error(
          `Zoho contact creation failed: ${
            retryErr.response?.data?.message || retryErr.message
          }`
        );
      }
    } else {
      throw new Error(
        `Zoho contact creation failed: ${e.response?.data?.message || e.message}`
      );
    }
  }

  if (created?.contact_id) {
    const expectedCompany = String(
      customer.customerNumber || customer.customer_number || ""
    ).trim();
    let contact = created;
    try {
      contact =
        (await enforceZohoCompanyName(
          created.contact_id,
          expectedCompany,
          getContactFull_JS,
          updateContact_JS
        )) ||
        (await getContactFull_JS(created.contact_id)) ||
        created;
    } catch (e) {
      console.warn("Zoho company_name enforce after create failed:", e.message);
      throw e;
    }
    try {
      if (customer.id) {
        await integrationSnapshot.upsertZohoContact(customer.id, contact);
      }
    } catch (e) {
      console.warn("Zoho contact snapshot failed:", e.message);
    }
    return markCreated(contact, true);
  }

  // Final safety: another create may have won the race.
  const retry = await findZohoContactForCustomer(customer, {
    identityFallback,
    previousCustomerNumber: previousCustomerNumber || undefined,
  });
  if (retry?.contact_id && !isExcludedContact(retry)) {
    const refreshed = await refreshExisting(retry);
    if (refreshed) return refreshed;
  }

  throw new Error("Zoho contact creation returned no contact_id");
}

async function syncCustomerToZoho(customer) {
  try {
    await ensureZohoContactForCustomer(customer);
    if (customer?.id) invalidateCustomerZoho(customer.id);
    return await fetchCustomerZohoInvoices(customer, { skipCache: true });
  } catch (e) {
    return {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
      zohoError: e.message || "Zoho sync failed",
    };
  }
}

async function syncZohoLastPayment(customer, zohoContactId, rawInvoices) {
  if (!customer?.customerNumber || !zohoContactId) return null;

  const { getCustomerPayments_JS } = require("./zoho.controller");
  const lastFromInvoices = lastPaymentFromZohoInvoices(rawInvoices);
  const payments = await getCustomerPayments_JS({
    customer_id: zohoContactId,
    per_page: 50,
  });
  const lastFromPayments = lastPaymentFromZohoPayments(payments);
  const lastPayment = pickLatestPaymentDate(lastFromInvoices, lastFromPayments);

  if (lastPayment) {
    // Zoho wins — always write this date to the dashboard.
    await store.setCustomerLastPaymentFromZoho(
      customer.customerNumber,
      lastPayment
    );
  }

  return lastPayment;
}

async function fetchCustomerZohoInvoices(customer, options = {}) {
  const { loadEnv } = require("../config/env");
  const env = loadEnv();
  const customerId = Number(customer?.id);
  const forceRefresh = options.skipCache === true || options.refresh === true;
  const cacheMaxAgeHours = env.CUSTOMER_CACHE_DURATION_SECONDS / 3600;

  if (customerId && !forceRefresh && !isB2BCustomer(customer)) {
    const cached = getCachedCustomerZoho(customerId);
    if (cached) return cached;

    try {
      const stored = await integrationSnapshot.loadCustomerBillingSnapshot(customerId, {
        maxAgeHours: cacheMaxAgeHours,
      });
      if (stored.hasData && stored.zohoContactId && !stored.stale) {
        const contactRow = await integrationSnapshot.getZohoContact(customerId);
        const contactRaw =
          contactRow?.raw_json && typeof contactRow.raw_json === "string"
            ? (() => {
                try {
                  return JSON.parse(contactRow.raw_json);
                } catch {
                  return null;
                }
              })()
            : contactRow?.raw_json;
        const contactValid =
          !contactRaw ||
          zohoContactMatchesDashboardCustomer(
            contactRaw,
            customer,
            stored.zohoContactId
          );

        if (contactValid) {
          const mapped = filterZohoInvoicesForContact(
            (stored.invoices || []).map((inv) => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              orderNumber: customer.customerNumber,
              date: inv.date,
              dueDate: inv.dueDate,
              status: inv.status,
              total: inv.total,
              balanceDue: inv.balanceDue,
              currency: "KES",
              customer_id: stored.zohoContactId,
            })),
            stored.zohoContactId,
            customer
          );
          const isChangeover =
            !isB2BCustomer(customer) &&
            (await customerHasPriorCancelledTenant(customer));
          const hasFormerTenantInvoices =
            isChangeover &&
            zohoContactLooksReusedByFormerTenant(contactRaw, customer, mapped);
          const displayMapped = isB2BCustomer(customer)
            ? mapped
            : filterInvoicesForCurrentTenant(mapped, customer, {
                isChangeover,
              });
        const { overdueCount, totalOverdueBalance } =
          summarizeOverdueZohoInvoices(displayMapped);
        const creditBalance = Number(stored.creditBalance) || 0;
        const result = {
          linked: true,
          zohoContactId: stored.zohoContactId,
          invoices: displayMapped,
          invoiceCount: displayMapped.length,
          unpaidCount: overdueCount,
          totalBalanceDue: totalOverdueBalance,
          creditBalance: creditBalance > 0 ? creditBalance : 0,
          hasFormerTenantInvoices,
          formerTenantInvoiceCount: hasFormerTenantInvoices
            ? Math.max(0, mapped.length - displayMapped.length)
            : 0,
          fromSnapshot: true,
          lastSyncedAt: stored.syncedAt,
          cacheFresh: true,
        };
        setCachedCustomerZoho(customerId, result);
        try {
          await store.reconcileZohoBillingStatus(customerId, {
            linked: true,
            invoiceCount: displayMapped.length,
          });
        } catch (e) {
          console.warn("Zoho billing status reconcile failed:", e.message);
        }
        return result;
        }
        invalidateCustomerZoho(customerId);
        try {
          await query(`DELETE FROM zoho_customer_invoices WHERE customer_id = ?`, [
            customerId,
          ]);
          await query(`DELETE FROM zoho_customer_payments WHERE customer_id = ?`, [
            customerId,
          ]);
        } catch {
          /* best-effort cleanup of mismatched snapshot */
        }
      }
    } catch (e) {
      console.warn("Zoho snapshot read failed:", e.message);
    }
  }

  const { getInvoices_JS } = require("./zoho.controller");

  let agency = null;
  if (isB2BCustomer(customer)) {
    try {
      agency = await resolveAgencyForCustomer(customer, store);
    } catch (e) {
      const empty = {
        linked: false,
        zohoContactId: null,
        invoices: [],
        invoiceCount: 0,
        unpaidCount: 0,
        totalBalanceDue: 0,
        zohoError: e.message,
        ...b2bBillingMeta(customer, null),
      };
      if (customerId) setCachedCustomerZoho(customerId, empty);
      return empty;
    }
  }

  let zohoContact = null;
  let storedContactId = customerId
    ? await integrationSnapshot.getStoredZohoContactId(customerId)
    : null;

  const linked = await loadZohoContactForCustomer(
    isB2BCustomer(customer) ? { ...customer, agencyName: agency?.name } : customer
  );
  if (linked?.contact?.contact_id) {
    zohoContact = linked.contact;
    storedContactId = linked.storedContactId || storedContactId;
  }

  if (!zohoContact?.contact_id) {
    const empty = {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
      ...(isB2BCustomer(customer) ? b2bBillingMeta(customer, agency) : {}),
    };
    if (customerId) setCachedCustomerZoho(customerId, empty);
    return empty;
  }

  if (
    !zohoContactMatchesDashboardCustomer(
      zohoContact,
      customer,
      storedContactId
    )
  ) {
    console.warn(
      `[fetchCustomerZohoInvoices] Zoho contact ${zohoContact.contact_id} does not match ${customer.customerNumber}`
    );
    const empty = {
      linked: false,
      zohoContactId: null,
      invoices: [],
      invoiceCount: 0,
      unpaidCount: 0,
      totalBalanceDue: 0,
      zohoError: "Zoho contact does not match this customer number",
      ...(isB2BCustomer(customer) ? b2bBillingMeta(customer, agency) : {}),
    };
    if (customerId) {
      try {
        await query(`DELETE FROM zoho_customer_invoices WHERE customer_id = ?`, [
          customerId,
        ]);
        await query(`DELETE FROM zoho_customer_payments WHERE customer_id = ?`, [
          customerId,
        ]);
      } catch {
        /* best-effort cleanup */
      }
      setCachedCustomerZoho(customerId, empty);
    }
    return empty;
  }

  const invoices = await getInvoices_JS({
    customer_id: zohoContact.contact_id,
    per_page: 50,
    page: 1,
  });

  if (customerId) {
    try {
      const { getCustomerPayments_JS } = require("./zoho.controller");
      const [payments, recurringList] = await Promise.all([
        getCustomerPayments_JS({
          customer_id: zohoContact.contact_id,
          per_page: 50,
        }),
        getRecurringInvoices_JS({
          customer_id: zohoContact.contact_id,
          per_page: 50,
        }),
      ]);
      await integrationSnapshot.saveZohoBillingSnapshot(customerId, {
        contact: zohoContact,
        invoices: invoices || [],
        payments: payments || [],
        recurring: recurringList || [],
      });
    } catch (e) {
      console.warn("Zoho snapshot persist failed:", e.message);
    }
  }

  let lastPaymentDate = null;
  if (!isB2BCustomer(customer)) {
    try {
      lastPaymentDate = await syncZohoLastPayment(
        customer,
        zohoContact.contact_id,
        invoices
      );
    } catch (e) {
      console.error("Zoho last payment sync failed:", e.message);
    }
  }

  const mapped = (invoices || [])
    .map((inv) => ({
      id: String(inv.invoice_id),
      invoiceNumber: inv.invoice_number || null,
      orderNumber:
        inv.order_number ||
        inv.salesorder_number ||
        inv.reference_number ||
        null,
      date: inv.date || null,
      dueDate: inv.due_date || null,
      status: inv.status || "unknown",
      total: inv.total != null ? Number(inv.total) : null,
      balanceDue: inv.balance != null ? Number(inv.balance) : null,
      currency: inv.currency_code || "KES",
    }))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const isChangeover =
    !isB2BCustomer(customer) &&
    (await customerHasPriorCancelledTenant(customer));
  const hasFormerTenantInvoices =
    isChangeover &&
    zohoContactLooksReusedByFormerTenant(zohoContact, customer, mapped);

  const displayInvoices = isB2BCustomer(customer)
    ? filterAgencyInvoicesForCustomer(mapped, customer.customerNumber)
    : filterInvoicesForCurrentTenant(mapped, customer, {
        isChangeover,
      });

  const { overdueCount, totalOverdueBalance } =
    summarizeOverdueZohoInvoices(displayInvoices);
  const receivable = Number(zohoContact.outstanding_receivable_amount);
  const creditBalance =
    Number.isFinite(receivable) && receivable < 0 ? Math.abs(receivable) : 0;

  const result = {
    linked: true,
    zohoContactId: zohoContact.contact_id,
    invoices: displayInvoices,
    invoiceCount: displayInvoices.length,
    unpaidCount: overdueCount,
    totalBalanceDue: totalOverdueBalance,
    creditBalance,
    lastPaymentDate,
    hasFormerTenantInvoices,
    formerTenantInvoiceCount: hasFormerTenantInvoices
      ? Math.max(0, mapped.length - displayInvoices.length)
      : 0,
    ...(isB2BCustomer(customer) ? b2bBillingMeta(customer, agency) : {}),
  };

  if (customerId) setCachedCustomerZoho(customerId, result);

  if (customerId && result.linked && result.invoiceCount > 0) {
    try {
      await store.reconcileZohoBillingStatus(customerId, {
        linked: true,
        invoiceCount: result.invoiceCount,
      });
    } catch (e) {
      console.warn("Zoho billing status reconcile failed:", e.message);
    }
  }

  return result;
}

function buildingFromTispCtx(ctx) {
  return {
    c2b_code: ctx?.c2b_code ?? ctx?.c2bCode,
    b2b_code: ctx?.b2b_code ?? ctx?.b2bCode,
    building_code: ctx?.building_code ?? ctx?.buildingCode,
  };
}

/** Alternate C2B/B2B account number for the same apartment (CL-DLG1 ↔ CLB-DLG1). */
function alternateTypeAccountNumber(ctx) {
  const apartment = String(
    ctx?.apartment_number ?? ctx?.apartmentNumber ?? ""
  ).trim();
  const current = String(
    ctx?.customer_number ?? ctx?.customerNumber ?? ""
  )
    .trim()
    .toUpperCase();
  const alt = alternateTypeCustomerNumber(
    buildingFromTispCtx(ctx),
    ctx?.customer_type ?? ctx?.customerType,
    apartment,
    ctx?.premise_type ?? ctx?.premiseType
  );
  return alt && alt !== current ? alt : null;
}

function isTypePrefixAccountRenumber(previousNumber, ctx) {
  const prev = String(previousNumber || "")
    .trim()
    .toUpperCase();
  const alt = alternateTypeAccountNumber(ctx);
  return Boolean(prev && alt && prev === alt);
}

async function refreshTispStatus(customer, options = {}) {
  const preferredDueDate = options.preferredDueDate
    ? integrationSnapshot.normalizeTispDueDateValue(options.preferredDueDate)
    : null;

  const preservePaused =
    normalizeSubscriptionStatus(customer.subscriptionStatus) === "Paused";

  try {
    let tisp;
    try {
      tisp = await getTISPCustomer(customer.customerNumber);
    } catch (err) {
      if (!customer?.id || !isTispAccountMissingError(err)) throw err;
      const lookupCtx = await store.getCustomerContext(customer.id);
      const alt = lookupCtx ? alternateTypeAccountNumber(lookupCtx) : null;
      if (!alt) throw err;
      tisp = await getTISPCustomer(alt);
    }
    const status =
      tisp?.status ?? tisp?.Status ?? tisp?.subscriptionStatus ?? null;
    if (status) {
      let normalized = normalizeSubscriptionStatus(String(status));
      // Local "Paused" (away) must not be overwritten by TISP Suspended after we
      // stop service for a temporary pause.
      if (preservePaused && normalized !== "Active" && normalized !== "Cancelled") {
        normalized = "Paused";
      }
      await store.updateCustomerSubscriptionStatus(customer.id, normalized);
      customer.subscriptionStatus = normalized;
    } else {
      // Account payload returned but without a service status — treat as present/active.
      const normalized = preservePaused ? "Paused" : "Active";
      await store.updateCustomerSubscriptionStatus(customer.id, normalized);
      customer.subscriptionStatus = normalized;
    }

    const liveDue = integrationSnapshot.extractTispDueDate(tisp);
    const snapshotPayload = { ...tisp };
    // SetClientDetails can succeed before Client Status reflects the new due
    // date — prefer the date we just pushed so every customer stays accurate.
    if (preferredDueDate && liveDue !== preferredDueDate) {
      snapshotPayload.dueDate = preferredDueDate;
      snapshotPayload.duedate = preferredDueDate;
    }
    try {
      const existingSnap = await integrationSnapshot.getTispSnapshot(customer.id);
      const raw =
        typeof existingSnap?.raw_json === "string"
          ? JSON.parse(existingSnap.raw_json)
          : existingSnap?.raw_json;
      const existingId = extractTispClientAccountId(raw);
      if (existingId) snapshotPayload.Id = existingId;
    } catch {
      /* keep Client Status payload */
    }

    try {
      await integrationSnapshot.upsertTispSnapshot(customer.id, snapshotPayload);
    } catch (e) {
      console.warn("TISP snapshot save failed:", e.message);
    }
    await store.updateCustomerTispSync(customer.id, "synced", null);
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    const notFound =
      message.includes("not found") ||
      message.includes("missing") ||
      message.includes("does not exist") ||
      message.includes("no client");
    if (notFound) {
      try {
        const notOnTispStatus = preservePaused ? "Paused" : "Not on TISP";
        await store.updateCustomerSubscriptionStatus(customer.id, notOnTispStatus);
        customer.subscriptionStatus = notOnTispStatus;
        try {
          await integrationSnapshot.upsertTispSnapshot(customer.id, {
            status: notOnTispStatus,
          });
        } catch (e) {
          console.warn("TISP not-found snapshot persist failed:", e.message);
        }
      } catch (e) {
        console.warn("TISP not-found status persist failed:", e.message);
      }
    } else if (preferredDueDate) {
      // Client Status often fails after SetClientDetails; still persist the due
      // date we just pushed so edit UI and Status stay in sync.
      try {
        await integrationSnapshot.upsertTispSnapshot(customer.id, {
          dueDate: preferredDueDate,
          duedate: preferredDueDate,
        });
      } catch (e) {
        console.warn(
          "TISP preferred due-date snapshot persist failed:",
          e.message
        );
      }
    }
    try {
      await store.reconcileTispSyncStatus(customer.id);
    } catch (e) {
      console.warn("TISP sync reconcile failed:", e.message);
    }
  }
  return store.getCustomerById(customer.id);
}

async function refreshTispStatusWithCooldown(customer) {
  syncCooldown.assertSyncAllowed(customer.id);
  try {
    return await refreshTispStatus(customer);
  } finally {
    syncCooldown.recordSync(customer.id);
  }
}

async function resolveTispBuildingName(ctx) {
  let name = String(ctx.building_name || ctx.buildingName || "").trim();
  if (!name && (ctx.building_id || ctx.buildingId)) {
    const building = await store.getBuildingById(ctx.building_id || ctx.buildingId);
    name = String(building?.name || "").trim();
  }
  if (!name) {
    throw new Error("Building name is required for TISP registration");
  }
  return name;
}

/** TISP Location/Router must be the POP name (e.g. AZALEA), not the building name. */
async function resolveTispPopName(ctx) {
  let name = String(ctx.pop_name || ctx.popName || "").trim();
  if (!name && (ctx.pop_id || ctx.popId)) {
    const pop = await store.getPopById(ctx.pop_id || ctx.popId);
    name = String(pop?.name || "").trim();
  }
  if (!name && (ctx.building_id || ctx.buildingId)) {
    const building = await store.getBuildingById(ctx.building_id || ctx.buildingId);
    name = String(building?.pop_name || building?.popName || "").trim();
  }
  if (!name) {
    throw new Error("POP name is required for TISP Location and Router");
  }
  return name;
}

/** Resolve STATIC/PPOE from context or building — never default PackageType silently. */
async function resolveTispBuildingIpSetup(ctx) {
  let ipSetup = ctx.ip_setup ?? ctx.ipSetup ?? null;
  if (!ipSetup && (ctx.building_id || ctx.buildingId)) {
    const building = await store.getBuildingById(ctx.building_id || ctx.buildingId);
    ipSetup = building?.ipSetup ?? building?.ip_setup ?? null;
  }
  // Validates / normalizes (throws if missing or unknown).
  resolveTispPackageType(ipSetup);
  return ipSetup;
}

function tispPayloadInput(ctx, buildingName, options = {}) {
  const isB2B = String(ctx.customer_type || ctx.customerType || "").toUpperCase() === "B2B";
  const ipSetup = ctx.ip_setup ?? ctx.ipSetup;
  const firstName = ctx.first_name ?? ctx.firstName;
  const middleName = ctx.middle_name ?? ctx.middleName;
  const lastName = ctx.last_name ?? ctx.lastName;
  const customerNumber = ctx.customer_number ?? ctx.customerNumber;
  const apartmentNumber = ctx.apartment_number ?? ctx.apartmentNumber;
  const popName = options.popName ?? ctx.pop_name ?? ctx.popName;
  const ppoeUsername =
    ctx.ppoe_username ??
    ctx.ppoeUsername ??
    (String(ipSetup || "").toUpperCase() === "PPOE"
      ? customerNumber
      : apartmentNumber);
  const agencyContact = {
    email: ctx.agency_email ?? ctx.agencyEmail,
    phone: ctx.agency_phone ?? ctx.agencyPhone,
  };
  const tispContactCustomer = {
    email: ctx.email,
    phone: ctx.phone,
    firstName,
    middleName,
    lastName,
    buildingName,
    customerNumber,
    customer_type: ctx.customer_type ?? ctx.customerType,
    pop_name: popName,
    popName,
    c2b_code: ctx.c2b_code ?? ctx.c2bCode,
    b2b_code: ctx.b2b_code ?? ctx.b2bCode,
    agencyEmail: agencyContact.email,
    agencyPhone: agencyContact.phone,
  };
  return {
    firstName,
    middleName,
    lastName,
    buildingName,
    popName,
    customerNumber,
    customerType: ctx.customer_type ?? ctx.customerType,
    ipSetup,
    planName: ctx.plan_name ?? ctx.planName,
    mbps: ctx.product_mbps ?? ctx.productMbps,
    extraBandwidth:
      ctx.product_extra_bandwidth ??
      ctx.productExtraBandwidth ??
      ctx.extra_bandwidth ??
      ctx.extraBandwidth ??
      0,
    categoryName: ctx.category_name ?? ctx.categoryName,
    productName: ctx.product_name ?? ctx.productName,
    apartmentNumber,
    tispPassword: ctx.tisp_password ?? ctx.tispPassword,
    ppoeUsername,
    ipAddress: ctx.ip_address ?? ctx.ipAddress,
    email: resolveEffectiveCustomerEmail(tispContactCustomer, agencyContact),
    phone: resolveEffectiveCustomerPhone(tispContactCustomer, agencyContact),
    // Do not pass paymentFrequency — TISP BillingCycle is always Monthly.
    isVatExempt: Boolean(ctx.is_vat_exempt ?? ctx.isVatExempt),
    agencyName: ctx.agency_name ?? ctx.agencyName ?? null,
    agencyContactPerson: ctx.agency_contact_person ?? ctx.agencyContactPerson ?? null,
    agencyPhone: ctx.agency_phone ?? ctx.agencyPhone ?? null,
    agencyEmail: ctx.agency_email ?? ctx.agencyEmail ?? null,
    contactPerson: isB2B
      ? ctx.agency_contact_person ||
        ctx.agencyContactPerson ||
        firstName
      : firstName,
    dueDate: options.dueDate || TISP_STANDARD_DUE_DATE,
    price:
      ctx.package_price ??
      ctx.packagePrice ??
      ctx.price ??
      ctx.monthly_price ??
      ctx.monthlyPrice,
  };
}

async function createCustomerOnTisp(ctx, meta = {}) {
  const buildingName = await resolveTispBuildingName(ctx);
  const popName = await resolveTispPopName(ctx);
  const ipSetup = await resolveTispBuildingIpSetup(ctx);
  const isPpoe = resolveTispPackageType(ipSetup) === "PPPOE";
  // PPOE buildings have no assigned static IP — TISP still requires StaticIPAddress.
  const resolvedIp = isPpoe
    ? TISP_PPOE_PLACEHOLDER_STATIC_IP
    : await resolveIpForTispWrite(ctx);
  if (!isPpoe && !resolvedIp) {
    throw new Error(
      "Static IP address is required for TISP create, but none is set on the customer"
    );
  }
  const input = tispPayloadInput(
    { ...ctx, ip_setup: ipSetup, ipSetup, ip_address: resolvedIp },
    buildingName,
    { dueDate: meta.dueDate, popName }
  );
  assertCatalogPackageForTisp(input);
  const payload = buildTispCreateClientPayload(input);
  const result = await postSetClientDetails(payload, {
    customerId: ctx.id,
    customerNumber: ctx.customer_number ?? ctx.customerNumber,
    operation: "set_client_create",
    parentLogId: meta.parentLogId ?? null,
    packageMbps: input.mbps,
    extraBandwidth: input.extraBandwidth,
    popName: input.popName,
    ipSetup: input.ipSetup,
    packagePrice: input.price,
  });
  if (meta.skipStatusRefresh !== true) {
    try {
      await refreshTispStatus(
        {
          id: ctx.id,
          customerNumber: ctx.customer_number ?? ctx.customerNumber,
        },
        { preferredDueDate: meta.dueDate }
      );
    } catch {
      /* best-effort live snapshot */
    }
  }
  return result;
}

/** Pull a usable IPv4 from a TISP Client Status payload. */
function extractTispStaticIp(tispCustomer) {
  if (!tispCustomer || typeof tispCustomer !== "object") return null;
  const candidates = [
    tispCustomer.StaticIPAddress,
    tispCustomer.staticIPAddress,
    tispCustomer.staticIpAddress,
    tispCustomer.PppoeRemoteAddress,
    tispCustomer.pppoeRemoteAddress,
    tispCustomer.IPAddress,
    tispCustomer.ipAddress,
    tispCustomer.IP,
    tispCustomer.ip,
  ];
  for (const raw of candidates) {
    const ip = String(raw || "").trim();
    if (ip && !isTispPlaceholderIp(ip)) return ip;
  }
  return null;
}

function assertCatalogPackageForTisp(input) {
  const { buildTispPackageLabel, isValidTispPackageLabel } = require("./tisp.controller");
  const label = buildTispPackageLabel(input);
  if (!isValidTispPackageLabel(label)) {
    throw new Error(
      "Customer package is not on the catalog package list. Relink the customer to a current plan (Basic / Basic Plus / Premium / Premium Plus) before syncing to TISP."
    );
  }
  return label;
}

async function resolveIpForTispWrite(ctx, accountNumberHint = null) {
  const local = String(ctx.ip_address || ctx.ipAddress || "").trim();
  if (local && !isTispPlaceholderIp(local)) return local;

  const candidates = [
    accountNumberHint,
    ctx.customer_number || ctx.customerNumber,
    alternateTypeAccountNumber(ctx),
  ]
    .map((n) => String(n || "").trim().toUpperCase())
    .filter(Boolean);

  const seen = new Set();
  for (const num of candidates) {
    if (seen.has(num)) continue;
    seen.add(num);
    try {
      const live = await getTISPCustomer(num);
      const ip = extractTispStaticIp(live);
      if (ip) return ip;
    } catch {
      /* try next */
    }
  }
  return "";
}

async function updateCustomerOnTisp(ctx, meta = {}) {
  const buildingName = await resolveTispBuildingName(ctx);
  const popName = await resolveTispPopName(ctx);
  const ipSetup = await resolveTispBuildingIpSetup(ctx);
  const accountNumber = String(
    meta.accountNumber || ctx.customer_number || ctx.customerNumber || ""
  )
    .trim()
    .toUpperCase();

  // Prefer an explicit IP from the edit/reclaim caller over a context re-read
  // so StaticIPAddress cannot silently fall back to a stale local/TISP value.
  // PPOE buildings never send a real static IP — use 10.2.2.2 and blank remote.
  const isPpoe = resolveTispPackageType(ipSetup) === "PPPOE";
  const forcedIp = meta.ipAddress != null ? String(meta.ipAddress).trim() : "";
  const resolvedIp =
    meta.releaseNetwork || meta.releaseIpOnly
      ? TISP_RELEASE_PLACEHOLDER_IP
      : isPpoe
        ? TISP_PPOE_PLACEHOLDER_STATIC_IP
        : forcedIp || (await resolveIpForTispWrite(ctx, accountNumber));

  const input = {
    ...tispPayloadInput(
      { ...ctx, ip_setup: ipSetup, ipSetup, ip_address: resolvedIp || ctx.ip_address },
      buildingName,
      { dueDate: meta.dueDate, popName }
    ),
    customerNumber: accountNumber,
    ipAddress: resolvedIp,
  };
  if (ctx.id) {
    try {
      const snap = await integrationSnapshot.getTispSnapshot(ctx.id);
      const raw =
        typeof snap?.raw_json === "string" ? JSON.parse(snap.raw_json) : snap?.raw_json;
      const tispClientId = extractTispClientAccountId(raw);
      if (tispClientId) input.tispClientId = tispClientId;
    } catch {
      /* first update can recover the Id from TISP's duplicate-key error */
    }
  }

  // When releasing an old account before renumbering, free IP / PPPoE so the
  // new AccountNumber can claim them. Do not apply the new apartment/IP here.
  // TISP rejects blank StaticIPAddress — use a placeholder instead of "".
  if (meta.releaseNetwork) {
    const releaseApt = String(
      meta.previousApartmentNumber || ctx.apartment_number || accountNumber
    )
      .trim()
      .toUpperCase();
    input.ipAddress = TISP_RELEASE_PLACEHOLDER_IP;
    input.apartmentNumber = `${releaseApt}-X`;
    input.ppoeUsername = `${releaseApt}-X`;
    input.tispPassword = `x${String(Date.now()).slice(-6)}`;
  } else if (meta.releaseIpOnly) {
    // Same AccountNumber, new StaticIP: park on 0.0.0.0 first so Mikrotik
    // releases the old IP queue before the next UPDATE claims the new one.
    input.ipAddress = TISP_RELEASE_PLACEHOLDER_IP;
  } else if (!String(input.ipAddress || "").trim()) {
    throw new Error(
      "Static IP address is required for TISP update, but none is set on the customer"
    );
  }

  // Always send catalog package names (never legacy "BASIC PACKAGE 30MBPS").
  assertCatalogPackageForTisp(input);

  const payload = buildTispUpdateClientDetailsPayload(input);
  const result = await postSetClientDetails(payload, {
    customerId: ctx.id,
    customerNumber: accountNumber,
    operation: "set_client_update",
    parentLogId: meta.parentLogId ?? null,
    packageMbps: input.mbps,
    extraBandwidth: input.extraBandwidth,
    popName: input.popName,
    ipSetup: input.ipSetup,
    packagePrice: input.price,
  });
  if (meta.skipStatusRefresh !== true) {
    try {
      await refreshTispStatus(
        { id: ctx.id, customerNumber: ctx.customer_number },
        { preferredDueDate: meta.dueDate }
      );
    } catch {
      /* best-effort live snapshot */
    }
  }
  return result;
}

async function readLiveTispStaticIp(accountNumber) {
  const num = String(accountNumber || "")
    .trim()
    .toUpperCase();
  if (!num) return null;
  try {
    const live = await getTISPCustomer(num);
    return extractTispStaticIp(live);
  } catch {
    return null;
  }
}

/**
 * Same AccountNumber IP change: TISP UPDATE can report success while Mikrotik
 * still holds the old StaticIP queue. Release to 0.0.0.0 first, then claim the
 * new IP — without renaming apartment / PPPoE (unlike account migrate).
 *
 * On claim failure (or live Client Status still showing the old IP), restore
 * TISP and local DB to previousIp so the next edit can detect ipChanged again.
 */
async function reclaimCustomerIpOnTisp(ctx, previousIp, meta = {}) {
  const currentIp = String(
    meta.ipAddress || ctx.ip_address || ctx.ipAddress || ""
  ).trim();
  const oldIp = String(previousIp || "").trim();
  const customerId = ctx.id ?? ctx.customerId ?? null;
  const accountNumber = String(
    meta.accountNumber || ctx.customer_number || ctx.customerNumber || ""
  )
    .trim()
    .toUpperCase();

  if (!currentIp || !oldIp || currentIp === oldIp) {
    return updateCustomerOnTisp(ctx, {
      ...meta,
      ipAddress: currentIp || meta.ipAddress,
    });
  }

  const claimCtx = { ...ctx, ip_address: currentIp, ipAddress: currentIp };

  await updateCustomerOnTisp(claimCtx, {
    ...meta,
    releaseIpOnly: true,
    skipStatusRefresh: true,
  });

  const revertLocalIp = async () => {
    if (!customerId || !oldIp) return;
    try {
      await store.revertCustomerIpAddress(customerId, oldIp);
    } catch (e) {
      console.warn(
        `Local IP revert to ${oldIp} failed for customer ${customerId}:`,
        e.message
      );
    }
  };

  const restoreOldIpOnTisp = async () => {
    try {
      await updateCustomerOnTisp(
        { ...ctx, ip_address: oldIp },
        {
          ...meta,
          ipAddress: oldIp,
          skipStatusRefresh: true,
          parentLogId: meta.parentLogId ?? null,
        }
      );
    } catch {
      /* ignore rollback failure */
    }
  };

  try {
    const result = await updateCustomerOnTisp(claimCtx, {
      ...meta,
      // Force the new IP into StaticIPAddress — do not re-resolve from stale ctx.
      ipAddress: currentIp,
      skipStatusRefresh: true,
    });

    // Client Status can lag briefly after SetClientDetails — retry a few times.
    let liveIp = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      liveIp = await readLiveTispStaticIp(accountNumber);
      if (!liveIp || liveIp === currentIp) break;
    }
    if (liveIp && liveIp !== currentIp) {
      throw new Error(
        `TISP still reports StaticIP ${liveIp} after reclaim to ${currentIp}`
      );
    }

    if (meta.skipStatusRefresh !== true) {
      try {
        await refreshTispStatus(
          { id: ctx.id, customerNumber: accountNumber },
          { preferredDueDate: meta.dueDate }
        );
      } catch {
        /* best-effort live snapshot */
      }
    }
    return result;
  } catch (claimErr) {
    // Best-effort restore so the customer is not left on 0.0.0.0 / divergent local IP.
    await restoreOldIpOnTisp();
    await revertLocalIp();
    throw claimErr;
  }
}

/**
 * Move a TISP client from previousAccountNumber → ctx.customer_number
 * (apartment switch only). C2B↔B2B conversion updates the existing TISP
 * client in place instead of INSERT.
 *
 * TISP keys accounts by AccountNumber and does NOT rename it on UPDATE.
 * IP/PPPoE held by the old number also block INSERT of the new number, so we:
 * 1) read due date from the old account (must be preserved on the new account)
 * 2) release network resources on the old account (DueDate = today, clear IP/PPPoE)
 * 3) INSERT the new account with the new AccountNumber and preserved due date
 * 4) re-assert DueDate on the new account (TISP INSERT can ignore DueDate)
 */
async function migrateTispAccountNumber(ctx, previousAccountNumber, meta = {}) {
  const previousNumber = String(previousAccountNumber || "")
    .trim()
    .toUpperCase();
  const currentNumber = String(ctx.customer_number || "")
    .trim()
    .toUpperCase();
  if (!previousNumber || !currentNumber || previousNumber === currentNumber) {
    return updateCustomerOnTisp(ctx, meta);
  }

  // Never fall back to "today" for the new account — that suspends service.
  const snapshotDue =
    integrationSnapshot.normalizeTispDueDateValue(
      ctx.tisp_due_date || ctx.tispDueDate || null
    ) || null;
  const metaDue = integrationSnapshot.normalizeTispDueDateValue(meta.dueDate) || null;
  let preservedDueDate = metaDue || snapshotDue || null;
  // Prefer live PPPoE username for release; else old account number (usual
  // PPOE username) so we actually free the credential before INSERT.
  let previousApartment =
    meta.previousApartmentNumber || previousNumber || null;
  let liveIpForCreate = String(ctx.ip_address || ctx.ipAddress || "").trim() || null;
  try {
    const live = await getTISPCustomer(previousNumber);
    preservedDueDate =
      integrationSnapshot.extractTispDueDate(live) || preservedDueDate;
    if (!liveIpForCreate) {
      liveIpForCreate = extractTispStaticIp(live);
    }
    const livePppoe =
      live?.PppoeUsername ||
      live?.pppoeUsername ||
      null;
    if (livePppoe && String(livePppoe).trim()) {
      previousApartment = String(livePppoe).trim();
    } else if (!meta.previousApartmentNumber) {
      previousApartment =
        live?.ApartmentNumber ||
        live?.apartmentNumber ||
        previousNumber;
    }
  } catch {
    /* keep meta / snapshot due date / previousNumber release base */
  }

  // Last resort: cycle default — never Date.now()/today.
  const dueForCreate =
    preservedDueDate || metaDue || snapshotDue || TISP_STANDARD_DUE_DATE;

  // Free IP / PPPoE on the old AccountNumber so INSERT can claim them.
  // DueDate=today here is intentional for the OLD account only.
  await updateCustomerOnTisp(ctx, {
    accountNumber: previousNumber,
    dueDate: new Date(),
    releaseNetwork: true,
    previousApartmentNumber: previousApartment,
    skipStatusRefresh: true,
    parentLogId: meta.parentLogId ?? null,
  });

  const createCtx =
    liveIpForCreate && !String(ctx.ip_address || "").trim()
      ? { ...ctx, ip_address: liveIpForCreate }
      : ctx;
  const createMeta = {
    ...meta,
    dueDate: dueForCreate,
    skipStatusRefresh: true,
  };

  let result;
  try {
    result = await createCustomerOnTisp(createCtx, createMeta);
  } catch (createErr) {
    if (isTispDuplicateAccountError(createErr)) {
      result = await updateCustomerOnTisp(createCtx, createMeta);
    } else {
      // Best-effort rollback so the customer is not left disconnected.
      if (preservedDueDate) {
        try {
          await updateCustomerOnTisp(
            liveIpForCreate ? { ...ctx, ip_address: liveIpForCreate } : ctx,
            {
              accountNumber: previousNumber,
              dueDate: preservedDueDate,
              skipStatusRefresh: true,
              parentLogId: meta.parentLogId ?? null,
            }
          );
        } catch {
          /* ignore rollback failure */
        }
      }
      throw createErr;
    }
  }

  // TISP INSERT sometimes ignores DueDate — force it on the new AccountNumber.
  try {
    await updateCustomerOnTisp(createCtx, {
      ...createMeta,
      dueDate: dueForCreate,
      skipStatusRefresh: meta.skipStatusRefresh === true,
    });
  } catch (reassertErr) {
    console.warn(
      "TISP due-date reassert after apartment migrate failed:",
      reassertErr.message || reassertErr
    );
    if (meta.skipStatusRefresh !== true) {
      try {
        await refreshTispStatus(
          {
            id: ctx.id,
            customerNumber: currentNumber,
          },
          { preferredDueDate: dueForCreate }
        );
      } catch {
        /* best-effort */
      }
    }
  }

  return result;
}

async function pushCustomerToTisp(ctx, meta = {}) {
  // DSTV Only customers receive no bandwidth — never provision on TISP.
  if (
    isDstvOnlyCategory(ctx.category_code ?? ctx.categoryCode) ||
    isDstvOnlyCategory(ctx.category_name ?? ctx.categoryName)
  ) {
    const customerId = ctx.id ?? ctx.customerId;
    if (customerId) {
      await store.updateCustomerTispSync(customerId, "skipped", null);
    }
    return { ok: true, skipped: true, reason: "dstv_only" };
  }

  const skipCooldown = meta.skipCooldown === true;
  if (!skipCooldown) {
    syncCooldown.assertSyncAllowed(ctx.id);
  }

  const currentNumber = String(ctx.customer_number || "").trim().toUpperCase();
  const previousNumber = meta.previousCustomerNumber
    ? String(meta.previousCustomerNumber).trim().toUpperCase()
    : null;
  const previousIp = meta.previousIp
    ? String(meta.previousIp).trim()
    : null;
  const currentIp = String(
    meta.ipAddress || ctx.ip_address || ctx.ipAddress || ""
  ).trim();
  const ipIdentityChanged =
    Boolean(previousIp) && Boolean(currentIp) && previousIp !== currentIp;
  const pushCtx = currentIp
    ? { ...ctx, ip_address: currentIp, ipAddress: currentIp }
    : ctx;

  // Edits must never INSERT just because Client Status falsely says "missing".
  // Prefer UPDATE whenever the caller says so, or we previously synced, or a
  // local snapshot exists.
  const preferUpdate =
    meta.preferUpdate === true ||
    meta.forceUpdate === true ||
    meta.allowCreate === false ||
    hasLocalTispAccountEvidence(ctx);

  try {
    const typeConvertInPlace =
      meta.tispInPlaceUpdate === true ||
      isTypePrefixAccountRenumber(previousNumber, pushCtx);

    async function updateExistingTispIdentity(tispAccountNumber) {
      const keyedMeta = { ...meta, accountNumber: tispAccountNumber };
      if (ipIdentityChanged) {
        return await reclaimCustomerIpOnTisp(pushCtx, previousIp, keyedMeta);
      }
      return await updateCustomerOnTisp(pushCtx, keyedMeta);
    }

    // C2B↔B2B: same TISP client. UPDATE package/contact/PPPoE in place.
    // Zoho creates a new contact; TISP must not INSERT a second AccountNumber.
    // Client Status can lie about presence, so UPDATE the previous/alt number
    // directly rather than requiring accountExistsOnTisp first.
    if (typeConvertInPlace) {
      const altNumber = alternateTypeAccountNumber(pushCtx);
      const tryNumbers = [previousNumber, altNumber]
        .map((n) => String(n || "").trim().toUpperCase())
        .filter(Boolean)
        .filter((n, i, arr) => arr.indexOf(n) === i);
      let lastErr = null;
      for (const tispKey of tryNumbers) {
        try {
          return await updateExistingTispIdentity(tispKey);
        } catch (err) {
          lastErr = err;
          if (!isTispAccountMissingError(err)) throw err;
        }
      }
      if (lastErr && tryNumbers.length) throw lastErr;
    } else if (previousNumber && previousNumber !== currentNumber) {
      // Apartment move: TISP does not rename AccountNumber — migrate old → new.
      const onPrevious = await accountExistsOnTisp(previousNumber);
      if (onPrevious) {
        return await migrateTispAccountNumber(pushCtx, previousNumber, meta);
      }
    }

    const onCurrent = await accountExistsOnTisp(currentNumber);
    if (onCurrent) {
      // Same account, new StaticIP: release old Mikrotik IP then claim new.
      if (ipIdentityChanged) {
        return await reclaimCustomerIpOnTisp(pushCtx, previousIp, meta);
      }
      return await updateCustomerOnTisp(pushCtx, meta);
    }

    // Recovery: local number already converted (CLB-DLG1) but TISP still has
    // the other type code (CL-DLG1). Update that client — do not INSERT.
    const altNumber = alternateTypeAccountNumber(pushCtx);
    if (altNumber) {
      const onAlt = await accountExistsOnTisp(altNumber);
      if (onAlt) {
        return await updateExistingTispIdentity(altNumber);
      }
    }

    // Existence check failed / unavailable — still try UPDATE first on edits.
    try {
      if (ipIdentityChanged) {
        return await reclaimCustomerIpOnTisp(pushCtx, previousIp, meta);
      }
      return await updateCustomerOnTisp(pushCtx, meta);
    } catch (updateErr) {
      const canInsert = shouldAllowTispCreateFallback(meta, pushCtx);
      if (!canInsert) {
        throw updateErr;
      }
      if (preferUpdate && !isTispAccountMissingError(updateErr)) {
        // Soft Client Status failures / unrelated UPDATE errors: do not INSERT.
        throw updateErr;
      }

      try {
        return await createCustomerOnTisp(pushCtx, meta);
      } catch (createErr) {
        // Account already on TISP — Client Status lied. Fall back to UPDATE.
        if (isTispDuplicateAccountError(createErr)) {
          if (ipIdentityChanged) {
            return await reclaimCustomerIpOnTisp(pushCtx, previousIp, meta);
          }
          return await updateCustomerOnTisp(pushCtx, meta);
        }
        throw createErr;
      }
    }
  } finally {
    if (!skipCooldown) {
      syncCooldown.recordSync(ctx.id);
    }
  }
}

async function pushCustomerToZoho(ctx, options = {}) {
  const { pushCustomerBillingToZoho } = require("../services/customerZohoSync");
  return pushCustomerBillingToZoho(ctx, options);
}

/**
 * Live presence on TISP + Zoho (local snapshot first, then live lookup).
 */
async function resolveCustomerIntegrationPresence(customerId) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx) return null;

  const customerNumber = String(ctx.customer_number || "").trim();
  const isCancelled = String(ctx.status || "").toLowerCase() === "cancelled";
  const { normalizeCustomerRef } = require("../utils/zohoCustomerScope");

  let onTisp = false;
  let tispDueDate = null;
  const localTispEvidence = hasLocalTispAccountEvidence(ctx);
  try {
    onTisp = customerNumber
      ? Boolean(await accountExistsOnTisp(customerNumber))
      : false;
  } catch {
    onTisp = localTispEvidence;
  }
  // Client Status often omits status/package or times out. A prior sync /
  // snapshot due date means the account already exists — edit must UPDATE.
  if (!onTisp && localTispEvidence) {
    onTisp = true;
  }

  try {
    const withDue = await attachTispDueDate({
      id: ctx.id,
      customerNumber,
      status: ctx.status,
    });
    tispDueDate = withDue?.tispDueDate || null;
  } catch {
    /* best-effort */
  }

  const isB2B = isB2BCustomer({ customerType: ctx.customer_type });
  let onZoho = false;
  let zohoContactId = null;
  let zohoContactStatus = null;
  let zohoCompanyName = null;
  let formerTenantArchived = false;

  if (isB2B) {
    onZoho = true;
  } else {
    const { mapContextToCustomer } = require("../services/customerZohoSync");
    const mappedCustomer = mapContextToCustomer(ctx);
    const snap = await integrationSnapshot.getZohoContact(customerId).catch(() => null);
    const storedContactId = snap?.zoho_contact_id
      ? String(snap.zoho_contact_id)
      : null;
    if (storedContactId) {
      onZoho = true;
      zohoContactId = storedContactId;
      zohoCompanyName = snap?.company_name ? String(snap.company_name) : null;
      const raw =
        typeof snap.raw_json === "string"
          ? (() => {
              try {
                return JSON.parse(snap.raw_json);
              } catch {
                return null;
              }
            })()
          : snap.raw_json;
      if (raw?.status) zohoContactStatus = String(raw.status);
      if (raw?.company_name) zohoCompanyName = String(raw.company_name);
    }
    if (!onZoho) {
      try {
        const contact = await findZohoContactForCustomer(mappedCustomer);
        if (contact?.contact_id) {
          onZoho = true;
          zohoContactId = String(contact.contact_id);
          zohoContactStatus = contact.status
            ? String(contact.status)
            : null;
          zohoCompanyName = contact.company_name
            ? String(contact.company_name)
            : null;
          try {
            const { getContactFull_JS } = require("./zoho.controller");
            const full =
              (await getContactFull_JS(contact.contact_id)) || contact;
            await integrationSnapshot.upsertZohoContact(customerId, full);
          } catch {
            /* ignore */
          }
        }
      } catch {
        onZoho =
          String(ctx.zoho_billing_status || "").toLowerCase() === "completed";
      }
    }

    // Live status check so inactive contacts are visible in the edit UI.
    if (zohoContactId) {
      try {
        const { getContactFull_JS } = require("./zoho.controller");
        const live = await getContactFull_JS(zohoContactId);
        if (live && typeof live === "object" && live.contact_id) {
          if (live.status) zohoContactStatus = String(live.status);
          if (live.company_name) zohoCompanyName = String(live.company_name);

          const liveCompanyNorm = normalizeCustomerRef(live.company_name);
          const ourNumberNorm = normalizeCustomerRef(customerNumber);
          const ourLiveBaseNorm = normalizeCustomerRef(
            String(customerNumber).replace(/-CXL-\d+$/i, "")
          );

          // Cancelled tenant still pointing at the live apartment Zoho contact
          // (taken over by the new tenant) — do not show that as "their" active Books.
          if (
            isCancelled &&
            liveCompanyNorm &&
            liveCompanyNorm === ourLiveBaseNorm &&
            ourNumberNorm !== ourLiveBaseNorm
          ) {
            onZoho = false;
            zohoContactId = null;
            zohoContactStatus = null;
            zohoCompanyName = null;
            formerTenantArchived = false;
            try {
              await integrationSnapshot.clearZohoContact(customerId);
            } catch {
              /* ignore */
            }
          } else {
            formerTenantArchived =
              isCancelled &&
              (/CXL/i.test(String(live.company_name || "")) ||
                String(live.status || "").toLowerCase() === "inactive");
            try {
              await integrationSnapshot.upsertZohoContact(customerId, live);
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        /* keep snapshot status */
      }
    }
  }

  const zohoInactive =
    String(zohoContactStatus || "").trim().toLowerCase() === "inactive";

  return {
    customerId: ctx.id,
    customerNumber,
    customerType: ctx.customer_type,
    status: ctx.status,
    onTisp,
    onZoho,
    zohoContactId,
    zohoContactStatus,
    zohoCompanyName,
    zohoInactive,
    formerTenantArchived,
    tispDueDate,
    isB2B,
  };
}

async function getCustomerIntegrations(req, res, next) {
  try {
    const id = Number(req.params.id);
    const presence = await resolveCustomerIntegrationPresence(id);
    if (!presence) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const ctx = await store.getCustomerContext(id);
    const dashboardLastPayment = formatDateOnly(
      ctx?.last_payment_date || ctx?.lastPaymentDate || null
    );

    let invoiceCount = 0;
    let invoicesInSync = false;
    let zohoLastPaymentDate = null;
    let paymentsInSync = true;
    let effectiveLastPaymentDate = dashboardLastPayment;
    let hasActiveRecurring = false;
    let recurringCount = 0;
    let recurringStatus = null;
    let nextRecurringDate = null;

    if (presence.isB2B) {
      invoicesInSync = true;
      paymentsInSync = true;
      hasActiveRecurring = true;
      recurringStatus = "agency_billing";
    } else if (
      presence.onZoho &&
      String(presence.status || "").toLowerCase() !== "cancelled"
    ) {
      try {
        const [invoices, payments] = await Promise.all([
          integrationSnapshot.listInvoicesForCustomer(id),
          integrationSnapshot.listZohoPayments(id),
        ]);

        let recurring = [];
        if (presence.zohoContactId) {
          try {
            const liveRecurring = await getRecurringInvoices_JS({
              customer_id: presence.zohoContactId,
              per_page: 50,
            });
            await integrationSnapshot.replaceRecurringInvoices(
              id,
              liveRecurring || []
            );
            recurring = await integrationSnapshot.listRecurringInvoices(id);
          } catch (e) {
            console.warn("Zoho recurring refresh failed:", e.message);
            recurring = await integrationSnapshot.listRecurringInvoices(id);
          }
        } else {
          recurring = await integrationSnapshot.listRecurringInvoices(id);
        }

        invoiceCount = (invoices || []).length;
        invoicesInSync = invoiceCount > 0;

        const paidInvoiceDates = (invoices || [])
          .filter((inv) => {
            const status = String(inv.status || "").toLowerCase();
            const balance =
              inv.balanceDue != null
                ? Number(inv.balanceDue)
                : inv.balance != null
                  ? Number(inv.balance)
                  : null;
            return (
              status === "paid" ||
              (status === "partially_paid" && balance != null && balance <= 0)
            );
          })
          .map((inv) => inv.date || inv.dueDate);

        zohoLastPaymentDate = pickLatestPaymentDate(
          ...(payments || []).map((p) => p.paidAt || p.payment_date || p.date),
          ...paidInvoiceDates,
          lastPaymentFromZohoInvoices(invoices),
          lastPaymentFromZohoPayments(payments)
        );

        // Zoho is authoritative for last payment — sync dashboard when they differ.
        if (
          zohoLastPaymentDate &&
          presence.customerNumber &&
          zohoLastPaymentDate !== dashboardLastPayment
        ) {
          try {
            await store.setCustomerLastPaymentFromZoho(
              presence.customerNumber,
              zohoLastPaymentDate
            );
            effectiveLastPaymentDate = zohoLastPaymentDate;
          } catch (e) {
            console.warn(
              "Zoho last-payment dashboard sync failed:",
              e.message
            );
          }
        } else if (zohoLastPaymentDate) {
          effectiveLastPaymentDate = zohoLastPaymentDate;
        }

        // After a successful write, effective matches Zoho — clear the "aligning"
        // warning on this same response (no second refresh required).
        if (!zohoLastPaymentDate) {
          paymentsInSync = true;
        } else {
          paymentsInSync =
            formatDateOnly(effectiveLastPaymentDate) ===
            formatDateOnly(zohoLastPaymentDate);
        }

        const { isActiveRecurring } = require("../services/customerZohoSync");
        const activeRecurring = (recurring || []).filter((row) =>
          isActiveRecurring(row)
        );
        recurringCount = activeRecurring.length;
        hasActiveRecurring = recurringCount > 0;
        if (hasActiveRecurring) {
          recurringStatus = String(activeRecurring[0].status || "active");
          nextRecurringDate = activeRecurring[0].nextInvoiceDate || null;
        } else if ((recurring || []).length > 0) {
          recurringStatus = String(recurring[0].status || "stopped");
        } else {
          recurringStatus = "missing";
        }
      } catch (e) {
        console.warn("Zoho integration enrich failed:", e.message);
      }
    }

    return res.json({
      ...presence,
      invoiceCount,
      invoicesInSync,
      lastPaymentDate: effectiveLastPaymentDate,
      zohoLastPaymentDate,
      paymentsInSync,
      hasActiveRecurring,
      recurringCount,
      recurringStatus,
      nextRecurringDate,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * After local edit: ensure customer exists on TISP + Zoho (C2B), with optional
 * invoice/recurring/due-date controls from the edit form.
 *
 * Always applies:
 * - TISP package = `{PLAN} - {CATEGORY}` (e.g. BASIC PLUS - INTERNET + APARTONET CHANNELS); real TISP errors fail the sync and are logged
 * - Live Client Status refresh after every successful TISP write
 * - Zoho lookup by customer number → email → name; update existing (by snapshot
 *   id first) instead of creating duplicates
 */
async function syncIntegrationsOnCustomerUpdate(customerId, options = {}) {
  const createInitialInvoice = options.createInitialInvoice === true;
  const createRecurringInvoice = options.createRecurringInvoice === true;
  const updateZohoRecurring = options.updateZohoRecurring === true;
  const disregardExistingInvoices = options.disregardExistingInvoices === true;
  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim().toUpperCase()
    : null;
  const previousIp = options.previousIp
    ? String(options.previousIp).trim()
    : null;
  const newIp = options.newIp ? String(options.newIp).trim() : null;
  const apartmentChanged = options.apartmentChanged === true || Boolean(previousCustomerNumber);
  const billingReset =
    createInitialInvoice || createRecurringInvoice || updateZohoRecurring;
  const tispDueDateRaw = options.tispDueDate
    ? String(options.tispDueDate).trim()
    : "";
  // Do not force the cycle default over a live TISP due date on a normal edit.
  // When signup invoice / recurring is being (re)set, recalculate from today.
  const tispDueDate = tispDueDateRaw;

  const ctx = await store.getCustomerContext(customerId);
  if (!ctx || ctx.status !== "active") {
    return {
      tisp: { ok: true, skipped: true },
      zoho: { ok: true, skipped: true },
    };
  }

  // If the edit just changed IP, pin that address onto the context used for TISP
  // so StaticIPAddress cannot be built from a stale row/snapshot.
  const tispCtx = newIp ? { ...ctx, ip_address: newIp } : ctx;

  const presence = await resolveCustomerIntegrationPresence(customerId);
  const isB2B = Boolean(presence?.isB2B);
  const dstvOnly =
    isDstvOnlyCategory(ctx.category_code) ||
    isDstvOnlyCategory(ctx.category_name);

  let tisp = { ok: true };
  if (dstvOnly) {
    await store.updateCustomerTispSync(customerId, "skipped", null);
    tisp = { ok: true, skipped: true, reason: "dstv_only" };
  } else {
  try {
    // Always update-first on edit. Never INSERT just because Client Status
    // reported onTisp=false (that caused "Duplicate Account Exists" on phone edits).
    // Apartment / account renumber: keep the existing TISP due date — never default
    // to today (that disconnects the customer after migrate release).
    // Signup invoice / recurring on edit: reset DueDate from today (Net 7/30 or
    // next service due), not the stale snapshot.
    let dueForSync =
      (billingReset
        ? resolveTispDueDateForEditBilling({
            customer: ctx,
            createInitialInvoice,
            createRecurringInvoice,
            updateZohoRecurring,
          })
        : null) ||
      tispDueDate ||
      presence?.tispDueDate ||
      null;
    if (!dueForSync && previousCustomerNumber) {
      try {
        const liveOld = await getTISPCustomer(previousCustomerNumber);
        dueForSync = integrationSnapshot.extractTispDueDate(liveOld);
      } catch {
        /* fall through */
      }
    }
    if (!dueForSync) {
      dueForSync = ctx.tisp_due_date || TISP_STANDARD_DUE_DATE;
    }
    const alreadyOnTisp =
      Boolean(presence?.onTisp) || hasLocalTispAccountEvidence(tispCtx);
    await pushCustomerToTisp(tispCtx, {
      previousCustomerNumber: previousCustomerNumber || undefined,
      previousApartmentNumber: options.previousApartmentNumber,
      previousIp: previousIp || undefined,
      ipAddress: newIp || undefined,
      dueDate: dueForSync,
      preferUpdate: true,
      allowCreate: !alreadyOnTisp,
      skipCooldown: true,
    });
    tisp = {
      ok: true,
      updated: true,
      migrated: Boolean(previousCustomerNumber),
      ipReclaimed: Boolean(previousIp) && !previousCustomerNumber,
      previousCustomerNumber: previousCustomerNumber || undefined,
      previousIp: previousIp || undefined,
      newIp: newIp || undefined,
      customerNumber: ctx.customer_number,
      dueDate: dueForSync,
      dueDateReset: Boolean(billingReset),
    };
    await store.updateCustomerTispSync(customerId, "synced", null);
    // create/update already refresh live Client Status (+ preferred due date).
  } catch (e) {
    const message = formatTispError(e);
    await store.updateCustomerTispSync(customerId, "failed", message);
    tisp = { ok: false, error: message };
  }
  }

  let zoho = { ok: true, skipped: true };
  if (isB2B) {
    zoho = { ok: true, skipped: true, reason: "b2b_agency_billing" };
  } else {
    try {
      const { mapContextToCustomer, ensureRecurringSubscription, updateZohoContactDetails } = require(
        "../services/customerZohoSync"
      );
      const { createSignupInvoice } = require(
        "../services/customerBillingOnboarding"
      );
      const {
        getInvoices_JS,
        getCustomerPayments_JS,
        getRecurringInvoices_JS,
      } = require("./zoho.controller");

      // Re-load context so Zoho gets the just-saved local fields (incl. new customer number).
      const freshCtx = (await store.getCustomerContext(customerId)) || ctx;
      const customer = mapContextToCustomer(freshCtx);
      const wasOnZoho = Boolean(presence?.onZoho);

      // Always: resolve existing contact or create, then push company name + display name.
      // On apartment move, look up by previous company_name so we update the same contact.
      let contact = await ensureZohoContactForCustomer(customer, {
        previousCustomerNumber: previousCustomerNumber || undefined,
      });
      if (!contact?.contact_id) {
        throw new Error("Zoho contact could not be linked");
      }
      contact = await updateZohoContactDetails(customer, contact);

      // Apartment change → customer number changed: force company_name + contact_name refresh.
      if (apartmentChanged) {
        const { updateContact_JS, getContactFull_JS } = require("./zoho.controller");
        const expectedCompany = String(customer.customerNumber || "").trim();
        if (expectedCompany) {
          contact =
            (await enforceZohoCompanyName(
              contact.contact_id,
              expectedCompany,
              getContactFull_JS,
              updateContact_JS
            )) || contact;
        }
        // Re-push full payload so Display Name (contact_name) matches person name.
        contact = await updateZohoContactDetails(customer, contact);
      }

      let invoice = null;
      let recurring = null;

      if (createInitialInvoice) {
        invoice = await createSignupInvoice(customer, contact, {
          disregardExistingInvoices,
          // Explicit edit action: email via Zoho API with Invoice CC addresses.
          forceEmail: true,
        });
      }

      if (createRecurringInvoice || updateZohoRecurring || apartmentChanged) {
        const recurringWindow = computeSignupRecurringWindow({
          signupDate: invoice?.period?.startDate || new Date(),
          paymentFrequency: customer.paymentFrequency,
          customPeriodDays: customer.customPeriodDays,
        });
        recurring = await ensureRecurringSubscription(customer, contact, {
          startDate: recurringWindow.startDate,
          previousCustomerNumber: previousCustomerNumber || undefined,
        });
      }

      if (billingReset && !dstvOnly && tisp.ok && tisp.skipped !== true) {
        const dueAfterBilling = resolveTispDueDateForEditBilling({
          customer,
          createInitialInvoice,
          createRecurringInvoice,
          updateZohoRecurring,
          invoice,
        });
        const currentDue = String(tisp.dueDate || "").slice(0, 10);
        const nextDue = dueAfterBilling
          ? String(dueAfterBilling).slice(0, 10)
          : "";
        if (nextDue && nextDue !== currentDue) {
          try {
            await pushCustomerToTisp(tispCtx, {
              previousCustomerNumber: previousCustomerNumber || undefined,
              previousApartmentNumber: options.previousApartmentNumber,
              previousIp: previousIp || undefined,
              ipAddress: newIp || undefined,
              dueDate: nextDue,
              preferUpdate: true,
              allowCreate: false,
              skipCooldown: true,
            });
            tisp = { ...tisp, dueDate: nextDue, dueDateReset: true };
          } catch (e) {
            tisp = { ...tisp, ok: false, error: formatTispError(e) };
            await store.updateCustomerTispSync(
              customerId,
              "failed",
              formatTispError(e)
            );
          }
        } else if (nextDue) {
          tisp = { ...tisp, dueDate: nextDue, dueDateReset: true };
        }
      }

      try {
        const [invoices, payments, recurringList] = await Promise.all([
          getInvoices_JS({
            customer_id: contact.contact_id,
            per_page: 50,
            page: 1,
          }),
          getCustomerPayments_JS({
            customer_id: contact.contact_id,
            per_page: 50,
          }),
          getRecurringInvoices_JS({
            customer_id: contact.contact_id,
            per_page: 50,
          }),
        ]);
        await integrationSnapshot.saveZohoBillingSnapshot(customerId, {
          contact,
          invoices: invoices || [],
          payments: payments || [],
          recurring: recurringList || [],
        });
      } catch (e) {
        console.warn("Zoho snapshot refresh after edit failed:", e.message);
      }

      await store.updateCustomerZohoBillingStatus(
        customerId,
        "completed",
        null
      );
      invalidateCustomerZoho(customerId);

      zoho = {
        ok: true,
        created: !wasOnZoho,
        updated: wasOnZoho,
        contactUpdated: true,
        contactId: String(contact.contact_id),
        invoice,
        recurring,
      };
    } catch (e) {
      const message =
        e.response?.data?.message || e.message || "Zoho sync failed";
      try {
        await store.updateCustomerZohoBillingStatus(
          customerId,
          "failed",
          message
        );
      } catch {
        /* ignore */
      }
      zoho = { ok: false, error: message };
    }
  }

  return { tisp, zoho, presence };
}

async function runZohoSyncForCustomer(customerId, options = {}) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx || ctx.status !== "active") {
    return { ok: true, skipped: true };
  }
  if (isB2BCustomer({ customerType: ctx.customer_type })) {
    try {
      await store.updateCustomerZohoBillingStatus(customerId, "completed", null);
    } catch {
      /* ignore */
    }
    return { ok: true, skipped: true, reason: "b2b_no_zoho" };
  }
  try {
    const result = await pushCustomerToZoho(ctx, options);
    return { ok: true, ...result };
  } catch (e) {
    return {
      ok: false,
      error: e.response?.data?.message || e.message || "Zoho sync failed",
    };
  }
}

async function syncNewCustomerToTisp(customerId, customerNumber, meta = {}) {
  try {
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx) throw new Error("Customer not found");

    if (
      isDstvOnlyCategory(ctx.category_code) ||
      isDstvOnlyCategory(ctx.category_name)
    ) {
      await store.updateCustomerTispSync(customerId, "skipped", null);
      return null;
    }

    const number = String(
      customerNumber || ctx.customer_number || ""
    )
      .trim()
      .toUpperCase();

    const syncMeta = { ...meta };
    // Prefer update when the account already exists on TISP — never INSERT a duplicate.
    // Keep their existing due date unless the caller passed an explicit one.
    if (!syncMeta.dueDate && number) {
      try {
        const exists = await accountExistsOnTisp(number);
        if (exists) {
          const live = await getTISPCustomer(number);
          if (live?.dueDate) {
            syncMeta.dueDate = live.dueDate;
          }
        }
      } catch {
        /* fall through — pushCustomerToTisp still prefers UPDATE when present */
      }
    }

    await pushCustomerToTisp(ctx, syncMeta);
    await store.updateCustomerTispSync(customerId, "synced", null);
    return null;
  } catch (e) {
    const tispError = formatTispError(e);
    await store.updateCustomerTispSync(customerId, "failed", tispError);
    return tispError;
  }
}

function parseCreateOnTispDueDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

/**
 * Create (or update) a customer on TISP only — never touches Zoho / agency billing.
 */
async function provisionCustomerOnTispOnly(customerId, dueDateInput) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx) {
    const err = new Error("Customer not found");
    err.statusCode = 404;
    throw err;
  }
  if (String(ctx.status || "").toLowerCase() !== "active") {
    throw new Error("Only active customers can be created on TISP");
  }
  if (
    isDstvOnlyCategory(ctx.category_code) ||
    isDstvOnlyCategory(ctx.category_name)
  ) {
    throw new Error("DSTV Only customers are not added on TISP");
  }

  const dueDate =
    parseCreateOnTispDueDate(dueDateInput) ||
    ctx.tisp_due_date ||
    TISP_STANDARD_DUE_DATE;

  const number = String(ctx.customer_number || "").trim().toUpperCase();
  let alreadyOnTisp = hasLocalTispAccountEvidence(ctx);
  try {
    if (!alreadyOnTisp && number) {
      alreadyOnTisp = Boolean(await accountExistsOnTisp(number));
    }
    await pushCustomerToTisp(ctx, {
      dueDate,
      skipCooldown: true,
      allowCreate: !alreadyOnTisp,
      preferUpdate: alreadyOnTisp,
    });
    await store.updateCustomerTispSync(customerId, "synced", null);
  } catch (e) {
    const tispError = formatTispError(e) || e.message || "TISP create failed";
    try {
      await store.updateCustomerTispSync(customerId, "failed", tispError);
    } catch {
      /* ignore */
    }
    throw new Error(tispError);
  }

  const customer = await attachTispDueDate(await store.getCustomerById(customerId));
  notifyCustomersChanged(customerId, "updated");

  try {
    await logActivity({
      eventType: "customer_tisp_created",
      title: alreadyOnTisp ? "Update on TISP" : "Create on TISP",
      message: `${customer?.customerNumber || number}: TISP due ${dueDate}`,
      source: "admin",
      status: "success",
      customerRef: customer?.customerNumber || number,
    });
  } catch (logErr) {
    console.error("activity log (create on TISP) failed:", logErr.message);
  }

  return {
    ok: true,
    created: !alreadyOnTisp,
    updated: alreadyOnTisp,
    dueDate,
    customer,
    tisp: { ok: true, created: !alreadyOnTisp, updated: alreadyOnTisp, dueDate },
  };
}

async function createOnTispHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const dueDate = parseCreateOnTispDueDate(req.body?.dueDate);
    if (!dueDate) {
      return res.status(400).json({ error: "dueDate is required (YYYY-MM-DD)" });
    }
    const result = await provisionCustomerOnTispOnly(id, dueDate);
    return res.json(result);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function bulkCreateOnTispHandler(req, res, next) {
  try {
    const { ids, dueDate: dueDateRaw } = req.body || {};
    const dueDate = parseCreateOnTispDueDate(dueDateRaw);
    if (!dueDate) {
      return res.status(400).json({ error: "dueDate is required (YYYY-MM-DD)" });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    const uniqueIds = [
      ...new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (!uniqueIds.length) {
      return res.status(400).json({ error: "No valid customer ids provided" });
    }

    const results = [];
    for (const id of uniqueIds) {
      try {
        const result = await provisionCustomerOnTispOnly(id, dueDate);
        results.push({
          id,
          ok: true,
          created: result.created,
          updated: result.updated,
          customerNumber: result.customer?.customerNumber || null,
          dueDate: result.dueDate,
        });
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: formatTispError(e) || e.message,
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    return res.json({
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      created: results.filter((r) => r.ok && r.created).length,
      updated: results.filter((r) => r.ok && r.updated).length,
      dueDate,
      results,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function lookupCustomerByNumber(req, res, next) {
  try {
    const apartmentNumber = String(
      req.query.apartmentNumber || req.query.apartment || ""
    )
      .trim()
      .toUpperCase();
    const preferredBuildingId = req.query.buildingId
      ? Number(req.query.buildingId)
      : null;

    if (apartmentNumber) {
      if (apartmentNumber.length < 2) {
        return res.json({ ok: true, found: false, reason: "too_short" });
      }
      let row = await store.findCustomerByApartmentNumber(apartmentNumber, {
        preferredBuildingId,
        activeOnly: true,
      });
      let cancelledOnly = false;
      if (!row?.id) {
        row = await store.findCustomerByApartmentNumber(apartmentNumber, {
          preferredBuildingId,
          activeOnly: false,
        });
        if (row?.id && String(row.status || "").toLowerCase() === "cancelled") {
          cancelledOnly = true;
        } else if (!row?.id) {
          return res.json({ ok: true, found: false, reason: "not_found" });
        } else if (String(row.status || "").toLowerCase() !== "active") {
          return res.json({ ok: true, found: false, reason: "not_found" });
        }
      }
      const customer = await store.getCustomerById(row.id);
      if (!customer) {
        return res.json({ ok: true, found: false, reason: "not_found" });
      }
      if (
        cancelledOnly ||
        String(customer.status || "").toLowerCase() === "cancelled"
      ) {
        return res.json({
          ok: true,
          found: false,
          reason: "cancelled",
          customer: {
            id: customer.id,
            customerNumber: customer.customerNumber,
            apartmentNumber: customer.apartmentNumber || apartmentNumber,
            fullName: customer.fullName,
            status: customer.status,
            buildingName: customer.buildingName || null,
          },
        });
      }
      return res.json({
        ok: true,
        found: true,
        customer: {
          id: customer.id,
          customerNumber: customer.customerNumber,
          apartmentNumber: customer.apartmentNumber || apartmentNumber,
          fullName: customer.fullName,
          status: customer.status,
          buildingName: customer.buildingName || null,
        },
      });
    }

    const raw = String(
      req.query.customerNumber || req.query.number || req.params.customerNumber || ""
    )
      .trim()
      .toUpperCase();
    if (!raw || raw.length < 3) {
      return res.json({ ok: true, found: false, reason: "too_short" });
    }
    const row = await store.findCustomerByNumber(raw);
    if (!row?.id) {
      return res.json({ ok: true, found: false, reason: "not_found" });
    }
    const customer = await store.getCustomerById(row.id);
    if (!customer) {
      return res.json({ ok: true, found: false, reason: "not_found" });
    }
    if (String(customer.status || "").toLowerCase() === "cancelled") {
      return res.json({
        ok: true,
        found: false,
        reason: "cancelled",
        customer: {
          id: customer.id,
          customerNumber: customer.customerNumber,
          apartmentNumber: customer.apartmentNumber || null,
          fullName: customer.fullName,
          status: customer.status,
          buildingName: customer.buildingName || null,
        },
      });
    }
    return res.json({
      ok: true,
      found: true,
      customer: {
        id: customer.id,
        customerNumber: customer.customerNumber,
        apartmentNumber: customer.apartmentNumber || null,
        fullName: customer.fullName,
        status: customer.status,
        buildingName: customer.buildingName || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function listCustomers(req, res, next) {
  try {
    const {
      status,
      subscriptionStatus,
      buildingId,
      search,
      page,
      limit,
      refresh,
      categoryId,
      customerType,
      premiseType,
      sortBy,
      sortDir,
    } = req.query;
    const listFilters = {
      accountStatus: status,
      subscriptionStatus: subscriptionStatus || undefined,
      buildingId: buildingId ? Number(buildingId) : undefined,
      search,
      page,
      limit,
      categoryId: categoryId ? Number(categoryId) : undefined,
      customerType,
      premiseType,
      sortBy,
      sortDir,
    };
    let result = await store.listCustomers(listFilters);

    // Explicit refresh button only — never block search on live TISP/Zoho.
    // Search uses POST /customers/refresh-batch in the background after results render.
    if (refresh === "true") {
      const active = result.data.filter((c) => c.status === "active");
      const toRefresh = active
        .filter((c) => syncCooldown.getRemainingMs(c.id) <= 0)
        .slice(0, Math.min(Number(limit) || 20, 20));

      if (toRefresh.length > 0) {
        await mapWithConcurrency(toRefresh, 3, async (customer) => {
          try {
            await refreshTispStatus(customer);
          } catch (e) {
            console.warn(
              `[listCustomers] TISP sync failed for ${customer.customerNumber}:`,
              e.message
            );
          }
          try {
            invalidateCustomerZoho(customer.id);
            const zoho = await fetchCustomerZohoInvoices(customer, {
              skipCache: true,
            });
            await store.reconcileZohoBillingStatus(customer.id, {
              linked: zoho?.linked,
              invoiceCount: zoho?.invoiceCount ?? 0,
            });
          } catch (e) {
            console.warn(
              `[listCustomers] Zoho sync failed for ${customer.customerNumber}:`,
              e.message
            );
          }
          try {
            await store.reconcileTispSyncStatus(customer.id);
          } catch (e) {
            console.warn(
              `[listCustomers] TISP reconcile failed for ${customer.customerNumber}:`,
              e.message
            );
          }
          syncCooldown.recordSync(customer.id);
        });

        result = await store.listCustomers(listFilters);
      }
    }

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CUSTOMER_EXPORT_COLUMNS = [
  { key: "customerNumber", label: "Customer #" },
  { key: "fullName", label: "Name" },
  { key: "customerType", label: "Type" },
  { key: "premiseType", label: "Premise" },
  { key: "buildingName", label: "Building" },
  { key: "apartmentNumber", label: "Unit" },
  { key: "block", label: "Block" },
  { key: "businessName", label: "Business name" },
  { key: "shopLocation", label: "Shop location" },
  { key: "productName", label: "Package" },
  { key: "paymentFrequency", label: "Billing" },
  { key: "subscriptionStatus", label: "Status" },
  { key: "dstvDecoderSerial", label: "DSTV IUC/Serial" },
  { key: "packagePrice", label: "Price" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "status", label: "Account" },
  { key: "createdAt", label: "Created" },
];

const REQUIRED_CUSTOMER_EXPORT_KEYS = new Set([
  "customerNumber",
  "fullName",
  "customerType",
  "apartmentNumber",
  "subscriptionStatus",
]);

function resolveCustomerExportColumns(columnsParam) {
  if (!columnsParam || String(columnsParam).toLowerCase() === "all") {
    return CUSTOMER_EXPORT_COLUMNS;
  }
  const requested = new Set(
    String(columnsParam)
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
  );
  for (const key of REQUIRED_CUSTOMER_EXPORT_KEYS) requested.add(key);
  return CUSTOMER_EXPORT_COLUMNS.filter((col) => requested.has(col.key));
}

function mapCustomerExportRow(row) {
  return {
    customerNumber: row.customerNumber,
    fullName: row.fullName,
    customerType: row.customerType,
    premiseType: row.premiseType || "apartment",
    buildingName: row.buildingName,
    apartmentNumber: row.apartmentNumber,
    block: row.block || "",
    businessName: row.businessName || "",
    shopLocation: row.shopLocation || "",
    productName: row.productName,
    paymentFrequency: row.paymentFrequency,
    subscriptionStatus: row.subscriptionStatus,
    dstvDecoderSerial: row.dstvDecoderSerial || "",
    packagePrice: row.packagePrice,
    phone: row.phone,
    email: row.email || "",
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toCustomersCsv(rows, columns = CUSTOMER_EXPORT_COLUMNS) {
  const headers = columns.map((col) => col.label);
  const lines = [headers.join(",")];
  for (const row of rows) {
    const mapped = mapCustomerExportRow(row);
    lines.push(columns.map((col) => csvCell(mapped[col.key])).join(","));
  }
  return lines.join("\n");
}

async function buildCustomersExportReport(rows, columns = CUSTOMER_EXPORT_COLUMNS) {
  return {
    title: "Customers",
    headers: columns,
    rows: rows.map(mapCustomerExportRow),
  };
}

async function exportCustomers(req, res, next) {
  try {
    const {
      status,
      subscriptionStatus,
      buildingId,
      search,
      page,
      limit,
      categoryId,
      customerType,
      premiseType,
      sortBy,
      sortDir,
      format,
      scope,
      columns,
    } = req.query;

    const exportScope = String(scope || "view").toLowerCase();
    const pageNum =
      exportScope === "all"
        ? 1
        : Math.max(1, parseInt(String(page || "1"), 10) || 1);
    const limitNum =
      exportScope === "all"
        ? 10000
        : Math.min(100, Math.max(1, parseInt(String(limit || "20"), 10) || 20));

    const result = await store.listCustomers({
      accountStatus: status,
      subscriptionStatus: subscriptionStatus || undefined,
      buildingId: buildingId ? Number(buildingId) : undefined,
      search,
      page: pageNum,
      limit: limitNum,
      categoryId: categoryId ? Number(categoryId) : undefined,
      customerType,
      premiseType,
      sortBy,
      sortDir,
      forExport: exportScope === "all",
    });

    const safeFormat = String(format || "csv").toLowerCase();
    const scopeSuffix =
      exportScope === "all" ? "all-records" : "current-view";
    const exportColumns = resolveCustomerExportColumns(columns);
    const report = await buildCustomersExportReport(result.data, exportColumns);
    return sendTableExport(
      res,
      report,
      safeFormat,
      `customers-${scopeSuffix}`
    );
  } catch (err) {
    return next(err);
  }
}

async function attachTispDueDate(customer, options = {}) {
  if (!customer?.id) return customer;

  const forceLive = options.forceLive === true;

  // Explicit refresh / detail sync: always pull live Client Status first.
  if (forceLive && customer.status === "active" && customer.customerNumber) {
    try {
      await refreshTispStatus(customer);
      customer = (await store.getCustomerById(customer.id)) || customer;
    } catch {
      /* fall through to snapshot */
    }
  }

  let dueDate =
    integrationSnapshot.normalizeTispDueDateValue(customer.tispDueDate) || null;

  try {
    const snap = await integrationSnapshot.getTispSnapshot(customer.id);
    dueDate =
      integrationSnapshot.dueDateFromTispSnapshotRow(snap) || dueDate || null;

    // Persist normalized due date back onto the snapshot when we recovered it from raw_json.
    if (
      snap &&
      dueDate &&
      (!snap.due_date ||
        integrationSnapshot.normalizeTispDueDateValue(snap.due_date) !== dueDate)
    ) {
      try {
        await query(
          `UPDATE tisp_customer_snapshots SET due_date = ? WHERE customer_id = ?`,
          [dueDate, customer.id]
        );
      } catch {
        /* best-effort backfill */
      }
    }
  } catch {
    /* keep whatever we already have */
  }

  // Live TISP lookup when snapshot has no due date (common for older syncs).
  if (!dueDate && customer.status === "active" && customer.customerNumber) {
    const timeoutMs = Number(process.env.TISP_QUOTE_TIMEOUT_MS || 5_000);
    try {
      const tisp = await Promise.race([
        getTISPCustomer(customer.customerNumber),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TISP due-date lookup timed out")), timeoutMs)
        ),
      ]);
      dueDate = integrationSnapshot.extractTispDueDate(tisp);
      if (dueDate || tisp) {
        try {
          await integrationSnapshot.upsertTispSnapshot(customer.id, tisp || {});
        } catch (e) {
          console.warn("TISP snapshot save (due date) failed:", e.message);
        }
      }
    } catch {
      /* TISP unavailable — fall through to estimate */
    }
  }

  // Last resort: estimate from last payment + billing frequency.
  if (!dueDate && customer.lastPaymentDate) {
    try {
      dueDate = estimateDueDateFromLastPayment(
        customer.lastPaymentDate,
        customer.paymentFrequency,
        customer.customPeriodDays
      );
      if (dueDate) {
        dueDate = integrationSnapshot.normalizeTispDueDateValue(dueDate) || String(dueDate).slice(0, 10);
      }
    } catch {
      /* ignore estimate errors */
    }
  }

  return { ...customer, tispDueDate: dueDate || null };
}

async function getCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    let customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (req.query.refresh === "true" && customer.status === "active") {
      await refreshTispStatusWithCooldown(customer);
      customer = await store.getCustomerById(id);
    }

    const [events, pendingUpgrade, customerWithDue] = await Promise.all([
      store.getCustomerEvents(id),
      pendingUpgradeStore.getActivePendingUpgrade(id),
      attachTispDueDate(customer),
    ]);

    return res.json({ customer: customerWithDue, events, pendingUpgrade });
  } catch (err) {
    return next(err);
  }
}

async function createCustomer(req, res, next) {
  try {
    const body = req.body || {};
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }
    if (!body.customerType) {
      return res.status(400).json({ error: "Customer type is required" });
    }
    const premiseType =
      String(body.premiseType || body.premise_type || "apartment")
        .trim()
        .toLowerCase() === "shop"
        ? "shop"
        : "apartment";
    body.premiseType = premiseType;
    if (premiseType === "shop") {
      if (!String(body.businessName || "").trim()) {
        return res.status(400).json({ error: "Business name is required for a shop" });
      }
      if (!String(body.shopLocation || "").trim()) {
        return res.status(400).json({ error: "Shop location is required" });
      }
    } else if (!body.apartmentNumber) {
      return res
        .status(400)
        .json({ error: "Customer type and apartment number are required" });
    }
    if (!body.buildingId || !body.productId || !body.paymentFrequency) {
      return res.status(400).json({
        error: "Building, package, and payment frequency are required",
      });
    }
    if (!["C2B", "B2B"].includes(body.customerType)) {
      return res.status(400).json({ error: "Customer type must be C2B or B2B" });
    }
    if (
      !["monthly", "quarterly", "yearly", "custom"].includes(
        body.paymentFrequency
      )
    ) {
      return res.status(400).json({ error: "Invalid payment frequency" });
    }
    if (
      body.paymentFrequency === "custom" &&
      !body.customPeriodDays &&
      !body.customPeriodMonths
    ) {
      return res
        .status(400)
        .json({ error: "Custom period days is required for custom billing" });
    }

    const paymentAlreadyMade = body.paymentAlreadyMade === true;
    const paymentMethod = String(body.paymentMethod || "")
      .trim()
      .toLowerCase();
    const mpesaCode = String(body.mpesaCode || body.mpesaReceipt || "")
      .trim()
      .toUpperCase();
    const paystackReference = String(body.paystackReference || "").trim();
    const bankReference = String(body.bankReference || "").trim();
    const paymentCoversInternet = body.paymentCoversInternet === true;
    const paymentCoversDecoder = body.paymentCoversDecoder === true;

    if (paymentAlreadyMade) {
      if (String(body.customerType).toUpperCase() !== "C2B") {
        return res.status(400).json({
          error: "Advance payment applies to C2B customers only",
        });
      }
      if (body.trialPeriod === true) {
        return res.status(400).json({
          error: "Trial period cannot be combined with advance payment",
        });
      }
      if (!["mpesa", "paystack", "bank"].includes(paymentMethod)) {
        return res.status(400).json({
          error: "Select a payment method: mpesa, paystack, or bank",
        });
      }
      if (paymentMethod === "mpesa" && !/^[A-Z0-9]{8,15}$/.test(mpesaCode)) {
        return res.status(400).json({
          error: "Enter a valid M-Pesa receipt code (8–15 letters/numbers)",
        });
      }
      if (paymentMethod === "paystack" && !paystackReference) {
        return res.status(400).json({
          error: "Enter the Paystack / Zoho payment REFERENCE#",
        });
      }

      // Always check the selected package before create.
      const productId = Number(body.productId);
      if (productId) {
        const product = await store.getProductById(productId);
        const hasDstv = Boolean(product?.has_dstv || product?.hasDstv);
        if (!paymentCoversInternet && !(hasDstv && paymentCoversDecoder)) {
          return res.status(400).json({
            error:
              "Select what the payment covers (Internet/package" +
              (hasDstv ? ", and/or DSTV decoder)" : ")"),
          });
        }
      } else if (!paymentCoversInternet && !paymentCoversDecoder) {
        return res.status(400).json({
          error: "Select what the payment covers for this package",
        });
      }
    }

    // Campaign is optional; if one is chosen it must currently be live.
    if (
      String(body.customerType).toUpperCase() === "C2B" &&
      body.trialPeriod !== true
    ) {
      const campaignStore = require("../services/campaignStore");
      const requestedId = body.campaignId != null ? Number(body.campaignId) : null;
      if (requestedId) {
        const liveCampaigns = await campaignStore.listActiveCampaigns();
        const selected = liveCampaigns.find((c) => c.id === requestedId);
        if (!selected) {
          return res.status(400).json({
            error: "Selected campaign is not currently live",
            code: "CAMPAIGN_NOT_LIVE",
          });
        }
      }
    }

    const {
      parseInstallationInput,
      scheduleCustomerInstallation,
      emailVarsFromInstallation,
    } = require("../services/installationStore");
    let installationInput;
    try {
      installationInput = parseInstallationInput(body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const created = await store.createCustomer(body);

    const leadId = body.leadId != null ? Number(body.leadId) : null;
    if (Number.isFinite(leadId) && leadId > 0) {
      try {
        const leadStore = require("../services/leadStore");
        const existingLead = await leadStore.getLeadById(leadId);
        if (existingLead && !existingLead.convertedCustomerId) {
          await leadStore.updateLead(leadId, {
            status: "converted",
            convertedCustomerId: created.customerId,
          });
          await leadStore.addMessage({
            leadId,
            direction: "outbound",
            channel: "system",
            body: `Verified and converted to customer ${created.customerNumber}`,
          });
          emitAdminUpdate("leads", {
            action: "updated",
            leadId,
            status: "converted",
            convertedCustomerId: created.customerId,
          });
        }
      } catch (e) {
        console.warn("lead conversion link failed:", e.message);
      }
    }

    // Acquisition campaign + referral attribution (non-trial C2B only).
    let campaignAttach = { attached: false };
    try {
      if (
        String(body.customerType).toUpperCase() === "C2B" &&
        body.trialPeriod !== true
      ) {
        const { attachCampaignOnOnboard } = require("../services/referralRewardService");
        campaignAttach = await attachCampaignOnOnboard(created.customerId, {
          campaignId: body.campaignId || null,
          campaignCode: body.campaignCode || null,
          referredByApartmentNumber:
            body.referredByApartmentNumber ||
            body.referredByCustomerNumber ||
            body.referredBy ||
            null,
          referredByCustomerId: body.referredByCustomerId || null,
          buildingId: body.buildingId || null,
          trialPeriod: body.trialPeriod === true,
        });
      }
    } catch (e) {
      console.warn("campaign attach on create failed:", e.message);
    }

    let installation = null;
    try {
      installation = await scheduleCustomerInstallation(
        {
          id: created.customerId,
          customerNumber: created.customerNumber,
          buildingId: body.buildingId,
          apartmentNumber: created.apartmentNumber,
        },
        {
          installationScheduledAt: installationInput.scheduledAt,
          installationAssignmentMode: installationInput.assignmentMode,
          installationTechnicianId: installationInput.technicianId,
        },
        { kind: "onboarding", createdBy: req.user?.id || null }
      );
    } catch (e) {
      console.warn("installation schedule on signup failed:", e.message);
    }

    // TISP BillingCycle stays Monthly.
    // Signup due-date policy:
    // - Trial: due at trial end.
    // - Prior payment made / C2B unpaid: due = today + 7 days (Net 7).
    // - B2B unpaid: due = today + 30 days (Net 30).
    //   Initial sync uses "today" as the invoice anchor; after Zoho creates the
    //   signup invoice we re-assert from the real invoice date when available.
    // Recurring start (non-trial): 7 days before next service due
    // (signup + payment frequency). e.g. created 14 Aug monthly → due 14 Sep → starts 7 Sep.
    const paymentAnchor = new Date();
    let serviceDueDate;
    if (body.trialPeriod) {
      serviceDueDate = computeTrialEndDate(paymentAnchor);
    } else if (paymentAlreadyMade) {
      serviceDueDate = moment
        .tz(DEFAULT_TZ)
        .startOf("day")
        .add(7, "days")
        .format("YYYY-MM-DD");
    } else {
      serviceDueDate = computeInvoiceDueDate(
        { customerType: body.customerType || "C2B" },
        paymentAnchor
      );
    }

    let tispError = await syncNewCustomerToTisp(
      created.customerId,
      created.customerNumber,
      { dueDate: serviceDueDate }
    );

    let zoho = { ok: false, error: null, invoice: null };
    try {
      const wantsSignupInvoice =
        String(body.customerType).toUpperCase() === "C2B" &&
        body.trialPeriod !== true;
      // Payment reference entered → always create Zoho invoice and mark paid.
      zoho = await onboardNewCustomerBilling(created.customerId, {
        forceBilling: wantsSignupInvoice || paymentAlreadyMade,
        forceEmail: wantsSignupInvoice && !paymentAlreadyMade,
        skipEmail: paymentAlreadyMade,
        replaceFormerTenant: true,
        paymentAlreadyMade,
        paymentMethod: paymentAlreadyMade ? paymentMethod : undefined,
        mpesaCode:
          paymentAlreadyMade && paymentMethod === "mpesa" ? mpesaCode : undefined,
        paystackReference:
          paymentAlreadyMade && paymentMethod === "paystack"
            ? paystackReference
            : undefined,
        bankReference:
          paymentAlreadyMade && paymentMethod === "bank"
            ? bankReference || undefined
            : undefined,
        paymentCoversInternet:
          paymentAlreadyMade && paymentCoversInternet ? true : false,
        paymentCoversDecoder:
          paymentAlreadyMade && paymentCoversDecoder ? true : false,
        serviceDueDate,
      });

      // Unpaid signup: align TISP due with Zoho invoice (sent date + Net 7/30).
      if (
        !body.trialPeriod &&
        !paymentAlreadyMade &&
        zoho?.ok &&
        zoho.invoice &&
        !zoho.invoice.paid
      ) {
        const invoiceDate =
          zoho.invoice.invoiceDate ||
          zoho.invoice.date ||
          null;
        const dueFromInvoice =
          zoho.invoice.dueDate ||
          zoho.invoice.due_date ||
          (invoiceDate
            ? computeInvoiceDueDate(
                { customerType: body.customerType || "C2B" },
                invoiceDate
              )
            : null);
        if (
          dueFromInvoice &&
          String(dueFromInvoice).slice(0, 10) !==
            String(serviceDueDate).slice(0, 10)
        ) {
          serviceDueDate = String(dueFromInvoice).slice(0, 10);
          const reassertError = await syncNewCustomerToTisp(
            created.customerId,
            created.customerNumber,
            { dueDate: serviceDueDate, preferUpdate: true }
          );
          if (reassertError) {
            tispError = tispError || reassertError;
          }
        } else if (dueFromInvoice) {
          serviceDueDate = String(dueFromInvoice).slice(0, 10);
        }
      }
    } catch (e) {
      zoho = { ok: false, error: e.message || "Zoho billing setup failed" };
    }

    let welcomeEmail = { ok: false, skipped: true };
    try {
      const { sendCustomerWelcomeEmail } = require("../services/customerWelcomeEmail");
      const welcomeCustomer = await store.getCustomerById(created.customerId);
      welcomeEmail = await sendCustomerWelcomeEmail(welcomeCustomer, {
        createdBy: req.user?.id || null,
        extraVars: emailVarsFromInstallation(installation),
      });
    } catch (e) {
      welcomeEmail = {
        ok: false,
        error: e.message || "Welcome email failed",
      };
      console.warn("welcome email on signup failed:", e.message);
    }

    try {
      await logActivity({
        eventType: tispError
          ? "customer_created_tisp_failed"
          : zoho.ok
            ? "customer_created"
            : "customer_created_zoho_failed",
        title: tispError
          ? "Customer created (TISP sync failed)"
          : zoho.ok
            ? "New customer registered"
            : "Customer created (Zoho billing failed)",
        message: tispError
          ? `${created.customerNumber}: ${tispError}`
          : zoho.error
            ? `${created.customerNumber}: ${zoho.error}`
            : `${created.customerName} (${created.customerNumber})`,
        source: tispError ? "tisp" : zoho.ok ? "admin" : "zoho",
        status: tispError || !zoho.ok ? "failed" : "success",
        customerRef: created.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (customer create) failed:", logErr.message);
    }

    const customer = await store.getCustomerById(created.customerId);
    notifyCustomersChanged(created.customerId, "created");
    return res.status(201).json({
      ok: true,
      customer,
      tisp: tispError
        ? { ok: false, error: tispError }
        : { ok: true, dueDate: serviceDueDate },
      zoho: zoho.ok
        ? {
            ok: true,
            zohoContactId: zoho.zohoContactId,
            contactCreated: zoho.contactCreated === true,
            contactUpdated: zoho.contactUpdated === true,
            billingSkipped: zoho.billingSkipped === true,
            invoice: zoho.invoice,
            outstandingInvoice: zoho.outstandingInvoice || null,
            recurring: zoho.recurring,
            trial: zoho.trial || null,
          }
        : { ok: false, error: zoho.error },
      campaign: campaignAttach?.attached
        ? {
            attached: true,
            campaignId: campaignAttach.campaign?.id || null,
            campaignCode: campaignAttach.campaign?.code || null,
            packageDiscountPercent:
              campaignAttach.packageDiscountPercent || null,
            referrerCustomerNumber:
              campaignAttach.referrer?.customerNumber || null,
          }
        : { attached: false, reason: campaignAttach?.reason || null },
      welcomeEmail,
      installation,
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_ip_address")) {
        return res.status(409).json({ error: "IP address is already assigned" });
      }
      if (msg.includes("uk_customer_number")) {
        return res.status(409).json({ error: "Customer number already exists for this apartment" });
      }
      return res.status(409).json({ error: "Duplicate customer record" });
    }
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

function resolveBillingOptions(current, overrides = {}) {
  const paymentFrequency =
    overrides.paymentFrequency || current.payment_frequency;
  let customPeriodDays =
    overrides.customPeriodDays !== undefined
      ? overrides.customPeriodDays
      : overrides.customPeriodMonths !== undefined
        ? Number(overrides.customPeriodMonths) * 30
        : current.custom_period_days;

  if (paymentFrequency === "custom") {
    customPeriodDays = Number(customPeriodDays);
    if (!customPeriodDays || customPeriodDays < 1) {
      throw new Error("Custom period must be at least 1 day");
    }
  } else {
    customPeriodDays = null;
  }

  return { paymentFrequency, customPeriodDays };
}

async function resolveCustomerDueDateFromTisp(customerRow, billingContext) {
  let dueDate = null;
  let subscriptionStatus = customerRow.subscriptionStatus;

  try {
    const snap = await integrationSnapshot.getTispSnapshot(customerRow.id);
    if (snap) {
      dueDate = integrationSnapshot.dueDateFromTispSnapshotRow(snap);
      if (snap.subscription_status) {
        subscriptionStatus = normalizeSubscriptionStatus(snap.subscription_status);
      }
    }
  } catch {
    /* ignore snapshot read errors */
  }

  const quoteTispTimeoutMs = Number(process.env.TISP_QUOTE_TIMEOUT_MS || 5_000);
  try {
    const tisp = await Promise.race([
      getTISPCustomer(customerRow.customerNumber),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("TISP quote lookup timed out")),
          quoteTispTimeoutMs
        )
      ),
    ]);
    dueDate = integrationSnapshot.extractTispDueDate(tisp) || dueDate;
    const tispStatus = tisp?.status ?? tisp?.Status ?? null;
    if (tispStatus) {
      subscriptionStatus = normalizeSubscriptionStatus(String(tispStatus));
      await store.updateCustomerSubscriptionStatus(customerRow.id, subscriptionStatus);
      customerRow.subscriptionStatus = subscriptionStatus;
    }
    try {
      await integrationSnapshot.upsertTispSnapshot(customerRow.id, tisp);
    } catch (e) {
      console.warn("TISP snapshot save failed:", e.message);
    }
  } catch {
    /* keep snapshot / estimate when TISP is slow or unreachable */
  }

  if (!dueDate && customerRow.lastPaymentDate) {
    dueDate = estimateDueDateFromLastPayment(
      customerRow.lastPaymentDate,
      billingContext?.payment_frequency ||
        customerRow.paymentFrequency ||
        customerRow.payment_frequency,
      billingContext?.custom_period_days ??
        customerRow.customPeriodDays ??
        customerRow.custom_period_days
    );
  }

  return { dueDate, subscriptionStatus };
}

async function buildUpgradeQuote(customerId, productId, billingOverrides = {}) {
  const current = await store.getCustomerContext(customerId);
  if (!current) {
    return { error: "Customer not found", status: 404 };
  }

  const newProduct = await store.getProductById(productId);
  if (!newProduct) {
    return { error: "Product not found", status: 404 };
  }

  const { paymentFrequency, customPeriodDays } = resolveBillingOptions(
    current,
    billingOverrides
  );

  const baselinePrice = await resolveBaselinePriceAtFrequency(
    store,
    current,
    paymentFrequency,
    customPeriodDays
  );
  const newPrice = store.resolvePackagePrice(
    newProduct,
    paymentFrequency,
    customPeriodDays
  );
  const change = classifyPackageChangeByPrice(baselinePrice, newPrice);
  if (!change.isUpgrade) {
    return {
      error:
        "Select a higher-priced package for this billing frequency to upgrade",
      status: 400,
    };
  }

  const customerRow = await store.getCustomerById(customerId);

  // Days remaining must be measured against the CURRENT billing period,
  // not the target frequency (e.g. keep monthly when upgrading to yearly).
  const { dueDate, subscriptionStatus } = await resolveCustomerDueDateFromTisp(
    customerRow,
    current
  );
  customerRow.subscriptionStatus = subscriptionStatus;

  const currentPackagePrice = Math.round(Number(current.package_price) || 0);
  const quote = calculateUpgradeQuote({
    currentPrice: currentPackagePrice,
    newPrice,
    paymentFrequency,
    customPeriodDays,
    currentPaymentFrequency: current.payment_frequency,
    currentCustomPeriodDays: current.custom_period_days,
    subscriptionStatus,
    dueDate,
    customerType: current.customer_type,
  });

  // First-time DSTV on this account → include one-time decoder charge in the top-up
  // only when the building uses individual decoders (not headend coax).
  const { buildingUsesDecoder } = require("../utils/dstvSetup");
  const addingDstv =
    !Boolean(current.product_has_dstv) &&
    Boolean(newProduct.has_dstv) &&
    buildingUsesDecoder(current);
  let decoderFee = 0;
  if (addingDstv) {
    const fromCustomer =
      customerRow.decoderFeeAmount != null
        ? Number(customerRow.decoderFeeAmount)
        : 0;
    decoderFee =
      fromCustomer > 0
        ? fromCustomer
        : Number(process.env.ZOHO_DSTV_ONE_TIME_FEE || 2900);
    if (decoderFee > 0) {
      quote.topUpAmount = Math.round(Number(quote.topUpAmount || 0) + decoderFee);
      quote.paymentRequired = quote.topUpAmount > 0;
      quote.recommendedPaymentMethod = recommendPaymentMethod({
        customerType: current.customer_type,
        daysUntilDue: quote.daysUntilDue,
        topUpAmount: quote.topUpAmount,
      });
    }
  }

  return {
    quote: {
      ...quote,
      decoderFee: addingDstv ? decoderFee : 0,
      addingDstv,
      customerNumber: customerRow.customerNumber,
      currentMbps: current.product_mbps,
      newMbps: newProduct.mbps,
      newProductName: newProduct.name,
      paymentFrequency,
      customPeriodDays,
    },
    current,
    newProduct,
    customerRow,
  };
}

async function getUpgradeQuote(req, res, next) {
  try {
    const productId = Number(req.query.productId);
    if (!productId) {
      return res.status(400).json({ error: "productId query is required" });
    }

    const billingOverrides = {};
    if (req.query.paymentFrequency) {
      billingOverrides.paymentFrequency = String(req.query.paymentFrequency);
    }
    if (req.query.customPeriodDays != null && req.query.customPeriodDays !== "") {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodDays);
    } else if (
      req.query.customPeriodMonths != null &&
      req.query.customPeriodMonths !== ""
    ) {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodMonths) * 30;
    }

    const result = await buildUpgradeQuote(
      Number(req.params.id),
      productId,
      billingOverrides
    );
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ quote: result.quote });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function buildDowngradeQuote(customerId, productId, billingOverrides = {}) {
  const current = await store.getCustomerContext(customerId);
  if (!current) {
    return { error: "Customer not found", status: 404 };
  }

  const newProduct = await store.getProductById(productId);
  if (!newProduct) {
    return { error: "Product not found", status: 404 };
  }

  const { paymentFrequency, customPeriodDays } = resolveBillingOptions(
    current,
    billingOverrides
  );

  const baselinePrice = await resolveBaselinePriceAtFrequency(
    store,
    current,
    paymentFrequency,
    customPeriodDays
  );
  const newPrice = store.resolvePackagePrice(
    newProduct,
    paymentFrequency,
    customPeriodDays
  );
  const change = classifyPackageChangeByPrice(baselinePrice, newPrice);
  if (!change.isDowngrade) {
    return {
      error:
        "Select a lower-priced package for this billing frequency to downgrade",
      status: 400,
    };
  }

  const customerRow = await store.getCustomerById(customerId);

  const { dueDate, subscriptionStatus } = await resolveCustomerDueDateFromTisp(
    customerRow,
    current
  );
  customerRow.subscriptionStatus = subscriptionStatus;

  const currentPackagePrice = Math.round(Number(current.package_price) || 0);
  const quote = calculateDowngradeQuote({
    currentPrice: currentPackagePrice,
    newPrice,
    paymentFrequency,
    customPeriodDays,
    currentPaymentFrequency: current.payment_frequency,
    currentCustomPeriodDays: current.custom_period_days,
    subscriptionStatus,
    dueDate,
    customerType: current.customer_type,
  });

  return {
    quote: {
      ...quote,
      customerNumber: customerRow.customerNumber,
      currentMbps: current.product_mbps,
      newMbps: newProduct.mbps,
      newProductName: newProduct.name,
      paymentFrequency,
      customPeriodDays,
    },
    current,
    newProduct,
    customerRow,
  };
}

async function getDowngradeQuote(req, res, next) {
  try {
    const productId = Number(req.query.productId);
    if (!productId) {
      return res.status(400).json({ error: "productId query is required" });
    }

    const billingOverrides = {};
    if (req.query.paymentFrequency) {
      billingOverrides.paymentFrequency = String(req.query.paymentFrequency);
    }
    if (req.query.customPeriodDays != null && req.query.customPeriodDays !== "") {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodDays);
    } else if (
      req.query.customPeriodMonths != null &&
      req.query.customPeriodMonths !== ""
    ) {
      billingOverrides.customPeriodDays = Number(req.query.customPeriodMonths) * 30;
    }

    const result = await buildDowngradeQuote(
      Number(req.params.id),
      productId,
      billingOverrides
    );
    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({ quote: result.quote });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function createUpgradeInvoice(customer, quote) {
  let zohoContact;
  let referenceNumber = customer.customerNumber;
  const ctx = await store.getCustomerContext(customer.id);

  if (isB2BCustomer(customer)) {
    const agency = await resolveAgencyForCustomer(customer, store);
    zohoContact = await findZohoContactForCustomer({
      ...customer,
      agencyName: agency.name,
    });
    if (!zohoContact?.contact_id) {
      const { ensureZohoContactForAgency } = require("./agencies.controller");
      zohoContact = await ensureZohoContactForAgency(agency);
    }
    referenceNumber = `${agency.name} — ${customer.customerNumber} upgrade`;
  } else {
    zohoContact = await findZohoContactForCustomer(customer);
  }

  if (!zohoContact?.contact_id) {
    throw new Error("Customer is not linked in Zoho — cannot create invoice");
  }

  const description = isB2BCustomer(customer)
    ? `Package upgrade (B2B via ${customer.agencyName}): ${quote.currentMbps} → ${quote.newMbps} Mbps (${customer.customerNumber})`
    : `Package upgrade top-up: ${quote.currentMbps} → ${quote.newMbps} Mbps (${customer.customerNumber})`;
  const packageTopUp = Math.max(
    0,
    Math.round(Number(quote.topUpAmount || 0) - Number(quote.decoderFee || 0))
  );
  const items = [];
  if (packageTopUp > 0) {
    const lineItem = {
      name: `Package upgrade — ${quote.newMbps} Mbps`,
      rate: packageTopUp,
      quantity: 1,
      description,
    };
    if (ZOHO_VAT_TAX_ID) {
      lineItem.tax_id = ZOHO_VAT_TAX_ID;
    }
    items.push(lineItem);
  }

  if (quote.addingDstv && Number(quote.decoderFee) > 0) {
    const { buildDstvDecoderFeeLineItem } = require("../utils/zohoInvoiceLineItems");
    const decoderLine = buildDstvDecoderFeeLineItem(
      {
        ...customer,
        hasDstv: true,
        decoderFeeAmount: quote.decoderFee,
      },
      { name: "Decoder charge" }
    );
    if (decoderLine) items.push(decoderLine);
  }

  if (!items.length) {
    throw new Error("Upgrade invoice has no billable line items");
  }

  const { buildZohoInvoiceNumber } = require("../utils/zohoInvoiceNumber");
  const buildingCode =
    ctx?.customer_type === "B2B" ? ctx?.b2b_code : ctx?.c2b_code;

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber,
    invoice_number: await buildZohoInvoiceNumber({
      customerId: customer.id,
      customerNumber: customer.customerNumber,
      buildingCode,
    }),
    due_date: computeInvoiceDueDate(customer),
    ...resolveZohoPaymentTerms(customer),
    customer,
  });

  if (isB2BCustomer(customer) && customer.agencyId) {
    try {
      const { refreshAgencyRecurring } = require("../services/agencyZohoBilling");
      await refreshAgencyRecurring(customer.agencyId);
    } catch (e) {
      console.warn("agency recurring refresh after upgrade invoice failed:", e.message);
    }
  }

  return {
    invoiceId: invoice?.invoice_id ? String(invoice.invoice_id) : null,
    invoiceNumber: invoice?.invoice_number || null,
    total: quote.topUpAmount,
  };
}

async function createDowngradeCreditNote(customer, quote) {
  const creditAmount = Math.round(Number(quote.creditAmount) || 0);
  if (creditAmount <= 0) {
    return null;
  }

  let zohoContact;
  let referenceNumber = customer.customerNumber;

  if (isB2BCustomer(customer)) {
    const agency = await resolveAgencyForCustomer(customer, store);
    zohoContact = await findZohoContactForCustomer({
      ...customer,
      agencyName: agency.name,
    });
    if (!zohoContact?.contact_id) {
      const { ensureZohoContactForAgency } = require("./agencies.controller");
      zohoContact = await ensureZohoContactForAgency(agency);
    }
    referenceNumber = `${agency.name} — ${customer.customerNumber} downgrade credit`;
  } else {
    zohoContact = await findZohoContactForCustomer(customer);
  }

  if (!zohoContact?.contact_id) {
    throw new Error("Customer is not linked in Zoho — cannot create credit note");
  }

  const daysLeft =
    quote.daysRemainingInPeriod != null
      ? `${quote.daysRemainingInPeriod}d unused`
      : "unused period";
  const description = isB2BCustomer(customer)
    ? `Package downgrade credit (B2B via ${customer.agencyName}): ${quote.currentMbps} → ${quote.newMbps} Mbps · ${daysLeft} (${customer.customerNumber})`
    : `Package downgrade credit: ${quote.currentMbps} → ${quote.newMbps} Mbps · ${daysLeft} (${customer.customerNumber})`;

  const lineItem = {
    name: `Package downgrade credit — ${quote.currentMbps} → ${quote.newMbps} Mbps`,
    rate: creditAmount,
    quantity: 1,
    description,
  };
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }

  const creditNote = await createCreditNote_JS({
    customer_id: zohoContact.contact_id,
    items: [lineItem],
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber,
    notes: quote.explanation || description,
  });

  if (creditNote) {
    try {
      await zohoEntityRepo.upsertCreditNoteRecord(creditNote);
    } catch (persistErr) {
      console.error(
        "zoho credit note local upsert failed:",
        persistErr.message
      );
    }
  }

  return {
    creditNoteId: creditNote?.creditnote_id
      ? String(creditNote.creditnote_id)
      : creditNote?.credit_note_id
        ? String(creditNote.credit_note_id)
        : null,
    creditNoteNumber:
      creditNote?.creditnote_number || creditNote?.credit_note_number || null,
    total: creditAmount,
  };
}

async function upgradePackage(req, res, next) {
  try {
    const { productId, paymentMethod, paymentFrequency, customPeriodDays } =
      req.body || {};
    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }

    const customerId = Number(req.params.id);
    const existingPending =
      await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (existingPending) {
      return res.status(409).json({
        error:
          "Customer already has a pending upgrade awaiting payment.",
        pendingUpgrade: existingPending,
      });
    }

    // Quote against current billing first (same as downgrade). Apply the new
    // frequency only after a successful immediate upgrade or payment completion.
    const billingOverrides = {};
    if (paymentFrequency) billingOverrides.paymentFrequency = paymentFrequency;
    if (customPeriodDays !== undefined) {
      billingOverrides.customPeriodDays = customPeriodDays;
    }

    const built = await buildUpgradeQuote(
      customerId,
      Number(productId),
      billingOverrides
    );
    if (built.error) {
      return res.status(built.status).json({ error: built.error });
    }

    const { quote, current, newProduct, customerRow } = built;
    let payment = null;
    let pendingUpgrade = null;

    if (quote.paymentRequired) {
      const method = paymentMethod || quote.recommendedPaymentMethod;
      if (method !== "invoice" && method !== "stk") {
        return res.status(400).json({
          error:
            "paymentMethod must be 'invoice' or 'stk' when a top-up is required",
          quote,
        });
      }

      if (method === "invoice") {
        let invoiceDetails;
        try {
          invoiceDetails = await createUpgradeInvoice(customerRow, quote);
        } catch (e) {
          return res.status(400).json({ error: e.message, quote });
        }

        payment = { method: "invoice", ...invoiceDetails };
        pendingUpgrade = await pendingUpgradeStore.createPendingUpgrade({
          customerId,
          targetProductId: Number(productId),
          paymentMethod: "invoice",
          topUpAmount: quote.topUpAmount,
          quote,
          zohoInvoiceId: payment.invoiceId,
          zohoInvoiceNumber: payment.invoiceNumber,
        });

        try {
          await logActivity({
            eventType: "zoho_invoice_created",
            title: "Upgrade invoice created",
            message: `${customerRow.customerNumber}: ${formatCurrency(quote.topUpAmount)} for ${quote.currentMbps} → ${quote.newMbps} Mbps — awaiting payment`,
            source: "zoho",
            status: "pending",
            customerRef: customerRow.customerNumber,
            referenceId: payment.invoiceId,
          });
        } catch (logErr) {
          console.error("activity log (upgrade invoice) failed:", logErr.message);
        }
      } else if (method === "stk") {
        if (!customerRow.phone) {
          return res
            .status(400)
            .json({ error: "Customer phone number is required for STK push", quote });
        }

        pendingUpgrade = await pendingUpgradeStore.createPendingUpgrade({
          customerId,
          targetProductId: Number(productId),
          paymentMethod: "stk",
          topUpAmount: quote.topUpAmount,
          quote,
        });

        const stk = await initiateSTKPush(
          customerRow.customerNumber,
          customerRow.phone,
          quote.topUpAmount,
          { liveAmount: true }
        );
        if (stk?.error) {
          await pendingUpgradeStore.cancelPendingUpgrade(pendingUpgrade.id);
          return res
            .status(502)
            .json({ error: stk.error || "Failed to initiate STK push", quote });
        }

        await pendingUpgradeStore.attachCheckoutToPendingUpgrade(
          pendingUpgrade.id,
          stk.CheckoutRequestID
        );
        pendingUpgrade = await pendingUpgradeStore.getPendingUpgradeById(
          pendingUpgrade.id
        );

        payment = {
          method: "stk",
          checkoutRequestId: stk.CheckoutRequestID || null,
          merchantRequestId: stk.MerchantRequestID || null,
          amount: quote.topUpAmount,
          phone: customerRow.phone,
        };
      }

      try {
        await logActivity({
          eventType: "upgrade_payment_pending",
          title: "Upgrade awaiting payment",
          message: `${customerRow.customerNumber}: ${quote.currentMbps} → ${quote.newMbps} Mbps · ${formatCurrency(quote.topUpAmount)} via ${payment?.method}`,
          source: payment?.method === "invoice" ? "zoho" : "mpesa",
          status: "pending",
          customerRef: customerRow.customerNumber,
          amount: quote.topUpAmount,
          referenceId:
            payment?.invoiceId || payment?.checkoutRequestId || null,
        });
      } catch (logErr) {
        console.error("activity log (upgrade pending) failed:", logErr.message);
      }

      const customer = await store.getCustomerById(customerId);
      return res.json({
        ok: true,
        pending: true,
        customer,
        quote,
        payment,
        pendingUpgrade,
      });
    }

    if (paymentFrequency) {
      await store.updateCustomerBillingCycle(
        customerId,
        paymentFrequency,
        customPeriodDays
      );
    }

    const { newProduct: product } = await store.changeCustomerProduct(
      customerId,
      Number(productId),
      "upgrade"
    );

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "customer_upgraded",
        title: "Upgrade package",
        message: `${customer?.customerNumber}: ${current.product_mbps} → ${newProduct.mbps} Mbps`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
        metadata: {
          changes: [
            {
              field: "package",
              label: "Package",
              from: `${current.product_name || current.product_mbps} (${current.product_mbps} Mbps)`,
              to: `${newProduct.name || newProduct.mbps} (${newProduct.mbps} Mbps)`,
            },
          ],
        },
      });
    } catch (logErr) {
      console.error("activity log (upgrade) failed:", logErr.message);
    }

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("upgrade", customer, {
        createdBy: req.user?.id || null,
        extraVars: {
          previousProductName: current.product_name || "",
          previousMbps: current.product_mbps,
          productName: newProduct.name || customer?.productName,
          productMbps: newProduct.mbps,
          packagePrice: customer?.packagePrice,
          paymentFrequency: customer?.paymentFrequency,
        },
      });
    } catch (e) {
      console.warn("upgrade email failed:", e.message);
    }

    return res.json({
      ok: true,
      pending: false,
      customer,
      product,
      quote,
      payment,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

function formatCurrency(amount) {
  return `KES ${Number(amount || 0).toLocaleString("en-KE")}`;
}

async function downgradePackage(req, res, next) {
  try {
    const { productId, paymentFrequency, customPeriodDays } = req.body || {};
    if (!productId) {
      return res.status(400).json({ error: "productId is required" });
    }
    const customerId = Number(req.params.id);
    const current = await store.getCustomerContext(customerId);
    if (!current) return res.status(404).json({ error: "Customer not found" });

    const pendingUpgrade = await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (pendingUpgrade) {
      await pendingUpgradeStore.cancelPendingUpgrade(pendingUpgrade.id);
    }

    const billingOverrides = {};
    if (paymentFrequency) billingOverrides.paymentFrequency = paymentFrequency;
    if (customPeriodDays !== undefined) {
      billingOverrides.customPeriodDays = customPeriodDays;
    }

    const built = await buildDowngradeQuote(
      customerId,
      Number(productId),
      billingOverrides
    );
    if (built.error) {
      return res.status(built.status).json({ error: built.error });
    }
    const { quote, newProduct, customerRow } = built;

    if (paymentFrequency) {
      await store.updateCustomerBillingCycle(
        customerId,
        paymentFrequency,
        customPeriodDays
      );
    }

    const { newProduct: product } = await store.changeCustomerProduct(
      customerId,
      Number(productId),
      "downgrade"
    );

    let creditNote = null;
    let creditNoteError = null;
    if ((quote.creditAmount || 0) > 0) {
      try {
        creditNote = await createDowngradeCreditNote(customerRow, quote);
      } catch (e) {
        creditNoteError = e.message || "Failed to create Zoho credit note";
        console.error("downgrade credit note failed:", e.message, e.zoho || "");
      }
    }

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(Number(req.params.id));

    try {
      await logActivity({
        eventType: "customer_downgraded",
        title: "Downgrade package",
        message: `${customer?.customerNumber}: ${current.product_mbps} → ${newProduct.mbps} Mbps${
          creditNote?.creditNoteNumber
            ? ` · credit note ${creditNote.creditNoteNumber} (${formatCurrency(quote.creditAmount)})`
            : (quote.creditAmount || 0) > 0
              ? ` · credit ${formatCurrency(quote.creditAmount)}${
                  creditNoteError ? ` (Zoho failed: ${creditNoteError})` : ""
                }`
              : ""
        }`,
        source: creditNote ? "zoho" : "tisp",
        status: tispError || creditNoteError ? "failed" : "success",
        customerRef: customer?.customerNumber,
        amount: (quote.creditAmount || 0) > 0 ? quote.creditAmount : undefined,
        referenceId: creditNote?.creditNoteId || null,
        metadata: {
          changes: [
            {
              field: "package",
              label: "Package",
              from: `${current.product_name || current.product_mbps} (${current.product_mbps} Mbps)`,
              to: `${newProduct.name || newProduct.mbps} (${newProduct.mbps} Mbps)`,
            },
          ],
        },
      });
    } catch (logErr) {
      console.error("activity log (downgrade) failed:", logErr.message);
    }

    if (creditNote?.creditNoteId) {
      try {
        await logActivity({
          eventType: "zoho_credit_note_created",
          title: "Downgrade credit note created",
          message: `${customer?.customerNumber}: ${formatCurrency(quote.creditAmount)} credit for ${quote.currentMbps} → ${quote.newMbps} Mbps`,
          source: "zoho",
          status: "success",
          customerRef: customer?.customerNumber,
          amount: quote.creditAmount,
          referenceId: creditNote.creditNoteId,
        });
      } catch (logErr) {
        console.error("activity log (downgrade credit note) failed:", logErr.message);
      }
    }

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("downgrade", customer, {
        createdBy: req.user?.id || null,
        extraVars: {
          previousProductName: current.product_name || "",
          previousMbps: current.product_mbps,
          productName: newProduct.name || customer?.productName,
          productMbps: newProduct.mbps,
          packagePrice: customer?.packagePrice,
          paymentFrequency: customer?.paymentFrequency,
        },
      });
    } catch (e) {
      console.warn("downgrade email failed:", e.message);
    }

    return res.json({
      ok: true,
      customer,
      product,
      quote,
      creditNote,
      creditNoteError: creditNoteError || undefined,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function cancelPendingUpgrade(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    const customer = await store.getCustomerById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const pending = await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (!pending) {
      return res.status(404).json({ error: "No pending upgrade to cancel" });
    }

    const cancelled = await pendingUpgradeStore.cancelPendingUpgrade(pending.id);
    const updatedCustomer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "upgrade_payment_cancelled",
        title: "Pending upgrade cancelled",
        message: `${customer.customerNumber}: ${pending.quote?.currentMbps ?? "?"} → ${pending.targetProductMbps} Mbps`,
        source: "admin",
        status: "success",
        customerRef: customer.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (upgrade cancel) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer: updatedCustomer,
      pendingUpgrade: cancelled,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function changePaymentFrequency(req, res, next) {
  try {
    const { paymentFrequency, customPeriodDays } = req.body || {};
    if (!paymentFrequency) {
      return res.status(400).json({ error: "paymentFrequency is required" });
    }

    const customerId = Number(req.params.id);
    const pendingUpgrade =
      await pendingUpgradeStore.getActivePendingUpgrade(customerId);
    if (pendingUpgrade) {
      return res.status(409).json({
        error:
          "Customer has a pending upgrade awaiting payment. Cancel it before changing billing frequency.",
        pendingUpgrade,
      });
    }

    const result = await store.changeCustomerPaymentFrequency(
      customerId,
      paymentFrequency,
      customPeriodDays
    );

    const ctx = await store.getCustomerContext(customerId);
    let tispError = null;
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    const zoho = await runZohoSyncForCustomer(customerId);

    const customer = await store.getCustomerById(customerId);

    try {
      await logActivity({
        eventType: "customer_frequency_changed",
        title: "Update frequency",
        message: `${customer?.customerNumber}: ${result.previousFrequency} → ${paymentFrequency}`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
        metadata: {
          changes: [
            {
              field: "paymentFrequency",
              label: "Payment frequency",
              from: String(result.previousFrequency || ""),
              to: String(paymentFrequency || ""),
            },
          ],
        },
      });
    } catch (logErr) {
      console.error("activity log (payment frequency) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer,
      product: result.newProduct,
      packagePrice: result.packagePrice,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function switchApartment(req, res, next) {
  try {
    const { apartmentNumber, ipAddress } = req.body || {};
    if (!apartmentNumber) {
      return res.status(400).json({ error: "apartmentNumber is required" });
    }

    const {
      parseInstallationInput,
      scheduleCustomerInstallation,
      emailVarsFromInstallation,
    } = require("../services/installationStore");
    let installationInput;
    try {
      installationInput = parseInstallationInput(req.body || {}, { required: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const result = await store.switchCustomerApartment(
      Number(req.params.id),
      apartmentNumber,
      { ipAddress }
    );

    let tispError = null;
    try {
      // Capture due date from the OLD TISP account before migrate releases it
      // (release sets DueDate=today on the old number only).
      let preservedDueDate =
        integrationSnapshot.normalizeTispDueDateValue(
          result.customer?.tisp_due_date || result.customer?.tispDueDate
        ) || null;
      try {
        const liveOld = await getTISPCustomer(result.previousCustomerNumber);
        preservedDueDate =
          integrationSnapshot.extractTispDueDate(liveOld) || preservedDueDate;
      } catch {
        /* snapshot / standard fallback inside migrate */
      }

      await pushCustomerToTisp(result.customer, {
        previousCustomerNumber: result.previousCustomerNumber,
        // Prefer old account number for PPPoE release; live TISP read still wins.
        previousApartmentNumber: result.previousCustomerNumber || result.oldApartment,
        dueDate: preservedDueDate || undefined,
      });
      await store.updateCustomerTispSync(Number(req.params.id), "synced", null);
    } catch (e) {
      tispError = e.message;
    }

    // ONU port is apartment-specific — clear so pause/disconnect cannot hit the old ONU.
    let oltCleared = false;
    try {
      oltCleared = await store.clearCustomerOnuMapping(Number(req.params.id));
    } catch (e) {
      console.warn("OLT mapping clear after apartment switch failed:", e.message);
    }

    // Zoho: company_name → new customer number + recurring profile rename.
    // TISP migrate already ran above; OLT ONU cleared (apartment-specific).
    const zoho = await runZohoSyncForCustomer(Number(req.params.id), {
      previousCustomerNumber: result.previousCustomerNumber,
      syncRecurring: true,
    });

    const customer = await store.getCustomerById(Number(req.params.id));

    let installation = null;
    try {
      installation = await scheduleCustomerInstallation(
        customer,
        {
          installationScheduledAt: installationInput.scheduledAt,
          installationAssignmentMode: installationInput.assignmentMode,
          installationTechnicianId: installationInput.technicianId,
        },
        {
          kind: "apartment_switch",
          createdBy: req.user?.id || null,
          notes: `${result.oldApartment} → ${result.newApartment}`,
        }
      );
    } catch (e) {
      console.warn("installation schedule on apartment switch failed:", e.message);
    }

    const zohoCompanyOk =
      zoho?.ok !== false &&
      !zoho?.skipped &&
      (zoho?.companyNameUpdated === true ||
        String(zoho?.companyName || "")
          .trim()
          .toUpperCase() ===
          String(customer?.customerNumber || "")
            .trim()
            .toUpperCase());
    const zohoRecurringOk =
      zoho?.ok === false || zoho?.skipped
        ? false
        : Boolean(
            zoho?.recurring?.updated ||
              zoho?.recurring?.created ||
              zoho?.recurring?.renameOnly ||
              zoho?.recurring?.reason === "no_package_price"
          );

    try {
      const zohoBits = [];
      if (zoho?.skipped) zohoBits.push(`zoho skipped (${zoho.reason || "n/a"})`);
      else if (zoho?.ok === false) zohoBits.push(`zoho failed: ${zoho.error || "unknown"}`);
      else {
        if (zohoCompanyOk) zohoBits.push("Zoho company → new number");
        if (zoho?.recurring?.updated || zoho?.recurring?.renameOnly) {
          zohoBits.push("recurring renamed");
        } else if (zoho?.recurring?.created) {
          zohoBits.push("recurring created");
        }
      }
      await logActivity({
        eventType: "customer_apartment_switched",
        title: "Move apartment",
        message: `${customer?.customerNumber}: ${result.oldApartment} → ${result.newApartment}${
          result.ipAddress ? ` · IP ${result.ipAddress}` : ""
        }${oltCleared ? " · OLT ONU mapping cleared" : ""}${
          zohoBits.length ? ` · ${zohoBits.join(", ")}` : ""
        }`,
        source: "tisp",
        status: tispError || zoho?.ok === false ? "failed" : "success",
        customerRef: customer?.customerNumber,
        metadata: {
          previousCustomerNumber: result.previousCustomerNumber,
          companyNameUpdated: Boolean(zohoCompanyOk),
          recurringUpdated: Boolean(zohoRecurringOk),
          changes: [
            {
              field: "apartment",
              label: "Apartment",
              from: result.oldApartment || null,
              to: result.newApartment || null,
            },
            ...(result.previousCustomerNumber &&
            result.previousCustomerNumber !== customer?.customerNumber
              ? [
                  {
                    field: "customerNumber",
                    label: "Customer number",
                    from: result.previousCustomerNumber,
                    to: customer?.customerNumber || null,
                  },
                ]
              : []),
            ...(result.ipAddress
              ? [
                  {
                    field: "ipAddress",
                    label: "IP address",
                    from: null,
                    to: result.ipAddress,
                  },
                ]
              : []),
          ],
        },
      });
    } catch (logErr) {
      console.error("activity log (switch apartment) failed:", logErr.message);
    }

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("apartment_move", customer, {
        createdBy: req.user?.id || null,
        extraVars: {
          previousApartment: result.oldApartment,
          previousCustomerNumber: result.previousCustomerNumber,
          ...emailVarsFromInstallation(installation),
        },
      });
    } catch (e) {
      console.warn("apartment move email failed:", e.message);
    }

    return res.json({
      ok: true,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
      olt: { clearedMapping: oltCleared },
      installation,
      renumber: {
        previousCustomerNumber: result.previousCustomerNumber,
        customerNumber: customer?.customerNumber,
        companyNameUpdated: Boolean(zohoCompanyOk),
        recurringUpdated: Boolean(
          zoho?.recurring?.updated ||
            zoho?.recurring?.created ||
            zoho?.recurring?.renameOnly
        ),
      },
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Target apartment customer number already exists" });
    }
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function stopZohoRecurringForCustomer(contactId, customerNumber) {
  if (!contactId || !customerNumber) return { stopped: 0 };
  const list = await getRecurringInvoices_JS({
    customer_id: contactId,
    per_page: 50,
  });
  const ref = String(customerNumber).trim().toUpperCase();
  const matches = (list || []).filter((row) => {
    const status = String(row.status || row.recurrence_status || "").toLowerCase();
    if (["stopped", "expired", "inactive"].includes(status)) return false;
    const rowRef = String(row.reference_number || row.recurrence_name || "")
      .trim()
      .toUpperCase();
    return rowRef === ref || rowRef.includes(ref);
  });

  let stopped = 0;
  for (const row of matches) {
    const id = row.recurring_invoice_id || row.recurringinvoice_id;
    if (!id) continue;
    try {
      await stopRecurringInvoice_JS(String(id));
      stopped += 1;
    } catch (e) {
      console.warn(
        `stop recurring ${id} for ${customerNumber} failed:`,
        e.message
      );
    }
  }
  return { stopped, matched: matches.length };
}

/**
 * Void overdue Zoho invoices for a cancelled customer. B2B is scoped to this
 * house's reference on the agency contact so sibling invoices stay untouched.
 * Best-effort: Zoho may reject void when payments are already applied.
 */
async function voidOverdueZohoInvoicesForCustomer(contactId, customer) {
  const empty = { overdueCount: 0, voided: 0, failed: 0, invoices: [] };
  if (!contactId) return empty;

  let invoices = [];
  try {
    invoices = await getInvoices_JS({
      customer_id: contactId,
      per_page: 200,
      page: 1,
    });
  } catch (e) {
    console.warn(
      `list overdue invoices on cancel failed for ${customer?.customerNumber || contactId}:`,
      e.message || e
    );
    return { ...empty, error: e.message || "Failed to list invoices" };
  }

  const overdue = selectOverdueZohoInvoicesToVoid(
    invoices || [],
    contactId,
    customer
  );
  if (!overdue.length) return empty;

  const liveNumber = String(customer?.customerNumber || "").trim();
  const reason = liveNumber
    ? `Subscription cancelled (${liveNumber})`
    : "Subscription cancelled";

  let voided = 0;
  let failed = 0;
  const results = [];

  for (const inv of overdue) {
    const invoiceId = inv.invoice_id || inv.id;
    const invoiceNumber = inv.invoice_number || invoiceId;
    if (!invoiceId) {
      failed += 1;
      results.push({ invoiceNumber, ok: false, error: "missing invoice_id" });
      continue;
    }
    try {
      await voidInvoice_JS(String(invoiceId), { reason });
      voided += 1;
      results.push({
        invoiceId: String(invoiceId),
        invoiceNumber,
        ok: true,
      });
      const customerId = customer?.id != null ? Number(customer.id) : null;
      if (customerId) {
        try {
          const customerRepo = require("../repositories/customer.repository");
          await customerRepo.upsertZohoInvoice(
            customerId,
            { ...inv, status: "void", balance: 0 },
            contactId
          );
        } catch (snapErr) {
          console.warn(
            `local snapshot after void ${invoiceNumber} failed:`,
            snapErr.message || snapErr
          );
        }
      }
    } catch (e) {
      failed += 1;
      console.warn(
        `void overdue invoice ${invoiceNumber} on cancel failed:`,
        e.message || e
      );
      results.push({
        invoiceId: String(invoiceId),
        invoiceNumber,
        ok: false,
        error: e.message || "void failed",
      });
    }
  }

  return {
    overdueCount: overdue.length,
    voided,
    failed,
    invoices: results,
  };
}

function zohoVoidActivityBits(zoho) {
  const voided = Number(zoho?.overdueInvoicesVoided) || 0;
  const voidFailed = Number(zoho?.overdueInvoicesFailed) || 0;
  return [
    voided > 0
      ? `Zoho voided ${voided} overdue invoice${voided === 1 ? "" : "s"}`
      : null,
    voidFailed > 0 ? `Zoho void failed ${voidFailed}` : null,
  ];
}

function recurringWouldInvoiceDuringPause(nextInvoiceDate, pauseStart, pauseEnd) {
  if (!nextInvoiceDate) return true;
  const next = String(nextInvoiceDate).slice(0, 10);
  return next >= pauseStart && next <= pauseEnd;
}

/**
 * Push Zoho recurring so the next invoice is after the pause and includes credited away days.
 */
async function deferZohoRecurringForCustomer(
  contactId,
  customerNumber,
  pauseStart,
  pauseEnd,
  credit = {}
) {
  if (!contactId || !customerNumber) {
    return { deferred: 0, matched: 0, resumeDate: pauseEnd, creditDays: 0 };
  }

  const creditDays = Math.max(0, Number(credit.creditDays) || 0);
  const creditedDueDate = credit.creditedDueDate || null;

  const list = await getRecurringInvoices_JS({
    customer_id: contactId,
    per_page: 50,
  });
  const ref = String(customerNumber).trim().toUpperCase();
  const matches = (list || []).filter((row) => {
    const status = String(row.status || row.recurrence_status || "").toLowerCase();
    if (["stopped", "expired", "inactive"].includes(status)) return false;
    const rowRef = String(row.reference_number || row.recurrence_name || "")
      .trim()
      .toUpperCase();
    return rowRef === ref || rowRef.includes(ref);
  });

  let deferred = 0;
  const profiles = [];
  for (const row of matches) {
    const id = row.recurring_invoice_id || row.recurringinvoice_id;
    if (!id) continue;
    const nextDate = row.next_invoice_date || null;
    const newStartDate = nextRecurringStartAfterPause({
      nextInvoiceDate: nextDate,
      pauseEnd,
      creditDays,
      creditedDueDate,
    });
    const mustShift =
      !nextDate ||
      recurringWouldInvoiceDuringPause(nextDate, pauseStart, pauseEnd) ||
      (newStartDate && nextDate < newStartDate);
    if (!mustShift || !newStartDate) {
      continue;
    }
    try {
      await updateRecurringInvoice_JS(String(id), { start_date: newStartDate });
      deferred += 1;
      profiles.push({
        recurringInvoiceId: String(id),
        previousNextInvoiceDate: nextDate,
        newStartDate,
        creditDays,
      });
    } catch (e) {
      console.warn(
        `defer recurring ${id} for ${customerNumber} failed:`,
        e.message
      );
    }
  }

  return {
    deferred,
    matched: matches.length,
    profiles,
    resumeDate: pauseEnd,
    creditDays,
    creditedDueDate,
  };
}

async function syncPauseZohoBilling(customerId, pauseStart, pauseEnd, credit = {}) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx) {
    return { ok: false, error: "Customer not found" };
  }

  const customer = {
    id: ctx.id,
    customerNumber: ctx.customer_number,
    customerType: ctx.customer_type,
    agencyId: ctx.agency_id,
    agencyName: ctx.agency_name,
    firstName: ctx.first_name,
    lastName: ctx.last_name,
    middleName: ctx.middle_name,
    phone: ctx.phone,
    email: ctx.email,
  };

  try {
    if (isB2BCustomer(customer)) {
      const agency = await resolveAgencyForCustomer(customer, store);
      if (!agency?.name) {
        return { ok: true, skipped: true, reason: "b2b_no_agency" };
      }
      const agencyContact = await getCustomerByCompanyName_JS(agency.name);
      if (!agencyContact?.contact_id) {
        return { ok: true, skipped: true, reason: "b2b_no_zoho_contact" };
      }
      const recurring = await deferZohoRecurringForCustomer(
        agencyContact.contact_id,
        ctx.customer_number,
        pauseStart,
        pauseEnd,
        credit
      );
      invalidateCustomerZoho(customerId);
      return {
        ok: true,
        skipped: false,
        contactId: agencyContact.contact_id,
        recurring,
      };
    }

    const contact = await findZohoContactForCustomer(customer);
    if (!contact?.contact_id) {
      return { ok: true, skipped: true, reason: "no_zoho_contact" };
    }

    const recurring = await deferZohoRecurringForCustomer(
      contact.contact_id,
      ctx.customer_number,
      pauseStart,
      pauseEnd,
      credit
    );

    try {
      const [invoices, payments, recurringList] = await Promise.all([
        getInvoices_JS({
          customer_id: contact.contact_id,
          per_page: 50,
          page: 1,
        }),
        getCustomerPayments_JS({
          customer_id: contact.contact_id,
          per_page: 50,
        }),
        getRecurringInvoices_JS({
          customer_id: contact.contact_id,
          per_page: 50,
        }),
      ]);
      await integrationSnapshot.saveZohoBillingSnapshot(customerId, {
        contact,
        invoices: invoices || [],
        payments: payments || [],
        recurring: recurringList || [],
      });
    } catch (e) {
      console.warn("Zoho snapshot refresh after pause failed:", e.message);
    }

    invalidateCustomerZoho(customerId);
    return {
      ok: true,
      skipped: false,
      contactId: contact.contact_id,
      recurring,
    };
  } catch (e) {
    return { ok: false, error: e.message || "Zoho pause billing sync failed" };
  }
}

/**
 * After local cancel: set TISP due date to cancellation day, void overdue
 * Zoho invoices, then for C2B mark the Zoho contact inactive (stop recurring
 * first). B2B only voids/stops that customer's invoices/recurring on the
 * agency contact — agency stays active.
 */
async function syncCancellationIntegrations(customerId, cancellationDate = new Date()) {
  const ctx = await store.getCustomerContext(customerId);
  if (!ctx) {
    return {
      tisp: { ok: false, error: "Customer not found" },
      zoho: { ok: false, error: "Customer not found" },
      olt: { ok: false, error: "Customer not found" },
    };
  }

  // Cancel archives local customer_number to {base}-CXL-{id}; TISP/Zoho still
  // use the live apartment number.
  const liveNumber =
    store.liveCustomerNumber(ctx.customer_number) || ctx.customer_number;
  const integrationCtx = { ...ctx, customer_number: liveNumber };

  const dueDateLabel = formatTispDueDate(cancellationDate);
  const result = {
    tisp: { ok: true, skipped: true },
    zoho: { ok: true, skipped: true },
    olt: { ok: true, skipped: true },
    cancellationDate: dueDateLabel,
  };

  try {
    const onTisp = await accountExistsOnTisp(liveNumber);
    if (onTisp) {
      await updateCustomerOnTisp(integrationCtx, {
        dueDate: cancellationDate,
        skipCooldown: true,
      });
      result.tisp = { ok: true, dueDate: dueDateLabel };
      try {
        await store.updateCustomerTispSync(customerId, "synced", null);
      } catch {
        /* ignore */
      }
    } else {
      result.tisp = { ok: true, skipped: true, reason: "not_on_tisp" };
    }
  } catch (e) {
    result.tisp = { ok: false, error: formatTispError(e) };
  }

  try {
    result.olt = await oltEmsService.deactivateOnuForCustomer(integrationCtx, {
      customerId: ctx.id,
      customerNumber: liveNumber,
    });
  } catch (e) {
    result.olt = {
      ok: false,
      skipped: false,
      error: e.message || "OLT deactivate failed",
    };
  }

  try {
    const customer = {
      id: ctx.id,
      customerNumber: liveNumber,
      customerType: ctx.customer_type,
      agencyId: ctx.agency_id,
      agencyName: ctx.agency_name,
      firstName: ctx.first_name,
      lastName: ctx.last_name,
      middleName: ctx.middle_name,
      phone: ctx.phone,
      email: ctx.email,
    };

    if (isB2BCustomer(customer)) {
      const agency = await resolveAgencyForCustomer(customer, store);
      if (!agency?.id) {
        result.zoho = { ok: true, skipped: true, reason: "b2b_no_agency" };
      } else {
        let agencyContact = null;
        try {
          agencyContact = await getCustomerByCompanyName_JS(agency.name);
        } catch (e) {
          console.warn(
            `cancel: agency Zoho contact lookup failed for ${agency.name}:`,
            e.message || e
          );
        }

        const overdueVoids = agencyContact?.contact_id
          ? await voidOverdueZohoInvoicesForCustomer(
              agencyContact.contact_id,
              customer
            )
          : { overdueCount: 0, voided: 0, failed: 0 };

        try {
          const { refreshAgencyRecurring } = require("../services/agencyZohoBilling");
          const refreshed = await refreshAgencyRecurring(agency.id);
          invalidateCustomerZoho(customerId);
          result.zoho = {
            ok: true,
            skipped: false,
            contactInactivated: false,
            reason: "b2b_agency_recurring_refreshed",
            recurring: refreshed.recurring || null,
            overdueInvoicesVoided: overdueVoids.voided,
            overdueInvoicesFailed: overdueVoids.failed,
            overdueInvoicesCount: overdueVoids.overdueCount,
          };
        } catch (e) {
          // Fall back to legacy per-number stop if consolidated refresh fails
          if (agencyContact?.contact_id) {
            const recurring = await stopZohoRecurringForCustomer(
              agencyContact.contact_id,
              liveNumber
            );
            invalidateCustomerZoho(customerId);
            result.zoho = {
              ok: true,
              skipped: false,
              contactInactivated: false,
              reason: "b2b_agency_contact_kept",
              recurringStopped: recurring.stopped,
              warning: e.message,
              overdueInvoicesVoided: overdueVoids.voided,
              overdueInvoicesFailed: overdueVoids.failed,
              overdueInvoicesCount: overdueVoids.overdueCount,
            };
          } else {
            result.zoho = {
              ok: false,
              error: e.message || "Agency recurring refresh failed",
              overdueInvoicesVoided: overdueVoids.voided,
              overdueInvoicesFailed: overdueVoids.failed,
              overdueInvoicesCount: overdueVoids.overdueCount,
            };
          }
        }
      }
    } else {
      const contact = await findZohoContactForCustomer(customer);
      if (!contact?.contact_id) {
        result.zoho = { ok: true, skipped: true, reason: "no_zoho_contact" };
      } else {
        const overdueVoids = await voidOverdueZohoInvoicesForCustomer(
          contact.contact_id,
          customer
        );
        const retired = await retireFormerZohoTenantContact(contact, {
          customerNumber: liveNumber,
          formerCustomerId: ctx.id,
          archivedCompanyName: store.archiveCancelledCustomerNumber(
            liveNumber,
            ctx.id
          ),
        });
        invalidateCustomerZoho(customerId);
        result.zoho = {
          ok: true,
          skipped: false,
          contactInactivated: true,
          companyNameArchived: retired?.archivedCompanyName || null,
          zohoContactId: contact.contact_id,
          recurringStopped: true,
          overdueInvoicesVoided: overdueVoids.voided,
          overdueInvoicesFailed: overdueVoids.failed,
          overdueInvoicesCount: overdueVoids.overdueCount,
        };
      }
    }
  } catch (e) {
    result.zoho = { ok: false, error: e.message || "Zoho cancellation sync failed" };
  }

  return result;
}

async function cancelSubscription(req, res, next) {
  try {
    const {
      notes,
      reason,
      onuCollectedAt,
      dstvDecoderCollectedAt,
    } = req.body || {};
    const customerId = Number(req.params.id);
    await store.cancelCustomer(customerId, {
      notes,
      reason: reason || notes,
      onuCollectedAt,
      dstvDecoderCollectedAt,
    });
    const cancellationDate = new Date();
    const customer = await store.getCustomerById(customerId);
    const liveNumber =
      store.liveCustomerNumber(customer?.customerNumber) ||
      customer?.customerNumber ||
      "";
    const emailCustomer = customer
      ? { ...customer, customerNumber: liveNumber }
      : customer;

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("cancellation", emailCustomer, {
        createdBy: req.user?.id || null,
        extraVars: {
          cancellationReason:
            customer?.cancellationReason || reason || notes || "",
        },
      });
    } catch (e) {
      console.warn("cancellation email failed:", e.message);
    }

    // TISP + Zoho after response — local cancel is already committed.
    setImmediate(() => {
      syncCancellationIntegrations(customerId, cancellationDate)
        .then(async (integrations) => {
          try {
            await logActivity({
              eventType: "customer_cancelled",
              title: "Cancel subscription",
              message: [
                liveNumber,
                customer?.cancellationReason || null,
                integrations.tisp?.dueDate
                  ? `TISP due ${integrations.tisp.dueDate}`
                  : null,
                integrations.zoho?.contactInactivated ? "Zoho inactive" : null,
                ...zohoVoidActivityBits(integrations.zoho),
                integrations.olt?.ok && !integrations.olt?.skipped
                  ? "OLT ONU deactivated"
                  : null,
                integrations.olt?.skipped
                  ? `OLT skipped (${integrations.olt.reason})`
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
              source: "admin",
              status:
                integrations.tisp?.ok !== false &&
                integrations.zoho?.ok !== false &&
                (integrations.olt?.ok !== false || integrations.olt?.skipped)
                  ? "success"
                  : "failed",
              customerRef: liveNumber,
            });
          } catch (logErr) {
            console.error("activity log (cancel) failed:", logErr.message);
          }
        })
        .catch((err) => {
          console.error(
            `[cancelSubscription] background sync failed for ${customerId}:`,
            err?.message || err
          );
        });
    });

    return res.json({
      ok: true,
      customer,
      tisp: { ok: true, pending: true },
      zoho: { ok: true, pending: true },
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

/**
 * Shared TISP "stop service today" push used by disconnect (Suspended) and pause (Paused).
 */
async function stopTispServiceToday(ctx) {
  const stopDate = new Date();
  const dueDateLabel = formatTispDueDate(stopDate);
  const tisp = { ok: true, skipped: true, dueDate: dueDateLabel };

  try {
    const onTisp = await accountExistsOnTisp(ctx.customer_number);
    if (onTisp) {
      await updateCustomerOnTisp(ctx, {
        dueDate: stopDate,
        skipCooldown: true,
      });
      tisp.ok = true;
      tisp.skipped = false;
    } else {
      tisp.ok = true;
      tisp.skipped = true;
      tisp.reason = "not_on_tisp";
    }
  } catch (e) {
    tisp.ok = false;
    tisp.skipped = false;
    tisp.error = formatTispError(e);
  }

  return tisp;
}

/**
 * After a payment that resumes a paused customer, push TISP DueDate forward
 * by the credited away days on top of the new billing period.
 */
async function extendTispDueDateForCustomer(ctx, dueDate) {
  const nextDue = formatDateOnly(dueDate);
  if (!ctx || !nextDue) {
    return { ok: true, skipped: true, reason: "missing_due_date" };
  }

  const tisp = { ok: true, skipped: true, dueDate: nextDue };
  try {
    const onTisp = await accountExistsOnTisp(ctx.customer_number);
    if (!onTisp) {
      tisp.reason = "not_on_tisp";
      return tisp;
    }
    await updateCustomerOnTisp(ctx, {
      dueDate: nextDue,
      skipCooldown: true,
    });
    tisp.ok = true;
    tisp.skipped = false;
    try {
      await integrationSnapshot.upsertTispSnapshot(ctx.id, {
        DueDate: nextDue,
        dueDate: nextDue,
        duedate: nextDue,
        status: "Active",
      });
    } catch (e) {
      console.warn("TISP snapshot save (pause credit) failed:", e.message);
    }
  } catch (e) {
    tisp.ok = false;
    tisp.skipped = false;
    tisp.error = formatTispError(e);
  }
  return tisp;
}

/**
 * Disconnect service on TISP by setting due date to today.
 * Keeps the local account active; sets subscription status to Suspended.
 */
async function disconnectCustomer(req, res, next) {
  try {
    const { notes } = req.body || {};
    const customerId = Number(req.params.id);
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (ctx.status === "cancelled") {
      return res.status(400).json({ error: "Cannot disconnect a cancelled customer" });
    }
    if (ctx.status !== "active") {
      return res.status(400).json({ error: "Customer is not active" });
    }

    const tisp = await stopTispServiceToday(ctx);

    const olt = await oltEmsService.deactivateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
    });

    await store.disconnectCustomer(customerId, notes);

    try {
      await integrationSnapshot.upsertTispSnapshot(customerId, {
        status: "Suspended",
        DueDate: tisp.dueDate,
        dueDate: tisp.dueDate,
        duedate: tisp.dueDate,
      });
    } catch (e) {
      console.warn("TISP snapshot save (disconnect) failed:", e.message);
    }

    try {
      await store.updateCustomerTispSync(
        customerId,
        tisp.ok ? "synced" : "failed",
        tisp.ok ? null : tisp.error || "TISP disconnect failed"
      );
    } catch {
      /* best-effort */
    }

    const customer = await store.getCustomerById(customerId);

    await logActivity({
      eventType: "customer_disconnected",
      title: "Suspend on TISP",
      message: [
        customer?.customerNumber || "",
        tisp.dueDate ? `TISP due ${tisp.dueDate}` : null,
        tisp.skipped ? "not on TISP" : null,
        tisp.error || null,
        olt.skipped ? null : olt.ok ? "OLT ONU deactivated" : olt.error,
        olt.skipped ? `OLT skipped (${olt.reason})` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "admin",
      status: tisp.ok && (olt.ok || olt.skipped) ? "success" : "failed",
      customerRef: customer?.customerNumber,
    });

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("disconnect", customer, {
        createdBy: req.user?.id || null,
      });
    } catch (e) {
      console.warn("disconnect email failed:", e.message);
    }

    return res.json({
      ok: true,
      customer,
      tisp,
      olt,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

/**
 * Pause service at customer request (away temporarily).
 * Same TISP stop as disconnect, but marks status Paused (not Suspended).
 */
async function pauseCustomer(req, res, next) {
  try {
    const {
      notes,
      reason,
      pauseStartDate,
      pauseEndDate,
      pause_start_date,
      pause_end_date,
    } = req.body || {};
    const customerId = Number(req.params.id);
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (ctx.status === "cancelled") {
      return res.status(400).json({ error: "Cannot pause a cancelled customer" });
    }
    if (ctx.status !== "active") {
      return res.status(400).json({ error: "Customer is not active" });
    }

    const pauseReason = String(reason || notes || "").trim();
    const startInput = pauseStartDate ?? pause_start_date ?? null;
    const endInput = pauseEndDate ?? pause_end_date ?? null;
    const pauseStart =
      formatDateOnly(startInput) || formatDateOnly(new Date().toISOString());
    const pauseEnd = formatDateOnly(endInput);

    if (!pauseReason) {
      return res.status(400).json({ error: "Pause reason is required" });
    }
    if (!pauseEnd) {
      return res.status(400).json({ error: "Pause end date is required" });
    }
    if (pauseEnd < pauseStart) {
      return res.status(400).json({
        error: "Pause end date must be on or after the start date",
      });
    }

    const originalDueDate =
      formatDateOnly(ctx.tisp_due_date || ctx.tispDueDate) || null;
    const pauseCredit = computePauseCredit({
      pauseStart,
      pauseEnd,
      originalDueDate,
    });

    const tisp = await stopTispServiceToday(ctx);

    const olt = await oltEmsService.deactivateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
    });

    await store.pauseCustomer(customerId, {
      reason: pauseReason,
      pauseStartDate: pauseStart,
      pauseEndDate: pauseEnd,
      creditDays: pauseCredit.creditDays,
      originalDueDate: pauseCredit.originalDueDate,
      creditedDueDate: pauseCredit.creditedDueDate,
    });

    const zoho = await syncPauseZohoBilling(
      customerId,
      pauseStart,
      pauseEnd,
      pauseCredit
    );

    try {
      await integrationSnapshot.upsertTispSnapshot(customerId, {
        status: "Paused",
        DueDate: tisp.dueDate,
        dueDate: tisp.dueDate,
        duedate: tisp.dueDate,
      });
    } catch (e) {
      console.warn("TISP snapshot save (pause) failed:", e.message);
    }

    try {
      await store.updateCustomerTispSync(
        customerId,
        tisp.ok ? "synced" : "failed",
        tisp.ok ? null : tisp.error || "TISP pause failed"
      );
    } catch {
      /* best-effort */
    }

    const customer = await store.getCustomerById(customerId);

    await logActivity({
      eventType: "customer_paused",
      title: "Pause service",
      message: [
        customer?.customerNumber || "",
        `away ${pauseStart} → ${pauseEnd}`,
        pauseCredit.creditDays > 0
          ? `${pauseCredit.creditDays} day${pauseCredit.creditDays === 1 ? "" : "s"} credited on next subscription`
          : null,
        pauseCredit.creditedDueDate
          ? `next due ${pauseCredit.creditedDueDate}`
          : null,
        pauseReason,
        tisp.dueDate ? `TISP due ${tisp.dueDate}` : null,
        zoho.skipped
          ? null
          : zoho.recurring?.deferred
            ? `Zoho recurring deferred (${pauseCredit.creditDays || 0}d credit)`
            : "Zoho recurring unchanged",
        zoho.error || null,
        tisp.skipped ? "not on TISP" : null,
        tisp.error || null,
        olt.skipped ? null : olt.ok ? "OLT ONU deactivated" : olt.error,
        olt.skipped ? `OLT skipped (${olt.reason})` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "admin",
      status:
        tisp.ok && (olt.ok || olt.skipped) && zoho.ok ? "success" : "failed",
      customerRef: customer?.customerNumber,
    });

    try {
      const { sendCustomerLifecycleEmail } = require("../services/customerWelcomeEmail");
      await sendCustomerLifecycleEmail("pause", customer, {
        createdBy: req.user?.id || null,
        extraVars: {
          pauseStartDate: pauseStart,
          pauseEndDate: pauseEnd,
          pauseReason,
          pauseCreditDays:
            pauseCredit.creditDays > 0 ? String(pauseCredit.creditDays) : "0",
          pauseCreditedDueDate: pauseCredit.creditedDueDate || "",
          pauseCreditNote:
            pauseCredit.creditDays > 0
              ? `The ${pauseCredit.creditDays} day${pauseCredit.creditDays === 1 ? "" : "s"} you are away will be added to your next subscription${
                  pauseCredit.creditedDueDate
                    ? ` (next due ${pauseCredit.creditedDueDate})`
                    : ""
                }.`
              : "",
        },
      });
    } catch (e) {
      console.warn("pause email failed:", e.message);
    }

    return res.json({
      ok: true,
      customer,
      pause: {
        startDate: pauseStart,
        endDate: pauseEnd,
        reason: pauseReason,
        creditDays: pauseCredit.creditDays,
        originalDueDate: pauseCredit.originalDueDate,
        creditedDueDate: pauseCredit.creditedDueDate,
      },
      tisp,
      olt,
      zoho,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function linkCustomerOlt(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    const { buildingOltId, oltMac, onuIndexStr, onuSn } = req.body || {};

    const customer = await store.updateCustomerOltMapping(customerId, {
      buildingOltId,
      oltMac,
      onuIndexStr,
      onuSn,
    });

    notifyCustomersChanged(customerId, "updated");
    return res.json({ ok: true, customer });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function deleteCustomerPermanently(req, res, next) {
  try {
    const id = Number(req.params.id);
    const customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (String(customer.status || "").toLowerCase() !== "cancelled") {
      return res.status(400).json({
        error:
          "Cancel the subscription first. Permanent delete only removes local records after cancel and does not update TISP or Zoho.",
      });
    }

    // Hard-delete from the admin DB only — no TISP/Zoho presence checks.
    // External accounts (if any) are left untouched.
    const deleted = await store.deleteCustomerCompletely(id);
    invalidateCustomerZoho(id);

    try {
      await logActivity({
        eventType: "customer_deleted",
        title: "Delete customer permanently",
        message: `${deleted.customerNumber} removed from admin database`,
        source: "admin",
        status: "success",
        customerRef: deleted.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (permanent delete) failed:", logErr.message);
    }

    notifyCustomersChanged(id, "deleted");
    return res.json({ ok: true, customerNumber: deleted.customerNumber });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function bulkCancelSubscriptions(req, res, next) {
  try {
    const { ids, notes, reason, onuCollectedAt, dstvDecoderCollectedAt } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array is required" });
    }

    const uniqueIds = [
      ...new Set(
        ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (!uniqueIds.length) {
      return res.status(400).json({ error: "No valid customer ids provided" });
    }

    const cancelPayload = {
      notes,
      reason: reason || notes,
      onuCollectedAt,
      dstvDecoderCollectedAt,
    };

    const results = [];
    const cancelledIds = [];
    for (const id of uniqueIds) {
      try {
        await store.cancelCustomer(id, cancelPayload);
        const customer = await store.getCustomerById(id);
        const liveNumber =
          store.liveCustomerNumber(customer?.customerNumber) ||
          customer?.customerNumber ||
          null;
        cancelledIds.push(id);
        results.push({
          id,
          ok: true,
          customerNumber: liveNumber,
          tisp: { ok: true, pending: true },
          zoho: { ok: true, pending: true },
        });
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: e.message,
        });
      }
    }

    if (cancelledIds.length) {
      const cancellationDate = new Date();
      setImmediate(() => {
        void (async () => {
          for (const id of cancelledIds) {
            try {
              const integrations = await syncCancellationIntegrations(
                id,
                cancellationDate
              );
              const customer = await store.getCustomerById(id);
              const liveNumber =
                store.liveCustomerNumber(customer?.customerNumber) ||
                customer?.customerNumber ||
                "";
              await logActivity({
                eventType: "customer_cancelled",
                title: "Cancel subscription",
                message: [
                  liveNumber,
                  customer?.cancellationReason || null,
                  integrations.tisp?.dueDate
                    ? `TISP due ${integrations.tisp.dueDate}`
                    : null,
                  integrations.zoho?.contactInactivated ? "Zoho inactive" : null,
                  ...zohoVoidActivityBits(integrations.zoho),
                ]
                  .filter(Boolean)
                  .join(" · "),
                source: "admin",
                status:
                  integrations.tisp?.ok !== false &&
                  integrations.zoho?.ok !== false
                    ? "success"
                    : "failed",
                customerRef: liveNumber,
              });
            } catch (err) {
              console.error(
                `[bulkCancel] background sync failed for ${id}:`,
                err?.message || err
              );
            }
          }
        })();
      });
    }

    const succeeded = results.filter((r) => r.ok).length;
    return res.json({
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function apartmentHistory(req, res, next) {
  try {
    const { buildingId, apartmentNumber } = req.params;
    const history = await store.getApartmentHistory(
      Number(buildingId),
      apartmentNumber
    );
    return res.json({ history });
  } catch (err) {
    return next(err);
  }
}

function downloadImportTemplate(_req, res) {
  const csv = buildCustomerImportTemplateCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="customer-import-template.csv"'
  );
  return res.send(csv);
}

const IMPORT_PROGRESS = {
  validating: "Validating row data…",
  resolving: "Looking up building and package…",
  checking_duplicates: "Checking for duplicate customer number and IP…",
  checking_apartment: "Checking apartment availability…",
  creating: "Creating customer record…",
  tisp_sync: "Registering customer on TISP…",
  tisp_status: "Fetching active status from TISP…",
  zoho_sync: "Linking customer in Zoho Books…",
  zoho_invoices: "Fetching invoice information from Zoho…",
  done: "Customer imported successfully",
};

function emitImportProgress(emit, payload) {
  if (typeof emit !== "function") return;
  emit({
    ...payload,
    message:
      payload.message ||
      IMPORT_PROGRESS[payload.step] ||
      payload.step ||
      "",
  });
}

async function importCustomerRowWithProgress(row, emit, batchSeen) {
  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "validating",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "resolving",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "checking_duplicates",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "checking_apartment",
  });

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "creating",
  });

  let created;
  try {
    created = await store.importCustomerFromRow(row, batchSeen);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      const msg = String(e.message || "");
      if (msg.includes("uk_customer_number")) {
        throw new Error("Customer number already exists for this apartment");
      }
      if (msg.includes("uk_ip_address")) {
        throw new Error("IP address is already assigned");
      }
      throw new Error("Duplicate customer record");
    }
    throw e;
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "tisp_sync",
    customerNumber: created.customerNumber,
  });

  const tispError = await syncNewCustomerToTisp(
    created.customerId,
    created.customerNumber
  );

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "tisp_status",
    customerNumber: created.customerNumber,
  });

  try {
    const customerForTisp = await store.getCustomerById(created.customerId);
    if (customerForTisp?.status === "active") {
      await refreshTispStatus(customerForTisp);
    }
  } catch {
    // best-effort
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "zoho_sync",
    customerNumber: created.customerNumber,
  });

  let zoho = {
    linked: false,
    zohoContactId: null,
    invoiceCount: 0,
    unpaidCount: 0,
    totalBalanceDue: 0,
    zohoError: null,
  };
  try {
    const billing = await onboardNewCustomerBilling(created.customerId, {
      replaceFormerTenant: true,
    });
    zoho = {
      linked: billing.ok,
      zohoContactId: billing.zohoContactId,
      invoiceCount: billing.invoice?.invoiceId ? 1 : 0,
      unpaidCount: billing.invoice?.invoiceId ? 1 : 0,
      totalBalanceDue: billing.invoice?.total ?? 0,
      zohoError: billing.error ?? null,
      signupInvoice: billing.invoice ?? null,
    };
  } catch (e) {
    zoho.zohoError = e.message || "Zoho billing setup failed";
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "zoho_invoices",
    customerNumber: created.customerNumber,
  });

  const customer = await store.getCustomerById(created.customerId);

  try {
    await logActivity({
      eventType: tispError
        ? "customer_imported_tisp_failed"
        : zoho.zohoError
          ? "customer_imported"
          : "customer_imported",
      title: tispError
        ? "Customer imported (TISP sync failed)"
        : zoho.zohoError
          ? "Customer imported (Zoho sync failed)"
          : "Customer imported",
      message: tispError
        ? `${created.customerNumber}: ${tispError}`
        : zoho.zohoError
          ? `${created.customerNumber}: ${zoho.zohoError}`
          : `${customer?.fullName || created.customerNumber} (${created.customerNumber})`,
      source: "admin",
      status: tispError || zoho.zohoError ? "failed" : "success",
      customerRef: created.customerNumber,
    });
  } catch (logErr) {
    console.error("activity log (customer import) failed:", logErr.message);
  }

  emitImportProgress(emit, {
    type: "progress",
    line: row.line,
    step: "done",
    customerNumber: created.customerNumber,
  });

  return {
    line: row.line,
    ok: true,
    customerNumber: created.customerNumber,
    tispOk: !tispError,
    tispError: tispError || null,
    zohoOk: zoho.linked && !zoho.zohoError,
    zohoError: zoho.zohoError || null,
    zohoLinked: zoho.linked,
    zohoInvoiceCount: zoho.invoiceCount,
    zohoUnpaidCount: zoho.unpaidCount,
    customer,
  };
}

async function importCustomers(req, res, next) {
  try {
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      return res.status(400).json({ error: "CSV body is required" });
    }

    const rows = parseCustomerImportCsv(csvText);
    if (!rows.length) {
      return res.status(400).json({ error: "No data rows found in CSV" });
    }

    const stream = String(req.query.stream || "").toLowerCase() === "1";
    const emit = stream
      ? (event) => {
          res.write(`${JSON.stringify(event)}\n`);
        }
      : null;

    if (stream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      emitImportProgress(emit, {
        type: "start",
        total: rows.length,
        step: "validating",
        message: `Starting import of ${rows.length} customer(s)…`,
      });
    }

    const results = [];
    const batchSeen = {
      customerNumbers: new Set(),
      ipAddresses: new Set(),
      dstvSerials: new Set(),
    };
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (stream) {
        emitImportProgress(emit, {
          type: "row_start",
          line: row.line,
          index: index + 1,
          total: rows.length,
          step: "validating",
        });
      }

      try {
        const result = await importCustomerRowWithProgress(row, emit, batchSeen);
        results.push(result);
        if (stream) {
          emitImportProgress(emit, {
            type: "row_done",
            ...result,
          });
        }
      } catch (e) {
        const failure = {
          line: row.line,
          ok: false,
          error: e.message,
        };
        results.push(failure);
        if (stream) {
          emitImportProgress(emit, {
            type: "row_error",
            ...failure,
          });
        }
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const summary = {
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };

    if (stream) {
      emitImportProgress(emit, {
        type: "complete",
        ...summary,
        step: "done",
      });
      return res.end();
    }

    return res.status(201).json(summary);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (!body.firstName || !body.lastName) {
      return res.status(400).json({ error: "First name and last name are required" });
    }

    const role = String(req.user?.role || "").toLowerCase();
    const isAdmin = role === "admin";
    const wantsPackageEdit =
      body.productId != null ||
      body.paymentFrequency != null ||
      body.customPeriodDays != null;

    if (wantsPackageEdit && !isAdmin) {
      return res.status(403).json({
        error: "Only administrators can edit package and billing frequency",
      });
    }

    const createInitialInvoice = body.createInitialInvoice === true;
    const createRecurringInvoice = body.createRecurringInvoice === true;
    const updateZohoRecurring = body.updateZohoRecurring === true;
    const forceLocalPackageCorrection =
      body.forceLocalPackageCorrection === true;
    const disregardExistingInvoices =
      body.disregardExistingInvoices === true;
    const tispDueDate = body.tispDueDate
      ? String(body.tispDueDate).trim()
      : null;

    const presenceBefore = await resolveCustomerIntegrationPresence(id);
    if (presenceBefore && !presenceBefore.onTisp && !tispDueDate) {
      return res.status(400).json({
        error: "Due date is required to create this customer on TISP",
      });
    }

    const {
      customer: updated,
      packageChanged,
      apartmentChanged,
      previousCustomerNumber,
      ipChanged,
      previousIp,
      changes: fieldChanges,
    } = await store.updateCustomerDetails(
      id,
      {
        firstName: body.firstName,
        lastName: body.lastName,
        middleName: body.middleName,
        phone: body.phone,
        email: body.email,
        billingAttention: body.billingAttention,
        billingAddress: body.billingAddress,
        billingStreet2: body.billingStreet2,
        billingCity: body.billingCity,
        billingState: body.billingState,
        billingZip: body.billingZip,
        billingCountry: body.billingCountry,
        isVatExempt: Boolean(body.isVatExempt),
        customerType: body.customerType,
        agencyId: body.agencyId,
        apartmentNumber: body.apartmentNumber,
        businessName: body.businessName,
        shopLocation: body.shopLocation,
        paymentFrequency: body.paymentFrequency,
        customPeriodDays: body.customPeriodDays,
        productId: body.productId,
        ipAddress: body.ipAddress,
        dstvDecoderSerial: body.dstvDecoderSerial,
        ppoeUsername: body.ppoeUsername,
        ppoePassword: body.ppoePassword,
        tispPassword: body.tispPassword,
      },
      {
        allowPackageEdit: isAdmin && wantsPackageEdit,
        forceLocalPackageCorrection,
      }
    );

    let tisp = { ok: true, skipped: true };
    let zoho = { ok: true, skipped: true };

    if (updated?.status === "active") {
      const syncResult = await syncIntegrationsOnCustomerUpdate(id, {
        createInitialInvoice,
        createRecurringInvoice,
        updateZohoRecurring,
        disregardExistingInvoices,
        tispDueDate: tispDueDate || undefined,
        apartmentChanged: Boolean(apartmentChanged),
        previousCustomerNumber: previousCustomerNumber || undefined,
        previousIp: ipChanged ? previousIp || undefined : undefined,
        newIp: ipChanged
          ? updated?.ipAddress || body.ipAddress || undefined
          : undefined,
      });
      tisp = syncResult.tisp;
      zoho = syncResult.zoho;

      if (
        packageChanged &&
        zoho.ok &&
        !createRecurringInvoice &&
        !updateZohoRecurring &&
        !createInitialInvoice
      ) {
        zoho = { ...zoho, packageNote: "package_db_only_unless_recurring_flag" };
      }
    }

    const customer = await attachTispDueDate(await store.getCustomerById(id));

    notifyCustomersChanged(id, "updated");
    try {
      const changeList = Array.isArray(fieldChanges) ? fieldChanges : [];
      const parts = changeList.slice(0, 4).map((c) => c.label);
      const more =
        changeList.length > 4 ? ` (+${changeList.length - 4} more)` : "";
      const detail = parts.length
        ? ` · ${parts.join(", ")}${more}`
        : packageChanged || apartmentChanged || ipChanged
          ? ` · ${[
              packageChanged ? "package changed" : null,
              apartmentChanged ? "apartment moved" : null,
              ipChanged ? "IP changed" : null,
            ]
              .filter(Boolean)
              .join(", ")}`
          : "";
      await logActivity({
        eventType: "customer_updated",
        title: "Edit customer details",
        message: `${customer?.firstName || ""} ${customer?.lastName || ""} (${
          customer?.customerNumber || id
        })${detail}`.trim(),
        source: "admin",
        status: "success",
        customerRef: customer?.customerNumber || null,
        referenceId: String(id),
        metadata: {
          packageChanged: Boolean(packageChanged),
          apartmentChanged: Boolean(apartmentChanged),
          ipChanged: Boolean(ipChanged),
          previousIp: ipChanged ? previousIp || null : null,
          newIp: ipChanged ? customer?.ipAddress || null : null,
          changes: changeList,
        },
      });
    } catch (logErr) {
      console.error("activity log (customer update) failed:", logErr.message);
    }
    return res.json({
      ok: true,
      customer,
      tisp: tisp.ok === false ? { ok: false, error: tisp.error } : { ok: true, ...tisp },
      zoho,
      packageChanged: Boolean(packageChanged),
    });
  } catch (err) {
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function convertCustomerTypeHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const targetType = body.customerType;

    if (!targetType || !["C2B", "B2B"].includes(String(targetType).toUpperCase())) {
      return res.status(400).json({ error: "customerType must be C2B or B2B" });
    }

    let agencyId = body.agencyId ? Number(body.agencyId) : null;
    let newAgencyZoho = null;
    if (body.newAgency) {
      const { name, email, phone, contactPerson } = body.newAgency;
      if (!name || !email || !phone) {
        return res
          .status(400)
          .json({ error: "Agency name, email, and phone are required" });
      }
      agencyId = await store.createAgency({ name, email, phone, contactPerson });
      try {
        const agency = await store.getAgencyById(agencyId);
        const { onboardAgencyZohoBilling } = require("../services/agencyZohoBilling");
        newAgencyZoho = await onboardAgencyZohoBilling(agency);
      } catch (e) {
        console.warn("New agency Zoho onboarding during convert failed:", e.message);
        newAgencyZoho = { ok: false, error: e.message };
      }
    }

    const result = await store.convertCustomerType(id, targetType, agencyId);

    // C2B → B2B: rename personal Zoho company_name + recurring to the new
    // number, then stop personal billing (agency takes over).
    if (result.previousType === "C2B" && result.newType === "B2B") {
      try {
        const lookup = {
          customerNumber: result.previousCustomerNumber,
          customerType: "C2B",
          firstName: result.customer?.firstName,
          lastName: result.customer?.lastName,
          email: result.customer?.email,
        };
        let oldContact = await findZohoContactForCustomer(lookup, {
          previousCustomerNumber: result.previousCustomerNumber,
        });
        if (
          !oldContact?.contact_id &&
          result.newCustomerNumber &&
          result.newCustomerNumber !== result.previousCustomerNumber
        ) {
          oldContact = await findZohoContactForCustomer({
            ...lookup,
            customerNumber: result.newCustomerNumber,
          });
        }
        if (oldContact?.contact_id) {
          try {
            const { renumberZohoContactCustomerNumber } = require("../services/customerZohoSync");
            await renumberZohoContactCustomerNumber(oldContact, {
              previousCustomerNumber: result.previousCustomerNumber,
              newCustomerNumber:
                result.newCustomerNumber || result.customer?.customerNumber,
              paymentFrequency: result.customer?.paymentFrequency,
              customPeriodDays: result.customer?.customPeriodDays,
            });
          } catch (renameErr) {
            console.warn(
              "Zoho customer-number update after B2B conversion failed:",
              renameErr.message || renameErr
            );
          }
          const newNumber =
            result.newCustomerNumber || result.customer?.customerNumber;
          await stopZohoRecurringForCustomer(
            oldContact.contact_id,
            newNumber || result.previousCustomerNumber
          );
          if (
            newNumber &&
            String(newNumber).toUpperCase() !==
              String(result.previousCustomerNumber || "").toUpperCase()
          ) {
            await stopZohoRecurringForCustomer(
              oldContact.contact_id,
              result.previousCustomerNumber
            );
          }
          await markContactInactive_JS(oldContact.contact_id);
        }
        await integrationSnapshot.clearZohoBillingSnapshot(id);
        invalidateCustomerZoho(id);
      } catch (e) {
        console.warn(
          "Zoho C2B contact cleanup after B2B conversion failed:",
          e.message
        );
      }
    }

    // B2B → C2B: drop agency snapshot, rebuild agency recurring without this
    // house, then provision a personal C2B contact + invoice + recurring.
    let excludeAgencyContactIds = [];
    if (result.previousType === "B2B" && result.newType === "C2B") {
      try {
        if (result.previousAgencyId) {
          const { refreshAgencyRecurring } = require("../services/agencyZohoBilling");
          const { findZohoContactForAgency } = require("./agencies.controller");
          const agency = await store.getAgencyById(result.previousAgencyId);
          if (agency) {
            try {
              const agencyContact = await findZohoContactForAgency(agency);
              if (agencyContact?.contact_id) {
                excludeAgencyContactIds.push(String(agencyContact.contact_id));
              }
            } catch (lookupErr) {
              console.warn(
                "Agency Zoho contact lookup after C2B conversion failed:",
                lookupErr.message
              );
            }
            await refreshAgencyRecurring(result.previousAgencyId);
          }
        }
      } catch (e) {
        console.warn(
          "Zoho B2B agency cleanup after C2B conversion failed:",
          e.message
        );
      }
      try {
        await integrationSnapshot.clearZohoBillingSnapshot(id);
        invalidateCustomerZoho(id);
      } catch (e) {
        console.warn(
          "Zoho snapshot detach after C2B conversion failed:",
          e.message
        );
      }
    }

    if (result.newType === "B2B" && result.agencyId) {
      try {
        const { syncAgencyBillingAfterManagedHouseAdded } = require("../services/agencyZohoBilling");
        await syncAgencyBillingAfterManagedHouseAdded(result.agencyId, id);
      } catch (e) {
        console.warn("Agency Zoho provisioning after type conversion failed:", e.message);
      }
    }

    let tispError = null;
    if (result.customer?.status === "active") {
      const dueForTisp =
        result.customer?.tispDueDate || TISP_STANDARD_DUE_DATE;
      try {
        const ctx = await store.getCustomerContext(id);
        await pushCustomerToTisp(ctx, {
          previousCustomerNumber: result.previousCustomerNumber,
          dueDate: ctx?.tisp_due_date || dueForTisp,
          skipCooldown: true,
          tispInPlaceUpdate: true,
          preferUpdate: true,
          allowCreate: false,
        });
        await store.updateCustomerTispSync(id, "synced", null);
      } catch (e) {
        // Retry UPDATE on the previous TISP account. Never INSERT a second client.
        const firstError = formatTispError(e);
        try {
          const freshCtx = await store.getCustomerContext(id);
          await pushCustomerToTisp(freshCtx, {
            previousCustomerNumber: result.previousCustomerNumber,
            dueDate:
              freshCtx?.tisp_due_date || dueForTisp,
            skipCooldown: true,
            tispInPlaceUpdate: true,
            preferUpdate: true,
            allowCreate: false,
          });
          await store.updateCustomerTispSync(id, "synced", null);
        } catch (retryErr) {
          tispError = formatTispError(retryErr) || firstError;
          await store.updateCustomerTispSync(id, "failed", tispError);
        }
      }
    }
    let zoho = { ok: true, skipped: true };
    if (result.customer?.status === "active") {
      if (result.previousType === "B2B" && result.newType === "C2B") {
        try {
          const {
            provisionC2BBillingAfterB2BConversion,
          } = require("../services/customerBillingOnboarding");
          zoho = await provisionC2BBillingAfterB2BConversion(id, {
            excludeContactIds: excludeAgencyContactIds,
            forceEmail: true,
            previousCustomerNumber: result.previousCustomerNumber,
          });
        } catch (e) {
          const message = e.message || "Zoho C2B billing after conversion failed";
          console.warn(message);
          try {
            await store.updateCustomerZohoBillingStatus(id, "failed", message);
          } catch {
            /* ignore */
          }
          zoho = { ok: false, error: message };
        }
      } else {
        zoho = await runZohoSyncForCustomer(id, {
          previousCustomerNumber: result.previousCustomerNumber,
          syncRecurring: result.newType === "C2B",
        });
      }
    }

    const customer = await store.getCustomerById(id);

    try {
      await logActivity({
        eventType: "customer_type_changed",
        title:
          result.newType === "B2B" ? "Convert to B2B" : "Convert to C2B",
        message: `${customer?.customerNumber}: ${result.previousType} → ${result.newType}${
          result.agencyName ? ` (${result.agencyName})` : ""
        }`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
        metadata: {
          changes: [
            {
              field: "customerType",
              label: "Billing type",
              from: result.previousType,
              to: result.newType,
            },
            ...(result.previousCustomerNumber &&
            result.previousCustomerNumber !== customer?.customerNumber
              ? [
                  {
                    field: "customerNumber",
                    label: "Customer number",
                    from: result.previousCustomerNumber,
                    to: customer?.customerNumber || null,
                  },
                ]
              : []),
            ...(result.agencyName
              ? [
                  {
                    field: "agency",
                    label: "Agency",
                    from: null,
                    to: result.agencyName,
                  },
                ]
              : []),
          ],
        },
      });
    } catch (logErr) {
      console.error("activity log (type change) failed:", logErr.message);
    }

    notifyCustomersChanged(id, "updated");
    return res.json({
      ok: true,
      ...result,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
    });
  } catch (err) {
    if (err.message && !err.statusCode) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function getCustomerPayments(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const mpesaRows = await query(
      `SELECT id, amount, mpesa_receipt, phone, channel, status, created_at, transaction_date
       FROM payment_transactions
       WHERE account_reference = ? AND status = 'SUCCESS'
       ORDER BY COALESCE(transaction_date, created_at) DESC, id DESC
       LIMIT ?`,
      [customer.customerNumber, limit]
    );

    const payments = mpesaRows.map((row) => ({
      id: `mpesa-${row.id}`,
      source: "mpesa",
      amount: row.amount != null ? Number(row.amount) : null,
      referenceId: row.mpesa_receipt || null,
      phone: row.phone || null,
      channel: row.channel || null,
      status: row.status,
      invoiceNumber: null,
      paidAt: row.transaction_date || row.created_at,
    }));

    const mpesaByRef = new Map();
    for (const payment of payments) {
      const key = payment.referenceId?.trim().toLowerCase();
      if (key && !mpesaByRef.has(key)) mpesaByRef.set(key, payment);
    }

    const applyInvoiceToMpesa = (reference, invoiceNumber) => {
      const key = String(reference || "").trim().toLowerCase();
      if (!key || !invoiceNumber) return false;
      const mpesa = mpesaByRef.get(key);
      if (!mpesa || mpesa.invoiceNumber) return false;
      mpesa.invoiceNumber = invoiceNumber;
      return true;
    };

    const linked = await loadZohoContactForCustomer(customer);
    const zohoContact = linked?.contact;
    const storedContactId = linked?.storedContactId || null;
    if (
      zohoContact?.contact_id &&
      zohoContactMatchesDashboardCustomer(
        zohoContact,
        customer,
        storedContactId
      )
    ) {
      const { getCustomerPayments_JS } = require("./zoho.controller");
      const zohoPayments = await getCustomerPayments_JS({
        customer_id: zohoContact.contact_id,
        per_page: limit,
      });

      for (const payment of zohoPayments || []) {
        const invoiceRef = integrationSnapshot.extractZohoAppliedInvoiceNumbers(payment);
        const ref = payment.reference_number || payment.payment_number || null;
        if (applyInvoiceToMpesa(payment.reference_number, invoiceRef)) {
          continue;
        }
        if (ref && mpesaByRef.has(String(ref).trim().toLowerCase())) {
          continue;
        }

        payments.push({
          id: `zoho-${payment.payment_id}`,
          source: "zoho",
          amount: payment.amount != null ? Number(payment.amount) : null,
          referenceId: payment.payment_number || String(payment.payment_id),
          phone: null,
          channel: payment.payment_mode || null,
          status: "received",
          invoiceNumber: invoiceRef,
          paidAt: payment.date || payment.payment_date || payment.created_time,
        });
      }
    }

    try {
      const storedPayments = await integrationSnapshot.listZohoPayments(customer.id);
      for (const stored of storedPayments || []) {
        applyInvoiceToMpesa(stored.referenceId, stored.invoiceNumber);
      }
    } catch {
      /* snapshot is a best-effort fallback for M-Pesa invoice links */
    }

    payments.sort(
      (a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime()
    );

    return res.json({ payments: payments.slice(0, limit) });
  } catch (err) {
    return next(err);
  }
}

async function getCustomerInvoices(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const zoho = await fetchCustomerZohoInvoices(customer);
    return res.json({
      invoices: zoho.invoices,
      zohoLinked: zoho.linked,
      zohoContactId: zoho.zohoContactId,
      billedViaAgency: zoho.billedViaAgency || false,
      agencyName: zoho.agencyName || null,
      billingNote: zoho.billingNote || null,
      lastSyncedAt: zoho.lastSyncedAt || null,
      fromSnapshot: zoho.fromSnapshot === true,
      cacheFresh: zoho.cacheFresh === true,
      creditBalance: Number(zoho.creditBalance) > 0 ? Number(zoho.creditBalance) : 0,
      hasFormerTenantInvoices: zoho.hasFormerTenantInvoices === true,
      formerTenantInvoiceCount: Number(zoho.formerTenantInvoiceCount) || 0,
    });
  } catch (err) {
    return next(err);
  }
}

async function retryBillingOnboarding(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    if (customer.status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Cannot retry billing for a cancelled customer" });
    }
    if (isB2BCustomer(customer)) {
      return res.status(400).json({
        error: "B2B customers do not use Zoho Books contacts",
      });
    }

    const paymentAlreadyMade = body.paymentAlreadyMade === true;
    const paymentMethod = String(body.paymentMethod || "")
      .trim()
      .toLowerCase();
    const mpesaCode = body.mpesaCode
      ? String(body.mpesaCode).trim().toUpperCase()
      : "";
    const paystackReference = body.paystackReference
      ? String(body.paystackReference).trim()
      : "";
    const bankReference = body.bankReference
      ? String(body.bankReference).trim()
      : "";
    const paymentCoversInternet = body.paymentCoversInternet === true;
    const paymentCoversDecoder = body.paymentCoversDecoder === true;

    if (paymentAlreadyMade) {
      if (!["mpesa", "paystack", "bank"].includes(paymentMethod)) {
        return res.status(400).json({
          error: "Select a payment method (M-Pesa, Paystack, or Bank)",
        });
      }
      if (paymentMethod === "mpesa" && !/^[A-Z0-9]{8,15}$/.test(mpesaCode)) {
        return res.status(400).json({
          error: "Enter a valid M-Pesa receipt code (8–15 letters/numbers)",
        });
      }
      if (paymentMethod === "paystack" && !paystackReference) {
        return res.status(400).json({
          error: "Enter the Paystack / Zoho payment REFERENCE#",
        });
      }
      const { buildingUsesDecoder } = require("../utils/dstvSetup");
      const hasDecoderFee = Boolean(
        buildingUsesDecoder(customer) &&
          (customer.hasDstv || customer.decoderFeeRequired)
      );
      if (!paymentCoversInternet && !(hasDecoderFee && paymentCoversDecoder)) {
        return res.status(400).json({
          error:
            "Select what the payment covers (Internet/package" +
            (hasDecoderFee ? ", and/or DSTV decoder)" : ")"),
        });
      }
    }

    syncCooldown.assertSyncAllowed(id);
    invalidateCustomerZoho(id);

    try {
      const billing = await onboardNewCustomerBilling(id, {
        forceBilling: true,
        forceEmail: !paymentAlreadyMade,
        skipEmail: paymentAlreadyMade,
        replaceFormerTenant: true,
        paymentAlreadyMade,
        paymentMethod: paymentAlreadyMade ? paymentMethod : undefined,
        mpesaCode:
          paymentAlreadyMade && paymentMethod === "mpesa" ? mpesaCode : undefined,
        paystackReference:
          paymentAlreadyMade && paymentMethod === "paystack"
            ? paystackReference
            : undefined,
        bankReference:
          paymentAlreadyMade && paymentMethod === "bank"
            ? bankReference || undefined
            : undefined,
        paymentCoversInternet:
          paymentAlreadyMade && paymentCoversInternet ? true : false,
        paymentCoversDecoder:
          paymentAlreadyMade && paymentCoversDecoder ? true : false,
      });
      if (!billing.ok) {
        return res.status(502).json({
          ok: false,
          error: billing.error || "Billing onboarding failed",
          billing,
        });
      }

      const updatedCustomer = await store.getCustomerById(id);
      const zoho = await fetchCustomerZohoInvoices(updatedCustomer || customer, {
        skipCache: true,
      });

      // Replace must leave this customer on a fresh Zoho contact — not the
      // former tenant's invoice history. forceBilling alone used to report
      // success while still linked to the old contact.
      if (zoho?.hasFormerTenantInvoices) {
        return res.status(502).json({
          ok: false,
          error:
            "Still linked to the previous tenant’s Zoho contact (older invoices remain). Open Zoho Books, confirm the former contact was renamed to …-CXL-… and marked inactive, then try Replace again.",
          billing: {
            ...billing,
            retiredFormer: Boolean(billing.retiredFormer),
            contactCreated: Boolean(billing.contactCreated),
          },
          zoho,
          customer: updatedCustomer,
        });
      }

      try {
        const invoice = billing.invoice || {};
        await logActivity({
          eventType: invoice.created
            ? "zoho_billing_retry"
            : "zoho_billing_retry_linked",
          title: invoice.created
            ? paymentAlreadyMade
              ? "Billing onboarding retried — invoice created (already paid)"
              : "Billing onboarding retried — invoice created"
            : invoice.reused
              ? "Billing onboarding retried — existing invoice"
              : "Billing onboarding retried",
          message: [
            customer.customerNumber,
            invoice.invoiceNumber || null,
            paymentAlreadyMade
              ? `paid via ${paymentMethod}${
                  mpesaCode || paystackReference || bankReference
                    ? ` ${mpesaCode || paystackReference || bankReference}`
                    : ""
                }`
              : invoice.emailed
                ? "emailed"
                : null,
          ]
            .filter(Boolean)
            .join(" · "),
          source: "zoho",
          status: "success",
          customerRef: customer.customerNumber,
          amount: invoice.total ?? null,
          referenceId: invoice.invoiceId ?? null,
        });
      } catch (e) {
        console.error("retry billing activity log failed:", e.message);
      }

      return res.json({
        ok: true,
        billing,
        customer: updatedCustomer,
        zoho,
      });
    } finally {
      syncCooldown.recordSync(id);
    }
  } catch (err) {
    return next(err);
  }
}

async function refreshCustomersBatch(req, res, next) {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [
      ...new Set(
        rawIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ].slice(0, 10);

    // List/search needs TISP status + due date quickly. Zoho is optional/slower.
    const includeZoho = req.body?.includeZoho === true;
    const force = req.body?.force === true;

    if (ids.length === 0) {
      return res.json({ customers: [], refreshed: 0, skipped: 0 });
    }

    let refreshed = 0;
    let skipped = 0;

    const updated = await mapWithConcurrency(ids, 5, async (id) => {
      if (!force && syncCooldown.getRemainingMs(id) > 0) {
        skipped += 1;
        const cached = await attachTispDueDate(await store.getCustomerById(id));
        return cached;
      }

      let customer = await store.getCustomerById(id);
      if (!customer || customer.status !== "active") {
        skipped += 1;
        return customer;
      }

      try {
        await refreshTispStatus({
          id: customer.id,
          customerNumber: customer.customerNumber,
        });
        await store.reconcileTispSyncStatus(id);

        if (includeZoho) {
          try {
            invalidateCustomerZoho(id);
            const zoho = await fetchCustomerZohoInvoices(customer, {
              skipCache: true,
            });
            await store.reconcileZohoBillingStatus(id, {
              linked: zoho?.linked,
              invoiceCount: zoho?.invoiceCount ?? 0,
            });
          } catch (e) {
            console.warn(
              `[refreshCustomersBatch] Zoho sync failed for ${customer.customerNumber}:`,
              e.message
            );
          }
        }

        syncCooldown.recordSync(id);
        refreshed += 1;
        return attachTispDueDate(await store.getCustomerById(id));
      } catch (e) {
        console.warn(
          `[refreshCustomersBatch] TISP sync failed for ${customer.customerNumber}:`,
          e.message
        );
        syncCooldown.recordSync(id);
        return attachTispDueDate(await store.getCustomerById(id));
      }
    });

    return res.json({
      customers: updated.filter(Boolean),
      refreshed,
      skipped,
    });
  } catch (err) {
    return next(err);
  }
}

async function refreshCustomerStatus(req, res, next) {
  try {
    const id = Number(req.params.id);
    let customer = await store.getCustomerById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    syncCooldown.assertSyncAllowed(id);
    invalidateCustomerZoho(id);

    let tispRefreshed = false;
    let tispMigrated = false;
    try {
      const tispPromise =
        customer.status === "active"
          ? (async () => {
              const ctx = await store.getCustomerContext(id);
              if (!ctx) return;

              const currentNumber = String(ctx.customer_number || "")
                .trim()
                .toUpperCase();
              const onCurrent = currentNumber
                ? await accountExistsOnTisp(currentNumber)
                : false;

              // Local number already converted but TISP still on the other
              // type code (e.g. local CLB-DLG1, TISP still CL-DLG1).
              if (!onCurrent) {
                const altNumber = alternateTypeAccountNumber(ctx);
                if (altNumber && (await accountExistsOnTisp(altNumber))) {
                  await updateCustomerOnTisp(ctx, {
                    accountNumber: altNumber,
                    skipCooldown: true,
                    dueDate:
                      ctx.tisp_due_date || TISP_STANDARD_DUE_DATE,
                    preferUpdate: true,
                  });
                  tispMigrated = true;
                  await store.updateCustomerTispSync(id, "synced", null);
                }
              }

              await refreshTispStatus({
                id: ctx.id,
                customerNumber: ctx.customer_number,
              });
              tispRefreshed = true;
            })()
          : Promise.resolve();

      const [, zoho, events, pendingUpgrade] = await Promise.all([
        tispPromise,
        fetchCustomerZohoInvoices(customer, { skipCache: true }),
        store.getCustomerEvents(id),
        pendingUpgradeStore.getActivePendingUpgrade(id),
      ]);

      await store.reconcileZohoBillingStatus(id, {
        linked: zoho?.linked,
        invoiceCount: zoho?.invoiceCount,
      });
      await store.reconcileTispSyncStatus(id);

      customer = await attachTispDueDate(await store.getCustomerById(id));

      return res.json({
        customer,
        events,
        pendingUpgrade,
        zoho,
        tisp: {
          refreshed: tispRefreshed,
          migrated: tispMigrated,
          dueDate: customer.tispDueDate || null,
        },
      });
    } finally {
      syncCooldown.recordSync(id);
    }
  } catch (err) {
    return next(err);
  }
}

async function previewShopCustomerNumber(req, res, next) {
  try {
    const buildingId = Number(req.query.buildingId);
    const customerType = String(req.query.customerType || "C2B")
      .trim()
      .toUpperCase();
    if (!buildingId) {
      return res.status(400).json({ error: "buildingId is required" });
    }
    if (!["C2B", "B2B"].includes(customerType)) {
      return res.status(400).json({ error: "customerType must be C2B or B2B" });
    }
    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    const { buildCustomerNumber, shopLocationCode } = require("../utils/customerNumber");
    const shopLocation = String(req.query.shopLocation || "").trim();
    const unitCode = shopLocationCode(shopLocation);
    return res.json({
      unitCode,
      customerNumber: buildCustomerNumber(
        building,
        customerType,
        unitCode,
        "shop"
      ),
    });
  } catch (err) {
    return next(err);
  }
}

async function getCustomerTransactions(req, res, next) {
  try {
    const customer = await store.getCustomerById(Number(req.params.id));
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }
    req.query = { ...req.query, customerRef: customer.customerNumber };
    return listUnifiedTransactions(req, res, next);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listCustomers,
  lookupCustomerByNumber,
  exportCustomers,
  getCustomer,
  previewShopCustomerNumber,
  getCustomerTransactions,
  getCustomerInvoices,
  getCustomerPayments,
  refreshCustomerStatus,
  refreshCustomersBatch,
  retryBillingOnboarding,
  getUpgradeQuote,
  getDowngradeQuote,
  createCustomer,
  updateCustomer,
  convertCustomerType: convertCustomerTypeHandler,
  upgradePackage,
  cancelPendingUpgrade,
  downgradePackage,
  changePaymentFrequency,
  switchApartment,
  cancelSubscription,
  disconnectCustomer,
  pauseCustomer,
  extendTispDueDateForCustomer,
  linkCustomerOlt,
  deleteCustomerPermanently,
  bulkCancelSubscriptions,
  createOnTisp: createOnTispHandler,
  bulkCreateOnTisp: bulkCreateOnTispHandler,
  apartmentHistory,
  downloadImportTemplate,
  importCustomers,
  syncNewCustomerToTisp,
  pushCustomerToTisp,
  runZohoSyncForCustomer,
  pushCustomerToZoho,
  ensureZohoContactForCustomer,
  buildZohoContactPayload,
  enforceZohoCompanyName,
  getCustomerIntegrations,
  resolveCustomerIntegrationPresence,
};
