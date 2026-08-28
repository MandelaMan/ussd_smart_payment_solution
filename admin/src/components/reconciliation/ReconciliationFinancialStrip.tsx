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
  const stats = [
    {
      label: "Outstanding",
      value: formatCurrency(summary.totalOutstandingBalance),
      show: true,
    },
    {
      label: "Customers with issues",
      value: String(summary.sync.issueCustomerCount ?? 0),
      show: true,
    },
    {
      label: "Revenue at risk",
      value: formatCurrency(summary.revenueAtRisk),
      show: summary.revenueAtRisk > 0,
    },
    {
      label: "Expected (month)",
      value: formatCurrency(summary.expectedRevenueThisMonth),
      show: summary.expectedRevenueThisMonth > 0,
    },
  ].filter((stat) => stat.show);

  const forecast = summary.upcomingInvoices;
  const showForecast = Boolean(forecast && (forecast.invoiceCount || forecast.anticipatedAmount));

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
        {stats.map((stat) => (
          <Stat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </Flex>
      {showForecast && forecast ? (
        <UpcomingInvoicesForecastStrip forecast={forecast} />
      ) : null}
    </Stack>
  );
}
