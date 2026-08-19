// controllers/mpesa.controller.js
/* eslint-disable no-console */
const moment = require("moment-timezone");
const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const {
  appendTransaction,
  upsertByCheckoutId,
  findLatestTxnByCheckoutOrPhone,
  recordC2BConfirmation,
  updateAccountReferenceById,
} = require("../services/transactionStore");
const { logSetIspPaymentAttempt } = require("../utils/tispSetIspLogger");
const { insertIntegrationEvent } = require("../services/integrationEventStore");
const { logActivity } = require("../services/activityLogStore");
const { logError } = require("../utils/errorLogger");
const { appendJsonLine, readJsonLineEntries } = require("../utils/appendJsonLine");
const pendingUpgradeStore = require("../services/pendingUpgradeStore");
const customerStore = require("../services/customerModuleStore");
const { isB2BCustomer, resolveAgencyForCustomer, filterAgencyInvoicesForCustomer } = require("../utils/b2bBilling");
const {
  roundMoney,
  amountsEqual,
  invoiceOutstandingBalance,
  findTargetOpenInvoice,
} = require("../utils/mpesaInvoiceMatching");
const { planInvoicePayment } = require("../utils/mpesaPaymentPlan");
const { isValidPaybillAccountRef, normalizePaybillAccountRef } = require("../utils/customerNumber");

// 👇 ADD: import Zoho helpers (adjust path if needed)
const {
  getCustomerByCompanyName_JS,
  createInvoice_JS,
  getInvoices_JS,
  markInvoiceAsPaid_JS,
  resolveMpesaDepositAccountId_JS,
} = require("./zoho.controller"); // or "../zoho/zoho.controller" etc.
const { postSetISPPayment, getTISPCustomer } = require("./tisp.controller");
const { ISP_PAYMENT_URL } = require("../utils/tispUrls");
const { normalizeSubscriptionStatus } = require("../utils/subscriptionStatus");

/* ================================================================== */
/*                         ENV & CONSTANTS                            */
/* ================================================================== */
const NODE_ENV = process.env.NODE_ENV || "development";
const TZ = "Africa/Nairobi";

/** Daraja (env-driven, defaults to sandbox) */
const TOKEN_URL =
  process.env.TOKEN_URL ||
  "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";
const STK_PUSH_ENDPOINT =
  process.env.STK_PUSH_ENDPOINT ||
  "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

/** C2B (register/simulate available only on sandbox) */
const C2B_REGISTER_URL =
  process.env.MPESA_C2B_REGISTER_URL ||
  "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl";
const C2B_SIMULATE_URL =
  process.env.MPESA_C2B_SIMULATE_URL ||
  "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/simulate";

/** Shortcode & callback URLs */
const MPESA_SHORTCODE = process.env.MPESA_SHORTCODE;
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL;
const MPESA_CONFIRMATION_URL = process.env.MPESA_CONFIRMATION_URL;
const MPESA_VALIDATION_URL = process.env.MPESA_VALIDATION_URL;

/** ISP endpoints — URL resolved in ../utils/tispUrls (HTTP only) */
const B2C_ENDPOINT =
  process.env.MPESA_B2C_ENDPOINT ||
  "https://sandbox.safaricom.co.ke/mpesa/b2c/v1/paymentrequest";
const B2C_COMMAND_ID = process.env.MPESA_B2C_COMMAND_ID || "BusinessPayment";
const B2C_PARTY_A = process.env.MPESA_B2C_PARTY_A || MPESA_SHORTCODE;
const B2C_TIMEOUT_URL =
  process.env.MPESA_B2C_TIMEOUT_URL ||
  "https://app.sulsolutions.biz/api/payment/b2c/timeout";
const B2C_RESULT_URL =
  process.env.MPESA_B2C_RESULT_URL ||
  "https://app.sulsolutions.biz/api/payment/b2c/result";
const B2C_REMARKS = process.env.MPESA_B2C_REMARKS || "Revenue share payout";
const B2C_OCCASION = process.env.MPESA_B2C_OCCASION || "Transaction split";
const B2C_ORIGINATOR_CONVERSATION_ID =
  process.env.MPESA_B2C_ORIGINATOR_CONVERSATION_ID || "";
const B2C_INITIATOR_NAME = process.env.MPESA_B2C_INITIATOR_NAME || "";
const B2C_SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL || "";

/** M-Pesa / paybill amounts are VAT-inclusive; do not add tax on top of the rate. */
const ZOHO_INVOICE_TAX_INCLUSIVE =
  String(process.env.ZOHO_INVOICE_TAX_INCLUSIVE || "true").toLowerCase() !== "false";
const ZOHO_VAT_TAX_ID = process.env.ZOHO_VAT_TAX_ID || null;

/* ================================================================== */
/*                       FILE STORAGE (light)                          */
/* ================================================================== */
const LOGS_DIR = path.resolve(__dirname, "../../logs");
const SUBS_FILE = path.join(LOGS_DIR, "updatedSubscriptions.json");
const SUBS_TRAIL_FILE = path.join(LOGS_DIR, "updatedSubscriptions-trail.jsonl");
const SPLIT_CONFIG_FILE = path.join(LOGS_DIR, "transactionSplitConfig.json");
const SPLIT_LOG_FILE = path.join(LOGS_DIR, "transactionSplits.jsonl");
const SPLIT_LOG_LEGACY = path.join(LOGS_DIR, "transactionSplits.json");
let _splitLegacyMigrated = false;
let _splitMigratePromise = null;
async function migrateSplitLogLegacyOnce() {
  if (_splitLegacyMigrated) return;
  if (!_splitMigratePromise) {
    _splitMigratePromise = (async () => {
      try {
        const st = await fs.stat(SPLIT_LOG_FILE).catch(() => null);
        if (st && st.size > 0) return;
        const raw = await fs.readFile(SPLIT_LOG_LEGACY, "utf8");
        const arr = JSON.parse(raw || "[]");
        if (!Array.isArray(arr) || !arr.length) return;
        await fs.mkdir(LOGS_DIR, { recursive: true });
        let blob = "";
        for (const row of arr) {
          blob += JSON.stringify(row) + "\n";
        }
        await fs.appendFile(SPLIT_LOG_FILE, blob, "utf8");
        await fs.rename(SPLIT_LOG_LEGACY, SPLIT_LOG_LEGACY + ".bak").catch(() => {});
      } catch {
        /* no legacy */
      } finally {
        _splitLegacyMigrated = true;
      }
    })();
  }
  await _splitMigratePromise;
}

// tiny in-process write queue for updatedSubscriptions.json
let _subsQueue = Promise.resolve();
function queueSubsWrite(task) {
  _subsQueue = _subsQueue
    .then(task)
    .catch((e) => console.error("updatedSubscriptions write err:", e));
  return _subsQueue;
}

let _splitQueue = Promise.resolve();
function queueSplitWrite(task) {
  _splitQueue = _splitQueue
    .then(task)
    .catch((e) => console.error("transactionSplit write err:", e));
  return _splitQueue;
}

async function ensureSubsFile() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  try {
    await fs.access(SUBS_FILE);
  } catch {
    await fs.writeFile(SUBS_FILE, "[]", "utf8");
  }
}

async function rebuildSubsFromTrail() {
  const entries = await readJsonLineEntries(SUBS_TRAIL_FILE);
  const byId = new Map();
  for (const row of entries) {
    const rec = row.record || row;
    const id = rec?.transactionId;
    if (id) byId.set(String(id), rec);
  }
  return Array.from(byId.values());
}

