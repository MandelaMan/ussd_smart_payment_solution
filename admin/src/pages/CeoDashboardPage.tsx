import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Flex,
  Grid,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  formatCurrency,
  formatMetricCurrency,
  type BiDashboard,
} from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canAccessAnalytics } from "../lib/rbac";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { DashboardSkeleton } from "../components/PageSkeletons";
import { PageErrorBanner, PAGE_STACK_GAP } from "../components/ui/pageLayout";
import { SelectField } from "../components/ui/SelectField";
import { BRAND } from "../theme";

type PeriodDays = 30 | 90;

function periodBounds(days: PeriodDays) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function formatTrend(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function trendColor(value: number | null | undefined) {
  if (value == null) return "fg.muted";
  if (value > 0) return "green.600";
  if (value < 0) return "red.600";
  return "fg.muted";
}

function formatAxisMoney(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function BriefingSection({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="brand.100"
      borderRadius={{ base: "lg", md: "xl" }}
      px={{ base: 3.5, md: 5 }}
      py={{ base: 3.5, md: 5 }}
      minW={0}
    >
      {eyebrow ? (
        <Text
          fontSize="2xs"
          fontWeight="semibold"
          letterSpacing="0.08em"
          textTransform="uppercase"
          color="brand.600"
          mb={1}
        >
          {eyebrow}
        </Text>
      ) : null}
      <Heading size="sm" color="brand.800" mb={{ base: 3, md: 4 }}>
        {title}
      </Heading>
      {children}
    </Box>
  );
}

function PulseFigure({
  label,
  value,
  trend,
  hint,
}: {
  label: string;
  value: string;
  trend?: string | null;
  hint?: string;
}) {
  const trendNum =
    trend != null ? Number(String(trend).replace("%", "").replace("+", "")) : null;
  return (
    <Box minW={0}>
      <Text fontSize="xs" color="fg.muted" fontWeight="medium" mb={1}>
        {label}
      </Text>
      <Text
        fontSize={{ base: "2xl", md: "3xl" }}
        fontWeight="bold"
        color="brand.800"
        letterSpacing="-0.02em"
        lineHeight="1.1"
      >
        {value}
      </Text>
      <Flex align="center" gap={2} mt={1.5} wrap="wrap">
        {trend ? (
          <Text fontSize="xs" fontWeight="semibold" color={trendColor(trendNum)}>
            {trend} vs prior
          </Text>
        ) : null}
        {hint ? (
          <Text fontSize="xs" color="fg.subtle">
            {hint}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}

function StatRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <Flex justify="space-between" align="baseline" gap={3} py={1.5}>
      <Text fontSize="sm" color={muted ? "fg.subtle" : "fg.muted"} minW={0}>
        {label}
      </Text>
      <Text fontSize="sm" fontWeight="semibold" color="brand.800" flexShrink={0}>
        {value}
      </Text>
    </Flex>
  );
}

function RankedList({
  items,
  empty,
}: {
  items: Array<{ label: string; meta: string; value: string }>;
  empty: string;
}) {
  if (!items.length) {
    return (
      <Text fontSize="sm" color="fg.subtle" py={2}>
        {empty}
      </Text>
    );
  }
  return (
    <Stack gap={0} divideY="1px" divideColor="border.muted">
      {items.map((item, index) => (
        <Flex key={`${item.label}-${index}`} justify="space-between" gap={3} py={2.5} align="start">
          <Box minW={0}>
            <Flex align="baseline" gap={2}>
              <Text fontSize="xs" color="fg.subtle" fontWeight="semibold" w="1.25rem">
                {index + 1}
              </Text>
              <Text fontSize="sm" fontWeight="medium" color="brand.800" lineClamp={1}>
                {item.label}
              </Text>
            </Flex>
            <Text fontSize="xs" color="fg.muted" pl={6} mt={0.5}>
              {item.meta}
            </Text>
          </Box>
          <Text fontSize="sm" fontWeight="semibold" color="brand.700" flexShrink={0}>
            {item.value}
          </Text>
        </Flex>
      ))}
    </Stack>
  );
}

export function CeoDashboardPage() {
  const { user } = useAuth();
  const [days, setDays] = useState<PeriodDays>(30);
  const [data, setData] = useState<BiDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const { from, to } = periodBounds(days);
    api
      .getBiDashboard({ from, to })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Failed to load briefing");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const firstName = String(user?.name || "there").trim().split(/\s+/)[0] || "there";

  const packageRanks = useMemo(() => {
    const rows = [...(data?.revenue.byPackage ?? [])]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    return rows.map((row) => ({
      label: row.package,
      meta: `${row.customers} customer${row.customers === 1 ? "" : "s"}`,
      value: formatMetricCurrency(row.revenue),
    }));
  }, [data]);

  const areaRanks = useMemo(() => {
    const rows = [...(data?.revenue.byArea ?? [])]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    return rows.map((row) => ({
      label: row.area,
      meta: `${row.customers} customer${row.customers === 1 ? "" : "s"}`,
      value: formatMetricCurrency(row.revenue),
    }));
  }, [data]);

  const agingRows = useMemo(() => {
    return (data?.financial.debtAging ?? [])
      .filter((b) => b.amount > 0)
      .slice(0, 4)
      .map((b) => ({
        label: b.bucket,
        value: formatMetricCurrency(b.amount),
      }));
  }, [data]);

  const revenueTrend = useMemo(() => {
    return (data?.revenue.monthlyTrend ?? []).map((row) => ({
      month: row.month,
      label: row.month.length >= 7 ? row.month.slice(5) : row.month,
      revenue: row.totalRevenue,
    }));
  }, [data]);

  const collectionTrend = useMemo(() => {
    return (data?.financial.collectionPerformance ?? []).map((row) => ({
      month: row.month,
      label: row.month.length >= 7 ? row.month.slice(5) : row.month,
      invoiced: row.invoiced,
      paid: row.paid,
    }));
  }, [data]);

  const periodSelect = (
    <SelectField
      size="sm"
      w={{ base: "full", sm: "140px" }}
      fieldProps={{
        value: String(days),
        onChange: (e) => setDays(Number(e.target.value) === 90 ? 90 : 30),
      }}
    >
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
    </SelectField>
  );

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  const kpis = data?.kpis;

  return (
    <Stack gap={PAGE_STACK_GAP} pb={6} minW={0} maxW="100%">
      <Box display={{ base: "block", lg: "none" }}>
        <MobilePageChrome
          title="Business pulse"
          headerActions={periodSelect}
        />
      </Box>

      <Box
        display={{ base: "none", lg: "block" }}
        borderBottom="1px solid"
        borderColor="brand.100"
        pb={4}
        mb={1}
      >
        <Flex justify="space-between" align="flex-end" gap={4} wrap="wrap">
          <Box minW={0}>
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              letterSpacing="0.1em"
              textTransform="uppercase"
              color="brand.600"
              mb={1}
            >
              Executive briefing
            </Text>
            <Heading size="lg" color="brand.800" letterSpacing="-0.02em">
              Business pulse
            </Heading>
            <Text fontSize="sm" color="fg.muted" mt={1}>
              Hello {firstName}. Money and growth health for the selected period — not day-to-day
              operations.
            </Text>
          </Box>
          {periodSelect}
        </Flex>
      </Box>

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {!error && kpis ? (
        <>
          <Box
            bg="linear-gradient(135deg, var(--chakra-colors-brand-50) 0%, white 55%)"
            border="1px solid"
            borderColor="brand.100"
            borderRadius={{ base: "lg", md: "xl" }}
            px={{ base: 4, md: 6 }}
            py={{ base: 4, md: 6 }}
          >
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }}
              gap={{ base: 5, md: 8 }}
            >
              <PulseFigure
                label="Revenue collected"
                value={formatMetricCurrency(kpis.revenueCollectedThisMonth)}
                trend={formatTrend(kpis.trends.revenueCollected)}
                hint={`Period ${days}d`}
              />
              <PulseFigure
                label="Monthly recurring revenue"
                value={formatMetricCurrency(kpis.mrr)}
                trend={formatTrend(kpis.trends.mrr)}
              />
              <PulseFigure
                label="Collection rate"
                value={`${kpis.collectionRate}%`}
                hint="Paid vs invoiced"
              />
            </Grid>
          </Box>

          <Grid templateColumns={{ base: "1fr", lg: "1.2fr 1fr" }} gap={3}>
            <BriefingSection eyebrow="Cash & risk" title="Outstanding and AR aging">
              <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={4} mb={3}>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>
                    Outstanding balance
                  </Text>
                  <Text fontSize="xl" fontWeight="bold" color="red.600">
                    {formatMetricCurrency(kpis.outstandingInvoiceBalance)}
                  </Text>
                </Box>
                <Box>
                  <Text fontSize="xs" color="fg.muted" mb={1}>
                    Average revenue per user
                  </Text>
                  <Text fontSize="xl" fontWeight="bold" color="brand.800">
                    {formatMetricCurrency(kpis.arpu)}
                  </Text>
                </Box>
              </Grid>
              {agingRows.length ? (
                <Stack gap={0} divideY="1px" divideColor="border.muted">
                  {agingRows.map((row) => (
                    <StatRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </Stack>
              ) : (
                <Text fontSize="sm" color="fg.subtle">
                  No aged receivables in this window.
                </Text>
              )}
            </BriefingSection>

            <BriefingSection eyebrow="Growth" title="Subscriber health">
              <Stack gap={0} divideY="1px" divideColor="border.muted">
                <StatRow
                  label="Active customers"
                  value={String(kpis.totalActiveCustomers)}
                />
                <StatRow
                  label="Suspended"
                  value={String(kpis.totalSuspendedCustomers)}
                />
                <StatRow
                  label="New this period"
                  value={String(kpis.newCustomersThisMonth)}
                />
                <StatRow
                  label="Churn rate"
                  value={`${kpis.customerChurnRate}%`}
                />
                <StatRow
                  label="Disconnected"
                  value={String(kpis.totalDisconnectedCustomers)}
                  muted
                />
              </Stack>
              {formatTrend(kpis.trends.newCustomers) ? (
                <Text fontSize="xs" color={trendColor(kpis.trends.newCustomers)} mt={3}>
                  New customers {formatTrend(kpis.trends.newCustomers)} vs prior period
                </Text>
              ) : null}
            </BriefingSection>
          </Grid>

          <BriefingSection eyebrow="Revenue" title="Monthly revenue trend">
            <Box h={{ base: "220px", md: "280px" }} w="full" minW={0}>
              {revenueTrend.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ceoRevenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND.cerulean} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={BRAND.cerulean} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(22,106,130,0.12)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatAxisMoney} width={48} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value ?? 0))}
                      labelFormatter={(_, payload) =>
                        String(payload?.[0]?.payload?.month ?? "")
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      name="Total revenue"
                      stroke={BRAND.cerulean}
                      fill="url(#ceoRevenueFill)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Flex h="full" align="center" justify="center">
                  <Text fontSize="sm" color="fg.subtle">
                    No revenue trend data yet
                  </Text>
                </Flex>
              )}
            </Box>
          </BriefingSection>

          {collectionTrend.length > 0 ? (
            <BriefingSection eyebrow="Collections" title="Invoiced vs paid">
              <Box h={{ base: "200px", md: "240px" }} w="full" minW={0}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={collectionTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(22,106,130,0.12)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={formatAxisMoney} width={48} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value ?? 0))} />
                    <Bar dataKey="invoiced" name="Invoiced" fill={BRAND.paleAzure} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="paid" name="Paid" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </BriefingSection>
          ) : null}

          <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3}>
            <BriefingSection eyebrow="Where money comes from" title="Top packages">
              <RankedList items={packageRanks} empty="No package revenue in this period" />
            </BriefingSection>
            <BriefingSection eyebrow="Where money comes from" title="Top areas">
              <RankedList items={areaRanks} empty="No area revenue in this period" />
            </BriefingSection>
          </Grid>

          <Box
            borderTop="1px solid"
            borderColor="brand.100"
            pt={4}
            mt={1}
          >
            <Text
              fontSize="2xs"
              fontWeight="semibold"
              letterSpacing="0.08em"
              textTransform="uppercase"
              color="fg.subtle"
              mb={2}
            >
              Dig deeper
            </Text>
            <Flex gap={{ base: 3, md: 5 }} wrap="wrap" fontSize="sm">
              <RouterLink to="/reports" style={{ color: BRAND.cerulean, fontWeight: 600 }}>
                Reports
              </RouterLink>
              {canAccessAnalytics(user) ? (
                <RouterLink to="/analytics" style={{ color: BRAND.cerulean, fontWeight: 600 }}>
                  Analytics
                </RouterLink>
              ) : null}
              <RouterLink to="/customers" style={{ color: BRAND.cerulean, fontWeight: 600 }}>
                Customers
              </RouterLink>
              <RouterLink to="/transactions" style={{ color: BRAND.cerulean, fontWeight: 600 }}>
                Payments
              </RouterLink>
            </Flex>
          </Box>
        </>
      ) : null}

      {!loading && !error && !kpis ? (
        <EmptyBriefing />
      ) : null}
    </Stack>
  );
}

function EmptyBriefing() {
  return (
    <Box py={10} textAlign="center">
      <Text color="fg.muted" fontSize="sm">
        No briefing data available for this period.
      </Text>
    </Box>
  );
}
