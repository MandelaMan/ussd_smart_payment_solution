import { Box, Button, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  FiActivity,
  FiAlertCircle,
  FiDollarSign,
  FiPercent,
  FiTrendingDown,
  FiTrendingUp,
  FiTv,
  FiUserPlus,
  FiUsers,
  FiWifiOff,
} from "react-icons/fi";
import {
  api,
  type BiDashboard,
  type BiDashboardFilters,
  type ForecastIntelligence,
} from "../lib/api";
import { BiFilters } from "../components/bi/BiFilters";
import { BiKpiCard } from "../components/bi/BiKpiCard";
import {
  BiCustomerCharts,
  BiFinancialCharts,
  BiInsightsCharts,
  BiRevenueCharts,
  BiSalesCharts,
  formatKpiValue,
} from "../components/bi/BiDashboardCharts";
import { BiForecastPanel } from "../components/bi/BiForecastPanel";
import { BiInsightsFeed } from "../components/bi/BiInsightsFeed";
import { ChartSkeleton } from "../components/PageSkeletons";
import { PageHeader } from "../components/ui/pageLayout";
import { BRAND } from "../theme";

type AnalyticsTab =
  | "pulse"
  | "revenue"
  | "forecast"
  | "customers"
  | "billing"
  | "sales"
  | "network"
  | "intelligence";

const TABS: Array<{ id: AnalyticsTab; label: string; phase2?: boolean }> = [
  { id: "pulse", label: "Pulse" },
  { id: "revenue", label: "Revenue & Cash" },
  { id: "forecast", label: "Forecast" },
  { id: "customers", label: "Customers" },
  { id: "billing", label: "Billing Health" },
  { id: "sales", label: "Sales" },
  { id: "network", label: "Network", phase2: true },
  { id: "intelligence", label: "Intelligence" },
];

