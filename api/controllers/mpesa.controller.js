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

/* =========================
   Helpers for updatedSubscriptions.json
   ========================= */
const LOGS_DIR = path.resolve(__dirname, "../../logs");
const SUBS_FILE = path.join(LOGS_DIR, "updatedSubscriptions.json");

// in-process write queue to prevent concurrent corruption
let subsQueue = Promise.resolve();
function enqueueSubs(task) {
  subsQueue = subsQueue
    .then(task)
    .catch((e) => console.error("updatedSubscriptions write error:", e));
  return subsQueue;
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

// Generic upsert by TransID
async function upsertC2BRecord(record) {
  const transId = record?.TransID;
  if (!transId) return;
  return enqueueSubs(async () => {
    const all = await readSubs();
    const idx = all.findIndex((r) => r.TransID === transId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...record };
    } else {
      all.push(record);
    }
    await writeSubs(all);
  });
}

/* =========================
   OAuth Helper
   ========================= */
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

/* =========================
   C2B: Validation + Confirmation
   ========================= */
const mpesaValidation = (req, res) => {
  const accept = true; // add your business rules here
  res.status(200).json({
    ResultCode: accept ? 0 : 1,
    ResultDesc: accept ? "Completed" : "Cancelled",
  });
};

const mpesaConfirmation = async (req, res) => {
  try {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });
    const tx = req.body || {};

    const record = {
      TransactionType: String(tx.TransactionType ?? ""),
      TransID: String(tx.TransID ?? ""),
      TransTime: String(tx.TransTime ?? ""),
      TransAmount: String(tx.TransAmount ?? ""),
      BusinessShortCode: String(tx.BusinessShortCode ?? ""),
      BillRefNumber: String(tx.BillRefNumber ?? ""),
      InvoiceNumber: String(tx.InvoiceNumber ?? ""),
      OrgAccountBalance: String(tx.OrgAccountBalance ?? ""),
      ThirdPartyTransID: String(tx.ThirdPartyTransID ?? ""),
      MSISDN: String(tx.MSISDN ?? ""),
      FirstName: String(tx.FirstName ?? ""),
      MiddleName: String(tx.MiddleName ?? ""),
      LastName: String(tx.LastName ?? ""),
    };

    await upsertC2BRecord(record);

    try {
      await axios.post(
        "https://your-service.example.com/internal/payment-webhook",
        record,
        { timeout: 5000 }
      );
    } catch (e) {
      console.warn("Downstream webhook failed:", e.message);
    }
  } catch (err) {
    console.error("mpesaConfirmation error:", err);
  }
};

/* =========================
   STK Push (CustomerPayBillOnline)
   ========================= */
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

    const user_phone = String(phone || "").replace(/^(\+|0)+/, "");
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
        "https://app.sulsolutions.biz/api/mpesa/callback",
      AccountReference,
      TransactionDesc: "Subscription",
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      config
    );

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

    return data;
  } catch (error) {
    console.error("STK Push Error:", error.message);
    return { error: "Initiate STKPush failed: " + error.message };
  }
};

/* =========================
   STK Callback
   ========================= */
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

    await upsertByCheckoutId(transaction.CheckoutRequestID, transaction);

    // If successful STK push, also write to updatedSubscriptions.json
    if (transaction.Status === "SUCCESS") {
      const existing =
        (await findLatestTxnByCheckoutOrPhone(
          transaction.CheckoutRequestID,
          transaction.PhoneNumber
        )) || {};

      const accountRef =
        existing.AccountReference ||
        process.env.DEFAULT_ACCOUNT_REFERENCE ||
        "Starlynx Utility";

      const record = {
        TransactionType: "Pay Bill",
        TransID: String(transaction.MpesaReceiptNumber || ""),
        TransTime: String(
          transaction.TransactionDate || moment().format("YYYYMMDDHHmmss")
        ),
        TransAmount: String(transaction.Amount || ""),
        BusinessShortCode: String(process.env.MPESA_SHORTCODE || ""),
        BillRefNumber: String(accountRef),
        InvoiceNumber: "",
        OrgAccountBalance: "",
        ThirdPartyTransID: "",
        MSISDN: String(transaction.PhoneNumber || ""),
        FirstName: "",
        MiddleName: "",
        LastName: "",
      };

      await upsertC2BRecord(record);
    }

    res.status(200).json({ message: "Callback processed" });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/* =========================
   Sandbox: Register + Simulate
   ========================= */
const registerC2BUrls = async (req, res) => {
  try {
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const payload = {
      ShortCode: process.env.MPESA_SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL:
        process.env.MPESA_CONFIRMATION_URL ||
        "https://app.sulsolutions.biz/api/mpesa/confirmation",
      ValidationURL:
        process.env.MPESA_VALIDATION_URL ||
        "https://app.sulsolutions.biz/api/mpesa/validation",
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
      amount = 10,
      billRef = "invoice008",
      msisdn = "254708374149",
    } = req.body || {};

    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };

    const payload = {
      ShortCode: process.env.MPESA_SHORTCODE,
      CommandID: "CustomerPayBillOnline",
      Amount: amount,
      Msisdn: msisdn,
      BillRefNumber: billRef,
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

/* =========================
   Quick test endpoint
   ========================= */
const test = async (req, res) => {
  try {
    const results = await initiateSTKPush("+254701057515", 1);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Test " + err.message });
  }
};

module.exports = {
  mpesaValidation,
  mpesaConfirmation,
  mpesaCallback,
  getAccessToken,
  initiateSTKPush,
  registerC2BUrls,
  simulateC2B,
  test,
};