async function readSubsRaw() {
  await ensureSubsFile();
  return fs.readFile(SUBS_FILE, "utf8");
}

async function readSubs() {
  let raw = "[]";
  try {
    raw = await readSubsRaw();
  } catch {
    /* new file */
  }

  let parsed = null;
  try {
    const arr = JSON.parse(raw || "[]");
    if (Array.isArray(arr)) parsed = arr;
  } catch {
    parsed = null;
  }

  if (parsed && parsed.length > 0) return parsed;

  const fromTrail = await rebuildSubsFromTrail();
  if (fromTrail.length > 0) return fromTrail;

  return Array.isArray(parsed) ? parsed : [];
}

async function ensureSplitConfigFile() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  try {
    await fs.access(SPLIT_CONFIG_FILE);
  } catch {
    const defaults = { enabled: false, recipients: [] };
    await fs.writeFile(SPLIT_CONFIG_FILE, JSON.stringify(defaults, null, 2), "utf8");
  }
}

async function ensureSplitLogFile() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  try {
    await fs.access(SPLIT_LOG_FILE);
  } catch {
    await fs.writeFile(SPLIT_LOG_FILE, "", "utf8");
  }
}

async function readSplitConfig() {
  await ensureSplitConfigFile();
  try {
    const raw = await fs.readFile(SPLIT_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const recipients = Array.isArray(parsed.recipients) ? parsed.recipients : [];
    return { enabled: Boolean(parsed.enabled), recipients };
  } catch {
    return { enabled: false, recipients: [] };
  }
}

async function writeSplitConfig(config) {
  await ensureSplitConfigFile();
  await queueSplitWrite(async () => {
    const tmp = SPLIT_CONFIG_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
    await fs.rename(tmp, SPLIT_CONFIG_FILE);
  });
}

async function readSplitLog() {
  await migrateSplitLogLegacyOnce();
  await ensureSplitLogFile();
  return readJsonLineEntries(SPLIT_LOG_FILE);
}

async function appendSplitLog(entry) {
  await migrateSplitLogLegacyOnce();
  await ensureSplitLogFile();
  await queueSplitWrite(async () => {
    await appendJsonLine(SPLIT_LOG_FILE, {
      loggedAt: new Date().toISOString(),
      ...entry,
    });
  });
}

function normalizeSplitRecipients(recipients) {
  if (!Array.isArray(recipients)) return [];
  return recipients
    .map((r) => ({
      name: String(r?.name || "").trim(),
      phone: String(r?.phone || "").trim(),
      percentage: Number(r?.percentage || 0),
    }))
    .filter((r) => r.phone && Number.isFinite(r.percentage) && r.percentage > 0);
}

function validateSplitConfigInput(input) {
  const enabled = Boolean(input?.enabled);
  const recipients = normalizeSplitRecipients(input?.recipients);
  if (enabled && recipients.length === 0) {
    return { ok: false, error: "At least one recipient is required when split is enabled." };
  }
  const total = recipients.reduce((s, r) => s + r.percentage, 0);
  if (total > 100) {
    return { ok: false, error: "Total percentage cannot exceed 100." };
  }
  return { ok: true, value: { enabled, recipients, totalPercentage: total } };
}

async function writeSubs(all) {
  await ensureSubsFile();
  if (!Array.isArray(all)) throw new Error("writeSubs: expected array");

  const existingRaw = await readSubsRaw().catch(() => "[]");
  let existing = [];
  try {
    const p = JSON.parse(existingRaw || "[]");
    if (Array.isArray(p)) existing = p;
  } catch {
    existing = await rebuildSubsFromTrail();
  }

  if (existing.length > 0 && all.length === 0) {
    console.error(
      `updatedSubscriptions: refused empty write; preserving ${existing.length} record(s)`
    );
    return;
  }

  const merged = new Map();
  for (const row of existing) {
    if (row?.transactionId) merged.set(String(row.transactionId), row);
  }
  for (const row of all) {
    if (row?.transactionId) {
      const id = String(row.transactionId);
      merged.set(id, { ...merged.get(id), ...row });
    }
  }
  const mergedArr = Array.from(merged.values());

  const tmp = SUBS_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(mergedArr, null, 2), "utf8");
  await fs.rename(tmp, SUBS_FILE);
}

/** Upsert a compact snapshot of the last-known transaction/update */
async function upsertUpdatedSubscriptionFull({
  transactionId,
  amount,
  customerAccount,
  rawTx,
  ispPayload,
  source,
}) {
  // Generate a safe fallback ID if we didn't get one (prevents dropping C2B writes)
  const fallbackId = (() => {
    const msisdn = rawTx?.MSISDN || rawTx?.PhoneNumber || "UNKNOWN_MSISDN";
    const t =
      rawTx?.TransID ||
      rawTx?.TransTime ||
      rawTx?.TransactionDate ||
      Date.now();
    return `AUTO-${String(msisdn)}-${String(t)}`;
  })();

  const id = String(transactionId || fallbackId);

  return queueSubsWrite(async () => {
    const all = await readSubs();
    const idx = all.findIndex((x) => x.transactionId === id);
    const base = {
      transactionId: id,
      amount:
        amount != null
          ? String(amount)
          : idx >= 0
          ? all[idx].amount
          : undefined,
      customerAccount:
        customerAccount != null
          ? String(customerAccount)
          : idx >= 0
          ? all[idx].customerAccount
          : undefined,
      source: source || (idx >= 0 ? all[idx].source : undefined),
      lastUpdatedAt: new Date().toISOString(),
      rawTx: rawTx || (idx >= 0 ? all[idx].rawTx : undefined),
      ispPayload: ispPayload || (idx >= 0 ? all[idx].ispPayload : undefined),
    };

    if (idx >= 0) {
      all[idx] = { ...all[idx], ...base };
    } else {
      all.push(base);
    }
    await appendJsonLine(SUBS_TRAIL_FILE, {
      loggedAt: new Date().toISOString(),
      record: base,
    });
    await writeSubs(all);
  });
}

/* ================================================================== */
/*                         M-PESA OAUTH                                */
/* ================================================================== */
const getAccessToken = async () => {
  const secret_key = process.env.MPESA_CONSUMER_SECRET;
  const consumer_key = process.env.MPESA_CONSUMER_KEY;
  if (!secret_key || !consumer_key) {
    throw new Error("MPESA_CONSUMER_KEY/SECRET not configured");
  }

  const auth = Buffer.from(`${consumer_key}:${secret_key}`).toString("base64");
  const config = { headers: { Authorization: `Basic ${auth}` } };

  const { data } = await axios.get(TOKEN_URL, config);
  return data.access_token;
};

/* ================================================================== */
/*                       ISP Payment (external)                        */
/* ================================================================== */

/** Format C2B/Callback Daraja time to "DD MMM YYYY hh:mm A" (Nairobi) */
function formatC2BTime(raw) {
  try {
    if (raw && /^[0-9]{14}$/.test(String(raw))) {
      return moment.tz(raw, "YYYYMMDDHHmmss", TZ).format("DD MMM YYYY hh:mm A");
    }
  } catch (_) {}
  return moment.tz(TZ).format("DD MMM YYYY hh:mm A");
}

