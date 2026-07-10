import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import type { ReconciliationSummary } from "../../lib/api";
import {
  BILLING_ISSUE_MODULES,
  BILLING_MODULES,
  moduleCount,
} from "../../lib/billingReconciliationNav";
import { ReconciliationFinancialStrip } from "../reconciliation/ReconciliationFinancialStrip";
import { BillingModuleCard } from "./BillingModuleCard";
import { BillingReconciliationGuides } from "./BillingReconciliationGuides";

type Props = {
  summary: ReconciliationSummary | null;
  summaryLoading: boolean;
};

export function BillingReconciliationOverview({ summary, summaryLoading }: Props) {
  const totalIssues = BILLING_MODULES.reduce(
    (sum, module) => sum + moduleCount(summary, module),
    0,
  );

  return (
    <Stack gap={4}>
      {summary && !summaryLoading && <ReconciliationFinancialStrip summary={summary} />}

      <Box>
        <Heading size="sm" color="brand.800" mb={2} whiteSpace="nowrap">
          Issue modules
        </Heading>
        {summaryLoading ? (
          <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={2}>
            {Array.from({ length: 3 }).map((_, i) => (
              <Box key={i} h="72px" bg="gray.100" borderRadius="md" />
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
              No open issues in tracked modules
            </Text>
            <Text fontSize="xs" color="green.700" mt={1}>
              Run Sync to refresh data from Zoho, M-Pesa, and TISP
            </Text>
          </Box>
        )}
      </Box>

      {!summaryLoading && <BillingReconciliationGuides summary={summary} />}
    </Stack>
  );
}
