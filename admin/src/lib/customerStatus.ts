export type SubscriptionStatusLabel =
  | "Active"
  | "Suspended"
  | "Not on TISP"
  | "Cancelled";

export const SUBSCRIPTION_STATUS_FILTER_OPTIONS: Array<{
  value: SubscriptionStatusLabel;
  label: string;
  color: string;
}> = [
  { value: "Active", label: "Active", color: "green.500" },
  { value: "Suspended", label: "Suspended", color: "orange.500" },
  { value: "Not on TISP", label: "Not on TISP", color: "fg.subtle" },
  { value: "Cancelled", label: "Cancelled", color: "red.400" },
];

export const SUBSCRIPTION_STATUS_OPTIONS: Array<{
  value: "" | SubscriptionStatusLabel;
  label: string;
}> = [
  { value: "", label: "All statuses" },
  ...SUBSCRIPTION_STATUS_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

const ALLOWED = new Set<SubscriptionStatusLabel>([
  "Active",
  "Suspended",
  "Not on TISP",
  "Cancelled",
]);

const CANONICAL_BY_LOWER = new Map<string, SubscriptionStatusLabel>([
  ["active", "Active"],
  ["suspended", "Suspended"],
  ["not on tisp", "Not on TISP"],
  ["not_on_tisp", "Not on TISP"],
  ["unknown", "Not on TISP"],
  ["cancelled", "Cancelled"],
  ["canceled", "Cancelled"],
]);

export function parseStatusFilterParam(value: string | null | undefined): SubscriptionStatusLabel[] {
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

export function normalizeSubscriptionStatus(
  value: string | null | undefined
): SubscriptionStatusLabel {
  const raw = String(value ?? "").trim();
  if (!raw) return "Not on TISP";
  const lower = raw.toLowerCase();
  if (lower === "active" || lower.startsWith("active ")) return "Active";
  if (lower.includes("suspend")) return "Suspended";
  if (lower.includes("cancel")) return "Cancelled";
  return "Not on TISP";
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
