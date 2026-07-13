const {
  updateContact_JS,
  getRecurringInvoices_JS,
  createRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  stopRecurringInvoice_JS,
  getInvoices_JS,
} = require("../controllers/zoho.controller");
const { isB2BCustomer, resolveAgencyForCustomer } = require("../utils/b2bBilling");
const { buildSubscriptionLineItems } = require("../utils/zohoInvoiceLineItems");
const {
  computeBillingPeriod,
} = require("../utils/billingPeriod");
const {
  mapPaymentFrequencyToRecurrence,
  computeRecurringStartDate,
  recurrenceMatches,
} = require("../utils/zohoRecurrence");
const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const customerStore = require("./customerModuleStore");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";

function mapContextToCustomer(ctx, agencyName = null) {
  return {
    id: ctx.id,
    firstName: ctx.first_name,
    middleName: ctx.middle_name,
    lastName: ctx.last_name,
    fullName: [ctx.first_name, ctx.middle_name, ctx.last_name]
      .filter(Boolean)
      .join(" "),
    phone: ctx.phone,
    email: ctx.email,
    customerType: ctx.customer_type,
    customerNumber: ctx.customer_number,
    apartmentNumber: ctx.apartment_number,
    paymentFrequency: ctx.payment_frequency,
    customPeriodDays: ctx.custom_period_days,
    buildingName: ctx.building_name,
    productName: ctx.product_name,
    productMbps: ctx.product_mbps,
    productExtraBandwidth: ctx.product_extra_bandwidth,
    planName: ctx.plan_name,
    packagePrice: Number(ctx.package_price || 0),
    agencyId: ctx.agency_id,
    agencyName: agencyName || ctx.agency_name || null,
    buildingCode:
      ctx.customer_type === "B2B" ? ctx.b2b_code : ctx.c2b_code,
    hasDstv: Boolean(ctx.product_has_dstv),
    decoderFeeAmount:
      ctx.decoder_fee_amount != null ? Number(ctx.decoder_fee_amount) : null,
    decoderFeeRequired: Boolean(ctx.decoder_fee_required),
    dstvDecoderSerial: ctx.dstv_decoder_serial || null,
    trialPeriodEnabled: Boolean(ctx.trial_period_enabled),
    trialEndsAt: ctx.trial_ends_at || null,
  };
}

function buildRecurringLineItems(customer, period, options = {}) {
  return buildSubscriptionLineItems(customer, period, {
    includeOneTimeDstvFee: options.includeOneTimeDstvFee === true,
  });
}

function buildRecurringLineItem(customer, period) {
  return buildRecurringLineItems(customer, period)[0];
}

function isActiveRecurring(recurring) {
  const status = String(
    recurring?.status || recurring?.recurrence_status || "active",
  ).toLowerCase();
  return !["stopped", "expired", "inactive"].includes(status);
}

async function findRecurringForCustomer(contactId, customerNumber) {
  const list = await getRecurringInvoices_JS({
    customer_id: contactId,
    per_page: 50,
  });
  const ref = String(customerNumber || "").trim().toUpperCase();
  return (list || []).find((row) => {
    if (!isActiveRecurring(row)) return false;
    const rowRef = String(row.reference_number || row.recurrence_name || "")
      .trim()
      .toUpperCase();
    return rowRef === ref || rowRef.includes(ref);
  });
}

/**
 * Create or update the Zoho recurring invoice profile for a customer.
 */
