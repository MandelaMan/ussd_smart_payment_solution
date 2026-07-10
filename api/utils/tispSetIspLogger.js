const { insertIntegrationEvent } = require("../services/integrationEventStore");
const { logActivity } = require("../services/activityLogStore");

/**
 * Log a TISP SetISPPayment attempt to MySQL + dashboard activity feed.
 */
async function logSetIspPaymentAttempt(entry) {
  const outcome = entry.outcome || "unknown";
  const status =
    outcome === "success"
      ? "success"
      : outcome === "skipped_duplicate"
        ? "skipped"
        : "failed";

  const customerRef =
    entry.customer_no ||
    entry.customerNo ||
    entry.accountRef ||
    entry.customerAccount ||
    null;
  const amount = entry.amount;
  const referenceId =
    entry.transactionId || entry.mpesaReceipt || entry.transKey || null;

  await insertIntegrationEvent({
    source: "tisp",
    status,
    customerNo: customerRef,
    amount,
    referenceId,
    outcome,
    channel: entry.channel || entry.source || null,
    checkoutRequestId: entry.checkoutRequestId || null,
    rawPayload: entry,
  });

  if (outcome === "skipped_duplicate") return;

  const ok = outcome === "success";
  try {
    await logActivity({
      eventType: ok ? "tisp_reconnected" : "tisp_reconnect_failed",
      title: ok
        ? "Customer reconnected on TISP"
        : "TISP reconnection failed",
      message: ok
        ? `Service restored for ${customerRef || "customer"}`
        : entry.errorMessage || "SetISPPayment request failed",
      source: "tisp",
      status: ok ? "success" : "failed",
      customerRef,
      amount,
      referenceId,
      checkoutRequestId: entry.checkoutRequestId || null,
      metadata: { outcome, channel: entry.channel || entry.source },
    });
  } catch (e) {
    console.error("activity log (tisp) failed:", e.message);
  }
}

async function readTispSetIspLog() {
  const { listIntegrationEvents } = require("../services/integrationEventStore");
  const result = await listIntegrationEvents({ source: "tisp", limit: 1000, page: 1 });
  return result.data.map((e) => ({
    loggedAt: e.createdAt,
    outcome: e.outcome,
    ...e.payload,
  }));
}

module.exports = {
  logSetIspPaymentAttempt,
  readTispSetIspLog,
};