function parseMpesaTransactionDate(raw) {
  try {
    const s = String(raw || "").trim();
    if (/^[0-9]{14}$/.test(s)) {
      return moment.tz(s, "YYYYMMDDHHmmss", TZ).format("YYYY-MM-DD");
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = moment(s);
    if (parsed.isValid()) return parsed.tz(TZ).format("YYYY-MM-DD");
  } catch (_) {}
  return moment.tz(TZ).format("YYYY-MM-DD");
}

async function recordLastPaymentForAccount(accountRef, transTime) {
  try {
    await customerStore.recordCustomerLastPayment(
      accountRef,
      parseMpesaTransactionDate(transTime)
    );
  } catch (e) {
    console.error("last payment update failed:", e.message);
  }
}

/**
 * Map a typed paybill BillRefNumber onto the live customer number.
 * Falls back to hyphen-normalized text when no unique customer is found.
 */
async function resolveMpesaAccountRef(rawRef, msisdn) {
  const raw = String(rawRef || "").trim();
  const normalized = normalizePaybillAccountRef(raw) || raw;
  if (!raw) return { raw, canonical: "", customer: null };
  try {
    const customer = await customerStore.resolveCustomerByPaybillRef(raw, {
      msisdn,
    });
    if (customer?.customerNumber) {
      if (customer.customerNumber !== raw.toUpperCase()) {
        console.log("[mpesa] resolved BillRefNumber", {
          typed: raw,
          canonical: customer.customerNumber,
        });
      }
      return { raw, canonical: customer.customerNumber, customer };
    }
  } catch (e) {
    console.warn("[mpesa] customer resolve failed:", e.message);
  }
  return { raw, canonical: normalized, customer: null };
}

/** Convert 2547xxxxxxxx -> 07xxxxxxxx (optional cosmetic) */
function normalizeMsisdn(msisdn) {
  const s = String(msisdn || "");
  if (/^2547\d{8}$/.test(s)) return "0" + s.slice(3);
  return s;
}

/** Build ISP payload from a C2B confirmation */
function buildISPPayloadFromConfirmation(tx) {
  return {
    TransactionType: "Paybill", // as required by the ISP
    TransID: String(tx.TransID || tx.TransRef || ""),
    TransTime: formatC2BTime(tx.TransTime || tx.TransDate),
    TransAmount: String(
      tx.TransAmount || tx.TransactionAmount || tx.amount || "1"
    ),
    BusinessShortCode: String(tx.BusinessShortCode || MPESA_SHORTCODE || ""),
    BillRefNumber: String(tx.BillRefNumber || tx.AccountReference || ""),
    InvoiceNumber: String(tx.InvoiceNumber || tx.BillRefNumber || ""),
    OrgAccountBalance: String(tx.OrgAccountBalance || "0"),
    ThirdPartyTransID: String(tx.ThirdPartyTransID || ""),
    MSISDN: normalizeMsisdn(tx.MSISDN || tx.MSISDNNumber || ""),
    FirstName: String(tx.FirstName || ""),
  };
}

/** M-Pesa CallbackMetadata TransactionDate → YYYYMMDDHHmmss for SetISPPayment */
function formatTransTimeForTISP(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length >= 14) return digits.slice(0, 14);
  return moment.tz(TZ).format("YYYYMMDDHHmmss");
}

/** Build SetISPPayment JSON from a successful STK callback + bill/customer ref. */
function buildISPPayloadFromSTK(transaction, accountRef) {
  const thirdParty = String(
    transaction.CheckoutRequestID ||
      transaction.MerchantRequestID ||
      ""
  );
  return {
    TransactionType: "Credit Card",
    TransID: String(transaction.MpesaReceiptNumber || ""),
    TransTime: formatTransTimeForTISP(transaction.TransactionDate),
    TransAmount: String(transaction.Amount ?? "0"),
    BusinessShortCode: String(MPESA_SHORTCODE || ""),
    BillRefNumber: String(accountRef || ""),
    InvoiceNumber: String(accountRef || ""),
    OrgAccountBalance: "0",
    ThirdPartyTransID: thirdParty,
    MSISDN: normalizeMsisdn(transaction.PhoneNumber || ""),
    FirstName: "",
  };
}

/** Idempotency cache to avoid double-posting to ISP on Daraja retries */
const _postedTransIds = new Set();

async function postISPPayment(payload) {
  const key = String(payload.TransID || payload.ThirdPartyTransID || "");
  if (key && _postedTransIds.has(key)) {
    console.log("ISP already posted for TransID:", key);
    await logSetIspPaymentAttempt({
      outcome: "skipped_duplicate",
      url: ISP_PAYMENT_URL,
      request: payload,
      transKey: key,
    });
    return;
  }
  try {
    console.log("Posting ISP payload:", payload);
    const r = await axios.post(ISP_PAYMENT_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
      validateStatus: () => true, // don't throw on 4xx/5xx automatically
      transformRequest: [(data) => JSON.stringify(data)],
    });
    const ok = r.status >= 200 && r.status < 300;
    await logSetIspPaymentAttempt({
      outcome: ok ? "success" : "failure",
      httpStatus: r.status,
      url: ISP_PAYMENT_URL,
      request: payload,
      response: r.data,
      customerAccount: payload.CustomerAccount || payload.BillRefNumber,
      amount: payload.TransAmount || payload.Amount,
      transactionId: payload.TransID || payload.ThirdPartyTransID,
      channel: "C2B",
    });
    if (!ok) {
      const err = new Error(
        `ISP responded ${r.status}: ${JSON.stringify(r.data)}`,
      );
      err._setIspLogged = true;
      throw err;
    }
    if (key) _postedTransIds.add(key);
    console.log("ISP payment posted:", payload.TransID);
  } catch (e) {
    console.error("ISP payment post failed:", e?.response?.data || e.message);
    if (!e._setIspLogged) {
      await logSetIspPaymentAttempt({
        outcome: "failure",
        httpStatus: e.response?.status ?? null,
        url: ISP_PAYMENT_URL,
        request: payload,
        response: e.response?.data ?? null,
        errorMessage: e.message,
        customerAccount: payload.CustomerAccount || payload.BillRefNumber,
        amount: payload.TransAmount || payload.Amount,
        transactionId: payload.TransID || payload.ThirdPartyTransID,
        channel: "C2B",
      });
    }
    throw e;
  }
}

function normalizeB2CPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return String(phone || "");
}

function computeSplitAmounts(totalAmount, recipients) {
  const n = recipients.length;
  const out = new Array(n).fill(0);
  if (n === 0) return out;
  let assigned = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const a = Math.floor((totalAmount * recipients[i].percentage) / 100);
    out[i] = a;
    assigned += a;
  }
  out[n - 1] = Math.max(0, totalAmount - assigned);
  return out;
}

async function sendB2CPayout({ phone, amount, remarks }) {
  const token = await getAccessToken();
  const payload = {
    OriginatorConversationID:
      B2C_ORIGINATOR_CONVERSATION_ID || `SPLIT-${Date.now()}`,
    InitiatorName: B2C_INITIATOR_NAME,
    SecurityCredential: B2C_SECURITY_CREDENTIAL,
    CommandID: B2C_COMMAND_ID,
    Amount: amount,
    PartyA: B2C_PARTY_A,
    PartyB: normalizeB2CPhone(phone),
    Remarks: remarks || B2C_REMARKS,
    QueueTimeOutURL: B2C_TIMEOUT_URL,
    ResultURL: B2C_RESULT_URL,
    Occasion: B2C_OCCASION,
  };

  const { data, status } = await axios.post(B2C_ENDPOINT, payload, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20_000,
    validateStatus: () => true,
  });
  return { status, data, payload };
}

