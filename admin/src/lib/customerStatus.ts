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

export function parseStatusFilterParam(value: string | null | undefined): SubscriptionStatusLabel[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      // Legacy filter value from bookmarks / saved links.
      if (part.toLowerCase() === "unknown") return "Not on TISP" as const;
      return part;
    })
    .filter((part): part is SubscriptionStatusLabel =>
      ALLOWED.has(part as SubscriptionStatusLabel)
    );
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
  if (lower.includes("active")) return "Active";
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
