const {
  getRecurringInvoices_JS,
  getRecurringInvoice_JS,
  createRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  stopRecurringInvoice_JS,
  resumeRecurringInvoice_JS,
  getInvoices_JS,
  resolveInvoiceEmailContactPersons,
  associateEmailContactPersonsOnOpenInvoices,
  resolveZohoInvoiceTransactionSeries,
} = require("../controllers/zoho.controller");
const { isB2BCustomer, resolveAgencyForCustomer } = require("../utils/b2bBilling");
const {
  buildSubscriptionLineItems,
  mergeRecurringLineItems,
} = require("../utils/zohoInvoiceLineItems");
const {
  computeBillingPeriod,
  computeSignupRecurringWindow,
} = require("../utils/billingPeriod");
const {
  mapPaymentFrequencyToRecurrence,
  recurrenceMatches,
  isActiveRecurring,
  selectRecurringProfileToUpdate,
} = require("../utils/zohoRecurrence");
const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const customerStore = require("./customerModuleStore");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";

function mapContextToCustomer(ctx, agencyName = null) {
  const {
    isDstvOnlyCategory,
    DSTV_ONLY_PRODUCT_NAME,
  } = require("./packageCatalogStore");
  const dstvOnly =
    isDstvOnlyCategory(ctx.category_code) ||
    isDstvOnlyCategory(ctx.category_name);
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
    billingAttention: ctx.billing_attention || null,
    billingAddress: ctx.billing_address || null,
    billingStreet2: ctx.billing_street2 || null,
    billingCity: ctx.billing_city || null,
    billingState: ctx.billing_state || null,
    billingZip: ctx.billing_zip || null,
    billingCountry: ctx.billing_country || null,
    customerType: ctx.customer_type,
    customerNumber: ctx.customer_number,
    apartmentNumber: ctx.apartment_number,
    paymentFrequency: ctx.payment_frequency,
    customPeriodDays: ctx.custom_period_days,
    buildingName: ctx.building_name,
    popName: ctx.pop_name || ctx.popName || null,
    c2bCode: ctx.c2b_code || ctx.c2bCode || null,
    b2bCode: ctx.b2b_code || ctx.b2bCode || null,
    productName: dstvOnly ? DSTV_ONLY_PRODUCT_NAME : ctx.product_name,
    productMbps: dstvOnly ? 0 : ctx.product_mbps,
    productExtraBandwidth: dstvOnly ? 0 : ctx.product_extra_bandwidth,
    planName: dstvOnly ? DSTV_ONLY_PRODUCT_NAME : ctx.plan_name,
    packagePrice: Number(ctx.package_price || 0),
    agencyId: ctx.agency_id,
    agencyName: agencyName || ctx.agency_name || null,
    buildingCode:
      ctx.customer_type === "B2B" ? ctx.b2b_code : ctx.c2b_code,
    hasDstv: Boolean(ctx.product_has_dstv),
    buildingDstvSetup: ctx.dstv_setup || ctx.building_dstv_setup || "decoder",
    decoderFeeAmount:
      ctx.decoder_fee_amount != null ? Number(ctx.decoder_fee_amount) : null,
    decoderFeeRequired: Boolean(ctx.decoder_fee_required),
    dstvDecoderSerial: ctx.dstv_decoder_serial || null,
    tvCount: Math.max(1, Number(ctx.tv_count) || 1),
    categoryCode: ctx.category_code || null,
    trialPeriodEnabled: Boolean(ctx.trial_period_enabled),
    trialEndsAt: ctx.trial_ends_at || null,
    createdAt: ctx.created_at || null,
  };
}

function buildRecurringLineItems(customer, period, options = {}) {
  return buildSubscriptionLineItems(customer, period, {
    includeOneTimeDstvFee: options.includeOneTimeDstvFee === true,
    // Zoho expands %(d)% / %(m+1)% etc. when each child invoice is generated.
    dynamicBillingCycleDates: true,
  });
}

