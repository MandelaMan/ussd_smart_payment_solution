import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { formatCurrency, type ReconciliationSummary } from "../../lib/api";
import { UpcomingInvoicesForecastStrip } from "../billing/UpcomingInvoicesForecastStrip";

type Props = { summary: ReconciliationSummary };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box px={3} py={2} minW={0} flex="1 1 140px">
      <Text fontSize="2xs" color="fg.muted" fontWeight="medium" textTransform="uppercase" letterSpacing="0.04em">
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="bold" color="brand.800" truncate>
        {value}
      </Text>
    </Box>
  );
}

export function ReconciliationFinancialStrip({ summary }: Props) {
  return (
    <Stack gap={3}>
      <Flex
        wrap="wrap"
        bg="brand.50"
        border="1px solid"
        borderColor="brand.100"
        borderRadius="md"
        divideX={{ md: "1px" }}
        divideColor="brand.100"
        overflow="hidden"
      >
        <Stat label="Outstanding" value={formatCurrency(summary.totalOutstandingBalance)} />
        <Stat label="Revenue at Risk" value={formatCurrency(summary.revenueAtRisk)} />
        <Stat label="Expected (month)" value={formatCurrency(summary.expectedRevenueThisMonth)} />
        <Stat label="Collected (month)" value={formatCurrency(summary.revenueCollectedThisMonth)} />
        <Stat label="Collection Rate" value={`${summary.collectionRate}%`} />
        <Stat
          label="Customers with Issues"
          value={String(summary.sync.issueCustomerCount ?? "—")}
        />
      </Flex>
      {summary.upcomingInvoices ? (
        <UpcomingInvoicesForecastStrip forecast={summary.upcomingInvoices} />
      ) : null}
    </Stack>
  );
}
