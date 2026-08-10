/**
 * Email templates for billing-gap communications (Zoho Mail).
 * Each template is keyed by billing status or explicit template id.
 */

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatKes(amount) {
  return `KES ${roundMoney(amount).toLocaleString("en-KE")}`;
}

function greeting(customerName, customerNumber) {
  const name = String(customerName || customerNumber || "Customer").trim();
  return name.split(" ")[0] || name;
}

function wrapHtml(bodyHtml) {
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.5;max-width:600px">
${bodyHtml}
</body></html>`;
}

const TEMPLATE_DEFS = {
  payment_overdue: {
    label: "Payment overdue",
    statuses: ["overdue"],
    subject: (ctx) => `Payment overdue — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      const outstanding = formatKes(ctx.outstandingBalance);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>Our records show an outstanding balance of <strong>${outstanding}</strong> on your Starlynx account <strong>${ctx.customerNumber}</strong>.</p>
<p>Please settle via M-Pesa Paybill using your account number as the payment reference to avoid service interruption.</p>
<p>If you have already paid, kindly disregard this message — we will reconcile shortly.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  partial_payment: {
    label: "Partial payment",
    statuses: ["partial_payment"],
    subject: (ctx) => `Remaining balance — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We received a partial payment on account <strong>${ctx.customerNumber}</strong>. The remaining balance is <strong>${formatKes(ctx.outstandingBalance)}</strong>.</p>
<p>Please complete payment via M-Pesa Paybill to keep your service active.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  missing_invoice: {
    label: "Missing invoice / billing period",
    statuses: ["missing_invoice", "stale_billing"],
    subject: (ctx) => `Billing update — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We are preparing your invoice for the current billing period on account <strong>${ctx.customerNumber}</strong>.</p>
<p>Your package: ${ctx.productName || "Internet service"} (${ctx.billingFrequency || "monthly"} billing).</p>
<p>You will receive your invoice shortly. Expected amount: <strong>${formatKes(ctx.expectedAmount)}</strong>.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  skipped_payment: {
    label: "Skipped monthly payment",
    statuses: ["skipped_payment"],
    subject: (ctx) => `Missed monthly payment — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      const outstanding = formatKes(ctx.outstandingBalance);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>Our records show that a monthly invoice on account <strong>${ctx.customerNumber}</strong> was not paid after earlier payments were received.</p>
<p>Outstanding balance: <strong>${outstanding}</strong>.</p>
<p>Please settle via M-Pesa Paybill using your account number as the payment reference to avoid service interruption.</p>
<p>If you have already paid, kindly disregard this message — we will reconcile shortly.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  recurring_invoice: {
    label: "Recurring billing profile",
    statuses: ["recurring_invoice_stopped"],
    subject: (ctx) => `Recurring billing — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>Your recurring billing profile on Starlynx account <strong>${ctx.customerNumber}</strong> requires attention — automatic invoicing may have stopped.</p>
<p>Our team is reviewing your account to restore regular billing.</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  disconnected_billing: {
    label: "Service suspended — billing gap",
    statuses: ["disconnected_not_invoiced"],
    subject: (ctx) => `Service suspended — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>Your internet service on account <strong>${ctx.customerNumber}</strong> is currently suspended.</p>
<p>We are resolving a billing gap on your account. Once your invoice is issued and payment is confirmed, service will be restored.</p>
<p>Expected package amount: <strong>${formatKes(ctx.expectedAmount)}</strong>.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  reconnection: {
    label: "Reconnection notice",
    statuses: ["paid_but_disconnected"],
    subject: (ctx) => `Payment received — reconnecting ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We confirm payment on account <strong>${ctx.customerNumber}</strong>. Your service reconnection is being processed.</p>
<p>Service should be active shortly. If you remain offline after 30 minutes, please contact support.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  payment_required: {
    label: "Payment required",
    statuses: ["connected_without_payment"],
    subject: (ctx) => `Payment required — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>Your Starlynx account <strong>${ctx.customerNumber}</strong> has active service but no matching payment on record.</p>
<p>Outstanding: <strong>${formatKes(ctx.outstandingBalance)}</strong>. Please pay via M-Pesa Paybill to avoid disconnection.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  payment_allocation: {
    label: "Payment under review",
    statuses: ["payment_under_review"],
    subject: (ctx) => `Payment received — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We received your M-Pesa payment on account <strong>${ctx.customerNumber}</strong> and it is being applied to your invoice.</p>
<p>Your service will remain active while we complete allocation. No action is needed unless we contact you.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  billing_frequency: {
    label: "Billing frequency mismatch",
    statuses: ["billing_frequency_mismatch"],
    subject: (ctx) => `Billing frequency — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We noticed a mismatch between your payment and billing frequency on account <strong>${ctx.customerNumber}</strong>.</p>
<p>Please contact us to confirm your preferred billing cycle (${ctx.billingFrequency || "monthly"}).</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  billing_setup: {
    label: "Billing account setup",
    statuses: ["no_zoho_link"],
    subject: (ctx) => `Account setup — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We are completing billing setup for your Starlynx account <strong>${ctx.customerNumber}</strong>.</p>
<p>Your service is registered with us; invoicing will be activated shortly. No payment is required until you receive your first invoice.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
  general_billing: {
    label: "Billing review",
    statuses: ["manual_review_required", "credit_balance", "cancelled_still_active"],
    subject: (ctx) => `Billing review — ${ctx.customerNumber}`,
    build: (ctx) => {
      const g = greeting(ctx.customerName, ctx.customerNumber);
      const issue = ctx.issueBasis || "a billing discrepancy";
      return wrapHtml(`
<p>Dear ${g},</p>
<p>We are reviewing your Starlynx account <strong>${ctx.customerNumber}</strong> regarding ${issue}.</p>
<p>Our billing team will follow up if any action is required from you.</p>
<p>Thank you,<br/>Starlynx Billing</p>`);
    },
  },
};

const STATUS_TO_TEMPLATE = {};
for (const [key, def] of Object.entries(TEMPLATE_DEFS)) {
  for (const status of def.statuses) {
    if (!STATUS_TO_TEMPLATE[status]) STATUS_TO_TEMPLATE[status] = key;
  }
}

function resolveTemplateKey(record, preferredKey) {
  if (preferredKey && TEMPLATE_DEFS[preferredKey]) return preferredKey;
  const statuses = record.statuses || [];
  const primary = record.primaryStatus;
  if (STATUS_TO_TEMPLATE[primary]) return STATUS_TO_TEMPLATE[primary];
  for (const s of statuses) {
    if (STATUS_TO_TEMPLATE[s]) return STATUS_TO_TEMPLATE[s];
  }
  return null;
}

function buildTemplateContext(record, customer) {
  const metrics = record.metrics || {};
  return {
    customerId: record.customerId,
    customerNumber: record.customerNumber,
    customerName: record.customerName,
    productName: record.productName,
    buildingName: record.buildingName,
    outstandingBalance: metrics.outstandingBalance ?? 0,
    expectedAmount: metrics.expectedAmount ?? 0,
    billingFrequency: metrics.billingFrequency || "monthly",
    subscriptionStatus: metrics.subscriptionStatus || "Unknown",
    primaryStatus: record.primaryStatus,
    issueBasis: record.issueBasis || record.validations?.[0]?.message || null,
    email: customer?.email || null,
  };
}

function buildEmail(record, customer, templateKey) {
  const key = resolveTemplateKey(record, templateKey);
  if (!key) return null;
  const def = TEMPLATE_DEFS[key];
  const ctx = buildTemplateContext(record, customer);
  return {
    templateKey: key,
    templateLabel: def.label,
    subject: def.subject(ctx),
    html: def.build(ctx),
    text: def.build(ctx).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

function listTemplateOptions() {
  return Object.entries(TEMPLATE_DEFS).map(([id, def]) => ({
    id,
    label: def.label,
    statuses: def.statuses,
  }));
}

module.exports = {
  TEMPLATE_DEFS,
  STATUS_TO_TEMPLATE,
  resolveTemplateKey,
  buildEmail,
  buildTemplateContext,
  listTemplateOptions,
};