async function processTransactionSplit({ source, transactionId, totalAmount }) {
  const key = `${source}:${String(transactionId || "")}`;
  if (!transactionId) return;

  const config = await readSplitConfig();
  if (!config.enabled || !config.recipients.length) {
    await appendSplitLog({
      key,
      source,
      transactionId,
      totalAmount,
      outcome: "skipped_disabled",
    });
    return;
  }

  const allLogs = await readSplitLog();
  const already = allLogs.find((x) => x.key === key && x.outcome === "completed");
  if (already) {
    await appendSplitLog({
      key,
      source,
      transactionId,
      totalAmount,
      outcome: "skipped_duplicate",
    });
    return;
  }

  const amountNum = Math.round(Number(totalAmount || 0));
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    await appendSplitLog({
      key,
      source,
      transactionId,
      totalAmount,
      outcome: "invalid_amount",
    });
    return;
  }

  const recipients = normalizeSplitRecipients(config.recipients);
  const splitAmounts = computeSplitAmounts(amountNum, recipients);

  const results = [];
  for (let i = 0; i < recipients.length; i += 1) {
    const r = recipients[i];
    const share = splitAmounts[i];
    if (share <= 0) {
      results.push({ ...r, amount: share, outcome: "skipped_zero" });
      continue;
    }
    try {
      const res = await sendB2CPayout({
        phone: r.phone,
        amount: share,
        remarks: `${B2C_REMARKS} ${source}:${transactionId}`,
      });
      const ok = res.status >= 200 && res.status < 300;
      results.push({
        ...r,
        amount: share,
        httpStatus: res.status,
        response: res.data,
        request: res.payload,
        outcome: ok ? "success" : "failure",
      });
    } catch (e) {
      results.push({
        ...r,
        amount: share,
        outcome: "failure",
        error: e.message,
      });
    }
  }

  const allOk = results.every((r) => r.outcome === "success" || r.outcome === "skipped_zero");
  await appendSplitLog({
    key,
    source,
    transactionId,
    totalAmount: amountNum,
    recipients: results,
    outcome: allOk ? "completed" : "partial_or_failed",
  });
}

/* ================================================================== */
/*                   ZOHO INVOICE INTEGRATION HELPERS                  */
/* ================================================================== */

async function findOpenInvoiceForPayment({
  customerNumber,
  customer_id,
  paymentAmount,
  billedViaAgency = false,
}) {
  let customerInvoices = await getInvoices_JS({
    customer_id,
    per_page: 200,
    page: 1,
  });
  if (billedViaAgency) {
    customerInvoices = filterAgencyInvoicesForCustomer(
      customerInvoices,
      customerNumber
    );
  }
  return findTargetOpenInvoice(customerInvoices, customerNumber, paymentAmount);
}
async function createInvoiceForExactAmount({
  companyName,
  customer_id,
  paymentAmount,
  transactionId,
  source,
  referenceNumber,
  customer,
}) {
  const description = `M-Pesa payment for ${companyName} (Tx: ${
    transactionId || "N/A"
  }) via ${source}`;

  // No item_id — Zoho ignores custom rate and uses catalog price when item_id is set.
  const lineItem = {
    name: `M-Pesa payment - ${companyName}`,
    rate: paymentAmount,
    quantity: 1,
    description,
  };
  if (ZOHO_VAT_TAX_ID) {
    lineItem.tax_id = ZOHO_VAT_TAX_ID;
  }

  return createInvoice_JS({
    customer_id,
    items: [lineItem],
    is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
    reference_number: referenceNumber || companyName,
    customer,
  });
}

async function recordInvoicePayment({
  invoice_id,
  customer_id,
  paymentAmount,
  amountApplied,
  transactionId,
  source,
}) {
  let account_id;
  try {
    account_id = await resolveMpesaDepositAccountId_JS();
  } catch (e) {
    console.warn("M-Pesa Zoho deposit account lookup failed:", e.message);
  }
  if (!account_id) {
    console.warn(
      "M-Pesa Zoho payment has no paybill deposit account_id — Zoho may default to Paystack Funds"
    );
  }
  return markInvoiceAsPaid_JS({
    invoice_id,
    customer_id,
    amount: paymentAmount,
    amount_applied: amountApplied,
    reference_number: transactionId ? String(transactionId) : undefined,
    description: `M-Pesa ${source || "payment"} ${transactionId || ""}`.trim(),
    account_id: account_id || undefined,
  });
}

async function logZohoMpesaPaymentResult(result, meta = {}) {
  try {
    const paid = result?.paid === true;
    const customerRef = meta.accountRef || meta.customerNumber || null;
    const amount = meta.amount;
    const referenceId =
      meta.transactionId || result?.invoice_id || result?.invoice_number || null;

    await insertIntegrationEvent({
      source: "zoho",
      status: paid ? "paid" : "failed",
      customerNo: customerRef,
      amount,
      referenceId,
      outcome: result?.reason || (paid ? "paid" : "failed"),
      channel: meta.channel || null,
      checkoutRequestId: meta.checkoutRequestId || null,
      rawPayload: { result, meta, event: "zoho_mpesa_payment", live: true },
    });

    const strategy = result?.strategy || "";
    let eventType = "zoho_invoice_failed";
    let title = "Zoho invoice failed";
    let message = result?.reason || "Could not process invoice";

    if (paid) {
      if (strategy === "created_and_paid") {
        eventType = "zoho_invoice_created";
        title = "Zoho invoice created";
        message = `Invoice ${result.invoice_number || result.invoice_id || ""} created and marked paid`.trim();
      } else {
        eventType = "zoho_invoice_updated";
        title = "Zoho invoice updated";
        message = `Invoice ${result.invoice_number || result.invoice_id || ""} marked as paid`.trim();
      }
    }

    await logActivity({
      eventType,
      title,
      message,
      source: "zoho",
      status: paid ? "success" : "failed",
      customerRef,
      amount,
      referenceId,
      checkoutRequestId: meta.checkoutRequestId || null,
      metadata: { strategy, channel: meta.channel, result },
    });
  } catch (e) {
    console.error("zoho-mpesa payment log failed:", e.message);
  }
}

/**
 * Apply an M-Pesa payment to Zoho Books.
 * Guarantee: when the Zoho contact exists and amount is valid —
 *   1) pay an open invoice if one matches, OR
 *   2) create an invoice for the exact payment amount and mark it paid.
 */
