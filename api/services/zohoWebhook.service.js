const { query } = require("../config/db");
const { fetchZohoRecord } = require("../services/zoho/zohoListApi");
const zohoEntityRepo = require("../repositories/zohoEntity.repository");
const { recordZohoApiUsage } = require("../lib/zohoApiUsage");
const { syncLog } = require("../lib/structuredLogger");

async function logWebhookEvent({ eventType, zohoRecordId, payload, status, errorMessage, apiCallsUsed = 0 }) {
  try {
    await query(
      `INSERT INTO zoho_webhook_events
        (event_type, zoho_record_id, payload, status, error_message, api_calls_used, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        zohoRecordId,
        JSON.stringify(payload || {}),
        status,
        errorMessage || null,
        apiCallsUsed,
        status === "processed" ? new Date() : null,
      ]
    );
  } catch (err) {
    syncLog.warn("zoho_webhook_log_failed", { error: err.message });
  }
}

function detectEventType(body) {
  if (!body || typeof body !== "object") return { type: "unknown", record: null };

  if (body.invoice?.invoice_id || body.invoice_id) {
    return { type: "invoice", record: body.invoice || body };
  }
  if (body.contact?.contact_id || body.contact_id) {
    return { type: "contact", record: body.contact || body };
  }
  if (body.payment?.payment_id || body.customerpayment?.payment_id) {
    return { type: "payment", record: body.payment || body.customerpayment || body };
  }
  if (body.estimate?.estimate_id) {
    return { type: "estimate", record: body.estimate };
  }
  if (body.creditnote?.creditnote_id) {
    return { type: "creditnote", record: body.creditnote };
  }

  const eventName = String(body.event_name || body.event || body.action || "").toLowerCase();
  if (eventName.includes("invoice")) return { type: "invoice", record: body.data || body };
  if (eventName.includes("contact")) return { type: "contact", record: body.data || body };
  if (eventName.includes("payment")) return { type: "payment", record: body.data || body };

  return { type: "unknown", record: body };
}

async function fetchFullRecordIfNeeded(type, record) {
  const id =
    record?.invoice_id ||
    record?.contact_id ||
    record?.payment_id ||
    record?.estimate_id ||
    record?.creditnote_id;

  if (!id) return record;

  const hasDetail = record.last_modified_time || record.status || record.total != null;
  if (hasDetail && Object.keys(record).length > 4) return record;

  const resourceMap = {
    invoice: "invoices",
    contact: "contacts",
    payment: "customerpayments",
    estimate: "estimates",
    creditnote: "creditnotes",
  };
  const resource = resourceMap[type];
  if (!resource) return record;

  try {
    const full = await fetchZohoRecord(resource, id);
    await recordZohoApiUsage({ module: "webhook", source: "webhook", count: 1 });
    return full || record;
  } catch (err) {
    syncLog.warn("zoho_webhook_fetch_failed", { type, id, error: err.message });
    return record;
  }
}

async function upsertFromWebhook(type, record) {
  switch (type) {
    case "contact":
      return zohoEntityRepo.upsertContactRecord(record);
    case "invoice":
      return zohoEntityRepo.upsertInvoiceRecord(record);
    case "payment":
      return zohoEntityRepo.upsertPaymentRecord(record);
    case "estimate":
      return zohoEntityRepo.upsertEstimateRecord(record);
    case "creditnote":
      return zohoEntityRepo.upsertCreditNoteRecord(record);
    default:
      return { updated: false, reason: "unsupported_type" };
  }
}

async function processZohoWebhookPayload(body) {
  const { type, record } = detectEventType(body);
  if (type === "unknown" || !record) {
    await logWebhookEvent({
      eventType: "unknown",
      payload: body,
      status: "ignored",
    });
    return { ok: true, handled: false, reason: "unknown_event" };
  }

  let apiCallsUsed = 0;
  try {
    const fullRecord = await fetchFullRecordIfNeeded(type, record);
    if (fullRecord !== record) apiCallsUsed = 1;

    const upsert = await upsertFromWebhook(type, fullRecord);
    await logWebhookEvent({
      eventType: type,
      zohoRecordId:
        fullRecord.invoice_id ||
        fullRecord.contact_id ||
        fullRecord.payment_id ||
        fullRecord.estimate_id ||
        fullRecord.creditnote_id ||
        null,
      payload: body,
      status: upsert.updated ? "processed" : "ignored",
      apiCallsUsed,
    });

    return { ok: true, handled: upsert.updated, type, upsert, apiCallsUsed };
  } catch (err) {
    await logWebhookEvent({
      eventType: type,
      payload: body,
      status: "failed",
      errorMessage: err.message,
      apiCallsUsed,
    });
    return { ok: false, handled: false, error: err.message };
  }
}

module.exports = {
  processZohoWebhookPayload,
  detectEventType,
  logWebhookEvent,
};
