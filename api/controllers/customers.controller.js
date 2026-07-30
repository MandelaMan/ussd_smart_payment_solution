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
} = require("../utils/upgradeQuote");
const { TISP_STANDARD_DUE_DATE } = require("../utils/tispConstants");
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
  updateRecurringInvoice_JS,
  markContactInactive_JS,
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
const {
  formatDateOnly,
  pickLatestPaymentDate,
  lastPaymentFromZohoInvoices,
  lastPaymentFromZohoPayments,
} = require("../utils/lastPaymentDate");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  resolveAgencyForCustomer,
  filterAgencyInvoicesForCustomer,
  resolveEffectiveCustomerEmail,
  resolveEffectiveCustomerPhone,
  b2bBillingMeta,
} = require("../utils/b2bBilling");
const {
  filterZohoInvoicesForContact,
  filterZohoPaymentsForContact,
  zohoContactMatchesDashboardCustomer,
} = require("../utils/zohoCustomerScope");
const { summarizeOverdueZohoInvoices } = require("../utils/zohoInvoiceStatus");
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

async function findZohoContactForCustomer(customer) {
  return findContactByLookupKeys_JS(getZohoContactLookupKeys(customer), {
    customer,
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

function pickPrimaryZohoContactPerson(contact) {
  const persons = contact?.contact_persons || [];
  if (!Array.isArray(persons) || persons.length === 0) return null;
  return persons.find((p) => p.is_primary_contact) || persons[0];
}

function buildZohoContactPersonPayload(existingContact, personFields) {
  const existingPerson = pickPrimaryZohoContactPerson(existingContact);
  const person = { ...personFields, is_primary_contact: true };
  if (existingPerson?.contact_person_id) {
    person.contact_person_id = existingPerson.contact_person_id;
  }
  return person;
}

/**
 * Zoho deletes omitted contact_persons on PUT. Preserve non-primary persons
 * so updates do not look like deletes (error 3043 on contacts with recurring invoices).
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
    if (
      (primaryId && id === primaryId) ||
      (!primaryId && p.is_primary_contact)
    ) {
      return primary;
    }
    return {
      contact_person_id: p.contact_person_id,
      first_name: p.first_name || "",
      last_name: p.last_name || "",
      email: p.email || undefined,
      phone: p.phone || undefined,
      mobile: p.mobile || p.phone || undefined,
      is_primary_contact: Boolean(p.is_primary_contact),
    };
  });
}

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
        formatZohoPhone(resolveEffectiveCustomerPhone(customer, agency)) || phone;
      email = resolveEffectiveCustomerEmail(customer, agency) || email;
    }
  }

  if (phone) {
    payload.phone = phone;
    payload.mobile = phone;
  }
  if (email) payload.email = email;

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

async function ensureZohoContactForCustomer(customer) {
  if (isB2BCustomer(customer)) {
    const { ensureZohoContactForAgency } = require("./agencies.controller");
    const agency = await resolveAgencyForCustomer(customer, store);
    return ensureZohoContactForAgency(agency);
  }

  const { updateContact_JS, getSpecificCustomer_JS, getContactFull_JS, markContactActive_JS } = require("./zoho.controller");

  function markCreated(contact, created) {
    if (contact && typeof contact === "object") {
      Object.defineProperty(contact, "_wasCreated", {
        value: Boolean(created),
        enumerable: false,
        configurable: true,
      });
    }
    return contact;
  }

  async function loadContactForUpdate(contactId) {
    const full = await getContactFull_JS(contactId);
    if (full?.contact_id) return full;
    const lean = await getSpecificCustomer_JS(String(contactId));
    return lean && typeof lean === "object" && lean.contact_id ? lean : null;
  }

  async function refreshExisting(existing) {
    let contactBase = existing;
    // Reactivate inactive Zoho contacts when linking an active dashboard customer
    // so we update the existing record instead of creating a duplicate.
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
  if (customer.id) {
    try {
      const snapId = await integrationSnapshot.getStoredZohoContactId(customer.id);
      if (snapId) {
        const byId = await loadContactForUpdate(snapId);
        if (byId?.contact_id) {
          return refreshExisting(byId);
        }
      }
    } catch {
      /* fall through to live lookup */
    }
  }

  // Live lookup by customer number / email / name — update if found, never duplicate.
  const existing = await findZohoContactForCustomer(customer);
  if (existing?.contact_id) {
    return refreshExisting(existing);
  }

  const payload = await buildZohoContactPayload(customer);
  let created = null;
  try {
    created = await createContact_JS(payload);
  } catch (e) {
    // Duplicate / race: resolve the existing contact and update it instead.
    const retry = await findZohoContactForCustomer(customer);
    if (retry?.contact_id) {
      return refreshExisting(retry);
    }
    throw new Error(
      `Zoho contact creation failed: ${e.response?.data?.message || e.message}`
    );
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
  const retry = await findZohoContactForCustomer(customer);
  if (retry?.contact_id) {
    return refreshExisting(retry);
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
        const { overdueCount, totalOverdueBalance } =
          summarizeOverdueZohoInvoices(mapped);
        const creditBalance = Number(stored.creditBalance) || 0;
        const result = {
          linked: true,
          zohoContactId: stored.zohoContactId,
          invoices: mapped,
          invoiceCount: mapped.length,
          unpaidCount: overdueCount,
          totalBalanceDue: totalOverdueBalance,
          creditBalance: creditBalance > 0 ? creditBalance : 0,
          fromSnapshot: true,
          lastSyncedAt: stored.syncedAt,
          cacheFresh: true,
        };
        setCachedCustomerZoho(customerId, result);
        try {
          await store.reconcileZohoBillingStatus(customerId, {
            linked: true,
            invoiceCount: mapped.length,
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

  const displayInvoices = isB2BCustomer(customer)
    ? filterAgencyInvoicesForCustomer(mapped, customer.customerNumber)
    : mapped;

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

async function refreshTispStatus(customer, options = {}) {
  const preferredDueDate = options.preferredDueDate
    ? integrationSnapshot.normalizeTispDueDateValue(options.preferredDueDate)
    : null;

  const preservePaused =
    normalizeSubscriptionStatus(customer.subscriptionStatus) === "Paused";

  try {
    const tisp = await getTISPCustomer(customer.customerNumber);
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
  const ppoeUsername =
    ctx.ppoe_username ??
    ctx.ppoeUsername ??
    (String(ipSetup || "").toUpperCase() === "PPOE"
      ? customerNumber
      : apartmentNumber);
  return {
    firstName,
    middleName,
    lastName,
    buildingName,
    customerNumber,
    customerType: ctx.customer_type ?? ctx.customerType,
    ipSetup,
    planName: ctx.plan_name ?? ctx.planName,
    mbps: ctx.product_mbps ?? ctx.productMbps,
    categoryName: ctx.category_name ?? ctx.categoryName,
    productName: ctx.product_name ?? ctx.productName,
    apartmentNumber,
    tispPassword: ctx.tisp_password ?? ctx.tispPassword,
    ppoeUsername,
    ipAddress: ctx.ip_address ?? ctx.ipAddress,
    email: resolveEffectiveCustomerEmail(
      {
        email: ctx.email,
        customer_type: ctx.customer_type ?? ctx.customerType,
      },
      { email: ctx.agency_email ?? ctx.agencyEmail }
    ),
    phone: resolveEffectiveCustomerPhone(
      {
        phone: ctx.phone,
        customer_type: ctx.customer_type ?? ctx.customerType,
      },
      { phone: ctx.agency_phone ?? ctx.agencyPhone }
    ),
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
  };
}

async function createCustomerOnTisp(ctx, meta = {}) {
  const buildingName = await resolveTispBuildingName(ctx);
  const ipSetup = await resolveTispBuildingIpSetup(ctx);
  const resolvedIp = await resolveIpForTispWrite(ctx);
  if (!resolvedIp) {
    throw new Error(
      "Static IP address is required for TISP create, but none is set on the customer"
    );
  }
  const input = tispPayloadInput(
    { ...ctx, ip_setup: ipSetup, ipSetup, ip_address: resolvedIp },
    buildingName,
    { dueDate: meta.dueDate }
  );
  assertCatalogPackageForTisp(input);
  const payload = buildTispCreateClientPayload(input);
  const result = await postSetClientDetails(payload, {
    customerId: ctx.id,
    customerNumber: ctx.customer_number ?? ctx.customerNumber,
    operation: "set_client_create",
    parentLogId: meta.parentLogId ?? null,
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
    if (ip && ip !== "0.0.0.0") return ip;
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

/**
 * TISP rejects blank StaticIPAddress ("StaticIPAddress Missing.").
 * When freeing an old account before INSERT, park it on this placeholder so the
 * real IP can be claimed by the new AccountNumber.
 */
const TISP_RELEASE_PLACEHOLDER_IP = "0.0.0.0";

async function resolveIpForTispWrite(ctx, accountNumberHint = null) {
  const local = String(ctx.ip_address || ctx.ipAddress || "").trim();
  if (local) return local;

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
  const ipSetup = await resolveTispBuildingIpSetup(ctx);
  const accountNumber = String(
    meta.accountNumber || ctx.customer_number || ctx.customerNumber || ""
  )
    .trim()
    .toUpperCase();

  const resolvedIp = meta.releaseNetwork
    ? TISP_RELEASE_PLACEHOLDER_IP
    : await resolveIpForTispWrite(ctx, accountNumber);

  const input = {
    ...tispPayloadInput(
      { ...ctx, ip_setup: ipSetup, ipSetup, ip_address: resolvedIp || ctx.ip_address },
      buildingName,
      { dueDate: meta.dueDate }
    ),
    customerNumber: accountNumber,
    ipAddress: resolvedIp,
  };

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

/**
 * Move a TISP client from previousAccountNumber → ctx.customer_number
 * (apartment switch / C2B↔B2B conversion).
 *
 * TISP keys accounts by AccountNumber and does NOT rename it on UPDATE.
 * IP/PPPoE held by the old number also block INSERT of the new number, so we:
 * 1) read due date from the old account
 * 2) release network resources on the old account (DueDate = today, clear IP/PPPoE)
 * 3) INSERT the new account with the new AccountNumber and preserved due date
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
    ctx.tisp_due_date ||
    ctx.tispDueDate ||
    null;
  let preservedDueDate = meta.dueDate || snapshotDue || null;
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

  const dueForCreate =
    preservedDueDate || meta.dueDate || snapshotDue || TISP_STANDARD_DUE_DATE;

  // Free IP / PPPoE on the old AccountNumber so INSERT can claim them.
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
    skipStatusRefresh: meta.skipStatusRefresh,
  };

  try {
    return await createCustomerOnTisp(createCtx, createMeta);
  } catch (createErr) {
    if (isTispDuplicateAccountError(createErr)) {
      return await updateCustomerOnTisp(createCtx, createMeta);
    }
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

/** Alternate C2B/B2B account number for the same apartment (CL-A10 ↔ CLB-A10). */
function alternateTypeAccountNumber(ctx) {
  const apartment = String(ctx.apartment_number || "").trim().toUpperCase();
  if (!apartment) return null;
  const currentType = String(ctx.customer_type || "").toUpperCase();
  const altCode =
    currentType === "B2B"
      ? String(ctx.c2b_code || "").trim()
      : String(ctx.b2b_code || "").trim();
  if (!altCode) return null;
  const altNumber = `${altCode}-${apartment}`;
  const current = String(ctx.customer_number || "").trim().toUpperCase();
  return altNumber.toUpperCase() === current ? null : altNumber.toUpperCase();
}

async function pushCustomerToTisp(ctx, meta = {}) {
  const skipCooldown = meta.skipCooldown === true;
  if (!skipCooldown) {
    syncCooldown.assertSyncAllowed(ctx.id);
  }

  const currentNumber = String(ctx.customer_number || "").trim().toUpperCase();
  const previousNumber = meta.previousCustomerNumber
    ? String(meta.previousCustomerNumber).trim().toUpperCase()
    : null;

  // Edits must never INSERT just because Client Status falsely says "missing".
  // Prefer UPDATE whenever the caller says so, or we previously synced, or a
  // local snapshot exists.
  const preferUpdate =
    meta.preferUpdate === true ||
    meta.forceUpdate === true ||
    meta.allowCreate === false ||
    String(ctx.tisp_sync_status || "").toLowerCase() === "synced" ||
    Boolean(ctx.tisp_due_date);

  try {
    // Customer number changed (apartment move / type convert). TISP UPDATE does
    // not rename AccountNumber — migrate old → new via release + INSERT.
    if (previousNumber && previousNumber !== currentNumber) {
      const onPrevious = await accountExistsOnTisp(previousNumber);
      if (onPrevious) {
        return await migrateTispAccountNumber(ctx, previousNumber, meta);
      }
    }

    const onCurrent = await accountExistsOnTisp(currentNumber);
    if (onCurrent) {
      return await updateCustomerOnTisp(ctx, meta);
    }

    // Recovery: local number already converted (CLB-A10) but TISP still has
    // the other type code (CL-A10) for the same apartment.
    const altNumber = alternateTypeAccountNumber(ctx);
    if (altNumber) {
      const onAlt = await accountExistsOnTisp(altNumber);
      if (onAlt) {
        return await migrateTispAccountNumber(ctx, altNumber, {
          ...meta,
          previousApartmentNumber:
            meta.previousApartmentNumber || altNumber,
        });
      }
    }

    // Existence check failed / unavailable — still try UPDATE first on edits.
    try {
      return await updateCustomerOnTisp(ctx, meta);
    } catch (updateErr) {
      if (preferUpdate && !isTispAccountMissingError(updateErr)) {
        // Soft Client Status failures / unrelated UPDATE errors: do not INSERT.
        throw updateErr;
      }

      try {
        return await createCustomerOnTisp(ctx, meta);
      } catch (createErr) {
        // Account already on TISP — Client Status lied. Fall back to UPDATE.
        if (isTispDuplicateAccountError(createErr)) {
          return await updateCustomerOnTisp(ctx, meta);
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
  let onTisp = false;
  let tispDueDate = null;
  try {
    onTisp = customerNumber
      ? Boolean(await accountExistsOnTisp(customerNumber))
      : false;
  } catch {
    onTisp =
      String(ctx.tisp_sync_status || "").toLowerCase() === "synced" &&
      String(ctx.subscription_status || "")
        .trim()
        .toLowerCase() !== "not on tisp";
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
          try {
            await integrationSnapshot.upsertZohoContact(customerId, live);
          } catch {
            /* ignore */
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
    onTisp,
    onZoho,
    zohoContactId,
    zohoContactStatus,
    zohoInactive,
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
    } else if (presence.onZoho) {
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

        if (!effectiveLastPaymentDate && !zohoLastPaymentDate) {
          paymentsInSync = true;
        } else if (zohoLastPaymentDate) {
          paymentsInSync = effectiveLastPaymentDate === zohoLastPaymentDate;
        } else {
          paymentsInSync = true;
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
  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim().toUpperCase()
    : null;
  const apartmentChanged = options.apartmentChanged === true || Boolean(previousCustomerNumber);
  const tispDueDateRaw = options.tispDueDate
    ? String(options.tispDueDate).trim()
    : "";
  // Do not force the cycle default over a live TISP due date on edit.
  // Prefer: explicit form value → current TISP due → standard default (create only).
  const tispDueDate = tispDueDateRaw;

  const ctx = await store.getCustomerContext(customerId);
  if (!ctx || ctx.status !== "active") {
    return {
      tisp: { ok: true, skipped: true },
      zoho: { ok: true, skipped: true },
    };
  }

  const presence = await resolveCustomerIntegrationPresence(customerId);
  const isB2B = Boolean(presence?.isB2B);

  let tisp = { ok: true };
  try {
    // Always update-first on edit. Never INSERT just because Client Status
    // reported onTisp=false (that caused "Duplicate Account Exists" on phone edits).
    const dueForSync =
      tispDueDate ||
      presence?.tispDueDate ||
      TISP_STANDARD_DUE_DATE;
    await pushCustomerToTisp(ctx, {
      previousCustomerNumber: previousCustomerNumber || undefined,
      previousApartmentNumber: options.previousApartmentNumber,
      dueDate: dueForSync,
      preferUpdate: true,
    });
    tisp = {
      ok: true,
      updated: true,
      migrated: Boolean(previousCustomerNumber),
      previousCustomerNumber: previousCustomerNumber || undefined,
      customerNumber: ctx.customer_number,
      dueDate: dueForSync,
    };
    await store.updateCustomerTispSync(customerId, "synced", null);
    // create/update already refresh live Client Status (+ preferred due date).
  } catch (e) {
    const message = formatTispError(e);
    await store.updateCustomerTispSync(customerId, "failed", message);
    tisp = { ok: false, error: message };
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
      let contact = await ensureZohoContactForCustomer(customer);
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
        invoice = await createSignupInvoice(customer, contact);
      }

      if (createRecurringInvoice || updateZohoRecurring || apartmentChanged) {
        recurring = await ensureRecurringSubscription(customer, contact, {
          startDate: invoice?.period?.endDate,
          previousCustomerNumber: previousCustomerNumber || undefined,
        });
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
      const message = e.message || "Zoho sync failed";
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
    return { ok: false, error: e.message || "Zoho sync failed" };
  }
}

async function syncNewCustomerToTisp(customerId, customerNumber, meta = {}) {
  try {
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx) throw new Error("Customer not found");

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
  { key: "buildingName", label: "Building" },
  { key: "apartmentNumber", label: "Apartment" },
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
    buildingName: row.buildingName,
    apartmentNumber: row.apartmentNumber,
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
    if (!body.customerType || !body.apartmentNumber) {
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

    const created = await store.createCustomer(body);

    const tispError = await syncNewCustomerToTisp(
      created.customerId,
      created.customerNumber
    );

    let zoho = { ok: false, error: null, invoice: null };
    try {
      zoho = await onboardNewCustomerBilling(created.customerId);
    } catch (e) {
      zoho = { ok: false, error: e.message || "Zoho billing setup failed" };
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
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho: zoho.ok
        ? {
            ok: true,
            zohoContactId: zoho.zohoContactId,
            contactCreated: zoho.contactCreated === true,
            contactUpdated: zoho.contactUpdated === true,
            invoice: zoho.invoice,
            recurring: zoho.recurring,
            trial: zoho.trial || null,
          }
        : { ok: false, error: zoho.error },
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
  const lineItem = {
    name: `Package upgrade — ${quote.newMbps} Mbps`,
    rate: quote.topUpAmount,
    quantity: 1,
    description,
  };
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }

  const { buildZohoInvoiceNumber } = require("../utils/zohoInvoiceNumber");
  const buildingCode =
    ctx?.customer_type === "B2B" ? ctx?.b2b_code : ctx?.c2b_code;

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items: [lineItem],
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber,
    invoice_number: await buildZohoInvoiceNumber({
      customerId: customer.id,
      customerNumber: customer.customerNumber,
      buildingCode,
    }),
  });

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
        title: "Customer package upgraded",
        message: `${customer?.customerNumber}: ${current.product_mbps} → ${newProduct.mbps} Mbps`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (upgrade) failed:", logErr.message);
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
        title: "Customer package downgraded",
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
        eventType: "customer_upgraded",
        title: "Payment frequency changed",
        message: `${customer?.customerNumber}: ${result.previousFrequency} → ${paymentFrequency}`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
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

    const result = await store.switchCustomerApartment(
      Number(req.params.id),
      apartmentNumber,
      { ipAddress }
    );

    let tispError = null;
    try {
      await pushCustomerToTisp(result.customer, {
        previousCustomerNumber: result.previousCustomerNumber,
        // Prefer old account number for PPPoE release; live TISP read still wins.
        previousApartmentNumber: result.previousCustomerNumber || result.oldApartment,
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

    const zoho = await runZohoSyncForCustomer(Number(req.params.id), {
      previousCustomerNumber: result.previousCustomerNumber,
      syncRecurring: true,
    });

    const customer = await store.getCustomerById(Number(req.params.id));

    try {
      await logActivity({
        eventType: "customer_apartment_switched",
        title: "Customer apartment switched",
        message: `${customer?.customerNumber}: ${result.oldApartment} → ${result.newApartment}${
          result.ipAddress ? ` · IP ${result.ipAddress}` : ""
        }${oltCleared ? " · OLT ONU mapping cleared" : ""}`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
      });
    } catch (logErr) {
      console.error("activity log (switch apartment) failed:", logErr.message);
    }

    return res.json({
      ok: true,
      customer,
      tisp: tispError ? { ok: false, error: tispError } : { ok: true },
      zoho,
      olt: { clearedMapping: oltCleared },
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

function recurringWouldInvoiceDuringPause(nextInvoiceDate, pauseStart, pauseEnd) {
  if (!nextInvoiceDate) return true;
  const next = String(nextInvoiceDate).slice(0, 10);
  return next >= pauseStart && next <= pauseEnd;
}

/**
 * Push Zoho recurring start_date to pause end so no invoice is issued during the away period.
 */
async function deferZohoRecurringForCustomer(
  contactId,
  customerNumber,
  pauseStart,
  pauseEnd
) {
  if (!contactId || !customerNumber) {
    return { deferred: 0, matched: 0, resumeDate: pauseEnd };
  }

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
    if (!recurringWouldInvoiceDuringPause(nextDate, pauseStart, pauseEnd)) {
      continue;
    }
    try {
      await updateRecurringInvoice_JS(String(id), { start_date: pauseEnd });
      deferred += 1;
      profiles.push({
        recurringInvoiceId: String(id),
        previousNextInvoiceDate: nextDate,
        newStartDate: pauseEnd,
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
  };
}

async function syncPauseZohoBilling(customerId, pauseStart, pauseEnd) {
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
        pauseEnd
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
      pauseEnd
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
 * After local cancel: set TISP due date to cancellation day, and for C2B
 * mark the Zoho contact inactive (stop recurring first). B2B only stops
 * that customer's recurring on the agency contact — agency stays active.
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

  const dueDateLabel = formatTispDueDate(cancellationDate);
  const result = {
    tisp: { ok: true, skipped: true },
    zoho: { ok: true, skipped: true },
    olt: { ok: true, skipped: true },
    cancellationDate: dueDateLabel,
  };

  try {
    const onTisp = await accountExistsOnTisp(ctx.customer_number);
    if (onTisp) {
      await updateCustomerOnTisp(ctx, {
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
    result.olt = await oltEmsService.deactivateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
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

    if (isB2BCustomer(customer)) {
      const agency = await resolveAgencyForCustomer(customer, store);
      if (!agency?.name) {
        result.zoho = { ok: true, skipped: true, reason: "b2b_no_agency" };
      } else {
        const agencyContact = await getCustomerByCompanyName_JS(agency.name);
        if (!agencyContact?.contact_id) {
          result.zoho = { ok: true, skipped: true, reason: "b2b_no_zoho_contact" };
        } else {
          const recurring = await stopZohoRecurringForCustomer(
            agencyContact.contact_id,
            ctx.customer_number
          );
          result.zoho = {
            ok: true,
            skipped: false,
            contactInactivated: false,
            reason: "b2b_agency_contact_kept",
            recurringStopped: recurring.stopped,
          };
        }
      }
    } else {
      const contact = await findZohoContactForCustomer(customer);
      if (!contact?.contact_id) {
        result.zoho = { ok: true, skipped: true, reason: "no_zoho_contact" };
      } else {
        const recurring = await stopZohoRecurringForCustomer(
          contact.contact_id,
          ctx.customer_number
        );
        await markContactInactive_JS(contact.contact_id);
        invalidateCustomerZoho(customerId);
        result.zoho = {
          ok: true,
          skipped: false,
          contactInactivated: true,
          zohoContactId: contact.contact_id,
          recurringStopped: recurring.stopped,
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

    // TISP + Zoho after response — local cancel is already committed.
    setImmediate(() => {
      syncCancellationIntegrations(customerId, cancellationDate)
        .then(async (integrations) => {
          try {
            await logActivity({
              eventType: "customer_cancelled",
              title: "Customer subscription cancelled",
              message: [
                customer?.customerNumber || "",
                customer?.cancellationReason || null,
                integrations.tisp?.dueDate
                  ? `TISP due ${integrations.tisp.dueDate}`
                  : null,
                integrations.zoho?.contactInactivated ? "Zoho inactive" : null,
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
              customerRef: customer?.customerNumber,
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
      title: "Customer disconnected on TISP",
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

    const tisp = await stopTispServiceToday(ctx);

    const olt = await oltEmsService.deactivateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
    });

    await store.pauseCustomer(customerId, {
      reason: pauseReason,
      pauseStartDate: pauseStart,
      pauseEndDate: pauseEnd,
    });

    const zoho = await syncPauseZohoBilling(customerId, pauseStart, pauseEnd);

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
      title: "Customer service paused",
      message: [
        customer?.customerNumber || "",
        `away ${pauseStart} → ${pauseEnd}`,
        pauseReason,
        tisp.dueDate ? `TISP due ${tisp.dueDate}` : null,
        zoho.skipped
          ? null
          : zoho.recurring?.deferred
            ? `Zoho recurring deferred to ${pauseEnd}`
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

    return res.json({
      ok: true,
      customer,
      pause: {
        startDate: pauseStart,
        endDate: pauseEnd,
        reason: pauseReason,
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

    // Hard-delete from the admin DB only — no TISP/Zoho presence checks.
    // External accounts (if any) are left untouched.
    const deleted = await store.deleteCustomerCompletely(id);
    invalidateCustomerZoho(id);

    try {
      await logActivity({
        eventType: "customer_deleted",
        title: "Customer permanently deleted",
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
        cancelledIds.push(id);
        results.push({
          id,
          ok: true,
          customerNumber: customer?.customerNumber || null,
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
              await logActivity({
                eventType: "customer_cancelled",
                title: "Customer subscription cancelled",
                message: [
                  customer?.customerNumber || "",
                  customer?.cancellationReason || null,
                  integrations.tisp?.dueDate
                    ? `TISP due ${integrations.tisp.dueDate}`
                    : null,
                  integrations.zoho?.contactInactivated ? "Zoho inactive" : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                source: "admin",
                status:
                  integrations.tisp?.ok !== false &&
                  integrations.zoho?.ok !== false
                    ? "success"
                    : "failed",
                customerRef: customer?.customerNumber,
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
    const billing = await onboardNewCustomerBilling(created.customerId);
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
    } = await store.updateCustomerDetails(
      id,
      {
        firstName: body.firstName,
        lastName: body.lastName,
        middleName: body.middleName,
        phone: body.phone,
        email: body.email,
        isVatExempt: Boolean(body.isVatExempt),
        customerType: body.customerType,
        agencyId: body.agencyId,
        apartmentNumber: body.apartmentNumber,
        paymentFrequency: body.paymentFrequency,
        customPeriodDays: body.customPeriodDays,
        productId: body.productId,
        ipAddress: body.ipAddress,
        dstvDecoderSerial: body.dstvDecoderSerial,
        ppoeUsername: body.ppoeUsername,
        ppoePassword: body.ppoePassword,
        tispPassword: body.tispPassword,
      },
      { allowPackageEdit: isAdmin && wantsPackageEdit }
    );

    let tisp = { ok: true, skipped: true };
    let zoho = { ok: true, skipped: true };

    if (updated?.status === "active") {
      const syncResult = await syncIntegrationsOnCustomerUpdate(id, {
        createInitialInvoice,
        createRecurringInvoice,
        updateZohoRecurring,
        tispDueDate: tispDueDate || undefined,
        apartmentChanged: Boolean(apartmentChanged),
        previousCustomerNumber: previousCustomerNumber || undefined,
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
    if (body.newAgency) {
      const { name, email, phone, contactPerson } = body.newAgency;
      if (!name || !email || !phone) {
        return res
          .status(400)
          .json({ error: "Agency name, email, and phone are required" });
      }
      agencyId = await store.createAgency({ name, email, phone, contactPerson });
    }

    const result = await store.convertCustomerType(id, targetType, agencyId);

    // C2B → B2B: stop personal Zoho billing (agency takes over).
    if (result.previousType === "C2B" && result.newType === "B2B") {
      try {
        const oldContact = await findZohoContactForCustomer({
          customerNumber: result.previousCustomerNumber,
          customerType: "C2B",
          firstName: result.customer?.firstName,
          lastName: result.customer?.lastName,
          email: result.customer?.email,
        });
        if (oldContact?.contact_id) {
          await stopZohoRecurringForCustomer(
            oldContact.contact_id,
            result.previousCustomerNumber
          );
          await markContactInactive_JS(oldContact.contact_id);
          invalidateCustomerZoho(id);
        }
      } catch (e) {
        console.warn(
          "Zoho C2B contact cleanup after B2B conversion failed:",
          e.message
        );
      }
    }

    // B2B → C2B: stop agency recurring keyed to the old B2B account number.
    if (result.previousType === "B2B" && result.newType === "C2B") {
      try {
        if (result.previousAgencyId) {
          const previousAgency = await store.getAgencyById(result.previousAgencyId);
          if (previousAgency?.name) {
            const agencyContact = await getCustomerByCompanyName_JS(
              previousAgency.name
            );
            if (agencyContact?.contact_id) {
              await stopZohoRecurringForCustomer(
                agencyContact.contact_id,
                result.previousCustomerNumber
              );
            }
          }
        }
      } catch (e) {
        console.warn(
          "Zoho B2B agency cleanup after C2B conversion failed:",
          e.message
        );
      }
    }

    if (result.newType === "B2B" && result.agencyId) {
      try {
        const agency = await store.getAgencyById(result.agencyId);
        if (agency) {
          const { ensureZohoContactForAgency } = require("./agencies.controller");
          await ensureZohoContactForAgency(agency);
        }
      } catch (e) {
        console.warn("Agency Zoho provisioning after type conversion failed:", e.message);
      }
    }

    let tispError = null;
    if (result.customer?.status === "active") {
      try {
        const ctx = await store.getCustomerContext(id);
        const dueForMigrate =
          result.customer?.tispDueDate ||
          ctx?.tisp_due_date ||
          TISP_STANDARD_DUE_DATE;
        await pushCustomerToTisp(ctx, {
          previousCustomerNumber: result.previousCustomerNumber,
          // Free the old PPPoE username (usually the previous account number).
          previousApartmentNumber:
            result.previousPpoeUsername ||
            result.previousCustomerNumber ||
            ctx?.apartment_number,
          dueDate: dueForMigrate,
          skipCooldown: true,
        });
        await store.updateCustomerTispSync(id, "synced", null);
      } catch (e) {
        tispError = formatTispError(e);
        await store.updateCustomerTispSync(id, "failed", tispError);
      }
    }
    const zoho =
      result.customer?.status === "active"
        ? await runZohoSyncForCustomer(id, {
            previousCustomerNumber: result.previousCustomerNumber,
            syncRecurring: result.newType === "C2B",
          })
        : { ok: true, skipped: true };

    const customer = await store.getCustomerById(id);

    try {
      await logActivity({
        eventType: "customer_type_changed",
        title: "Customer billing type changed",
        message: `${customer?.customerNumber}: ${result.previousType} → ${result.newType}${
          result.agencyName ? ` (${result.agencyName})` : ""
        }`,
        source: "tisp",
        status: tispError ? "failed" : "success",
        customerRef: customer?.customerNumber,
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

    const mpesaRefs = new Set(
      payments
        .map((payment) => payment.referenceId?.trim().toLowerCase())
        .filter(Boolean)
    );

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
        const ref = payment.reference_number || payment.payment_number || null;
        if (ref && mpesaRefs.has(String(ref).trim().toLowerCase())) {
          continue;
        }

        const invoiceRef = Array.isArray(payment.invoices)
          ? payment.invoices.find((inv) => inv.invoice_number)?.invoice_number ||
            payment.invoices[0]?.invoice_number ||
            null
          : null;

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
    });
  } catch (err) {
    return next(err);
  }
}

async function retryBillingOnboarding(req, res, next) {
  try {
    const id = Number(req.params.id);
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

    syncCooldown.assertSyncAllowed(id);
    invalidateCustomerZoho(id);

    try {
      const billing = await onboardNewCustomerBilling(id);
      if (!billing.ok) {
        return res.status(502).json({
          ok: false,
          error: billing.error || "Billing onboarding failed",
          billing,
        });
      }

      const [updatedCustomer, zoho] = await Promise.all([
        store.getCustomerById(id),
        fetchCustomerZohoInvoices(customer, { skipCache: true }),
      ]);

      try {
        const invoice = billing.invoice || {};
        await logActivity({
          eventType: invoice.created
            ? "zoho_billing_retry"
            : "zoho_billing_retry_linked",
          title: invoice.created
            ? "Billing onboarding retried — invoice created"
            : invoice.reused
              ? "Billing onboarding retried — existing invoice"
              : "Billing onboarding retried",
          message: invoice.invoiceNumber
            ? `${customer.customerNumber}: ${invoice.invoiceNumber}${
                invoice.emailed ? " — emailed" : ""
              }`
            : customer.customerNumber,
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
              // type code (e.g. local CLB-A10, TISP still CL-A10).
              if (!onCurrent) {
                const altNumber = alternateTypeAccountNumber(ctx);
                if (altNumber && (await accountExistsOnTisp(altNumber))) {
                  await migrateTispAccountNumber(ctx, altNumber, {
                    skipCooldown: true,
                    // Release credentials on the old TISP account (altNumber),
                    // not the already-renumbered local PPPoE username.
                    previousApartmentNumber: altNumber,
                    dueDate:
                      ctx.tisp_due_date || TISP_STANDARD_DUE_DATE,
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
  exportCustomers,
  getCustomer,
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
  linkCustomerOlt,
  deleteCustomerPermanently,
  bulkCancelSubscriptions,
  apartmentHistory,
  downloadImportTemplate,
  importCustomers,
  syncNewCustomerToTisp,
  pushCustomerToTisp,
  runZohoSyncForCustomer,
  pushCustomerToZoho,
  ensureZohoContactForCustomer,
  buildZohoContactPayload,
  getCustomerIntegrations,
  resolveCustomerIntegrationPresence,
};
