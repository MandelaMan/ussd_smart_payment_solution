const moment = require("moment-timezone");
const { postSetISPPayment } = require("../controllers/tisp.controller");
const customerStore = require("./customerModuleStore");
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
  await customerStore.recordCustomerLastPayment(accountRef, paidOn);

  let tispOk = false;
  let tispError = null;

  if (!skipTisp && Number(amount) > 0) {
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
  }

  try {
    await logActivity({
      eventType: tispOk ? "subscription_payment_reconciled" : "subscription_payment_partial",
      title: tispOk ? "Subscription payment reconciled" : "Payment recorded (TISP sync failed)",
      message: tispOk
        ? `${accountRef}: ${source} payment applied — service extended`
        : `${accountRef}: ${tispError || "TISP update pending"}`,
      source: source.toLowerCase().includes("zoho") ? "zoho" : "mpesa",
      status: tispOk ? "success" : "failed",
      customerRef: accountRef,
      amount: amount != null ? Number(amount) : null,
      referenceId: referenceId ? String(referenceId) : null,
    });
  } catch (e) {
    console.error("payment reconciliation activity log failed:", e.message);
  }

  return {
    ok: tispOk || skipTisp,
    tispOk,
    tispError,
    customerNumber: accountRef,
    paymentDate: paidOn,
  };
}

module.exports = {
  buildExternalTispPaymentPayload,
  resolveCustomerNumberFromInvoice,
  handleSubscriptionPaymentReceived,
};
