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
      "Collection Rate — if low, start with Unallocated M-Pesa and Billing Gaps.",
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
      "Click Sync on Billing (or Synchronization for full integration jobs).",
      "Wait for the progress banner to finish — quick sync uses cached DB snapshots where possible.",
      "Search a customer in Billing Gaps to force a live Zoho lookup for that account only.",
      "After fixing a customer in Customers, use Retry billing or TISP sync on their profile.",
    ],
    whereToCheck: [
      "Synchronization page — job history and integration health.",
      "Customer detail — TISP sync status and Zoho invoice panel.",
      "Logs — API errors from Zoho or TISP.",
    ],
  },
  {
    id: "unallocated-mpesa",
    title: "Unallocated M-Pesa payments",
    whenToUse:
      "M-Pesa paybill money was received but not applied to a Zoho Books invoice.",
    steps: [
      "Open Unallocated M-Pesa and expand the payment row.",
      "Confirm the account reference matches the customer number on the payment.",
      "Review suggested open invoices and allocate the payment to the correct invoice.",
      "If no invoice exists, open the customer in Customers and retry billing onboarding, or create the invoice in Zoho Books.",
      "After allocation, run Sync and confirm the payment no longer appears here.",
    ],
    whereToCheck: [
      "Transactions — full M-Pesa success/failure log.",
      "Customer profile → Invoices — open balance and invoice numbers.",
      "Zoho Books — Customer Payments and invoice status.",
    ],
  },
  {
    id: "billing-gaps",
    title: "Billing gaps (Zoho & TISP)",
    whenToUse:
      "Dashboard customers missing in Zoho, without a current invoice, recurring profile stopped, or disconnected on TISP without billing.",
    steps: [
      "Browse shows up to 10 local records (API budget). Search by customer number or name to live-check Zoho invoices, payments, and TISP.",
      "A clean search result shows “No gaps” — invoices, payments, and TISP connection look consistent.",
      "Not in Zoho Books — open the customer and use Retry billing onboarding to create/link the Zoho contact and signup invoice.",
      "Missing invoice — verify package price, then retry billing or check Zoho Books for draft/void invoices.",
      "Recurring invoice stopped — update payment frequency on the customer, then push billing sync from customer edit.",
      "Disconnected, not invoiced — check TISP status on the customer; suspend may be correct if they never paid — issue invoice before reconnecting.",
      "Expand a row for system checks across Dashboard, TISP, and Zoho.",
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
      "If the issue persists, check Logs for the underlying API message.",
    ],
    whereToCheck: [
      "Customer expand panel — validations and recommended actions.",
      "Logs — filter by customer number or zoho/tisp service.",
      "Synchronization — failed job details.",
    ],
  },
  {
    id: "customer-communications",
    title: "Customer communications",
    whenToUse:
      "Send billing reminder emails for customers with known gaps (requires Zoho Mail configured).",
    steps: [
      "Confirm ZOHO_MAIL is configured in Settings / environment.",
      "Filter communications by issue type (missing invoice, overdue, etc.).",
      "Preview the email template before sending.",
      "Send to individual customers or in bulk where eligible.",
      "Follow up in Billing Gaps after sending — payment may still need Zoho allocation.",
    ],
    whereToCheck: [
      "Billing Gaps — confirm the underlying issue is still accurate.",
      "Zoho Mail sent folder — delivery status.",
      "Customer email on the dashboard profile.",
    ],
  },
];

export function getBillingGuide(id: BillingGuideId) {
  return BILLING_RECONCILIATION_GUIDES.find((g) => g.id === id);
}
