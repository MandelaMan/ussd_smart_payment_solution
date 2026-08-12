const { normalizeSubscriptionStatus } = require("./subscriptionStatus");
const {
  isOverdueZohoInvoice,
} = require("./zohoInvoiceStatus");
const { detectSkippedMonthlyPayment } = require("./skippedPayment");

/** Raw subscription_status values that mean "not present on TISP" (not Suspended). */
const UNKNOWN_TISP_ALIASES = new Set([
  "unknown",
  "not on tisp",
  "not_on_tisp",
  "missing",
  "none",
]);

const BILLING_STATUSES = [
  "current",
  "paid",
  "overdue",
  "partial_payment",
  "payment_under_review",
  "connected_without_payment",
  "paid_but_disconnected",
  "billing_frequency_mismatch",
  "recurring_invoice_stopped",
  "unmatched_payment",
  "manual_review_required",
  "missing_invoice",
  "disconnected_not_invoiced",
  "credit_balance",
  "cancelled_still_active",
  "stale_billing",
  "skipped_payment",
  "no_zoho_link",
  "unknown",
];

const STATUS_PRIORITY = {
  cancelled_still_active: 105,
  connected_without_payment: 100,
  paid_but_disconnected: 95,
  billing_frequency_mismatch: 85,
  disconnected_not_invoiced: 82,
  recurring_invoice_stopped: 80,
  unmatched_payment: 75,
  payment_under_review: 72,
  skipped_payment: 68,
  partial_payment: 70,
  overdue: 65,
  stale_billing: 62,
  missing_invoice: 60,
  no_zoho_link: 58,
  manual_review_required: 55,
  credit_balance: 40,
  paid: 30,
  current: 20,
  unknown: 10,
};

const RECOMMENDATION_ACTIONS = {
  disconnect_service: "Disconnect Service",
  reconnect_service: "Reconnect Service",
  resume_recurring_invoice: "Resume Recurring Invoice",
  generate_missing_invoice: "Generate Missing Invoice",
  allocate_payment: "Allocate Payment",
  correct_billing_frequency: "Correct Billing Frequency",
  investigate_payment: "Investigate Payment",
  contact_customer: "Contact Customer",
  leave_service_active: "Leave Service Active",
  manual_review: "Manual Review",
  refresh_tisp_status: "Refresh TISP Status",
  link_zoho_contact: "Link Zoho Contact",
};

function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function amountsEqual(a, b) {
  return Math.abs(roundMoney(a) - roundMoney(b)) < 0.01;
}

function formatKes(amount) {
  return `KES ${roundMoney(amount).toLocaleString("en-KE")}`;
}

function isActiveService(subscriptionStatus) {
  return normalizeSubscriptionStatus(subscriptionStatus) === "Active";
}

function isDisconnectedService(subscriptionStatus) {
  return normalizeSubscriptionStatus(subscriptionStatus) === "Suspended";
}

/**
 * True when TISP presence is unknown (empty / "Not on TISP" / legacy aliases),
 * as opposed to an explicit Suspended/Paused/Active/Cancelled service state.
 * Must inspect the raw value — normalizeSubscriptionStatus maps these to Suspended.
 */