async function ensureRecurringSubscription(customer, zohoContact, options = {}) {
  const amount = Number(customer.packagePrice || 0);
  if (amount <= 0) {
    return { created: false, updated: false, reason: "no_package_price" };
  }

  const recurrence = mapPaymentFrequencyToRecurrence(
    customer.paymentFrequency,
    customer.customPeriodDays,
  );
  const period = computeBillingPeriod({
    paymentFrequency: customer.paymentFrequency,
    customPeriodDays: customer.customPeriodDays,
  });
  const lineItem = buildRecurringLineItems(customer, period, options);
  const referenceNumber = customer.customerNumber;
  const recurrenceName = `${customer.customerNumber} subscription`;

  const existing = await findRecurringForCustomer(
    zohoContact.contact_id,
    customer.customerNumber,
  );

  if (existing?.recurring_invoice_id) {
    const id = String(existing.recurring_invoice_id);
    if (recurrenceMatches(existing, recurrence)) {
      const updated = await updateRecurringInvoice_JS(id, {
        recurrence_name: recurrenceName,
        reference_number: referenceNumber,
        line_items: lineItem,
        is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
      });
      return {
        created: false,
        updated: true,
        recurringInvoiceId: id,
        recurring: updated,
      };
    }

    try {
      await stopRecurringInvoice_JS(id);
    } catch (e) {
      console.warn("stop recurring before recreate failed:", e.message);
    }
  }

  const startDate =
    options.startDate ||
    computeRecurringStartDate({
      paymentFrequency: customer.paymentFrequency,
      customPeriodDays: customer.customPeriodDays,
    });

  const created = await createRecurringInvoice_JS({
    customer_id: zohoContact.contact_id,
    recurrence_name: recurrenceName,
    reference_number: referenceNumber,
    start_date: startDate,
    recurrence_frequency: recurrence.recurrence_frequency,
    repeat_every: recurrence.repeat_every,
    line_items: lineItem,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
  });

  if (!created?.recurring_invoice_id) {
    throw new Error("Zoho recurring invoice creation failed");
  }

  return {
    created: true,
    updated: false,
    recurringInvoiceId: String(created.recurring_invoice_id),
    recurring: created,
    startDate,
  };
}

async function updateZohoContactDetails(customer, zohoContact) {
  if (isB2BCustomer(customer)) {
    const { syncAgencyZohoContact } = require("../controllers/agencies.controller");
    const agency = await resolveAgencyForCustomer(customer, customerStore);
    if (!agency) return zohoContact;
    return syncAgencyZohoContact(agency, zohoContact);
  }

  const { buildZohoContactPayload } = require("../controllers/customers.controller");
  const payload = await buildZohoContactPayload(customer);
  const updated = await updateContact_JS(zohoContact.contact_id, payload);
  return updated || zohoContact;
}

/**
 * Push customer changes to Zoho Books (contact + recurring subscription).
 */
async function pushCustomerBillingToZoho(ctx, options = {}) {
  const syncRecurring = options.syncRecurring !== false;

  if (isB2BCustomer({ customerType: ctx.customer_type })) {
    return {
      skipped: true,
      reason: "b2b_no_zoho",
      contact: null,
      recurring: null,
    };
  }

  const agencyName = ctx.agency_name || null;

  const customer = mapContextToCustomer(ctx, agencyName);
  const { ensureZohoContactForCustomer } = require("../controllers/customers.controller");

  const zohoContact = await ensureZohoContactForCustomer({
    ...customer,
    customerType: ctx.customer_type,
    agencyId: ctx.agency_id,
  });
  if (!zohoContact?.contact_id) {
    throw new Error("Zoho contact could not be linked");
  }

  const updatedContact = await updateZohoContactDetails(
    { ...customer, customerType: ctx.customer_type, agencyId: ctx.agency_id },
    zohoContact,
  );

  let recurring = null;
  if (syncRecurring) {
    recurring = await ensureRecurringSubscription(customer, updatedContact, {
      startDate: options.recurringStartDate,
    });
  }

  invalidateCustomerZoho(ctx.id);

  try {
    const invoices = await getInvoices_JS({
      customer_id: updatedContact.contact_id,
      per_page: 50,
      page: 1,
    });
    const recurringList = await getRecurringInvoices_JS({
      customer_id: updatedContact.contact_id,
      per_page: 50,
    });
    await integrationSnapshot.saveZohoBillingSnapshot(ctx.id, {
      contact: updatedContact,
      invoices: invoices || [],
      payments: [],
      recurring: recurringList || [],
    });
  } catch (e) {
    console.warn("Zoho billing snapshot after push failed:", e.message);
  }

  return {
    ok: true,
    zohoContactId: updatedContact.contact_id,
    contactUpdated: true,
    recurring,
  };
}

module.exports = {
  mapContextToCustomer,
  ensureRecurringSubscription,
  pushCustomerBillingToZoho,
};