function buildRecurringLineItem(customer, period) {
  return buildRecurringLineItems(customer, period)[0];
}

/**
 * Zoho profile name, e.g. "ET-P204 - Quarterly Invoice".
 * Order number (reference_number) stays the bare customer number.
 */
function buildRecurringProfileName(
  customerNumber,
  paymentFrequency,
  customPeriodDays
) {
  const number = String(customerNumber || "").trim();
  const freq = String(paymentFrequency || "monthly").toLowerCase();
  let freqLabel = "Monthly";
  if (freq === "quarterly") freqLabel = "Quarterly";
  else if (freq === "yearly") freqLabel = "Yearly";
  else if (freq === "custom") {
    const days = Number(customPeriodDays);
    freqLabel = days > 0 ? `${days}-Day` : "Custom";
  }
  return `${number} - ${freqLabel} Invoice`;
}

function recurringMatchesCustomerRefs(row, refs = []) {
  const rowRef = String(row?.reference_number || "").trim().toUpperCase();
  const rowName = String(row?.recurrence_name || "").trim().toUpperCase();
  return refs.some(
    (ref) =>
      rowRef === ref ||
      rowRef.includes(ref) ||
      rowName === ref ||
      rowName.startsWith(`${ref} `) ||
      rowName.startsWith(`${ref}-`) ||
      rowName.includes(`${ref} `)
  );
}

async function listMatchedRecurringForCustomer(
  contactId,
  customerNumber,
  previousCustomerNumber = null
) {
  const list = await getRecurringInvoices_JS({
    customer_id: contactId,
    per_page: 50,
    filter_by: "Status.All",
  });
  const refs = [
    String(customerNumber || "").trim().toUpperCase(),
    String(previousCustomerNumber || "").trim().toUpperCase(),
  ].filter(Boolean);

  const rows = list || [];
  const matched = rows.filter((row) =>
    recurringMatchesCustomerRefs(row, refs)
  );
  if (matched.length) return matched;

  // After apartment/type change, fall back to the only active profile on the contact.
  const active = rows.filter(isActiveRecurring);
  if (previousCustomerNumber && active.length === 1) {
    return [active[0]];
  }
  return [];
}

async function listActiveRecurringForCustomer(
  contactId,
  customerNumber,
  previousCustomerNumber = null
) {
  const matched = await listMatchedRecurringForCustomer(
    contactId,
    customerNumber,
    previousCustomerNumber
  );
  return matched.filter(isActiveRecurring);
}

async function findRecurringForCustomer(
  contactId,
  customerNumber,
  previousCustomerNumber = null
) {
  const { existing } = selectRecurringProfileToUpdate(
    await listMatchedRecurringForCustomer(
      contactId,
      customerNumber,
      previousCustomerNumber
    )
  );
  return existing || null;
}

async function stopExtraActiveRecurring(profiles = []) {
  for (const row of profiles) {
    const extraId = String(row?.recurring_invoice_id || row?.recurringinvoice_id || "");
    if (!extraId) continue;
    try {
      await stopRecurringInvoice_JS(extraId);
    } catch (e) {
      console.warn("stop extra Zoho recurring profile failed:", e.message || e);
    }
  }
}

async function applyRecurringInvoiceEmailCcs(recurringInvoiceId, zohoContact = null) {
  if (!recurringInvoiceId) return false;
  try {
    const { resolveInvoiceCcMailIds } = require("./appSettingsStore");
    const ccMailIds = await resolveInvoiceCcMailIds();
    const payload = {};
    if (ccMailIds.length) {
      payload.cc_mail_ids = ccMailIds;
    } else {
      console.warn(
        "Zoho recurring invoice CC skipped: invoice CC emails are required"
      );
    }
    const customerId = zohoContact?.contact_id;
    if (customerId) {
      const personFields = await resolveInvoiceEmailContactPersons(customerId, {
        contact: zohoContact,
      });
      if (personFields) Object.assign(payload, personFields);
    }
    if (!Object.keys(payload).length) return false;
    await updateRecurringInvoice_JS(String(recurringInvoiceId), payload);
    return true;
  } catch (e) {
    console.warn(
      "Zoho recurring invoice CC update skipped:",
      e.message || e
    );
    return false;
  }
}

