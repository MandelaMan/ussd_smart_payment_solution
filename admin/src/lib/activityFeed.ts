import type { ActivityItem, User } from "./api";
import { hasPermission } from "./rbac";

/**
 * Customer lifecycle events for Recent Activity.
 * Keep in sync with api/lib/customerActivityEvents.js
 */
export const CUSTOMER_ACTIVITY_EVENT_TYPES = [
  "customer_created",
  "customer_created_tisp_failed",
  "customer_created_zoho_failed",
  "customer_imported",
  "customer_imported_tisp_failed",
  "customer_updated",
  "customer_upgraded",
  "customer_downgraded",
  "customer_frequency_changed",
  "customer_apartment_switched",
  "customer_type_changed",
  "customer_paused",
  "tisp_reconnected",
  "tisp_reconnect_failed",
  "customer_disconnected",
  "customer_cancelled",
  "customer_deleted",
] as const;

/** Admin Activity audit extras (not on the team Recent Activity rail). */
export const ADMIN_AUDIT_EXTRA_EVENT_TYPES = ["user_login"] as const;

export const ADMIN_AUDIT_EVENT_TYPES = [
  ...CUSTOMER_ACTIVITY_EVENT_TYPES,
  ...ADMIN_AUDIT_EXTRA_EVENT_TYPES,
] as const;

/** @deprecated Use CUSTOMER_ACTIVITY_EVENT_TYPES / isVisibleCustomerActivity */
export const SUPPORT_ACTIVITY_EVENT_TYPES = new Set<string>(
  CUSTOMER_ACTIVITY_EVENT_TYPES
);

/** Sensitive menu actions — gated by matching customer permission. */
export const SENSITIVE_ACTIVITY_PERMISSIONS: Record<string, string> = {
  customer_disconnected: "customers.disconnect",
  customer_cancelled: "customers.cancel",
  customer_deleted: "customers.delete",
};

/** Automated jobs that clutter the feed. */
export const ACTIVITY_FEED_NOISE_TYPES = new Set([
  "reconciliation_sync",
  "reconciliation_sync_failed",
]);

export function isActivityFeedNoise(item: ActivityItem): boolean {
  return ACTIVITY_FEED_NOISE_TYPES.has(item.eventType);
}

export function isCustomerActivityEvent(eventType: string): boolean {
  return (CUSTOMER_ACTIVITY_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function isVisibleCustomerActivity(
  item: ActivityItem,
  user: User | null
): boolean {
  if (!isCustomerActivityEvent(item.eventType)) return false;
  if (isActivityFeedNoise(item)) return false;
  const required = SENSITIVE_ACTIVITY_PERMISSIONS[item.eventType];
  if (!required) return true;
  return hasPermission(user, required);
}

export function filterActivityFeedItems(
  items: ActivityItem[],
  user: User | null = null
): ActivityItem[] {
  return (items ?? []).filter((item) => {
    if (isActivityFeedNoise(item)) return false;
    if (!isCustomerActivityEvent(item.eventType)) return false;
    const required = SENSITIVE_ACTIVITY_PERMISSIONS[item.eventType];
    if (!required) return true;
    // If no user passed (API already filtered), keep item.
    if (!user) return true;
    return hasPermission(user, required);
  });
}

export function prependActivityItem(
  items: ActivityItem[],
  next: ActivityItem,
  limit: number,
  user: User | null = null
): ActivityItem[] {
  if (!next?.id) return items;
  if (!isVisibleCustomerActivity(next, user) && user) return items;
  if (isActivityFeedNoise(next)) return items;
  if (!isCustomerActivityEvent(next.eventType)) return items;
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
