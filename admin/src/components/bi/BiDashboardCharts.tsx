import { Grid } from "@chakra-ui/react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { BiDashboard } from "../../lib/api";
import { formatMetricCurrency } from "../../lib/api";
import { BiChartCard } from "./BiChartCard";
import { LazyEChart } from "./LazyEChart";
import {
  BI_COLORS,
  axisTooltip,
  baseGrid,
  formatKes,
  itemTooltip,
} from "./biChartTheme";

type Props = {
  data: BiDashboard;
  onExportCsv: (section: string) => void;
};

function drillCustomers(navigate: ReturnType<typeof useNavigate>, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  navigate(`/customers?${qs}`);
}

export function BiRevenueCharts({ data, onExportCsv }: Props) {
  const navigate = useNavigate();

  const monthlyOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: axisTooltip(),
      legend: { top: 0, textStyle: { fontSize: 11 } },
      grid: baseGrid,
      xAxis: { type: "category", data: data.revenue.monthlyTrend.map((r) => r.month) },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "Collected Revenue",
          type: "line",
          smooth: true,
          data: data.revenue.monthlyTrend.map((r) => r.totalRevenue),
        },
      ],
    }),
    [data.revenue.monthlyTrend]
  );

  const byPackageOption = useMemo(
    () => ({
      color: [BI_COLORS[0]],
      tooltip: axisTooltip(),
      grid: { ...baseGrid, left: 120 },
      xAxis: { type: "value", axisLabel: { formatter: formatKes } },
      yAxis: {
        type: "category",
        data: [...data.revenue.byPackage].map((r) => r.package).reverse(),
        axisLabel: { width: 110, overflow: "truncate" },
      },
      series: [
        {
          type: "bar",
          data: [...data.revenue.byPackage].map((r) => r.monthlyRevenue).reverse(),
        },
      ],
    }),
    [data.revenue.byPackage]
  );

  const byAreaOption = useMemo(
    () => ({
      color: [BI_COLORS[1]],
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: data.revenue.byArea.map((r) => r.area),
        axisLabel: { rotate: 30, fontSize: 10 },
      },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [{ type: "bar", data: data.revenue.byArea.map((r) => r.revenue) }],
    }),
    [data.revenue.byArea]
  );

  const forecastOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: axisTooltip(),
      legend: { top: 0 },
      grid: baseGrid,
      xAxis: { type: "category", data: data.revenue.forecast.map((r) => r.month) },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "Actual",
          type: "line",
          smooth: true,
          data: data.revenue.forecast.map((r) => r.totalRevenue),
        },
      ],
    }),
    [data.revenue.forecast]
  );

  const hasForecast = data.revenue.forecast.some((r) => r.forecast != null);

  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap={4}>
      <BiChartCard
        title="Monthly Revenue Trend"
        subtitle="Successful payment collections by month"
        exportSection="monthlyRevenue"
        onExportCsv={onExportCsv}
      >
        <LazyEChart option={monthlyOption} />
      </BiChartCard>
      <BiChartCard
        title="Revenue by Package"
        subtitle="Click a bar to view customers"
        exportSection="revenueByPackage"
        onExportCsv={onExportCsv}
        empty={!data.revenue.byPackage.length}
      >
        <LazyEChart
          option={byPackageOption}
          onEvents={{
            click: (raw: unknown) => {
              const params = raw as { name?: string };
              const pkg = data.revenue.byPackage.find((p) => p.package === params.name);
              if (pkg?.packageId) drillCustomers(navigate, { productId: String(pkg.packageId) });
            },
          }}
        />
      </BiChartCard>
      <BiChartCard
        title="Revenue by Area"
        subtitle="MRR grouped by building / estate"
        exportSection="geographic"
        onExportCsv={onExportCsv}
        empty={!data.revenue.byArea.length}
      >
        <LazyEChart
          option={byAreaOption}
          onEvents={{
            click: (raw: unknown) => {
              const params = raw as { name?: string };
              const row = data.revenue.byArea.find((r) => r.area === params.name);
              if (row?.buildingId) drillCustomers(navigate, { buildingId: String(row.buildingId) });
            },
          }}
        />
      </BiChartCard>
      <BiChartCard
        title="Revenue History"
        subtitle={hasForecast ? "Actual vs forecast" : "Collected payments over the last 12 months"}
        empty={!data.revenue.forecast.length}
        emptyMessage="No payment history in range."
      >
        <LazyEChart option={forecastOption} />
      </BiChartCard>
    </Grid>
  );
}

