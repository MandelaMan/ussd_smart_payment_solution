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
  computeServiceDueDate,
  computeRecurringStartBeforeDue,
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

async function emailSignupInvoiceOnce(invoice, customer, tracking = null, options = {}) {
  if (options.skipEmail === true) {
    return { emailed: false, reason: "skipped" };
  }
  if (!SIGNUP_INVOICE_EMAIL_ENABLED && options.forceEmail !== true) {
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
 *
 * options.forceEmail — email even when ZOHO_SIGNUP_INVOICE_EMAIL_ENABLED is off
 * options.skipEmail — create/reuse invoice but do not email (e.g. already paid)
 */
async function createSignupInvoice(customer, zohoContact, options = {}) {
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
      tracking,
      options
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
      emailReason: emailResult.reason,
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

  const emailResult = await emailSignupInvoiceOnce(
    invoice,
    customer,
    tracking,
    options
  );
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
    emailReason: emailResult.reason,
  };
}

/**
 * Link customer in Zoho Books and issue the first subscription invoice.
 * When the Zoho contact already exists (matched by customer number / email /
 * phone / name), only link+update — do not auto-create signup or recurring
 * invoices (unless forceBilling). Use edit-customer options (or retry with
 * forceBilling) for those.
 *
 * options.paymentAlreadyMade + options.mpesaCode — create signup invoice and
 * mark it paid with the M-Pesa receipt (no email).
 * options.forceEmail — email the signup invoice to the customer.
 */
async function onboardNewCustomerBilling(customerId, options = {}) {
  const forceBilling = options.forceBilling === true;
  const paymentAlreadyMade = options.paymentAlreadyMade === true;
  const mpesaCode = options.mpesaCode
    ? String(options.mpesaCode).trim().toUpperCase()
    : "";
  const forceEmail = options.forceEmail === true && !paymentAlreadyMade;
  const skipEmail = options.skipEmail === true || paymentAlreadyMade;

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
  const hasTrial = Boolean(ctx.trial_period_enabled) && !paymentAlreadyMade;
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
    const contactCreated = zohoContact._wasCreated === true;

    const { updateZohoContactDetails } = require("./customerZohoSync");
    zohoContact = await updateZohoContactDetails(
      { ...customer, customerType: ctx.customer_type, agencyId: ctx.agency_id },
      zohoContact
    );

    let invoice;
    let recurring = null;

    // Advance payment / forced billing override the "existing contact → skip" rule.
    const shouldBill =
      contactCreated || forceBilling || paymentAlreadyMade;

    // Pre-existing Zoho contact: link only. Signup / recurring are opt-in on edit.
    if (!shouldBill) {
      invoice = {
        created: false,
        skipped: true,
        reason: "existing_zoho_contact",
        invoiceId: null,
        invoiceNumber: null,
        emailed: false,
      };
      recurring = {
        created: false,
        skipped: true,
        reason: "existing_zoho_contact",
      };
    } else if (hasTrial) {
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
      invoice = await createSignupInvoice(customer, zohoContact, {
        forceEmail,
        skipEmail,
      });

      if (paymentAlreadyMade && mpesaCode && invoice.invoiceId) {
        invoice = await applyAdvanceMpesaToSignupInvoice({
          customer,
          zohoContact,
          invoice,
          mpesaCode,
        });
      }

      // Always create/ensure recurring profile after signup invoice
      // (both advance-paid and unpaid → invoice emailed paths).
      // Start = service/TISP due date minus 7 days (not the due date itself).
      const serviceDue =
        options.serviceDueDate ||
        computeServiceDueDate({
          paymentFrequency: customer.paymentFrequency,
          customPeriodDays: customer.customPeriodDays,
        });
      const recurringStart =
        computeRecurringStartBeforeDue(serviceDue) ||
        invoice.period?.endDate;
      try {
        recurring = await ensureRecurringSubscription(customer, zohoContact, {
          startDate: recurringStart,
        });
        if (recurring && typeof recurring === "object") {
          recurring.serviceDueDate = serviceDue;
          recurring.startDate = recurringStart;
        }
      } catch (e) {
        console.error("recurring invoice setup failed:", e.message);
        recurring = {
          created: false,
          updated: false,
          error: e.message || "recurring_setup_failed",
          serviceDueDate: serviceDue,
          startDate: recurringStart,
        };
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

    const linkedExisting =
      !contactCreated && invoice?.reason === "existing_zoho_contact";

    try {
      await logActivity({
        eventType: linkedExisting
          ? "zoho_customer_linked"
          : hasTrial
            ? "zoho_trial_started"
            : invoice.paid
              ? "zoho_invoice_updated"
              : invoice.created
                ? "zoho_invoice_created"
                : "zoho_customer_linked",
        title: linkedExisting
          ? "Existing Zoho contact linked"
          : hasTrial
            ? "Trial period started"
            : invoice.paid
              ? "Signup invoice marked paid"
              : invoice.created
                ? "Signup invoice created"
                : invoice.reused
                  ? "Signup invoice already open"
                  : "Customer linked in Zoho",
        message: linkedExisting
          ? `${customer.customerNumber}: linked existing Zoho contact — signup/recurring skipped (use edit to bill)`
          : hasTrial
            ? `${customer.customerNumber}: 30-day trial — first invoice scheduled ${trialEndsAt}`
            : invoice.paid
              ? `${customer.customerNumber}: ${invoice.invoiceNumber || invoice.invoiceId} paid (M-Pesa ${mpesaCode})${
                  invoice.receiptEmailed || invoice.emailed
                    ? " — receipt emailed"
                    : ""
                }`
              : invoice.invoiceNumber
                ? `${customer.customerNumber}: ${invoice.invoiceNumber}${
                    invoice.emailed ? " — emailed to customer" : ""
                  }`
                : `${customer.customerNumber} linked in Zoho Books`,
        source: "zoho",
        status: invoice.paymentError
          ? "failed"
          : invoice.emailed || invoice.receiptEmailed
            ? "pending"
            : "success",
        customerRef: customer.customerNumber,
        amount: invoice.total ?? null,
        referenceId:
          mpesaCode ||
          invoice.invoiceId ||
          recurring?.recurringInvoiceId ||
          null,
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
      contactCreated,
      contactUpdated: !contactCreated,
      billingSkipped: linkedExisting,
      invoice,
      recurring,
      trial: hasTrial && !linkedExisting ? { enabled: true, endsAt: trialEndsAt } : null,
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

async function applyAdvanceMpesaToSignupInvoice({
  customer,
  zohoContact,
  invoice,
  mpesaCode,
}) {
  const {
    findCustomerPaymentByReference_JS,
    getCustomerPayment_JS,
    updateCustomerPayment_JS,
  } = require("../controllers/zoho.controller");
  const { applyZohoPaymentForMpesa } = require("../controllers/mpesa.controller");
  const { isMpesaPaymentAllocated } = require("./reconciliationStore");
  const transactionStore = require("./transactionStore");

  const contactId = zohoContact?.contact_id
    ? String(zohoContact.contact_id)
    : null;
  if (!contactId || !invoice.invoiceId) {
    return {
      ...invoice,
      paid: false,
      paymentError: "missing_zoho_contact_or_invoice",
      mpesaCode,
    };
  }

  // Prefer an existing Zoho Received Payment whose REFERENCE# matches the code.
  let attached = null;
  try {
    const listed = await findCustomerPaymentByReference_JS(mpesaCode);
    if (listed?.payment_id) {
      const full =
        (await getCustomerPayment_JS(listed.payment_id)) || listed;
      attached = await attachZohoPaymentToSignupInvoice({
        customer,
        contactId,
        invoice,
        payment: full,
        mpesaCode,
        updateCustomerPayment_JS,
      });
    }
  } catch (e) {
    console.error(
      "Zoho payment lookup/attach by reference failed:",
      e.response?.data || e.message
    );
    attached = {
      paid: false,
      paymentError:
        e.response?.data?.message || e.message || "attach_failed",
    };
  }

  if (attached?.paid) {
    const payAmount = Number(
      attached.payment_amount || attached.payment?.amount || invoice.total || 0
    );
    const receiptEmail = await emailAdvancePaymentReceipt({
      customer,
      invoice,
      payResult: {
        invoice_id: invoice.invoiceId,
        invoice_number: invoice.invoiceNumber,
        payment_amount: payAmount,
        zoho_payment_id: attached.zoho_payment_id,
      },
      mpesaCode,
      payAmount,
    });

    try {
      await logActivity({
        eventType: "zoho_invoice_updated",
        title: "Zoho payment attached",
        message: `${customer.customerNumber}: attached Zoho payment REFERENCE# ${mpesaCode} to ${invoice.invoiceNumber || invoice.invoiceId}`,
        source: "zoho",
        status: "success",
        customerRef: customer.customerNumber,
        amount: payAmount,
        referenceId: mpesaCode,
      });
    } catch {
      /* ignore */
    }

    return {
      ...invoice,
      paid: true,
      paymentAttached: true,
      payment: attached.payment || null,
      zohoPaymentId: attached.zoho_payment_id,
      mpesaCode,
      emailed: receiptEmail.emailed,
      emailReason: receiptEmail.reason,
      receiptEmailed: receiptEmail.emailed,
    };
  }

  if (attached?.paymentError === "payment_already_on_invoice") {
    const receiptEmail = await emailAdvancePaymentReceipt({
      customer,
      invoice,
      payResult: {
        invoice_id: invoice.invoiceId,
        invoice_number: invoice.invoiceNumber,
        payment_amount: Number(invoice.total || 0),
        zoho_payment_id: attached.zoho_payment_id,
      },
      mpesaCode,
      payAmount: Number(invoice.total || 0),
    });
    return {
      ...invoice,
      paid: true,
      paymentAttached: true,
      mpesaCode,
      zohoPaymentId: attached.zoho_payment_id,
      emailed: receiptEmail.emailed,
      emailReason: receiptEmail.reason,
      receiptEmailed: receiptEmail.emailed,
    };
  }

  // No Zoho payment found (or attach failed) — create/apply payment as before.
  if (await isMpesaPaymentAllocated(mpesaCode)) {
    return {
      ...invoice,
      paid: false,
      paymentError: attached?.paymentError || "mpesa_already_allocated",
      mpesaCode,
    };
  }

  let payAmount = Number(invoice.total || customer.packagePrice || 0);
  try {
    const existingTxn = await transactionStore.findByMpesaReceipt(mpesaCode);
    if (existingTxn?.amount != null && Number(existingTxn.amount) > 0) {
      payAmount = Number(existingTxn.amount);
    }
  } catch {
    /* use invoice total */
  }

  if (!(payAmount > 0)) {
    return {
      ...invoice,
      paid: false,
      paymentError: attached?.paymentError || "invalid_payment_amount",
      mpesaCode,
    };
  }

  const payResult = await applyZohoPaymentForMpesa({
    customerNumber: customer.customerNumber,
    amount: payAmount,
    transactionId: mpesaCode,
    source: "admin_signup",
    forceInvoiceId: invoice.invoiceId,
  });

  if (!payResult?.paid) {
    console.error(
      "signup advance M-Pesa apply failed:",
      payResult?.reason || payResult
    );
    return {
      ...invoice,
      paid: false,
      paymentError:
        attached?.paymentError ||
        payResult?.reason ||
        "payment_failed",
      payment: payResult || null,
      mpesaCode,
    };
  }

  const receiptEmail = await emailAdvancePaymentReceipt({
    customer,
    invoice,
    payResult,
    mpesaCode,
    payAmount,
  });

  return {
    ...invoice,
    paid: true,
    payment: payResult,
    mpesaCode,
    emailed: receiptEmail.emailed,
    emailReason: receiptEmail.reason,
    receiptEmailed: receiptEmail.emailed,
  };
}

async function attachZohoPaymentToSignupInvoice({
  customer,
  contactId,
  invoice,
  payment,
  mpesaCode,
  updateCustomerPayment_JS,
}) {
  const paymentId = String(payment.payment_id || "").trim();
  if (!paymentId) {
    return { paid: false, paymentError: "payment_not_found" };
  }

  const existingInvoices = Array.isArray(payment.invoices)
    ? payment.invoices
    : [];
  const alreadyOnInvoice = existingInvoices.some(
    (row) => String(row.invoice_id) === String(invoice.invoiceId)
  );
  if (alreadyOnInvoice) {
    return {
      paid: true,
      paymentError: "payment_already_on_invoice",
      zoho_payment_id: paymentId,
      payment,
      payment_amount: Number(payment.amount || 0),
    };
  }

  const paymentAmount = Number(payment.amount || 0);
  const unused = Number(
    payment.unused_amount != null
      ? payment.unused_amount
      : payment.amount_refunded != null
        ? Math.max(0, paymentAmount - Number(payment.amount_refunded || 0))
        : paymentAmount
  );
  // Prefer unused credit; otherwise re-apply the full payment onto the signup invoice.
  const invoiceTotal = Number(invoice.total || 0);
  let amountApplied = unused > 0 ? unused : paymentAmount;
  if (invoiceTotal > 0) {
    amountApplied = Math.min(amountApplied, invoiceTotal);
  }
  if (!(amountApplied > 0)) {
    return { paid: false, paymentError: "payment_no_usable_amount" };
  }

  const paymentMode =
    String(payment.payment_mode || "").trim() ||
    process.env.ZOHO_PAYMENT_MODE ||
    "Mobile Money";

  const updated = await updateCustomerPayment_JS(paymentId, {
    customer_id: contactId,
    payment_mode: paymentMode,
    amount: paymentAmount > 0 ? paymentAmount : amountApplied,
    date: payment.date || undefined,
    reference_number: payment.reference_number || mpesaCode,
    description:
      payment.description ||
      `Attached to ${customer.customerNumber} on signup (${mpesaCode})`,
    invoices: [
      {
        invoice_id: invoice.invoiceId,
        amount_applied: amountApplied,
      },
    ],
  });

  try {
    const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
    await integrationSnapshot.recordZohoPaymentSnapshot(customer.id, {
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      paymentId,
      amount: amountApplied,
      referenceId: mpesaCode,
      remainingBalance: 0,
    });
  } catch (e) {
    console.warn("Zoho payment snapshot after attach failed:", e.message);
  }

  return {
    paid: true,
    zoho_payment_id: paymentId,
    payment: updated || payment,
    payment_amount: amountApplied,
  };
}

/**
 * Email payment receipt after advance M-Pesa is applied:
 * 1) Paid invoice PDF via Zoho invoice email (primary receipt)
 * 2) Customer payment email when Zoho supports it for the payment id
 */
async function emailAdvancePaymentReceipt({
  customer,
  invoice,
  payResult,
  mpesaCode,
  payAmount,
}) {
  const { emailCustomerPayment_JS } = require("../controllers/zoho.controller");
  const toEmail = resolveEffectiveCustomerEmail(customer) || null;
  if (!toEmail) {
    return { emailed: false, reason: "no_email" };
  }

  const invoiceId = String(
    invoice.invoiceId || payResult.invoice_id || ""
  ).trim();
  const invoiceNumber =
    invoice.invoiceNumber || payResult.invoice_number || null;
  const amountLabel = Number(
    payResult.payment_amount || payAmount || invoice.total || 0
  ).toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  });
  const subject = `Payment receipt — ${
    invoiceNumber || customer.customerNumber
  }`;
  const body = [
    `<p>Dear ${[customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Customer"},</p>`,
    `<p>Thank you. We have received your M-Pesa payment <strong>${mpesaCode}</strong> for account <strong>${customer.customerNumber}</strong>.</p>`,
    `<p>Amount: <strong>${amountLabel}</strong>${
      invoiceNumber ? `<br/>Invoice: <strong>${invoiceNumber}</strong>` : ""
    }</p>`,
    `<p>Please find your payment receipt attached.</p>`,
    `<p>Regards,<br/>Starlynx Billing</p>`,
  ].join("");

  let emailed = false;

  if (invoiceId) {
    try {
      emailed = await emailInvoice_JS({
        invoice_id: invoiceId,
        to_mail_ids: [toEmail],
        subject,
        body,
      });
      if (emailed) {
        await customerStore.recordSignupInvoiceDelivery(customer.id, invoiceId, {
          emailed: true,
        });
      }
    } catch (e) {
      console.error("advance payment invoice receipt email failed:", e.message);
    }
  }

  const paymentId = payResult.zoho_payment_id
    ? String(payResult.zoho_payment_id)
    : "";
  if (paymentId) {
    try {
      const paymentEmailed = await emailCustomerPayment_JS({
        payment_id: paymentId,
        to_mail_ids: [toEmail],
        subject,
        body,
      });
      if (paymentEmailed) emailed = true;
    } catch (e) {
      console.warn("advance payment Zoho payment email failed:", e.message);
    }
  }

  return {
    emailed,
    reason: emailed ? "receipt_sent" : "email_failed",
  };
}

module.exports = {
  onboardNewCustomerBilling,
  createSignupInvoice,
};
