const {
  createInvoice_JS,
  emailInvoice_JS,
  getInvoices_JS,
  getRecurringInvoices_JS,
} = require("../controllers/zoho.controller");
const customerStore = require("./customerModuleStore");
const { logActivity } = require("./activityLogStore");
const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
const {
  isB2BCustomer,
  resolveEffectiveCustomerEmail,
} = require("../utils/b2bBilling");
const { buildSubscriptionLineItems } = require("../utils/zohoInvoiceLineItems");
const {
  computeBillingPeriod,
  computeInvoiceDueDate,
  computeTrialEndDate,
} = require("../utils/billingPeriod");
const {
  buildZohoInvoiceNumber,
  buildCustomerInvoicePrefix,
} = require("../utils/zohoInvoiceNumber");
const {
  mapContextToCustomer,
  ensureRecurringSubscription,
} = require("./customerZohoSync");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");

const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !==
  "false";
const SIGNUP_INVOICE_EMAIL_ENABLED =
  String(process.env.ZOHO_SIGNUP_INVOICE_EMAIL_ENABLED || "false").toLowerCase() ===
  "true";
const RECURRING_ON_SIGNUP =
  String(process.env.ZOHO_RECURRING_ON_SIGNUP || "false").toLowerCase() ===
  "true";

const EMAILED_INVOICE_STATUSES = new Set([
  "sent",
  "overdue",
  "paid",
  "partially_paid",
  "viewed",
]);

async function ensureZohoContactForCustomer(customer) {
  const {
    ensureZohoContactForCustomer: ensure,
  } = require("../controllers/customers.controller");
  return ensure(customer);
}

function isInvoiceVoid(invoice) {
  return String(invoice?.status || "").toLowerCase() === "void";
}

function invoiceWasEmailed(invoice) {
  const status = String(invoice?.status || "").toLowerCase();
  if (EMAILED_INVOICE_STATUSES.has(status)) return true;
  if (invoice?.is_emailed === true || invoice?.is_email_sent === true) {
    return true;
  }
  if (Number(invoice?.mail_sent_count || invoice?.email_sent_count || 0) > 0) {
    return true;
  }
  return false;
}

function invoiceMatchesCustomer(invoice, customerNumber, invoicePrefix) {
  if (isInvoiceVoid(invoice)) return false;
  const ref = String(customerNumber || "").trim().toUpperCase();
  const orderRef = String(
    invoice.reference_number || invoice.order_number || ""
  )
    .trim()
    .toUpperCase();
  const invNum = String(invoice.invoice_number || "").toUpperCase();
  const prefix = String(invoicePrefix || "").toUpperCase();
  return (
    (ref && (orderRef === ref || orderRef.includes(ref))) ||
    (prefix && invNum.startsWith(`${prefix}INV`))
  );
}

async function findSignupInvoiceForCustomer(contactId, customer) {
  const prefix = buildCustomerInvoicePrefix({
    customerNumber: customer.customerNumber,
    buildingCode: customer.buildingCode,
  });
  const stored = await customerStore.getCustomerById(customer.id);
  const storedId = stored?.zohoSignupInvoiceId;

  const invoices = await getInvoices_JS({
    customer_id: contactId,
    per_page: 200,
    page: 1,
  });

  const matching = (invoices || []).filter(
    (inv) =>
      invoiceMatchesCustomer(inv, customer.customerNumber, prefix) ||
      (storedId && String(inv.invoice_id) === String(storedId))
  );

  if (!matching.length) return null;

  if (storedId) {
    const storedInvoice = matching.find(
      (inv) => String(inv.invoice_id) === String(storedId)
    );
    if (storedInvoice) return storedInvoice;
  }

  const openUnpaid = matching.find((inv) => {
    const status = String(inv.status || "").toLowerCase();
    const balance = inv.balance != null ? Number(inv.balance) : null;
    return (
      ["sent", "overdue", "partially_paid", "draft", "unpaid"].includes(
        status
      ) &&
      balance != null &&
      balance > 0
    );
  });
  if (openUnpaid) return openUnpaid;

  return matching.sort((a, b) => {
    const left = String(a.date || a.created_time || "");
    const right = String(b.date || b.created_time || "");
    return right.localeCompare(left);
  })[0];
}

