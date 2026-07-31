import { Badge, type BadgeProps } from "@chakra-ui/react";
import { BILLING_GAP_ISSUE_LABELS } from "../../lib/billingReconciliationNav";

const STATUS_COLORS: Record<string, BadgeProps["colorPalette"]> = {
  current: "green",
  paid: "green",
  no_gaps: "green",
  overdue: "orange",
  partial_payment: "orange",
  connected_without_payment: "red",
  paid_but_disconnected: "red",
  cancelled_still_active: "red",
  billing_frequency_mismatch: "orange",
  recurring_invoice_stopped: "orange",
  unmatched_payment: "purple",
  payment_under_review: "yellow",
  manual_review_required: "yellow",
  missing_invoice: "orange",
  disconnected_not_invoiced: "red",
  stale_billing: "orange",
  no_zoho_link: "orange",
  credit_balance: "blue",
  unknown: "gray",
};

function formatLabel(status: string) {
  return (
    BILLING_GAP_ISSUE_LABELS[status] ||
    status
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export function ReconciliationStatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  const colorPalette = STATUS_COLORS[key] || "gray";

  return (
    <Badge colorPalette={colorPalette} variant="subtle" px={2} fontSize="xs">
      {formatLabel(status)}
    </Badge>
  );
}
