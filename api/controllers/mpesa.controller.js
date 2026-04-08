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
} = require("../../utils/transactions");
const { logSetIspPaymentAttempt } = require("../utils/tispSetIspLogger");

// 👇 ADD: import Zoho helpers (adjust path if needed)
const {
  getCustomerByCompanyName_JS,
  createInvoice_JS,
} = require("./zoho.controller"); // or "../zoho/zoho.controller" etc.
const { postSetISPPayment } = require("./tisp.controller");

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

/** ISP endpoints */
const ISP_PAYMENT_URL =
  process.env.ISP_PAYMENT_URL ||
  "https://daraja.teqworthsystems.com/starlynxservice/WebISPService.svc/SetISPPayment";

/** Optional Zoho template id to use when creating invoices */
const ZOHO_INVOICE_TEMPLATE_ID = process.env.ZOHO_INVOICE_TEMPLATE_ID || null;

/* ================================================================== */
/*                       FILE STORAGE (light)                          */
/* ================================================================== */
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
      });
    }
    throw e;
  }
}

/* ================================================================== */
/*                   ZOHO INVOICE INTEGRATION HELPERS                  */
/* ================================================================== */

/**
 * Create a Zoho invoice for a given M-Pesa payment.
 * - Uses companyName (e.g. ET-..., CL-...) to look up the Zoho customer
 * - Creates a simple one-line invoice: Amount x 1, with description
 */
async function createZohoInvoiceForPayment({
  companyName,
  amount,
  transactionId,
  source,
}) {
  try {
    if (!companyName || !amount) {
      console.warn(
        "createZohoInvoiceForPayment: missing companyName or amount",
        { companyName, amount }
      );
      return;
    }

    console.log(
      "Zoho invoice: looking up customer by companyName:",
      companyName
    );
    const customer = await getCustomerByCompanyName_JS(companyName);

    if (!customer || typeof customer === "string") {
      console.error(
        "Zoho invoice: customer lookup failed",
        customer || "No customer returned"
      );
      return;
    }

    const customer_id = customer.contact_id;
    if (!customer_id) {
      console.error(
        "Zoho invoice: customer has no contact_id",
        JSON.stringify(customer)
      );
      return;
    }

    const numericAmount = Number(amount);
    if (!numericAmount || Number.isNaN(numericAmount)) {
      console.error("Zoho invoice: invalid amount", amount);
      return;
    }

    const description = `M-Pesa Paybill payment for ${companyName} (Tx: ${
      transactionId || "N/A"
    }) via ${source}`;

    const items = [
      {
        // You can drop item_id and just create an ad-hoc line item
        name: `Subscription payment - ${companyName}`,
        rate: numericAmount,
        quantity: 1,
        description,
      },
    ];

    const payload = {
      customer_id,
      items,
      template_id: ZOHO_INVOICE_TEMPLATE_ID || undefined,
    };

    console.log("Zoho invoice: creating invoice with payload:", payload);

    const invoice = await createInvoice_JS(payload);

    if (!invoice) {
      console.error("Zoho invoice: createInvoice_JS returned null");
      return;
    }

    console.log(
      "Zoho invoice created for company:",
      companyName,
      "invoice_id:",
      invoice.invoice_id
    );
  } catch (err) {
    console.error(
      "createZohoInvoiceForPayment error:",
      err?.response?.data || err.message
    );
  }
}

/* ================================================================== */
/*            C2B Validation / Confirmation (Paybill)                  */
/* ================================================================== */
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

    // Example rule: references like ET-... and amount >= 1
    if (!/^ET-\w+/i.test(ref) || amount < 1) {
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
    const accountRef =
      tx.BillRefNumber ||
      tx.AccountReference ||
      tx.accountReference ||
      process.env.DEFAULT_ACCOUNT_REFERENCE ||
      "Starlynx Utility";

    const ispPayload = buildISPPayloadFromConfirmation({
      ...tx,
      BusinessShortCode: shortCode,
      BillRefNumber: accountRef,
      MSISDN: msisdn,
      TransTime: transTime,
      TransAmount: amount,
      TransID: transactionId,
    });

    // 3) Forward to ISP (SetISPPayment); updatedSubscriptions only if this succeeds
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

    // 4) Create Zoho invoice for this Paybill transaction
    try {
      // Here we treat accountRef as the company_name used in Zoho
      await createZohoInvoiceForPayment({
        companyName: accountRef,
        amount,
        transactionId,
        source: "C2B",
      });
    } catch (e) {
      console.error("Zoho invoice creation failed (C2B):", e.message);
    }
  } catch (err) {
    console.error("C2B processing error", err);
    // already ACKed above
  }
};

/* ================================================================== */
/*                         STK Push Initiation                         */
/* ================================================================== */
const initiateSTKPush = async (accountNumber, phone, amount) => {
  try {
    // Dev/pre-production: always charge 1 KES. TODO(live): use Math.round(Number(amount)) when going live.
    const stkAmount = 1;
    const rawAmount = Number(amount);
    if (Number.isFinite(rawAmount) && rawAmount !== stkAmount) {
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

    // Update existing PENDING by CheckoutRequestID; if not found, append
    await upsertByCheckoutId(transaction.CheckoutRequestID, transaction);

    // If SUCCESS, persist FULL tx + POST to ISP + create Zoho invoice
    if (transaction.Status === "SUCCESS") {
      // fetch the pre-logged record to retrieve original AccountReference
      const existing =
        (await findLatestTxnByCheckoutOrPhone(
          transaction.CheckoutRequestID,
          transaction.PhoneNumber
        )) || {};

      // Use the exact same AccountReference from STK initiation
      const accountRef = existing.AccountReference
        ? String(existing.AccountReference)
        : process.env.DEFAULT_ACCOUNT_REFERENCE || "Starlynx Utility";

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
          });
          tispOk = true;
        } else {
          await postSetISPPayment(ispPayload);
          if (idemKey) _postedTransIds.add(idemKey);
          tispOk = true;
        }
      } catch (e) {
        console.error(
          "TISP SetISPPayment failed (STK)",
          e?.response?.data || e.message,
        );
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

      // Create Zoho invoice for this STK payment as well
      try {
        await createZohoInvoiceForPayment({
          companyName: accountRef, // treat as company_name in Zoho
          amount: transaction.Amount,
          transactionId: transaction.MpesaReceiptNumber,
          source: "STK",
        });
      } catch (e) {
        console.error("Zoho invoice creation failed (STK):", e.message);
      }
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
  getAccessToken,
  initiateSTKPush,
  test,
};
