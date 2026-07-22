import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Flex,
  Grid,
  Input,
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
import { api, formatCurrency, formatMetricCurrency, type MonthlyPaymentChurnSummary } from "../lib/api";
import type { ActivityItem, Stats } from "../lib/api";
import { formatProductNameForDisplay } from "../lib/formatText";
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
import { useMobileViewport } from "../hooks/useMobileViewport";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { toaster } from "../components/ui/toaster";

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

/** Calendar month before `now` (1–12) and its year — used as the mobile revenue default. */
function getPreviousCalendarMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    month: String(d.getMonth() + 1),
    year: d.getFullYear(),
  };
}

function revenueChartMargin(chartMonth: string) {
  return {
    top: 12,
    right: 8,
    left: 4,
    bottom: chartMonth === "all" ? 32 : 26,
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
  const isMobile = useMobileViewport();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [chartData, setChartData] = useState<Stats["chart"]>([]);
  const [chartMonth, setChartMonth] = useState("all");
  const [chartYear, setChartYear] = useState(() => new Date().getFullYear());
  const mobileRevenueDefaultApplied = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [churnMonth, setChurnMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [churnDownloading, setChurnDownloading] = useState<"xlsx" | "pdf" | null>(null);
  const [churnSummary, setChurnSummary] = useState<MonthlyPaymentChurnSummary | null>(null);
  const [churnSummaryLoading, setChurnSummaryLoading] = useState(false);

  useEffect(() => {
    if (!isMobile || mobileRevenueDefaultApplied.current) return;
    mobileRevenueDefaultApplied.current = true;
    const previous = getPreviousCalendarMonth();
    setChartMonth(previous.month);
    setChartYear(previous.year);
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    api
      .getStats("30d")
      .then((s) => {
        if (cancelled) return;
        setStats(s);
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
    if (isMobile) {
      setActivity([]);
      return;
    }

    let cancelled = false;
    api
      .getActivity(40)
      .then((a) => {
        if (!cancelled) setActivity(a.data);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isMobile]);

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

  useEffect(() => {
    let cancelled = false;
    setChurnSummaryLoading(true);
    api
      .getMonthlyPaymentChurnSummary(churnMonth)
      .then((summary) => {
        if (!cancelled) setChurnSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setChurnSummary(null);
      })
      .finally(() => {
        if (!cancelled) setChurnSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [churnMonth]);

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
    name: p.mbps
      ? `${formatProductNameForDisplay(p.package)} (${p.mbps}M)`
      : formatProductNameForDisplay(p.package),
    subscribers: p.subscribers,
  }));

  const revenueByBuildingData = (stats.revenueByBuilding ?? [])
    .filter((b) => b.revenue > 0)
    .slice(0, 10)
    .map((b) => ({
      building: b.building,
      revenue: b.revenue,
    }));

  const trendChartHeight = { base: "240px", md: "200px" };

  const zohoSyncRate =
    stats.zoho.total > 0 ? Math.round((stats.zoho.success / stats.zoho.total) * 100) : null;
  const tispSyncRate =
    stats.tisp.total > 0 ? Math.round((stats.tisp.success / stats.tisp.total) * 100) : null;

  const churnMonthLabel = new Date(`${churnMonth}-01`).toLocaleDateString("en-KE", {
    month: "long",
    year: "numeric",
  });

  async function downloadChurnReport(format: "xlsx" | "pdf") {
    try {
      setChurnDownloading(format);
      await api.downloadReport("monthly-payment-churn", { format, month: churnMonth });
      toaster.create({
        title: "Monthly churn report downloaded",
        description: `${churnMonthLabel} (${format.toUpperCase()})`,
        type: "success",
      });
    } catch (e) {
      toaster.create({
        title: "Could not download churn report",
        description: e instanceof Error ? e.message : "Download failed",
        type: "error",
      });
    } finally {
      setChurnDownloading(null);
    }
  }

  return (
    <Flex
      gap={{ base: 2.5, xl: 0 }}
      align="stretch"
      direction={{ base: "column", xl: "row" }}
      flex={{ xl: 1 }}
      w="full"
      minW={0}
      minH={{ xl: 0 }}
      alignSelf="stretch"
      overflow={{ base: "visible", xl: "hidden" }}
      mx={{ xl: -3 }}
      mt={{ xl: -3 }}
      mb={{ xl: -3 }}
    >
      <Stack
        flex={{ base: "none", xl: 1 }}
        w="full"
        minW={0}
        minH={{ base: "auto", xl: 0 }}
        gap={{ base: 4, xl: 3 }}
        overflow={{ base: "visible", xl: "auto" }}
        px={{ base: 0, xl: 3 }}
        py={{ xl: 3 }}
        pr={{ xl: 4 }}
        pb={{ base: 2, xl: 0 }}
      >
        <MobilePageChrome title="Home" />
        {loading ? (
          <Box mx={{ base: -3, xl: 0 }} px={{ base: 1, xl: 0 }}>
            <DashboardMetricsSkeleton />
          </Box>
        ) : isMobile ? (
          <Stack gap={4} mx={-3} px={1}>
            <Box>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={1.5}>
                Overview
              </Text>
              <Grid templateColumns="1fr 1fr" columnGap={2} rowGap={3}>
                <MetricCard
                  accent="cerulean"
                  label="Active subscribers"
                  value={subs.tispActive}
                  sub={`${subs.active} accounts · ${subs.total} total`}
                  to="/customers?status=Active"
                />
                <MetricCard
                  accent="cerulean"
                  label="New subscribers"
                  value={subs.newInPeriod}
                  sub="Last 30 days"
                />
                <MetricCard
                  accent="cerulean"
                  label="Churned"
                  value={subs.cancelled}
                  sub="Cancelled accounts"
                  to="/customers?status=Cancelled"
                />
                <MetricCard
                  accent="cerulean"
                  label="Revenue (30d)"
                  value={formatMetricCurrency(stats.period.revenue)}
                  sub={`${stats.period.transactions} txns`}
                />
                <MetricCard
                  accent="cerulean"
                  label="Success rate"
                  value={`${successRate}%`}
                  sub={`${stats.mpesa.success} success`}
                />
                <MetricCard
                  accent="cerulean"
                  label="Avg. payment"
                  value={formatMetricCurrency(stats.avgTransaction)}
                  sub="Successful payments"
                />
              </Grid>
            </Box>

            <Card title="Subscribers by building" accent="cerulean">
              <Stack gap={0} divideY="1px" divideColor="gray.100">
                {subs.topBuildings.length === 0 ? (
                  <Text fontSize="xs" color="fg.subtle" py={2}>
                    No subscriber data
                  </Text>
                ) : (
                  subs.topBuildings.map((b) => (
                    <Flex
                      key={b.building}
                      justify="space-between"
                      align="center"
                      gap={2}
                      py={2}
                      minW={0}
                    >
                      <DisplayText
                        value={b.building}
                        fontWeight="medium"
                        fontSize="sm"
                        maxLength={null}
                        minW={0}
                        lineClamp={1}
                      />
                      <Text
                        fontSize="sm"
                        fontWeight="semibold"
                        color="brand.700"
                        flexShrink={0}
                        whiteSpace="nowrap"
                      >
                        {b.subscribers}
                      </Text>
                    </Flex>
                  ))
                )}
              </Stack>
              {subs.topBuildings.length > 0 ? (
                <Text fontSize="2xs" color="fg.muted" mt={2}>
                  {subs.topBuildings.length} building
                  {subs.topBuildings.length === 1 ? "" : "s"} · active subscribers
                </Text>
              ) : null}
            </Card>
          </Stack>
        ) : (
          <Stack gap={{ base: 5, xl: 3 }}>
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={3}>
                Subscribers
              </Text>
              <Grid
                templateColumns={{
                  base: "1fr 1fr",
                  lg: "repeat(3, 1fr)",
                  xl: "repeat(5, 1fr)",
                }}
                gap={{ base: 3, xl: 3 }}
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
                      ? `${subs.tispUnknown} not on TISP`
                      : `${subs.active} active accounts`
                  }
                  to="/customers?status=Active"
                />
              </Grid>
            </Box>

            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="fg.muted" mb={3}>
                Payments
              </Text>
              <Grid
                templateColumns={{
                  base: "1fr 1fr",
                  lg: "repeat(3, 1fr)",
                  xl: "repeat(5, 1fr)",
                }}
                gap={{ base: 3, xl: 3 }}
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
                <Box gridColumn={{ base: "1 / -1", xl: "auto" }}>
                  <MetricCard
                    accent="cerulean"
                    label="Success Rate"
                    value={`${successRate}%`}
                    sub={`${stats.mpesa.success} success · ${stats.mpesa.failed} failed`}
                    sub2={`Avg ${formatMetricCurrency(stats.avgTransaction)}`}
                  />
                </Box>
              </Grid>
            </Box>
          </Stack>
        )}

        <Grid
          templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }}
          gap={{ base: 4, xl: 3 }}
          display={{ base: "none", lg: "grid" }}
        >
          <Card title="Most Subscribed Packages" accent="cerulean">
            {packageChartData.length === 0 ? (
              <Flex minH={{ base: "180px", md: "160px" }} align="center" justify="center">
                <Text fontSize="sm" color="fg.subtle">No package data yet</Text>
              </Flex>
            ) : (
              <PackageSubscriptionChart data={packageChartData} />
            )}
          </Card>

          <Card title="Payment Insights" accent="cerulean">
            <Stack gap={{ base: 3.5, xl: 3 }} fontSize="sm">
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

        {isMobile ? (
          <Box mx={-3} px={1}>
          <Card
            title="Revenue trend"
            subtitle={monthLabel}
            accent="cerulean"
            action={
              <SelectField
                w="120px"
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
            <Box h="180px" minH="180px" mt={0.5}>
              {chartLoading ? (
                <ChartSkeleton height="100%" />
              ) : chartIsEmpty ? (
                <Flex h="100%" align="center" justify="center">
                  <Text fontSize="sm" color="fg.subtle">
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
                      <linearGradient id="rev-mobile" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BRAND.cerulean} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={BRAND.cerulean} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: chartMonth === "all" ? 10 : 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      interval={chartMonth === "all" ? 0 : monthDayCount > 15 ? 2 : 0}
                      minTickGap={chartMonth === "all" ? 4 : 8}
                      tickMargin={10}
                      height={chartMonth === "all" ? 44 : 40}
                      padding={{ left: 4, right: 8 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tickMargin={4}
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
                      fill="url(#rev-mobile)"
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Card>
          </Box>
        ) : null}

        <Grid
          templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }}
          gap={{ base: 4, xl: 3 }}
          display={{ base: "none", lg: "grid" }}
        >
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
            <Box h={trendChartHeight} minH={trendChartHeight} mt={1}>
              {chartLoading ? (
                <ChartSkeleton height="100%" />
              ) : chartIsEmpty ? (
                <Flex h="100%" align="center" justify="center">
                  <Text fontSize="sm" color="fg.subtle">
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
                      tick={{ fontSize: chartMonth === "all" ? 10 : 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      interval={chartMonth === "all" ? 0 : monthDayCount > 15 ? 2 : 0}
                      minTickGap={chartMonth === "all" ? 4 : 8}
                      tickMargin={10}
                      height={chartMonth === "all" ? 44 : 40}
                      padding={{ left: 4, right: 8 }}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      width={44}
                      tickMargin={4}
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
                      strokeWidth={2.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Card>

          <Card title="By Status" accent="cerulean">
            <Box h={trendChartHeight} minH={trendChartHeight} mt={1}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.statusBreakdown}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="48%"
                    innerRadius={54}
                    outerRadius={80}
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

        <Grid
          templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }}
          gap={{ base: 4, xl: 3 }}
          display={{ base: "none", lg: "grid" }}
        >
          <Card
            title="Monthly Payment Churn Report"
            subtitle={churnMonthLabel}
            accent="cerulean"
            action={
              <Input
                size="sm"
                type="month"
                w="150px"
                value={churnMonth}
                onChange={(e) => setChurnMonth(e.target.value)}
              />
            }
          >
            <Flex direction="column" h={trendChartHeight} minH={trendChartHeight} mt={1}>
              <Stack gap={2.5} flex={1}>
                <Flex justify="space-between" align="baseline" gap={2}>
                  <Text fontSize="xs" color="fg.muted">
                    Total churned
                  </Text>
                  <Text fontSize="lg" fontWeight="semibold" color="brand.700">
                    {churnSummaryLoading ? "…" : (churnSummary?.total ?? 0)}
                  </Text>
                </Flex>
                <Flex justify="space-between" align="baseline" gap={2}>
                  <Text fontSize="xs" color="fg.muted">
                    Outstanding
                  </Text>
                  <Text fontSize="sm" fontWeight="medium" color="fg">
                    {churnSummaryLoading
                      ? "…"
                      : formatCurrency(churnSummary?.totalOutstanding ?? 0)}
                  </Text>
                </Flex>
                <Stack gap={1.5} fontSize="xs" flex={1}>
                  {(churnSummary?.byReason ?? []).map((row) => (
                    <Flex key={row.reason} justify="space-between" gap={2}>
                      <Text color="fg.muted">{row.label}</Text>
                      <Text fontWeight="semibold" color={row.count > 0 ? "brand.700" : "fg.subtle"}>
                        {churnSummaryLoading
                          ? "…"
                          : row.outstanding > 0
                            ? `${row.count} · ${formatCurrency(row.outstanding)}`
                            : row.count}
                      </Text>
                    </Flex>
                  ))}
                </Stack>
              </Stack>
              <Flex gap={2} mt={3}>
                <Button
                  size="sm"
                  variant="outline"
                  flex={1}
                  loading={churnDownloading === "xlsx"}
                  onClick={() => void downloadChurnReport("xlsx")}
                >
                  Excel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  flex={1}
                  loading={churnDownloading === "pdf"}
                  onClick={() => void downloadChurnReport("pdf")}
                >
                  PDF
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Card title="Top Buildings" accent="cerulean">
            <Flex direction="column" h={trendChartHeight} minH={trendChartHeight} mt={1} justify="center">
              <Stack gap={3.5}>
                {subs.topBuildings.slice(0, 6).map((b) => (
                  <Flex key={b.building} justify="space-between" fontSize="sm" align="center">
                    <DisplayText value={b.building} fontWeight="medium" />
                    <Text fontWeight="semibold" color="brand.600" flexShrink={0} ml={2}>
                      {b.subscribers} active
                    </Text>
                  </Flex>
                ))}
                {subs.topBuildings.length === 0 && (
                  <Text fontSize="xs" color="fg.subtle">No subscriber data</Text>
                )}
              </Stack>
            </Flex>
          </Card>
        </Grid>

        <Box display={{ base: "none", lg: "block" }}>
          <Card title="Revenue by Building" subtitle="Last 30 days" accent="cerulean">
            <Box h={trendChartHeight} minH={trendChartHeight} mt={1}>
              {revenueByBuildingData.length === 0 ? (
                <Flex h="100%" align="center" justify="center">
                  <Text fontSize="sm" color="fg.subtle">No building revenue data yet</Text>
                </Flex>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={revenueByBuildingData}
                    margin={{ left: 4, right: 8, top: 8, bottom: 28 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                    <XAxis
                      dataKey="building"
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      angle={-24}
                      textAnchor="end"
                      height={48}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                      tickFormatter={formatAxisRevenue}
                      allowDecimals={false}
                    />
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      contentStyle={{ fontSize: 13 }}
                    />
                    <Bar dataKey="revenue" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Box>
          </Card>
        </Box>
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
      bg="bg.panel"
      borderRadius={{ base: "lg", md: "xl" }}
      px={{ base: 2.5, md: 3.5 }}
      py={{ base: 2.5, md: 3 }}
      border="1px solid"
      borderColor="border.muted"
      borderTopWidth="3px"
      borderTopColor={borderColors[accent]}
      boxShadow="sm"
      w="full"
    >
      <Flex
        justify="space-between"
        align={{ base: "start", sm: "center" }}
        direction={{ base: "column", sm: "row" }}
        gap={{ base: 1.5, sm: 2.5 }}
        mb={{ base: 2, md: 2 }}
      >
        <Box minW={0}>
          <Text fontSize="sm" fontWeight="semibold" color="fg" lineHeight="1.3">
            {title}
          </Text>
          {subtitle && (
            <Text fontSize="2xs" color="fg.muted" mt={0.5}>
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
      <Text color="fg.muted">{label}</Text>
      <Text fontWeight="semibold" color="brand.700">
        {value}
      </Text>
    </Flex>
  );
}
