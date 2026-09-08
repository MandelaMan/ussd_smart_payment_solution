import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Flex,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, type ActivityItem, type SupportStats } from "../lib/api";
import { formatProductNameForDisplay, formatTitleCase } from "../lib/formatText";
import { MetricCard } from "../components/MetricCard";
import { PackageSubscriptionChart } from "../components/PackageSubscriptionChart";
import {
  ChartSkeleton,
  DashboardMetricsSkeleton,
  DashboardSkeleton,
} from "../components/PageSkeletons";
import { BRAND } from "../theme";
import { timeAgo } from "../lib/api";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { useActivitySocket } from "../hooks/useActivitySocket";
import {
  LIVE_REFRESH_INTERVAL_MS,
  useVisibilityRefresh,
} from "../hooks/useVisibilityRefresh";
import {
  isVisibleCustomerActivity,
  prependActivityItem,
} from "../lib/activityFeed";
import { useAuth } from "../lib/authContext";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiEdit3,
  FiTool,
  FiUser,
  FiWifi,
} from "react-icons/fi";

const SUBSCRIPTION_COLORS: Record<string, string> = {
  active: BRAND.cerulean,
  suspended: "#e53e3e",
  unknown: "#a0aec0",
};

const EVENT_ICONS: Record<string, typeof FiUser> = {
  customer_created: FiUser,
  customer_updated: FiEdit3,
  customer_cancelled: FiAlertCircle,
  customer_upgraded: FiCheckCircle,
  customer_downgraded: FiAlertCircle,
  customer_apartment_switched: FiUser,
  installation_assigned: FiTool,
  installation_updated: FiTool,
  customer_type_changed: FiUser,
  customer_paused: FiUser,
  customer_disconnected: FiWifi,
  customer_deleted: FiAlertCircle,
  tisp_reconnected: FiWifi,
  tisp_reconnect_failed: FiAlertCircle,
};

function SupportActivityPanel({
  items,
  loading,
}: {
  items: ActivityItem[];
  loading?: boolean;
}) {
  return (
    <Box
      w={{ base: "full", xl: "280px" }}
      flexShrink={0}
      bg="bg.panel"
      borderRadius={{ base: "lg", xl: 0 }}
      border={{ base: "1px solid", xl: "none" }}
      borderLeft={{ xl: "1px solid" }}
      borderColor={{ base: "gray.100", xl: "brand.100" }}
      overflow="hidden"
      h={{ xl: "100%" }}
      minH={{ xl: 0 }}
      flex={{ xl: 1 }}
      display="flex"
      flexDirection="column"
    >
      <Box px={{ base: 2.5, xl: 3 }} py={{ base: 2, xl: 3 }} borderBottom="1px solid" borderColor="border.muted">
        <Text fontSize="sm" fontWeight="semibold" color="fg">
          Customer activity
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          Live · account and sync events
        </Text>
      </Box>
      <Stack
        gap={0}
        flex={1}
        minH={0}
        overflowY="auto"
        css={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--chakra-colors-gray-300) transparent",
          "&::-webkit-scrollbar": { width: "4px" },
          "&::-webkit-scrollbar-track": { background: "transparent" },
          "&::-webkit-scrollbar-thumb": {
            background: "var(--chakra-colors-gray-300)",
            borderRadius: "999px",
          },
        }}
      >
        {loading && (
          <Text px={3} py={4} fontSize="sm" color="fg.muted">
            Loading…
          </Text>
        )}
        {!loading && items.length === 0 && (
          <Text px={3} py={4} fontSize="sm" color="fg.muted">
            No recent customer events
          </Text>
        )}
        {items.map((item) => {
          const Icon = EVENT_ICONS[item.eventType] || FiUser;
          return (
            <Flex
              key={item.id}
              gap={3}
              px={3}
              py={3}
              borderBottom="1px solid"
              borderColor="gray.50"
              align="flex-start"
            >
              <Flex
                boxSize="32px"
                borderRadius="full"
                bg="brand.50"
                color="brand.600"
                align="center"
                justify="center"
                flexShrink={0}
              >
                <Icon size={14} />
              </Flex>
              <Box minW={0}>
                <Text fontSize="sm" fontWeight="medium" color="fg" lineClamp={2}>
                  {item.title}
                </Text>
                {item.message ? (
                  <Text fontSize="xs" color="fg.muted" mt={0.5} lineClamp={2}>
                    {item.message}
                  </Text>
                ) : null}
                <Text fontSize="xs" color="fg.subtle" mt={1}>
                  {timeAgo(item.createdAt)}
                  {item.actorName ? ` · ${item.actorName}` : ""}
                  {item.customerRef ? ` · ${item.customerRef}` : ""}
                </Text>
              </Box>
            </Flex>
          );
        })}
      </Stack>
    </Box>
  );
}

