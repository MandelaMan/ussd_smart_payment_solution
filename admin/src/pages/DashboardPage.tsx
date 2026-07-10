import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Flex,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, formatCurrency, formatMetricCurrency } from "../lib/api";
import type { ActivityItem, Stats } from "../lib/api";
import { DisplayText } from "../components/ui/DisplayText";
import { MetricCard } from "../components/MetricCard";
import { PackageSubscriptionChart } from "../components/PackageSubscriptionChart";
import { ActivityPanel } from "../components/ActivityPanel";
import {
  ChartSkeleton,
  DashboardMetricsSkeleton,
  DashboardSkeleton,
} from "../components/PageSkeletons";
import { BRAND } from "../theme";
import { SelectField } from "../components/ui/SelectField";

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: BRAND.cerulean,
  FAILED: "#e53e3e",
  PENDING: BRAND.sandyBrown,
};

const REVENUE_MONTH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "1", label: "Jan" },
  { value: "2", label: "Feb" },
  { value: "3", label: "Mar" },
  { value: "4", label: "Apr" },
  { value: "5", label: "May" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Aug" },
  { value: "9", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
] as const;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatAxisRevenue(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  if (value > 0) return String(Math.round(value));
  return "0";
}

function revenueChartMargin(chartMonth: string) {
  return {
    top: 12,
    right: 16,
    left: 8,
    bottom: chartMonth === "all" ? 28 : 22,
  };
}

function buildRevenueChartData(
  chart: Stats["chart"],
  chartMonth: string,
  chartYear: number
) {
  if (chartMonth === "all") {
    return chart.map((d, index) => ({
      ...d,
      label: MONTH_LABELS[new Date(d.day).getMonth()] || MONTH_LABELS[index] || "",
    }));
  }

  const monthNum = parseInt(chartMonth, 10);
  const daysInMonth = new Date(chartYear, monthNum, 0).getDate();
  const byDay = new Map(chart.map((d) => [new Date(d.day).getDate(), d]));

  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayNum = index + 1;
    const existing = byDay.get(dayNum);
    const dayIso = `${chartYear}-${chartMonth.padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const point = existing || {
      day: dayIso,
      count: 0,
      revenue: 0,
      success: 0,
      failed: 0,
    };
    return {
      ...point,
      day: dayIso,
      label: String(dayNum),
    };
  });
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [chartData, setChartData] = useState<Stats["chart"]>([]);
  const [chartMonth, setChartMonth] = useState("all");
  const chartYear = new Date().getFullYear();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.all([api.getStats("30d"), api.getActivity(40)])
      .then(([s, a]) => {
        if (cancelled) return;
        setStats(s);
        setActivity(a.data.length ? a.data : s.activityFeed || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);

    api
      .getRevenueChart(chartMonth, chartYear)
      .then((r) => {
        if (!cancelled) setChartData(r.chart);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chartMonth, chartYear]);

  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  if (error && !stats) {
    return (
      <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
        {error || "Failed to load stats"}
      </Box>
    );
  }

  if (!stats) {
    return (
      <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
        Failed to load stats
      </Box>
    );
  }

  const rawSubs = stats.subscribers as typeof stats.subscribers & {
    tispConnected?: number;
    tispDisconnected?: number;
  };
  const subs = {
    total: rawSubs?.total ?? 0,
    active: rawSubs?.active ?? 0,
    cancelled: rawSubs?.cancelled ?? 0,
    c2b: rawSubs?.c2b ?? 0,
    b2b: rawSubs?.b2b ?? 0,
    tispFailed: rawSubs?.tispFailed ?? 0,
    tispPending: rawSubs?.tispPending ?? 0,
    newInPeriod: rawSubs?.newInPeriod ?? 0,
    buildings: rawSubs?.buildings ?? 0,
    agencies: rawSubs?.agencies ?? 0,
    topBuildings: rawSubs?.topBuildings ?? [],
    topPackages: rawSubs?.topPackages ?? [],
    avgCustomerPayment: rawSubs?.avgCustomerPayment ?? 0,
    avgPaymentsPerCustomer: rawSubs?.avgPaymentsPerCustomer ?? 0,
    tispActive: Number(rawSubs?.tispActive ?? rawSubs?.tispConnected ?? 0),
    tispSuspended: Number(rawSubs?.tispSuspended ?? rawSubs?.tispDisconnected ?? 0),
    tispUnknown: Number(rawSubs?.tispUnknown ?? 0),
  };

  const successRate =
    stats.mpesa.total > 0
      ? Math.round((stats.mpesa.success / stats.mpesa.total) * 100)
      : 0;

  const revenueChartData = buildRevenueChartData(chartData, chartMonth, chartYear);
  const chartIsEmpty =
    chartMonth === "all"
      ? revenueChartData.every((d) => d.revenue === 0)
      : chartData.length === 0;

  const monthDayCount =
    chartMonth === "all"
      ? 12
      : new Date(chartYear, parseInt(chartMonth, 10), 0).getDate();

  const monthLabel =
    chartMonth === "all"
      ? `All months · ${chartYear}`
      : new Date(
          `${chartYear}-${chartMonth.padStart(2, "0")}-01`
        ).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  const packageChartData = (subs.topPackages ?? []).slice(0, 5).map((p) => ({
    name: p.mbps ? `${p.package} (${p.mbps}M)` : p.package,
    subscribers: p.subscribers,
  }));


  const zohoSyncRate =
    stats.zoho.total > 0 ? Math.round((stats.zoho.success / stats.zoho.total) * 100) : null;
  const tispSyncRate =
    stats.tisp.total > 0 ? Math.round((stats.tisp.success / stats.tisp.total) * 100) : null;

  return (
    <Flex
      gap={{ base: 4, xl: 0 }}
      align={{ base: "flex-start", xl: "stretch" }}
      direction={{ base: "column", xl: "row" }}
      flex={{ xl: 1 }}
      minH={{ xl: 0 }}
      alignSelf={{ xl: "stretch" }}
      overflow={{ xl: "hidden" }}
      mx={{ xl: -3 }}
      mt={{ xl: -3 }}
      mb={{ xl: -3 }}
    >
      <Stack
        flex={1}
        minW={0}
        minH={0}
        gap={3}
        overflowY={{ xl: "auto" }}
        px={{ xl: 3 }}
        py={{ xl: 3 }}
        pr={{ xl: 4 }}
      >
        <Box display={{ base: "block", xl: "none" }}>
          <ActivityPanel items={activity} loading={loading && activity.length === 0} />
        </Box>

        {loading ? (
          <DashboardMetricsSkeleton />
        ) : (
          <>
            <Text fontSize="sm" fontWeight="semibold" color="gray.600">
              Subscribers
            </Text>
            <Grid
              templateColumns={{
                base: "1fr",
                sm: "1fr 1fr",
                lg: "repeat(3, 1fr)",
                xl: "repeat(5, 1fr)",
              }}
              gap={3}
            >
              <MetricCard
                accent="cerulean"
                label="Total Subscribers"
                value={subs.total}
                sub={`${subs.active} active`}
              />
              <MetricCard
                accent="cerulean"
                label="Total Buildings"
                value={subs.buildings}
                sub={`${subs.agencies} agencies`}
              />
              <MetricCard
                accent="cerulean"
                label="Total C2B Clients"
                value={subs.c2b}
              />
              <MetricCard
                accent="cerulean"
                label="Total B2B Clients"
                value={subs.b2b}
              />
              <MetricCard
                accent="cerulean"
                label="TISP Active / Suspended"
                value={`${subs.tispActive} / ${subs.tispSuspended}`}
                sub={`${subs.tispSuspended} suspended`}
                sub2={
                  subs.tispUnknown > 0
                    ? `${subs.tispUnknown} pending status`
                    : `${subs.active} active accounts`
                }
                to="/customers?status=Active"
              />
            </Grid>

            <Text fontSize="sm" fontWeight="semibold" color="gray.600" mt={2}>
              Payments
            </Text>
            <Grid
              templateColumns={{
                base: "1fr",
                sm: "1fr 1fr",
                lg: "repeat(3, 1fr)",
                xl: "repeat(5, 1fr)",
              }}
              gap={3}
            >
              <MetricCard
                accent="cerulean"
                label="Total Collected Amount"
                value={formatMetricCurrency(stats.mpesa.revenue)}
                sub={`${stats.mpesa.success} successful payments`}
              />
              <MetricCard
                accent="cerulean"
                label="Revenue This Month"
                value={formatMetricCurrency(stats.month.revenue)}
                sub={`${stats.month.transactions} transactions`}
              />
              <MetricCard
                accent="cerulean"
                label="Revenue Today"
                value={formatMetricCurrency(stats.today.revenue)}
                sub={`${stats.today.transactions} transactions`}
              />
              <MetricCard
                accent="cerulean"
                label="Returning Payers"
                value={stats.customers.returning}
                sub={`${stats.customers.returningRate}% return rate`}
              />
              <MetricCard
                accent="cerulean"
                label="Success Rate"
                value={`${successRate}%`}
                sub={`${stats.mpesa.success} success · ${stats.mpesa.failed} failed`}
                sub2={`Avg ${formatMetricCurrency(stats.avgTransaction)}`}
              />
            </Grid>
          </>
        )}

        <Grid templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }} gap={3}>
          <Card title="Most Subscribed Packages" accent="cerulean">
            {packageChartData.length === 0 ? (
              <Flex minH="160px" align="center" justify="center">
                <Text fontSize="sm" color="gray.400">No package data yet</Text>
              </Flex>
            ) : (
              <PackageSubscriptionChart data={packageChartData} />
            )}
          </Card>

          <Card title="Payment Insights" accent="cerulean">
            <Stack gap={3} fontSize="sm">
              <Row label="Total transactions" value={String(stats.mpesa.total)} />
              <Row label="Successful payments" value={String(stats.mpesa.success)} />
              <Row label="Failed payments" value={String(stats.mpesa.failed)} />
              <Row label="Pending" value={String(stats.mpesa.pending)} />
              <Row label="Unique payers" value={String(stats.customers.unique)} />
              <Row label="New payers (30d)" value={String(stats.customers.newInPeriod)} />
              <Row
                label="Zoho sync"
                value={zohoSyncRate != null ? `${zohoSyncRate}%` : "—"}
              />
              <Row
                label="TISP sync"
                value={tispSyncRate != null ? `${tispSyncRate}%` : "—"}
              />
            </Stack>
          </Card>
        </Grid>

        <Grid templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }} gap={3}>
          <Card
            title="Revenue Trend"
            subtitle={monthLabel}
            accent="cerulean"
            action={
              <SelectField
                w={{ base: "full", sm: "120px" }}
                size="sm"
                fieldProps={{
                  value: chartMonth,
                  onChange: (e) => setChartMonth(e.target.value),
                  borderRadius: "md",
                  fontSize: "sm",
                }}
              >
                {REVENUE_MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            }
          >
            <Box h={{ base: "180px", md: "200px" }} minH="200px">
              {chartLoading ? (
                <ChartSkeleton height="100%" />
              ) : chartIsEmpty ? (
                <Flex h="100%" align="center" justify="center">
                  <Text fontSize="sm" color="gray.400">
                    No revenue for {monthLabel}
                  </Text>
                </Flex>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={revenueChartData}
                    margin={revenueChartMargin(chartMonth)}
                  >
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND.cerulean} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={BRAND.cerulean} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: chartMonth === "all" ? 9 : 10, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      interval={chartMonth === "all" ? 0 : monthDayCount > 15 ? 2 : 0}
                      minTickGap={chartMonth === "all" ? 2 : 6}
                      tickMargin={10}
                      height={chartMonth === "all" ? 40 : 36}
                      padding={{ left: 8, right: 12 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickMargin={6}
                      tickFormatter={formatAxisRevenue}
                      allowDecimals={false}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      labelFormatter={(_, payload) => {
                        const day = payload?.[0]?.payload?.day;
                        if (!day) return "";
                        return new Date(day).toLocaleDateString("en-KE", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        });
                      }}
                      contentStyle={{ fontSize: 13 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={BRAND.cerulean}
                      fill="url(#rev)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Card>

          <Card title="By Status" accent="cerulean">
            <Box h={{ base: "180px", md: "200px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.statusBreakdown}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                  >
                    {stats.statusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "#ccc"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>

        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }} gap={3}>
          <Card title="By Channel" accent="cerulean">
            <Box h="160px">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.channelBreakdown} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis dataKey="channel" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={34} />
                  <Tooltip contentStyle={{ fontSize: 13 }} />
                  <Bar dataKey="count" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>

          <Card title="Top Buildings" accent="cerulean">
            <Stack gap={3}>
              {subs.topBuildings.slice(0, 4).map((b) => (
                <Flex key={b.building} justify="space-between" fontSize="sm" align="center">
                  <DisplayText value={b.building} fontWeight="medium" />
                  <Text fontWeight="semibold" color="brand.600" flexShrink={0} ml={2}>
                    {b.subscribers} active
                  </Text>
                </Flex>
              ))}
              {subs.topBuildings.length === 0 && (
                <Text fontSize="xs" color="gray.400">No subscriber data</Text>
              )}
            </Stack>
          </Card>

          <Card title="Top Payers" accent="cerulean">
            <Stack gap={3}>
              {stats.topCustomers.slice(0, 4).map((c) => (
                <Flex key={c.customer} justify="space-between" fontSize="sm" align="center">
                  <Box minW={0}>
                    <DisplayText value={c.customer} fontWeight="medium" />
                    <Text color="gray.500">{c.payments} payments</Text>
                  </Box>
                  <Text fontWeight="semibold" color="brand.600" flexShrink={0} ml={2}>
                    {formatCurrency(c.totalSpent)}
                  </Text>
                </Flex>
              ))}
              {stats.topCustomers.length === 0 && (
                <Text fontSize="xs" color="gray.400">No payment data</Text>
              )}
            </Stack>
          </Card>
        </Grid>
      </Stack>

      <Box
        display={{ base: "none", xl: "flex" }}
        flexDirection="column"
        flexShrink={0}
        h="100%"
        minH={0}
      >
        <ActivityPanel items={activity} loading={loading && activity.length === 0} />
      </Box>
    </Flex>
  );
}

function Card({
  title,
  subtitle,
  action,
  children,
  accent = "cerulean",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  accent?: "cerulean" | "azure" | "sandy" | "mindaro";
}) {
  const borderColors = {
    cerulean: BRAND.cerulean,
    azure: BRAND.paleAzure,
    sandy: BRAND.sandyBrown,
    mindaro: BRAND.mindaro,
  };

  return (
    <Box
      bg="white"
      borderRadius="xl"
      px={3.5}
      py={3}
      border="1px solid"
      borderColor="gray.100"
      borderTopWidth="3px"
      borderTopColor={borderColors[accent]}
      boxShadow="sm"
    >
      <Flex
        justify="space-between"
        align={{ base: "start", sm: "center" }}
        direction={{ base: "column", sm: "row" }}
        gap={2}
        mb={2}
      >
        <Box>
          <Text fontSize="md" fontWeight="semibold" color="gray.800">
            {title}
          </Text>
          {subtitle && (
            <Text fontSize="xs" color="gray.500">
              {subtitle}
            </Text>
          )}
        </Box>
        {action}
      </Flex>
      {children}
    </Box>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Flex justify="space-between">
      <Text color="gray.600">{label}</Text>
      <Text fontWeight="semibold" color="brand.700">
        {value}
      </Text>
    </Flex>
  );
}
