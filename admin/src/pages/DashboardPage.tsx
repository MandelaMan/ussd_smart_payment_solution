import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Flex,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { api, formatMetricCurrency } from "../lib/api";
import type { ActivityItem, Stats } from "../lib/api";
import { formatProductNameForDisplay } from "../lib/formatText";
import { premiseLabel } from "../lib/premise";
import { DisplayText } from "../components/ui/DisplayText";
import { MetricCard } from "../components/MetricCard";
import { PackageSubscriptionChart } from "../components/PackageSubscriptionChart";
import { BuildingRevenueChart } from "../components/BuildingRevenueChart";
import { RevenueTrendChart } from "../components/RevenueTrendChart";
import { ActivityPanel } from "../components/ActivityPanel";
import {
  DashboardMetricsSkeleton,
  DashboardSkeleton,
} from "../components/PageSkeletons";
import { BRAND } from "../theme";
import { SelectField } from "../components/ui/SelectField";
import { useMobileViewport } from "../hooks/useMobileViewport";
import { useActivitySocket } from "../hooks/useActivitySocket";
import {
  LIVE_REFRESH_INTERVAL_MS,
  useVisibilityRefresh,
} from "../hooks/useVisibilityRefresh";
import { prependActivityItem } from "../lib/activityFeed";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { useAuth } from "../lib/authContext";

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

const REVENUE_YEAR_OPTIONS = Array.from({ length: 3 }, (_, index) => {
  const year = new Date().getFullYear() - index;
  return { value: String(year), label: String(year) };
});

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

/** Calendar month before `now` (1–12) and its year — used as the mobile revenue default. */
function getPreviousCalendarMonth(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    month: String(d.getMonth() + 1),
    year: d.getFullYear(),
  };
}

