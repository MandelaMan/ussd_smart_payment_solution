import { Box, Flex, Grid, Icon, Text } from "@chakra-ui/react";
import { useId } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FiMinus, FiTrendingDown, FiTrendingUp } from "react-icons/fi";
import { formatCurrency, formatMetricCurrency } from "../lib/api";
import { BRAND } from "../theme";
import { ChartSkeleton } from "./PageSkeletons";

export type RevenueTrendPoint = {
  day: string;
  label: string;
  count: number;
  revenue: number;
  success: number;
  failed: number;
};

export function formatAxisRevenue(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 10_000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

export function summarizeRevenueTrend(
  data: RevenueTrendPoint[],
  chartMonth: string
) {
  const total = data.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const payments = data.reduce((sum, row) => sum + Number(row.success || 0), 0);
  const failed = data.reduce((sum, row) => sum + Number(row.failed || 0), 0);
  const collecting = data.filter((row) => row.revenue > 0);
  const peak = collecting.reduce<RevenueTrendPoint | null>((best, row) => {
    if (!best || row.revenue > best.revenue) return row;
    return best;
  }, null);
  const average = collecting.length > 0 ? total / collecting.length : 0;

  let changePct: number | null = null;
  for (let index = data.length - 1; index >= 1; index -= 1) {
    const last = data[index];
    const prev = data[index - 1];
    if (last.revenue === 0 && prev.revenue === 0) continue;
    if (prev.revenue > 0) {
      changePct = Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100);
    } else if (last.revenue > 0) {
      changePct = 100;
    }
    break;
  }

  return {
    total,
    payments,
    failed,
    peak,
    average,
    changePct,
    averageHint: chartMonth === "all" ? "Collecting months" : "Collecting days",
    changeHint: chartMonth === "all" ? "vs prior month" : "vs prior day",
  };
}

export function TrendStat({
  label,
  value,
  hint,
  trend,
  trendHint,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: number | null;
  trendHint?: string;
}) {
  const isUp = (trend ?? 0) > 0;
  const isDown = (trend ?? 0) < 0;
  const TrendIcon = isUp ? FiTrendingUp : isDown ? FiTrendingDown : FiMinus;

  return (
    <Box minW={0} px={{ base: 2, md: 2.5 }} py={2}>
      <Text fontSize="2xs" color="fg.muted" fontWeight="semibold" letterSpacing="0.02em">
        {label}
      </Text>
      <Text fontSize="xs" fontWeight="bold" color="fg" lineHeight="1.3" mt={0.5}>
        {value}
      </Text>
      {trend != null ? (
        <Flex
          align="center"
          gap={1}
          mt={0.5}
          fontSize="2xs"
          color={isUp ? "green.600" : isDown ? "red.500" : "fg.muted"}
        >
          <Icon as={TrendIcon} boxSize={3} />
          <Text fontWeight="semibold">
            {isUp ? "+" : isDown ? "−" : ""}
            {Math.abs(trend)}%
          </Text>
          {trendHint ? <Text color="fg.muted">{trendHint}</Text> : null}
        </Flex>
      ) : hint ? (
        <Text fontSize="2xs" color="fg.subtle" mt={0.5} overflowWrap="anywhere">
          {hint}
        </Text>
      ) : null}
    </Box>
  );
}

function RevenueTooltip({
  active,
  payload,
  chartMonth,
}: {
  active?: boolean;
  payload?: Array<{ payload: RevenueTrendPoint }>;
  chartMonth: string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  const title =
    chartMonth === "all"
      ? new Date(`${row.day}T00:00:00`).toLocaleDateString("en-KE", {
          month: "long",
          year: "numeric",
        })
      : new Date(`${row.day}T00:00:00`).toLocaleDateString("en-KE", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });

  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="border.muted"
      px={3}
      py={2}
      borderRadius="md"
      boxShadow="md"
      minW="160px"
    >
      <Text fontSize="xs" fontWeight="semibold" color="fg" mb={1.5}>
        {title}
      </Text>
      <Flex justify="space-between" gap={4} fontSize="xs">
        <Text color="fg.muted">Revenue</Text>
        <Text fontWeight="semibold">{formatCurrency(row.revenue)}</Text>
      </Flex>
      <Flex justify="space-between" gap={4} fontSize="xs" mt={0.5}>
        <Text color="fg.muted">Payments</Text>
        <Text fontWeight="semibold">{row.success.toLocaleString()}</Text>
      </Flex>
      {row.failed > 0 ? (
        <Flex justify="space-between" gap={4} fontSize="xs" mt={0.5}>
          <Text color="fg.muted">Failed</Text>
          <Text fontWeight="semibold" color="red.500">
            {row.failed.toLocaleString()}
          </Text>
        </Flex>
      ) : null}
    </Box>
  );
}

