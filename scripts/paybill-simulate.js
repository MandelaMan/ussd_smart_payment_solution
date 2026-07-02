#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Paybill (C2B) simulation — runs the same handler as POST /api/payment/confirmation.
 *
 * Default: customer ET-333-TEST, KES 3900, sandbox MSISDN.
 * Uses reconcileZohoInvoiceBeforeISP (mark existing unpaid invoice paid) then TISP/ISP
 * exactly as production mpesaConfirmation does.
 *
 * Usage:
 *   yarn paybill:simulate
 *   yarn paybill:simulate -- --bill-ref ET-333-TEST --amount 3900 --msisdn 254708374149
 *
 * Log: logs/paybill-simulate.jsonl (append-only, one JSON line per run)
 */
require("dotenv").config();

const path = require("path");
const moment = require("moment-timezone");
const { appendJsonLine } = require("../api/utils/appendJsonLine");
const { mpesaConfirmation } = require("../api/controllers/mpesa.controller");
const {
  getCustomerByCompanyName_JS,
  getInvoices_JS,
} = require("../api/controllers/zoho.controller");

const ROOT = path.resolve(__dirname, "..");
const LOG_FILE = path.join(ROOT, "logs", "paybill-simulate.jsonl");
const TZ = "Africa/Nairobi";

function usage() {
  console.log(`Paybill C2B simulation (uses production mpesaConfirmation handler)

Options:
  --bill-ref <ref>   Account / bill reference (default: ET-333-TEST)
  --amount <kes>     Payment amount in KES (default: 3900)
  --msisdn <phone>   Customer phone, no + prefix (default: 254708374149)
  --help             Show this help

Environment:
  MPESA_SHORTCODE    Paybill shortcode (required in payload)
  ZOHO_*             Zoho Books API credentials
  ISP_PAYMENT_URL    TISP SetISPPayment endpoint (may fail in dry runs)

Log file: ${LOG_FILE}
`);
}

function parseArgs(argv) {
  const opts = {
    billRef: process.env.PAYBILL_SIM_BILL_REF || "ET-333-TEST",
    amount: Number(process.env.PAYBILL_SIM_AMOUNT || 3900),
    msisdn: process.env.PAYBILL_SIM_MSISDN || "254708374149",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--bill-ref" && argv[i + 1]) {
      opts.billRef = String(argv[++i]).trim();
      continue;
    }
    if (arg === "--amount" && argv[i + 1]) {
      opts.amount = Number(argv[++i]);
      continue;
    }
    if (arg === "--msisdn" && argv[i + 1]) {
      opts.msisdn = String(argv[++i]).replace(/^(\+|0)+/, "");
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }

  if (!opts.billRef) throw new Error("bill-ref is required");
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  if (!opts.msisdn) throw new Error("msisdn is required");

  return opts;
}

function summarizeInvoice(inv) {
  if (!inv) return null;
  return {
    invoice_id: inv.invoice_id,
    invoice_number: inv.invoice_number,
    order_number: inv.order_number || inv.reference_number || null,
    status: inv.status,
    total: inv.total,
    balance: inv.balance,
    date: inv.date,
  };
}

async function snapshotZoho(companyName) {
  const name = String(companyName || "").trim();
  const customer = await getCustomerByCompanyName_JS(name);

  if (!customer || typeof customer === "string" || !customer.contact_id) {
    return {
      companyName: name,
      customerFound: false,
      customerError: typeof customer === "string" ? customer : null,
      customer: null,
      invoices: [],
      unpaidInvoices: [],
    };
  }

  const invoices = await getInvoices_JS({
    customer_id: customer.contact_id,
    per_page: 200,
    page: 1,
  });
  const list = Array.isArray(invoices) ? invoices : [];
  const unpaidInvoices = list.filter((inv) => {
    const status = String(inv?.status || "").toLowerCase();
    const balance = Number(inv?.balance);
    return (
      status !== "paid" &&
      (!Number.isFinite(balance) || balance > 0)
    );
  });

  return {
    companyName: name,
    customerFound: true,
    customer: {
      contact_id: customer.contact_id,
      company_name:
        customer.company_name || customer.customer_name || customer.contact_name,
      email: customer.email || null,
    },
    invoices: list.map(summarizeInvoice),
    unpaidInvoices: unpaidInvoices.map(summarizeInvoice),
  };
}

function buildC2BConfirmationPayload(opts) {
  const now = moment.tz(TZ);
  const transId = `SIM${now.format("YYYYMMDDHHmmss")}${String(Math.floor(Math.random() * 900) + 100)}`;

  return {
    TransactionType: "Pay Bill",
    TransID: transId,
    TransTime: now.format("YYYYMMDDHHmmss"),
    TransAmount: String(opts.amount),
    BusinessShortCode: String(process.env.MPESA_SHORTCODE || ""),
    BillRefNumber: opts.billRef,
    InvoiceNumber: opts.billRef,
    OrgAccountBalance: "0.00",
    ThirdPartyTransID: "",
    MSISDN: opts.msisdn,
    FirstName: "SIM",
    MiddleName: "",
    LastName: "CUSTOMER",
  };
}