async function applyZohoPaymentForMpesa({
  customerNumber,
  amount,
  transactionId,
  source,
  forceInvoiceId = null,
  msisdn = null,
}) {
  const resolved = await resolveMpesaAccountRef(customerNumber, msisdn);
  const companyName = resolved.canonical || String(customerNumber || "").trim();
  const paymentAmount = roundMoney(amount);
  if (!companyName || paymentAmount <= 0) {
    return { paid: false, reason: "invalid_input" };
  }

  let zohoLookupName = companyName;
  let billedViaAgency = false;
  let agencyName = null;

  const dbCustomer = resolved.customer;
  if (dbCustomer && isB2BCustomer(dbCustomer)) {
    try {
      const agency = await resolveAgencyForCustomer(dbCustomer, customerStore);
      zohoLookupName = agency.name;
      billedViaAgency = true;
      agencyName = agency.name;
    } catch (e) {
      return {
        paid: false,
        reason: "b2b_agency_missing",
        customerNumber: companyName,
        message: e.message,
      };
    }
  }

  const customer = await getCustomerByCompanyName_JS(zohoLookupName);
  if (!customer || typeof customer === "string" || !customer.contact_id) {
    return {
      paid: false,
      reason: billedViaAgency ? "agency_not_found_in_zoho" : "customer_not_found",
      customerNumber: companyName,
      agencyName,
    };
  }

  const customer_id = customer.contact_id;
  let openInvoice = null;

  if (forceInvoiceId) {
    const customerInvoices = await getInvoices_JS({
      customer_id,
      per_page: 200,
      page: 1,
    });
    const pool = billedViaAgency
      ? filterAgencyInvoicesForCustomer(customerInvoices, companyName)
      : customerInvoices;
    openInvoice = (pool || []).find(
      (inv) => String(inv.invoice_id) === String(forceInvoiceId)
    );
    if (!openInvoice?.invoice_id) {
      console.warn(
        "Zoho forceInvoiceId not found — creating invoice for M-Pesa payment",
        { forceInvoiceId, customerNumber: companyName, transactionId }
      );
    }
  }

  if (!openInvoice?.invoice_id) {
    openInvoice = await findOpenInvoiceForPayment({
      customerNumber: companyName,
      customer_id,
      paymentAmount,
      billedViaAgency,
    });
  }

  // No usable open invoice → create one for this payment amount, then mark paid.
  if (!openInvoice?.invoice_id) {
    return createAndMarkInvoicePaidForMpesa({
      companyName,
      customer_id,
      paymentAmount,
      transactionId,
      source,
      dbCustomer,
    });
  }

  const invoiceBalance = invoiceOutstandingBalance(openInvoice);
  const balanceForPlan =
    invoiceBalance > 0 ? invoiceBalance : paymentAmount;
  const plan = planInvoicePayment(paymentAmount, balanceForPlan);
  const payment = await recordInvoicePayment({
    invoice_id: openInvoice.invoice_id,
    customer_id,
    paymentAmount: plan.payment_amount,
    amountApplied: plan.amount_applied,
    transactionId,
    source,
  });

  if (!payment) {
    return {
      paid: false,
      reason: "mark_paid_failed",
      invoice_id: openInvoice.invoice_id,
      plan,
    };
  }

  console.log("Zoho payment applied:", {
    source,
    transactionId,
    customerNumber: companyName,
    invoiceId: openInvoice.invoice_id,
    outcome: plan.outcome,
    payment_amount: plan.payment_amount,
    amount_applied: plan.amount_applied,
    excess_amount: plan.excess_amount || 0,
  });

  if (dbCustomer?.id) {
    try {
      const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
      await integrationSnapshot.recordZohoPaymentSnapshot(dbCustomer.id, {
        invoiceId: openInvoice.invoice_id,
        invoiceNumber: openInvoice.invoice_number,
        paymentId: payment.payment_id,
        amount: plan.payment_amount,
        referenceId: transactionId,
        remainingBalance: plan.remaining_balance ?? 0,
      });
      const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
      invalidateCustomerZoho(dbCustomer.id);
    } catch (e) {
      console.warn("Zoho payment snapshot update failed:", e.message);
    }
  }

  return {
    paid: true,
    strategy: plan.outcome,
    invoice_id: openInvoice.invoice_id,
    invoice_number: openInvoice.invoice_number,
    invoice_balance_before: invoiceBalance,
    payment_amount: plan.payment_amount,
    amount_applied: plan.amount_applied,
    excess_amount: plan.excess_amount || 0,
    remaining_balance: plan.remaining_balance ?? 0,
    zoho_payment_id: payment.payment_id || null,
  };
}

/**
 * Create a Zoho invoice for the M-Pesa amount and mark it paid.
 * Always attempts mark-paid after a successful create (tax/balance drift is logged, not fatal).
 */
async function createAndMarkInvoicePaidForMpesa({
  companyName,
  customer_id,
  paymentAmount,
  transactionId,
  source,
  dbCustomer,
}) {
  const created = await createInvoiceForExactAmount({
    companyName,
    customer_id,
    paymentAmount,
    transactionId,
    source,
    referenceNumber: companyName,
    customer: dbCustomer,
  });
  if (!created?.invoice_id) {
    return { paid: false, reason: "create_failed" };
  }

  let createdBalance = invoiceOutstandingBalance(created);
  if (!(createdBalance > 0)) {
    createdBalance = paymentAmount;
  }
  if (!amountsEqual(createdBalance, paymentAmount)) {
    console.warn(
      "Zoho invoice total/balance differs from M-Pesa amount — applying payment anyway",
      {
        paymentAmount,
        invoice_total: created.total,
        invoice_balance: createdBalance,
        invoice_id: created.invoice_id,
        is_inclusive_tax: ZOHO_INVOICE_TAX_INCLUSIVE,
      }
    );
  }

  const plan = planInvoicePayment(paymentAmount, createdBalance);
  const payment = await recordInvoicePayment({
    invoice_id: created.invoice_id,
    customer_id,
    paymentAmount: plan.payment_amount,
    amountApplied: plan.amount_applied,
    transactionId,
    source,
  });
  if (!payment) {
    return {
      paid: false,
      reason: "created_mark_paid_failed",
      invoice_id: created.invoice_id,
      invoice_number: created.invoice_number || null,
    };
  }

  if (dbCustomer?.id) {
    try {
      const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
      await integrationSnapshot.recordZohoPaymentSnapshot(dbCustomer.id, {
        invoiceId: created.invoice_id,
        invoiceNumber: created.invoice_number,
        paymentId: payment.payment_id,
        amount: plan.payment_amount,
        referenceId: transactionId,
        remainingBalance: plan.remaining_balance ?? 0,
      });
      const { invalidateCustomerZoho } = require("../utils/zohoInvoiceCache");
      invalidateCustomerZoho(dbCustomer.id);
    } catch (e) {
      console.warn("Zoho payment snapshot update failed:", e.message);
    }
  }

  return {
    paid: true,
    strategy: "created_and_paid",
    invoice_id: created.invoice_id,
    invoice_number: created.invoice_number,
    invoice_balance_before: createdBalance,
    payment_amount: plan.payment_amount,
    amount_applied: plan.amount_applied,
    excess_amount: plan.excess_amount || 0,
    remaining_balance: plan.remaining_balance ?? 0,
    zoho_payment_id: payment.payment_id || null,
  };
}

/** Build SetISPPayment payload from a stored payment_transactions row (reconciliation retry). */
function buildISPPayloadFromStoredPayment(row) {
  const channel = String(row.channel || "").toUpperCase();
  const accountRef = row.account_reference;
  if (channel.includes("STK")) {
    return buildISPPayloadFromSTK(
      {
        MpesaReceiptNumber: row.mpesa_receipt,
        TransactionDate: row.transaction_date,
        Amount: row.amount,
        PhoneNumber: row.phone,
        CheckoutRequestID: row.checkout_request_id,
      },
      accountRef
    );
  }
  return buildISPPayloadFromConfirmation({
    TransID: row.mpesa_receipt,
    TransTime: row.transaction_date,
    TransAmount: row.amount,
    BillRefNumber: accountRef,
    AccountReference: accountRef,
    MSISDN: row.phone,
  });
}

