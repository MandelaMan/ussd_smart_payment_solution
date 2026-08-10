const { query } = require("../config/db");
const { findPaymentTransactionId } = require("./transactionStore");
const { getActivityActor } = require("../lib/activityActorContext");

function resolveActor({ actor, actorUserId, actorName } = {}) {
  const fromCtx = getActivityActor();
  const id =
    actor?.id != null
      ? Number(actor.id)
      : actorUserId != null
        ? Number(actorUserId)
        : fromCtx?.id != null
          ? Number(fromCtx.id)
          : null;
  const nameRaw =
    actor?.name ?? actorName ?? fromCtx?.name ?? null;
  const name = nameRaw ? String(nameRaw).trim().slice(0, 191) : null;
  return {
    actorUserId: Number.isFinite(id) && id > 0 ? id : null,
    actorName: name || null,
  };
}

/**
 * Persist a dashboard activity entry and broadcast it to connected admin clients.
 */
async function logActivity({
  eventType,
  title,
  message = null,
  source,
  status = "success",
  customerRef = null,
  amount = null,
  referenceId = null,
  checkoutRequestId = null,
  metadata = {},
  actor = null,
  actorUserId = null,
  actorName = null,
} = {}) {
  let paymentTransactionId = null;
  if (checkoutRequestId) {
    paymentTransactionId = await findPaymentTransactionId(checkoutRequestId);
  }

  const normalizedStatus =
    status === "failure" ? "failed" : String(status || "success");
  const normalizedEventType = String(eventType || "unknown").slice(0, 64);
  const normalizedSource = String(source || "admin").slice(0, 32);
  const normalizedAmount = amount != null ? Number(amount) : null;
  const { actorUserId: resolvedActorId, actorName: resolvedActorName } =
    resolveActor({ actor, actorUserId, actorName });

  const result = await query(
    `INSERT INTO activity_logs
      (event_type, title, message, source, status, customer_ref, amount,
       reference_id, payment_transaction_id, metadata, actor_user_id, actor_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedEventType,
      title,
      message,
      normalizedSource,
      normalizedStatus.slice(0, 16),
      customerRef,
      normalizedAmount,
      referenceId,
      paymentTransactionId,
      JSON.stringify(metadata),
      resolvedActorId,
      resolvedActorName,
    ]
  );

  const item = formatActivity({
    id: Number(result.insertId),
    event_type: normalizedEventType,
    title,
    message,
    source: normalizedSource,
    status: normalizedStatus.slice(0, 16),
    customer_ref: customerRef,
    amount: normalizedAmount,
    reference_id: referenceId,
    actor_user_id: resolvedActorId,
    actor_name: resolvedActorName,
    created_at: new Date().toISOString(),
  });

  try {
    const { emitSyncEvent } = require("../socket");
    emitSyncEvent("activity:created", item);
  } catch {
    /* socket optional during scripts / early boot */
  }

  return item;
}

/**
 * Best-effort activity write — never throws to callers.
 */
async function logActivitySafe(payload) {
  try {
    return await logActivity(payload);
  } catch (e) {
    console.error(
      `activity log (${payload?.eventType || "unknown"}) failed:`,
      e.message
    );
    return null;
  }
}

async function listActivity({
  limit = 40,
  eventTypes = null,
  excludeEventTypes = null,
} = {}) {
  const capped = Math.min(100, Math.max(1, Number(limit) || 40));
  const included = Array.isArray(eventTypes)
    ? eventTypes
        .map((t) => String(t || "").trim())
        .filter(Boolean)
        .slice(0, 80)
    : null;
  const excluded = Array.isArray(excludeEventTypes)
    ? excludeEventTypes
        .map((t) => String(t || "").trim())
        .filter(Boolean)
        .slice(0, 40)
    : included
      ? []
      : ["reconciliation_sync", "reconciliation_sync_failed"];

  if (included && included.length === 0) {
    return [];
  }

  let sql = `SELECT id, event_type, title, message, source, status, customer_ref,
            amount, reference_id, actor_user_id, actor_name, created_at
     FROM activity_logs`;
  const params = [];
  const where = [];

  if (included && included.length > 0) {
    where.push(`event_type IN (${included.map(() => "?").join(", ")})`);
    params.push(...included);
  }
  if (excluded.length > 0) {
    where.push(`event_type NOT IN (${excluded.map(() => "?").join(", ")})`);
    params.push(...excluded);
  }

  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(capped);

  const rows = await query(sql, params);
  return rows.map(formatActivity);
}

function formatActivity(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    message: row.message,
    source: row.source,
    status: row.status,
    customerRef: row.customer_ref,
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.reference_id,
    actorUserId:
      row.actor_user_id != null ? Number(row.actor_user_id) : null,
    actorName: row.actor_name || null,
    createdAt: row.created_at,
  };
}

module.exports = { logActivity, logActivitySafe, listActivity, formatActivity };
