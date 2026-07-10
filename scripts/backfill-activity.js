#!/usr/bin/env node
/**
 * Backfill activity_logs from existing transactions and integration events.
 */
require("dotenv").config();
const { query } = require("../api/config/db");
const { logActivity } = require("../api/services/activityLogStore");

async function main() {
  const existing = await query(`SELECT COUNT(*) AS c FROM activity_logs`);
  if (Number(existing[0]?.c || 0) > 0) {
    console.log("Activity logs already exist — use seed --force to rebuild.");
    return;
  }

  const payments = await query(
    `SELECT * FROM payment_transactions ORDER BY created_at ASC`
  );

  for (const p of payments) {
    const ok = p.status === "SUCCESS";
    await logActivity({
      eventType: ok ? "payment_received" : "payment_failed",
      title: ok ? "Payment received" : "Payment failed",
      message: ok
        ? `M-Pesa ${p.mpesa_receipt || "payment"} from ${p.phone || "customer"}`
        : p.result_desc || "Payment not completed",
      source: "mpesa",
      status: ok ? "success" : "failed",
      customerRef: p.account_reference,
      amount: p.amount,
      referenceId: p.mpesa_receipt,
      checkoutRequestId: p.checkout_request_id,
      metadata: { channel: p.channel, backfill: true },
    });
  }

  const events = await query(`SELECT * FROM integration_events ORDER BY created_at ASC`);
  for (const e of events) {
    if (e.source === "zoho") {
      const paid = e.status === "paid";
      await logActivity({
        eventType: paid ? "zoho_invoice_updated" : "zoho_invoice_failed",
        title: paid ? "Zoho invoice updated" : "Zoho invoice failed",
        message: paid
          ? `Invoice processed for ${e.customer_no || "customer"}`
          : e.outcome || "Zoho sync failed",
        source: "zoho",
        status: paid ? "success" : "failed",
        customerRef: e.customer_no,
        amount: e.amount,
        referenceId: e.reference_id,
        metadata: { backfill: true },
      });
    } else if (e.source === "tisp") {
      const ok = e.outcome === "success";
      if (e.outcome === "skipped_duplicate") continue;
      await logActivity({
        eventType: ok ? "tisp_reconnected" : "tisp_reconnect_failed",
        title: ok ? "Customer reconnected on TISP" : "TISP reconnection failed",
        message: ok
          ? `Service restored for ${e.customer_no || "customer"}`
          : e.outcome || "Reconnection failed",
        source: "tisp",
        status: ok ? "success" : "failed",
        customerRef: e.customer_no,
        amount: e.amount,
        referenceId: e.reference_id,
        metadata: { backfill: true },
      });
    }
  }

  const count = await query(`SELECT COUNT(*) AS c FROM activity_logs`);
  console.log(`Backfilled ${count[0].c} activity log entries.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