function buildRevenueChartData(
  chart: Stats["chart"],
  chartMonth: string,
  chartYear: number
) {
  const now = new Date();

  if (chartMonth === "all") {
    const rows = chart.map((d, index) => {
      const parts = String(d.day || "").split("-");
      const monthIndex = Number(parts[1]) - 1;
      return {
        ...d,
        label:
          MONTH_LABELS[Number.isFinite(monthIndex) ? monthIndex : index] ||
          MONTH_LABELS[index] ||
          "",
      };
    });
    if (chartYear === now.getFullYear()) {
      return rows.slice(0, now.getMonth() + 1);
    }
    return rows;
  }

  const monthNum = parseInt(chartMonth, 10);
  const daysInMonth = new Date(chartYear, monthNum, 0).getDate();
  const byDay = new Map(
    chart.map((d) => {
      const parts = String(d.day || "").split("-");
      const dayNum = Number(parts[2]) || new Date(d.day).getUTCDate();
      return [dayNum, d];
    })
  );

  const isCurrentMonth =
    chartYear === now.getFullYear() && monthNum === now.getMonth() + 1;
  const visibleDays = isCurrentMonth ? now.getDate() : daysInMonth;

  return Array.from({ length: visibleDays }, (_, index) => {
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
  const { user } = useAuth();
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
  const [chartError, setChartError] = useState("");
  const statsReqRef = useRef(0);
  const statsInFlightRef = useRef(false);
  const chartReqRef = useRef(0);
  const chartInFlightRef = useRef(false);

  useEffect(() => {
    if (!isMobile || mobileRevenueDefaultApplied.current) return;
    mobileRevenueDefaultApplied.current = true;
    const previous = getPreviousCalendarMonth();
    setChartMonth(previous.month);
    setChartYear(previous.year);
  }, [isMobile]);

  const loadStats = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent && statsInFlightRef.current) return;
    const req = ++statsReqRef.current;
    statsInFlightRef.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const s = await api.getStats("30d");
      if (req !== statsReqRef.current) return;
      setStats(s);
      if (!silent) setError("");
    } catch (e) {
      if (req !== statsReqRef.current) return;
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      if (req === statsReqRef.current) statsInFlightRef.current = false;
      if (req === statsReqRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (isMobile) {
      setActivity([]);
      return;
    }

    let cancelled = false;
    api
      .getActivity(40)
      .then((a) => {
        if (!cancelled) setActivity(a.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isMobile]);

  const onLiveActivity = useCallback(
    (item: ActivityItem) => {
      setActivity((prev) => prependActivityItem(prev, item, 40, user));
    },
    [user]
  );

  useActivitySocket(onLiveActivity, !isMobile);

  const loadChart = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent && chartInFlightRef.current) return;
    const req = ++chartReqRef.current;
    chartInFlightRef.current = true;
    if (!silent) {
      setChartLoading(true);
      setChartError("");
    }
    try {
      const r = await api.getRevenueChart(chartMonth, chartYear);
      if (req !== chartReqRef.current) return;
      setChartData(r.chart ?? []);
      setChartError("");
    } catch (e) {
      if (req !== chartReqRef.current) return;
      if (!silent) {
        setChartData([]);
        setChartError(e instanceof Error ? e.message : "Failed to load chart");
      }
    } finally {
      if (req === chartReqRef.current) chartInFlightRef.current = false;
      if (req === chartReqRef.current && !silent) setChartLoading(false);
    }
  }, [chartMonth, chartYear]);

  useEffect(() => {
    void loadChart();
  }, [loadChart]);

  useVisibilityRefresh(() => {
    void loadStats({ silent: true });
    void loadChart({ silent: true });
  }, LIVE_REFRESH_INTERVAL_MS);

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
    tispPaused: Number(rawSubs?.tispPaused ?? 0),
    tispUnknown: Number(rawSubs?.tispUnknown ?? 0),
  };

  const successRate =
    stats.mpesa.total > 0
      ? Math.round((stats.mpesa.success / stats.mpesa.total) * 100)
      : 0;

  const revenueChartData = buildRevenueChartData(chartData, chartMonth, chartYear);

  const monthLabel =
    chartMonth === "all"
      ? `All months · ${chartYear}`
      : new Date(
          `${chartYear}-${chartMonth.padStart(2, "0")}-01`
        ).toLocaleDateString("en-KE", { month: "long", year: "numeric" });

  const packageChartData = (subs.topPackages ?? []).slice(0, 5).map((p) => ({
    name: formatProductNameForDisplay(p.package),
    speed: p.mbps ? `${p.mbps} Mbps` : undefined,
    detail: premiseLabel(p.premiseType),
    subscribers: p.subscribers,
  }));

  const revenueByBuildingData = (stats.revenueByBuilding ?? []).map((b) => ({
    building: b.building,
    revenue: b.revenue,
    subscribers: b.subscribers,
  }));

  const trendChartHeight = { base: "240px", md: "200px" };

  const zohoSyncRate =
    stats.zoho.total > 0 ? Math.round((stats.zoho.success / stats.zoho.total) * 100) : null;
  const tispSyncRate =
    stats.tisp.total > 0 ? Math.round((stats.tisp.success / stats.tisp.total) * 100) : null;

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
                  label="Total Customers"
                  value={subs.total}
                  sub={`${subs.tispActive} active · ${subs.tispSuspended} suspended · ${subs.cancelled} cancelled (excluded)`}
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
                  label="Active / Suspended"
                  value={`${subs.tispActive} / ${subs.tispSuspended}`}
                  sub={
                    subs.tispPaused > 0
                      ? `${subs.tispPaused} paused (away)`
                      : "Live vs stopped on TISP"
                  }
                  to="/customers?status=Active,Suspended"
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
          <Card title="Most Subscribed Packages" subtitle="Active customers" accent="cerulean">
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
              <RevenuePeriodFilters
                chartMonth={chartMonth}
                chartYear={chartYear}
                onMonth={setChartMonth}
                onYear={setChartYear}
              />
            }
          >
            <RevenueTrendChart
              data={revenueChartData}
              chartMonth={chartMonth}
              loading={chartLoading}
              error={chartError ? "Couldn’t load revenue chart" : ""}
              emptyLabel={`No revenue for ${monthLabel}`}
              height="200px"
            />
          </Card>
          </Box>
        ) : null}

        <Box display={{ base: "none", lg: "block" }}>
          <Card
            title="Revenue Trend"
            subtitle={monthLabel}
            accent="cerulean"
            action={
              <RevenuePeriodFilters
                chartMonth={chartMonth}
                chartYear={chartYear}
                onMonth={setChartMonth}
                onYear={setChartYear}
              />
            }
          >
            <RevenueTrendChart
              data={revenueChartData}
              chartMonth={chartMonth}
              loading={chartLoading}
              error={chartError ? "Couldn’t load revenue chart" : ""}
              emptyLabel={`No revenue for ${monthLabel}`}
              height="240px"
            />
          </Card>
        </Box>

        <Grid
          templateColumns={{ base: "1fr", lg: "1.6fr 1fr" }}
          gap={{ base: 4, xl: 3 }}
          display={{ base: "none", lg: "grid" }}
        >
          <Card
            title="Reports library"
            subtitle="Churn, collections, and board packs"
            accent="cerulean"
          >
            <Flex direction="column" h={trendChartHeight} minH={trendChartHeight} mt={1} justify="center" gap={3}>
              <Text fontSize="sm" color="fg.muted">
                Monthly payment churn and other exports live in the Reports library so numbers stay
                consistent with Analytics KPIs.
              </Text>
              <Button asChild size="sm" colorPalette="brand" alignSelf="flex-start">
                <RouterLink to="/reports">Open Reports</RouterLink>
              </Button>
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
            <BuildingRevenueChart data={revenueByBuildingData} />
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
        <ActivityPanel
          items={activity}
          loading={loading && activity.length === 0}
          live
        />
      </Box>
    </Flex>
  );
}

function RevenuePeriodFilters({
  chartMonth,
  chartYear,
  onMonth,
  onYear,
}: {
  chartMonth: string;
  chartYear: number;
  onMonth: (value: string) => void;
  onYear: (value: number) => void;
}) {
  return (
    <Flex gap={2} w={{ base: "full", sm: "auto" }}>
      <SelectField
        w={{ base: "full", sm: "104px" }}
        size="sm"
        fieldProps={{
          value: chartMonth,
          onChange: (e) => onMonth(e.target.value),
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
      <SelectField
        w="88px"
        size="sm"
        fieldProps={{
          value: String(chartYear),
          onChange: (e) => onYear(Number(e.target.value)),
          borderRadius: "md",
          fontSize: "sm",
        }}
      >
        {REVENUE_YEAR_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </SelectField>
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
