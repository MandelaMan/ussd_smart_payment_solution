import { Box, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency, type ReportAnalytics } from "../../lib/api";
import { ChartSkeleton } from "../PageSkeletons";
import { BRAND } from "../../theme";

const CHART_COLORS = [
  BRAND.cerulean,
  BRAND.paleAzure,
  BRAND.sandyBrown,
  BRAND.mindaro,
  "#5b8a72",
  "#c45c5c",
  "#8b6bb1",
  "#e8a838",
];

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: BRAND.cerulean,
  FAILED: "#e53e3e",
  PENDING: BRAND.sandyBrown,
};

const SYNC_COLORS: Record<string, string> = {
  synced: BRAND.cerulean,
  failed: "#e53e3e",
  pending: BRAND.sandyBrown,
  unknown: "#a0aec0",
};

function formatAxisRevenue(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  if (value > 0) return String(Math.round(value));
  return "0";
}

function formatDayLabel(day: string) {
  return new Date(day).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
}

function formatEventLabel(event: string) {
  return event
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ChartCard({
  title,
  subtitle,
  children,
  minH = "240px",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  minH?: string;
}) {
  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="lg"
      borderTopWidth="3px"
      borderTopColor={BRAND.cerulean}
      p={4}
      boxShadow="sm"
    >
      <Box mb={3}>
        <Text fontSize="sm" fontWeight="semibold" color="fg">
          {title}
        </Text>
        {subtitle && (
          <Text fontSize="xs" color="fg.muted" mt={0.5}>
            {subtitle}
          </Text>
        )}
      </Box>
      <Box minH={minH}>{children}</Box>
    </Box>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <Flex h="100%" minH="200px" align="center" justify="center">
      <Text fontSize="sm" color="fg.subtle">
        {message}
      </Text>
    </Flex>
  );
}

function SummaryMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="lg"
      p={3}
      borderLeftWidth="3px"
      borderLeftColor={BRAND.cerulean}
    >
      <Text fontSize="xs" color="fg.muted" mb={1}>
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="bold" color="brand.700">
        {value}
      </Text>
      {sub && (
        <Text fontSize="xs" color="fg.subtle" mt={0.5}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

type Props = {
  data: ReportAnalytics | null;
  loading: boolean;
  error: string;
};

export function BusinessInsightsPanel({ data, loading, error }: Props) {
  if (loading) {
    return (
      <Stack gap={4}>
        <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap={3}>
          {Array.from({ length: 4 }).map((_, i) => (
            <ChartSkeleton key={i} height="80px" />
          ))}
        </Grid>
        <Grid templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }} gap={4}>
          {Array.from({ length: 6 }).map((_, i) => (
            <ChartSkeleton key={i} height="280px" />
          ))}
        </Grid>
      </Stack>
    );
  }

  if (error) {
    return (
      <Box bg="red.50" color="red.700" px={4} py={3} borderRadius="md" fontSize="sm">
        {error}
      </Box>
    );
  }

  if (!data) return null;

  const { summary } = data;
  const subscriberPieData = data.subscriberTypeMix.flatMap((r) => [
    { name: `${r.type} Active`, value: r.active },
    ...(r.cancelled > 0 ? [{ name: `${r.type} Cancelled`, value: r.cancelled }] : []),
  ]).filter((d) => d.value > 0);

  const freqPieData = data.paymentFrequencyMix.map((r) => ({
    name: r.frequency.charAt(0).toUpperCase() + r.frequency.slice(1),
    value: r.count,
  }));

  const packagePieData = data.packageMix.map((r) => ({
    name: r.package,
    value: r.subscribers,
  }));

  const integrationPieData = data.integrationHealth.flatMap((r) => [
    { name: `${r.source} OK`, value: r.success },
    ...(r.failed > 0 ? [{ name: `${r.source} Failed`, value: r.failed }] : []),
  ]).filter((d) => d.value > 0);

  const periodLabel = `${data.period.from} — ${data.period.to}`;

  return (
    <Stack gap={4}>
      <Box>
        <Text fontSize="sm" fontWeight="semibold" color="fg">
          Business insights
        </Text>
        <Text fontSize="xs" color="fg.muted" mt={0.5}>
          Visual analytics for {periodLabel} — use these to spot trends, risks, and growth opportunities.
        </Text>
      </Box>

      <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(3, 1fr)", xl: "repeat(6, 1fr)" }} gap={3}>
        <SummaryMetric label="Revenue" value={formatCurrency(summary.totalRevenue)} />
        <SummaryMetric
          label="Transactions"
          value={summary.totalTransactions.toLocaleString()}
          sub={`${summary.successRate}% success rate`}
        />
        <SummaryMetric label="Avg. payment" value={formatCurrency(summary.avgTransactionValue)} />
        <SummaryMetric label="Active subscribers" value={summary.activeSubscribers.toLocaleString()} />
        <SummaryMetric
          label="New subscribers"
          value={summary.newSubscribers.toLocaleString()}
          sub="in selected period"
        />
        <SummaryMetric
          label="Churned"
          value={summary.churned.toLocaleString()}
          sub="cancellations in period"
        />
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }} gap={4}>
        <ChartCard title="Revenue trend" subtitle="Daily collections — cash flow forecasting">
          {data.revenueTrend.length === 0 ? (
            <EmptyChart message="No revenue in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.revenueTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={formatDayLabel}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={formatAxisRevenue}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={(v, name) => [
                    name === "revenue" ? formatCurrency(Number(v)) : Number(v),
                    name === "revenue" ? "Revenue" : String(name),
                  ]}
                  labelFormatter={(l) => formatDayLabel(String(l))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={BRAND.cerulean}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Payment outcomes" subtitle="Success vs failure — collection reliability">
          {data.paymentStatus.length === 0 ? (
            <EmptyChart message="No transactions in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.paymentStatus}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={78}
                  paddingAngle={2}
                >
                  {data.paymentStatus.map((entry) => (
                    <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "#ccc"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }} gap={4}>
        <ChartCard title="Revenue by channel" subtitle="Which payment channels drive income">
          {data.revenueByChannel.length === 0 ? (
            <EmptyChart message="No channel data" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.revenueByChannel} margin={{ left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="channel" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatAxisRevenue} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  formatter={(v, name) => [
                    name === "revenue" ? formatCurrency(Number(v)) : Number(v),
                    name === "revenue" ? "Revenue" : "Transactions",
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="revenue" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by building" subtitle="Property-level performance ranking">
          {data.revenueByBuilding.length === 0 ? (
            <EmptyChart message="No building revenue data" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.revenueByBuilding}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                <XAxis type="number" tickFormatter={formatAxisRevenue} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="building"
                  tick={{ fontSize: 10 }}
                  width={90}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="revenue" fill={BRAND.paleAzure} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap={4}>
        <ChartCard title="Subscriber mix" subtitle="C2B vs B2B portfolio balance">
          {subscriberPieData.length === 0 ? (
            <EmptyChart message="No subscriber data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={subscriberPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {subscriberPieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Package distribution" subtitle="Most popular plans by subscriber count">
          {packagePieData.length === 0 ? (
            <EmptyChart message="No package data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={packagePieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={68}
                  paddingAngle={2}
                >
                  {packagePieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Billing frequency" subtitle="Monthly vs quarterly vs yearly mix">
          {freqPieData.length === 0 ? (
            <EmptyChart message="No billing data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={freqPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {freqPieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }} gap={4}>
        <ChartCard title="Subscriber growth & churn" subtitle="Net growth trajectory over time">
          {data.subscriberGrowth.length === 0 ? (
            <EmptyChart message="No subscriber activity in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.subscriberGrowth} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={formatDayLabel}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                  allowDecimals={false}
                />
                <Tooltip
                  labelFormatter={(l) => formatDayLabel(String(l))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="new"
                  name="New"
                  stroke={BRAND.cerulean}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="churned"
                  name="Churned"
                  stroke="#e53e3e"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Customer lifecycle" subtitle="Upgrades, downgrades, moves & cancellations">
          {data.lifecycleEvents.length === 0 ? (
            <EmptyChart message="No lifecycle events in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.lifecycleEvents.map((r) => ({ ...r, label: formatEventLabel(r.event) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" fill={BRAND.sandyBrown} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }} gap={4}>
        <ChartCard title="Agency performance" subtitle="Partner-attributed revenue">
          {data.agencyPerformance.length === 0 ? (
            <EmptyChart message="No agency data" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.agencyPerformance} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                <XAxis dataKey="agency" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatAxisRevenue} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  formatter={(v, name) => [
                    name === "revenue" ? formatCurrency(Number(v)) : Number(v),
                    name === "revenue" ? "Revenue" : "Customers",
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="revenue" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="ARPU by building" subtitle="Average revenue per paying customer — pricing insight">
          {data.arpuByBuilding.length === 0 ? (
            <EmptyChart message="No ARPU data" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.arpuByBuilding}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(v) => formatCurrency(Number(v))}
                  tick={{ fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="building"
                  tick={{ fontSize: 10 }}
                  width={90}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="arpu" fill="#5b8a72" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap={4}>
        <ChartCard title="TISP provisioning health" subtitle="Active subscriber sync status">
          {data.tispSyncStatus.length === 0 ? (
            <EmptyChart message="No TISP sync data" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.tispSyncStatus.map((r) => ({
                    name: r.status.charAt(0).toUpperCase() + r.status.slice(1),
                    value: r.count,
                    status: r.status,
                  }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={68}
                  paddingAngle={2}
                >
                  {data.tispSyncStatus.map((entry) => (
                    <Cell key={entry.status} fill={SYNC_COLORS[entry.status] || "#ccc"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Integration success" subtitle="Zoho & TISP outcomes in period">
          {integrationPieData.length === 0 ? (
            <EmptyChart message="No integration events" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={integrationPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {integrationPieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Payment failure reasons" subtitle="Top M-Pesa decline causes — fix bottlenecks">
          {data.failureReasons.length === 0 ? (
            <EmptyChart message="No failed payments in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.failureReasons.map((r) => ({
                  ...r,
                  shortReason: r.reason.length > 28 ? `${r.reason.slice(0, 26)}…` : r.reason,
                }))}
                layout="vertical"
                margin={{ left: 4, right: 12 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="shortReason"
                  tick={{ fontSize: 9 }}
                  width={100}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(v) => [Number(v), "Failures"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.reason || ""}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="count" fill="#e53e3e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </Grid>
    </Stack>
  );
}