function createMockResponse() {
  let statusCode = 200;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
      return this;
    },
    getStatus() {
      return statusCode;
    },
    getBody() {
      return body;
    },
  };
}

function inferZohoOutcome(before, after) {
  const beforeUnpaid = before.unpaidInvoices?.length || 0;
  const afterUnpaid = after.unpaidInvoices?.length || 0;
  const beforeIds = new Set(
    (before.invoices || []).map((i) => String(i.invoice_id))
  );
  const newInvoices = (after.invoices || []).filter(
    (i) => !beforeIds.has(String(i.invoice_id))
  );
  const newlyPaid = (before.unpaidInvoices || []).filter((beforeInv) => {
    const afterInv = (after.invoices || []).find(
      (i) => String(i.invoice_id) === String(beforeInv.invoice_id)
    );
    if (!afterInv) return false;
    const afterBal = Number(afterInv.balance);
    const afterStatus = String(afterInv.status || "").toLowerCase();
    return afterStatus === "paid" || afterBal === 0;
  });

  let summary = "no_change_detected";
  if (newInvoices.length > 0) summary = "invoice_created";
  else if (newlyPaid.length > 0) summary = "invoice_marked_paid";
  else if (beforeUnpaid > afterUnpaid) summary = "unpaid_count_reduced";

  return {
    summary,
    newlyPaidInvoices: newlyPaid.map(summarizeInvoice),
    newInvoices: newInvoices.map(summarizeInvoice),
    unpaidBefore: beforeUnpaid,
    unpaidAfter: afterUnpaid,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const payment = buildC2BConfirmationPayload(opts);

  console.log("[paybill-sim] starting");
  console.log("[paybill-sim] bill ref:", opts.billRef);
  console.log("[paybill-sim] amount:", opts.amount);
  console.log("[paybill-sim] trans id:", payment.TransID);

  const started = Date.now();
  const zohoBefore = await snapshotZoho(opts.billRef);
  console.log(
    "[paybill-sim] zoho before:",
    zohoBefore.customerFound
      ? `${zohoBefore.unpaidInvoices.length} unpaid invoice(s)`
      : "customer not found"
  );

  const req = {
    body: payment,
    headers: { "x-paybill-simulation": "scripts/paybill-simulate.js" },
  };
  const res = createMockResponse();

  await mpesaConfirmation(req, res);

  const ack = res.getBody();
  const zohoPaymentResult = req._zohoPaymentResult || null;
  const zohoAfter = await snapshotZoho(opts.billRef);
  const zohoOutcome = inferZohoOutcome(zohoBefore, zohoAfter);

  const entry = {
    loggedAt: new Date().toISOString(),
    event: "paybill_simulation",
    ok: ack?.ResultCode === 0,
    durationMs: Date.now() - started,
    input: {
      billRef: opts.billRef,
      amount: opts.amount,
      msisdn: opts.msisdn,
    },
    payment: {
      TransID: payment.TransID,
      TransTime: payment.TransTime,
      TransAmount: payment.TransAmount,
      BillRefNumber: payment.BillRefNumber,
      MSISDN: payment.MSISDN,
      BusinessShortCode: payment.BusinessShortCode,
    },
    ack,
    zohoPaymentResult,
    zohoBefore,
    zohoAfter,
    zohoOutcome,
    notes: [
      "Handler: mpesaConfirmation (same as POST /api/payment/confirmation)",
      "Zoho: reconcileZohoInvoiceBeforeISP, then createZohoInvoiceForPayment if no match",
      "TISP/ISP post runs after Zoho; failures are logged to console only",
    ],
  };

  await appendJsonLine(LOG_FILE, entry);

  console.log("\n[paybill-sim] ack:", JSON.stringify(ack));
  if (zohoPaymentResult) {
    console.log("[paybill-sim] zoho handler:", JSON.stringify(zohoPaymentResult));
  }
  console.log("[paybill-sim] zoho outcome:", zohoOutcome.summary);
  if (zohoOutcome.newlyPaidInvoices.length) {
    console.log(
      "[paybill-sim] paid:",
      zohoOutcome.newlyPaidInvoices.map((i) => i.invoice_number).join(", ")
    );
  }
  if (zohoOutcome.newInvoices.length) {
    console.log(
      "[paybill-sim] created:",
      zohoOutcome.newInvoices.map((i) => i.invoice_number).join(", ")
    );
  }
  console.log(`[paybill-sim] log appended → ${LOG_FILE}`);

  if (!entry.ok) process.exit(1);
}

main().catch((err) => {
  console.error("[paybill-sim] failed:", err.message);
  if (err.response?.data) {
    console.error(JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