async function processUnallocatedMpesaPayment(row, meta = {}) {
  const rawRef = String(row.account_reference || "").trim();
  if (!rawRef) {
    return { ok: false, reason: "no_account_reference", message: "Payment has no account reference" };
  }

  const amount = row.amount != null ? Number(row.amount) : 0;
  const receipt = row.mpesa_receipt || null;
  if (!receipt || amount <= 0) {
    return { ok: false, reason: "invalid_payment", message: "Invalid M-Pesa payment record" };
  }

  const resolved = await resolveMpesaAccountRef(rawRef, row.phone);
  const accountRef = resolved.canonical || rawRef;
  if (row.id && accountRef && accountRef !== rawRef) {
    try {
      await updateAccountReferenceById(row.id, accountRef);
      row.account_reference = accountRef;
    } catch (e) {
      console.warn("[mpesa-allocation] account_reference rewrite failed:", e.message);
    }
  }

  const zohoResult = await applyZohoPaymentForMpesa({
    customerNumber: accountRef,
    amount,
    transactionId: receipt,
    source: row.channel || meta.source || "reconciliation",
    msisdn: row.phone,
  });

  await logZohoMpesaPaymentResult(zohoResult, {
    channel: row.channel || meta.source || "reconciliation",
    accountRef,
    amount,
    transactionId: receipt,
    msisdn: row.phone,
  });

  if (!zohoResult.paid) {
    return {
      ok: false,
      reason: zohoResult.reason || "zoho_failed",
      message:
        zohoResult.message ||
        `Could not apply payment in Zoho (${zohoResult.reason || "unknown"})`,
      zoho: zohoResult,
    };
  }

  let tispPosted = false;
  let tispError = null;
  try {
    const ispPayload = buildISPPayloadFromStoredPayment(row);
    await postISPPayment(ispPayload);
    tispPosted = true;
  } catch (e) {
    tispError = e.message || "TISP post failed";
  }

  await recordLastPaymentForAccount(accountRef, row.transaction_date || row.created_at);

  let customer = null;
  try {
    customer = resolved.customer;
    if (!customer) {
      customer = await customerStore.resolveCustomerByPaybillRef(accountRef, {
        msisdn: row.phone,
      });
    }
    if (customer) {
      const tisp = await getTISPCustomer(customer.customerNumber);
      const status = tisp?.status ?? tisp?.Status ?? null;
      if (status) {
        await customerStore.updateCustomerSubscriptionStatus(
          customer.id,
          normalizeSubscriptionStatus(String(status))
        );
      }
    }
  } catch (e) {
    console.warn("[mpesa-allocation] TISP refresh skipped:", e.message);
  }

  try {
    const { onRefereeSignupPaid } = require("../services/referralRewardService");
    await onRefereeSignupPaid({
      customerId: customer?.id || null,
      customerNumber: accountRef,
      invoiceId: zohoResult.invoice_id || null,
      source: "mpesa_allocation",
    });
  } catch (e) {
    console.warn("[mpesa-allocation] referral reward failed:", e.message);
  }

  return {
    ok: true,
    zoho: zohoResult,
    tispPosted,
    tispError,
    customerId: customer?.id ?? null,
    customerNumber: accountRef,
    message: tispPosted
      ? `Invoice ${zohoResult.invoice_number || zohoResult.invoice_id || ""} marked paid · TISP updated`.trim()
      : `Invoice marked paid in Zoho · TISP post failed: ${tispError}`,
  };
}

const mpesaValidation = (req, res) => {
  // If external validation is enabled on your Paybill, this fires BEFORE debit.
  // Put business rules here; return ResultCode=0 to accept.
  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    console.log("HIT VALIDATION", {
      headers: req.headers,
      body,
    });

    const ref = String(body?.BillRefNumber || body?.AccountReference || "");
    const amount = Number(
      body?.TransAmount || body?.TransactionAmount || body?.Amount || 0
    );

    // Accept POP-APT / POP-BUILDING-APT account refs used across all buildings
    // (not only ET-*). Reject archived cancel numbers and free-text refs.
    if (!isValidPaybillAccountRef(ref) || !(amount >= 1)) {
      return res.status(200).json({ ResultCode: 1, ResultDesc: "Rejected" });
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error("VALIDATION error", e.message);
    return res.status(200).json({ ResultCode: 1, ResultDesc: "Rejected" });
  }
};

const mpesaConfirmation = async (req, res) => {
  // Fires AFTER a successful debit; Safaricom will expect a 200 with ResultCode 0.
  console.log("HIT CONFIRMATION (raw)", {
    headers: req.headers,
    type: typeof req.body,
  });

  try {
    // 0) ACK immediately (do not await network calls before this)
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });

    // 1) Safe parse
    const raw =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
    const tx = raw || {};
    console.log("C2B CONFIRMATION parsed:", tx);

    // 2) Normalize + derive
    const transactionId = tx.TransID || tx.TransRef || tx.transactionId || null;
    const amount = tx.TransAmount || tx.TransactionAmount || tx.amount || null;
    const msisdn = tx.MSISDN || tx.MSISDNNumber || tx.PhoneNumber || "";
    const transTime =
      tx.TransTime || tx.TransDate || tx.TransactionDate || null;
    const shortCode = tx.BusinessShortCode || MPESA_SHORTCODE || "";
    const accountRefRaw =
      tx.BillRefNumber ||
      tx.AccountReference ||
      tx.accountReference ||
      process.env.DEFAULT_ACCOUNT_REFERENCE ||
      "Starlynx Utility";
    const resolved = await resolveMpesaAccountRef(accountRefRaw, msisdn);
    const accountRef = resolved.canonical || accountRefRaw;

    try {
      await logActivity({
        eventType: "payment_received",
        title: "Payment received",
        message: `C2B paybill ${transactionId || "payment"} from ${msisdn || "customer"}`,
        source: "mpesa",
        status: "success",
        customerRef: accountRef,
        amount,
        referenceId: transactionId,
        metadata: { channel: "C2B", shortCode },
      });
    } catch (e) {
      console.error("activity log (C2B) failed:", e.message);
    }

    await recordLastPaymentForAccount(accountRef, transTime);

    try {
      await recordC2BConfirmation({
        mpesaReceipt: transactionId,
        phone: msisdn,
        amount,
        accountReference: accountRef,
        transactionDate: transTime,
        rawPayload: tx,
      });
    } catch (e) {
      console.warn("C2B payment_transactions record failed:", e.message);
    }

    const ispPayload = buildISPPayloadFromConfirmation({
      ...tx,
      BusinessShortCode: shortCode,
      BillRefNumber: accountRef,
      MSISDN: msisdn,
      TransTime: transTime,
      TransAmount: amount,
      TransID: transactionId,
    });

    // 3) Zoho invoice before forwarding to ISP (live paybill flow)
    try {
      const zohoResult = await applyZohoPaymentForMpesa({
        customerNumber: accountRef,
        amount,
        transactionId,
        source: "C2B",
        msisdn,
      });
      console.log("Zoho result (C2B):", zohoResult);
      await logZohoMpesaPaymentResult(zohoResult, {
        channel: "C2B",
        accountRef,
        amount,
        transactionId,
        msisdn,
      });
      if (req.headers?.["x-paybill-simulation"]) {
        req._zohoPaymentResult = zohoResult;
      }
    } catch (e) {
      console.error("Zoho payment failed (C2B):", e.message);
      await logZohoMpesaPaymentResult(
        { paid: false, reason: "error", error: e.message },
        { channel: "C2B", accountRef, amount, transactionId, msisdn }
      );
    }

    // 4) Forward to ISP (SetISPPayment); updatedSubscriptions only if this succeeds
    let tispOk = false;
    try {
      await postISPPayment(ispPayload);
      tispOk = true;
      console.log("ISP payment posted OK:", transactionId);
    } catch (e) {
      console.error("ISP post failed", {
        error: e?.response?.data || e.message,
        ispPayload,
      });
    }

    if (tispOk) {
      try {
        await upsertUpdatedSubscriptionFull({
          transactionId: transactionId ? String(transactionId) : null,
          amount: amount != null ? String(amount) : null,
          customerAccount: String(accountRef),
          rawTx: { type: "C2B_CONFIRMATION", ...tx },
          ispPayload,
          source: "C2B",
        });
        console.log("C2B snapshot upserted (TISP ok):", {
          transactionId,
          accountRef,
          amount,
        });
      } catch (e) {
        console.error("C2B snapshot upsert failed", e);
      }
    }

    try {
      await processTransactionSplit({
        source: "C2B",
        transactionId: transactionId ? String(transactionId) : "",
        totalAmount: amount,
      });
    } catch (e) {
      console.error("transaction split failed (C2B):", e.message);
    }

    // Zoho reconciliation now runs before ISP call by design.
  } catch (err) {
    console.error("C2B processing error", err);
    // already ACKed above
  }
};

