import type { ReconciliationSummary } from "./api";

export type BillingModuleId =
  | "unallocated-mpesa"
  | "billing-gaps"
  | "manual-review"
  | "customer-communications";

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
  mpesaTable?: boolean;
};

export const BILLING_GAP_STATUSES = [
  "no_zoho_link",
  "recurring_invoice_stopped",
  "missing_invoice",
  "disconnected_not_invoiced",
] as const;

export const BILLING_GAP_ISSUE_LABELS: Record<string, string> = {
  no_zoho_link: "Not in Zoho Books",
  recurring_invoice_stopped: "Recurring invoice",
  missing_invoice: "Missing invoice",
  disconnected_not_invoiced: "Disconnected, not invoiced",
  no_gaps: "No gaps",
};

export const BILLING_BASE_PATH = "/billing";

/** Short sidebar label — full title stays on the billing overview page */
export const BILLING_NAV_LABEL = "Billing";

export const BILLING_MODULES: BillingModuleDef[] = [
  {
    id: "unallocated-mpesa",
    path: "unallocated-mpesa",
    label: "Unallocated M-Pesa",
    description: "Paybill payments not applied to Zoho invoices",
    statusFilter: "unmatched_payment",
    summaryKey: "unmatchedMpesaPayments",
    mpesaTable: true,
  },
  {
    id: "billing-gaps",
    path: "billing-gaps",
    label: "Billing Gaps",
    description:
      "Dashboard customers not found or incomplete on Zoho Books — missing contact, recurring profile, period invoice, or TISP disconnected without billing",
    statusFilters: [...BILLING_GAP_STATUSES],
    summaryKeys: [
      "noZohoLink",
      "recurringInvoicesStopped",
      "missingInvoices",
      "disconnectedNotInvoiced",
    ],
  },
  {
    id: "manual-review",
    path: "manual-review",
    label: "Manual Review",
    description: "Sync errors and cases needing human verification",
    statusFilter: "manual_review_required",
    summaryKey: "manualReviewsRequired",
  },
  {
    id: "customer-communications",
    path: "communications",
    label: "Customer Communications",
    description: "Send Zoho Mail notices tailored to each customer's billing gap",
    summaryKey: "communicationsEligible",
  },
];

/** @deprecated — use billing-gaps */
export const LEGACY_BILLING_MODULE_REDIRECTS: Record<string, string> = {
  "zoho-billing-gaps": "billing-gaps",
  "no-zoho-link": "billing-gaps",
  "recurring-invoices": "billing-gaps",
  "missing-invoices": "billing-gaps",
  "disconnected-not-invoiced": "billing-gaps",
};

export const BILLING_GAPS_MODULE = BILLING_MODULES.find((m) => m.id === "billing-gaps")!;

export const BILLING_COMMUNICATIONS_MODULE = BILLING_MODULES.find(
  (m) => m.id === "customer-communications",
)!;

/** Issue modules shown on the billing overview (excludes communications workflow). */
export const BILLING_ISSUE_MODULES = BILLING_MODULES.filter(
  (m) => m.id !== "customer-communications",
);

/** @deprecated — use BILLING_ISSUE_MODULES */
export const BILLING_STANDARD_MODULES = BILLING_ISSUE_MODULES;

export function billingModulePath(module: BillingModuleDef) {
  return `${BILLING_BASE_PATH}/${module.path}`;
}

export function getBillingModuleFromPath(pathname: string): BillingModuleDef | null {
  const normalized = pathname.replace(/\/+$/, "");
  if (normalized === BILLING_BASE_PATH) return null;
  const segment = normalized.replace(`${BILLING_BASE_PATH}/`, "");
  const legacy = LEGACY_BILLING_MODULE_REDIRECTS[segment];
  if (legacy) {
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

export function rowBillingGapIssue(row: { primaryStatus: string; statuses: string[] }) {
  return BILLING_GAP_STATUSES.find(
    (s) => row.primaryStatus === s || row.statuses.includes(s),
  );
}