async function emailSignupInvoiceOnce(invoice, customer, tracking = null) {
  if (!SIGNUP_INVOICE_EMAIL_ENABLED) {
    return { emailed: false, reason: "disabled" };
  }

  const invoiceId = String(invoice.invoice_id);
  const toEmail = resolveEffectiveCustomerEmail(customer) || null;
  if (!toEmail) {
    return { emailed: false, reason: "no_email" };
  }

  if (
    tracking?.zohoSignupInvoiceEmailedAt &&
    tracking?.zohoSignupInvoiceId === invoiceId
  ) {
    return { emailed: false, reason: "already_recorded" };
  }

  if (invoiceWasEmailed(invoice)) {
    await customerStore.recordSignupInvoiceDelivery(customer.id, invoiceId, {
      emailed: true,
    });
    return { emailed: false, reason: "already_sent_in_zoho" };
  }

  try {
    const sent = await emailInvoice_JS({
      invoice_id: invoice.invoice_id,
      to_mail_ids: [toEmail],
    });
    if (sent) {
      await customerStore.recordSignupInvoiceDelivery(customer.id, invoiceId, {
        emailed: true,
      });
    }
    return { emailed: Boolean(sent), reason: sent ? "sent" : "email_failed" };
  } catch (e) {
    console.error("signup invoice email failed:", e.message);
    return { emailed: false, reason: e.message };
  }
}

function buildSignupLineItems(customer, period) {
  return buildSubscriptionLineItems(customer, period, {
    includeOneTimeDstvFee: true,
  });
}

/**
 * Create (or reuse) the first subscription invoice and email it once to the customer.
 * C2B: invoice on customer contact. B2B: invoice on agency contact with customer line.
 */
async function createSignupInvoice(customer, zohoContact) {
  const amount = Number(customer.packagePrice || 0);
  if (amount <= 0) {
    return {
      created: false,
      reason: "no_package_price",
      invoiceId: null,
      invoiceNumber: null,
      emailed: false,
    };
  }

  const period = computeBillingPeriod({
    paymentFrequency: customer.paymentFrequency,
    customPeriodDays: customer.customPeriodDays,
  });

  const tracking = await customerStore.getCustomerById(customer.id);
  const existing = await findSignupInvoiceForCustomer(
    zohoContact.contact_id,
    customer
  );
  if (existing?.invoice_id) {
    const emailResult = await emailSignupInvoiceOnce(
      existing,
      customer,
      tracking
    );
    await customerStore.recordSignupInvoiceDelivery(
      customer.id,
      existing.invoice_id,
      { emailed: emailResult.emailed }
    );
    return {
      created: false,
      reused: true,
      invoiceId: String(existing.invoice_id),
      invoiceNumber: existing.invoice_number || null,
      total: Number(existing.total || amount),
      period,
      emailed: emailResult.emailed,
    };
  }

  const referenceNumber = customer.customerNumber;
  const invoiceNumber = await buildZohoInvoiceNumber({
    customerId: customer.id,
    customerNumber: customer.customerNumber,
    buildingCode: customer.buildingCode,
  });

  const invoice = await createInvoice_JS({
    customer_id: zohoContact.contact_id,
    items: buildSignupLineItems(customer, period),
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber,
    invoice_number: invoiceNumber,
    due_date: computeInvoiceDueDate(customer),
  });

  if (!invoice?.invoice_id) {
    throw new Error("Zoho signup invoice creation failed");
  }

  const emailResult = await emailSignupInvoiceOnce(invoice, customer, tracking);
  await customerStore.recordSignupInvoiceDelivery(
    customer.id,
    invoice.invoice_id,
    { emailed: emailResult.emailed }
  );

  return {
    created: true,
    invoiceId: String(invoice.invoice_id),
    invoiceNumber: invoice.invoice_number || null,
    total: Number(invoice.total || amount),
    period,
    emailed: emailResult.emailed,
  };
}

/**
 * Link customer in Zoho Books and issue the first subscription invoice.
 * ~3 Zoho API calls: contact lookup/create, invoice create, optional email.
 */
