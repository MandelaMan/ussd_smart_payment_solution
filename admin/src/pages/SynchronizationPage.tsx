import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  IconButton,
} from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import { api, type SyncIntegrationStatus, type SyncJobRow } from "../lib/api";
import { useSyncSocket } from "../hooks/useSyncSocket";
import { toaster } from "../components/ui/toaster";
import { SynchronizationPageSkeleton } from "../components/PageSkeletons";
import { DataTableColumnHeader } from "../components/ui/DataTable";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { MobileDataCard, ResponsiveListViews } from "../components/ui/MobileDataList";
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
  if (ms == null) return "—";
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

function formatWhenShort(iso: string | null | undefined) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-KE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <Table.Cell fontSize="sm" color="fg.muted">
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
            {queueFailed} failed
          </Text>
        ) : (
          <Text fontSize="xs" color="fg.subtle">
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

function SyncModuleCard({
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
  const detail =
    isRunning && livePercent != null && livePercent > 0
      ? `${livePercent}%`
      : queueFailed > 0
        ? `${queueFailed} failed`
        : formatWhenShort(item.state?.lastSyncedAt);

  return (
    <MobileDataCard
      variant="row"
      title={item.label}
      subtitle={detail}
      trailing={
        <Flex direction="column" align="flex-end" gap={1.5}>
          <Badge size="sm" colorPalette={status.color}>
            {status.label}
          </Badge>
          <Button
            size="xs"
            variant="outline"
            loading={syncing}
            onClick={(e) => {
              e.stopPropagation();
              onSync();
            }}
          >
            Sync
          </Button>
        </Flex>
      }
      showChevron={false}
    />
  );
}

function SyncModuleSection({
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

  const errorItems = items.filter((i) => i.state?.lastError);

  return (
    <Box border="1px solid" borderColor="brand.100" borderRadius="lg" bg="bg.panel" overflow="hidden">
      <Box px={4} py={3} borderBottom="1px solid" borderColor="brand.50">
        <Heading size="sm">{title}</Heading>
        {subtitle ? (
          <Text fontSize="sm" color="fg.muted" mt={0.5} display={{ base: "none", lg: "block" }}>
            {subtitle}
          </Text>
        ) : null}
      </Box>

      <ResponsiveListViews
        mobile={
          <Box>
            {items.map((item) => {
              const live = liveProgress[item.integration];
              const isRunning = live?.progress != null || (item.queue?.active ?? 0) > 0;
              return (
                <Box key={item.integration} borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: "none" }}>
                  <SyncModuleCard
                    item={item}
                    isRunning={isRunning}
                    livePercent={live?.progress?.percent}
                    onSync={() => onSync(item.integration)}
                    syncing={syncingId === item.integration}
                  />
                </Box>
              );
            })}
          </Box>
        }
        desktop={
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
                  const isRunning = live?.progress != null || (item.queue?.active ?? 0) > 0;
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
        }
      />

      {errorItems.length > 0 && (
        <Box px={4} py={2} bg="red.50" borderTop="1px solid" borderColor="red.100">
          {errorItems.map((i) => (
            <Text key={i.integration} fontSize="xs" color="red.700" lineClamp={2}>
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
  const { connected, liveProgress, clearIntegration } = useSyncSocket();
  const handledTerminalEvents = useRef(new Set<string>());

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
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
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const terminal = Object.entries(liveProgress).filter(
      ([, e]) => e.event === "sync:completed" || e.event === "sync:failed"
    );
    if (terminal.length === 0) return;

    let shouldReload = false;
    for (const [integration, event] of terminal) {
      const key = `${integration}:${event.event}:${event.progress?.percent ?? ""}:${event.error ?? ""}`;
      if (handledTerminalEvents.current.has(key)) continue;
      handledTerminalEvents.current.add(key);
      shouldReload = true;
      clearIntegration(integration);
    }
    if (shouldReload) load({ silent: true });
  }, [liveProgress, load, clearIntegration]);

  const triggerSync = async (integration: string) => {
    setSyncingId(integration);
    try {
      const result = await api.triggerSync(
        integration,
        integration === "customers" ? { incremental: false } : {}
      );
      if (!result.ok) {
        toaster.error({ title: result.error || "Could not start sync" });
        return;
      }
      toaster.success({
        title: "Sync queued",
        description:
          integration === "customers"
            ? "Customers (TISP) — full status refresh for all customers"
            : `${integration} sync started`,
      });
      await load({ silent: true });
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
    return jobs
      .filter(
        (job, idx) =>
          job.status !== "completed" ||
          job.recordsFailed > 0 ||
          Boolean(job.lastError) ||
          idx < 5
      )
      .slice(0, 12);
  }, [jobs]);

  if (loading && !overview) {
    return <SynchronizationPageSkeleton />;
  }

  const runningCount = overview?.runningJobs?.length ?? 0;
  const budget = overview?.zohoBudget;
  const usage = overview?.apiUsage;

  const refreshButton = (
    <IconButton
      aria-label="Refresh sync status"
      size="sm"
      variant="outline"
      colorPalette="brand"
      onClick={() => load()}
    >
      <FiRefreshCw />
    </IconButton>
  );

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Box display={{ base: "block", lg: "none" }}>
        <MobilePageChrome title="Synchronization" headerActions={refreshButton} />
      </Box>

      <Box display={{ base: "none", lg: "block" }}>
        <PageHeader
          title="Synchronization"
          actions={
            <HStack>
              <Badge colorPalette={overview?.redisConnected ? "green" : "red"} variant="subtle">
                Redis {overview?.redisConnected ? "ok" : "offline"}
              </Badge>
              <Badge colorPalette={connected ? "green" : "orange"} variant="subtle">
                Live {connected ? "on" : "off"}
              </Badge>
              {!overview?.syncEnabled && (
                <Badge colorPalette="orange" variant="subtle">
                  Inline mode
                </Badge>
              )}
              <Button size="sm" variant="outline" colorPalette="brand" onClick={() => load()}>
                <FiRefreshCw />
                Refresh
              </Button>
            </HStack>
          }
        />
      </Box>

      <HStack gap={2} display={{ base: "flex", lg: "none" }} flexWrap="wrap" px={0}>
        <Badge colorPalette={overview?.redisConnected ? "green" : "red"} variant="subtle">
          Redis {overview?.redisConnected ? "ok" : "offline"}
        </Badge>
        <Badge colorPalette={connected ? "green" : "orange"} variant="subtle">
          Live {connected ? "on" : "off"}
        </Badge>
        {runningCount > 0 && (
          <Badge colorPalette="blue" variant="subtle">
            {runningCount} running
          </Badge>
        )}
      </HStack>

      {budget?.enabled && (
        <Box p={{ base: 3, lg: 4 }} border="1px solid" borderColor="brand.100" borderRadius="lg" bg="bg.panel">
          <Flex justify="space-between" align="center" mb={2} gap={2}>
            <Text fontWeight="600" fontSize={{ base: "sm", lg: "md" }}>
              Zoho API today
            </Text>
            <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
              {budget.used.toLocaleString()} / {budget.dailyLimit.toLocaleString()}
            </Text>
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
          <Text fontSize="xs" color="fg.muted" mt={2} display={{ base: "none", lg: "block" }}>
            {budget.backgroundRemaining.toLocaleString()} available for background ·{" "}
            {budget.reserve.toLocaleString()} reserved for manual
            {overview?.zohoSyncPolicy?.mode === "minimal" && (
              <> · Minimal mode: {overview.zohoSyncPolicy.scheduledModules?.join(", ") || "contacts, invoices"}</>
            )}
            {usage?.alert?.level && usage.alert.level !== "ok" && <> · Alert: {usage.alert.level}</>}
          </Text>
          {usage?.alert?.level && usage.alert.level !== "ok" ? (
            <Text fontSize="xs" color="orange.700" mt={1} display={{ base: "block", lg: "none" }}>
              Alert: {usage.alert.level}
            </Text>
          ) : null}
        </Box>
      )}

      <SyncModuleSection
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

      <SyncModuleSection
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
          <ResponsiveListViews
            mobile={
              <Box border="1px solid" borderColor="brand.100" borderRadius="lg" bg="bg.panel" overflow="hidden">
                {notableJobs.slice(0, 8).map((job) => (
                  <Box key={job.id} borderBottom="1px solid" borderColor="border.muted" _last={{ borderBottom: "none" }}>
                    <MobileDataCard
                      variant="row"
                      title={job.integration}
                      subtitle={
                        job.lastError
                          ? job.lastError
                          : `${formatWhenShort(job.startedAt)} · ${formatDuration(job.durationMs)}`
                      }
                      trailing={
                        <Badge size="sm" colorPalette={statusColor(job.status)}>
                          {job.status}
                        </Badge>
                      }
                      showChevron={false}
                    />
                  </Box>
                ))}
              </Box>
            }
            desktop={
              <Box border="1px solid" borderColor="brand.100" borderRadius="lg" overflowX="auto" bg="bg.panel">
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
                        <Table.Cell fontSize="sm" color="fg.muted">
                          {formatDuration(job.durationMs)}
                        </Table.Cell>
                        <Table.Cell fontSize="sm" color="fg.muted">
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
            }
          />
        </Box>
      )}
    </Stack>
  );
}
