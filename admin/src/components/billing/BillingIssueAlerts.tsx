import { Box, Flex, Link, Stack, Text } from "@chakra-ui/react";
import { FiAlertTriangle, FiChevronRight } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import type { ReconciliationSummary } from "../../lib/api";
import {
  BILLING_GAP_ISSUE_LABELS,
  BILLING_GAP_STATUSES,
  billingModulePath,
  BILLING_GAPS_MODULE,
} from "../../lib/billingReconciliationNav";

const PRIORITY_GAP_STATUSES = [
  "connected_without_payment",
  "paid_but_disconnected",
] as const;

const SEVERITY_COLORS = {
  critical: { bg: "red.50", border: "red.200", text: "red.800", count: "red.600" },
  high: { bg: "orange.50", border: "orange.200", text: "orange.800", count: "orange.600" },
} as const;

type Props = {
  summary: ReconciliationSummary;
};

export function BillingIssueAlerts({ summary }: Props) {
  const tiles = summary.issueTiles || [];
  const priorityTiles = PRIORITY_GAP_STATUSES.map((status) => {
    const tile = tiles.find((t) => t.id === status);
    const count =
      status === "connected_without_payment"
        ? summary.connectedWithoutPayment
        : summary.paidButDisconnected;
    return {
      status,
      label: BILLING_GAP_ISSUE_LABELS[status] || status,
      count: tile?.count ?? count,
      severity: "critical" as const,
      customers: tile?.customers?.slice(0, 3) ?? [],
    };
  }).filter((tile) => tile.count > 0);

  if (!priorityTiles.length) return null;

  const gapsPath = billingModulePath(BILLING_GAPS_MODULE);

  return (
    <Stack gap={2}>
      <Flex align="center" gap={2}>
        <FiAlertTriangle color="var(--chakra-colors-orange-600)" />
        <Text fontSize="sm" fontWeight="semibold" color="brand.800">
          Service vs billing mismatches
        </Text>
      </Flex>
      <Stack gap={2}>
        {priorityTiles.map((tile) => {
          const colors = SEVERITY_COLORS[tile.severity];
          const actionHint =
            tile.status === "connected_without_payment"
              ? "Disconnect TISP or collect overdue payment"
              : "Reconnect TISP — customer is paid up but offline";
          return (
            <Box
              key={tile.status}
              p={3}
              bg={colors.bg}
              border="1px solid"
              borderColor={colors.border}
              borderRadius="md"
            >
              <Flex justify="space-between" align="flex-start" gap={3}>
                <Box minW={0} flex={1}>
                  <Flex align="center" gap={2} flexWrap="wrap">
                    <Text fontSize="sm" fontWeight="semibold" color={colors.text}>
                      {tile.label}
                    </Text>
                    <Text fontSize="lg" fontWeight="bold" color={colors.count}>
                      {tile.count}
                    </Text>
                  </Flex>
                  <Text fontSize="xs" color={colors.text} mt={1}>
                    {actionHint}
                  </Text>
                  {tile.customers.length > 0 && (
                    <Stack gap={0.5} mt={2}>
                      {tile.customers.map((customer) => (
                        <Text key={customer.customerId} fontSize="xs" color="fg.muted" truncate>
                          {customer.customerNumber} · {customer.customerName}
                          {customer.actionLabel ? ` — ${customer.actionLabel}` : ""}
                        </Text>
                      ))}
                    </Stack>
                  )}
                </Box>
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
                  <RouterLink to={`${gapsPath}?issue=${tile.status}`}>
                    Review
                    <FiChevronRight size={12} />
                  </RouterLink>
                </Link>
              </Flex>
            </Box>
          );
        })}
      </Stack>
      <Text fontSize="xs" color="fg.muted">
        Also check{" "}
        {BILLING_GAP_STATUSES.filter(
          (s) => !PRIORITY_GAP_STATUSES.includes(s as (typeof PRIORITY_GAP_STATUSES)[number])
        )
          .map((s) => BILLING_GAP_ISSUE_LABELS[s])
          .join(", ")}{" "}
        under Billing Gaps.
      </Text>
    </Stack>
  );
}
