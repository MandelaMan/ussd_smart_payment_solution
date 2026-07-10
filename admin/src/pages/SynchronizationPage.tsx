import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  Progress,
  Stack,
  Text,
  Badge,
  HStack,
  Table,
} from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import { api, type SyncIntegrationStatus, type SyncJobRow } from "../lib/api";
import { useSyncSocket } from "../hooks/useSyncSocket";
import { toaster } from "../components/ui/toaster";
import { SynchronizationPageSkeleton } from "../components/PageSkeletons";
import { DataTableColumnHeader } from "../components/ui/DataTable";
import { PAGE_STACK_GAP, PageHeader } from "../components/ui/pageLayout";

const ZOHO_MODULE_KEYS = new Set([
  "zoho-contacts",
  "invoices",
  "zoho-recurring",
  "zoho-payments",
  "zoho-estimates",
  "zoho-credit-notes",
]);

const OTHER_MODULE_ORDER = ["customers", "payments", "reconciliation", "products"];

function formatDuration(ms: number | null | undefined) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function formatInterval(ms: number | null | undefined) {
  if (!ms) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} hr`;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusColor(status: string | undefined) {
  switch (status) {
    case "completed":
    case "success":
    case "idle":
      return "green";
    case "running":
    case "queued":
    case "retrying":
    case "paused":
      return "blue";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

function moduleStatus(item: SyncIntegrationStatus, isRunning: boolean) {
  if (isRunning) return { label: "Running", color: "blue" as const };
  if (item.state?.lastError) return { label: "Error", color: "red" as const };
  if (item.state?.status === "paused") return { label: "Paused", color: "orange" as const };
  if (item.state?.lastSuccessAt) return { label: "OK", color: "green" as const };
  return { label: "Idle", color: "gray" as const };
}

function SyncModuleRow({
  item,
  isRunning,
  livePercent,
  onSync,
  syncing,
}: {
  item: SyncIntegrationStatus;
  isRunning: boolean;
  livePercent?: number;
  onSync: () => void;
  syncing: boolean;
}) {
  const status = moduleStatus(item, isRunning);
  const queueFailed = item.queue?.failed ?? 0;

  return (
    <Table.Row>
      <Table.Cell fontWeight="medium">{item.label}</Table.Cell>
      <Table.Cell>
        <Badge size="sm" colorPalette={status.color}>
          {status.label}
        </Badge>
      </Table.Cell>
      <Table.Cell fontSize="sm" color="gray.600">
        {formatWhen(item.state?.lastSyncedAt)}
      </Table.Cell>
      <Table.Cell fontSize="sm" textAlign="right">
        {item.state?.recordsUpdated != null ? item.state.recordsUpdated.toLocaleString() : "—"}
      </Table.Cell>
      <Table.Cell>
        {isRunning && livePercent != null && livePercent > 0 ? (
          <Text fontSize="xs" color="blue.600">
            {livePercent}%
          </Text>
        ) : queueFailed > 0 ? (
          <Text fontSize="xs" color="red.600">
            {queueFailed} failed in queue
          </Text>
        ) : (
          <Text fontSize="xs" color="gray.400">
            —
          </Text>
        )}
      </Table.Cell>
      <Table.Cell textAlign="right">
        <Button size="xs" variant="outline" onClick={onSync} loading={syncing}>
          Sync
        </Button>
      </Table.Cell>
    </Table.Row>
  );
}

function SyncModuleTable({
  title,
  subtitle,
  items,
  liveProgress,
  syncingId,
  onSync,
}: {
  title: string;
  subtitle?: string;
  items: SyncIntegrationStatus[];
  liveProgress: Record<string, { progress?: { percent: number } }>;
  syncingId: string | null;
  onSync: (integration: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <Box border="1px solid" borderColor="brand.100" borderRadius="lg" bg="white" overflow="hidden">
      <Box px={4} py={3} borderBottom="1px solid" borderColor="brand.50">
        <Heading size="sm">{title}</Heading>
        {subtitle ? (
          <Text fontSize="sm" color="gray.500" mt={0.5}>
            {subtitle}
          </Text>
        ) : null}
      </Box>
      <Box overflowX="auto">
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <DataTableColumnHeader>Module</DataTableColumnHeader>
              <DataTableColumnHeader>Status</DataTableColumnHeader>
              <DataTableColumnHeader>Last sync</DataTableColumnHeader>
              <DataTableColumnHeader textAlign="right">Updated</DataTableColumnHeader>
              <DataTableColumnHeader>Progress</DataTableColumnHeader>
              <DataTableColumnHeader textAlign="right"> </DataTableColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((item) => {
              const live = liveProgress[item.integration];
              const isRunning =
                live?.progress != null || (item.queue?.active ?? 0) > 0;
              return (
                <SyncModuleRow
                  key={item.integration}
                  item={item}
                  isRunning={isRunning}
                  livePercent={live?.progress?.percent}
                  onSync={() => onSync(item.integration)}
                  syncing={syncingId === item.integration}
                />
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>
      {items.some((i) => i.state?.lastError) && (
        <Box px={4} py={2} bg="red.50" borderTop="1px solid" borderColor="red.100">
          {items
            .filter((i) => i.state?.lastError)
            .map((i) => (
              <Text key={i.integration} fontSize="xs" color="red.700">
                <Text as="span" fontWeight="semibold">
                  {i.label}:
                </Text>{" "}
                {i.state?.lastError}
              </Text>
            ))}
        </Box>
      )}
    </Box>
  );
}

export function SynchronizationPage() {
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.getSyncOverview>> | null>(null);
  const [jobs, setJobs] = useState<SyncJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const { connected, liveProgress } = useSyncSocket();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, jobList] = await Promise.all([
        api.getSyncOverview(),
        api.listSyncJobs({ limit: "15" }),
      ]);
      setOverview(ov);
      setJobs(jobList.data);
    } catch (e) {
      toaster.error({
        title: "Failed to load sync status",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasCompleted = Object.values(liveProgress).some(
      (e) => e.event === "sync:completed" || e.event === "sync:failed"
    );
    if (hasCompleted) load();
  }, [liveProgress, load]);

  const triggerSync = async (integration: string) => {
    setSyncingId(integration);
    try {
      const result = await api.triggerSync(integration);
      if (!result.ok) {
        toaster.error({ title: result.error || "Could not start sync" });
        return;
      }
      toaster.success({ title: "Sync queued", description: `${integration} sync started` });
      await load();
    } catch (e) {
      toaster.error({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSyncingId(null);
    }
  };

  const { zohoModules, otherModules } = useMemo(() => {
    const all = overview?.integrations ?? [];
    const zoho = all.filter((i) => ZOHO_MODULE_KEYS.has(i.integration));
    const other = OTHER_MODULE_ORDER.map((key) => all.find((i) => i.integration === key)).filter(
      (i): i is SyncIntegrationStatus => Boolean(i)
    );
    return { zohoModules: zoho, otherModules: other };
  }, [overview?.integrations]);

  const zohoInterval = zohoModules[0]?.intervalMs;

  const notableJobs = useMemo(() => {
    return jobs.filter(
      (job, idx) =>
        job.status !== "completed" ||
        job.recordsFailed > 0 ||
        Boolean(job.lastError) ||
        idx < 5
    ).slice(0, 12);
  }, [jobs]);

  if (loading && !overview) {
    return <SynchronizationPageSkeleton />;
  }

  const runningCount = overview?.runningJobs?.length ?? 0;
  const budget = overview?.zohoBudget;
  const usage = overview?.apiUsage;

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title="Synchronization"
        description="Background sync from Zoho Books, TISP, and M-Pesa into MySQL"
        actions={
          <HStack>
            <Badge colorPalette={overview?.redisConnected ? "green" : "red"} variant="subtle">
              Redis {overview?.redisConnected ? "ok" : "offline"}
            </Badge>
            <Badge colorPalette={connected ? "green" : "orange"} variant="subtle">
              Live updates {connected ? "on" : "off"}
            </Badge>
            {!overview?.syncEnabled && (
              <Badge colorPalette="orange" variant="subtle">
                Inline mode
              </Badge>
            )}
            <Button size="sm" variant="outline" colorPalette="brand" onClick={load}>
              <FiRefreshCw />
              Refresh
            </Button>
          </HStack>
        }
      />

      {budget?.enabled && (
        <Box p={4} border="1px solid" borderColor="brand.100" borderRadius="lg" bg="white">
          <Flex justify="space-between" align="center" mb={2} flexWrap="wrap" gap={2}>
            <Text fontWeight="600">Zoho API usage today</Text>
            <HStack gap={3} fontSize="sm" color="gray.600" flexWrap="wrap">
              {overview?.zohoSyncPolicy?.mode === "minimal" && (
                <Badge colorPalette="green" variant="subtle">
                  Minimal API mode
                </Badge>
              )}
              {runningCount > 0 && (
                <Badge colorPalette="blue" variant="subtle">
                  {runningCount} running
                </Badge>
              )}
              <Text>
                {budget.used.toLocaleString()} / {budget.dailyLimit.toLocaleString()} calls
              </Text>
              {usage && (
                <>
                  <Text>·</Text>
                  <Text>{usage.hourly} this hour</Text>
                  <Text>·</Text>
                  <Text>
                    {usage.bySource.scheduled ?? 0} scheduled · {usage.bySource.webhook ?? 0}{" "}
                    webhook · {usage.bySource.manual ?? 0} manual
                  </Text>
                </>
              )}
            </HStack>
          </Flex>
          <Progress.Root
            value={budget.percentUsed}
            size="sm"
            colorPalette={
              usage?.alert?.level === "emergency" || usage?.alert?.level === "critical"
                ? "red"
                : usage?.alert?.level === "warning"
                  ? "orange"
                  : "blue"
            }
          >
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
          <Text fontSize="xs" color="gray.500" mt={2}>
            {budget.backgroundRemaining.toLocaleString()} calls available for background sync ·{" "}
            {budget.reserve.toLocaleString()} reserved for manual refresh
            {overview?.zohoSyncPolicy?.mode === "minimal" && (
              <> · Scheduled: {overview.zohoSyncPolicy.scheduledModules?.join(", ") || "contacts, invoices"} only</>
            )}
            {usage?.alert?.level && usage.alert.level !== "ok" && (
              <> · Alert: {usage.alert.level}</>
            )}
          </Text>
        </Box>
      )}

      <SyncModuleTable
        title="Zoho Books"
        subtitle={
          zohoInterval
            ? `Incremental sync every ${formatInterval(zohoInterval)} · webhooks update instantly`
            : undefined
        }
        items={zohoModules}
        liveProgress={liveProgress}
        syncingId={syncingId}
        onSync={triggerSync}
      />

      <SyncModuleTable
        title="Other integrations"
        subtitle="Local data and third-party status checks"
        items={otherModules}
        liveProgress={liveProgress}
        syncingId={syncingId}
        onSync={triggerSync}
      />

      {notableJobs.length > 0 && (
        <Box>
          <Heading size="sm" mb={2}>
            Recent activity
          </Heading>
          <Box border="1px solid" borderColor="brand.100" borderRadius="lg" overflowX="auto" bg="white">
            <Table.Root size="sm">
              <Table.Header>
                <Table.Row>
                  <DataTableColumnHeader>Module</DataTableColumnHeader>
                  <DataTableColumnHeader>Status</DataTableColumnHeader>
                  <DataTableColumnHeader>Processed</DataTableColumnHeader>
                  <DataTableColumnHeader>Duration</DataTableColumnHeader>
                  <DataTableColumnHeader>Started</DataTableColumnHeader>
                  <DataTableColumnHeader>Error</DataTableColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {notableJobs.map((job) => (
                  <Table.Row key={job.id}>
                    <Table.Cell fontWeight="medium">{job.integration}</Table.Cell>
                    <Table.Cell>
                      <Badge size="sm" colorPalette={statusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell fontSize="sm">
                      {job.recordsUpdated > 0
                        ? `${job.recordsUpdated.toLocaleString()} updated`
                        : `${job.recordsProcessed ?? 0} processed`}
                    </Table.Cell>
                    <Table.Cell fontSize="sm" color="gray.600">
                      {formatDuration(job.durationMs)}
                    </Table.Cell>
                    <Table.Cell fontSize="sm" color="gray.600">
                      {formatWhen(job.startedAt)}
                    </Table.Cell>
                    <Table.Cell fontSize="xs" color="red.600" maxW="240px" truncate>
                      {job.lastError || "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </Box>
      )}
    </Stack>
  );
}
