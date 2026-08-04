import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiCheck, FiChevronDown, FiChevronRight, FiCopy, FiX } from "react-icons/fi";
import type { ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Heading,
  IconButton,
  Input,
  List,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { api, type AppSettings } from "../lib/api";
import { TabStrip } from "../components/ui/TabStrip";
import { UsersPage } from "./UsersPage";
import { LogsPage } from "./LogsPage";
import { SynchronizationPage } from "./SynchronizationPage";
import { toaster } from "../components/ui/toaster";
import { PAGE_STACK_GAP, PageHeader } from "../components/ui/pageLayout";
import { useAuth } from "../lib/authContext";
import {
  canAccessOps,
  canManageUsers,
  canOperateFinance,
} from "../lib/rbac";
import {
  CURRENT_APP_VERSION,
  VERSION_LOG,
} from "../lib/versionLog";

type TabId =
  | "permissions"
  | "webhooks"
  | "communication"
  | "logs"
  | "synchronization"
  | "versioning";

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

/** Billing-style accordion for Settings tabs that group 2+ modules. */
function SettingsAccordionSection({
  title,
  defaultOpen = false,
  badges,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  badges?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      border="1px solid"
      borderColor={open ? "brand.300" : "brand.100"}
      borderRadius="md"
      bg="bg.panel"
      overflow="hidden"
    >
      <Flex
        align="center"
        gap={2}
        px={3}
        py={2.5}
        cursor="pointer"
        _hover={{ bg: "brand.50" }}
        w="full"
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        {open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        <Text
          fontSize="sm"
          fontWeight="semibold"
          color="brand.800"
          flex={1}
          minW={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          {title}
        </Text>
        {badges ? (
          <Flex gap={1.5} flexShrink={0} flexWrap="wrap" justify="flex-end">
            {badges}
          </Flex>
        ) : null}
      </Flex>

      {open ? (
        <Box px={3} pb={3} pt={3} borderTop="1px solid" borderColor="border.muted">
          {children}
        </Box>
      ) : null}
    </Box>
  );
}

function CommunicationPanel({
  settings,
  onUpdated,
}: {
  settings: AppSettings;
  onUpdated: (next: AppSettings) => void;
}) {
  const email = settings.communication?.email;
  const whatsapp = settings.communication?.whatsapp;
  const webhookUrl = settings.webhooks?.leads?.whatsappWebhook || "";

  const [fromAddress, setFromAddress] = useState(
    email?.fromAddress || "customersupport@sulsolutions.biz"
  );
  const [fromName, setFromName] = useState(email?.fromName || "Customer Support");
  const [accountId, setAccountId] = useState(email?.accountId || "");
  const [invoiceCcEmails, setInvoiceCcEmails] = useState(
    (email?.invoiceCcEmails || []).join("\n")
  );
  const [savingEmail, setSavingEmail] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState(whatsapp?.phoneNumberId || "");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState(
    whatsapp?.webhookVerifyToken || ""
  );
  const [clickToChatUrl, setClickToChatUrl] = useState(
    whatsapp?.clickToChatUrl || ""
  );
  const [welcomeMessage, setWelcomeMessage] = useState(
    whatsapp?.welcomeMessage || ""
  );
  const [completeMessage, setCompleteMessage] = useState(
    whatsapp?.completeMessage || ""
  );
  const [outboundTemplate, setOutboundTemplate] = useState(
    whatsapp?.outboundTemplate || ""
  );
  const [outboundTemplateLang, setOutboundTemplateLang] = useState(
    whatsapp?.outboundTemplateLang || "en"
  );
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);

  useEffect(() => {
    setFromAddress(email?.fromAddress || "customersupport@sulsolutions.biz");
    setFromName(email?.fromName || "Customer Support");
    setAccountId(email?.accountId || "");
    setInvoiceCcEmails((email?.invoiceCcEmails || []).join("\n"));
  }, [
    email?.fromAddress,
    email?.fromName,
    email?.accountId,
    email?.invoiceCcEmails,
  ]);

  useEffect(() => {
    setPhoneNumberId(whatsapp?.phoneNumberId || "");
    setWebhookVerifyToken(whatsapp?.webhookVerifyToken || "");
    setClickToChatUrl(whatsapp?.clickToChatUrl || "");
    setWelcomeMessage(whatsapp?.welcomeMessage || "");
    setCompleteMessage(whatsapp?.completeMessage || "");
    setOutboundTemplate(whatsapp?.outboundTemplate || "");
    setOutboundTemplateLang(whatsapp?.outboundTemplateLang || "en");
    setAccessToken("");
    setAppSecret("");
  }, [
    whatsapp?.phoneNumberId,
    whatsapp?.webhookVerifyToken,
    whatsapp?.clickToChatUrl,
    whatsapp?.welcomeMessage,
    whatsapp?.completeMessage,
    whatsapp?.outboundTemplate,
    whatsapp?.outboundTemplateLang,
  ]);

  async function saveEmail() {
    setSavingEmail(true);
    try {
      const res = await api.updateCommunicationEmailSettings({
        fromAddress: fromAddress.trim(),
        fromName: fromName.trim(),
        accountId: accountId.trim() || null,
        invoiceCcEmails: invoiceCcEmails,
      });
      onUpdated({
        ...settings,
        communication: {
          ...settings.communication,
          email: {
            fromAddress: res.email.fromAddress,
            fromName: res.email.fromName,
            accountId: res.email.accountId,
            invoiceCcEmails: res.email.invoiceCcEmails || [],
            configured: res.email.configured,
            oauthTokenConfigured:
              res.email.oauthTokenConfigured ?? email?.oauthTokenConfigured ?? false,
            dnsHint: email?.dnsHint,
          },
          whatsapp: settings.communication?.whatsapp,
        },
      });
      toaster.create({ type: "success", title: "Email settings saved" });
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to save email settings",
      });
    } finally {
      setSavingEmail(false);
    }
  }

  async function saveWhatsApp() {
    setSavingWhatsApp(true);
    try {
      const res = await api.updateCommunicationWhatsAppSettings({
        phoneNumberId: phoneNumberId.trim(),
        accessToken: accessToken.trim() || undefined,
        appSecret: appSecret.trim() || undefined,
        webhookVerifyToken: webhookVerifyToken.trim(),
        clickToChatUrl: clickToChatUrl.trim() || null,
        welcomeMessage: welcomeMessage.trim(),
        completeMessage: completeMessage.trim(),
        outboundTemplate: outboundTemplate.trim() || null,
        outboundTemplateLang: outboundTemplateLang.trim() || "en",
      });
      onUpdated({
        ...settings,
        webhooks: {
          ...settings.webhooks,
          leads: {
            ...settings.webhooks.leads,
            whatsappConfigured: res.whatsapp.configured,
            whatsappVerifyTokenConfigured: res.whatsapp.webhookVerifyTokenConfigured,
          },
        },
        communication: {
          ...settings.communication,
          email: settings.communication?.email || {
            fromAddress: "",
            fromName: "",
            accountId: null,
            configured: false,
            oauthTokenConfigured: false,
          },
          whatsapp: res.whatsapp,
        },
      });
      setAccessToken("");
      setAppSecret("");
      toaster.create({ type: "success", title: "WhatsApp settings saved" });
    } catch (e) {
      toaster.create({
        type: "error",
        title: e instanceof Error ? e.message : "Failed to save WhatsApp settings",
      });
    } finally {
      setSavingWhatsApp(false);
    }
  }

  return (
    <Stack gap={2}>
      <SettingsAccordionSection
        title="Customer email (Zoho Mail)"
        defaultOpen
        badges={
          <StatusBadge
            ok={Boolean(email?.configured)}
            okLabel="OAuth connected"
            failLabel="OAuth not connected"
          />
        }
      >
        <Text fontSize="sm" color="fg.muted" mb={4}>
          From address, display name, and invoice CC list used for customer
          emails. OAuth secrets stay in server environment variables.
        </Text>

        <Stack gap={3} maxW="560px">
          <Field.Root>
            <Field.Label>From name</Field.Label>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Customer Support"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>From address</Field.Label>
            <Input
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="customersupport@sulsolutions.biz"
            />
            <Field.HelperText>
              Must be the mailbox address or an alias on the connected Zoho account.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Zoho Mail account ID</Field.Label>
            <Input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="6499189000000008002"
              fontFamily="mono"
            />
            <Field.HelperText>
              Numeric account ID from Zoho Mail (optional if auto-resolved).
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Invoice CC emails</Field.Label>
            <Textarea
              value={invoiceCcEmails}
              onChange={(e) => setInvoiceCcEmails(e.target.value)}
              placeholder={"support@sulsolutions.biz\ndirector@sulsolutions.biz"}
              rows={4}
              fontFamily="mono"
              fontSize="sm"
            />
            <Field.HelperText>
              CCd on signup and receipt invoice emails from Zoho Books. One
              address per line (or comma-separated).
            </Field.HelperText>
          </Field.Root>
          <Button
            colorPalette="brand"
            alignSelf="flex-start"
            loading={savingEmail}
            onClick={() => void saveEmail()}
          >
            Save email settings
          </Button>
        </Stack>

        <Box
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          p={4}
          bg="bg.muted"
          mt={4}
        >
          <Heading size="xs" mb={2}>
            Zoho Mail still in .env
          </Heading>
          <Text fontSize="sm" color="fg.muted" mb={2}>
            Keep these on the server only (not editable here):
          </Text>
          <List.Root
            fontSize="sm"
            color="fg.muted"
            pl={4}
            style={{ listStyleType: "disc" }}
            gap={1}
          >
            <List.Item>
              <Text as="span" fontFamily="mono">
                ZOHO_CLIENT_ID
              </Text>
              ,{" "}
              <Text as="span" fontFamily="mono">
                ZOHO_CLIENT_SECRET
              </Text>
            </List.Item>
            <List.Item>
              <Text as="span" fontFamily="mono">
                ZOHO_MAIL_REFRESH_TOKEN
              </Text>{" "}
              (Mail scopes)
            </List.Item>
          </List.Root>
          {email?.dnsHint ? (
            <Text fontSize="sm" color="fg.muted" mt={3}>
              Deliverability: {email.dnsHint}
            </Text>
          ) : null}
        </Box>
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title="WhatsApp Cloud API"
        badges={
          <>
            <StatusBadge
              ok={Boolean(whatsapp?.configured)}
              okLabel="API configured"
              failLabel="API not set"
            />
            <StatusBadge
              ok={Boolean(whatsapp?.webhookVerifyTokenConfigured)}
              okLabel="Verify token set"
              failLabel="Verify token missing"
            />
            <StatusBadge
              ok={Boolean(whatsapp?.appSecretConfigured)}
              okLabel="App secret set"
              failLabel="App secret missing"
            />
          </>
        }
      >
        <Text fontSize="sm" color="fg.muted" mb={4}>
          Credentials and bot copy for Leads WhatsApp and Communication → WhatsApp.
          Register the webhook URL in Meta Developer Console with the verify token below.
        </Text>

        <Stack gap={3} maxW="560px">
          <Field.Root>
            <Field.Label>Webhook URL</Field.Label>
            <Input value={webhookUrl} readOnly fontFamily="mono" fontSize="sm" />
            <Field.HelperText>
              Meta → WhatsApp → Configuration → Webhook callback URL.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Phone number ID</Field.Label>
            <Input
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              placeholder="From Meta WhatsApp → API Setup"
              fontFamily="mono"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Access token</Field.Label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={
                whatsapp?.accessTokenConfigured
                  ? "Leave blank to keep current token"
                  : "Paste permanent access token"
              }
              autoComplete="new-password"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>App secret</Field.Label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={
                whatsapp?.appSecretConfigured
                  ? "Leave blank to keep current secret"
                  : "Meta App Settings → Basic → App Secret"
              }
              autoComplete="new-password"
            />
            <Field.HelperText>
              Required for webhook signature verification when WhatsApp is enabled.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Webhook verify token</Field.Label>
            <Input
              value={webhookVerifyToken}
              onChange={(e) => setWebhookVerifyToken(e.target.value)}
              placeholder="Long random string you invent"
              fontFamily="mono"
            />
            <Field.HelperText>
              Must match the verify token you enter in Meta when registering the webhook.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Click-to-chat URL (optional)</Field.Label>
            <Input
              value={clickToChatUrl}
              onChange={(e) => setClickToChatUrl(e.target.value)}
              placeholder="https://wa.me/2547XXXXXXXX"
            />
            <Field.HelperText>
              Shown on the public lead form when set.
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Welcome message</Field.Label>
            <Textarea
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              rows={3}
              placeholder="Welcome to Starlynx! What are you interested in?"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Completion message</Field.Label>
            <Textarea
              value={completeMessage}
              onChange={(e) => setCompleteMessage(e.target.value)}
              rows={3}
              placeholder="Thanks! Our sales team will contact you shortly."
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Outbound template name</Field.Label>
            <Input
              value={outboundTemplate}
              onChange={(e) => setOutboundTemplate(e.target.value)}
              placeholder="starlynx_outreach"
            />
            <Field.HelperText>
              Approved Meta template for agent-initiated / outside-24h messages
              (body param {"{{1}}"} = message text).
            </Field.HelperText>
          </Field.Root>
          <Field.Root>
            <Field.Label>Template language</Field.Label>
            <Input
              value={outboundTemplateLang}
              onChange={(e) => setOutboundTemplateLang(e.target.value)}
              placeholder="en"
              maxW="120px"
            />
          </Field.Root>
          <Button
            colorPalette="brand"
            alignSelf="flex-start"
            loading={savingWhatsApp}
            onClick={() => void saveWhatsApp()}
          >
            Save WhatsApp settings
          </Button>
        </Stack>
      </SettingsAccordionSection>
    </Stack>
  );
}

