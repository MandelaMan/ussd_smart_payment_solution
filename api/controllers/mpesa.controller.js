// controllers/mpesa.controller.js
const fs = require("fs");
const path = require("path");
const moment = require("moment");
const axios = require("axios");

// ======== Embedded transactions helpers (no external import) ========
const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "transactions.json");

// In-process serialized writes
let _queue = Promise.resolve();
function withLock(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

async function ensureLogFile() {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  try {
    await fs.promises.access(LOG_FILE);
  } catch {
    await fs.promises.writeFile(LOG_FILE, "[]", "utf8");
  }
}

async function readTransactions() {
  await ensureLogFile();
  const data = await fs.promises.readFile(LOG_FILE, "utf8");
  try {
    const parsed = JSON.parse(data || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function safeWriteJSON(filePath, data) {
  const tmpPath = filePath + ".tmp";
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

async function writeTransactions(all) {
  await ensureLogFile();
  return withLock(async () => {
    await safeWriteJSON(LOG_FILE, all);
  });
}

async function appendTransaction(txn) {
  await ensureLogFile();
  return withLock(async () => {
    const all = await readTransactions();
    all.push({ ...txn });
    await safeWriteJSON(LOG_FILE, all);
  });
}

async function upsertByCheckoutId(checkoutId, patch) {
  await ensureLogFile();
  return withLock(async () => {
    const all = await readTransactions();
    const idx = all.findIndex((t) => t.CheckoutRequestID === checkoutId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...patch };
    } else {
      all.push({ ...patch });
    }
    await safeWriteJSON(LOG_FILE, all);
  });
}
// ====================================================================

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

    // normalize phone (2547XXXXXXXX)
    const user_phone = (phone || "").replace(/^(\+|0)+/, "");

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
      AccountReference: "Starlynx Utility",
      TransactionDesc: "Subscription",
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      config
    );

    // Pre-log a PENDING record keyed by CheckoutRequestID
    try {
      await appendTransaction({
        Status: "PENDING",
        PhoneNumber: user_phone,
        Amount: amount,
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
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

// Safaricom STK callback (C2B) — client pays business
const mpesaCallback = async (req, res) => {
  try {
    const body = req.body;
    console.log("M-Pesa callback received:", JSON.stringify(body, null, 2));

    const callback = body?.Body?.stkCallback;
    if (!callback) {
      console.warn("Invalid callback format");
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    // Build the final transaction update
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

    res.status(200).json({ message: "Callback processed" });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const test = async (req, res) => {
  try {
    const results = await initiateSTKPush("+254701057515", 1);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Test " + err.message });
  }
};

module.exports = {
  mpesaCallback,
  getAccessToken,
  initiateSTKPush,
  test,
};
