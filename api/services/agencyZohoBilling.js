/**
 * Agency (B2B) Zoho Books billing:
 * - Agency create → Zoho contact (+ invoice/recurring when houses already exist)
 * - Each managed-house add → signup invoice on agency contact + rebuild consolidated recurring
 * - Net 30 payment terms on agency invoices / recurring
 */

const customerStore = require("./customerModuleStore");
const {
  computeBillingPeriod,
  computeInvoiceDueDate,
  resolveZohoPaymentTerms,
  computeRecurringStartBeforeDue,
  computeServiceDueDate,
} = require("../utils/billingPeriod");
const {
  buildManagedHouseLineItemName,
  buildManagedHouseLineItemDescription,
  buildManagedHouseRecurringLineItemDescription,
  normalizeAgencyDiscountPercent,
  applyAgencyUnitDiscount,
} = require("../utils/b2bBilling");
const {
  buildDstvDecoderFeeLineItem,
  buildExtraTvLineItem,
  mergeRecurringLineItems,
} = require("../utils/zohoInvoiceLineItems");
const { computeRecurringStartDate } = require("../utils/zohoRecurrence");
const {
  createInvoice_JS,
  createRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  getRecurringInvoices_JS,
  stopRecurringInvoice_JS,
  resolveInvoiceEmailContactPersons,
  associateEmailContactPersonsOnOpenInvoices,
  resolveZohoInvoiceTransactionSeries,
} = require("../controllers/zoho.controller");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";
const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;

function agencyRecurringReference(agency) {
  return `AGENCY-${agency.id}`;
}

function agencyRecurringName(agency) {
  return `${String(agency.name || "Agency").trim()} - Monthly Invoice`;
}

function withTax(lineItem) {
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }
  return lineItem;
}

async function attachAgencyInvoiceEmailPersons(payload, zohoContact) {
  if (!zohoContact?.contact_id) return payload;
  const fields = await resolveInvoiceEmailContactPersons(zohoContact.contact_id, {
    contact: zohoContact,
  });
  if (fields) Object.assign(payload, fields);
  return payload;
}

async function repairAgencyOpenInvoiceEmails(zohoContact) {
  if (!zohoContact?.contact_id) return;
  try {
    await associateEmailContactPersonsOnOpenInvoices(zohoContact.contact_id, {
      contact: zohoContact,
    });
  } catch (e) {
    console.warn(
      "agency open-invoice contact person repair skipped:",
      e.message || e
    );
  }
}

function billableManagedHouses(customers = []) {
  // All houses on an agency list are B2B-managed; require active + priced.
  return (customers || []).filter(
    (c) => c.status === "active" && Number(c.packagePrice || 0) > 0
  );
}

function buildAgencyHouseLineItem(customer, discountPercent, { recurring = false } = {}) {
  const period = computeBillingPeriod({
    paymentFrequency: customer.paymentFrequency || "monthly",
    customPeriodDays: customer.customPeriodDays,
  });
  const gross = Number(customer.packagePrice || 0);
  const description = recurring
    ? buildManagedHouseRecurringLineItemDescription({
        ...customer,
        paymentFrequency: customer.paymentFrequency || "monthly",
        customPeriodDays: customer.customPeriodDays,
      })
    : buildManagedHouseLineItemDescription(customer, period);

  return withTax({
    name: buildManagedHouseLineItemName(customer),
    rate: applyAgencyUnitDiscount(gross, discountPercent),
    quantity: 1,
    description,
  });
}

function buildAgencyHouseLineItems(customer, discountPercent, { recurring = false } = {}) {
  const items = [buildAgencyHouseLineItem(customer, discountPercent, { recurring })];
  const extra = buildExtraTvLineItem(customer, { includeCustomerNumber: true });
  if (extra) items.push(extra);
  return items;
}

function lineItemsAmount(items) {
  return (items || []).reduce(
    (sum, item) =>
      item?.delete
        ? sum
        : sum + Number(item.rate || 0) * Number(item.quantity || 1),
    0
  );
}

/** Signup invoices only — decoder is one-time, never on agency recurring. */
function withAgencyDecoderFeeItems(houseLineItems, houses) {
  const items = [...houseLineItems];
  for (const house of houses || []) {
    const decoder = buildDstvDecoderFeeLineItem(house);
    if (decoder) items.push(decoder);
  }
  return items;
}

function b2bPaymentTerms() {
  return resolveZohoPaymentTerms({ customerType: "B2B" });
}

function isActiveRecurring(row) {
  const status = String(row?.status || row?.recurrence_status || "active").toLowerCase();
  return !["stopped", "expired", "inactive"].includes(status);
}

async function findAgencyRecurringProfile(zohoContactId, agency) {
  const list = await getRecurringInvoices_JS({
    customer_id: zohoContactId,
    per_page: 50,
  });
  const ref = agencyRecurringReference(agency).toUpperCase();
  const name = agencyRecurringName(agency).toUpperCase();
  const agencyName = String(agency.name || "").trim().toUpperCase();

  const active = (list || []).filter(isActiveRecurring);
  const byRef = active.find(
    (row) =>
      String(row.reference_number || "").trim().toUpperCase() === ref
  );
  if (byRef) return byRef;

  const byName = active.find(
    (row) =>
      String(row.recurrence_name || "").trim().toUpperCase() === name ||
      (agencyName &&
        String(row.recurrence_name || "")
          .trim()
          .toUpperCase()
          .startsWith(`${agencyName} -`))
  );
  return byName || null;
}

