const moment = require("moment");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const writeFile = promisify(fs.writeFile);

const transactionsFile = path.join(__dirname, "../../logs/transactions.json");

// Call back for all C2B payments - Client pays Business
const mpesaCallback = async (req, res) => {
  try {
    const callback = req.body.Body.stkCallback;

    const transaction = {
      MerchantRequestID: callback.MerchantRequestID,
      CheckoutRequestID: callback.CheckoutRequestID,
      ResultCode: callback.ResultCode,
      ResultDesc: callback.ResultDesc,
      Timestamp: new Date().toISOString(),
    };

    // Extract metadata only if payment is successful
    if (callback.ResultCode === 0) {
      const metadata = callback.CallbackMetadata?.Item || [];

      const getItemValue = (name) =>
        metadata.find((item) => item.Name === name)?.Value;

      transaction.Amount = getItemValue("Amount");
      transaction.MpesaReceiptNumber = getItemValue("MpesaReceiptNumber");
      transaction.TransactionDate = getItemValue("TransactionDate");
      transaction.PhoneNumber = getItemValue("PhoneNumber");

      // ✅ Add logic here: update DB, activate service, etc.
      console.log(`✅ Payment confirmed for ${transaction.PhoneNumber}`);
    } else {
      console.log(`❌ Payment failed: ${callback.ResultDesc}`);
    }

    // Read and update transaction log file
    let existing = [];
    try {
      const content = await readFile(transactionsFile, "utf8");
      existing = JSON.parse(content);
    } catch (readErr) {
      console.warn("Could not read existing log file:", readErr.message);
    }

    existing.push(transaction);

    await writeFile(
      transactionsFile,
      JSON.stringify(existing, null, 2),
      "utf8"
    );

    res.status(200).json({ message: "Callback received and processed" });
  } catch (error) {
    console.error("Callback processing error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

const getAccessToken = async () => {
  try {
    const secret_key = process.env.MPESA_CONSUMER_SECRET;
    const consumer_key = process.env.MPESA_CONSUMER_KEY;

    const auth = Buffer.from(`${consumer_key}:${secret_key}`).toString(
      "base64"
    );

    const config = {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    };

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      config
    );

    return response.data.access_token; // return the token
  } catch (error) {
    console.error("Error getting access token:", error.message);
    throw error; // Propagate the error to the caller
  }
};

const initiateSTKPush = async (phone, amount) => {
  try {
    const token = await getAccessToken();

    const config = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    let user_phone = phone.replace(/^(\+|0)+/, "");
    const Timestamp = moment().format("YYYYMMDDHHmmss");
    const shortcode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASS_KEY;
    const password = new Buffer.from(shortcode + passkey + Timestamp).toString(
      "base64"
    );

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: `${user_phone}`,
      PartyB: shortcode,
      PhoneNumber: `${user_phone}`,
      CallBackURL: "https://app.sulsolutions.biz/api/mpesa/callback",
      AccountReference: "Test",
      TransactionDesc: "Test",
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      config
    );

    return response.data;
  } catch (error) {
    console.error("STK Push Error:", error.message);
    return { error: "Initiate STKPush" + user_phone + error.message };
  }
};

const test = async (req, res) => {
  try {
    const results = await initiateSTKPush("+254701057515", 1);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Test" + err.message });
  }
};

module.exports = {
  mpesaCallback,
  getAccessToken,
  initiateSTKPush,
  test,
};
