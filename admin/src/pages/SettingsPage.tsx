import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Flex,
  Heading,
  IconButton,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FiCheck, FiCopy, FiX } from "react-icons/fi";
import { api, type AppSettings } from "../lib/api";
import { TabStrip } from "../components/ui/TabStrip";
import { UsersPage } from "./UsersPage";
import { LogsPage } from "./LogsPage";
import { SynchronizationPage } from "./SynchronizationPage";
import { toaster } from "../components/ui/toaster";
import { PAGE_STACK_GAP, PageHeader } from "../components/ui/pageLayout";
import { useAuth } from "../lib/auth";
import {
  canAccessOps,
  canManageUsers,
  canOperateFinance,
} from "../lib/rbac";

type TabId = "permissions" | "webhooks" | "logs" | "synchronization";

type SettingsTab = {
  id: TabId;
  label: string;
};

function ConfigRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toaster.create({ title: "Copied to clipboard", type: "success" });
    } catch {
      toaster.create({ title: "Could not copy", type: "error" });
    }
  }

  return (
    <Box
      border="1px solid"
      borderColor="border.muted"
      borderRadius="lg"
      p={3}
      bg="bg.panel"
    >
      <Flex justify="space-between" align="start" gap={3}>
        <Box flex={1} minW={0}>
          <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb={1}>
            {label}
          </Text>
          <Text fontSize="sm" fontFamily="mono" wordBreak="break-all">
            {value}
          </Text>
          {hint ? (
            <Text fontSize="xs" color="fg.muted" mt={1}>
              {hint}
            </Text>
          ) : null}
        </Box>
        <IconButton
          aria-label={`Copy ${label}`}
          size="xs"
          variant="ghost"
          onClick={copy}
          color="fg.muted"
          flexShrink={0}
        >
          <FiCopy size={14} />
        </IconButton>
      </Flex>
    </Box>
  );
}

function StatusBadge({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <Badge colorPalette={ok ? "green" : "orange"} variant="subtle" size="sm">
      {ok ? <FiCheck style={{ marginRight: 4 }} /> : <FiX style={{ marginRight: 4 }} />}
      {ok ? okLabel : failLabel}
    </Badge>
  );
}

function WebhooksPanel({ settings }: { settings: AppSettings }) {
  const { webhooks, integrations } = settings;

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Box>
        <Heading size="sm" mb={1}>
          M-Pesa callbacks
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Register in Safaricom Daraja for STK and C2B.
        </Text>
        <Stack gap={2}>
          <ConfigRow label="STK callback" value={webhooks.mpesa.callback} />
          <ConfigRow label="C2B confirmation" value={webhooks.mpesa.confirmation} />
          <ConfigRow label="C2B validation" value={webhooks.mpesa.validation} />
          <ConfigRow label="B2C result" value={webhooks.mpesa.b2cResult} />
          <ConfigRow label="B2C timeout" value={webhooks.mpesa.b2cTimeout} />
        </Stack>
      </Box>

      <Box>
        <Flex align="center" gap={2} mb={1}>
          <Heading size="sm">Zoho Books webhook</Heading>
          <StatusBadge
            ok={webhooks.zoho.secretConfigured}
            okLabel="Secret configured"
            failLabel="Secret not set"
          />
        </Flex>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Zoho invoice-paid endpoint. Send{" "}
          <Text as="span" fontFamily="mono" fontSize="xs">
            x-zoho-webhook-secret
          </Text>{" "}
          matching{" "}
          <Text as="span" fontFamily="mono" fontSize="xs">
            ZOHO_WEBHOOK_SECRET
          </Text>
          .
        </Text>
        <ConfigRow label="Invoice paid endpoint" value={webhooks.zoho.invoicePaid} />
      </Box>

      <Box>
        <Flex align="center" gap={2} mb={1} flexWrap="wrap">
          <Heading size="sm">Lead generation</Heading>
          <StatusBadge
            ok={webhooks.leads.whatsappConfigured}
            okLabel="WhatsApp API configured"
            failLabel="WhatsApp API not set"
          />
          <StatusBadge
            ok={webhooks.leads.whatsappVerifyTokenConfigured}
            okLabel="Verify token set"
            failLabel="Verify token missing"
          />
        </Flex>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Public intake form, embeddable widget, and Meta WhatsApp Cloud API webhook for prospects (non-customers). Existing-customer messaging is under Communication.
          Register the webhook URL in Meta Developer Console with{" "}
          <Text as="span" fontFamily="mono" fontSize="xs">
            WHATSAPP_WEBHOOK_VERIFY_TOKEN
          </Text>
          .
        </Text>
        <Stack gap={2}>
          <ConfigRow label="Public form" value={webhooks.leads.publicForm} />
          <ConfigRow
            label="Embed script"
            value={webhooks.leads.embedScript}
            hint="Place a #starlynx-lead-form div, then load this script on partner sites."
          />
          <ConfigRow label="Embed snippet" value={webhooks.leads.embedSnippet} />
          <ConfigRow
            label="WhatsApp webhook"
            value={webhooks.leads.whatsappWebhook}
          />
        </Stack>
      </Box>

      <Box>
        <Heading size="sm" mb={1}>
          Integration flags
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Server environment toggles (read-only here).
        </Text>
        <Stack gap={2}>
          <Flex
            justify="space-between"
            align="center"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.panel"
          >
            <Text fontSize="sm">Xtream sync enabled</Text>
            <StatusBadge
              ok={integrations.xtreamSyncEnabled}
              okLabel="On"
              failLabel="Off"
            />
          </Flex>
          <Flex
            justify="space-between"
            align="center"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.panel"
          >
            <Text fontSize="sm">M-Pesa STK uses live amount</Text>
            <StatusBadge
              ok={integrations.mpesaStkLiveAmount}
              okLabel="Live"
              failLabel="Test"
            />
          </Flex>
          <Flex
            justify="space-between"
            align="center"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.panel"
          >
            <Text fontSize="sm">Zoho invoices tax-inclusive</Text>
            <StatusBadge
              ok={integrations.zohoTaxInclusive}
              okLabel="Inclusive"
              failLabel="Exclusive"
            />
          </Flex>
        </Stack>
      </Box>
    </Stack>
  );
}