async function updateRecurringProfileFields(
  recurringInvoiceId,
  { recurrenceName, referenceNumber, lineItems = null, customer = null, zohoContact = null }
) {
  const seriesFields =
    (await resolveZohoInvoiceTransactionSeries(customer)) || {};
  const personFields = zohoContact?.contact_id
    ? (await resolveInvoiceEmailContactPersons(zohoContact.contact_id, {
        contact: zohoContact,
      })) || {}
    : {};
  // Identity fields first — Zoho often rejects line_items without line_item_id.
  let updated = await updateRecurringInvoice_JS(recurringInvoiceId, {
    recurrence_name: recurrenceName,
    reference_number: referenceNumber,
    ...seriesFields,
    ...personFields,
  });

  if (!lineItems?.length) {
    return { updated, identityUpdated: true, lineItemsUpdated: false };
  }

  try {
    const full =
      (await getRecurringInvoice_JS(recurringInvoiceId)) || updated || {};
    const existingItems = Array.isArray(full.line_items) ? full.line_items : [];
    const merged = mergeRecurringLineItems(existingItems, lineItems);
    updated = await updateRecurringInvoice_JS(recurringInvoiceId, {
      recurrence_name: recurrenceName,
      reference_number: referenceNumber,
      line_items: merged,
      is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
      ...personFields,
    });
    return { updated, identityUpdated: true, lineItemsUpdated: true };
  } catch (e) {
    console.warn(
      "Zoho recurring line-item update failed after profile rename:",
      e.message || e
    );
    return {
      updated,
      identityUpdated: true,
      lineItemsUpdated: false,
      warning: e.message || String(e),
    };
  }
}

/**
 * Create or update the Zoho recurring invoice profile for a customer.
 * On apartment / account renumber (previousCustomerNumber), always rename
 * profile name + order number to the new customer number — even when package
 * price is missing (identity-only update).
 */
