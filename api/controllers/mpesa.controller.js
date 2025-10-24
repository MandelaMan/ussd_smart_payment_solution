// controllers/mpesa.controller.js
const moment = require("moment");
const axios = require("axios");
const {
  readTransactions,
  writeTransactions,
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
      AccountReference: "Starlynx",
      TransactionDesc: "Subscription",
    };

    const { data } = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      config
    );

    // Optionally pre-log a 'PENDING' record so USSD can show something immediately
    try {
      const all = await readTransactions();
      all.push({
        Status: "PENDING",
        PhoneNumber: user_phone,
        Amount: amount,
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        ResultCode: null,
        ResultDesc: "Awaiting customer PIN",
        Timestamp: new Date().toISOString(),
      });
      await writeTransactions(all);
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
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
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

      console.log(`✅ Payment confirmed for ${transaction.PhoneNumber}`);
    } else {
      // Failure or timeout
      transaction.Status = "FAILED";
      console.log(`❌ Payment failed: ${callback.ResultDesc}`);
    }

    // Read, append (and optionally collapse/replace earlier PENDING by same CheckoutRequestID)
    const all = await readTransactions();

    const idx = all.findIndex(
      (t) => t.CheckoutRequestID === transaction.CheckoutRequestID
    );
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...transaction };
    } else {
      all.push(transaction);
    }

    await writeTransactions(all);

    res.status(200).json({ message: "Callback received and processed" });
  } catch (error) {
    console.error("Callback processing error:", error);
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