function RolesPanel({ settings }: { settings: AppSettings }) {
  return (
    <Box mb={4}>
      <Heading size="sm" mb={1}>
        Role definitions
      </Heading>
      <Text fontSize="sm" color="fg.muted" mb={3}>
        Assign when creating or editing users.
      </Text>
      <Stack gap={2}>
        {settings.roles.map((role) => (
          <Box
            key={role.id}
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={3}
            bg="bg.panel"
          >
            <Text fontWeight="semibold" fontSize="sm">
              {role.label}
            </Text>
            <Text fontSize="sm" color="fg.muted" mt={0.5}>
              {role.description}
            </Text>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const tabs = useMemo(() => {
    const all: SettingsTab[] = [
      { id: "permissions", label: "Users & permissions" },
      { id: "webhooks", label: "Webhooks" },
      { id: "logs", label: "Logs" },
      { id: "synchronization", label: "Synchronization" },
    ];
    return all.filter((tab) => {
      if (tab.id === "permissions" || tab.id === "webhooks") return canManageUsers(user);
      if (tab.id === "logs") return canAccessOps(user);
      if (tab.id === "synchronization") return canOperateFinance(user);
      return false;
    });
  }, [user]);

  const activeTab: TabId =
    tabs.find((tab) => tab.id === tabParam)?.id ?? tabs[0]?.id ?? "permissions";

  const needsSettingsPayload =
    activeTab === "permissions" || activeTab === "webhooks";

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(needsSettingsPayload);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!needsSettingsPayload) return undefined;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.getSettings();
        if (!cancelled) setSettings(res);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsSettingsPayload]);

  function setTab(id: TabId) {
    const defaultTab = tabs[0]?.id;
    setSearchParams(id === defaultTab ? {} : { tab: id }, { replace: true });
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader title="Settings" />

      <Box
        border="1px solid"
        borderColor="border.muted"
        borderRadius="lg"
        overflow="hidden"
        bg="bg.panel"
      >
        <TabStrip
          tabs={tabs}
          active={activeTab}
          onChange={(id) => setTab(id as TabId)}
          fitContent
        />

        <Box p={{ base: 4, md: 5 }}>
          {activeTab === "permissions" ? (
            <Stack gap={PAGE_STACK_GAP}>
              {settings ? <RolesPanel settings={settings} /> : null}
              <UsersPage embedded />
            </Stack>
          ) : null}

          {activeTab === "webhooks" ? (
            loading ? (
              <Text fontSize="sm" color="fg.muted">
                Loading webhook configuration…
              </Text>
            ) : error ? (
              <Text fontSize="sm" color="red.600">
                {error}
              </Text>
            ) : settings ? (
              <WebhooksPanel settings={settings} />
            ) : null
          ) : null}

          {activeTab === "logs" ? <LogsPage embedded /> : null}

          {activeTab === "synchronization" ? (
            <SynchronizationPage embedded />
          ) : null}
        </Box>
      </Box>
    </Stack>
  );
}