async function ensureRecurringSubscription(customer, zohoContact, options = {}) {
  const amount = Number(customer.packagePrice || 0);
  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim().toUpperCase()
    : null;
  // Order Number in Zoho Books = reference_number
  const referenceNumber = String(customer.customerNumber || "").trim();
  // Profile Name in Zoho Books = recurrence_name
  const recurrenceName = buildRecurringProfileName(
    referenceNumber,
    customer.paymentFrequency,
    customer.customPeriodDays
  );

  const matchedProfiles = await listMatchedRecurringForCustomer(
    zohoContact.contact_id,
    customer.customerNumber,
    previousCustomerNumber
  );
  const { existing, extraActives } = selectRecurringProfileToUpdate(
    matchedProfiles
  );

  // Apartment move with no package price: still rename existing profile(s).
  if (amount <= 0) {
    if (!previousCustomerNumber || !matchedProfiles.length) {
      return { created: false, updated: false, reason: "no_package_price" };
    }
    let last = null;
    let renamed = 0;
    for (const row of matchedProfiles) {
      const id = String(row.recurring_invoice_id || row.recurringinvoice_id || "");
      if (!id) continue;
      last = await updateRecurringProfileFields(id, {
        recurrenceName,
        referenceNumber,
        lineItems: null,
        customer,
        zohoContact,
      });
      renamed += 1;
    }
    return {
      created: false,
      updated: renamed > 0,
      renameOnly: true,
      profilesRenamed: renamed,
      recurringInvoiceId: existing?.recurring_invoice_id
        ? String(existing.recurring_invoice_id)
        : matchedProfiles[0]?.recurring_invoice_id
          ? String(matchedProfiles[0].recurring_invoice_id)
          : null,
      recurring: last?.updated || null,
      recurrenceName,
      referenceNumber,
      warning: last?.warning,
    };
  }

  const recurrence = mapPaymentFrequencyToRecurrence(
    customer.paymentFrequency,
    customer.customPeriodDays,
  );
  const period = computeBillingPeriod({
    paymentFrequency: customer.paymentFrequency,
    customPeriodDays: customer.customPeriodDays,
  });
  let lineItem = buildRecurringLineItems(customer, period, options);
  try {
    const {
      overlayReferralDiscountOnLineItems,
    } = require("./referralRewardService");
    lineItem = await overlayReferralDiscountOnLineItems(customer.id, lineItem);
  } catch (e) {
    console.warn("referral overlay on recurring lines failed:", e.message);
  }

  // Renumber: rename every matched profile (old + new refs) so nothing
  // keeps the previous customer number as order/profile name.
  if (previousCustomerNumber && matchedProfiles.length > 1) {
    const keepId = String(
      existing?.recurring_invoice_id || existing?.recurringinvoice_id || ""
    );
    for (const row of matchedProfiles) {
      const extraId = String(row.recurring_invoice_id || row.recurringinvoice_id || "");
      if (!extraId || extraId === keepId) continue;
      try {
        await updateRecurringProfileFields(extraId, {
          recurrenceName,
          referenceNumber,
          lineItems: null,
          customer,
          zohoContact,
        });
      } catch (e) {
        console.warn(
          "Zoho extra recurring rename after apartment move failed:",
          e.message || e
        );
      }
    }
  }

  if (existing?.recurring_invoice_id || existing?.recurringinvoice_id) {
    const id = String(existing.recurring_invoice_id || existing.recurringinvoice_id);
    // List payloads omit cadence fields. Load the profile before deciding
    // whether Zoho actually needs a new recurring invoice.
    const full = (await getRecurringInvoice_JS(id)) || existing;
    if (recurrenceMatches(full, recurrence)) {
      if (!isActiveRecurring(full)) {
        try {
          await resumeRecurringInvoice_JS(id);
        } catch (e) {
          console.warn("resume recurring before update failed:", e.message);
        }
      }
      const syncLineItems = options.syncLineItems !== false;
      const result = await updateRecurringProfileFields(id, {
        recurrenceName,
        referenceNumber,
        lineItems: syncLineItems ? lineItem : null,
        customer,
        zohoContact,
      });
      await applyRecurringInvoiceEmailCcs(id, zohoContact);
      try {
        await associateEmailContactPersonsOnOpenInvoices(zohoContact.contact_id, {
          contact: zohoContact,
        });
      } catch (e) {
        console.warn(
          "Zoho open-invoice contact person repair skipped:",
          e.message || e
        );
      }
      await stopExtraActiveRecurring(extraActives);
      return {
        created: false,
        updated: true,
        recurringInvoiceId: id,
        recurring: result.updated,
        recurrenceName,
        referenceNumber,
        lineItemsUpdated: result.lineItemsUpdated,
        warning: result.warning,
        previousCustomerNumber: previousCustomerNumber || undefined,
      };
    }

    try {
      await stopRecurringInvoice_JS(id);
    } catch (e) {
      console.warn("stop recurring before recreate failed:", e.message);
    }
    await stopExtraActiveRecurring(extraActives);
  }

  const startDate =
    options.startDate ||
    computeSignupRecurringWindow({
      paymentFrequency: customer.paymentFrequency,
      customPeriodDays: customer.customPeriodDays,
    }).startDate;

  const { resolveZohoPaymentTerms } = require("../utils/billingPeriod");
  const terms = resolveZohoPaymentTerms(customer);

  const created = await createRecurringInvoice_JS({
    customer_id: zohoContact.contact_id,
    recurrence_name: recurrenceName,
    reference_number: referenceNumber,
    start_date: startDate,
    recurrence_frequency: recurrence.recurrence_frequency,
    repeat_every: recurrence.repeat_every,
    line_items: lineItem,
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    payment_terms: terms.payment_terms,
    payment_terms_label: terms.payment_terms_label,
    customer,
    contact: zohoContact,
  });

  if (!created?.recurring_invoice_id) {
    throw new Error("Zoho recurring invoice creation failed");
  }

  await applyRecurringInvoiceEmailCcs(created.recurring_invoice_id, zohoContact);
  try {
    await associateEmailContactPersonsOnOpenInvoices(zohoContact.contact_id, {
      contact: zohoContact,
    });
  } catch (e) {
    console.warn(
      "Zoho open-invoice contact person repair skipped:",
      e.message || e
    );
  }

  return {
    created: true,
    updated: false,
    recurringInvoiceId: String(created.recurring_invoice_id),
    recurring: created,
    recurrenceName,
    referenceNumber,
    startDate,
    previousCustomerNumber: previousCustomerNumber || undefined,
  };
}

