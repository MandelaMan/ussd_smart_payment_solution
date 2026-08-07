export type SubscriptionStatusLabel =
  | "Active"
  | "Suspended"
  | "Paused"
  | "Cancelled";

/** @deprecated Prefer Suspended — kept for URL/API backwards compatibility. */
export type LegacySubscriptionStatusLabel = "Not on TISP";

export const SUBSCRIPTION_STATUS_FILTER_OPTIONS: Array<{
  value: SubscriptionStatusLabel;
  label: string;
  description: string;
  color: string;
}> = [
  {
    value: "Active",
    label: "Active",
    description: "Live on TISP and on Books — currently using the service",
    color: "green.500",
  },
  {
    value: "Suspended",
    label: "Suspended",
    description: "On Books, but not live on TISP (includes not yet on TISP)",
    color: "orange.500",
  },
  {
    value: "Paused",
    label: "Paused",
    description: "Away temporarily — asked for internet to be paused",
    color: "blue.500",
  },
  {
    value: "Cancelled",
    label: "Cancelled",
    description: "Churned — excluded from customer counts and reports",
    color: "red.400",
  },
];

const ALLOWED = new Set<SubscriptionStatusLabel>([
  "Active",
  "Suspended",
  "Paused",
  "Cancelled",
]);

const CANONICAL_BY_LOWER = new Map<string, SubscriptionStatusLabel>([
  ["active", "Active"],
  ["suspended", "Suspended"],
  ["paused", "Paused"],
  ["pause", "Paused"],
  ["not on tisp", "Suspended"],
  ["not_on_tisp", "Suspended"],
  ["unknown", "Suspended"],
  ["cancelled", "Cancelled"],
  ["canceled", "Cancelled"],
]);

export function parseStatusFilterParam(
  value: string | null | undefined
): SubscriptionStatusLabel[] {
  if (!value?.trim()) return [];
  const seen = new Set<SubscriptionStatusLabel>();
  const out: SubscriptionStatusLabel[] = [];
  for (const part of value.split(",")) {
    const key = part.trim().toLowerCase();
    if (!key) continue;
    const canonical = CANONICAL_BY_LOWER.get(key);
    if (!canonical || seen.has(canonical)) continue;
    if (!ALLOWED.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

export function serializeStatusFilter(values: SubscriptionStatusLabel[]): string {
  return values.join(",");
}

/**
 * Normalize raw TISP / DB service status into a canonical label.
 * "Not on TISP" / empty / unknown → Suspended (on Books, not actively on TISP).
 */
export function normalizeSubscriptionStatus(
  value: string | null | undefined
): SubscriptionStatusLabel {
  const raw = String(value ?? "").trim();
  if (!raw) return "Suspended";
  const lower = raw.toLowerCase();
  if (lower === "active" || lower.startsWith("active ")) return "Active";
  if (lower.includes("pause")) return "Paused";
  if (lower.includes("suspend")) return "Suspended";
  if (lower.includes("cancel")) return "Cancelled";
  if (
    lower.includes("not on tisp") ||
    lower === "not_on_tisp" ||
    lower === "unknown"
  ) {
    return "Suspended";
  }
  return "Suspended";
}

export function displayCustomerStatus(customer: {
  status: "active" | "cancelled";
  subscriptionStatus?: string | null;
}): string {
  if (customer.status === "cancelled") return "Cancelled";
  return normalizeSubscriptionStatus(customer.subscriptionStatus);
}

export function statusFiltersEqual(
  a: SubscriptionStatusLabel[],
  b: SubscriptionStatusLabel[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
