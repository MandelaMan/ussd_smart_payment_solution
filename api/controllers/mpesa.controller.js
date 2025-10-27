// controllers/mpesa.controller.js
const moment = require("moment");
const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const {
  appendTransaction,
  upsertByCheckoutId,
  findLatestTxnByCheckoutOrPhone,
} = require("../../utils/transactions");

/* ========================================================================== */
/* Local JSON store for subscription snapshots                                */
/* ========================================================================== */
const LOGS_DIR = path.resolve(__dirname, "../../logs");
const SUBS_FILE = path.join(LOGS_DIR, "updatedSubscriptions.json");

// tiny in-process write queue for updatedSubscriptions.json
let _subsQueue = Promise.resolve();
function queueSubsWrite(task) {
  _subsQueue = _subsQueue
    .then(task)
    .catch((e) => console.error("updatedSubscriptions write err:", e));
  return _subsQueue;
}

async function ensureSubsFile() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  try {
    await fs.access(SUBS_FILE);
  } catch {
    await fs.writeFile(SUBS_FILE, "[]", "utf8");
  }
}

async function readSubs() {
  await ensureSubsFile();
  try {
    const data = await fs.readFile(SUBS_FILE, "utf8");
    const arr = JSON.parse(data || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeSubs(all) {
  await ensureSubsFile();
  const tmp = SUBS_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  await fs.rename(tmp, SUBS_FILE);
}

async function upsertUpdatedSubscription(entry) {
  if (!entry?.transactionId) return;

  return queueSubsWrite(async () => {
    const all = await readSubs();
    const idx = all.findIndex((x) => x.transactionId === entry.transactionId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...entry };
    } else {
      all.push(entry);
    }
    await writeSubs(all);
  });
}

/* ========================================================================== */
/* Simple idempotency for ISP posts (avoid duplicate posts per TransID)       */
/* ========================================================================== */
const ISP_POSTS_FILE = path.join(LOGS_DIR, "ispPosts.json");
let _ispQueue = Promise.resolve();

async function ensureIspFile() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  try {
    await fs.access(ISP_POSTS_FILE);
  } catch {
    await fs.writeFile(ISP_POSTS_FILE, "[]", "utf8");
  }
}

async function readIspPosts() {
  await ensureIspFile();
  try {
    const data = await fs.readFile(ISP_POSTS_FILE, "utf8");
    const arr = JSON.parse(data || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function hasIspPosted(transId) {
  const all = await readIspPosts();
  return all.some((x) => x.TransID === transId);
}

async function markIspPosted(record) {
  _ispQueue = _ispQueue.then(async () => {
    const all = await readIspPosts();
    all.push({ ...record, postedAt: new Date().toISOString() });
    const tmp = ISP_POSTS_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await fs.rename(tmp, ISP_POSTS_FILE);
  });
  return _ispQueue;
}

/* ========================================================================== */
/* M-Pesa OAuth                                                               */
/* ========================================================================== */
const getAccessToken = async () => {
  const secret_key = process.env.MPESA_CONSUMER_SECRET;
  const consumer_key = process.env.MPESA_CONSUMER_KEY;

  const auth = Buffer.from(`${consumer_key}:${secret_key}`).toString("base64");
  const config = { headers: { Authorization: `Basic ${auth}` } };

  const { data } = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    config
  );
  return data.access_token;
};

/* ========================================================================== */
/* ISP Payment (external)                                                     */
/* ========================================================================== */
const ISP_PAYMENT_URL =
  process.env.ISP_PAYMENT_URL ||
  "https://daraja.teqworthsystems.com/starlynxservice/WebISPService.svc/SetISPPayment";

/** Convert "YYYYMMDDHHmmss" -> "DD MMM YYYY hh:mm A" (e.g., 01 Nov 2024 11:48 AM) */
function formatC2BTime(raw) {
  try {
    if (raw && /^[0-9]{14}$/.test(String(raw))) {
      return moment(raw, "YYYYMMDDHHmmss").format("DD MMM YYYY hh:mm A");
    }
  } catch (_) {}
  return moment().format("DD MMM YYYY hh:mm A");
}

/** Build the ISP payload (compact JSON will be enforced by transformRequest) */
function buildISPPayloadFromConfirmation(tx) {
  return {
    TransactionType: "Paystack", // per your spec
    TransID: String(tx.TransID || tx.TransRef || ""),
    TransTime: formatC2BTime(tx.TransTime || tx.TransDate),
    TransAmount: String(
      tx.TransAmount || tx.TransactionAmount || tx.amount || "0"
    ),
    BusinessShortCode: String(
      tx.BusinessShortCode || process.env.MPESA_SHORTCODE || ""
    ),
    BillRefNumber: String(tx.BillRefNumber || tx.AccountReference || ""),
    InvoiceNumber: String(tx.InvoiceNumber || tx.BillRefNumber || ""),
    OrgAccountBalance: String(tx.OrgAccountBalance || "0"),
    ThirdPartyTransID: String(tx.ThirdPartyTransID || ""),
    MSISDN: String(tx.MSISDN || tx.MSISDNNumber || ""),
    FirstName: String(tx.FirstName || ""),
  };
}

/** POST to ISP (idempotent on TransID) */
async function postISPPayment(payload) {
  const transId = String(payload.TransID || "");
  if (!transId) {
    console.warn("ISP post skipped: missing TransID");
    return;
  }
  if (await hasIspPosted(transId)) {
    console.log("ISP post skipped (duplicate):", transId);
    return;
  }

  try {
    await axios.post(ISP_PAYMENT_URL, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
      // ensure compact JSON (no pretty-print spaces)
      transformRequest: [(data) => JSON.stringify(data)],
    });
    await markIspPosted({ TransID: transId, amount: payload.TransAmount });
    console.log("ISP payment posted:", transId);
  } catch (e) {
    console.error("ISP payment post failed:", e?.response?.data || e.message);
  }
}

/* ========================================================================== */
/* C2B Validation / Confirmation (Paybill direct payment)                     */
/* ========================================================================== */
const mpesaValidation = (req, res) => {
  // Add business rules (e.g., validate BillRefNumber pattern) if needed
  const accept = true;
  if (accept) {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });
  } else {
    res.status(200).json({ ResultCode: 1, ResultDesc: "Cancelled" });
  }
};

