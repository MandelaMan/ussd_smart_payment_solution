import type { BillingModuleId } from "./billingReconciliationNav";

export type BillingGuideId = BillingModuleId | "sync" | "metrics";

export type BillingGuide = {
  id: BillingGuideId;
  title: string;
  whenToUse: string;
  steps: string[];
  whereToCheck: string[];
};

export const BILLING_RECONCILIATION_GUIDES: BillingGuide[] = [
  {
    id: "metrics",
    title: "Financial summary strip",
    whenToUse:
      "Use the top row of figures to see portfolio health before drilling into individual customers.",
    steps: [
      "Outstanding — total open Zoho invoice balance across matched customers.",
      "Revenue at Risk — expected subscription revenue from customers with billing or service issues.",
      "Expected (month) vs Collected (month) — compare what should have been billed against M-Pesa and Zoho payments this month.",
      "Collection Rate — if low, start with Billing Gaps and Manual Review.",
      "Customers with Issues — count of dashboard customers flagged in the modules below.",
    ],
    whereToCheck: [
      "Run Sync on this page to refresh figures from Zoho, M-Pesa, and TISP.",
      "Open Reports for longer-term revenue trends.",
      "Use Transactions for raw M-Pesa payment history.",
    ],
  },
  {
    id: "sync",
    title: "Keeping data fresh",
    whenToUse: "Counts look stale, a customer was just fixed, or you need the latest Zoho/TISP status.",
    steps: [
      "Click Sync on Billing (or Settings → Synchronization for full integration jobs).",
      "Wait for the progress banner to finish — quick sync uses cached DB snapshots where possible.",
      "Search a customer in Billing Gaps to force a live Zoho lookup for that account only.",
      "After fixing a customer in Customers, use Retry billing or TISP sync on their profile.",
    ],
    whereToCheck: [
      "Settings → Synchronization — job history and integration health.",
      "Customer detail — TISP sync status and Zoho invoice panel.",
      "Settings → Logs — API errors from Zoho or TISP.",
    ],
  },
  {
    id: "billing-gaps",
    title: "Billing gaps (Zoho & TISP)",
    whenToUse:
      "Service and billing are out of sync — free service while overdue, paid but disconnected, missing Zoho setup, or invoice gaps.",
    steps: [
      "Free service (overdue/unpaid) — TISP is active but Zoho has overdue or open invoices. Disconnect TISP or collect/allocate payment.",
      "Paid up, disconnected — Zoho shows no balance but TISP is suspended. Reconnect TISP after confirming invoices are paid.",
      "Browse shows up to 10 local records (API budget). Search by customer number or name to live-check Zoho invoices, payments, and TISP.",
      "Not in Zoho Books — open the customer and use Retry billing onboarding to create/link the Zoho contact and signup invoice.",
      "Missing invoice — verify package price, then retry billing or check Zoho Books for draft/void invoices.",
      "Recurring invoice stopped — update payment frequency on the customer, then push billing sync from customer edit.",
      "Disconnected, not invoiced — service was suspended before a current-period invoice existed; issue invoice before reconnecting.",
      "Expand a row for system checks across Dashboard, TISP, and Zoho with recommended actions.",
    ],
    whereToCheck: [
      "Customers → customer detail → Billing & Zoho sections.",
      "Zoho Books — Contacts and Invoices for the customer name (not only customer number).",
      "TISP — account status and due date on the customer profile.",
    ],
  },
  {
    id: "manual-review",
    title: "Manual review cases",
    whenToUse:
      "Sync errors, conflicting data, or validations that need a human decision.",
    steps: [
      "Read the issue label on each row — it describes the validation that failed.",
      "Expand the customer panel and review System status for TISP vs Zoho mismatch.",
      "Fix the root cause (wrong reference, duplicate invoice, frequency mismatch, etc.).",
      "Re-run Sync or refresh that customer from their profile.",
      "If the issue persists, check Settings → Logs for the underlying API message.",
    ],
    whereToCheck: [
      "Customer expand panel — validations and recommended actions.",
      "Settings → Logs — filter by customer number or zoho/tisp service.",
      "Settings → Synchronization — failed job details.",
    ],
  },
];
