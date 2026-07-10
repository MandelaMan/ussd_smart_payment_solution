#!/usr/bin/env node
/**
 * Seed realistic dummy payment data for dashboard demos.
 * Usage: node scripts/seed-dummy-data.js
 */
require("dotenv").config();
const { query } = require("../api/config/db");

const CUSTOMERS = [
  { ref: "SLX-1001", phone: "254712345001" },
  { ref: "SLX-1002", phone: "254723456002" },
  { ref: "SLX-1003", phone: "254734567003" },
  { ref: "SLX-1004", phone: "254745678004" },
  { ref: "SLX-1005", phone: "254756789005" },
  { ref: "SLX-1006", phone: "254767890006" },
  { ref: "SLX-1007", phone: "254778901007" },
  { ref: "SLX-1008", phone: "254789012008" },
  { ref: "SLX-1009", phone: "254790123009" },
  { ref: "SLX-1010", phone: "254701234010" },
];

const AMOUNTS = [500, 1000, 1500, 2000, 2500, 3000, 3900, 5000];
const CHANNELS = ["STK", "C2B"];
const STATUSES = ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS", "FAILED", "PENDING"];

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60));
  return d;
}

function checkoutId() {
  return `ws_CO_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function receipt() {
  return `SH${Math.random().toString().slice(2, 10)}`;
}

async function main() {
  const force = process.argv.includes("--force");

  const existing = await query(`SELECT COUNT(*) AS c FROM payment_transactions`);
  const count = Number(existing[0]?.c || 0);

  if (count > 5 && !force) {
    console.log(`Database has ${count} transactions — skipping seed.`);
    console.log("Run with --force to clear and re-seed dummy data.");
    return;
  }

  if (force && count > 0) {
    console.log("Clearing existing transaction data…");
    await query(`DELETE FROM activity_logs`);
    await query(`DELETE FROM integration_events`);
    await query(`DELETE FROM payment_transactions`);
  }

  console.log("Seeding dummy payment data…");
  let inserted = 0;

  // Returning customers: first 6 customers get 2-4 payments each
  for (let i = 0; i < 6; i++) {
    const customer = CUSTOMERS[i];
    const paymentCount = 2 + Math.floor(Math.random() * 3);
    for (let p = 0; p < paymentCount; p++) {
      const status = rand(["SUCCESS", "SUCCESS", "SUCCESS", "FAILED"]);
      const amount = rand(AMOUNTS);
      const days = Math.floor(Math.random() * 28);
      const created = daysAgo(days);
      const checkout = checkoutId();

      const result = await query(
        `INSERT INTO payment_transactions
          (checkout_request_id, merchant_request_id, mpesa_receipt, phone, amount,
           account_reference, status, result_code, result_desc, channel, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkout,
          `mr_${checkout}`,
          status === "SUCCESS" ? receipt() : null,
          customer.phone,
          amount,
          customer.ref,
          status,
          status === "SUCCESS" ? 0 : 1,
          status === "SUCCESS" ? "The service request is processed successfully." : "Request cancelled",
          rand(CHANNELS),
          created,
          created,
        ]
      );

      const txId = result.insertId;
      if (status === "SUCCESS") {
        await query(
          `INSERT INTO integration_events
            (source, payment_transaction_id, status, customer_no, amount, reference_id, outcome, channel, raw_payload, created_at)
           VALUES ('zoho', ?, 'paid', ?, ?, ?, 'paid', ?, '{}', ?)`,
          [txId, customer.ref, amount, receipt(), rand(CHANNELS), created]
        );
        await query(
          `INSERT INTO integration_events
            (source, payment_transaction_id, status, customer_no, amount, reference_id, outcome, channel, raw_payload, created_at)
           VALUES ('tisp', ?, 'success', ?, ?, ?, 'success', ?, '{}', ?)`,
          [txId, customer.ref, amount, receipt(), rand(CHANNELS), created]
        );
      }
      inserted++;
    }
  }

  // One-time customers
  for (let i = 6; i < CUSTOMERS.length; i++) {
    const customer = CUSTOMERS[i];
    const status = rand(STATUSES);
    const amount = rand(AMOUNTS);
    const days = Math.floor(Math.random() * 14);
    const created = daysAgo(days);
    const checkout = checkoutId();

    const result = await query(
      `INSERT INTO payment_transactions
        (checkout_request_id, merchant_request_id, mpesa_receipt, phone, amount,
         account_reference, status, result_code, result_desc, channel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkout,
        `mr_${checkout}`,
        status === "SUCCESS" ? receipt() : null,
        customer.phone,
        amount,
        customer.ref,
        status,
        status === "SUCCESS" ? 0 : status === "PENDING" ? null : 1,
        status === "SUCCESS" ? "Success" : status === "PENDING" ? "Awaiting PIN" : "Failed",
        rand(CHANNELS),
        created,
        created,
      ]
    );

    if (status === "SUCCESS") {
      const txId = result.insertId;
      await query(
        `INSERT INTO integration_events
          (source, payment_transaction_id, status, customer_no, amount, reference_id, outcome, channel, raw_payload, created_at)
         VALUES ('zoho', ?, 'paid', ?, ?, ?, 'paid', ?, '{}', ?)`,
        [txId, customer.ref, amount, receipt(), rand(CHANNELS), created]
      );
      await query(
        `INSERT INTO integration_events
          (source, payment_transaction_id, status, customer_no, amount, reference_id, outcome, channel, raw_payload, created_at)
         VALUES ('tisp', ?, 'success', ?, ?, ?, 'success', ?, '{}', ?)`,
        [txId, customer.ref, amount, receipt(), rand(CHANNELS), created]
      );
    }
    inserted++;
  }

  // Extra random transactions for chart density
  for (let i = 0; i < 25; i++) {
    const customer = rand(CUSTOMERS);
    const status = rand(STATUSES);
    const amount = rand(AMOUNTS);
    const days = Math.floor(Math.random() * 30);
    const created = daysAgo(days);
    const checkout = checkoutId();

    const result = await query(
      `INSERT INTO payment_transactions
        (checkout_request_id, mpesa_receipt, phone, amount, account_reference, status,
         result_code, result_desc, channel, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkout,
        status === "SUCCESS" ? receipt() : null,
        customer.phone,
        amount,
        customer.ref,
        status,
        status === "SUCCESS" ? 0 : 1,
        status === "SUCCESS" ? "Success" : "Failed",
        rand(CHANNELS),
        created,
        created,
      ]
    );

    if (status === "SUCCESS" && Math.random() > 0.2) {
      const txId = result.insertId;
      const zohoOk = Math.random() > 0.15;
      await query(
        `INSERT INTO integration_events
          (source, payment_transaction_id, status, customer_no, amount, outcome, channel, raw_payload, created_at)
         VALUES ('zoho', ?, ?, ?, ?, ?, ?, '{}', ?)`,
        [txId, zohoOk ? "paid" : "failed", customer.ref, amount, zohoOk ? "paid" : "customer_not_found", rand(CHANNELS), created]
      );
      const tispOk = Math.random() > 0.1;
      await query(
        `INSERT INTO integration_events
          (source, payment_transaction_id, status, customer_no, amount, outcome, channel, raw_payload, created_at)
         VALUES ('tisp', ?, ?, ?, ?, ?, ?, '{}', ?)`,
        [txId, tispOk ? "success" : "failed", customer.ref, amount, tispOk ? "success" : "failure", rand(CHANNELS), created]
      );
    }
    inserted++;
  }

  console.log(`Seeded ${inserted} M-Pesa transactions with integration events.`);

  const { execSync } = require("child_process");
  execSync("node scripts/backfill-activity.js", { stdio: "inherit", cwd: require("path").join(__dirname, "..") });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