export function BiCustomerCharts({ data, onExportCsv }: Props) {
  const navigate = useNavigate();

  const growthOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: axisTooltip(),
      legend: { top: 0 },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: data.customers.growth.map((r) => r.day),
        axisLabel: { fontSize: 10 },
      },
      yAxis: { type: "value" },
      series: [
        { name: "New", type: "line", smooth: true, data: data.customers.growth.map((r) => r.new) },
        {
          name: "Churned",
          type: "line",
          smooth: true,
          data: data.customers.growth.map((r) => r.churned),
        },
      ],
    }),
    [data.customers.growth]
  );

  const churnOption = useMemo(
    () => ({
      color: [BI_COLORS[5]],
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: { type: "category", data: data.customers.churn.map((r) => r.day) },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
      series: [{ type: "line", smooth: true, data: data.customers.churn.map((r) => r.churnRate) }],
    }),
    [data.customers.churn]
  );

  const packageDonut = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: { ...itemTooltip(), formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0, type: "scroll" },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          data: data.customers.packagePopularity.map((p) => ({
            name: p.package,
            value: p.subscribers,
          })),
        },
      ],
    }),
    [data.customers.packagePopularity]
  );

  const tvDonut = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: itemTooltip(),
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          data: data.customers.tvAdoption.map((p) => ({ name: p.segment, value: p.count })),
        },
      ],
    }),
    [data.customers.tvAdoption]
  );

  const geoOption = useMemo(
    () => ({
      color: [BI_COLORS[0]],
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: data.customers.geographic.map((g) => g.area),
        axisLabel: { rotate: 25, fontSize: 10 },
      },
      yAxis: { type: "value" },
      series: [{ type: "bar", data: data.customers.geographic.map((g) => g.customers) }],
    }),
    [data.customers.geographic]
  );

  const clvOption = useMemo(
    () => ({
      color: [BI_COLORS[3]],
      tooltip: axisTooltip(),
      grid: { ...baseGrid, left: 120 },
      xAxis: { type: "value", axisLabel: { formatter: formatKes } },
      yAxis: {
        type: "category",
        data: data.customers.clvByPackage.map((p) => p.package).reverse(),
      },
      series: [
        { type: "bar", data: data.customers.clvByPackage.map((p) => p.clv).reverse() },
      ],
    }),
    [data.customers.clvByPackage]
  );

  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap={4}>
      <BiChartCard title="Customer Growth" subtitle="New vs churned subscribers">
        <LazyEChart option={growthOption} />
      </BiChartCard>
      <BiChartCard title="Customer Churn Rate" subtitle="Monthly churn %">
        <LazyEChart option={churnOption} />
      </BiChartCard>
      <BiChartCard title="Package Popularity" empty={!data.customers.packagePopularity.length}>
        <LazyEChart option={packageDonut} height="300px" />
      </BiChartCard>
      <BiChartCard title="TV Package Adoption">
        <LazyEChart option={tvDonut} height="300px" />
      </BiChartCard>
      <BiChartCard
        title="Geographic Distribution"
        subtitle="Customers by building — click to drill down"
        exportSection="geographic"
        onExportCsv={onExportCsv}
      >
        <LazyEChart
          option={geoOption}
          onEvents={{
            click: (raw: unknown) => {
              const params = raw as { name?: string };
              const row = data.customers.geographic.find((g) => g.area === params.name);
              if (row?.buildingId) drillCustomers(navigate, { buildingId: String(row.buildingId) });
            },
          }}
        />
      </BiChartCard>
      <BiChartCard title="Customer Lifetime Value" subtitle="ARPU ÷ monthly churn (24× ARPU if churn is 0)">
        <LazyEChart option={clvOption} />
      </BiChartCard>
    </Grid>
  );
}

export function BiSalesCharts({ data, onExportCsv }: Props) {
  const leaderboardOption = useMemo(
    () => ({
      color: [BI_COLORS[0]],
      tooltip: axisTooltip(),
      grid: { ...baseGrid, left: 100 },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: data.sales.leaderboard.map((r) => r.agent).reverse(),
      },
      series: [
        {
          name: "Customers",
          type: "bar",
          data: data.sales.leaderboard.map((r) => r.customersAcquired).reverse(),
        },
      ],
    }),
    [data.sales.leaderboard]
  );

  const funnelOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: itemTooltip(),
      series: [
        {
          type: "funnel",
          left: "10%",
          width: "80%",
          sort: "none",
          label: { show: true, position: "inside", formatter: "{b}: {c}" },
          data: data.sales.funnel.map((s) => ({ name: s.stage, value: s.count })),
        },
      ],
    }),
    [data.sales.funnel]
  );

  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap={4}>
      <BiChartCard
        title="Sales Leaderboard"
        subtitle="Agency performance (proxy for sales agents)"
        exportSection="salesLeaderboard"
        onExportCsv={onExportCsv}
        empty={!data.sales.leaderboard.length}
      >
        <LazyEChart option={leaderboardOption} />
      </BiChartCard>
      <BiChartCard
        title="Sales Funnel"
        subtitle="Lead pipeline by status"
        empty={!data.sales.funnel.some((s) => s.count > 0)}
        emptyMessage="No leads recorded yet."
      >
        <LazyEChart option={funnelOption} height="320px" />
      </BiChartCard>
    </Grid>
  );
}

