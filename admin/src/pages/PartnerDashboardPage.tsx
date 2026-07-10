import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Flex,
  Grid,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
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
import { api, formatCurrency, formatMetricCurrency, type PartnerDashboard } from "../lib/api";
import { MetricCard } from "../components/MetricCard";
import { PackageSubscriptionChart } from "../components/PackageSubscriptionChart";
import { DashboardSkeleton } from "../components/PageSkeletons";
import { BRAND } from "../theme";
import { SelectField } from "../components/ui/SelectField";

const CHANGE_COLORS = [BRAND.cerulean, BRAND.sandyBrown, BRAND.paleAzure, "#805ad5", "#e53e3e"];

const EVENT_LABELS: Record<string, string> = {
  upgrade: "Upgrades",
  downgrade: "Downgrades",
  switch_apartment: "Apartment switches",
  type_change: "Type changes",
  cancel: "Cancellations",
  created: "New accounts",
};

function PartnerChartCard({
  title,
  subtitle,
  children,
  height = 280,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: number;
}) {
  return (
    <Box
      bg="white"
      border="1px solid"
      borderColor="brand.100"
      borderRadius="xl"
      p={4}
      minH={`${height + 56}px`}
    >
      <Heading size="sm" mb={subtitle ? 1 : 3}>
        {title}
      </Heading>
      {subtitle ? (
        <Text fontSize="sm" color="gray.600" mb={3}>
          {subtitle}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function PartnerDashboardPage() {
  const [months, setMonths] = useState("12");
  const [data, setData] = useState<PartnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getPartnerDashboard(Number(months))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  const packageChangeData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Upgrades", value: data.packageChanges.upgrades },
      { name: "Downgrades", value: data.packageChanges.downgrades },
      { name: "Apartment switches", value: data.packageChanges.apartmentSwitches },
      { name: "Type changes", value: data.packageChanges.typeChanges },
    ].filter((d) => d.value > 0);
  }, [data]);

  const lifecycleData = useMemo(
    () =>
      (data?.lifecycleBreakdown || []).map((row) => ({
        name: EVENT_LABELS[row.event] || row.event,
        count: row.count,
      })),
    [data]
  );

  if (loading && !data) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <Box p={6}>
        <Text color="gray.600">Unable to load partner dashboard.</Text>
      </Box>
    );
  }

  return (
    <Stack gap={4} p={{ base: 3, md: 4 }}>
      <Flex justify="space-between" align="start" gap={4} flexWrap="wrap">
        <Box>
          <Heading size="lg">Partner overview</Heading>
          <Text color="gray.600" mt={1}>
            Customers, collections, and package activity
          </Text>
        </Box>
        <Box minW="160px">
          <Text fontSize="xs" color="gray.600" mb={1}>
            Period
          </Text>
          <SelectField
            size="sm"
            fieldProps={{
              value: months,
              onChange: (e) => setMonths(e.target.value),
            }}
          >
            <option value="6">Last 6 months</option>
            <option value="12">Last 12 months</option>
            <option value="24">Last 24 months</option>
          </SelectField>
        </Box>
      </Flex>

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap={4}>
        <MetricCard label="Active customers" value={data.customers.active.toLocaleString()} accent="cerulean" />
        <MetricCard
          label="Collected (period)"
          value={formatMetricCurrency(data.periodMetrics.revenue)}
          sub={formatCurrency(data.periodMetrics.revenue)}
          accent="teal"
        />
        <MetricCard
          label="Customers added"
          value={data.periodMetrics.added.toLocaleString()}
          sub={`${data.periodMetrics.lost} lost`}
          accent="mindaro"
        />
        <MetricCard
          label="Package changes"
          value={data.periodMetrics.packageChanges.toLocaleString()}
          sub="Upgrades and downgrades"
          accent="sandy"
        />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.4fr 1fr" }} gap={4}>
        <PartnerChartCard
          title="Collections by month"
          subtitle="Successful M-Pesa"
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.revenueByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={formatMetricCurrency} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value ?? 0)), "Revenue"]}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="revenue" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PartnerChartCard>

        <PartnerChartCard
          title="Customer movement"
          subtitle="Added vs lost"
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.customerTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="added" name="Added" stroke={BRAND.cerulean} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="lost" name="Lost" stroke="#e53e3e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="net" name="Net" stroke={BRAND.sandyBrown} strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </PartnerChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap={4}>
        <PartnerChartCard title="Package switches" subtitle={`Last ${months} months`} height={240}>
          {packageChangeData.length === 0 ? (
            <Text color="gray.500" fontSize="sm">No package changes in this period</Text>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={packageChangeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={88}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {packageChangeData.map((_, i) => (
                    <Cell key={i} fill={CHANGE_COLORS[i % CHANGE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </PartnerChartCard>

        <PartnerChartCard title="Lifecycle events" subtitle="Last 90 days" height={240}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={lifecycleData} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill={BRAND.paleAzure} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PartnerChartCard>

        <PartnerChartCard title="Customer mix" subtitle="Active" height={240}>
          <Stack gap={3} pt={2}>
            <Flex justify="space-between">
              <Text fontSize="sm" color="gray.600">Total active</Text>
              <Text fontWeight="semibold">{data.customers.active.toLocaleString()}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text fontSize="sm" color="gray.600">Residential (C2B)</Text>
              <Text fontWeight="semibold">{data.customers.c2b.toLocaleString()}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text fontSize="sm" color="gray.600">Business (B2B)</Text>
              <Text fontWeight="semibold">{data.customers.b2b.toLocaleString()}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text fontSize="sm" color="gray.600">Cancelled (all time)</Text>
              <Text fontWeight="semibold">{data.customers.cancelled.toLocaleString()}</Text>
            </Flex>
          </Stack>
        </PartnerChartCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1fr 1fr" }} gap={4}>
        <PartnerChartCard title="Subscribers by package" subtitle="Active customers">
          <PackageSubscriptionChart
            data={data.packageMix.map((p) => ({
              name: `${p.packageName} (${p.mbps} Mbps)`,
              subscribers: p.subscribers,
            }))}
          />
        </PartnerChartCard>

        <PartnerChartCard title="Subscribers by building" subtitle="Active customers">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.buildingMix}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="buildingName" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="subscribers" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </PartnerChartCard>
      </Grid>
    </Stack>
  );
}