function isUnknownService(subscriptionStatus) {
  const raw = String(subscriptionStatus ?? "").trim().toLowerCase();
  if (!raw) return true;
  if (
    raw.includes("active") ||
    raw.includes("suspend") ||
    raw.includes("pause") ||
    raw.includes("cancel")
  ) {
    return false;
  }
  return (
    UNKNOWN_TISP_ALIASES.has(raw) ||
    raw.includes("not on tisp") ||
    raw === "unknown"
  );
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

function expectedBillingPeriodDays(frequency, customPeriodDays) {
  if (frequency === "custom" && customPeriodDays) return Number(customPeriodDays);
  if (frequency === "quarterly") return 90;
  if (frequency === "yearly") return 365;
  return 30;
}

function detectFrequencyMismatch(customer, lastPaymentAmount, monthlyPrice) {
  if (!lastPaymentAmount || !monthlyPrice) return false;
  const freq = String(customer.paymentFrequency || "monthly").toLowerCase();
  if (freq === "monthly" || freq === "custom") return false;
  const expected = roundMoney(customer.packagePrice);
  const monthly = roundMoney(monthlyPrice);
  const paid = roundMoney(lastPaymentAmount);
  return amountsEqual(paid, monthly) && !amountsEqual(paid, expected) && expected > paid;
}

function detectRecurringStopped(recurringInvoices = []) {
  if (!recurringInvoices.length) return { stopped: true, reason: "no_recurring_invoice" };
  const active = recurringInvoices.filter((r) => {
    const status = String(r.status || r.recurrence_status || "").toLowerCase();
    return status === "active" || status === "live";
  });
  if (!active.length) {
    return { stopped: true, reason: "inactive_recurring_invoice" };
  }
  return { stopped: false, reason: null };
}

function detectMissingInvoice(customer, invoices = [], recurring = {}) {
  if (String(customer.status || "").toLowerCase() === "cancelled") return false;
  if (!invoices.length && !recurring.stopped) return true;
  const periodDays = expectedBillingPeriodDays(
    customer.paymentFrequency,
    customer.customPeriodDays
  );
  const lastPayment = customer.lastPaymentDate;
  if (!lastPayment) return invoices.length === 0;
  const days = daysSince(lastPayment);
  if (days == null) return false;
  const openInvoices = invoices.filter((inv) => roundMoney(inv.balanceDue ?? inv.balance ?? 0) > 0);
  return days > periodDays + 7 && openInvoices.length === 0 && invoices.length > 0;
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatShortDate(value) {
  const d = parseDateOnly(value);
  if (!d) return null;
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function latestDateString(values = []) {
  let latest = null;
  let latestMs = -Infinity;
  for (const raw of values) {
    const d = parseDateOnly(raw);
    if (!d) continue;
    const ms = d.getTime();
    if (ms > latestMs) {
      latestMs = ms;
      latest = raw;
    }
  }
  return latest;
}

/**
 * Whether Zoho has an invoice dated within the customer's billing period (dashboard frequency — not TISP).
 */
function hasInvoiceForCurrentPeriod(customer, invoices = []) {
  const periodDays = expectedBillingPeriodDays(
    customer.paymentFrequency,
    customer.customPeriodDays
  );
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - periodDays);
  windowStart.setHours(0, 0, 0, 0);

  return invoices.some((inv) => {
    const raw = inv.date || inv.invoiceDate || inv.dueDate;
    const d = parseDateOnly(raw);
    if (!d) return false;
    return d >= windowStart;
  });
}

function isTispDueDatePassed(tispDueDate) {
  const due = parseDateOnly(tispDueDate);
  if (!due) return null;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return due < endOfToday;
}

function detectDuplicateOpenInvoices(invoices = []) {
  const open = invoices.filter((inv) => roundMoney(inv.balanceDue ?? 0) > 0);
  return open.length >= 2;
}

/**
 * Cross-system scenario detection: Zoho Books vs TISP vs dashboard account state.
 */
function detectBillingScenarios(ctx) {
  const statuses = [];
  const validations = [];
  const scenarioRecs = [];

  const add = ({ status, code, severity, message, recommendations = [] }) => {
    if (status && !statuses.includes(status)) statuses.push(status);
    validations.push({ code, severity, message });
    for (const rec of recommendations) {
      if (!scenarioRecs.some((r) => r.action === rec.action)) {
        scenarioRecs.push(rec);
      }
    }
  };

  const rec = (action, detail) => ({
    action,
    label: RECOMMENDATION_ACTIONS[action] || action,
    detail: detail || null,
  });

  const {
    customer,
    subscriptionStatus,
    accountStatus,
    serviceActive,
    serviceDisconnected,
    serviceUnknown,
    outstandingBalance,
    overdueInvoices,
    overdueCount,
    openInvoiceCount,
    expectedAmount,
    lastPaymentAmount,
    monthlyPrice,
    invoices,
    mpesaPayments,
    unmatchedMpesa,
    recentUnmatchedMpesa,
    recurring,
    billedViaAgency,
    agencyName,
    zohoLinked,
    zohoError,
    tispError,
    tispSyncStatus,
    creditBalance,
    partialInvoices,
    tispDueDate,
    zohoPayments,
    skippedPayment,
  } = ctx;

  const accountActive = String(accountStatus || customer.status || "").toLowerCase() === "active";
  const accountCancelled = String(accountStatus || customer.status || "").toLowerCase() === "cancelled";
  const hasOutstanding = outstandingBalance > 0;
  const hasOverdue = overdueCount > 0;
  const tispLabel = normalizeSubscriptionStatus(subscriptionStatus);
  const zohoLabel = hasOverdue
    ? `${formatKes(outstandingBalance)} overdue (${overdueCount} invoice${overdueCount === 1 ? "" : "s"})`
    : hasOutstanding
      ? `${formatKes(outstandingBalance)} outstanding`
      : "Paid up";

  if (billedViaAgency) {
    validations.push({
      code: "b2b_agency_billing",
      severity: "low",
      message: agencyName
        ? `B2B — billed via agency ${agencyName}, not individually`
        : "B2B — billing is consolidated to the managing agency",
    });
    if (!agencyName) {
      add({
        status: "manual_review_required",
        code: "b2b_no_agency",
        severity: "high",
        message: "B2B customer is not linked to an agency",
        recommendations: [rec("manual_review")],
      });
    }
  }

  // ── CRITICAL: Active service + Zoho outstanding/overdue = free service ──
  if (accountActive && serviceActive && hasOutstanding) {
    const freeServiceDetail = hasOverdue
      ? `${overdueCount} overdue invoice${overdueCount === 1 ? "" : "s"} — customer is enjoying service without paying`
      : `${formatKes(outstandingBalance)} open on Zoho while TISP service is active`;
    add({
      status: "connected_without_payment",
      code: hasOverdue ? "zoho_overdue_tisp_active" : "zoho_outstanding_tisp_active",
      severity: "critical",
      message: `Zoho: ${zohoLabel} · TISP: ${tispLabel} · Account: Active — ${freeServiceDetail}`,
      recommendations: [
        rec("disconnect_service", "Suspend TISP until Zoho balance is cleared"),
        rec(
          "contact_customer",
          hasOverdue
            ? `Collect ${formatKes(outstandingBalance)} overdue or verify payment allocation`
            : `Collect ${formatKes(outstandingBalance)} or verify payment allocation`
        ),
      ],
    });
  }

  // ── CRITICAL: Account cancelled but TISP still active ──
  if (accountCancelled && serviceActive) {
    add({
      status: "cancelled_still_active",
      code: "cancelled_tisp_active",
      severity: "critical",
      message: `Account: Cancelled · TISP: ${tispLabel} — service should be disconnected`,
      recommendations: [rec("disconnect_service", "Customer account is cancelled")],
    });
  }

  // ── CRITICAL: No Zoho balance + TISP disconnected = not receiving expected service ──
  if (
    serviceDisconnected &&
    !hasOutstanding &&
    accountActive &&
    !statuses.includes("disconnected_not_invoiced")
  ) {
    const billingLabel =
      ctx.lastMpesa || ctx.lastZoho ? "Zoho: Paid up" : "Zoho: No open balance";
    add({
      status: "paid_but_disconnected",
      code: "zoho_paid_tisp_suspended",
      severity: "critical",
      message: `${billingLabel} · TISP: ${tispLabel} — customer is not receiving service despite settled billing`,
      recommendations: [
        rec("reconnect_service", "Restore TISP after confirming Zoho invoices are fully paid"),
        rec("refresh_tisp_status", "Verify suspension is not a stale TISP sync"),
      ],
    });
  }

  // ── HIGH: Active customer with no Zoho link ──
  if (accountActive && !billedViaAgency && !zohoLinked && !zohoError) {
    add({
      status: "no_zoho_link",
      code: "active_no_zoho_contact",
      severity: "high",
      message: `Account: Active · Zoho: Not linked — customer cannot be billed in Zoho Books`,
      recommendations: [rec("link_zoho_contact", "Create or link Zoho contact for this customer")],
    });
  }

  // ── HIGH: Recent M-Pesa not allocated while invoices open ──
  if (recentUnmatchedMpesa.length && (hasOutstanding || openInvoiceCount > 0)) {
    add({
      status: "payment_under_review",
      code: "mpesa_pending_allocation",
      severity: "high",
      message: `M-Pesa: ${formatKes(recentUnmatchedMpesa[0].amount)} received (${recentUnmatchedMpesa[0].referenceId || "no ref"}) · Zoho: ${zohoLabel} — payment not applied to invoice`,
      recommendations: [
        rec("allocate_payment", "Match M-Pesa receipt to open Zoho invoice"),
        rec("investigate_payment"),
      ],
    });
  }

  if (unmatchedMpesa.length && !recentUnmatchedMpesa.length) {
    add({
      status: "unmatched_payment",
      code: "unmatched_mpesa",
      severity: "medium",
      message: `${unmatchedMpesa.length} M-Pesa payment(s) not allocated in Zoho`,
      recommendations: [rec("allocate_payment"), rec("investigate_payment")],
    });
  }

  if (detectFrequencyMismatch(customer, lastPaymentAmount, monthlyPrice)) {
    add({
      status: "billing_frequency_mismatch",
      code: "billing_frequency_mismatch",
      severity: "high",
      message: `Paid ${formatKes(lastPaymentAmount)} (monthly rate) but billing frequency is ${customer.paymentFrequency} (expected ${formatKes(expectedAmount)})`,
      recommendations: [
        rec("correct_billing_frequency"),
        rec("contact_customer", "Confirm intended billing cycle"),
      ],
    });
  }

  if (partialInvoices.length) {
    const oldest = partialInvoices[0];
    add({
      status: "partial_payment",
      code: "partial_invoice",
      severity: "medium",
      message: `Zoho: Invoice ${oldest.invoiceNumber || oldest.id} partially paid — ${formatKes(oldest.balanceDue)} remaining of ${formatKes(oldest.total)}`,
      recommendations: [
        rec("contact_customer", "Collect remaining balance or adjust billing frequency"),
        rec("resume_recurring_invoice", "Overdue partial pay may have stopped recurring billing"),
      ],
    });
  }

  // Monthly customer paid an earlier cycle then left a later raised invoice unpaid.
  if (skippedPayment?.skipped && accountActive) {
    add({
      status: "skipped_payment",
      code: skippedPayment.code || "skipped_monthly_cycle",
      severity: "high",
      message: `Zoho: ${skippedPayment.message} · TISP: ${tispLabel}`,
      recommendations: [
        rec(
          "contact_customer",
          skippedPayment.unpaidBalance
            ? `Collect skipped month balance of ${formatKes(skippedPayment.unpaidBalance)}`
            : "Follow up on the skipped monthly payment"
        ),
        rec("investigate_payment", "Confirm no unallocated M-Pesa covers this invoice"),
      ],
    });
  }

  if (hasOverdue && serviceActive && !statuses.includes("connected_without_payment")) {
    add({
      status: "overdue",
      code: "zoho_overdue",
      severity: "medium",
      message: `Zoho: ${overdueCount} overdue invoice(s) totalling ${formatKes(outstandingBalance)} · TISP: ${tispLabel}`,
      recommendations: [rec("contact_customer", "Send overdue payment reminder")],
    });
  } else if (hasOutstanding && !hasOverdue && accountActive && !statuses.includes("connected_without_payment")) {
    add({
      status: "overdue",
      code: "zoho_outstanding",
      severity: "medium",
      message: `Zoho: ${formatKes(outstandingBalance)} open balance · TISP: ${tispLabel}`,
      recommendations: [rec("contact_customer")],
    });
  }

  if (!billedViaAgency && recurring.stopped && accountActive) {
    add({
      status: "recurring_invoice_stopped",
      code: "recurring_stopped",
      severity: "high",
      message: `Zoho: Recurring invoice ${recurring.reason === "no_recurring_invoice" ? "missing" : "inactive"} — future billing may stop`,
      recommendations: [rec("resume_recurring_invoice")],
    });
  }

  if (!billedViaAgency && detectMissingInvoice(customer, invoices, recurring) && accountActive) {
    add({
      status: "missing_invoice",
      code: "missing_invoice",
      severity: "medium",
      message: `Zoho: No invoice for current billing period · TISP: ${tispLabel} · Expected ${formatKes(expectedAmount)} ${customer.paymentFrequency}`,
      recommendations: [
        rec(
          "generate_missing_invoice",
          billedViaAgency
            ? `Create via agency ${agencyName || "Agencies"} module`
            : "Generate or restart recurring invoice in Zoho"
        ),
      ],
    });
  }

  // ── HIGH: TISP disconnected (due date passed) but no Zoho invoice for current billing period ──
  if (
    serviceDisconnected &&
    accountActive &&
    !billedViaAgency &&
    zohoLinked &&
    !statuses.includes("paid_but_disconnected")
  ) {
    const duePassed = isTispDueDatePassed(tispDueDate);
    const noCurrentInvoice = !hasInvoiceForCurrentPeriod(customer, invoices);
    const invoicedButUnpaid = openInvoiceCount > 0;

    if (
      noCurrentInvoice &&
      !invoicedButUnpaid &&
      (duePassed === true || (duePassed === null && !ctx.lastMpesa && !ctx.lastZoho))
    ) {
      const dueLabel = formatShortDate(tispDueDate);
      const freqLabel = String(customer.paymentFrequency || "monthly").toLowerCase();
      add({
        status: "disconnected_not_invoiced",
        code: "tisp_suspended_no_current_invoice",
        severity: "high",
        message: dueLabel
          ? `TISP: Suspended (due ${dueLabel}) · Zoho: No ${freqLabel} invoice for current period`
          : `TISP: Suspended · Zoho: No ${freqLabel} invoice for current period — service off before billing`,
        recommendations: [
          rec(
            "generate_missing_invoice",
            "Create invoice for the current billing period, then review reconnect"
          ),
          rec("contact_customer"),
        ],
      });
    }
  }

  const periodDays = expectedBillingPeriodDays(
    customer.paymentFrequency,
    customer.customPeriodDays
  );
  const daysSincePay = daysSince(customer.lastPaymentDate);
  if (
    accountActive &&
    serviceActive &&
    !hasOutstanding &&
    daysSincePay != null &&
    daysSincePay > periodDays + 3 &&
    openInvoiceCount === 0 &&
    !billedViaAgency
  ) {
    add({
      status: "stale_billing",
      code: "billing_period_elapsed",
      severity: "medium",
      message: `Last payment ${daysSincePay} days ago (>${periodDays}d period) · TISP: ${tispLabel} · No open Zoho invoice`,
      recommendations: [
        rec("generate_missing_invoice", "Invoice may not have been generated"),
        rec("contact_customer"),
      ],
    });
  }

  if (serviceDisconnected && !recurring.stopped && accountActive && !billedViaAgency) {
    validations.push({
      code: "suspended_still_recurring",
      severity: "medium",
      message: `TISP: ${tispLabel} but Zoho recurring invoice is still active — verify billing should continue`,
    });
  }

  if (detectDuplicateOpenInvoices(invoices)) {
    validations.push({
      code: "duplicate_open_invoices",
      severity: "medium",
      message: `Zoho: ${openInvoiceCount} open invoices — possible duplicate billing`,
    });
  }

  if (creditBalance > 0 && hasOutstanding) {
    add({
      status: "credit_balance",
      code: "credit_with_outstanding",
      severity: "low",
      message: `Zoho: ${formatKes(creditBalance)} credit AND ${formatKes(outstandingBalance)} outstanding — apply credit or review invoices`,
      recommendations: [rec("manual_review", "Apply customer credit to open invoices")],
    });
  } else if (creditBalance > 0) {
    add({
      status: "credit_balance",
      code: "credit_balance",
      severity: "low",
      message: `Zoho: ${formatKes(creditBalance)} unapplied credit on account`,
      recommendations: [rec("manual_review")],
    });
  }

  if (String(tispSyncStatus || "").toLowerCase() === "failed") {
    add({
      status: "manual_review_required",
      code: "tisp_sync_failed",
      severity: "high",
      message: `TISP: Sync failed — service status may be stale (${tispLabel})`,
      recommendations: [rec("refresh_tisp_status"), rec("manual_review")],
    });
  }

  if (serviceUnknown && accountActive && (hasOutstanding || zohoLinked)) {
    add({
      status: "manual_review_required",
      code: "tisp_status_unknown",
      severity: "medium",
      message: `TISP: Not on TISP · Zoho: ${zohoLabel} - cannot confirm service matches billing`,
      recommendations: [rec("refresh_tisp_status")],
    });
  }

  if (zohoError) {
    add({
      status: "manual_review_required",
      code: "zoho_sync_error",
      severity: "medium",
      message: `Zoho: Sync error — ${zohoError}`,
      recommendations: [rec("manual_review")],
    });
  }

  if (tispError) {
    validations.push({
      code: "tisp_sync_error",
      severity: "medium",
      message: `TISP: ${tispError}`,
    });
  }

  if (recentUnmatchedMpesa.length && serviceActive && hasOutstanding) {
    if (!statuses.includes("payment_under_review")) {
      add({
        status: "payment_under_review",
        code: "paid_service_overdue_check_allocation",
        severity: "high",
        message: `Recent M-Pesa may cover overdue balance — verify allocation before disconnecting · Zoho: ${zohoLabel}`,
        recommendations: [
          rec("allocate_payment"),
          rec("leave_service_active", "If payment confirms, keep service active"),
        ],
      });
    }
  }

  return { statuses, validations, scenarioRecs };
}

function buildRecommendations(statuses, context, scenarioRecs = []) {
  const recs = [...scenarioRecs];
  const add = (key, detail) => {
    if (!recs.some((r) => r.action === key)) {
      recs.push({
        action: key,
        label: RECOMMENDATION_ACTIONS[key] || key,
        detail: detail || null,
      });
    }
  };

  if (!recs.length) {
    if (statuses.includes("connected_without_payment")) add("disconnect_service");
    if (statuses.includes("paid_but_disconnected")) add("reconnect_service");
    if (statuses.includes("unmatched_payment")) add("allocate_payment");
    if (statuses.includes("overdue")) add("contact_customer", "Send payment reminder");
    if (statuses.includes("skipped_payment")) {
      add("contact_customer", "Follow up on skipped monthly payment");
    }
  }

  if (statuses.includes("connected_without_payment") && context.hasRecentPayment) {
    add("leave_service_active", "Recent payment detected — verify allocation first");
  }

  if (!recs.length && (statuses.includes("current") || statuses.includes("paid"))) {
    recs.push({
      action: "leave_service_active",
      label: RECOMMENDATION_ACTIONS.leave_service_active,
      detail: "Billing and service status are aligned",
    });
  }

  return recs;
}

function computeCustomerReconciliation(context = {}) {
  const customer = context.customer || {};
  const customerType = String(
    customer.customerType || customer.customer_type || ""
  ).toUpperCase();
  const billedViaAgency =
    context.billedViaAgency === true || customerType === "B2B";
  const agencyName = context.agencyName || customer.agencyName || null;

  const invoices = context.invoices || [];
  const mpesaPayments = context.mpesaPayments || [];
  const zohoPayments = context.zohoPayments || [];
  const recurringInvoices = context.recurringInvoices || [];
  const monthlyPrice = context.monthlyPrice ?? customer.monthlyPrice ?? null;
  const accountStatus = context.accountStatus ?? customer.status ?? null;
  const zohoLinked = context.zohoLinked === true;
  const tispSyncStatus = context.tispSyncStatus ?? customer.tispSyncStatus ?? null;

  const subscriptionStatus =
    customer.subscriptionStatus || customer.subscription_status || "Not on TISP";
  const outstandingBalance = roundMoney(
    context.outstandingBalance ??
      invoices.reduce((sum, inv) => sum + roundMoney(inv.balanceDue ?? inv.balance ?? 0), 0)
  );
  const expectedAmount = roundMoney(customer.packagePrice ?? 0);
  const overdueInvoices = invoices.filter(isOverdueZohoInvoice);
  const overdueCount = overdueInvoices.length;
  const openInvoices = invoices.filter((inv) => roundMoney(inv.balanceDue ?? 0) > 0);
  const openInvoiceCount = openInvoices.length;

  const lastMpesa = mpesaPayments[0];
  const lastZoho = zohoPayments[0];
  const lastPaymentAmount = roundMoney(
    lastMpesa?.amount ?? lastZoho?.amount ?? context.lastPaymentAmount ?? 0
  );

  const unmatchedMpesa = mpesaPayments.filter((p) => !p.matchedToZoho);
  const recentUnmatchedMpesa = unmatchedMpesa.filter(
    (p) => daysSince(p.paidAt) != null && daysSince(p.paidAt) <= 14
  );

  const recurring = billedViaAgency
    ? { stopped: false, reason: null }
    : detectRecurringStopped(recurringInvoices);

  const partialInvoices = invoices.filter((inv) => {
    const total = roundMoney(inv.total ?? 0);
    const bal = roundMoney(inv.balanceDue ?? inv.balance ?? 0);
    return bal > 0 && bal < total;
  });

  const skippedPayment = detectSkippedMonthlyPayment({
    customer: {
      ...customer,
      status: accountStatus ?? customer.status,
    },
    invoices,
    zohoPayments,
    mpesaPayments,
  });

  const serviceActive = isActiveService(subscriptionStatus);
  const serviceDisconnected = isDisconnectedService(subscriptionStatus);
  const serviceUnknown = isUnknownService(subscriptionStatus);
  const creditBalance = roundMoney(context.creditBalance ?? 0);

  const { statuses, validations, scenarioRecs } = detectBillingScenarios({
    customer,
    subscriptionStatus,
    accountStatus,
    serviceActive,
    serviceDisconnected,
    serviceUnknown,
    outstandingBalance,
    overdueInvoices,
    overdueCount,
    openInvoiceCount,
    expectedAmount,
    lastPaymentAmount,
    monthlyPrice,
    invoices,
    mpesaPayments,
    lastMpesa,
    lastZoho,
    unmatchedMpesa,
    recentUnmatchedMpesa,
    recurring,
    billedViaAgency,
    agencyName,
    zohoLinked,
    zohoError: context.zohoError,
    tispError: context.tispError,
    tispSyncStatus,
    creditBalance,
    partialInvoices,
    tispDueDate: context.tispDueDate ?? null,
    zohoPayments,
    skippedPayment,
  });

  let finalStatuses = [...statuses];
  if (!finalStatuses.length) {
    if (outstandingBalance <= 0 && (lastMpesa || lastZoho)) {
      finalStatuses.push("paid");
    } else {
      finalStatuses.push("current");
    }
  }

  finalStatuses.sort(
    (a, b) => (STATUS_PRIORITY[b] || 0) - (STATUS_PRIORITY[a] || 0)
  );
  const primaryStatus = finalStatuses[0] || "unknown";

  const recommendations = buildRecommendations(finalStatuses, {
    hasRecentPayment: Boolean(
      lastMpesa && daysSince(lastMpesa.paidAt) != null && daysSince(lastMpesa.paidAt) <= 7
    ),
    billedViaAgency,
    agencyName,
  }, scenarioRecs);

  validations.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  const revenueAtRisk =
    finalStatuses.includes("connected_without_payment") ? outstandingBalance : 0;

  const lastInvoiceDate = latestDateString(invoices.map((inv) => inv.date));
  const lastPaymentDate = latestDateString([
    ...mpesaPayments.map((p) => p.paidAt),
    ...zohoPayments.map((p) => p.paidAt),
  ]);

  return {
    primaryStatus,
    statuses: finalStatuses,
    validations,
    recommendations,
    metrics: {
      expectedAmount,
      monthlyPrice: monthlyPrice != null ? roundMoney(monthlyPrice) : null,
      amountPaid: lastPaymentAmount,
      outstandingBalance,
      creditBalance,
      billingFrequency: customer.paymentFrequency || "monthly",
      customPeriodDays: customer.customPeriodDays ?? null,
      subscriptionStatus: normalizeSubscriptionStatus(subscriptionStatus),
      accountStatus: accountStatus || null,
      tispDueDate: context.tispDueDate ?? null,
      lastInvoiceDate,
      lastPaymentDate,
      serviceActive,
      serviceDisconnected,
      overdueCount,
      unpaidInvoiceCount: openInvoiceCount,
      unmatchedMpesaCount: unmatchedMpesa.length,
      recurringInvoiceActive: !recurring.stopped,
      zohoLinked,
      revenueAtRisk,
      skippedPayment: Boolean(skippedPayment?.skipped),
      skippedInvoiceNumber:
        skippedPayment?.skippedInvoice?.invoiceNumber ||
        skippedPayment?.skippedInvoice?.id ||
        null,
    },
  };
}

function aggregateSummary(records = []) {
  const summary = {
    connectedWithoutPayment: 0,
    paidButDisconnected: 0,
    overdueCustomers: 0,
    partialPayments: 0,
    unmatchedMpesaPayments: 0,
    recurringInvoicesStopped: 0,
    missingInvoices: 0,
    disconnectedNotInvoiced: 0,
    manualReviewsRequired: 0,
    paymentUnderReview: 0,
    cancelledStillActive: 0,
    staleBilling: 0,
    skippedPayments: 0,
    noZohoLink: 0,
    revenueAtRisk: 0,
    totalOutstandingBalance: 0,
    expectedRevenueThisMonth: 0,
    revenueCollectedThisMonth: 0,
    collectionRate: 0,
  };

  for (const record of records) {
    const statuses = record.statuses || [];
    const metrics = record.metrics || {};
    if (statuses.includes("connected_without_payment")) summary.connectedWithoutPayment += 1;
    if (statuses.includes("paid_but_disconnected")) summary.paidButDisconnected += 1;
    if (statuses.includes("overdue")) summary.overdueCustomers += 1;
    if (statuses.includes("partial_payment")) summary.partialPayments += 1;
    if (statuses.includes("unmatched_payment")) summary.unmatchedMpesaPayments += 1;
    if (statuses.includes("recurring_invoice_stopped")) summary.recurringInvoicesStopped += 1;
    if (statuses.includes("missing_invoice")) summary.missingInvoices += 1;
    if (statuses.includes("disconnected_not_invoiced")) summary.disconnectedNotInvoiced += 1;
    if (statuses.includes("manual_review_required")) summary.manualReviewsRequired += 1;
    if (statuses.includes("payment_under_review")) summary.paymentUnderReview += 1;
    if (statuses.includes("cancelled_still_active")) summary.cancelledStillActive += 1;
    if (statuses.includes("stale_billing")) summary.staleBilling += 1;
    if (statuses.includes("skipped_payment")) summary.skippedPayments += 1;
    if (statuses.includes("no_zoho_link")) summary.noZohoLink += 1;
    summary.revenueAtRisk += roundMoney(metrics.revenueAtRisk ?? 0);
    summary.totalOutstandingBalance += roundMoney(metrics.outstandingBalance ?? 0);

    if (String(record.customerStatus || record.customer?.status || "").toLowerCase() !== "cancelled") {
      summary.expectedRevenueThisMonth += roundMoney(metrics.expectedAmount ?? 0);
    }

    for (const payment of record.mpesaPaymentsThisMonth || []) {
      summary.revenueCollectedThisMonth += roundMoney(payment.amount ?? 0);
    }
  }

  if (summary.expectedRevenueThisMonth > 0) {
    summary.collectionRate =
      Math.round(
        (summary.revenueCollectedThisMonth / summary.expectedRevenueThisMonth) * 1000
      ) / 10;
  }

  summary.billingGaps =
    summary.connectedWithoutPayment +
    summary.paidButDisconnected +
    summary.noZohoLink +
    summary.recurringInvoicesStopped +
    summary.missingInvoices +
    summary.disconnectedNotInvoiced +
    summary.skippedPayments;

  return summary;
}

const ISSUE_TILE_DEFINITIONS = [
  { id: "connected_without_payment", label: "Connected Without Payment", severity: "critical" },
  { id: "cancelled_still_active", label: "Cancelled but Still Active", severity: "critical" },
  { id: "paid_but_disconnected", label: "Paid but Disconnected", severity: "critical" },
  { id: "payment_under_review", label: "Payment Pending Allocation", severity: "high" },
  { id: "skipped_payment", label: "Skipped Monthly Payment", severity: "high" },
  { id: "no_zoho_link", label: "Not in Zoho Books", severity: "high" },
  { id: "billing_frequency_mismatch", label: "Billing Frequency Mismatch", severity: "high" },
  { id: "unmatched_payment", label: "Unmatched M-Pesa", severity: "high" },
  { id: "partial_payment", label: "Partial Payments", severity: "medium" },
  { id: "overdue", label: "Overdue", severity: "medium" },
  { id: "stale_billing", label: "Stale Billing", severity: "medium" },
  { id: "recurring_invoice_stopped", label: "Recurring Invoice Stopped", severity: "medium" },
  { id: "missing_invoice", label: "Missing Invoice", severity: "medium" },
  { id: "disconnected_not_invoiced", label: "Disconnected, Not Invoiced", severity: "high" },
  { id: "manual_review_required", label: "Manual Review", severity: "low" },
];

function recordToIssuePreview(record) {
  const topValidation =
    (record.validations || []).find((v) => v.severity === "critical") ||
    (record.validations || []).find((v) => v.severity === "high") ||
    (record.validations || [])[0];
  return {
    customerId: record.customerId,
    customerNumber: record.customerNumber,
    customerName: record.customerName,
    buildingName: record.buildingName || null,
    productName: record.productName || null,
    outstandingBalance: roundMoney(record.metrics?.outstandingBalance ?? 0),
    expectedAmount: roundMoney(record.metrics?.expectedAmount ?? 0),
    amountPaid: roundMoney(record.metrics?.amountPaid ?? 0),
    billingFrequency: record.metrics?.billingFrequency || "monthly",
    subscriptionStatus: record.metrics?.subscriptionStatus || "Not on TISP",
    accountStatus: record.metrics?.accountStatus || record.customerStatus || null,
    actionLabel: record.recommendations?.[0]?.label || null,
    issueBasis:
      topValidation?.message ||
      record.recommendations?.[0]?.detail ||
      record.recommendations?.[0]?.label ||
      null,
    primaryStatus: record.primaryStatus,
  };
}

function buildIssueTiles(records = [], unmatchedMpesa = []) {
  const tiles = ISSUE_TILE_DEFINITIONS.map((def) => {
    const matched = records
      .filter((r) => (r.statuses || []).includes(def.id))
      .sort(
        (a, b) =>
          (STATUS_PRIORITY[b.primaryStatus] || 0) -
          (STATUS_PRIORITY[a.primaryStatus] || 0)
      )
      .map(recordToIssuePreview);

    return {
      id: def.id,
      label: def.label,
      severity: def.severity,
      count: matched.length,
      customers: matched,
    };
  }).filter((t) => t.count > 0);

  if (unmatchedMpesa.length) {
    const existing = tiles.find((t) => t.id === "unmatched_payment");
    if (!existing) {
      tiles.push({
        id: "unmatched_payment",
        label: "Unmatched M-Pesa",
        severity: "high",
        count: unmatchedMpesa.length,
        customers: unmatchedMpesa.slice(0, 20).map((p) => ({
          customerId: null,
          customerNumber: p.accountReference || p.suggestedCustomerNumber || "—",
          customerName: p.referenceId || "Unmatched payment",
          buildingName: null,
          productName: null,
          outstandingBalance: roundMoney(p.amount ?? 0),
          expectedAmount: 0,
          amountPaid: roundMoney(p.amount ?? 0),
          billingFrequency: null,
          subscriptionStatus: null,
          actionLabel: "Allocate Payment",
          issueBasis: `M-Pesa ${p.referenceId || "—"} · ${p.phone || "no phone"} · not linked to Zoho`,
          primaryStatus: "unmatched_payment",
          mpesaPaymentId: p.id,
        })),
      });
    }
  }

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  tiles.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
      b.count - a.count
  );

  return tiles;
}

module.exports = {
  BILLING_STATUSES,
  RECOMMENDATION_ACTIONS,
  STATUS_PRIORITY,
  ISSUE_TILE_DEFINITIONS,
  roundMoney,
  amountsEqual,
  computeCustomerReconciliation,
  aggregateSummary,
  buildIssueTiles,
  recordToIssuePreview,
  detectMissingInvoice,
  hasInvoiceForCurrentPeriod,
  isTispDueDatePassed,
  detectBillingScenarios,
  detectSkippedMonthlyPayment,
  isActiveService,
  isDisconnectedService,
  isUnknownService,
};