async function onboardNewCustomerBilling(customerId) {
  const ctx = await customerStore.getCustomerContext(customerId);
  if (!ctx) {
    return { ok: false, error: "Customer not found" };
  }

  // B2B customers are not Zoho Books contacts — billing lives on the agency.
  if (isB2BCustomer({ customerType: ctx.customer_type })) {
    try {
      await customerStore.updateCustomerZohoBillingStatus(
        customerId,
        "completed",
        null
      );
    } catch (persistErr) {
      console.error("zoho billing status persist failed:", persistErr.message);
    }
    return {
      ok: true,
      skipped: true,
      reason: "b2b_no_zoho",
      linked: false,
      zohoContactId: null,
      invoice: null,
      recurring: null,
      trial: null,
    };
  }

  const customer = mapContextToCustomer(ctx, null);
  const hasTrial = Boolean(ctx.trial_period_enabled);
  const trialEndsAt =
    ctx.trial_ends_at ||
    (hasTrial ? computeTrialEndDate() : null);

  try {
    let zohoContact = await ensureZohoContactForCustomer({
      ...customer,
      customerType: ctx.customer_type,
      agencyId: ctx.agency_id,
    });
    if (!zohoContact?.contact_id) {
      throw new Error("Zoho contact could not be linked");
    }

    const { updateZohoContactDetails } = require("./customerZohoSync");
    zohoContact = await updateZohoContactDetails(
      { ...customer, customerType: ctx.customer_type, agencyId: ctx.agency_id },
      zohoContact
    );

    let invoice;
    let recurring = null;

    if (hasTrial) {
      invoice = {
        created: false,
        skipped: true,
        reason: "trial_period",
        trialEndsAt,
        invoiceId: null,
        invoiceNumber: null,
        emailed: false,
      };
      try {
        recurring = await ensureRecurringSubscription(customer, zohoContact, {
          startDate: trialEndsAt,
          includeOneTimeDstvFee: true,
        });
      } catch (e) {
        console.error("trial recurring invoice setup failed:", e.message);
        throw e;
      }
    } else {
      invoice = await createSignupInvoice(customer, zohoContact);
      if (RECURRING_ON_SIGNUP) {
        try {
          recurring = await ensureRecurringSubscription(customer, zohoContact, {
            startDate: invoice.period?.endDate,
          });
        } catch (e) {
          console.error("recurring invoice setup failed:", e.message);
        }
      }
    }
    invalidateCustomerZoho(customerId);

    try {
      const invoices = await getInvoices_JS({
        customer_id: zohoContact.contact_id,
        per_page: 50,
        page: 1,
      });
      const recurringList = await getRecurringInvoices_JS({
        customer_id: zohoContact.contact_id,
        per_page: 50,
      });
      await integrationSnapshot.saveZohoBillingSnapshot(customerId, {
        contact: zohoContact,
        invoices: invoices || [],
        payments: [],
        recurring: recurringList || [],
      });
    } catch (e) {
      console.warn("billing onboarding snapshot failed:", e.message);
    }

    try {
      await logActivity({
        eventType: hasTrial
          ? "zoho_trial_started"
          : invoice.created
            ? "zoho_invoice_created"
            : "zoho_customer_linked",
        title: hasTrial
          ? "Trial period started"
          : invoice.created
            ? "Signup invoice created"
            : invoice.reused
              ? "Signup invoice already open"
              : "Customer linked in Zoho",
        message: hasTrial
          ? `${customer.customerNumber}: 30-day trial — first invoice scheduled ${trialEndsAt}${
              recurring?.recurringInvoiceId ? "" : ""
            }`
          : invoice.invoiceNumber
            ? `${customer.customerNumber}: ${invoice.invoiceNumber}${
                invoice.emailed ? " — emailed to customer" : ""
              }`
            : `${customer.customerNumber} linked in Zoho Books`,
        source: "zoho",
        status: invoice.emailed ? "pending" : "success",
        customerRef: customer.customerNumber,
        amount: invoice.total ?? null,
        referenceId: invoice.invoiceId || recurring?.recurringInvoiceId || null,
      });
    } catch (e) {
      console.error("billing onboarding activity log failed:", e.message);
    }

    try {
      await customerStore.updateCustomerZohoBillingStatus(
        customerId,
        "completed",
        null
      );
    } catch (persistErr) {
      console.error("zoho billing status persist failed:", persistErr.message);
    }

    return {
      ok: true,
      linked: true,
      zohoContactId: zohoContact.contact_id,
      invoice,
      recurring,
      trial: hasTrial ? { enabled: true, endsAt: trialEndsAt } : null,
    };
  } catch (e) {
    const message = e.message || "Billing onboarding failed";
    try {
      await customerStore.updateCustomerZohoBillingStatus(
        customerId,
        "failed",
        message
      );
    } catch (persistErr) {
      console.error("zoho billing status persist failed:", persistErr.message);
    }
    return {
      ok: false,
      linked: false,
      zohoContactId: null,
      invoice: null,
      error: message,
    };
  }
}

module.exports = {
  onboardNewCustomerBilling,
  createSignupInvoice,
};