/* ================================================================== */
/*                         STK Push Initiation                         */
/* ================================================================== */
const initiateSTKPush = async (accountNumber, phone, amount, options = {}) => {
  try {
    const rawAmount = Math.round(Number(amount));
    const useLiveAmount =
      options.liveAmount === true ||
      String(process.env.MPESA_STK_USE_LIVE_AMOUNT || "").toLowerCase() === "true";
    const stkAmount = useLiveAmount
      ? Math.max(1, Number.isFinite(rawAmount) ? rawAmount : 1)
      : 1;
    if (!useLiveAmount && Number.isFinite(rawAmount) && rawAmount !== stkAmount) {
      console.info(
        `[MPESA STK] fixed Amount=${stkAmount} (subscription amount would be ${rawAmount})`,
      );
    }

    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const Timestamp = moment.tz(TZ).format("YYYYMMDDHHmmss");
    const shortcode = MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASS_KEY;
    const password = Buffer.from(shortcode + passkey + Timestamp).toString(
      "base64"
    );

    // Normalize phone (remove leading + or 0)
    const user_phone = String(phone || "").replace(/^(\+|0)+/, "");

    // Use provided accountNumber as AccountReference
    const AccountReference =
      String(accountNumber || "").trim() || "Starlynx Utility";

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: stkAmount,
      PartyA: user_phone,
      PartyB: shortcode,
      PhoneNumber: user_phone,
      CallBackURL:
        MPESA_CALLBACK_URL ||
        "https://app.sulsolutions.biz/api/payment/callback",
      AccountReference, // use provided account number (also our companyName / customer account)
      TransactionDesc: "Subscription",
    };

    const { data } = await axios.post(STK_PUSH_ENDPOINT, payload, config);

    // Pre-log a PENDING record keyed by CheckoutRequestID
    try {
      await appendTransaction({
        Status: "PENDING",
        PhoneNumber: user_phone,
        Amount: stkAmount,
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        AccountReference, // stored for lookup on callback
        ResultCode: null,
        ResultDesc: "Awaiting customer PIN",
        Timestamp: new Date().toISOString(),
        channel: "STK",
      });
    } catch (e) {
      logError(e, {
        source: "mpesa.stk_prelog",
        accountReference: AccountReference,
        phone: user_phone,
      });
      console.warn("Could not pre-log pending transaction:", e.message);
    }

    return data;
  } catch (error) {
    console.error("STK Push Error:", error.message);
    return { error: "Initiate STKPush failed: " + error.message };
  }
};