async function updateZohoContactDetails(customer, zohoContact) {
  if (isB2BCustomer(customer)) {
    const { syncAgencyZohoContact } = require("../controllers/agencies.controller");
    const agency = await resolveAgencyForCustomer(customer, customerStore);
    if (!agency) return zohoContact;
    return syncAgencyZohoContact(agency, zohoContact);
  }

  const {
    buildZohoContactPayload,
    enforceZohoCompanyName,
  } = require("../controllers/customers.controller");
  const { updateContact_JS, getContactFull_JS } = require("../controllers/zoho.controller");
  const fullContact =
    (await getContactFull_JS(zohoContact.contact_id)) || zohoContact;
  const payload = await buildZohoContactPayload(customer, fullContact);
  await updateContact_JS(zohoContact.contact_id, payload);

  const expected = String(
    customer.customerNumber || customer.customer_number || ""
  ).trim();
  // Always re-assert company_name = customer number (Zoho often ignores it on
  // the combined contact_persons update, especially after apartment moves).
  if (expected) {
    const enforced = await enforceZohoCompanyName(
      zohoContact.contact_id,
      expected,
      getContactFull_JS,
      updateContact_JS
    );
    if (enforced) return enforced;
  }
  return (await getContactFull_JS(zohoContact.contact_id)) || fullContact;
}

/**
 * C2B ↔ B2B conversion: rename Zoho company_name and recurring profile
 * identity (name + order number) onto the new customer number.
 */
async function renumberZohoContactCustomerNumber(contact, options = {}) {
  const previousCustomerNumber = String(options.previousCustomerNumber || "")
    .trim()
    .toUpperCase();
  const newCustomerNumber = String(options.newCustomerNumber || "")
    .trim()
    .toUpperCase();
  if (!contact?.contact_id || !newCustomerNumber) {
    return { updated: false, skipped: true, reason: "missing_contact_or_number" };
  }
  if (previousCustomerNumber && previousCustomerNumber === newCustomerNumber) {
    return { updated: false, skipped: true, reason: "unchanged" };
  }

  const {
    enforceZohoCompanyName,
  } = require("../controllers/customers.controller");
  const { updateContact_JS, getContactFull_JS } = require("../controllers/zoho.controller");

  const updatedContact =
    (await enforceZohoCompanyName(
      contact.contact_id,
      newCustomerNumber,
      getContactFull_JS,
      updateContact_JS
    )) || contact;

  const recurrenceName = buildRecurringProfileName(
    newCustomerNumber,
    options.paymentFrequency,
    options.customPeriodDays
  );
  const matched = await listMatchedRecurringForCustomer(
    contact.contact_id,
    newCustomerNumber,
    previousCustomerNumber || null
  );
  let profilesRenamed = 0;
  for (const row of matched) {
    const id = String(row.recurring_invoice_id || row.recurringinvoice_id || "");
    if (!id) continue;
    try {
      await updateRecurringProfileFields(id, {
        recurrenceName,
        referenceNumber: newCustomerNumber,
        lineItems: null,
        customer: { customerNumber: newCustomerNumber },
        zohoContact: contact,
      });
      profilesRenamed += 1;
    } catch (e) {
      console.warn(
        "Zoho recurring rename during type conversion failed:",
        e.message || e
      );
    }
  }

  return {
    updated: true,
    contact: updatedContact,
    companyName: updatedContact?.company_name || newCustomerNumber,
    profilesRenamed,
    previousCustomerNumber: previousCustomerNumber || undefined,
    newCustomerNumber,
  };
}

