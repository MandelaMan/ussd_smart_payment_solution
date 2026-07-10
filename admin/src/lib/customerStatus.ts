export type SubscriptionStatusLabel = "Active" | "Suspended" | "Unknown" | "Cancelled";

export const SUBSCRIPTION_STATUS_FILTER_OPTIONS: Array<{
  value: SubscriptionStatusLabel;
  label: string;
  color: string;
}> = [
  { value: "Active", label: "Active", color: "green.500" },
  { value: "Suspended", label: "Suspended", color: "orange.500" },
  { value: "Unknown", label: "Unknown", color: "gray.400" },
  { value: "Cancelled", label: "Cancelled", color: "red.400" },
];

export const SUBSCRIPTION_STATUS_OPTIONS: Array<{
  value: "" | SubscriptionStatusLabel;
  label: string;
}> = [
  { value: "", label: "All statuses" },
  ...SUBSCRIPTION_STATUS_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

export function parseStatusFilterParam(value: string | null | undefined): SubscriptionStatusLabel[] {
  if (!value?.trim()) return [];
  const allowed = new Set<SubscriptionStatusLabel>(["Active", "Suspended", "Unknown", "Cancelled"]);
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is SubscriptionStatusLabel =>
      allowed.has(part as SubscriptionStatusLabel)
    );
}

export function serializeStatusFilter(values: SubscriptionStatusLabel[]): string {
  return values.join(",");
}

export function normalizeSubscriptionStatus(
  value: string | null | undefined
): SubscriptionStatusLabel {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  const lower = raw.toLowerCase();
  if (lower.includes("active")) return "Active";
  if (lower.includes("suspend")) return "Suspended";
  return "Unknown";
}

export function displayCustomerStatus(customer: {
  status: "active" | "cancelled";
  subscriptionStatus?: string | null;
}): string {
  if (customer.status === "cancelled") return "Cancelled";
  return normalizeSubscriptionStatus(customer.subscriptionStatus);
}
