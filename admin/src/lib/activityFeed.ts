import type { ActivityItem } from "./api";

/** Support dashboard / mobile activity whitelist (matches API SUPPORT_ACTIVITY_TYPES). */
export const SUPPORT_ACTIVITY_EVENT_TYPES = new Set([
  "customer_created",
  "customer_created_tisp_failed",
  "customer_updated",
  "customer_cancelled",
  "customer_upgraded",
  "customer_downgraded",
  "customer_apartment_switched",
  "customer_type_changed",
  "customer_paused",
  "customer_disconnected",
  "customer_deleted",
  "tisp_reconnected",
  "tisp_reconnect_failed",
]);

export function prependActivityItem(
  items: ActivityItem[],
  next: ActivityItem,
  limit: number
): ActivityItem[] {
  if (!next?.id) return items;
  if (items.some((item) => item.id === next.id)) return items;
  return [next, ...items].slice(0, Math.max(1, limit));
}

export function normalizeActivityItem(raw: unknown): ActivityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = Number(row.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    eventType: String(row.eventType || "unknown"),
    title: String(row.title || "Activity"),
    message: row.message != null ? String(row.message) : null,
    source: String(row.source || "admin") as ActivityItem["source"],
    status: String(row.status || "success") as ActivityItem["status"],
    customerRef: row.customerRef != null ? String(row.customerRef) : null,
    amount: row.amount != null && row.amount !== "" ? Number(row.amount) : null,
    referenceId: row.referenceId != null ? String(row.referenceId) : null,
    actorUserId:
      row.actorUserId != null && row.actorUserId !== ""
        ? Number(row.actorUserId)
        : null,
    actorName: row.actorName != null ? String(row.actorName) : null,
    createdAt: row.createdAt
      ? String(row.createdAt)
      : new Date().toISOString(),
  };
}
