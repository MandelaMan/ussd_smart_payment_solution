import { Box, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import { formatCurrency, formatMetricCurrency } from "../lib/api";
import { formatTitleCase } from "../lib/formatText";
import { BRAND } from "../theme";
import { TrendStat } from "./RevenueTrendChart";

export type BuildingRevenuePoint = {
  building: string;
  revenue: number;
  subscribers: number;
};

export function BuildingRevenueChart({ data }: { data: BuildingRevenuePoint[] }) {
  const items = [...data]
    .map((row) => ({
      ...row,
      building: formatTitleCase(row.building) || row.building,
      revenue: Number(row.revenue) || 0,
      subscribers: Number(row.subscribers) || 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.subscribers - a.subscribers)
    .slice(0, 8);

  const total = items.reduce((sum, row) => sum + row.revenue, 0);
  const collecting = items.filter((row) => row.revenue > 0);
  const peak = collecting[0] ?? null;
  const average = collecting.length > 0 ? total / collecting.length : 0;
  const peakShare = peak && total > 0 ? Math.round((peak.revenue / total) * 100) : 0;
  const max = Math.max(...items.map((row) => row.revenue), 1);

  if (items.length === 0) {
    return (
      <Flex h="140px" align="center" justify="center">
        <Text fontSize="xs" color="fg.subtle">
          No building revenue data yet
        </Text>
      </Flex>
    );
  }

  return (
    <Box>
      <Grid
        templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }}
        bg="bg.muted"
        borderRadius="md"
        mb={2.5}
        overflow="hidden"
      >
        <TrendStat
          label="Total collected"
          value={formatMetricCurrency(total)}
          hint="Last 30 days"
        />
        <TrendStat
          label="Peak"
          value={peak ? formatMetricCurrency(peak.revenue) : "—"}
          hint={peak ? `${peak.building} · ${peakShare}%` : undefined}
        />
        <TrendStat
          label="Average"
          value={formatMetricCurrency(average)}
          hint="Collecting buildings"
        />
        <TrendStat
          label="Collecting"
          value={`${collecting.length} of ${items.length}`}
          hint={collecting.length === 0 ? "No collections" : "Buildings with revenue"}
        />
      </Grid>

      <Stack gap={2.5} pt={0.5}>
        {items.map((item, index) => {
          const share = item.revenue / max;
          const ofTotal = total > 0 ? Math.round((item.revenue / total) * 100) : 0;

          return (
            <Stack key={`${item.building}-${index}`} gap={1}>
              <Flex align="start" gap={2.5} minW={0}>
                <Flex
                  w="18px"
                  h="18px"
                  mt="1px"
                  flexShrink={0}
                  align="center"
                  justify="center"
                  borderRadius="full"
                  bg={index === 0 && item.revenue > 0 ? BRAND.cerulean : "brand.50"}
                  color={index === 0 && item.revenue > 0 ? "white" : "brand.700"}
                  fontSize="2xs"
                  fontWeight="bold"
                >
                  {index + 1}
                </Flex>
                <Box flex="1" minW={0}>
                  <Text
                    fontSize="xs"
                    fontWeight="medium"
                    color="fg"
                    lineHeight="1.35"
                    overflowWrap="anywhere"
                    title={item.building}
                  >
                    {item.building}
                  </Text>
                  <Text fontSize="2xs" color="fg.muted" mt={0.5} lineHeight="1.2">
                    {item.subscribers.toLocaleString()} active
                    {item.revenue > 0 ? ` · ${ofTotal}%` : ""}
                  </Text>
                </Box>
                <Text
                  flexShrink={0}
                  fontSize="xs"
                  fontWeight="bold"
                  color="fg"
                  lineHeight="1.35"
                  fontVariantNumeric="tabular-nums"
                >
                  {item.revenue > 0 ? formatCurrency(item.revenue) : "—"}
                </Text>
              </Flex>
              <Box ml="26px" h="6px" bg="bg.muted" borderRadius="full" overflow="hidden">
                <Box
                  h="100%"
                  w={`${Math.max(share * 100, item.revenue > 0 ? 3 : 0)}%`}
                  minW={item.revenue > 0 ? "6px" : 0}
                  bg={BRAND.cerulean}
                  borderRadius="full"
                  opacity={0.5 + share * 0.5}
                />
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