function WebhooksPanel({ settings }: { settings: AppSettings }) {
  const webhooks = settings.webhooks;
  const integrations = settings.integrations;
  if (!webhooks?.mpesa || !webhooks?.zoho || !webhooks?.leads || !integrations) {
    return (
      <Text fontSize="sm" color="red.600">
        Webhook settings payload is incomplete. Refresh the page.
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      <SettingsAccordionSection title="M-Pesa callbacks" defaultOpen>
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
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title="Zoho Books webhook"
        badges={
          <StatusBadge
            ok={webhooks.zoho.secretConfigured}
            okLabel="Secret configured"
            failLabel="Secret not set"
          />
        }
      >
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
      </SettingsAccordionSection>

      <SettingsAccordionSection
        title="Lead generation"
        badges={
          <>
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
          </>
        }
      >
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Public intake form and embeddable widget for prospects. Configure WhatsApp
          Cloud API credentials under Settings → Communication. Register the webhook
          URL in Meta with the verify token saved there.
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
      </SettingsAccordionSection>

      <SettingsAccordionSection title="Integration flags">
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
      </SettingsAccordionSection>
    </Stack>
  );
}

function RolesPanel({ settings }: { settings: AppSettings }) {
  return (
    <Box>
      <Text fontSize="sm" color="fg.muted" mb={3}>
        Assign when creating or editing users.
      </Text>
      <Stack gap={2}>
        {settings.roles?.map((role) => (
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

function formatVersionDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function VersioningPanel() {
  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Box>
        <Flex align="center" gap={2} mb={1} flexWrap="wrap">
          <Heading size="sm">Versioning log</Heading>
          <Badge colorPalette="blue" variant="subtle" size="sm">
            Current {CURRENT_APP_VERSION}
          </Badge>
        </Flex>
        <Text fontSize="sm" color="fg.muted">
          Feature releases for SUL Bix — new capabilities only, newest first.
        </Text>
      </Box>

      <Stack gap={3}>
        {VERSION_LOG.map((entry, index) => (
          <Box
            key={entry.version}
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            p={4}
            bg="bg.panel"
          >
            <Flex
              justify="space-between"
              align={{ base: "start", sm: "center" }}
              gap={2}
              mb={2}
              flexWrap="wrap"
            >
              <Flex align="center" gap={2} flexWrap="wrap">
                <Text fontWeight="semibold" fontSize="sm" fontFamily="mono">
                  v{entry.version}
                </Text>
                {index === 0 ? (
                  <Badge colorPalette="green" variant="subtle" size="sm">
                    Latest
                  </Badge>
                ) : null}
              </Flex>
              <Text fontSize="xs" color="fg.muted">
                {formatVersionDate(entry.date)}
              </Text>
            </Flex>
            <Text fontWeight="medium" fontSize="sm" mb={2}>
              {entry.title}
            </Text>
            <List.Root
              fontSize="sm"
              color="fg.muted"
              gap={1.5}
              pl={4}
              style={{ listStyleType: "disc" }}
            >
              {entry.features.map((feature) => (
                <List.Item key={feature} lineHeight="1.5">
                  {feature}
                </List.Item>
              ))}
            </List.Root>
          </Box>
        ))}
      </Stack>
    </Stack>
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
      { id: "communication", label: "Communication" },
      { id: "logs", label: "Logs" },
      { id: "synchronization", label: "Synchronization" },
      { id: "versioning", label: "Versioning" },
    ];
    return all.filter((tab) => {
      if (tab.id === "permissions" || tab.id === "webhooks" || tab.id === "communication")
        return canManageUsers(user);
      if (tab.id === "logs") return canAccessOps(user);
      if (tab.id === "synchronization") return canOperateFinance(user);
      if (tab.id === "versioning") return canManageUsers(user) || canOperateFinance(user);
      return false;
    });
  }, [user]);

  const activeTab: TabId =
    tabs.find((tab) => tab.id === tabParam)?.id ?? tabs[0]?.id ?? "permissions";

  const canLoadSettings = canManageUsers(user);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(canLoadSettings);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canLoadSettings) {
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    setError("");
    void api
      .getSettings()
      .then((res) => {
        if (!alive) return;
        setSettings(res);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load settings");
      })
      .finally(() => {
        // Always clear — never leave Webhooks/Communication spinning.
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [canLoadSettings]);

  function setTab(id: TabId) {
    const defaultTab = tabs[0]?.id;
    setSearchParams(id === defaultTab ? {} : { tab: id }, { replace: true });
  }

  const showSettingsLoading = canLoadSettings && !settings && loading;

  function retryLoad() {
    setLoading(true);
    setError("");
    void api
      .getSettings()
      .then((res) => setSettings(res))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load settings")
      )
      .finally(() => setLoading(false));
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
            <Stack gap={2}>
              {settings ? (
                <SettingsAccordionSection title="Role definitions" defaultOpen>
                  <RolesPanel settings={settings} />
                </SettingsAccordionSection>
              ) : showSettingsLoading ? (
                <Text fontSize="sm" color="fg.muted">
                  Loading role definitions…
                </Text>
              ) : (
                <Stack gap={2}>
                  <Text fontSize="sm" color="red.600">
                    {error || "Settings did not load."}
                  </Text>
                  <Button
                    size="sm"
                    variant="outline"
                    alignSelf="flex-start"
                    onClick={() => retryLoad()}
                  >
                    Retry
                  </Button>
                </Stack>
              )}
              <SettingsAccordionSection title="Users" defaultOpen={!settings}>
                <UsersPage embedded />
              </SettingsAccordionSection>
            </Stack>
          ) : null}

          {activeTab === "webhooks" ? (
            settings ? (
              <WebhooksPanel settings={settings} />
            ) : showSettingsLoading ? (
              <Text fontSize="sm" color="fg.muted">
                Loading webhook configuration…
              </Text>
            ) : (
              <Stack gap={2}>
                <Text fontSize="sm" color="red.600">
                  {error || "Settings did not load."}
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  alignSelf="flex-start"
                  onClick={() => retryLoad()}
                >
                  Retry
                </Button>
              </Stack>
            )
          ) : null}

          {activeTab === "communication" ? (
            settings ? (
              <CommunicationPanel
                settings={settings}
                onUpdated={setSettings}
              />
            ) : showSettingsLoading ? (
              <Text fontSize="sm" color="fg.muted">
                Loading communication settings…
              </Text>
            ) : (
              <Stack gap={2}>
                <Text fontSize="sm" color="red.600">
                  {error || "Settings did not load."}
                </Text>
                <Button
                  size="sm"
                  variant="outline"
                  alignSelf="flex-start"
                  onClick={() => retryLoad()}
                >
                  Retry
                </Button>
              </Stack>
            )
          ) : null}

          {activeTab === "logs" ? <LogsPage embedded /> : null}

          {activeTab === "synchronization" ? (
            <SynchronizationPage embedded />
          ) : null}

          {activeTab === "versioning" ? <VersioningPanel /> : null}
        </Box>
      </Box>
    </Stack>
  );
}
