// controllers/mpesa.controller.js
const moment = require("moment");
const axios = require("axios");
const {
  appendTransaction,
  upsertByCheckoutId,
} = require("../../utils/transactions");

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

const mpesaValidation = (req, res, next) => {
  const tx = req.body;
  // decide whether to accept transaction
  const accept = true; // implement business rules here
  if (accept) {
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  } else {
    res.status(200).json({ ResultCode: 1, ResultDesc: "Rejected" });
  }
};

const mpesaConfirmation = async (req, res, next) => {
  try {
    const tx = req.body;
    // 1) Immediately ACK to Safaricom (important)
    res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

    // 2) Server-side processing (do not block the ACK)
    // e.g., insert transaction into DB (pseudo)
    // await db.insertTransaction(tx);

    // 3) Trigger other functions: call a webhook, enqueue a job, send receipt, etc.
    // Example: notify your order service
    await axios.post(
      "https://your-service.example.com/internal/payment-webhook",
      tx,
      { timeout: 5000 }
    );

    // or enqueue for background workers
    // await queue.add('processPayment', tx);
  } catch (err) {
    // If your internal calls fail, log and handle; Safaricom will retry sending the notification.
    console.error("processing error", err);
  }
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
  mpesaValidation,
  mpesaConfirmation,
  mpesaCallback,
  getAccessToken,
  initiateSTKPush,
  test,
};
