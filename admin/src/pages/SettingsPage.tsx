import { useEffect, useState } from "react";
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
import { toaster } from "../components/ui/toaster";
import { PAGE_STACK_GAP, PageHeader } from "../components/ui/pageLayout";

const TABS = [
  { id: "permissions", label: "Users & permissions" },
  { id: "webhooks", label: "Webhooks" },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
          Register these URLs in the Safaricom Daraja portal for STK push and C2B notifications.
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
          Point Zoho invoice-paid notifications here. Set{" "}
          <Text as="span" fontFamily="mono" fontSize="xs">
            ZOHO_WEBHOOK_SECRET
          </Text>{" "}
          in server environment and send it as{" "}
          <Text as="span" fontFamily="mono" fontSize="xs">
            x-zoho-webhook-secret
          </Text>
          .
        </Text>
        <ConfigRow label="Invoice paid endpoint" value={webhooks.zoho.invoicePaid} />
      </Box>

      <Box>
        <Heading size="sm" mb={1}>
          Integration flags
        </Heading>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Read-only view of server environment toggles. Change these in deployment configuration.
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
        Assign roles when creating or editing users below.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId =
    tabParam === "webhooks" || tabParam === "permissions" ? tabParam : "permissions";

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
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
  }, []);

  function setTab(id: TabId) {
    setSearchParams(id === "permissions" ? {} : { tab: id }, { replace: true });
  }

  return (
    <Stack gap={0}>
      <PageHeader
        title="Settings"
        description="User permissions, webhook endpoints, and integration configuration"
      />

      <Box
        border="1px solid"
        borderColor="border.muted"
        borderRadius="lg"
        overflow="hidden"
        bg="bg.panel"
        mt={{ base: 3, lg: 0 }}
      >
        <TabStrip tabs={[...TABS]} active={activeTab} onChange={(id) => setTab(id as TabId)} />

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
        </Box>
      </Box>
    </Stack>
  );
}
