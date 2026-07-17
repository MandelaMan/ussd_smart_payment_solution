import { Box, Grid, Stack, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import {
  FiActivity,
  FiAlertCircle,
  FiClock,
  FiDollarSign,
  FiHeadphones,
  FiPercent,
  FiTrendingDown,
  FiTrendingUp,
  FiTv,
  FiUserMinus,
  FiUserPlus,
  FiUsers,
  FiWifi,
  FiWifiOff,
} from "react-icons/fi";
import {
  api,
  type BiDashboard,
  type BiDashboardFilters,
} from "../lib/api";
import { BiFilters } from "../components/bi/BiFilters";
import { BiKpiCard } from "../components/bi/BiKpiCard";
import { BiSection } from "../components/bi/BiSection";
import {
  BiCustomerCharts,
  BiFinancialCharts,
  BiInsightsCharts,
  BiNetworkCharts,
  BiOperationsCharts,
  BiRevenueCharts,
  BiSalesCharts,
  formatKpiValue,
} from "../components/bi/BiDashboardCharts";
import { ChartSkeleton } from "../components/PageSkeletons";
import { PageHeader } from "../components/ui/pageLayout";
import { BRAND } from "../theme";

function defaultFilters(): BiDashboardFilters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function BusinessIntelligencePage() {
  const [draftFilters, setDraftFilters] = useState<BiDashboardFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<BiDashboardFilters>(defaultFilters);
  const [data, setData] = useState<BiDashboard | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    load(appliedFilters);
  }, [appliedFilters, load]);

  const handleExportCsv = async (section: string) => {
    await api.exportBiSection(section, appliedFilters);
  };

  const kpis = data?.kpis;
  const filterOptions = data?.filterOptions ?? null;

  const kpiDefs = [
    { key: "totalActiveCustomers", title: "Total Active Customers", icon: FiUsers, trend: null as number | null, accent: BRAND.cerulean },
    { key: "totalSuspendedCustomers", title: "Suspended Customers", icon: FiWifiOff, trend: null, accent: "#e8a838" },
    { key: "totalDisconnectedCustomers", title: "Disconnected Customers", icon: FiUserMinus, trend: null, accent: "#c45c5c" },
    { key: "mrr", title: "Monthly Recurring Revenue", icon: FiDollarSign, trend: kpis?.trends.mrr ?? null, accent: BRAND.cerulean },
    { key: "revenueCollectedThisMonth", title: "Revenue Collected", icon: FiTrendingUp, trend: kpis?.trends.revenueCollected ?? null, accent: "#0d9488" },
    { key: "outstandingInvoiceBalance", title: "Outstanding Balance", icon: FiAlertCircle, trend: null, accent: "#c45c5c" },
    { key: "collectionRate", title: "Collection Rate", icon: FiPercent, trend: null, accent: BRAND.sandyBrown },
    { key: "newCustomersThisMonth", title: "New Customers", icon: FiUserPlus, trend: kpis?.trends.newCustomers ?? null, accent: BRAND.paleAzure },
    { key: "customerChurnRate", title: "Customer Churn Rate", icon: FiTrendingDown, trend: kpis?.trends.churnRate ?? null, accent: "#c45c5c" },
    { key: "activeTvSubscribers", title: "Active TV Subscribers", icon: FiTv, trend: null, accent: BRAND.mindaro },
    { key: "arpu", title: "Average Revenue Per User", icon: FiDollarSign, trend: null, accent: BRAND.cerulean },
    { key: "avgInstallationTimeDays", title: "Avg Installation Time", icon: FiClock, trend: null, accent: "#8b6bb1", unavailable: true },
    { key: "activeSupportTickets", title: "Active Support Tickets", icon: FiHeadphones, trend: null, accent: "#5b8a72", unavailable: true },
    { key: "networkUptimePct", title: "Network Uptime", icon: FiWifi, trend: null, accent: "#0d9488", unavailable: true },
    { key: "avgCustomerLifetimeValue", title: "Avg Customer Lifetime Value", icon: FiActivity, trend: null, accent: BRAND.sandyBrown },
  ] as const;

  return (
    <Stack gap={4} pb={6}>
      <PageHeader title="Business Intelligence" />

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

      {error && (
        <Box bg="red.50" border="1px solid" borderColor="red.100" borderRadius="lg" p={4}>
          <Text color="red.700" fontSize="sm">
            {error}
          </Text>
        </Box>
      )}

      <BiSection title="Executive KPIs" subtitle="Month-over-month trends where available">
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
            {kpiDefs.map((def) => {
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
                  unavailable={"unavailable" in def && def.unavailable}
                />
              );
            })}
          </Grid>
        )}
      </BiSection>

      {data && (
        <>
          <BiSection title="Revenue" subtitle="Trends, package mix, and forecast">
            <BiRevenueCharts data={data} onExportCsv={handleExportCsv} />
          </BiSection>

          <BiSection title="Customer Analytics">
            <BiCustomerCharts data={data} onExportCsv={handleExportCsv} />
          </BiSection>

          <BiSection title="Sales Performance" defaultOpen={false}>
            <BiSalesCharts data={data} onExportCsv={handleExportCsv} />
          </BiSection>

          <BiSection title="Financial Performance" defaultOpen={false}>
            <BiFinancialCharts data={data} />
          </BiSection>

          <BiSection title="Operations" defaultOpen={false}>
            <BiOperationsCharts data={data} />
          </BiSection>

          <BiSection title="Network Health" defaultOpen={false}>
            <BiNetworkCharts data={data} />
          </BiSection>

          <BiSection title="Geographic & Advanced Insights" defaultOpen={false}>
            <BiInsightsCharts data={data} />
          </BiSection>
        </>
      )}

      {data?.meta && (
        <Text fontSize="xs" color="fg.subtle" textAlign="right">
          Updated {new Date(data.meta.generatedAt).toLocaleString("en-KE")}
          {data.meta.cached ? " · cached" : ""}
        </Text>
      )}
    </Stack>
  );
}
