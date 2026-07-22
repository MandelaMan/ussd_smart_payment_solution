import { Box, Button, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import type { ReconciliationSummary } from "../../lib/api";
import { formatCurrency } from "../../lib/api";
import {
  BILLING_ISSUE_MODULES,
  BILLING_MODULES,
  moduleCount,
} from "../../lib/billingReconciliationNav";
import { ReconciliationFinancialStrip } from "../reconciliation/ReconciliationFinancialStrip";
import { MobilePageChrome } from "../ui/MobilePageChrome";
import { BillingIssueAlerts } from "./BillingIssueAlerts";
import { UpcomingInvoicesForecastStrip } from "./UpcomingInvoicesForecastStrip";
import { BillingModuleCard } from "./BillingModuleCard";
import { BillingReconciliationGuides } from "./BillingReconciliationGuides";
import { useBillingReconciliation } from "./BillingReconciliationContext";
import { useAuth } from "../../lib/auth";
import { canOperateFinance } from "../../lib/rbac";

type Props = {
  summary: ReconciliationSummary | null;
  summaryLoading: boolean;
};

function MobileKeyStats({ summary }: { summary: ReconciliationSummary }) {
  return (
    <Grid templateColumns="1fr 1fr" gap={2}>
      <Box p={3} bg="brand.50" border="1px solid" borderColor="brand.100" borderRadius="md">
        <Text fontSize="2xs" color="fg.muted" fontWeight="medium" textTransform="uppercase">
          Outstanding
        </Text>
        <Text fontSize="sm" fontWeight="bold" color="brand.800" mt={0.5} truncate>
          {formatCurrency(summary.totalOutstandingBalance)}
        </Text>
      </Box>
      <Box p={3} bg="brand.50" border="1px solid" borderColor="brand.100" borderRadius="md">
        <Text fontSize="2xs" color="fg.muted" fontWeight="medium" textTransform="uppercase">
          Issues
        </Text>
        <Text fontSize="sm" fontWeight="bold" color="brand.800" mt={0.5}>
          {summary.sync.issueCustomerCount ?? 0}
        </Text>
      </Box>
    </Grid>
  );
}

export function BillingReconciliationOverview({ summary, summaryLoading }: Props) {
  const { user } = useAuth();
  const allowSync = canOperateFinance(user);
  const { syncing, runSync } = useBillingReconciliation();
  const totalIssues = BILLING_MODULES.reduce(
    (sum, module) => sum + moduleCount(summary, module),
    0,
  );

  return (
    <Stack gap={4}>
      <Box display={{ base: "block", lg: "none" }}>
        <MobilePageChrome
          title="Billing"
          headerActions={
            allowSync ? (
              <Button size="sm" colorPalette="brand" loading={syncing} onClick={runSync}>
                <FiRefreshCw />
                Sync
              </Button>
            ) : undefined
          }
        />
      </Box>

      {summary && !summaryLoading && (
        <>
          <Box display={{ base: "none", lg: "block" }}>
            <ReconciliationFinancialStrip summary={summary} />
          </Box>
          <Box display={{ base: "block", lg: "none" }}>
            <Stack gap={2}>
              <MobileKeyStats summary={summary} />
              {summary.upcomingInvoices ? (
                <UpcomingInvoicesForecastStrip forecast={summary.upcomingInvoices} compact />
              ) : null}
            </Stack>
          </Box>
          <BillingIssueAlerts summary={summary} />
        </>
      )}

      <Box>
        <Heading size="sm" color="brand.800" mb={2} whiteSpace="nowrap">
          Issue modules
        </Heading>
        {summaryLoading ? (
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Box key={i} h="56px" bg="bg.muted" borderRadius="md" />
            ))}
          </Grid>
        ) : (
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={2}>
            {BILLING_ISSUE_MODULES.map((module) => (
              <BillingModuleCard
                key={module.id}
                module={module}
                count={moduleCount(summary, module)}
              />
            ))}
          </Grid>
        )}

        {!summaryLoading && totalIssues === 0 && (
          <Box
            mt={3}
            py={4}
            px={3}
            bg="green.50"
            border="1px solid"
            borderColor="green.100"
            borderRadius="md"
            textAlign="center"
          >
            <Text fontSize="sm" color="green.800" fontWeight="medium">
              No open issues
            </Text>
            <Text fontSize="xs" color="green.700" mt={1} display={{ base: "none", lg: "block" }}>
              Run Sync to refresh data from Zoho, M-Pesa, and TISP
            </Text>
          </Box>
        )}
      </Box>

      {!summaryLoading && (
        <Box display={{ base: "none", lg: "block" }}>
          <BillingReconciliationGuides summary={summary} />
        </Box>
      )}
    </Stack>
  );
}