function defaultFilters(): BiDashboardFilters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function BusinessIntelligencePage() {
  const [tab, setTab] = useState<AnalyticsTab>("pulse");
  const [draftFilters, setDraftFilters] = useState<BiDashboardFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<BiDashboardFilters>(defaultFilters);
  const [data, setData] = useState<BiDashboard | null>(null);
  const [forecast, setForecast] = useState<ForecastIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filters: BiDashboardFilters) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBiDashboard(filters);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadForecast = useCallback(async (filters: BiDashboardFilters) => {
    setForecastLoading(true);
    try {
      const res = await api.getBiForecast(filters);
      setForecast(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load forecast");
    } finally {
      setForecastLoading(false);
    }
  }, []);

  useEffect(() => {
    load(appliedFilters);
  }, [appliedFilters, load]);

  useEffect(() => {
    if (tab === "forecast" || tab === "intelligence" || tab === "pulse") {
      void loadForecast(appliedFilters);
    }
  }, [tab, appliedFilters, loadForecast]);

  const handleExportCsv = async (section: string) => {
    await api.exportBiSection(section, appliedFilters);
  };

  const kpis = data?.kpis;
  const filterOptions = data?.filterOptions ?? null;

  const kpiDefs = [
    { key: "totalActiveCustomers", title: "Active Customers", icon: FiUsers, trend: null as number | null, accent: BRAND.cerulean },
    { key: "totalSuspendedCustomers", title: "Suspended Customers", icon: FiWifiOff, trend: null, accent: "#e8a838" },
    { key: "mrr", title: "MRR", icon: FiDollarSign, trend: kpis?.trends.mrr ?? null, accent: BRAND.cerulean },
    { key: "arr", title: "ARR", icon: FiDollarSign, trend: null, accent: BRAND.paleAzure },
    { key: "revenueCollectedThisMonth", title: "Revenue Collected", icon: FiTrendingUp, trend: kpis?.trends.revenueCollected ?? null, accent: "#0d9488" },
    { key: "expectedCollections", title: "Expected Collections (30d)", icon: FiActivity, trend: null, accent: BRAND.sandyBrown },
    { key: "outstandingInvoiceBalance", title: "Outstanding Balance", icon: FiAlertCircle, trend: null, accent: "#c45c5c" },
    { key: "collectionRate", title: "Collection Rate", icon: FiPercent, trend: null, accent: BRAND.sandyBrown },
    { key: "newCustomersThisMonth", title: "New Customers", icon: FiUserPlus, trend: kpis?.trends.newCustomers ?? null, accent: BRAND.paleAzure },
    { key: "customerChurnRate", title: "Churn Rate", icon: FiTrendingDown, trend: kpis?.trends.churnRate ?? null, accent: "#c45c5c" },
    { key: "arpu", title: "ARPU", icon: FiDollarSign, trend: null, accent: BRAND.cerulean },
    { key: "avgCustomerLifetimeValue", title: "CLV", icon: FiActivity, trend: null, accent: BRAND.sandyBrown },
    { key: "activeTvSubscribers", title: "TV Subscribers", icon: FiTv, trend: null, accent: BRAND.mindaro },
    { key: "paymentSuccessRate", title: "Payment Success Rate", icon: FiPercent, trend: null, accent: "#0d9488" },
  ] as const;

  const pulseKpis = kpiDefs.slice(0, 8);

  return (
    <Stack gap={4} pb={6}>
      <PageHeader
        title="Analytics"
        actions={
          <Button asChild size="sm" variant="outline">
            <RouterLink to="/reports">Open Reports</RouterLink>
          </Button>
        }
      />

      <BiFilters
        filters={draftFilters}
        options={filterOptions}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters })}
        onReset={() => {
          const d = defaultFilters();
          setDraftFilters(d);
          setAppliedFilters(d);
        }}
      />

      <Flex gap={2} flexWrap="wrap">
        {TABS.map((t) => (
          <Button
            key={t.id}
            size="xs"
            variant={tab === t.id ? "solid" : "outline"}
            colorPalette="brand"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </Flex>

      {error && (
        <Box bg="red.50" border="1px solid" borderColor="red.100" borderRadius="lg" p={4}>
          <Text color="red.700" fontSize="sm">
            {error}
          </Text>
        </Box>
      )}

      {tab === "pulse" && (
        <Stack gap={4}>
          {loading && !data ? (
            <ChartSkeleton />
          ) : (
            <Grid
              templateColumns={{
                base: "1fr",
                sm: "repeat(2, 1fr)",
                lg: "repeat(3, 1fr)",
                xl: "repeat(4, 1fr)",
              }}
              gap={3}
            >
              {pulseKpis.map((def) => {
                const raw = kpis?.[def.key as keyof typeof kpis];
                const value =
                  typeof raw === "number" || raw == null
                    ? formatKpiValue(def.key, raw as number | null)
                    : "—";
                return (
                  <BiKpiCard
                    key={def.key}
                    title={def.title}
                    value={value}
                    trend={def.trend}
                    icon={def.icon}
                    accent={def.accent}
                  />
                );
              })}
            </Grid>
          )}
          {forecast && <BiInsightsFeed insights={forecast.insights.slice(0, 3)} />}
          {data && (
            <BiRevenueCharts data={data} onExportCsv={handleExportCsv} />
          )}
        </Stack>
      )}

      {tab === "revenue" && data && (
        <BiRevenueCharts data={data} onExportCsv={handleExportCsv} />
      )}

      {tab === "forecast" && (
        forecastLoading && !forecast ? (
          <ChartSkeleton />
        ) : forecast ? (
          <BiForecastPanel data={forecast} />
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Forecast data unavailable.
          </Text>
        )
      )}

      {tab === "customers" && data && (
        <BiCustomerCharts data={data} onExportCsv={handleExportCsv} />
      )}

      {tab === "billing" && data && <BiFinancialCharts data={data} />}

      {tab === "sales" && data && (
        <Stack gap={4}>
          <BiSalesCharts data={data} onExportCsv={handleExportCsv} />
          <BiInsightsCharts data={data} />
        </Stack>
      )}

      {tab === "network" && (
        <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={6}>
          <Text fontWeight="semibold" mb={2}>
            Network analytics (data-gated)
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Uptime, outages, bandwidth, and technician metrics appear here only when network /
            field-service feeds are connected. Until then this tab stays intentionally empty — no
            stub KPIs.
          </Text>
          {forecast && (
            <Text fontSize="xs" color="fg.subtle" mt={3}>
              networkReady = {String(forecast.networkReady)}
            </Text>
          )}
        </Box>
      )}

      {tab === "intelligence" && (
        <Stack gap={4}>
          {forecastLoading && !forecast ? (
            <ChartSkeleton />
          ) : forecast ? (
            <>
              <BiInsightsFeed insights={forecast.insights} />
              <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={4}>
                <Text fontWeight="semibold" fontSize="sm" mb={2}>
                  Budget vs actual / variance
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  {forecast.variance.label}: expected{" "}
                  {formatKpiValue("mrr", forecast.variance.budgetOrExpected)}, actual{" "}
                  {formatKpiValue("mrr", forecast.variance.actual)}, variance{" "}
                  {formatKpiValue("mrr", forecast.variance.variance)} (
                  {forecast.variance.variancePct}%).
                </Text>
              </Box>
              <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={4}>
                <Text fontWeight="semibold" fontSize="sm" mb={2}>
                  Scenario modelling
                </Text>
                <Stack gap={1}>
                  {forecast.scenarios.map((s) => (
                    <Text key={s.shockPct} fontSize="sm" color="fg.muted">
                      {s.label}: month-end {formatKpiValue("mrr", s.projectedMonthEnd)} (
                      {s.coverageVsMrr}% of MRR)
                    </Text>
                  ))}
                </Stack>
              </Box>
            </>
          ) : null}
        </Stack>
      )}

      {(loading || forecastLoading) && data && (
        <Text fontSize="xs" color="fg.subtle">
          Refreshing…
        </Text>
      )}

      {data?.meta && (
        <Text fontSize="xs" color="fg.subtle" textAlign="right">
          Updated {new Date(data.meta.generatedAt).toLocaleString("en-KE")}
          {data.meta.metricEngine ? ` · ${data.meta.metricEngine}` : ""}
          {data.meta.cached ? " · cached" : ""}
        </Text>
      )}
    </Stack>
  );
}