/**
 * Create or replace the consolidated agency recurring profile from active houses.
 */
async function ensureAgencyRecurring(agency, zohoContact, customers = null) {
  if (!zohoContact?.contact_id) {
    return { created: false, updated: false, reason: "no_zoho_contact" };
  }

  const houses =
    customers != null
      ? billableManagedHouses(customers)
      : billableManagedHouses(await customerStore.listCustomersByAgency(agency.id));

  if (!houses.length) {
    const existing = await findAgencyRecurringProfile(zohoContact.contact_id, agency);
    if (existing?.recurring_invoice_id || existing?.recurringinvoice_id) {
      const id = String(existing.recurring_invoice_id || existing.recurringinvoice_id);
      try {
        await stopRecurringInvoice_JS(id);
      } catch (e) {
        console.warn("stop empty agency recurring failed:", e.message);
      }
      return { created: false, updated: false, stopped: true, reason: "no_billable_houses" };
    }
    return { created: false, updated: false, reason: "no_billable_houses" };
  }

  const discountPercent = normalizeAgencyDiscountPercent(agency.discountPercent);
  const lineItems = houses.flatMap((c) =>
    buildAgencyHouseLineItems(c, discountPercent, { recurring: true })
  );
  const terms = b2bPaymentTerms();
  const recurrenceName = agencyRecurringName(agency);
  const referenceNumber = agencyRecurringReference(agency);

  const existing = await findAgencyRecurringProfile(zohoContact.contact_id, agency);
  if (existing?.recurring_invoice_id || existing?.recurringinvoice_id) {
    const id = String(existing.recurring_invoice_id || existing.recurringinvoice_id);
    try {
      const full =
        (await require("../controllers/zoho.controller").getRecurringInvoice_JS(id)) ||
        existing;
      const existingItems = Array.isArray(full.line_items) ? full.line_items : [];
      const merged = mergeRecurringLineItems(existingItems, lineItems);
      const seriesFields =
        (await resolveZohoInvoiceTransactionSeries(houses[0])) || {};
      const updated = await updateRecurringInvoice_JS(
        id,
        await attachAgencyInvoiceEmailPersons(
          {
            recurrence_name: recurrenceName,
            reference_number: referenceNumber,
            line_items: merged,
            is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
            payment_terms: terms.payment_terms,
            payment_terms_label: terms.payment_terms_label,
            ...seriesFields,
          },
          zohoContact
        )
      );
      await repairAgencyOpenInvoiceEmails(zohoContact);
      return {
        created: false,
        updated: true,
        recurringInvoiceId: id,
        houseCount: houses.length,
        totalAmount: lineItemsAmount(lineItems),
        recurring: updated,
      };
    } catch (e) {
      console.warn("agency recurring update failed, recreating:", e.message);
      try {
        await stopRecurringInvoice_JS(id);
      } catch {
        /* ignore */
      }
    }
  }

  const startDate = computeRecurringStartDate({ paymentFrequency: "monthly" });
  const created = await createRecurringInvoice_JS({
    customer_id: zohoContact.contact_id,
    recurrence_name: recurrenceName,
    reference_number: referenceNumber,
    start_date: startDate,
    recurrence_frequency: "months",
    repeat_every: 1,
    line_items: lineItems,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    payment_terms: terms.payment_terms,
    payment_terms_label: terms.payment_terms_label,
    contact: zohoContact,
    customer: houses[0],
  });

  if (!created?.recurring_invoice_id && !created?.recurringinvoice_id) {
    throw new Error("Zoho agency recurring invoice creation failed");
  }

  await repairAgencyOpenInvoiceEmails(zohoContact);

  return {
    created: true,
    updated: false,
    recurringInvoiceId: String(
      created.recurring_invoice_id || created.recurringinvoice_id
    ),
    houseCount: houses.length,
    totalAmount: lineItemsAmount(lineItems),
    startDate,
    recurring: created,
  };
}

/**
 * One-off consolidated invoice for all active managed houses (agency onboarding).
 */
async function createAgencyInitialInvoice(agency, zohoContact, customers = null) {
  if (!zohoContact?.contact_id) {
    return { created: false, reason: "no_zoho_contact" };
  }

  const houses =
    customers != null
      ? billableManagedHouses(customers)
      : billableManagedHouses(await customerStore.listCustomersByAgency(agency.id));

  if (!houses.length) {
    return { created: false, skipped: true, reason: "awaiting_customers" };
  }

  const discountPercent = normalizeAgencyDiscountPercent(agency.discountPercent);
  const houseItems = houses.flatMap((c) =>
    buildAgencyHouseLineItems(c, discountPercent, { recurring: false })
  );
  const lineItems = withAgencyDecoderFeeItems(houseItems, houses);
  const terms = b2bPaymentTerms();
  const total = lineItemsAmount(lineItems);

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items: lineItems,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: `${agency.name} — initial`,
    due_date: computeInvoiceDueDate({ customerType: "B2B" }),
    payment_terms: terms.payment_terms,
    payment_terms_label: terms.payment_terms_label,
    contact: zohoContact,
  });

  if (!invoice?.invoice_id) {
    throw new Error("Zoho agency initial invoice creation failed");
  }

  return {
    created: true,
    invoiceId: String(invoice.invoice_id),
    invoiceNumber: invoice.invoice_number || null,
    total,
    houseCount: houses.length,
  };
}

