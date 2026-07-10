#!/usr/bin/env node
/**
 * One-time import of legacy JSON/JSONL logs into MySQL.
 * Usage: node scripts/import-logs-to-mysql.js
 */
require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const { query } = require("../api/config/db");
const { readJsonLineEntries } = require("../api/utils/appendJsonLine");
const {
  materializeTransactionsFromTrail,
} = require("../api/services/transactionStore");

const LOGS = path.join(__dirname, "..", "logs");

async function importMpesa() {
  const trailFile = path.join(LOGS, "transactions-trail.jsonl");
  const jsonFile = path.join(LOGS, "transactions.json");
  let txns = [];

  try {
    const trail = await readJsonLineEntries(trailFile);
    if (trail.length) {
      txns = materializeTransactionsFromTrail(trail);
    }
  } catch {
    /* no trail */
  }

  if (!txns.length) {
    try {
      const raw = await fs.readFile(jsonFile, "utf8");
      const parsed = JSON.parse(raw || "[]");
      if (Array.isArray(parsed)) txns = parsed;
    } catch {
      /* no json */
    }
  }

  let imported = 0;
  for (const txn of txns) {
    if (!txn.CheckoutRequestID) continue;
    const existing = await query(
      `SELECT id FROM payment_transactions WHERE checkout_request_id = ? LIMIT 1`,
      [txn.CheckoutRequestID]
    );
    if (existing.length) continue;

    await query(
      `INSERT INTO payment_transactions
        (checkout_request_id, merchant_request_id, mpesa_receipt, phone, amount,
         account_reference, status, result_code, result_desc, transaction_date, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        txn.CheckoutRequestID,
        txn.MerchantRequestID || null,
        txn.MpesaReceiptNumber || null,
        txn.PhoneNumber ? String(txn.PhoneNumber) : null,
        txn.Amount != null ? Number(txn.Amount) : null,
        txn.AccountReference || null,
        txn.Status || "PENDING",
        txn.ResultCode != null ? Number(txn.ResultCode) : null,
        txn.ResultDesc || null,
        txn.TransactionDate ? String(txn.TransactionDate) : null,
        JSON.stringify(txn),
      ]
    );
    imported++;
  }
  console.log(`M-Pesa: imported ${imported} transactions`);
}

async function importJsonl(file, source, mapRow) {
  let imported = 0;
  try {
    const rows = await readJsonLineEntries(file);
    for (const row of rows) {
      const mapped = mapRow(row);
      if (!mapped) continue;
      await query(
        `INSERT INTO integration_events
          (source, status, customer_no, amount, reference_id, outcome, channel, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          source,
          mapped.status,
          mapped.customerNo,
          mapped.amount,
          mapped.referenceId,
          mapped.outcome,
          mapped.channel,
          JSON.stringify(row),
        ]
      );
      imported++;
    }
  } catch (e) {
    console.log(`${source}: no file or empty (${e.message})`);
    return;
  }
  console.log(`${source}: imported ${imported} events`);
}

async function main() {
  await importMpesa();
  await importJsonl(
    path.join(LOGS, "zoho-mpesa-payments.jsonl"),
    "zoho",
    (row) => ({
      status: row.result?.paid ? "paid" : "failed",
      customerNo: row.accountRef || null,
      amount: row.amount,
      referenceId: row.transactionId || row.result?.invoice_id || null,
      outcome: row.result?.reason || (row.result?.paid ? "paid" : "failed"),
      channel: row.channel || null,
    })
  );
  await importJsonl(
    path.join(LOGS, "tisp-set-isp-payment.jsonl"),
    "tisp",
    (row) => ({
      status: row.outcome === "success" ? "success" : "failed",
      customerNo: row.customer_no || row.accountRef || null,
      amount: row.amount,
      referenceId: row.transactionId || null,
      outcome: row.outcome || "unknown",
      channel: row.channel || row.source || null,
    })
  );
  console.log("Import complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
