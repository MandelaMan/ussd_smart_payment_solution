import type { ReconciliationSummary } from "./api";

export type BillingModuleId = "billing-gaps" | "manual-review";

export type BillingModuleDef = {
  id: BillingModuleId;
  path: string;
  label: string;
  description: string;
  /** Single status filter (legacy / simple modules) */
  statusFilter?: string;
  /** Multiple status filters for combined modules */
  statusFilters?: string[];
  summaryKey?: keyof ReconciliationSummary;
  /** Sum several summary fields for combined module counts */
  summaryKeys?: (keyof ReconciliationSummary)[];
};

export const BILLING_GAP_STATUSES = [
  "connected_without_payment",
  "paid_but_disconnected",
  "no_zoho_link",
  "recurring_invoice_stopped",
  "missing_invoice",
  "disconnected_not_invoiced",
  "skipped_payment",
] as const;

export const BILLING_GAP_ISSUE_LABELS: Record<string, string> = {
  connected_without_payment: "Free service (overdue/unpaid)",
  paid_but_disconnected: "Paid up, disconnected",
  no_zoho_link: "Not in Zoho Books",
  recurring_invoice_stopped: "Recurring invoice stopped",
  missing_invoice: "Missing invoice",
  disconnected_not_invoiced: "Disconnected, not invoiced",
  skipped_payment: "Skipped monthly payment",
  no_gaps: "No gaps",
};

export const BILLING_BASE_PATH = "/billing";

/** Short sidebar label — full title stays on the billing overview page */
export const BILLING_NAV_LABEL = "Billing";

export const BILLING_MODULES: BillingModuleDef[] = [
  {
    id: "billing-gaps",
    path: "billing-gaps",
    label: "Billing Gaps",
    description: "TISP vs Zoho mismatches and skipped monthly payments",
    statusFilters: [...BILLING_GAP_STATUSES],
    summaryKeys: [
      "connectedWithoutPayment",
      "paidButDisconnected",
      "noZohoLink",
      "recurringInvoicesStopped",
      "missingInvoices",
      "disconnectedNotInvoiced",
      "skippedPayments",
    ],
  },
  {
    id: "manual-review",
    path: "manual-review",
    label: "Manual Review",
    description: "Sync errors needing verification",
    statusFilter: "manual_review_required",
    summaryKey: "manualReviewsRequired",
  },
];

/** @deprecated — use billing-gaps / billing home */
export const LEGACY_BILLING_MODULE_REDIRECTS: Record<string, string> = {
  "zoho-billing-gaps": "billing-gaps",
  "no-zoho-link": "billing-gaps",
  "recurring-invoices": "billing-gaps",
  "missing-invoices": "billing-gaps",
  "disconnected-not-invoiced": "billing-gaps",
  "unallocated-mpesa": "",
  communications: "",
};

export const BILLING_GAPS_MODULE = BILLING_MODULES.find((m) => m.id === "billing-gaps")!;

/** Issue modules shown on the billing overview / sidebar. */
export const BILLING_ISSUE_MODULES = BILLING_MODULES;

export function billingModulePath(module: BillingModuleDef) {
  return `${BILLING_BASE_PATH}/${module.path}`;
}

export function getBillingModuleFromPath(pathname: string): BillingModuleDef | null {
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized === BILLING_BASE_PATH) return null;
  const segment = normalized.replace(`${BILLING_BASE_PATH}/`, "");
  if (segment in LEGACY_BILLING_MODULE_REDIRECTS) {
    const legacy = LEGACY_BILLING_MODULE_REDIRECTS[segment];
    if (!legacy) return null;
    return BILLING_MODULES.find((m) => m.path === legacy) ?? null;
  }
  return BILLING_MODULES.find((m) => m.path === segment) ?? null;
}

export function moduleStatusParam(module: BillingModuleDef) {
  if (module.statusFilters?.length) return module.statusFilters.join(",");
  return module.statusFilter;
}

export function moduleCount(summary: ReconciliationSummary | null, module: BillingModuleDef) {
  if (!summary) return 0;
  if (module.summaryKeys?.length) {
    return module.summaryKeys.reduce((sum, key) => {
      const value = summary[key];
      return sum + (typeof value === "number" ? value : 0);
    }, 0);
  }
  if (!module.summaryKey) return 0;
  const value = summary[module.summaryKey];
  return typeof value === "number" ? value : 0;
}

export function isBillingGapStatus(
  value: string
): value is (typeof BILLING_GAP_STATUSES)[number] {
  return (BILLING_GAP_STATUSES as readonly string[]).includes(value);
}

export function rowHasBillingGap(
  row: { primaryStatus: string; statuses?: string[] },
  status: string
) {
  return row.primaryStatus === status || (row.statuses || []).includes(status);
}

export function rowBillingGapIssue(
  row: { primaryStatus: string; statuses?: string[] },
  preferred?: string
) {
  if (preferred && rowHasBillingGap(row, preferred)) return preferred;
  return BILLING_GAP_STATUSES.find((s) => rowHasBillingGap(row, s));
}
