const moment = require("moment-timezone");
const { postSetISPPayment } = require("../controllers/tisp.controller");
const customerStore = require("./customerModuleStore");
const oltEmsService = require("./oltEmsService");
const { logActivity } = require("./activityLogStore");
const { formatDateOnly } = require("../utils/lastPaymentDate");
const { DEFAULT_TZ } = require("../utils/billingPeriod");

const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE || "";

function normalizeMsisdn(msisdn) {
  const s = String(msisdn || "");
  if (/^2547\d{8}$/.test(s)) return `0${s.slice(3)}`;
  return s;
}

/** Notify TISP that a subscription payment was received (M-Pesa, Zoho Books, etc.). */
function buildExternalTispPaymentPayload({
  customerNumber,
  amount,
  referenceId,
  source = "External",
  phone = "",
}) {
  const ref = String(referenceId || `EXT-${Date.now()}`);
  return {
    TransactionType: source === "M-Pesa" ? "Paybill" : "Credit Card",
    TransID: ref,
    TransTime: moment.tz(DEFAULT_TZ).format("YYYYMMDDHHmmss"),
    TransAmount: String(amount ?? "0"),
    BusinessShortCode: String(MPESA_SHORTCODE || ""),
    BillRefNumber: String(customerNumber || ""),
    InvoiceNumber: String(customerNumber || ""),
    OrgAccountBalance: "0",
    ThirdPartyTransID: ref,
    MSISDN: normalizeMsisdn(phone),
    FirstName: "",
  };
}

function resolveCustomerNumberFromInvoice(invoice) {
  const ref = String(invoice.reference_number || "").trim();
  if (ref) {
    const embedded = ref.match(/\b([A-Z]{2,4}-[A-Z0-9]+)\b/i);
    if (embedded) return embedded[1].toUpperCase();
    if (/^[A-Z]{2,4}-/i.test(ref)) return ref.toUpperCase();
  }
  const name = String(invoice.customer_name || "").trim();
  if (/^[A-Z]{2,4}-/i.test(name)) return name.toUpperCase();
  return ref || name || null;
}

/**
 * Reconcile a received payment: update local records and extend TISP via SetISPPayment.
 * Zoho invoice marking is handled by the caller (M-Pesa flow / Zoho webhook).
 */
async function handleSubscriptionPaymentReceived({
  customerNumber,
  amount,
  paymentDate,
  referenceId,
  source = "External",
  phone = "",
  skipTisp = false,
  meta = {},
}) {
  const accountRef = String(customerNumber || "").trim().toUpperCase();
  if (!accountRef) {
    return { ok: false, reason: "missing_customer_number" };
  }

  const paidOn = formatDateOnly(paymentDate) || moment.tz(DEFAULT_TZ).format("YYYY-MM-DD");

  const customerRow = await customerStore.findCustomerByNumber(accountRef);
  let subscriptionStatus = null;
  let skipTispForDstvOnly = false;
  if (customerRow?.id) {
    const ctx = await customerStore.getCustomerContext(customerRow.id);
    subscriptionStatus = ctx?.subscription_status;
    const { isDstvOnlyCategory } = require("./packageCatalogStore");
    skipTispForDstvOnly =
      isDstvOnlyCategory(ctx?.category_code) ||
      isDstvOnlyCategory(ctx?.category_name);
  }

  await customerStore.recordCustomerLastPayment(accountRef, paidOn);

  let tispOk = false;
  let tispError = null;
  let olt = { ok: true, skipped: true, reason: "not_checked" };

  const effectiveSkipTisp = skipTisp || skipTispForDstvOnly;
  if (!effectiveSkipTisp && Number(amount) > 0) {
    const payload = buildExternalTispPaymentPayload({
      customerNumber: accountRef,
      amount,
      referenceId,
      source,
      phone,
    });
    try {
      await postSetISPPayment(payload, {
        customerNumber: accountRef,
        referenceId,
        amount,
        channel: source,
        parentLogId: meta.parentLogId ?? null,
      });
      tispOk = true;
    } catch (e) {
      tispError = e.message || "TISP payment notification failed";
    }
  } else if (skipTispForDstvOnly) {
    tispOk = true;
  }

  if (
    customerRow?.id &&
    tispOk &&
    !skipTispForDstvOnly &&
    oltEmsService.shouldActivateOnPayment(subscriptionStatus)
  ) {
    const ctx = await customerStore.getCustomerContext(customerRow.id);
    olt = await oltEmsService.activateOnuForCustomer(ctx, {
      customerId: customerRow.id,
      customerNumber: accountRef,
    });
  }

  try {
    await logActivity({
      eventType: tispOk ? "subscription_payment_reconciled" : "subscription_payment_partial",
      title: tispOk
        ? skipTispForDstvOnly
          ? "DSTV Only payment recorded (Zoho)"
          : "Subscription payment reconciled"
        : "Payment recorded (TISP sync failed)",
      message: tispOk
        ? skipTispForDstvOnly
          ? `${accountRef}: ${source} payment applied — DSTV Only (no TISP)`
          : `${accountRef}: ${source} payment applied — service extended`
        : `${accountRef}: ${tispError || "TISP update pending"}`,
      source: source.toLowerCase().includes("zoho") ? "zoho" : "mpesa",
      status: tispOk && (olt.ok || olt.skipped) ? "success" : "failed",
      customerRef: accountRef,
      amount: amount != null ? Number(amount) : null,
      referenceId: referenceId ? String(referenceId) : null,
    });
  } catch (e) {
    console.error("payment reconciliation activity log failed:", e.message);
  }

  return {
    ok: (tispOk || effectiveSkipTisp) && (olt.ok || olt.skipped),
    tispOk,
    tispError,
    olt,
    customerNumber: accountRef,
    paymentDate: paidOn,
  };
}

module.exports = {
  buildExternalTispPaymentPayload,
  resolveCustomerNumberFromInvoice,
  handleSubscriptionPaymentReceived,
};
