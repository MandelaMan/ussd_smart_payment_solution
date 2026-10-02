import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiRefreshCw } from "react-icons/fi";
import {
  api,
  formatDateTime,
  type IptvChannel,
  type IptvPackage,
  type IptvRemoteUser,
  type IptvSettings,
  type IptvSimulateResult,
  type IptvStatus,
} from "../lib/api";
import { toaster } from "../components/ui/toaster";
import { SelectField } from "../components/ui/SelectField";
import { AppDialog } from "../components/ui/AppDialog";
import {
  EmptyState,
  inlineFormCardProps,
  PAGE_STACK_GAP,
  PageErrorBanner,
  PageHeader,
} from "../components/ui/pageLayout";
import { TabStrip } from "../components/ui/TabStrip";
import { PasswordInput } from "../components/ui/PasswordInput";
import {
  dataTableCellProps,
  dataTableColumnHeaderProps,
} from "../components/ui/DataTable";
import { TextStatus } from "../components/ui/TextStatus";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import {
  MobileDataCard,
  MobileDataList,
  ResponsiveListViews,
} from "../components/ui/MobileDataList";
import { FILTER_CONTROL_HEIGHT } from "../theme";
import { useAuth } from "../lib/authContext";
import { hasPermission } from "../lib/rbac";

const DURATION_OPTIONS = [
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "12", label: "12 months" },
];

const IPTV_TABS = [
  { id: "create", label: "Create test" },
  { id: "channels", label: "Channels" },
  { id: "packages", label: "Packages" },
  { id: "users", label: "Users" },
  { id: "settings", label: "Settings" },
] as const;

const DEFAULT_STARTLYX_URL = "https://startlyx.iptvconsole.hydeinnovations.com";

type ConsoleView = (typeof IPTV_TABS)[number]["id"];

