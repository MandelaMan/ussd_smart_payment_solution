import { Box, Flex, Text } from "@chakra-ui/react";
import { formatCurrency, type UpcomingInvoicesForecast } from "../../lib/api";

type Props = {
  forecast: UpcomingInvoicesForecast;
  compact?: boolean;
};

function formatWindow(start: string, end: string) {
  const fmt = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function UpcomingInvoicesForecastStrip({ forecast, compact = false }: Props) {
  if (!forecast.invoiceCount && !forecast.anticipatedAmount) {
    return compact ? null : (
      <Box
        p={3}
        bg="bg.muted"
        border="1px solid"
        borderColor="border.muted"
        borderRadius="md"
      >
        <Text fontSize="sm" color="fg.muted">
          No invoices scheduled in the next {forecast.windowDays} days
        </Text>
      </Box>
    );
  }

  return (
    <Flex
      wrap="wrap"
      bg="green.50"
      border="1px solid"
      borderColor="green.100"
      borderRadius="md"
      overflow="hidden"
      divideX={{ md: "1px" }}
      divideColor="green.100"
    >
      <Box px={3} py={2} minW={0} flex="1 1 160px">
        <Text
          fontSize="2xs"
          color="fg.muted"
          fontWeight="medium"
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Invoices next {forecast.windowDays} days
        </Text>
        <Text fontSize="sm" fontWeight="bold" color="green.800">
          {forecast.invoiceCount}
        </Text>
        {!compact && (
          <Text fontSize="2xs" color="fg.muted" mt={0.5}>
            {formatWindow(forecast.windowStart, forecast.windowEnd)}
          </Text>
        )}
      </Box>
      <Box px={3} py={2} minW={0} flex="1 1 180px">
        <Text
          fontSize="2xs"
          color="fg.muted"
          fontWeight="medium"
          textTransform="uppercase"
          letterSpacing="0.04em"
        >
          Anticipated collection
        </Text>
        <Text fontSize="sm" fontWeight="bold" color="green.800" truncate>
          {formatCurrency(forecast.anticipatedAmount)}
        </Text>
        {!compact && (
          <Text fontSize="2xs" color="fg.muted" mt={0.5}>
            Based on active package prices &amp; Zoho recurring schedule
          </Text>
        )}
      </Box>
    </Flex>
  );
}
