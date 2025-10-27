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

// ---------- paths for the subscriptions JSON ----------
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

// ---------- M-Pesa OAuth ----------
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

// ---------- C2B Validation / Confirmation (Paybill) ----------
const mpesaValidation = (req, res, next) => {
  // Add your business rules here (e.g., validate BillRefNumber pattern)
  const accept = true;
  if (accept) {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });
  } else {
    res.status(200).json({ ResultCode: 1, ResultDesc: "Cancelled" });
  }
};

const mpesaConfirmation = async (req, res, next) => {
  try {
    const tx = req.body;

    // ACK immediately so Safaricom doesn't retry due to timeout
    res.status(200).json({ ResultCode: 0, ResultDesc: "Completed" });

    // Optionally notify an internal service (non-blocking best-effort)
    try {
      await axios.post(
        "https://your-service.example.com/internal/payment-webhook",
        tx,
        { timeout: 5000 }
      );
    } catch (e) {
      console.warn("Downstream webhook failed:", e.message);
    }

    // If this is classic C2B confirmation payload, map and write to updatedSubscriptions
    // Expected keys: TransID, TransAmount, BillRefNumber
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
  } catch (err) {
    console.error("processing error", err);
    // already ACKed
  }
};

// ---------- STK Push Initiation ----------
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

    // IMPORTANT: If you want per-customer "customerAccount",
    // pass it here as AccountReference dynamically.
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

    // Pre-log a PENDING record keyed by CheckoutRequestID (also store AccountReference!)
    try {
      await appendTransaction({
        Status: "PENDING",
        PhoneNumber: user_phone,
        Amount: amount,
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        AccountReference, // keep it so we can map to customerAccount later
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

// ---------- STK Push Callback (C2B from customer's phone) ----------
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

    // If SUCCESS, also write to logs/updatedSubscriptions.json
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

      const entry = {
        transactionId: String(transaction.MpesaReceiptNumber || ""),
        customerAccount: String(accountRef),
        amount: String(transaction.Amount || ""),
      };

      if (entry.transactionId && entry.amount) {
        await upsertUpdatedSubscription(entry);
      } else {
        console.warn(
          "Skipping updatedSubscriptions write due to missing fields:",
          entry
        );
      }
    }

    res.status(200).json({ message: "Callback processed" });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ---------- Test endpoint ----------
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
  test,
};