function defaultUsername() {
  const stamp = Date.now().toString(36).slice(-6).toUpperCase();
  return `IPTVTEST-${stamp}`;
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function channelStatusLabel(channel: IptvChannel) {
  if (!channel) return "unknown";
  if (!channel.enabled) return "disabled";
  return String(channel.status || "unknown").toLowerCase();
}

function channelStatusPalette(status: string) {
  switch (status) {
    case "running":
      return "green";
    case "waiting":
      return "orange";
    case "error":
      return "red";
    case "disabled":
    case "missing":
      return "gray";
    default:
      return "orange";
  }
}

function statusCounts(channels: IptvChannel[]) {
  const counts: Record<string, number> = {};
  for (const ch of channels) {
    const key = channelStatusLabel(ch);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

const LAST_CREATED_KEY = "iptv-last-created-user";

function accessLabel(status: string | null | undefined) {
  const key = String(status || "").trim().toLowerCase();
  if (!key) return null;
  return key === "no_subscription" ? "No subscription" : key;
}

function canDisconnect(status: string | null | undefined) {
  const key = String(status || "").trim().toLowerCase();
  return !key || key === "active";
}

function canReconnect(status: string | null | undefined) {
  const key = String(status || "").trim().toLowerCase();
  return !key || key !== "active";
}

function readLastCreated(): IptvSimulateResult | null {
  try {
    const raw = localStorage.getItem(LAST_CREATED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IptvSimulateResult;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLastCreated(value: IptvSimulateResult) {
  try {
    localStorage.setItem(LAST_CREATED_KEY, JSON.stringify(value));
  } catch {
    // ignore quota / private-mode failures
  }
}

function packageLabel(pkg: IptvPackage) {
  const name = pkg.name || pkg.id || "Package";
  if (pkg.price == null) return name;
  return `${name} · ${pkg.currency} ${pkg.price}`;
}

export function IptvConsolePage() {
  const { user } = useAuth();
  const canOperate = hasPermission(user, "iptv.operate");
  const canConfigure = hasPermission(user, "iptv.settings");
  const visibleTabs = useMemo(
    () =>
      IPTV_TABS.filter((tab) => {
        if (tab.id === "create") return canOperate;
        if (tab.id === "settings") return canConfigure;
        return true;
      }),
    [canOperate, canConfigure]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const view: ConsoleView = visibleTabs.some((tab) => tab.id === tabParam)
    ? (tabParam as ConsoleView)
    : visibleTabs[0]?.id ?? "channels";

  const [statusFilter, setStatusFilter] = useState("all");
  const [status, setStatus] = useState<IptvStatus | null>(null);
  const [iptvSettings, setIptvSettings] = useState<IptvSettings | null>(null);
  const [consoleUrl, setConsoleUrl] = useState(DEFAULT_STARTLYX_URL);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const autoOpenedSettings = useRef(false);
  const [channels, setChannels] = useState<IptvChannel[]>([]);
  const [packages, setPackages] = useState<IptvPackage[]>([]);
  const [users, setUsers] = useState<IptvRemoteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState(defaultUsername);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [packageId, setPackageId] = useState("");
  const [durationMonths, setDurationMonths] = useState("1");
  const [reconnectPicker, setReconnectPicker] = useState<{
    userId: string;
    label: string;
    previousPackageName: string | null;
  } | null>(null);
  const [pickerPackageId, setPickerPackageId] = useState("");
  const [pickerDuration, setPickerDuration] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [result, setResult] = useState<IptvSimulateResult | null>(readLastCreated);
  const [userAccess, setUserAccess] = useState<Record<string, string>>({});

  function setView(id: ConsoleView) {
    setSearchParams(id === "create" ? {} : { tab: id }, { replace: true });
  }

  const connected = Boolean(status?.authenticated);
  const selectedPackage = packages.find((p) => p.id === packageId) || null;
  const resultSubStatus = String(result?.subscription?.status || "").toLowerCase();
  const resultAccess =
    (result?.user?.id && userAccess[result.user.id]) ||
    result?.user?.status ||
    (resultSubStatus === "cancelled" ? "disconnected" : resultSubStatus) ||
    null;

  function applyPublicSettings(next: IptvSettings | null) {
    if (!next) return;
    setIptvSettings(next);
    setConsoleUrl(next.baseUrl || DEFAULT_STARTLYX_URL);
    setAdminEmail(next.adminEmail || "");
  }

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statusRes, settingsRes] = await Promise.all([
        api.getIptvStatus(),
        api.getIptvSettings().catch(() => null),
      ]);
      setStatus(statusRes);
      applyPublicSettings(settingsRes);
      try {
        const packageRes = await api.getIptvPackages();
        const list = asList<IptvPackage>(packageRes.packages);
        setPackages(list);
        setPackageId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          return list.find((p) => p.active)?.id || list[0]?.id || "";
        });
      } catch (err) {
        setPackages([]);
        setError(err instanceof Error ? err.message : "Failed to load packages");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load IPTV console");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setListError("");
    try {
      const channelRes = await api.getIptvChannels();
      setChannels(asList<IptvChannel>(channelRes.items));
    } catch (err) {
      setChannels([]);
      setListError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setListError("");
    try {
      const userRes = await api.getIptvUsers();
      setUsers(asList<IptvRemoteUser>(userRes.users));
    } catch (err) {
      setUsers([]);
      setListError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (result) writeLastCreated(result);
  }, [result]);

  useEffect(() => {
    if (autoOpenedSettings.current) return;
    if (!canConfigure) return;
    if (!status || status.authenticated) return;
    if (tabParam) return;
    autoOpenedSettings.current = true;
    setSearchParams({ tab: "settings" }, { replace: true });
  }, [status, tabParam, setSearchParams, canConfigure]);

  useEffect(() => {
    if (view === "channels") void loadChannels();
    if (view === "users") void loadUsers();
  }, [view, loadChannels, loadUsers]);

  useEffect(() => {
    setQuery("");
    setStatusFilter("all");
    setListError("");
  }, [view]);

  const counts = useMemo(() => statusCounts(asList(channels)), [channels]);

  const filteredChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return asList<IptvChannel>(channels).filter((ch) => {
      const label = channelStatusLabel(ch);
      if (statusFilter !== "all" && label !== statusFilter) return false;
      if (!q) return true;
      return [ch.name, ch.channelNumber, ch.categoryName, ch.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [channels, query, statusFilter]);

  const filteredUsers = useMemo(() => {
    const list = asList<IptvRemoteUser>(users).map((user) => ({
      ...user,
      status: user.status || (user.id && userAccess[user.id]) || null,
    }));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((user) =>
      [user.username, user.email, user.phoneNumber, user.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [users, query, userAccess]);

  const filteredPackages = useMemo(() => {
    const list = asList<IptvPackage>(packages);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((pkg) =>
      [pkg.name, pkg.id, pkg.currency, pkg.price]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [packages, query]);

  function applyPackageToTest(pkg: IptvPackage) {
    if (!canOperate || !pkg.id) return;
    setPackageId(pkg.id);
    setView("create");
  }

  function applyUserToTest(remoteUser: IptvRemoteUser) {
    if (!canOperate) return;
    setEmail(remoteUser.email || "");
    setUsername(remoteUser.username || defaultUsername());
    setPhone(remoteUser.phoneNumber || "");
    setAddress(remoteUser.address || "");
    setView("create");
  }

  function refresh() {
    void loadCore();
    if (view === "channels") void loadChannels();
    if (view === "users") void loadUsers();
  }

  function resetTestForm() {
    setEmail("");
    setUsername(defaultUsername());
    setPhone("");
    setAddress("");
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault();
    if (!canConfigure) return;
    setSavingSettings(true);
    try {
      const res = await api.updateIptvSettings({
        baseUrl: consoleUrl.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword: adminPassword.trim() || undefined,
      });
      applyPublicSettings(res.settings);
      setStatus({ ...res.status, ok: true });
      setAdminPassword("");
      toaster.create({
        title: res.status.authenticated
          ? "Connected to Startlyx"
          : res.status.error || "Saved, but Startlyx login failed",
        type: res.status.authenticated ? "success" : "error",
      });
      if (res.status.authenticated) {
        void loadCore();
      }
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Could not save Startlyx settings",
        type: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  }

  function applyAccessResult(
    userId: string,
    subscription: IptvSimulateResult["subscription"],
    userStatus?: string | null,
    user?: IptvRemoteUser | null
  ) {
    const status = String(userStatus || user?.status || "").trim().toLowerCase();
    if (status) {
      setUserAccess((prev) => ({ ...prev, [userId]: status }));
      setUsers((prev) =>
        prev.map((row) =>
          row.id === userId ? { ...row, ...user, status } : row
        )
      );
    }
    setResult((prev) => {
      if (!prev?.user?.id || prev.user.id !== userId) return prev;
      const next = {
        ...prev,
        subscription: subscription || prev.subscription,
        user: {
          ...prev.user,
          ...user,
          status: status || prev.user.status || null,
        },
      };
      writeLastCreated(next);
      return next;
    });
  }

  function openReconnectPicker(
    id: string,
    label?: string | null,
    previousPackageId?: string | null,
    previousPackageName?: string | null
  ) {
    setReconnectPicker({
      userId: id,
      label: label || id,
      previousPackageName: previousPackageName || null,
    });
    const previous =
      previousPackageId && packages.some((p) => p.id === previousPackageId)
        ? previousPackageId
        : "";
    setPickerPackageId(
      previous || packages.find((p) => p.active)?.id || packages[0]?.id || ""
    );
    setPickerDuration("1");
  }

  async function changeUserAccess(
    userId: string | null | undefined,
    action: "disconnect" | "reconnect",
    opts: {
      label?: string | null;
      previousPackageId?: string | null;
      previousPackageName?: string | null;
      packageId?: string;
      durationMonths?: number;
    } = {}
  ) {
    if (!canOperate) return;
    const id = String(userId || "").trim();
    if (!id) {
      toaster.create({ title: "This user has no Startlyx id", type: "error" });
      return;
    }
    if (action === "reconnect" && !opts.packageId) {
      openReconnectPicker(id, opts.label, opts.previousPackageId, opts.previousPackageName);
      return;
    }
    setActioning(`${action}:${id}`);
    try {
      const res =
        action === "disconnect"
          ? await api.disconnectIptvUser(id)
          : await api.reconnectIptvUser(id, {
              packageId: opts.packageId,
              durationMonths: opts.durationMonths || 1,
            });
      setReconnectPicker(null);
      applyAccessResult(
        id,
        res.subscription || res.subscriptions?.[0] || null,
        res.userStatus || res.user?.status,
        res.user
      );
      toaster.create({
        title:
          action === "disconnect"
            ? res.alreadyDisconnected
              ? "No active subscription to cancel"
              : "Disconnected on Startlyx"
            : res.alreadyActive
              ? "Subscription was already active"
              : "Reconnected on Startlyx",
        description:
          action === "disconnect"
            ? `Cancelled ${res.cancelledSubscriptions ?? 0} subscription(s), ended ${res.sessionsEnded ?? 0} session(s)`
            : res.subscription?.packageName
              ? `Package: ${res.subscription.packageName}`
              : undefined,
        type: "success",
      });
      if (view === "users") void loadUsers();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Could not change Startlyx access",
        type: "error",
      });
    } finally {
      setActioning(null);
    }
  }

  async function onSimulate(e?: FormEvent) {
    e?.preventDefault();
    if (!canOperate) return;
    const nextEmail = email.trim().toLowerCase();
    const nextUsername = username.trim();
    if (!nextEmail || !nextUsername) {
      toaster.create({ title: "Email and username are required", type: "error" });
      return;
    }
    if (!packageId) {
      toaster.create({ title: "Select a package", type: "error" });
      return;
    }
    if (!connected) {
      toaster.create({
        title: "Startlyx is not signed in. Check admin credentials in .env.",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.simulateIptvCustomer({
        email: nextEmail,
        username: nextUsername,
        phoneNumber: phone.trim() || undefined,
        address: address.trim() || undefined,
        packageId,
        durationMonths: Number(durationMonths) || 1,
      });
      setResult(created);
      writeLastCreated(created);
      toaster.create({
        title: created.userCreated
          ? "User created and package assigned"
          : created.subscriptionCreated
            ? "Existing user — package assigned"
            : "User already has this package",
        type: "success",
      });
      const userRes = await api.getIptvUsers().catch(() => null);
      if (userRes) setUsers(asList<IptvRemoteUser>(userRes.users));
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Could not create the Startlyx user",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const setupHint = !status
    ? ""
    : !status.configured
      ? "Save the Startlyx URL, admin email, and password under Settings."
      : !status.authenticated
        ? status.error || "Startlyx login failed. Check the admin email and password."
        : "";

  const refreshBusy =
    loading || (view === "channels" && channelsLoading) || (view === "users" && usersLoading);

  return (
    <Stack gap={PAGE_STACK_GAP} pb={6} minW={0} w="full">
      <PageHeader
        title="IPTV"
        description="Test Startlyx without creating a local customer."
        actions={
          <Flex align="center" gap={2} justify="flex-end" wrap="wrap">
            <Badge colorPalette={connected ? "green" : "orange"} variant="subtle">
              {connected ? "Connected" : "Not connected"}
            </Badge>
            <Button size="sm" variant="outline" onClick={refresh} loading={refreshBusy}>
              <FiRefreshCw />
              Refresh
            </Button>
          </Flex>
        }
      />

      <Box
        border="1px solid"
        borderColor="border.muted"
        borderRadius="lg"
        overflow="hidden"
        bg="bg.panel"
      >
        <TabStrip
          tabs={[...visibleTabs]}
          active={view}
          onChange={(id) => setView(id as ConsoleView)}
          fitContent
        />

        <Box p={{ base: 4, md: 5 }}>
          <Stack gap={4}>
          {(view === "create" || view === "packages") && error ? (
            <PageErrorBanner>{error}</PageErrorBanner>
          ) : null}
          {(view === "channels" || view === "users") && listError ? (
            <PageErrorBanner>{listError}</PageErrorBanner>
          ) : null}

          {view === "create" ? (
            <Grid
              templateColumns={{ base: "1fr", lg: "minmax(0, 1fr) minmax(0, 1fr)" }}
              gap={{ base: 5, lg: 6 }}
              alignItems="start"
            >
              <Box as="form" onSubmit={onSimulate} minW={0}>
                <Heading size="sm" mb={1}>
                  Create a test subscriber
                </Heading>
                <Text fontSize="sm" color="fg.muted" mb={4}>
                  Creates the user on Startlyx and assigns the selected package. Nothing is saved in billing.
                </Text>

                <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
                  Subscriber
                </Text>
                <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={3} mb={4}>
                  <Field.Root required>
                    <Field.Label>Email</Field.Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="subscriber@example.com"
                      autoComplete="off"
                    />
                  </Field.Root>
                  <Field.Root required>
                    <Field.Label>Username</Field.Label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="ET-401A"
                      autoComplete="off"
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Phone</Field.Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+254712345678"
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Static IP</Field.Label>
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Optional"
                    />
                  </Field.Root>
                </Grid>

                <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={2}>
                  Package
                </Text>
                <Grid templateColumns={{ base: "1fr", md: "1.6fr 1fr" }} gap={3}>
                  <Field.Root required>
                    <Field.Label>Startlyx package</Field.Label>
                    <SelectField
                      isLoading={loading}
                      fieldProps={{
                        value: packageId,
                        onChange: (e) => setPackageId(e.target.value),
                      }}
                    >
                      <option value="">Select a package</option>
                      {packages.map((pkg) => (
                        <option key={pkg.id || pkg.name} value={pkg.id || ""}>
                          {packageLabel(pkg)}
                        </option>
                      ))}
                    </SelectField>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Duration</Field.Label>
                    <SelectField
                      fieldProps={{
                        value: durationMonths,
                        onChange: (e) => setDurationMonths(e.target.value),
                      }}
                    >
                      {DURATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </SelectField>
                  </Field.Root>
                </Grid>

                {setupHint ? (
                  <Text fontSize="sm" color="orange.700" mt={4}>
                    {setupHint}
                  </Text>
                ) : null}

                <Flex justify="flex-end" gap={2} mt={5}>
                  <Button variant="ghost" type="button" onClick={resetTestForm}>
                    New test
                  </Button>
                  <Button
                    colorPalette="brand"
                    type="submit"
                    loading={submitting}
                    disabled={!connected}
                  >
                    Create and assign
                  </Button>
                </Flex>
              </Box>

              <Box {...inlineFormCardProps} minW={0} h="100%">
                <Flex justify="space-between" align="start" gap={3} mb={3}>
                  <Box>
                    <Heading size="sm">Last created user</Heading>
                    <Text fontSize="sm" color="fg.muted">
                      {result
                        ? `${result.userCreated ? "New user" : "Existing user reused"}${
                            result.subscriptionCreated
                              ? " · package assigned"
                              : result.subscription
                                ? " · package already active"
                                : ""
                          }`
                        : "Shown here after you create a test subscriber."}
                    </Text>
                  </Box>
                  {result ? (
                    <Button size="sm" variant="outline" onClick={() => setView("users")}>
                      Open users
                    </Button>
                  ) : null}
                </Flex>
                {result ? (
                  <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={3} fontSize="sm">
                    <Box>
                      <Text fontSize="xs" color="fg.muted">Username</Text>
                      <Text fontWeight="medium">{result.user?.username || "—"}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="xs" color="fg.muted">Email</Text>
                      <Text fontWeight="medium">{result.user?.email || "—"}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="xs" color="fg.muted">Package</Text>
                      <Text fontWeight="medium">
                        {result.subscription?.packageName || selectedPackage?.name || "—"}
                      </Text>
                    </Box>
                    <Box>
                      <Text fontSize="xs" color="fg.muted">Status</Text>
                      <TextStatus status={accessLabel(resultAccess) || "—"} />
                    </Box>
                    {result.subscription?.endDate ? (
                      <Box>
                        <Text fontSize="xs" color="fg.muted">Ends</Text>
                        <Text>{formatDateTime(result.subscription.endDate)}</Text>
                      </Box>
                    ) : null}
                  </Grid>
                ) : (
                  <Text fontSize="sm" color="fg.subtle" py={6}>
                    No test subscriber created yet.
                  </Text>
                )}
                {canOperate && result?.user?.id ? (
                  <Flex justify="flex-end" gap={2} mt={5} wrap="wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      colorPalette="red"
                      loading={actioning === `disconnect:${result.user.id}`}
                      disabled={Boolean(actioning) || !connected || !canDisconnect(resultAccess)}
                      onClick={() => void changeUserAccess(result.user?.id, "disconnect")}
                    >
                      Disconnect
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      colorPalette="green"
                      loading={actioning === `reconnect:${result.user.id}`}
                      disabled={Boolean(actioning) || !connected || !canReconnect(resultAccess)}
                      onClick={() =>
                        void changeUserAccess(result.user?.id, "reconnect", {
                          label: result.user?.username || result.user?.email,
                          previousPackageId: result.subscription?.packageId,
                          previousPackageName: result.subscription?.packageName,
                        })
                      }
                    >
                      Reconnect
                    </Button>
                  </Flex>
                ) : null}
              </Box>
            </Grid>
          ) : null}

          {view === "channels" ? (
            <Stack gap={3}>
              <Flex gap={2} wrap="wrap" align="center" justify="space-between">
                <Flex gap={2} wrap="wrap">
                  <Button
                    size="sm"
                    borderRadius="full"
                    variant={statusFilter === "all" ? "solid" : "subtle"}
                    colorPalette={statusFilter === "all" ? "brand" : "gray"}
                    onClick={() => setStatusFilter("all")}
                  >
                    All ({channels.length})
                  </Button>
                  {Object.entries(counts).map(([key, n]) => (
                    <Button
                      key={key}
                      size="sm"
                      borderRadius="full"
                      variant={statusFilter === key ? "solid" : "subtle"}
                      colorPalette={statusFilter === key ? channelStatusPalette(key) : "gray"}
                      onClick={() => setStatusFilter(key)}
                    >
                      {key} ({n})
                    </Button>
                  ))}
                </Flex>
                <Box maxW="260px" w={{ base: "full", lg: "260px" }}>
                  <Input
                    size="sm"
                    h={FILTER_CONTROL_HEIGHT}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search channels"
                  />
                </Box>
              </Flex>

              {channelsLoading && !channels.length ? (
                <>
                  <Box display={{ base: "none", lg: "block" }}>
                    <DataTableLoadingSkeleton rows={8} />
                  </Box>
                  <Box display={{ base: "block", lg: "none" }}>
                    <MobileCardListSkeleton rows={6} />
                  </Box>
                </>
              ) : !filteredChannels.length ? (
                <EmptyState>
                  {channels.length
                    ? "No channels match this filter."
                    : "No channels returned from Startlyx."}
                </EmptyState>
              ) : (
                <ResponsiveListViews
                  mobile={
                    <MobileDataList
                      items={filteredChannels}
                      getKey={(ch) => ch.id || `${ch.channelNumber}-${ch.name}`}
                      renderCard={(ch) => {
                        const label = channelStatusLabel(ch);
                        return (
                          <MobileDataCard
                            title={ch.name}
                            subtitle={[ch.channelNumber && `#${ch.channelNumber}`, ch.categoryName]
                              .filter(Boolean)
                              .join(" · ")}
                            trailing={
                              <Badge colorPalette={channelStatusPalette(label)} variant="subtle">
                                {label}
                              </Badge>
                            }
                            fields={[
                              { label: "Viewers", value: ch.clientCount == null ? "—" : String(ch.clientCount) },
                              { label: "Enabled", value: ch.enabled ? "On" : "Off" },
                              ...(ch.lastError ? [{ label: "Error", value: ch.lastError }] : []),
                            ]}
                          />
                        );
                      }}
                    />
                  }
                  desktop={
                    <Box borderWidth="1px" borderRadius="lg" overflowX="auto">
                      <Table.Root size="sm" minW="720px">
                        <Table.Header>
                          <Table.Row>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>#</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Channel</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Category</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Status</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Enabled</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Viewers</Table.ColumnHeader>
                            <Table.ColumnHeader {...dataTableColumnHeaderProps}>Last error</Table.ColumnHeader>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {filteredChannels.map((ch) => {
                            const label = channelStatusLabel(ch);
                            return (
                              <Table.Row key={ch.id || `${ch.channelNumber}-${ch.name}`}>
                                <Table.Cell {...dataTableCellProps}>{ch.channelNumber || "—"}</Table.Cell>
                                <Table.Cell {...dataTableCellProps}>{ch.name}</Table.Cell>
                                <Table.Cell {...dataTableCellProps}>{ch.categoryName || "—"}</Table.Cell>
                                <Table.Cell {...dataTableCellProps}>
                                  <Badge colorPalette={channelStatusPalette(label)} variant="subtle">
                                    {label}
                                  </Badge>
                                </Table.Cell>
                                <Table.Cell {...dataTableCellProps}>{ch.enabled ? "On" : "Off"}</Table.Cell>
                                <Table.Cell {...dataTableCellProps}>
                                  {ch.clientCount == null ? "—" : ch.clientCount}
                                </Table.Cell>
                                <Table.Cell {...dataTableCellProps} title={ch.lastError || ""}>
                                  {ch.lastError || "—"}
                                </Table.Cell>
                              </Table.Row>
                            );
                          })}
                        </Table.Body>
                      </Table.Root>
                    </Box>
                  }
                />
              )}
            </Stack>
          ) : null}

          {view === "packages" ? (
            <Stack gap={3}>
              <Input
                size="sm"
                maxW="260px"
                h={FILTER_CONTROL_HEIGHT}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search packages"
              />
              {loading && !packages.length ? (
                <DataTableLoadingSkeleton rows={5} />
              ) : !filteredPackages.length ? (
                <EmptyState>No packages returned from Startlyx.</EmptyState>
              ) : (
              <ResponsiveListViews
                mobile={
                  <MobileDataList
                    items={filteredPackages}
                    getKey={(pkg) => pkg.id || pkg.name || "package"}
                    renderCard={(pkg) => (
                      <MobileDataCard
                        title={pkg.name || pkg.id || "Package"}
                        subtitle={pkg.price != null ? `${pkg.currency} ${pkg.price}` : undefined}
                        trailing={
                          canOperate ? (
                          <Button size="sm" variant="ghost" onClick={() => applyPackageToTest(pkg)}>
                            Use
                          </Button>
                          ) : undefined
                        }
                        fields={[
                          { label: "Sessions", value: pkg.sessions == null ? "—" : String(pkg.sessions) },
                          { label: "Active", value: pkg.active ? "Yes" : "No" },
                        ]}
                        onClick={canOperate ? () => applyPackageToTest(pkg) : undefined}
                      />
                    )}
                  />
                }
                desktop={
                  <Box borderWidth="1px" borderRadius="lg" overflowX="auto">
                    <Table.Root size="sm">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Name</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Price</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Sessions</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Active</Table.ColumnHeader>
                          {canOperate ? (
                          <Table.ColumnHeader {...dataTableColumnHeaderProps} />
                          ) : null}
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {filteredPackages.map((pkg) => (
                          <Table.Row key={pkg.id || pkg.name}>
                            <Table.Cell {...dataTableCellProps}>{pkg.name || pkg.id}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              {pkg.price != null ? `${pkg.currency} ${pkg.price}` : "—"}
                            </Table.Cell>
                            <Table.Cell {...dataTableCellProps}>{pkg.sessions ?? "—"}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>{pkg.active ? "Yes" : "No"}</Table.Cell>
                            {canOperate ? (
                            <Table.Cell {...dataTableCellProps}>
                              <Button size="xs" variant="ghost" onClick={() => applyPackageToTest(pkg)}>
                                Use in test
                              </Button>
                            </Table.Cell>
                            ) : null}
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                }
              />
              )}
            </Stack>
          ) : null}

          {view === "users" ? (
            <Stack gap={3}>
              {connected ? (
                <Input
                  size="sm"
                  maxW="260px"
                  h={FILTER_CONTROL_HEIGHT}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users"
                />
              ) : null}
              {!connected ? (
                <EmptyState>Sign in to Startlyx to list remote users.</EmptyState>
              ) : usersLoading && !users.length ? (
                <DataTableLoadingSkeleton rows={6} />
              ) : !filteredUsers.length ? (
                <EmptyState>
                  {users.length ? "No users match this search." : "No remote users yet. Create a test subscriber first."}
                </EmptyState>
              ) : (
              <ResponsiveListViews
                mobile={
                  <MobileDataList
                    items={filteredUsers.slice(0, 80)}
                    getKey={(user) => user.id || user.username || user.email || "user"}
                    renderCard={(user) => (
                      <MobileDataCard
                        title={user.username || "—"}
                        subtitle={user.email || undefined}
                        trailing={
                          canOperate ? (
                          <Button size="sm" variant="ghost" onClick={() => applyUserToTest(user)}>
                            Use
                          </Button>
                          ) : undefined
                        }
                        fields={[
                          ...(user.status
                            ? [{ label: "Status", value: accessLabel(user.status) }]
                            : []),
                          ...(user.phoneNumber
                            ? [{ label: "Phone", value: user.phoneNumber }]
                            : []),
                        ]}
                        footer={
                          canOperate && user.id ? (
                            <Flex gap={2}>
                              <Button
                                size="xs"
                                variant="outline"
                                colorPalette="red"
                                loading={actioning === `disconnect:${user.id}`}
                                disabled={Boolean(actioning) || !connected || !canDisconnect(user.status)}
                                onClick={() => void changeUserAccess(user.id, "disconnect")}
                              >
                                Disconnect
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                colorPalette="green"
                                loading={actioning === `reconnect:${user.id}`}
                                disabled={Boolean(actioning) || !connected || !canReconnect(user.status)}
                                onClick={() =>
                                  void changeUserAccess(user.id, "reconnect", {
                                    label: user.username || user.email,
                                    previousPackageId: user.lastPackageId,
                                    previousPackageName: user.lastPackageName,
                                  })
                                }
                              >
                                Reconnect
                              </Button>
                            </Flex>
                          ) : undefined
                        }
                      />
                    )}
                  />
                }
                desktop={
                  <Box borderWidth="1px" borderRadius="lg" overflowX="auto">
                    <Table.Root size="sm">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Username</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Email</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Phone</Table.ColumnHeader>
                          <Table.ColumnHeader {...dataTableColumnHeaderProps}>Status</Table.ColumnHeader>
                          {canOperate ? (
                          <Table.ColumnHeader {...dataTableColumnHeaderProps} />
                          ) : null}
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {filteredUsers.slice(0, 80).map((user) => (
                          <Table.Row key={user.id || user.username || user.email}>
                            <Table.Cell {...dataTableCellProps}>{user.username || "—"}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>{user.email || "—"}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>{user.phoneNumber || "—"}</Table.Cell>
                            <Table.Cell {...dataTableCellProps}>
                              {user.status ? <TextStatus status={accessLabel(user.status)} /> : "—"}
                            </Table.Cell>
                            {canOperate ? (
                            <Table.Cell {...dataTableCellProps}>
                              <Flex gap={1} justify="flex-end" wrap="wrap">
                                <Button size="xs" variant="ghost" onClick={() => applyUserToTest(user)}>
                                  Use in test
                                </Button>
                                {user.id ? (
                                  <>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      colorPalette="red"
                                      loading={actioning === `disconnect:${user.id}`}
                                      disabled={Boolean(actioning) || !connected || !canDisconnect(user.status)}
                                      onClick={() => void changeUserAccess(user.id, "disconnect")}
                                    >
                                      Disconnect
                                    </Button>
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      colorPalette="green"
                                      loading={actioning === `reconnect:${user.id}`}
                                      disabled={Boolean(actioning) || !connected || !canReconnect(user.status)}
                                      onClick={() =>
                                  void changeUserAccess(user.id, "reconnect", {
                                    label: user.username || user.email,
                                    previousPackageId: user.lastPackageId,
                                    previousPackageName: user.lastPackageName,
                                  })
                                }
                                    >
                                      Reconnect
                                    </Button>
                                  </>
                                ) : null}
                              </Flex>
                            </Table.Cell>
                            ) : null}
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                }
              />
              )}
            </Stack>
          ) : null}

          {view === "settings" ? (
            <Box as="form" onSubmit={saveConnection} maxW="560px">
              <Heading size="sm" mb={1}>
                Startlyx login
              </Heading>
              <Text fontSize="sm" color="fg.muted" mb={4}>
                Stored in app settings. Staging and production can connect without updating the server .env file.
              </Text>
              <Stack gap={3}>
                <Field.Root required>
                  <Field.Label>Console URL</Field.Label>
                  <Input
                    value={consoleUrl}
                    onChange={(e) => setConsoleUrl(e.target.value)}
                    placeholder={DEFAULT_STARTLYX_URL}
                    autoComplete="off"
                  />
                </Field.Root>
                <Field.Root required>
                  <Field.Label>Admin email</Field.Label>
                  <Input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="network@sulsolutions.biz"
                    autoComplete="username"
                  />
                </Field.Root>
                <Field.Root required={!iptvSettings?.passwordConfigured}>
                  <Field.Label>Admin password</Field.Label>
                  <PasswordInput
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder={
                      iptvSettings?.passwordConfigured
                        ? "Leave blank to keep the saved password"
                        : "Startlyx admin password"
                    }
                    autoComplete="new-password"
                  />
                </Field.Root>
                {setupHint ? (
                  <Text fontSize="sm" color="orange.700">
                    {setupHint}
                  </Text>
                ) : status?.authenticated ? (
                  <Text fontSize="sm" color="fg.muted">
                    Connected as {status.adminEmail || adminEmail || "admin"}.
                  </Text>
                ) : null}
                <Flex justify="flex-end" gap={2} pt={1}>
                  <Button
                    colorPalette="brand"
                    type="submit"
                    loading={savingSettings}
                    disabled={!adminEmail.trim() || (!adminPassword.trim() && !iptvSettings?.passwordConfigured)}
                  >
                    Save and connect
                  </Button>
                </Flex>
              </Stack>
            </Box>
          ) : null}
          </Stack>
        </Box>
      </Box>

      <AppDialog
        open={Boolean(reconnectPicker)}
        onOpenChange={(d) => {
          if (!d.open && !actioning) setReconnectPicker(null);
        }}
        maxW="md"
      >
        <Dialog.Header px={5} pt={5} pb={3} pr={12} flexDirection="column" alignItems="flex-start" gap={0}>
          <Dialog.Title fontSize="lg">Choose a package to reconnect</Dialog.Title>
          <Dialog.Description fontSize="sm" color="fg.muted" mt={1}>
            {reconnectPicker?.previousPackageName
              ? `${reconnectPicker.label} was last on ${reconnectPicker.previousPackageName}. Keep it or pick another package.`
              : `${reconnectPicker?.label} has no previous package on Startlyx. Pick one to assign.`}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body px={5} py={4}>
          <Stack gap={4}>
            <Field.Root required>
              <Field.Label>Startlyx package</Field.Label>
              <SelectField
                fieldProps={{
                  value: pickerPackageId,
                  onChange: (e) => setPickerPackageId(e.target.value),
                }}
              >
                <option value="">Select a package</option>
                {packages.map((pkg) => (
                  <option key={pkg.id || pkg.name} value={pkg.id || ""}>
                    {packageLabel(pkg)}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
            <Field.Root>
              <Field.Label>Duration</Field.Label>
              <SelectField
                fieldProps={{
                  value: pickerDuration,
                  onChange: (e) => setPickerDuration(e.target.value),
                }}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Field.Root>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer px={5} py={4} borderTop="1px solid" borderColor="border.muted">
          <Flex gap={2} justify="flex-end" w="full">
            <Button
              variant="outline"
              disabled={Boolean(actioning)}
              onClick={() => setReconnectPicker(null)}
            >
              Cancel
            </Button>
            <Button
              colorPalette="green"
              loading={actioning === `reconnect:${reconnectPicker?.userId}`}
              disabled={!pickerPackageId || Boolean(actioning)}
              onClick={() =>
                reconnectPicker &&
                void changeUserAccess(reconnectPicker.userId, "reconnect", {
                  label: reconnectPicker.label,
                  packageId: pickerPackageId,
                  durationMonths: Number(pickerDuration) || 1,
                })
              }
            >
              Reconnect
            </Button>
          </Flex>
        </Dialog.Footer>
      </AppDialog>
    </Stack>
  );
}
