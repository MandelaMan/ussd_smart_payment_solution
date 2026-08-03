import { Box, Button, Flex, Grid, Stack, Table, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import type { ForecastIntelligence } from "../../lib/api";
import { formatCurrency, formatMetricCurrency } from "../../lib/api";
import { BiChartCard } from "./BiChartCard";
import { BiKpiCard } from "./BiKpiCard";
import { LazyEChart } from "./LazyEChart";
import { BI_COLORS, axisTooltip, baseGrid, formatKes } from "./biChartTheme";
import { BRAND } from "../../theme";
import {
  FiActivity,
  FiAlertCircle,
  FiDollarSign,
  FiTrendingUp,
} from "react-icons/fi";

type Props = {
  data: ForecastIntelligence;
};

export function BiForecastPanel({ data }: Props) {
  const navigate = useNavigate();
  const k = data.kpis;

  const dueOption = useMemo(
    () => ({
      color: [BI_COLORS[0]],
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: data.dueBuckets.map((b) => b.label),
      },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "Expected collections",
          type: "bar",
          data: data.dueBuckets.map((b) => b.amount),
        },
      ],
    }),
    [data.dueBuckets]
  );

  const expectedVsOption = useMemo(() => {
    const e = data.expectedVsActual;
    return {
      color: BI_COLORS,
      tooltip: axisTooltip(),
      legend: { top: 0 },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: ["Expected 30d", "Collected MTD", "Outstanding", "At risk"],
      },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "KES",
          type: "bar",
          data: [e.expectedValue, e.collectedMtd, e.outstanding, e.atRisk],
        },
      ],
    };
  }, [data.expectedVsActual]);

  const scenarioOption = useMemo(
    () => ({
      color: [BI_COLORS[2]],
      tooltip: axisTooltip(),
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: data.scenarios.map((s) => s.label.replace("Collections ", "")),
        axisLabel: { rotate: 20, fontSize: 10 },
      },
      yAxis: { type: "value", axisLabel: { formatter: formatKes } },
      series: [
        {
          name: "Projected month-end",
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.12 },
          data: data.scenarios.map((s) => s.projectedMonthEnd),
        },
      ],
    }),
    [data.scenarios]
  );

  return (
    <Stack gap={4}>
      <Grid
        templateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }}
        gap={3}
      >
        <BiKpiCard title="Expected 30d" value={formatMetricCurrency(k.expectedCollections30d)} icon={FiActivity} accent={BRAND.sandyBrown} />
        <BiKpiCard title="Collected MTD" value={formatMetricCurrency(k.collectedMtd)} icon={FiDollarSign} accent="#0d9488" />
        <BiKpiCard title="Projected month-end" value={formatMetricCurrency(k.projectedMonthEnd)} icon={FiTrendingUp} accent={BRAND.cerulean} />
        <BiKpiCard title="At-risk overdue" value={formatMetricCurrency(k.atRisk)} icon={FiAlertCircle} accent="#c45c5c" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.2fr 1fr" }} gap={4}>
        <BiChartCard title="Due buckets" subtitle="Invoice value by horizon">
          <LazyEChart option={dueOption} />
        </BiChartCard>
        <BiChartCard title="Expected vs actual" subtitle="Planning reconciliation">
          <LazyEChart option={expectedVsOption} />
        </BiChartCard>
      </Grid>

      <BiChartCard
        title="Scenario modelling"
        subtitle="What if collections shift vs remaining expected"
      >
        <LazyEChart option={scenarioOption} />
      </BiChartCard>

      <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={4}>
        <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={3}>
          <Flex justify="space-between" mb={2} align="center">
            <Text fontWeight="semibold" fontSize="sm">
              At-risk invoices
            </Text>
            <Button asChild size="xs" variant="outline">
              <RouterLink to="/reports">Open report</RouterLink>
            </Button>
          </Flex>
          <Table.Root size="sm" variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Customer</Table.ColumnHeader>
                <Table.ColumnHeader>Days</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Balance</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.atRiskInvoices.slice(0, 8).map((row) => (
                <Table.Row
                  key={`${row.invoiceNumber}-${row.customerId}`}
                  cursor="pointer"
                  onClick={() =>
                    navigate(`/customers?search=${encodeURIComponent(row.customerNumber)}`)
                  }
                >
                  <Table.Cell>{row.customerNumber}</Table.Cell>
                  <Table.Cell>{row.daysOverdue}</Table.Cell>
                  <Table.Cell textAlign="end">{formatCurrency(row.balanceDue)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>

        <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={3}>
          <Text fontWeight="semibold" fontSize="sm" mb={2}>
            Churn / payment-risk customers
          </Text>
          <Table.Root size="sm" variant="outline">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Customer</Table.ColumnHeader>
                <Table.ColumnHeader>Fails</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Score</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.churnRiskCustomers.slice(0, 8).map((row) => (
                <Table.Row
                  key={row.customerId}
                  cursor="pointer"
                  onClick={() =>
                    navigate(`/customers?search=${encodeURIComponent(row.customerNumber)}`)
                  }
                >
                  <Table.Cell>{row.customerNumber}</Table.Cell>
                  <Table.Cell>{row.failedPayments}</Table.Cell>
                  <Table.Cell textAlign="end">{row.riskScore}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </Grid>

      <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={3}>
        <Text fontWeight="semibold" fontSize="sm" mb={2}>
          Variance (collected vs MRR)
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {data.variance.label}: expected {formatCurrency(data.variance.budgetOrExpected)}, actual{" "}
          {formatCurrency(data.variance.actual)}, variance {formatCurrency(data.variance.variance)} (
          {data.variance.variancePct}%)
        </Text>
      </Box>
    </Stack>
  );
}
