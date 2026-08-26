const customerStore = require("./customerModuleStore");
const { formatDateOnly } = require("../utils/lastPaymentDate");
const {
  addCalendarDays,
  resolveStoredPauseCredit,
} = require("../utils/pauseCredit");
const { computeServiceDueDate } = require("../utils/billingPeriod");
const { logActivity } = require("./activityLogStore");

function paymentAnchorDate(customer, paymentDate) {
  return (
    formatDateOnly(paymentDate) ||
    formatDateOnly(customer?.lastPaymentDate || customer?.last_payment_date) ||
    formatDateOnly(new Date())
  );
}

async function applyPendingPauseCredit(customerId, { paymentDate } = {}) {
  const id = Number(customerId);
  if (!id) return { skipped: true, reason: "missing_customer" };

  const customer = await customerStore.getCustomerById(id);
  if (!customer) return { skipped: true, reason: "not_found" };

  const credit = resolveStoredPauseCredit(customer);
  if (!credit.pending || credit.creditDays <= 0) {
    return { skipped: true, reason: credit.applied ? "already_applied" : "no_credit" };
  }

  const ctx = await customerStore.getCustomerContext(id);
  const { isDstvOnlyCategory } = require("./packageCatalogStore");
  const dstvOnly =
    isDstvOnlyCategory(ctx?.category_code) || isDstvOnlyCategory(ctx?.category_name);

  const periodEnd = computeServiceDueDate({
    anchorDate: paymentAnchorDate(customer, paymentDate),
    paymentFrequency: ctx?.payment_frequency || customer.paymentFrequency || "monthly",
    customPeriodDays:
      ctx?.custom_period_days ?? customer.customPeriodDays ?? null,
  });
  const newDue = addCalendarDays(periodEnd, credit.creditDays) || periodEnd;

  let tisp = { skipped: true, reason: dstvOnly ? "dstv_only" : "not_pushed" };
  if (!dstvOnly) {
    try {
      const { extendTispDueDateForCustomer } = require("../controllers/customers.controller");
      tisp = await extendTispDueDateForCustomer(ctx, newDue);
    } catch (e) {
      tisp = { ok: false, skipped: false, error: e.message || "TISP due extend failed" };
    }
  }

  await customerStore.markPauseCreditApplied(id, newDue);

  try {
    await logActivity({
      eventType: "subscription_payment_reconciled",
      title: "Pause days credited",
      message: [
        customer.customerNumber,
        `${credit.creditDays} day${credit.creditDays === 1 ? "" : "s"} added to the next subscription`,
        newDue ? `due ${newDue}` : null,
        tisp.error || null,
      ]
        .filter(Boolean)
        .join(" · "),
      source: "admin",
      status: tisp.ok === false ? "failed" : "success",
      customerRef: customer.customerNumber,
    });
  } catch (e) {
    console.warn("pause credit activity log failed:", e.message);
  }

  return {
    ok: tisp.ok !== false,
    creditDays: credit.creditDays,
    newDue,
    tisp,
    customer: await customerStore.getCustomerById(id),
  };
}

async function applyPendingPauseCreditForAccount(customerNumber, options = {}) {
  const ref = String(customerNumber || "").trim();
  if (!ref) return { skipped: true, reason: "missing_customer_number" };
  const row = await customerStore.resolveCustomerByPaybillRef(ref, {
    msisdn: options.msisdn || options.phone,
  });
  if (!row?.id) return { skipped: true, reason: "customer_not_found" };
  return applyPendingPauseCredit(row.id, options);
}

async function applyPendingPauseCreditSafe(customerId, options = {}) {
  try {
    return await applyPendingPauseCredit(customerId, options);
  } catch (e) {
    console.warn("pause credit apply failed:", e.message);
    return { ok: false, error: e.message || "pause credit failed" };
  }
}

async function applyPendingPauseCreditForAccountSafe(customerNumber, options = {}) {
  try {
    return await applyPendingPauseCreditForAccount(customerNumber, options);
  } catch (e) {
    console.warn("pause credit apply failed:", e.message);
    return { ok: false, error: e.message || "pause credit failed" };
  }
}

module.exports = {
  applyPendingPauseCredit,
  applyPendingPauseCreditSafe,
  applyPendingPauseCreditForAccount,
  applyPendingPauseCreditForAccountSafe,
};