/**
 * Push customer changes to Zoho Books (contact + recurring subscription).
 * When previousCustomerNumber is set (apartment move / type renumber), forces
 * company_name + recurring profile name/order number onto the new number.
 */
async function pushCustomerBillingToZoho(ctx, options = {}) {
  const previousCustomerNumber = options.previousCustomerNumber
    ? String(options.previousCustomerNumber).trim().toUpperCase()
    : null;
  const renumbering = Boolean(previousCustomerNumber);
  // Apartment / account renumber always refreshes recurring identity fields.
  const syncRecurring = options.syncRecurring !== false || renumbering;

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
  const {
    ensureZohoContactForCustomer,
    enforceZohoCompanyName,
  } = require("../controllers/customers.controller");

  const zohoContact = await ensureZohoContactForCustomer(
    {
      ...customer,
      customerType: ctx.customer_type,
      agencyId: ctx.agency_id,
    },
    { previousCustomerNumber: previousCustomerNumber || undefined },
  );
  if (!zohoContact?.contact_id) {
    throw new Error("Zoho contact could not be linked");
  }

  let updatedContact = await updateZohoContactDetails(
    { ...customer, customerType: ctx.customer_type, agencyId: ctx.agency_id },
    zohoContact,
  );

  // Apartment move: dedicated company_name pass + full contact refresh so
  // Display Name and company_name both reflect the new customer number.
  let companyNameUpdated = false;
  if (renumbering) {
    const { updateContact_JS, getContactFull_JS } = require("../controllers/zoho.controller");
    const expectedCompany = String(customer.customerNumber || "").trim();
    if (expectedCompany) {
      updatedContact =
        (await enforceZohoCompanyName(
          updatedContact.contact_id,
          expectedCompany,
          getContactFull_JS,
          updateContact_JS
        )) || updatedContact;
      companyNameUpdated = true;
    }
    updatedContact = await updateZohoContactDetails(
      { ...customer, customerType: ctx.customer_type, agencyId: ctx.agency_id },
      updatedContact,
    );
  }

  let recurring = null;
  if (syncRecurring) {
    recurring = await ensureRecurringSubscription(customer, updatedContact, {
      startDate: options.recurringStartDate,
      previousCustomerNumber: previousCustomerNumber || undefined,
    });
  } else {
    try {
      await associateEmailContactPersonsOnOpenInvoices(updatedContact.contact_id, {
        contact: updatedContact,
      });
    } catch (e) {
      console.warn(
        "Zoho open-invoice contact person repair skipped:",
        e.message || e
      );
    }
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
    companyName: updatedContact?.company_name || customer.customerNumber || null,
    companyNameUpdated: companyNameUpdated || renumbering,
    previousCustomerNumber: previousCustomerNumber || undefined,
    recurring,
  };
}

module.exports = {
  mapContextToCustomer,
  buildRecurringProfileName,
  ensureRecurringSubscription,
  updateZohoContactDetails,
  renumberZohoContactCustomerNumber,
  pushCustomerBillingToZoho,
  isActiveRecurring,
  selectRecurringProfileToUpdate,
};