/* ================================================================== */
/*                         STK Push Callback                           */
/* ================================================================== */
const mpesaCallback = async (req, res) => {
  try {
    const body = req.body;
    console.log("M-Pesa callback received:", JSON.stringify(body, null, 2));

    const callback = body?.Body?.stkCallback;
    if (!callback) {
      console.warn("Invalid callback format");
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    const transaction = {
      MerchantRequestID: callback.MerchantRequestID,
      CheckoutRequestID: callback.CheckoutRequestID,
      ResultCode: callback.ResultCode,
      ResultDesc: callback.ResultDesc,
      Timestamp: new Date().toISOString(),
    };

    if (callback.ResultCode === 0) {
      const metadata = callback.CallbackMetadata?.Item || [];
      const getItemValue = (name) =>
        metadata.find((it) => it.Name === name)?.Value;

      transaction.Amount = getItemValue("Amount");
      transaction.MpesaReceiptNumber = getItemValue("MpesaReceiptNumber");
      transaction.TransactionDate = getItemValue("TransactionDate");
      transaction.PhoneNumber = String(getItemValue("PhoneNumber") || "");
      transaction.Status = "SUCCESS";
    } else {
      transaction.Status = "FAILED";
    }
    transaction.channel = "STK";

    // Update existing PENDING by CheckoutRequestID; if not found, append
    await upsertByCheckoutId(transaction.CheckoutRequestID, transaction);

    const accountRefEarly =
      (await findLatestTxnByCheckoutOrPhone(
        transaction.CheckoutRequestID,
        transaction.PhoneNumber
      ))?.AccountReference || null;

    try {
      await logActivity({
        eventType:
          transaction.Status === "SUCCESS"
            ? "payment_received"
            : "payment_failed",
        title:
          transaction.Status === "SUCCESS"
            ? "Payment received"
            : "Payment failed",
        message:
          transaction.Status === "SUCCESS"
            ? `M-Pesa ${transaction.MpesaReceiptNumber || "payment"} from ${transaction.PhoneNumber || "customer"}`
            : transaction.ResultDesc || "STK push was not completed",
        source: "mpesa",
        status: transaction.Status === "SUCCESS" ? "success" : "failed",
        customerRef: accountRefEarly,
        amount: transaction.Amount,
        referenceId: transaction.MpesaReceiptNumber,
        checkoutRequestId: transaction.CheckoutRequestID,
        metadata: { channel: "STK", resultDesc: transaction.ResultDesc },
      });
    } catch (e) {
      console.error("activity log (mpesa STK) failed:", e.message);
    }

    // If SUCCESS, persist FULL tx + POST to ISP + create Zoho invoice
    if (transaction.Status === "SUCCESS") {
      // fetch the pre-logged record to retrieve original AccountReference
      const existing =
        (await findLatestTxnByCheckoutOrPhone(
          transaction.CheckoutRequestID,
          transaction.PhoneNumber
        )) || {};

      // Use the AccountReference from STK initiation, then map typing mistakes
      const accountRefRaw = existing.AccountReference
        ? String(existing.AccountReference)
        : process.env.DEFAULT_ACCOUNT_REFERENCE || "Starlynx Utility";
      const resolvedStk = await resolveMpesaAccountRef(
        accountRefRaw,
        transaction.PhoneNumber
      );
      const accountRef = resolvedStk.canonical || accountRefRaw;

      await recordLastPaymentForAccount(
        accountRef,
        transaction.TransactionDate
      );

      const pendingUpgrade = await pendingUpgradeStore.findPendingByCheckoutRequestId(
        transaction.CheckoutRequestID
      );
      let upgradeCompleted = false;
      if (pendingUpgrade) {
        try {
          const upgradeResult =
            await pendingUpgradeStore.tryCompleteUpgradeFromStk({
              checkoutRequestId: transaction.CheckoutRequestID,
            });
          upgradeCompleted = upgradeResult.completed === true;
          if (upgradeCompleted) {
            console.log(
              "Pending upgrade completed after STK payment:",
              pendingUpgrade.id
            );
          }
        } catch (e) {
          console.error("Pending upgrade completion failed (STK):", e.message);
        }
      }

      // Zoho invoice before posting to ISP (create or mark existing invoice paid)
      try {
        const forceInvoiceId =
          upgradeCompleted && pendingUpgrade?.zohoInvoiceId
            ? pendingUpgrade.zohoInvoiceId
            : null;
        const zohoResult = await applyZohoPaymentForMpesa({
          customerNumber: accountRef,
          amount: transaction.Amount,
          transactionId: transaction.MpesaReceiptNumber,
          source: "STK",
          forceInvoiceId,
          msisdn: transaction.PhoneNumber,
        });
        console.log("Zoho result (STK):", zohoResult);
        await logZohoMpesaPaymentResult(zohoResult, {
          channel: "STK",
          accountRef,
          amount: transaction.Amount,
          transactionId: transaction.MpesaReceiptNumber,
          checkoutRequestId: transaction.CheckoutRequestID,
          phone: transaction.PhoneNumber,
        });
      } catch (e) {
        console.error("Zoho payment failed (STK):", e.message);
        await logZohoMpesaPaymentResult(
          { paid: false, reason: "error", error: e.message },
          {
            channel: "STK",
            accountRef,
            amount: transaction.Amount,
            transactionId: transaction.MpesaReceiptNumber,
            checkoutRequestId: transaction.CheckoutRequestID,
            phone: transaction.PhoneNumber,
          }
        );
      }

      // Build and post ISP payload (compact)
      const ispPayload = buildISPPayloadFromSTK(transaction, accountRef);

      const idemKey = String(transaction.MpesaReceiptNumber || "");
      let tispOk = false;
      try {
        if (idemKey && _postedTransIds.has(idemKey)) {
          console.log(
            "TISP SetISPPayment skipped (duplicate MpesaReceiptNumber):",
            idemKey,
          );
          await logSetIspPaymentAttempt({
            outcome: "skipped_duplicate",
            url: ISP_PAYMENT_URL,
            request: ispPayload,
            transKey: idemKey,
            accountRef,
            amount: transaction.Amount,
            transactionId: transaction.MpesaReceiptNumber,
            checkoutRequestId: transaction.CheckoutRequestID,
            channel: "STK",
          });
          tispOk = true;
        } else {
          await postSetISPPayment(ispPayload);
          if (idemKey) _postedTransIds.add(idemKey);
          tispOk = true;
          await logSetIspPaymentAttempt({
            outcome: "success",
            accountRef,
            amount: transaction.Amount,
            transactionId: transaction.MpesaReceiptNumber,
            checkoutRequestId: transaction.CheckoutRequestID,
            channel: "STK",
            request: ispPayload,
          });
        }
      } catch (e) {
        console.error(
          "TISP SetISPPayment failed (STK)",
          e?.response?.data || e.message,
        );
        await logSetIspPaymentAttempt({
          outcome: "failure",
          accountRef,
          amount: transaction.Amount,
          transactionId: transaction.MpesaReceiptNumber,
          checkoutRequestId: transaction.CheckoutRequestID,
          channel: "STK",
          errorMessage: e.message,
          request: ispPayload,
        });
      }

      if (tispOk) {
        await upsertUpdatedSubscriptionFull({
          transactionId: String(transaction.MpesaReceiptNumber || ""),
          customerAccount: accountRef,
          amount: String(transaction.Amount || ""),
          rawTx: { type: "STK_CALLBACK", ...transaction },
          ispPayload,
          source: "STK",
        });
      }

      try {
        await processTransactionSplit({
          source: "STK",
          transactionId: String(transaction.MpesaReceiptNumber || ""),
          totalAmount: transaction.Amount,
        });
      } catch (e) {
        console.error("transaction split failed (STK):", e.message);
      }

      // Zoho reconciliation now runs before ISP call by design.
    }

    // ACK to Daraja
    res.status(200).json({ message: "Callback processed" });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/* ================================================================== */
/*                 Register C2B URLs + Sandbox Simulate                */
/* ================================================================== */
const registerC2BUrls = async (req, res) => {
  try {
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const payload = {
      ShortCode: MPESA_SHORTCODE, // sandbox e.g. 174379 or 600xxx
      ResponseType: "Completed", // or "Cancelled"
      ConfirmationURL:
        MPESA_CONFIRMATION_URL ||
        "https://app.sulsolutions.biz/api/payment/confirmation",
      ValidationURL:
        MPESA_VALIDATION_URL ||
        "https://app.sulsolutions.biz/api/payment/validation",
    };

    const { data } = await axios.post(C2B_REGISTER_URL, payload, config);
    res.json({ ok: true, data, sent: payload });
  } catch (err) {
    console.error("registerC2BUrls error:", err?.response?.data || err.message);
    res
      .status(500)
      .json({ ok: false, error: err?.response?.data || err.message });
  }
};

const simulateC2B = async (req, res) => {
  try {
    const {
      amount = 1,
      billRef = "ET-TEST",
      msisdn = "254708374149",
    } = req.body || {};
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const payload = {
      ShortCode: MPESA_SHORTCODE, // must match registered shortcode
      CommandID: "CustomerPayBillOnline",
      Amount: amount,
      Msisdn: msisdn, // sandbox test MSISDN 254708374149
      BillRefNumber: billRef, // becomes your customerAccount
    };

    const { data } = await axios.post(C2B_SIMULATE_URL, payload, config);

    res.json({ ok: true, data, sent: payload });
  } catch (err) {
    console.error("simulateC2B error:", err?.response?.data || err.message);
    res
      .status(500)
      .json({ ok: false, error: err?.response?.data || err.message });
  }
};

const getTransactionSplitConfig = async (_req, res) => {
  try {
    const config = await readSplitConfig();
    const totalPercentage = config.recipients.reduce(
      (s, r) => s + Number(r.percentage || 0),
      0
    );
    res.json({ ...config, totalPercentage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const updateTransactionSplitConfig = async (req, res) => {
  try {
    const parsed = validateSplitConfigInput(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    await writeSplitConfig({
      enabled: parsed.value.enabled,
      recipients: parsed.value.recipients,
    });
    res.json({
      ok: true,
      config: {
        enabled: parsed.value.enabled,
        recipients: parsed.value.recipients,
        totalPercentage: parsed.value.totalPercentage,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const getTransactionSplitLog = async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 500));
    const all = await readSplitLog();
    res.json(all.slice(-limit).reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const b2cResult = async (req, res) => {
  try {
    await appendSplitLog({
      outcome: "b2c_result_callback",
      payload: req.body || {},
    });
  } catch (e) {
    console.error("b2cResult log failed:", e.message);
  }
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
};

const b2cTimeout = async (req, res) => {
  try {
    await appendSplitLog({
      outcome: "b2c_timeout_callback",
      payload: req.body || {},
    });
  } catch (e) {
    console.error("b2cTimeout log failed:", e.message);
  }
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
};

/* ================================================================== */
/*                         Test endpoint                               */
/* ================================================================== */
const test = async (req, res) => {
  try {
    // Example: push KES 1 to this phone using the root route
    const results = await initiateSTKPush(
      "TEST",
      "+254701057515",
      1,
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Test " + err.message });
  }
};

/* ================================================================== */
/*                              Exports                                */
/* ================================================================== */
module.exports = {
  registerC2BUrls,
  simulateC2B,
  mpesaValidation,
  mpesaConfirmation, // includes ISP POST + snapshot + Zoho invoice
  mpesaCallback, // includes ISP POST on success + snapshot + Zoho invoice
  getTransactionSplitConfig,
  updateTransactionSplitConfig,
  getTransactionSplitLog,
  b2cResult,
  b2cTimeout,
  getAccessToken,
  initiateSTKPush,
  test,
  applyZohoPaymentForMpesa,
  processUnallocatedMpesaPayment,
  logZohoMpesaPaymentResult,
};