export function RevenueTrendChart({
  data,
  chartMonth,
  loading,
  error,
  emptyLabel,
  height,
}: {
  data: RevenueTrendPoint[];
  chartMonth: string;
  loading?: boolean;
  error?: string;
  emptyLabel: string;
  height: string | { base?: string; md?: string };
}) {
  const uid = useId().replace(/:/g, "");
  const summary = summarizeRevenueTrend(data, chartMonth);
  const isEmpty = data.length === 0 || data.every((row) => row.revenue === 0);

  return (
    <Box>
      {!loading && !error && !isEmpty ? (
        <Grid
          templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }}
          bg="bg.muted"
          borderRadius="md"
          mb={3}
          overflow="hidden"
        >
          <TrendStat
            label="Total collected"
            value={formatMetricCurrency(summary.total)}
            trend={summary.changePct}
            trendHint={summary.changeHint}
          />
          <TrendStat
            label="Peak"
            value={summary.peak ? formatMetricCurrency(summary.peak.revenue) : "—"}
            hint={summary.peak ? summary.peak.label : undefined}
          />
          <TrendStat
            label="Average"
            value={formatMetricCurrency(summary.average)}
            hint={summary.averageHint}
          />
          <TrendStat
            label="Payments"
            value={summary.payments.toLocaleString()}
            hint={
              summary.failed > 0
                ? `${summary.failed.toLocaleString()} failed`
                : "Successful"
            }
          />
        </Grid>
      ) : null}

      {!loading && !error && !isEmpty ? (
        <Flex justify="flex-end" gap={4} mb={1} px={1} fontSize="2xs" color="fg.muted">
          <Flex align="center" gap={1.5}>
            <Box w="8px" h="8px" borderRadius="sm" bg={BRAND.cerulean} />
            <Text>Revenue</Text>
          </Flex>
          <Flex align="center" gap={1.5}>
            <Box w="8px" h="8px" borderRadius="full" bg={BRAND.sandyBrown} />
            <Text>Payments</Text>
          </Flex>
        </Flex>
      ) : null}

      <Box h={height} minH={height}>
        {loading ? (
          <ChartSkeleton height="100%" />
        ) : error ? (
          <Flex h="100%" align="center" justify="center" px={3}>
            <Text fontSize="sm" color="fg.subtle" textAlign="center">
              {error}
            </Text>
          </Flex>
        ) : isEmpty ? (
          <Flex h="100%" align="center" justify="center">
            <Text fontSize="sm" color="fg.subtle">
              {emptyLabel}
            </Text>
          </Flex>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{
                top: 4,
                right: 8,
                left: 4,
                bottom: chartMonth === "all" ? 8 : 4,
              }}
            >
              <defs>
                <linearGradient id={`rev-bar-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BRAND.paleAzure} />
                  <stop offset="100%" stopColor={BRAND.cerulean} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: chartMonth === "all" ? 11 : 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={chartMonth === "all" ? 0 : data.length > 15 ? 2 : 0}
                minTickGap={chartMonth === "all" ? 4 : 8}
                tickMargin={8}
                height={chartMonth === "all" ? 28 : 32}
                padding={{ left: 4, right: 8 }}
              />
              <YAxis
                yAxisId="revenue"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickMargin={4}
                tickFormatter={formatAxisRevenue}
              />
              <YAxis
                yAxisId="payments"
                orientation="right"
                tick={{ fontSize: 10, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={32}
                allowDecimals={false}
              />
              <Tooltip
                content={<RevenueTooltip chartMonth={chartMonth} />}
                cursor={{ fill: `${BRAND.cerulean}14` }}
              />
              <Bar
                yAxisId="revenue"
                dataKey="revenue"
                name="Revenue"
                fill={`url(#rev-bar-${uid})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={chartMonth === "all" ? 36 : 14}
                animationDuration={600}
              />
              <Line
                yAxisId="payments"
                type="monotone"
                dataKey="success"
                name="Payments"
                stroke={BRAND.sandyBrown}
                strokeWidth={2.25}
                dot={{ r: 3, fill: BRAND.sandyBrown, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: BRAND.sandyBrown }}
                animationDuration={700}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Box>
    </Box>
  );
}