const mpesaConfirmation = async (req, res) => {
  try {
    const tx = req.body;

    // ACK immediately so Safaricom doesn't retry
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });

    // 1) Update your subscriptions snapshot (optional internal bookkeeping)
    const transactionId =
      tx?.TransID || tx?.TransRef || tx?.transactionId || null;
    const amount =
      tx?.TransAmount || tx?.TransactionAmount || tx?.amount || null;
    const customerAccount =
      tx?.BillRefNumber || tx?.AccountReference || tx?.accountReference || null;

    if (transactionId && amount && customerAccount) {
      await upsertUpdatedSubscription({
        transactionId: String(transactionId),
        customerAccount: String(customerAccount),
        amount: String(amount),
      });
    }

    // 2) **NEW**: Always push direct Paybill confirmations to ISP
    const ispPayload = buildISPPayloadFromConfirmation(tx);
    await postISPPayment(ispPayload);
  } catch (err) {
    console.error("mpesaConfirmation error:", err);
    // already ACKed above
  }
};

/* ========================================================================== */
/* STK Push Initiation                                                        */
/* ========================================================================== */
const initiateSTKPush = async (phone, amount) => {
  try {
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const Timestamp = moment().format("YYYYMMDDHHmmss");
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASS_KEY;
    const password = Buffer.from(shortcode + passkey + Timestamp).toString(
      "base64"
    );

    // normalize phone (remove leading + or 0)
    const user_phone = String(phone || "").replace(/^(\+|0)+/, "");

    // If you want per-customer "customerAccount", pass it here dynamically.
    const AccountReference =
      process.env.DEFAULT_ACCOUNT_REFERENCE || "Starlynx Utility";

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: user_phone,
      PartyB: shortcode,
      PhoneNumber: user_phone,
      CallBackURL:
        process.env.MPESA_CALLBACK_URL ||
        "https://app.sulsolutions.biz/api/payment/callback",
      AccountReference,
      TransactionDesc: "Subscription",
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      config
    );

    // Pre-log a PENDING record keyed by CheckoutRequestID (store AccountReference)
    try {
      await appendTransaction({
        Status: "PENDING",
        PhoneNumber: user_phone,
        Amount: amount,
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        AccountReference,
        ResultCode: null,
        ResultDesc: "Awaiting customer PIN",
        Timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("Could not pre-log pending transaction:", e.message);
    }

    return data;
  } catch (error) {
    console.error("STK Push Error:", error.message);
    return { error: "Initiate STKPush failed: " + error.message };
  }
};

/* ========================================================================== */
/* STK Push Callback (also post to ISP on success)                            */
/* ========================================================================== */
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

    // Update existing PENDING by CheckoutRequestID; if not found, append
    await upsertByCheckoutId(transaction.CheckoutRequestID, transaction);

    // If SUCCESS, also write to logs AND post to ISP
    if (transaction.Status === "SUCCESS") {
      // fetch the pre-logged record to retrieve AccountReference
      const existing =
        (await findLatestTxnByCheckoutOrPhone(
          transaction.CheckoutRequestID,
          transaction.PhoneNumber
        )) || {};

      const accountRef =
        existing.AccountReference ||
        process.env.DEFAULT_ACCOUNT_REFERENCE ||
        "Starlynx Utility";

      // local snapshot
      if (transaction.MpesaReceiptNumber && transaction.Amount) {
        await upsertUpdatedSubscription({
          transactionId: String(transaction.MpesaReceiptNumber),
          customerAccount: String(accountRef),
          amount: String(transaction.Amount),
        });
      }

      // build ISP payload (map STK fields into the C2B schema)
      const ispPayload = {
        TransactionType: "Paystack",
        TransID: String(transaction.MpesaReceiptNumber || ""),
        TransTime: formatC2BTime(String(transaction.TransactionDate || "")),
        TransAmount: String(transaction.Amount || "0"),
        BusinessShortCode: String(process.env.MPESA_SHORTCODE || ""),
        BillRefNumber: String(accountRef || ""),
        InvoiceNumber: String(accountRef || ""),
        OrgAccountBalance: "0",
        ThirdPartyTransID: "",
        MSISDN: String(transaction.PhoneNumber || ""),
        FirstName: "",
      };

      await postISPPayment(ispPayload);
    }

    res.status(200).json({ message: "Callback processed" });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/* ========================================================================== */
/* Register C2B URLs + Sandbox Simulate                                       */
/* ========================================================================== */
const registerC2BUrls = async (req, res) => {
  try {
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const payload = {
      ShortCode: process.env.MPESA_SHORTCODE, // sandbox e.g. 600XXX
      ResponseType: "Completed", // or "Cancelled"
      ConfirmationURL:
        process.env.MPESA_CONFIRMATION_URL ||
        "https://app.sulsolutions.biz/api/payment/confirmation",
      ValidationURL:
        process.env.MPESA_VALIDATION_URL ||
        "https://app.sulsolutions.biz/api/payment/validation",
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl",
      payload,
      config
    );

    res.json({ ok: true, data });
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
      ShortCode: process.env.MPESA_SHORTCODE, // must match registered shortcode
      CommandID: "CustomerPayBillOnline",
      Amount: amount,
      Msisdn: msisdn, // sandbox test MSISDN 254708374149
      BillRefNumber: billRef, // becomes your customerAccount
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/simulate",
      payload,
      config
    );

    res.json({ ok: true, data, sent: payload });
  } catch (err) {
    console.error("simulateC2B error:", err?.response?.data || err.message);
    res
      .status(500)
      .json({ ok: false, error: err?.response?.data || err.message });
  }
};

/* ========================================================================== */
/* Test endpoint                                                               */
/* ========================================================================== */
const test = async (req, res) => {
  try {
    const results = await initiateSTKPush("+254701057515", 1);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Test " + err.message });
  }
};

/* ========================================================================== */
/* Exports                                                                     */
/* ========================================================================== */
module.exports = {
  registerC2BUrls,
  simulateC2B,
  mpesaValidation,
  mpesaConfirmation, // posts ISP for direct Paybill confirmation
  mpesaCallback, // posts ISP for successful STK payments
  getAccessToken,
  initiateSTKPush,
  test,
};