export function SupportDashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const statsInFlightRef = useRef(false);

  const loadStats = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent && statsInFlightRef.current) return;
    statsInFlightRef.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await api.getSupportStats("30d");
      setStats(data);
      if (!silent) {
        setActivity(data.activity ?? []);
        setError("");
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      statsInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useVisibilityRefresh(() => {
    void loadStats({ silent: true });
  }, LIVE_REFRESH_INTERVAL_MS);

  const onLiveActivity = useCallback(
    (item: ActivityItem) => {
      if (!isVisibleCustomerActivity(item, user)) return;
      setActivity((prev) => prependActivityItem(prev, item, 40, user));
    },
    [user]
  );

  useActivitySocket(onLiveActivity, true);

  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  if (error && !stats) {
    return (
      <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
        {error}
      </Box>
    );
  }

  if (!stats) return null;

  const subs = stats.subscribers;
  const packageChartData = (subs.topPackages ?? []).slice(0, 5).map((p) => ({
    name: p.mbps
      ? `${formatProductNameForDisplay(p.package)} (${p.mbps}M)`
      : formatProductNameForDisplay(p.package),
    subscribers: p.subscribers,
  }));

  const subscriptionChartData = (stats.subscriptionStatus ?? []).map((row) => ({
    name: formatTitleCase(row.status),
    value: row.count,
    key: row.status,
  }));

  const buildingChartData = (subs.topBuildings ?? []).slice(0, 5).map((b) => ({
    name: formatTitleCase(b.building),
    subscribers: b.subscribers,
  }));

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
      mx={{ xl: -4 }}
      mt={{ xl: -4 }}
      mb={{ xl: -4 }}
    >
      <Stack
        flex={{ base: "none", xl: 1 }}
        w="full"
        minW={0}
        minH={{ base: "auto", xl: 0 }}
        gap={{ base: 2.5, xl: 4 }}
        overflow={{ base: "visible", xl: "auto" }}
        px={{ xl: 4 }}
        py={{ xl: 4 }}
        pr={{ xl: 5 }}
        pb={{ base: 2, xl: 0 }}
      >
        <MobilePageChrome title="Home" />
        {loading ? (
          <Box mx={{ base: -3, xl: 0 }} px={{ base: 1, xl: 0 }}>
            <DashboardMetricsSkeleton />
          </Box>
        ) : (
          <Stack gap={2.5} mx={{ base: -3, xl: 0 }} px={{ base: 1, xl: 0 }}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0}>
              Customers
            </Text>
            <Grid
              templateColumns={{
                base: "1fr 1fr",
                lg: "repeat(4, 1fr)",
              }}
              gap={{ base: 1.5, lg: 4 }}
            >
              <MetricCard
                accent="cerulean"
                label="Total customers"
                value={subs.total}
                sub={`${subs.active} active`}
              />
              <MetricCard
                accent="cerulean"
                label="New this period"
                value={subs.newInPeriod}
                sub={`${stats.period.days + 1} days`}
              />
              <MetricCard
                accent="cerulean"
                label="C2B customers"
                value={subs.c2b}
              />
              <MetricCard
                accent="cerulean"
                label="B2B customers"
                value={subs.b2b}
                sub={`${subs.agencies} agencies`}
              />
            </Grid>

            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mt={0.5}>
              Service health
            </Text>
            <Grid
              templateColumns={{ base: "1fr 1fr", lg: "repeat(3, 1fr)" }}
              gap={{ base: 1.5, lg: 4 }}
            >
              <MetricCard
                accent="cerulean"
                label="TISP synced"
                value={stats.tispSync.synced}
                sub="In sync"
              />
              <MetricCard
                accent="sandy"
                label="TISP sync failed"
                value={stats.tispSync.failed}
              />
              <MetricCard
                accent="sandy"
                label="TISP sync pending"
                value={stats.tispSync.pending}
              />
            </Grid>
          </Stack>
        )}

        <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={{ base: 2.5, lg: 4 }}>
          <Box
            bg="bg.panel"
            borderRadius="lg"
            border="1px solid"
            borderColor="border.muted"
            p={{ base: 2.5, md: 4 }}
            w="full"
          >
            <Text fontSize="sm" fontWeight="semibold" color="fg" mb={{ base: 2, md: 3 }}>
              Subscription status (active)
            </Text>
            {subscriptionChartData.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No active customers
              </Text>
            ) : (
              <Box h={{ base: "180px", md: "220px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={subscriptionChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {subscriptionChartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={SUBSCRIPTION_COLORS[entry.key] || BRAND.paleAzure}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Box>

          <Box
            bg="bg.panel"
            borderRadius="lg"
            border="1px solid"
            borderColor="border.muted"
            p={{ base: 2.5, md: 4 }}
            w="full"
          >
            <Text fontSize="sm" fontWeight="semibold" color="fg" mb={{ base: 2, md: 3 }}>
              Top buildings
            </Text>
            {buildingChartData.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No building data
              </Text>
            ) : loading ? (
              <ChartSkeleton height="200px" />
            ) : (
              <Box h={{ base: "180px", md: "220px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={buildingChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="subscribers" fill={BRAND.cerulean} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Box>
        </Grid>

        <Box
          bg="bg.panel"
          borderRadius="lg"
          border="1px solid"
          borderColor="border.muted"
          p={{ base: 2.5, md: 4 }}
          w="full"
        >
          <Text fontSize="sm" fontWeight="semibold" color="fg" mb={{ base: 1, md: 3 }}>
            Package distribution
          </Text>
          <Text fontSize="2xs" color="fg.muted" mb={{ base: 2, md: 3 }}>
            Active subscribers
          </Text>
          <PackageSubscriptionChart data={packageChartData} />
        </Box>
      </Stack>

      <Box
        display={{ base: "none", xl: "flex" }}
        flexDirection="column"
        flexShrink={0}
        h="100%"
        minH={0}
      >
        <SupportActivityPanel
          items={activity}
          loading={loading && activity.length === 0}
        />
      </Box>
    </Flex>
  );
}