export function BiFinancialCharts({ data }: Pick<Props, "data">) {
  const collectionOption = useMemo(
    () => ({
      color: [BI_COLORS[0], BI_COLORS[2], BI_COLORS[5]],
      tooltip: axisTooltip(),
      legend: { top: 0 },
      grid: baseGrid,
      xAxis: { type: "category", data: data.financial.collectionPerformance.map((r) => r.month) },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "Invoiced",
          type: "bar",
          stack: "total",
          data: data.financial.collectionPerformance.map((r) => r.invoiced),
        },
        {
          name: "Paid",
          type: "bar",
          stack: "paid",
          data: data.financial.collectionPerformance.map((r) => r.paid),
        },
        {
          name: "Outstanding",
          type: "bar",
          data: data.financial.collectionPerformance.map((r) => r.outstanding),
        },
      ],
    }),
    [data.financial.collectionPerformance]
  );

  const agingOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: { type: "category", data: data.financial.debtAging.map((r) => r.bucket) },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [{ type: "bar", data: data.financial.debtAging.map((r) => r.amount) }],
    }),
    [data.financial.debtAging]
  );

  const paymentDonut = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: itemTooltip(),
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          data: data.financial.paymentStatus.map((p) => ({ name: p.status, value: p.count })),
        },
      ],
    }),
    [data.financial.paymentStatus]
  );

  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap={4}>
      <BiChartCard
        title="Invoice Collection Performance"
        subtitle="Zoho invoices: invoiced, paid, and outstanding by month"
        empty={!data.financial.collectionPerformance.length}
        emptyMessage="No Zoho invoice history synced yet."
      >
        <LazyEChart option={collectionOption} />
      </BiChartCard>
      <BiChartCard title="Outstanding Debt Aging">
        <LazyEChart option={agingOption} />
      </BiChartCard>
      <BiChartCard title="Payment Status Distribution">
        <LazyEChart option={paymentDonut} height="300px" />
      </BiChartCard>
    </Grid>
  );
}

export function BiInsightsCharts({ data }: Pick<Props, "data">) {
  const upgradeOption = useMemo(
    () => ({
      color: [BI_COLORS[0], BI_COLORS[5]],
      tooltip: axisTooltip(),
      legend: { top: 0 },
      grid: baseGrid,
      xAxis: { type: "category", data: data.insights.upgradeDowngrade.map((r) => r.month) },
      yAxis: { type: "value" },
      series: [
        { name: "Upgrades", type: "bar", stack: "chg", data: data.insights.upgradeDowngrade.map((r) => r.upgrades) },
        { name: "Downgrades", type: "bar", stack: "chg", data: data.insights.upgradeDowngrade.map((r) => r.downgrades) },
      ],
    }),
    [data.insights.upgradeDowngrade]
  );

  const referralOption = useMemo(
    () => ({
      color: BI_COLORS,
      tooltip: itemTooltip(),
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: "65%",
          data: data.insights.referralSources.map((r) => ({ name: r.source, value: r.count })),
        },
      ],
    }),
    [data.insights.referralSources]
  );

  return (
    <Grid templateColumns={{ base: "1fr", xl: "repeat(2, 1fr)" }} gap={4}>
      <BiChartCard
        title="Upgrade vs Downgrade Trends"
        empty={!data.insights.upgradeDowngrade.length}
      >
        <LazyEChart option={upgradeOption} />
      </BiChartCard>
      <BiChartCard
        title="Lead Sources"
        subtitle="Prospect acquisition channels"
        empty={!data.insights.referralSources.length}
        emptyMessage="No lead source data yet."
      >
        <LazyEChart option={referralOption} height="300px" />
      </BiChartCard>
    </Grid>
  );
}

export function formatKpiValue(key: string, value: number | null | undefined) {
  if (value == null) return "—";
  if (
    key.includes("Rate") ||
    key.includes("Uptime") ||
    key === "customerChurnRate" ||
    key === "collectionRate" ||
    key === "paymentSuccessRate"
  ) {
    return `${value}%`;
  }
  if (
    key.includes("Revenue") ||
    key.includes("mrr") ||
    key === "arr" ||
    key.includes("Balance") ||
    key.includes("Lifetime") ||
    key.includes("Collections") ||
    key === "arpu" ||
    key === "expectedCollections"
  ) {
    return formatMetricCurrency(value);
  }
  return String(value);
}