/**
 * Signup invoice for a single managed house on the agency Zoho contact.
 */
async function createManagedHouseSignupInvoice(agency, zohoContact, customer) {
  if (!zohoContact?.contact_id) {
    return { created: false, reason: "no_zoho_contact" };
  }
  const amount = Number(customer.packagePrice || 0);
  if (amount <= 0) {
    return { created: false, reason: "no_package_price" };
  }

  const discountPercent = normalizeAgencyDiscountPercent(agency.discountPercent);
  const lineItems = withAgencyDecoderFeeItems(
    buildAgencyHouseLineItems(customer, discountPercent, { recurring: false }),
    [customer]
  );
  const terms = b2bPaymentTerms();
  const itemsTotal = lineItemsAmount(lineItems);

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items: lineItems,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: customer.customerNumber || agencyRecurringReference(agency),
    due_date: computeInvoiceDueDate({ customerType: "B2B" }),
    payment_terms: terms.payment_terms,
    payment_terms_label: terms.payment_terms_label,
    contact: zohoContact,
  });

  if (!invoice?.invoice_id) {
    throw new Error("Zoho managed-house signup invoice creation failed");
  }

  return {
    created: true,
    invoiceId: String(invoice.invoice_id),
    invoiceNumber: invoice.invoice_number || null,
    total: Number(invoice.total || itemsTotal),
  };
}

/**
 * Agency create: Zoho contact + initial invoice + recurring when houses exist.
 * With no houses yet, contact is created and billing waits for the first customer.
 */
async function onboardAgencyZohoBilling(agency) {
  const {
    ensureZohoContactForAgency,
  } = require("../controllers/agencies.controller");

  const contact = await ensureZohoContactForAgency(agency);
  const customers = await customerStore.listCustomersByAgency(agency.id);
  const houses = billableManagedHouses(customers);

  if (!houses.length) {
    return {
      ok: true,
      zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
      invoice: { created: false, skipped: true, reason: "awaiting_customers" },
      recurring: { created: false, skipped: true, reason: "awaiting_customers" },
    };
  }

  const invoice = await createAgencyInitialInvoice(agency, contact, customers);
  const recurring = await ensureAgencyRecurring(agency, contact, customers);

  return {
    ok: true,
    zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
    invoice,
    recurring,
  };
}

/**
 * After a B2B managed house is added: invoice that house + refresh agency recurring total.
 */
async function syncAgencyBillingAfterManagedHouseAdded(agencyId, customerId) {
  const {
    ensureZohoContactForAgency,
  } = require("../controllers/agencies.controller");

  const agency = await customerStore.getAgencyById(agencyId);
  if (!agency) {
    return { ok: false, error: "Agency not found" };
  }

  const customer = await customerStore.getCustomerById(customerId);
  if (!customer) {
    return { ok: false, error: "Customer not found" };
  }

  const contact = await ensureZohoContactForAgency(agency);
  const invoice = await createManagedHouseSignupInvoice(agency, contact, customer);
  const customers = await customerStore.listCustomersByAgency(agency.id);
  const recurring = await ensureAgencyRecurring(agency, contact, customers);

  try {
    await customerStore.updateCustomerZohoBillingStatus(customerId, "completed", null);
  } catch (e) {
    console.warn("agency house zoho status persist failed:", e.message);
  }

  return {
    ok: true,
    skipped: false,
    reason: "b2b_agency_billing",
    linked: true,
    zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
    invoice,
    recurring,
  };
}

/**
 * Rebuild agency recurring after cancel / package change / discount change.
 */
async function refreshAgencyRecurring(agencyId) {
  const {
    ensureZohoContactForAgency,
  } = require("../controllers/agencies.controller");

  const agency = await customerStore.getAgencyById(agencyId);
  if (!agency) {
    return { ok: false, error: "Agency not found" };
  }
  const contact = await ensureZohoContactForAgency(agency);
  const recurring = await ensureAgencyRecurring(agency, contact);
  return {
    ok: true,
    zohoContactId: contact?.contact_id ? String(contact.contact_id) : null,
    recurring,
  };
}

module.exports = {
  agencyRecurringReference,
  agencyRecurringName,
  billableManagedHouses,
  ensureAgencyRecurring,
  createAgencyInitialInvoice,
  createManagedHouseSignupInvoice,
  onboardAgencyZohoBilling,
  syncAgencyBillingAfterManagedHouseAdded,
  refreshAgencyRecurring,
  // re-export helpers used in tests / cancel paths
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
};
