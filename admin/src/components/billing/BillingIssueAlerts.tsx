import { Flex, Link, Stack, Text } from "@chakra-ui/react";
import { FiAlertTriangle, FiChevronRight } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import type { ReconciliationSummary } from "../../lib/api";
import {
  BILLING_GAP_ISSUE_LABELS,
  BILLING_GAP_STATUSES,
  billingModulePath,
  BILLING_GAPS_MODULE,
} from "../../lib/billingReconciliationNav";

const GAP_COUNT_KEYS: Record<string, keyof ReconciliationSummary> = {
  connected_without_payment: "connectedWithoutPayment",
  paid_but_disconnected: "paidButDisconnected",
  no_zoho_link: "noZohoLink",
  recurring_invoice_stopped: "recurringInvoicesStopped",
  missing_invoice: "missingInvoices",
  disconnected_not_invoiced: "disconnectedNotInvoiced",
  skipped_payment: "skippedPayments",
};

const CRITICAL_GAPS = new Set(["connected_without_payment", "paid_but_disconnected"]);

type Props = {
  summary: ReconciliationSummary;
};

function gapCount(summary: ReconciliationSummary, status: string) {
  const tile = summary.issueTiles?.find((t) => t.id === status);
  if (typeof tile?.count === "number") return tile.count;
  const key = GAP_COUNT_KEYS[status];
  const value = key ? summary[key] : 0;
  return typeof value === "number" ? value : 0;
}

export function BillingIssueAlerts({ summary }: Props) {
  const rows = BILLING_GAP_STATUSES.map((status) => ({
    status,
    label: BILLING_GAP_ISSUE_LABELS[status] || status,
    count: gapCount(summary, status),
    critical: CRITICAL_GAPS.has(status),
  })).filter((row) => row.count > 0);

  if (!rows.length) return null;

  const gapsPath = billingModulePath(BILLING_GAPS_MODULE);

  return (
    <Stack gap={2}>
      <Flex align="center" gap={2}>
        <FiAlertTriangle color="var(--chakra-colors-orange-600)" />
        <Text fontSize="sm" fontWeight="semibold" color="brand.800">
          Service vs billing mismatches
        </Text>
      </Flex>
      <Stack gap={1.5}>
        {rows.map((row) => (
          <Flex
            key={row.status}
            align="center"
            gap={3}
            px={3}
            py={2}
            bg={row.critical ? "red.50" : "orange.50"}
            border="1px solid"
            borderColor={row.critical ? "red.200" : "orange.200"}
            borderRadius="md"
          >
            <Text
              fontSize="sm"
              fontWeight="medium"
              color={row.critical ? "red.800" : "orange.800"}
              flex="1"
              minW={0}
              truncate
            >
              {row.label}
            </Text>
            <Text
              fontSize="sm"
              fontWeight="bold"
              color={row.critical ? "red.600" : "orange.600"}
              flexShrink={0}
            >
              {row.count}
            </Text>
            <Link
              asChild
              fontSize="xs"
              fontWeight="medium"
              color="brand.700"
              flexShrink={0}
              display="flex"
              alignItems="center"
              gap={0.5}
            >
              <RouterLink to={`${gapsPath}?issue=${row.status}`}>
                Review
                <FiChevronRight size={12} />
              </RouterLink>
            </Link>
          </Flex>
        ))}
      </Stack>
    </Stack>
  );
}
