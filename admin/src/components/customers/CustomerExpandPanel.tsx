import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  IconButton,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  FiAlertTriangle,
  FiCalendar,
  FiCheckCircle,
  FiCreditCard,
  FiFileText,
  FiInfo,
  FiRefreshCw,
  FiRepeat,
  FiUser,
  FiWifi,
  FiX,
  FiXCircle,
} from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import {
  api,
  ApiError,
  formatCurrency,
  formatDate,
  formatDateOnly,
  type Customer,
  type CustomerPayment,
  type CustomerZohoStatus,
  type ZohoInvoice,
} from "../../lib/api";
import {
  isOverdueZohoInvoice,
  summarizeOverdueZohoInvoices,
} from "../../lib/zohoInvoiceStatus";
import { formatCustomerPackageLabel, formatTitleCase } from "../../lib/formatText";
import { customerDisplayTitle, isShopPremise } from "../../lib/premise";
import { displayCustomerStatus, normalizeSubscriptionStatus } from "../../lib/customerStatus";
import { pauseAwayDays, pauseCreditLabel } from "../../lib/pauseCredit";
import {
  parseRetryAfterSeconds,
  SYNC_COOLDOWN_MS,
  useSyncCooldown,
} from "../../hooks/useSyncCooldown";
import { useTableSort } from "../../hooks/useTableSort";
import { sortRows } from "../../lib/tableSort";
import { DataTableLoadingSkeleton, TransactionExpandSkeleton } from "../PageSkeletons";
import { SkeletonBlock } from "../ui/SkeletonBlock";
import { toaster } from "../ui/toaster";
import {
  CustomerActionMenu,
  type CustomerAction,
} from "./CustomerActionMenu";
import { TabStrip } from "../ui/TabStrip";
import { DataTable, DataTableSortHeader, dataTableCellProps } from "../ui/DataTable";
import { TextStatus } from "../ui/TextStatus";
import { DetailCard, DetailGrid } from "../module/EntityExpandShell";
import { DstvSerialMissingBadge } from "./DstvSerialMissingBadge";
import { CatalogPackageMissingBadge } from "./CatalogPackageMissingBadge";
import { AppDialog } from "../ui/AppDialog";
import { SelectField } from "../ui/SelectField";
import {
  extraTvCount,
  extraTvFee,
  EXTRA_TV_UNIT_FEE,
  packageIncludesTv,
} from "../../lib/extraTv";

type Props = {
  customerId: number;
  onAction: (customer: Customer, action: CustomerAction) => void;
  onClose?: () => void;
  onCustomerUpdated?: (customer: Customer) => void;
  readOnly?: boolean;
  allowPermanentDelete?: boolean;
  hidePricing?: boolean;
  hideFinancials?: boolean;
};

const ALL_TABS = [
  { id: "status", label: "Status" },
  { id: "package", label: "Package" },
  { id: "connection", label: "Connection" },
  { id: "contact", label: "Contact info" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
] as const;

type TabId = (typeof ALL_TABS)[number]["id"];

const SOURCE_LABELS: Record<string, string> = {
  mpesa: "M-Pesa",
  zoho: "Zoho",
  tisp: "TISP",
};

const SOURCE_COLORS: Record<string, string> = {
  mpesa: "brand",
  zoho: "blue",
  tisp: "teal",
};

const expandPanelMotion = {
  animation: "customer-expand-in 0.3s ease-out",
  "@keyframes customer-expand-in": {
    from: { opacity: 0, transform: "translateY(-8px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
} as const;

function scrollPanelIntoView(el: HTMLElement | null) {
  if (!el) return;
  window.requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function pauseCreditDaysFor(customer: Customer): number {
  if (customer.pauseCreditDays != null && customer.pauseCreditDays > 0) {
    return customer.pauseCreditDays;
  }
  return pauseAwayDays(customer.pauseStartDate, customer.pauseEndDate);
}

function formatPauseCreditDetail(customer: Customer): string | null {
  const days = pauseCreditDaysFor(customer);
  if (days <= 0 && !customer.pauseStartDate) return null;
  const away =
    customer.pauseStartDate && customer.pauseEndDate
      ? `Away ${formatDateOnly(customer.pauseStartDate)} → ${formatDateOnly(customer.pauseEndDate)}`
      : null;
  if (days <= 0) return away;
  const credited = customer.pauseCreditAppliedAt
    ? `${pauseCreditLabel(days)} added to the last subscription`
    : `${pauseCreditLabel(days)} will be added to the next subscription`;
  const due =
    !customer.pauseCreditAppliedAt && customer.pauseCreditedDueDate
      ? `next due ${formatDateOnly(customer.pauseCreditedDueDate)}`
      : null;
  return [credited, away, due].filter(Boolean).join(" · ");
}

function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

function buildZohoStatusFromInvoices(
  invoices: ZohoInvoice[],
  linked: boolean,
  zohoContactId: string | null = null,
  billing?: Pick<
    CustomerZohoStatus,
    | "billedViaAgency"
    | "agencyName"
    | "billingNote"
    | "lastSyncedAt"
    | "fromSnapshot"
    | "cacheFresh"
    | "creditBalance"
    | "hasFormerTenantInvoices"
    | "formerTenantInvoiceCount"
  >
): CustomerZohoStatus {
  const { overdueCount, totalOverdueBalance } = summarizeOverdueZohoInvoices(invoices);
  const creditBalance = Number(billing?.creditBalance) || 0;
  return {
    linked,
    zohoContactId,
    invoices,
    invoiceCount: invoices.length,
    unpaidCount: overdueCount,
    totalBalanceDue: totalOverdueBalance,
    creditBalance: creditBalance > 0 ? creditBalance : 0,
    hasFormerTenantInvoices: billing?.hasFormerTenantInvoices === true,
    formerTenantInvoiceCount: Number(billing?.formerTenantInvoiceCount) || 0,
    billedViaAgency: billing?.billedViaAgency,
    agencyName: billing?.agencyName,
    billingNote: billing?.billingNote,
    lastSyncedAt: billing?.lastSyncedAt,
    fromSnapshot: billing?.fromSnapshot,
    cacheFresh: billing?.cacheFresh,
  };
}

type CustomerIntegrationsSummary = Awaited<
  ReturnType<typeof api.getCustomerIntegrations>
>;

type CustomerOltStatus = Awaited<ReturnType<typeof api.getCustomerOltStatus>> & {
  checkedAt?: string;
};

function formatOnuPhaseStatus(phase: string | null | undefined): string | null {
  if (!phase) return null;
  const key = String(phase).trim().toLowerCase();
  const map: Record<string, string> = {
    working: "Online",
    offline: "Offline",
    los: "Signal loss",
    dyinggasp: "Power loss",
    authfail: "Auth failed",
    logging: "Connecting…",
    syncmib: "Syncing…",
  };
  return map[key] || phase;
}

function formatOnuAdminStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const key = String(status).trim().toUpperCase();
  if (key === "ENABLE") return "Active";
  if (key === "DISABLE") return "Disabled on OLT";
  return status;
}

function formatOnuLabel(description: string | null | undefined): string | null {
  const raw = String(description || "").trim();
  if (!raw) return null;
  // Descriptions often look like "GPON0/1:2--TEJ-CAFE"
  const parts = raw.split(/--+/);
  const label = (parts[parts.length - 1] || raw).replace(/^[-:\s]+/, "").trim();
  return label || raw;
}

function formatOpticalDistance(rtt: number | null | undefined): string | null {
  if (rtt == null || Number.isNaN(Number(rtt))) return null;
  const n = Number(rtt);
  if (n <= 0) return null;
  return `${n} m`;
}

function formatOltSkipReason(reason: string | null | undefined): string {
  switch (reason) {
    case "no_building_olt_host":
    case "no_olts_configured":
      return "No OLT on building";
    case "no_olt_credentials":
      return "OLT login not set";
    case "no_olt_mac":
      return "OLT not configured";
    default:
      return "Not linked";
  }
}

type StatusTone = "ok" | "warn" | "bad" | "neutral";

type StatusNarration = {
  label: string;
  text: string;
  tone: StatusTone;
  detail?: string | null;
};

function narrationToneColor(tone: StatusTone) {
  if (tone === "ok") return "green.700";
  if (tone === "warn") return "orange.700";
  if (tone === "bad") return "red.700";
  return "fg";
}

const TONE_STYLES: Record<
  StatusTone,
  {
    accent: string;
    iconBg: string;
    iconColor: string;
    badgeBg: string;
    badgeColor: string;
    badgeLabel: string;
    border: string;
  }
> = {
  ok: {
    accent: "green.500",
    iconBg: "green.50",
    iconColor: "green.600",
    badgeBg: "green.50",
    badgeColor: "green.700",
    badgeLabel: "Good",
    border: "green.100",
  },
  warn: {
    accent: "orange.400",
    iconBg: "orange.50",
    iconColor: "orange.600",
    badgeBg: "orange.50",
    badgeColor: "orange.800",
    badgeLabel: "Attention",
    border: "orange.100",
  },
  bad: {
    accent: "red.500",
    iconBg: "red.50",
    iconColor: "red.600",
    badgeBg: "red.50",
    badgeColor: "red.700",
    badgeLabel: "Issue",
    border: "red.100",
  },
  neutral: {
    accent: "gray.400",
    iconBg: "gray.50",
    iconColor: "gray.500",
    badgeBg: "gray.50",
    badgeColor: "gray.600",
    badgeLabel: "Info",
    border: "border.muted",
  },
};

function narrationIcon(label: string): IconType {
  const key = label.trim().toLowerCase();
  if (key === "tisp" || key === "status" || key === "internet status") return FiWifi;
  if (key === "due date") return FiCalendar;
  if (key === "contact") return FiUser;
  if (key === "invoice") return FiFileText;
  if (key === "payment") return FiCreditCard;
  if (key.includes("recurring")) return FiRepeat;
  return FiInfo;
}

function toneBadgeIcon(tone: StatusTone): IconType {
  if (tone === "ok") return FiCheckCircle;
  if (tone === "warn") return FiAlertTriangle;
  if (tone === "bad") return FiXCircle;
  return FiInfo;
}

function formatInvoiceDateLabel(value: string | null | undefined): string | null {
  const formatted = value ? formatDateOnly(value) : null;
  return formatted && formatted !== "—" ? formatted : null;
}

function formatInvoiceDateDetail(invoice: ZohoInvoice | null | undefined): string | null {
  if (!invoice) return null;
  const sent = formatInvoiceDateLabel(invoice.date);
  const due = formatInvoiceDateLabel(invoice.dueDate);
  const parts: string[] = [];
  if (sent) parts.push(`Sent ${sent}`);
  if (due) parts.push(`Due ${due}`);
  return parts.length ? parts.join(" · ") : null;
}

function pickInvoiceForStatus(invoices: ZohoInvoice[]): ZohoInvoice | null {
  if (!invoices.length) return null;
  const overdue = invoices.filter(isOverdueZohoInvoice);
  if (overdue.length) {
    return [...overdue].sort(
      (a, b) =>
        new Date(a.dueDate || a.date || 0).getTime() -
        new Date(b.dueDate || b.date || 0).getTime()
    )[0];
  }
  return invoices[0];
}

function isTispDueDatePast(value: string | null | undefined): boolean {
  if (!value) return false;
  const s = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const due = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(s);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function buildTispDueNarration(
  dueLabel: string | null,
  expires: boolean,
  tone?: StatusTone
): StatusNarration {
  return {
    label: "Due date",
    text: dueLabel
      ? expires
        ? `Internet expires on ${dueLabel}.`
        : `Due date is ${dueLabel}.`
      : "No due date on TISP.",
    tone: tone ?? (dueLabel ? "ok" : "neutral"),
  };
}

function buildTispNarrations(
  customer: Customer,
  integrations: CustomerIntegrationsSummary | null
): StatusNarration[] {
  // DSTV Only has no ISP bandwidth — never expected on TISP.
  if (
    customer.categoryCode === "dstv_only" ||
    customer.tispSyncStatus === "skipped" ||
    String(customer.productName || "")
      .toLowerCase()
      .includes("dstv only")
  ) {
    return [
      {
        label: "Internet status",
        text: "DSTV Only — billed in Zoho, not TISP.",
        tone: "ok",
      },
    ];
  }

  // Due date must be driven by the latest TISP-derived due date
  // (integration snapshot / TISP sync), not by any locally-estimated customer field.
  const due = integrations?.tispDueDate
    ? formatDateOnly(integrations.tispDueDate)
    : null;
  const dueLabel = due && due !== "—" ? due : null;
  const service = displayCustomerStatus(customer);

  // Cancelled first — archived numbers (ET-H302-CXL-237) are never on TISP.
  if (customer.status === "cancelled" || service.toLowerCase().includes("cancel")) {
    return [
      {
        label: "TISP",
        text: "Cancelled. Apartment stays on TISP for the next tenant.",
        tone: "bad",
      },
    ];
  }

  if (integrations && !integrations.onTisp) {
    return [
      {
        label: "Internet status",
        text: "Not on TISP yet — still Suspended in Books.",
        tone: "bad",
      },
    ];
  }

  const statusLower = service.toLowerCase();
  if (statusLower.includes("pause")) {
    const pauseRange =
      customer.pauseStartDate && customer.pauseEndDate
        ? `${customer.pauseStartDate} → ${customer.pauseEndDate}`
        : null;
    const pauseNote = customer.pauseReason
      ? `Reason: ${customer.pauseReason}.`
      : null;
    const creditDays =
      customer.pauseCreditDays != null && customer.pauseCreditDays > 0
        ? customer.pauseCreditDays
        : pauseAwayDays(customer.pauseStartDate, customer.pauseEndDate);
    const creditApplied = Boolean(customer.pauseCreditAppliedAt);
    const creditText =
      creditDays > 0
        ? creditApplied
          ? `${pauseCreditLabel(creditDays)} from this pause were added to the last subscription.`
          : `${pauseCreditLabel(creditDays)} from this pause will be added to the next subscription${
              customer.pauseCreditedDueDate
                ? ` (next due ${formatDateOnly(customer.pauseCreditedDueDate)})`
                : ""
            }.`
        : null;
    return [
      {
        label: "Internet status",
        text: [
          pauseRange
            ? `Paused ${pauseRange}. Internet stopped until return.`
            : "Paused. Internet stopped until they return.",
          pauseNote,
        ]
          .filter(Boolean)
          .join(" "),
        tone: "warn",
      },
      ...(creditText
        ? [
            {
              label: "Pause credit",
              text: creditText,
              tone: creditApplied ? ("ok" as const) : ("warn" as const),
            },
          ]
        : []),
      buildTispDueNarration(dueLabel, false),
    ];
  }
  if (statusLower.includes("suspend")) {
    const overdue = Boolean(dueLabel) && isTispDueDatePast(integrations?.tispDueDate);
    return [
      {
        label: "Internet status",
        text: "Suspended — not active on TISP.",
        tone: overdue ? "bad" : "warn",
      },
      buildTispDueNarration(dueLabel, false, overdue ? "bad" : undefined),
    ];
  }
  if (statusLower.includes("disconnect") || statusLower.includes("inactive")) {
    return [
      {
        label: "Internet status",
        text: "Disconnected on TISP (shown as Suspended).",
        tone: "warn",
      },
      buildTispDueNarration(dueLabel, false),
    ];
  }
  if (statusLower.includes("active")) {
    const creditDays = pauseCreditDaysFor(customer);
    const creditPending = creditDays > 0 && !customer.pauseCreditAppliedAt;
    const creditApplied = creditDays > 0 && Boolean(customer.pauseCreditAppliedAt);
    return [
      {
        label: "Internet status",
        text: "Active on TISP and Books.",
        tone: "ok",
      },
      ...(creditPending || creditApplied
        ? [
            {
              label: "Pause credit",
              text: creditApplied
                ? `${pauseCreditLabel(creditDays)} from the last pause were added to this subscription.`
                : `${pauseCreditLabel(creditDays)} from the last pause will be added to the next subscription${
                    customer.pauseCreditedDueDate
                      ? ` (next due ${formatDateOnly(customer.pauseCreditedDueDate)})`
                      : ""
                  }.`,
              tone: creditApplied ? ("ok" as const) : ("warn" as const),
            },
          ]
        : []),
      buildTispDueNarration(dueLabel, true),
    ];
  }

  return [
    {
      label: "Internet status",
      text: `Status is ${service}.`,
      tone: "neutral",
    },
    buildTispDueNarration(dueLabel, false),
  ];
}

function buildZohoNarrations(
  customer: Customer,
  integrations: CustomerIntegrationsSummary | null,
  zohoStatus: CustomerZohoStatus | null
): StatusNarration[] {
  if (customer.customerType === "B2B" || integrations?.isB2B) {
    return [
      {
        label: "Zoho",
        text: "Billed through the agency Zoho contact.",
        tone: "ok",
      },
    ];
  }

  // Cancelled / former tenant — never show the live apartment contact as theirs.
  if (customer.status === "cancelled") {
    const archivedAs =
      integrations?.zohoCompanyName ||
      customer.customerNumber ||
      null;
    if (integrations?.formerTenantArchived || integrations?.zohoInactive) {
      return [
        {
          label: "Zoho",
          text: archivedAs
            ? `Archived as ${archivedAs} (inactive).`
            : "Former tenant contact is inactive.",
          tone: "warn",
        },
      ];
    }
    return [
      {
        label: "Zoho",
        text: archivedAs
          ? `Cancelled as ${archivedAs}. Retry billing from the new tenant.`
          : "Cancelled. Retry billing from the new tenant to archive this contact.",
        tone: "warn",
      },
    ];
  }

  const rows: StatusNarration[] = [];

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Contact",
      text: "No Zoho contact found.",
      tone: "bad",
    });
  } else if (integrations?.zohoInactive) {
    rows.push({
      label: "Contact",
      text: "Inactive. Edit and save to reactivate.",
      tone: "warn",
    });
  } else {
    rows.push({
      label: "Contact",
      text: "Active Zoho contact.",
      tone: "ok",
    });
  }

  const unpaidCount = zohoStatus?.unpaidCount ?? 0;
  const balanceDue = zohoStatus?.totalBalanceDue ?? 0;
  const invoiceCount =
    integrations?.invoiceCount ?? zohoStatus?.invoiceCount ?? 0;
  const statusInvoice = pickInvoiceForStatus(zohoStatus?.invoices || []);
  const invoiceDates = formatInvoiceDateDetail(statusInvoice);

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Invoice",
      text: "Link a contact to see invoices.",
      tone: "neutral",
    });
  } else if (invoiceCount === 0) {
    rows.push({
      label: "Invoice",
      text: "No invoices yet.",
      tone: "warn",
    });
  } else if (unpaidCount > 0 || balanceDue > 0) {
    rows.push({
      label: "Invoice",
      text: `${unpaidCount} overdue · ${formatCurrency(balanceDue)}.`,
      tone: "bad",
      detail: invoiceDates,
    });
  } else {
    rows.push({
      label: "Invoice",
      text: "No overdue invoices.",
      tone: "ok",
      detail: invoiceDates,
    });
  }

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Payment",
      text: "Link a contact to see payments.",
      tone: "neutral",
    });
  } else if (unpaidCount > 0 || balanceDue > 0) {
    rows.push({
      label: "Payment",
      text: `Overdue ${formatCurrency(balanceDue)}.`,
      tone: "bad",
    });
  } else if (integrations && !integrations.paymentsInSync) {
    const zoho = integrations.zohoLastPaymentDate
      ? formatDateOnly(integrations.zohoLastPaymentDate)
      : "none";
    rows.push({
      label: "Payment",
      text: `Aligning last payment to Zoho (${zoho}).`,
      tone: "warn",
    });
  } else if (integrations?.zohoLastPaymentDate || integrations?.lastPaymentDate) {
    const paid = formatDateOnly(
      integrations.zohoLastPaymentDate || integrations.lastPaymentDate
    );
    rows.push({
      label: "Payment",
      text: `Last payment ${paid}.`,
      tone: "ok",
    });
  } else {
    rows.push({
      label: "Payment",
      text: "No outstanding payments.",
      tone: "ok",
    });
  }

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Recurring invoice",
      text: "Link a contact to see recurring billing.",
      tone: "neutral",
    });
  } else if (integrations?.hasActiveRecurring) {
    rows.push({
      label: "Recurring invoice",
      text: integrations.nextRecurringDate
        ? `Active. Next invoice ${formatDateOnly(integrations.nextRecurringDate)}.`
        : "Recurring invoice is active.",
      tone: "ok",
    });
  } else if (
    integrations?.recurringStatus &&
    integrations.recurringStatus !== "missing"
  ) {
    rows.push({
      label: "Recurring invoice",
      text: `Recurring invoice is inactive (${integrations.recurringStatus}).`,
      tone: "warn",
    });
  } else {
    rows.push({
      label: "Recurring invoice",
      text: "Recurring invoice is not set.",
      tone: "bad",
    });
  }

  return rows;
}

function StatusTile({
  item,
  title,
  featured,
}: {
  item: StatusNarration;
  title: string;
  featured?: boolean;
}) {
  const tone = TONE_STYLES[item.tone];
  const Icon = narrationIcon(item.label || title);
  const BadgeIcon = toneBadgeIcon(item.tone);
  const showLabel =
    Boolean(item.label) &&
    item.label.trim().toLowerCase() !== title.trim().toLowerCase();
  const heading = featured && !showLabel ? null : item.label || title;

  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor={tone.border}
      borderRadius="lg"
      px={featured ? { base: 3, md: 3.5 } : { base: 2.5, md: 3 }}
      py={featured ? { base: 3, md: 3.5 } : { base: 2.5, md: 3 }}
      minW={0}
      h="full"
      position="relative"
      overflow="hidden"
      boxShadow="sm"
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        w: "3px",
        bg: tone.accent,
      }}
    >
      <Flex align="flex-start" gap={featured ? 3 : 2.5}>
        <Flex
          boxSize={featured ? "40px" : "32px"}
          borderRadius="lg"
          bg={tone.iconBg}
          color={tone.iconColor}
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon size={featured ? 18 : 15} />
        </Flex>
        <Box minW={0} flex="1">
          <Flex align="center" justify="space-between" gap={2} mb={1}>
            {heading ? (
              <Text
                fontSize="xs"
                fontWeight="semibold"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.04em"
                lineClamp={1}
              >
                {heading}
              </Text>
            ) : (
              <Box />
            )}
            <Flex
              align="center"
              gap={1}
              px={1.5}
              py={0.5}
              borderRadius="full"
              bg={tone.badgeBg}
              flexShrink={0}
            >
              <BadgeIcon size={11} />
              <Text fontSize="2xs" fontWeight="semibold" color={tone.badgeColor}>
                {tone.badgeLabel}
              </Text>
            </Flex>
          </Flex>
          <Text
            fontSize="sm"
            color={narrationToneColor(item.tone)}
            lineHeight="1.45"
          >
            {item.text}
          </Text>
          {item.detail ? (
            <Text fontSize="xs" color="fg.muted" mt={0.5} lineHeight="1.4">
              {item.detail}
            </Text>
          ) : null}
        </Box>
      </Flex>
    </Box>
  );
}

function StatusTileSkeleton() {
  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="lg"
      px={{ base: 2.5, md: 3 }}
      py={{ base: 2.5, md: 3 }}
      minW={0}
      h="full"
      position="relative"
      overflow="hidden"
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        w: "3px",
        bg: "gray.200",
      }}
    >
      <Flex align="flex-start" gap={2.5}>
        <SkeletonBlock boxSize="32px" borderRadius="lg" />
        <Box minW={0} flex="1">
          <Flex align="center" justify="space-between" gap={2} mb={2}>
            <SkeletonBlock height="11px" width="88px" />
            <SkeletonBlock height="18px" width="52px" borderRadius="full" />
          </Flex>
          <SkeletonBlock height="12px" width="92%" mb={1.5} />
          <SkeletonBlock height="12px" width="68%" />
        </Box>
      </Flex>
    </Box>
  );
}

function statusTileColumns(count: number) {
  return count <= 1 ? "1fr" : { base: "1fr", sm: "1fr 1fr" };
}

function StatusNarrationBlock({
  title,
  items,
  loading,
  featured,
  skeletonCount = 2,
}: {
  title: string;
  items: StatusNarration[];
  loading?: boolean;
  featured?: boolean;
  skeletonCount?: number;
}) {
  const tileCount = loading ? skeletonCount : items.length;
  const useFeatured = Boolean(featured) || tileCount <= 1;
  const columns = statusTileColumns(tileCount);

  return (
    <Box>
      <Text fontWeight="bold" fontSize="sm" mb={2}>
        {title}
      </Text>
      {loading ? (
        <Box
          display="grid"
          gridTemplateColumns={columns}
          gap={{ base: 2, md: 2.5 }}
          alignItems="stretch"
          w="full"
          minW={0}
        >
          {Array.from({ length: skeletonCount }, (_, index) => (
            <StatusTileSkeleton key={`${title}-skeleton-${index}`} />
          ))}
        </Box>
      ) : (
        <Box
          display="grid"
          gridTemplateColumns={columns}
          gap={{ base: 2, md: 2.5 }}
          alignItems="stretch"
          w="full"
          minW={0}
        >
          {items.map((item, index) => (
            <StatusTile
              key={`${item.label}-${index}`}
              item={item}
              title={title}
              featured={useFeatured}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function CustomerExpandPanel({
  customerId,
  onAction,
  onClose,
  onCustomerUpdated,
  readOnly = false,
  allowPermanentDelete = false,
  hidePricing = false,
  hideFinancials = false,
}: Props) {
  const tabs = useMemo(
    () =>
      hideFinancials
        ? ALL_TABS.filter((t) => t.id !== "invoices" && t.id !== "payments")
        : [...ALL_TABS],
    [hideFinancials]
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const hasRevealedRef = useRef(false);
  const paymentsLoadedRef = useRef(false);
  /** Bumps on refresh so in-flight mount fetches cannot overwrite fresh data. */
  const dataGenRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [zohoLoading, setZohoLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingBilling, setRetryingBilling] = useState(false);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false);
  const [removeExtraTvsOpen, setRemoveExtraTvsOpen] = useState(false);
  const [removingExtraTvs, setRemovingExtraTvs] = useState(false);
  const [paymentAlreadyMade, setPaymentAlreadyMade] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<"" | "mpesa" | "paystack" | "bank">("");
  const [mpesaCode, setMpesaCode] = useState("");
  const [paystackReference, setPaystackReference] = useState("");
  const [bankReference, setBankReference] = useState("");
  const { inCooldown, remainingSeconds, startCooldown } = useSyncCooldown(customerId);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [zohoStatus, setZohoStatus] = useState<CustomerZohoStatus | null>(null);
  const [integrations, setIntegrations] = useState<CustomerIntegrationsSummary | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("status");
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const [oltStatus, setOltStatus] = useState<CustomerOltStatus | null>(null);
  const [oltLoading, setOltLoading] = useState(false);
  const oltLoadedRef = useRef(false);
  const {
    sorts: invoiceSorts,
    toggleSort: toggleInvoiceSort,
  } = useTableSort<"invoiceNumber" | "date" | "dueDate" | "status" | "total" | "balanceDue">({
    sortBy: "date",
    sortDir: "desc",
  });
  const {
    sorts: paymentSorts,
    toggleSort: togglePaymentSort,
  } = useTableSort<"source" | "referenceId" | "amount" | "invoiceNumber" | "paidAt">({
    sortBy: "paidAt",
    sortDir: "desc",
  });

  const sortedInvoices = useMemo(
    () =>
      sortRows(zohoStatus?.invoices || [], invoiceSorts, {
        invoiceNumber: (invoice) => invoice.invoiceNumber,
        date: (invoice) => invoice.date,
        dueDate: (invoice) => invoice.dueDate,
        status: (invoice) => invoice.status,
        total: (invoice) => invoice.total,
        balanceDue: (invoice) => invoice.balanceDue,
      }),
    [zohoStatus?.invoices, invoiceSorts]
  );

  /** Former-tenant history still on the linked Zoho contact (hidden from the table). */
  const hasFormerTenantInvoices = Boolean(zohoStatus?.hasFormerTenantInvoices);

  const sortedPayments = useMemo(
    () =>
      sortRows(payments, paymentSorts, {
        source: (payment) => payment.source,
        referenceId: (payment) => payment.referenceId,
        amount: (payment) => payment.amount,
        invoiceNumber: (payment) => payment.invoiceNumber,
        paidAt: (payment) => payment.paidAt,
      }),
    [payments, paymentSorts]
  );

  useEffect(() => {
    let cancelled = false;
    const gen = dataGenRef.current;
    setLoading(true);
    setZohoLoading(true);
    setError("");
    setActiveTab("status");
    setZohoStatus(null);
    setIntegrations(null);
    setIntegrationsLoading(true);
    setPayments([]);
    setPaymentsError("");
    setPaymentsLoading(false);
    paymentsLoadedRef.current = false;
    setOltStatus(null);
    setOltLoading(false);
    oltLoadedRef.current = false;
    hasRevealedRef.current = false;

    const isStale = () => cancelled || dataGenRef.current !== gen;

    void api
      .getCustomer(customerId)
      .then((res) => {
        if (isStale()) return;
        setCustomer(res.customer);
      })
      .catch((e) => {
        if (isStale()) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!isStale()) setLoading(false);
      });

    void api
      .getCustomerInvoices(customerId)
      .then((invoiceRes) => {
        if (isStale()) return;
        setZohoStatus(
          buildZohoStatusFromInvoices(
            invoiceRes.invoices,
            invoiceRes.zohoLinked,
            invoiceRes.zohoContactId,
            {
              billedViaAgency: invoiceRes.billedViaAgency,
              agencyName: invoiceRes.agencyName,
              billingNote: invoiceRes.billingNote,
              lastSyncedAt: invoiceRes.lastSyncedAt,
              fromSnapshot: invoiceRes.fromSnapshot,
              cacheFresh: invoiceRes.cacheFresh,
              creditBalance: invoiceRes.creditBalance,
              hasFormerTenantInvoices: invoiceRes.hasFormerTenantInvoices,
              formerTenantInvoiceCount: invoiceRes.formerTenantInvoiceCount,
            }
          )
        );
      })
      .catch(() => {
        if (isStale()) return;
        setZohoStatus({
          linked: false,
          zohoContactId: null,
          invoices: [],
          invoiceCount: 0,
          unpaidCount: 0,
          totalBalanceDue: 0,
        });
      })
      .finally(() => {
        if (!isStale()) setZohoLoading(false);
      });

    void api
      .getCustomerIntegrations(customerId)
      .then((res) => {
        if (isStale()) return;
        setIntegrations(res);
      })
      .catch(() => {
        if (isStale()) return;
        setIntegrations(null);
      })
      .finally(() => {
        if (!isStale()) setIntegrationsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError("");
    try {
      const res = await api.getCustomerPayments(customerId, { limit: "50" });
      setPayments(res.payments);
      paymentsLoadedRef.current = true;
    } catch (e) {
      setPayments([]);
      setPaymentsError(e instanceof Error ? e.message : "Failed to load payments");
    } finally {
      setPaymentsLoading(false);
    }
  }, [customerId]);

  const loadOltStatus = useCallback(async () => {
    setOltLoading(true);
    try {
      const res = await api.getCustomerOltStatus(customerId);
      setOltStatus({ ...res, checkedAt: new Date().toISOString() });
      oltLoadedRef.current = true;
    } catch (e) {
      setOltStatus({
        ok: false,
        error: e instanceof Error ? e.message : "Failed to load OLT status",
        building: {
          host: null,
          port: null,
          mac: null,
          configured: false,
        },
        match: null,
        onu: null,
        linked: { buildingOltId: null, oltMac: null, onuIndexStr: null, onuSn: null },
        checkedAt: new Date().toISOString(),
      });
      oltLoadedRef.current = true;
    } finally {
      setOltLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!customer || activeTab !== "payments" || paymentsLoadedRef.current) return;
    void loadPayments();
  }, [customer, activeTab, loadPayments]);

  useEffect(() => {
    if (!customer || activeTab !== "connection" || oltLoadedRef.current) return;
    void loadOltStatus();
  }, [customer, activeTab, loadOltStatus]);

  async function handleRefresh() {
    if (inCooldown) {
      toaster.create({
        title: "Sync cooldown",
        description: `Try again in ${remainingSeconds} seconds`,
        type: "info",
      });
      return;
    }

    setRefreshing(true);
    const gen = ++dataGenRef.current;
    try {
      const res = await api.refreshCustomer(customerId);
      if (dataGenRef.current !== gen) return;

      setCustomer(res.customer);
      setZohoStatus(res.zoho);
      onCustomerUpdated?.(res.customer);

      try {
        const integ = await api.getCustomerIntegrations(customerId);
        if (dataGenRef.current === gen) {
          setIntegrations(integ);
          setIntegrationsLoading(false);
        }
      } catch {
        /* keep previous integrations summary */
      }

      if (dataGenRef.current !== gen) return;

      paymentsLoadedRef.current = false;
      if (activeTab === "payments") {
        await loadPayments();
      }

      const tispStatus = normalizeSubscriptionStatus(res.customer.subscriptionStatus);
      const zohoSummary = res.zoho.linked
        ? `${res.zoho.invoiceCount} invoice${res.zoho.invoiceCount === 1 ? "" : "s"}${
            res.zoho.unpaidCount > 0
              ? `, ${res.zoho.unpaidCount} overdue (${formatCurrency(res.zoho.totalBalanceDue)})`
              : ""
          }`
        : "No Zoho contact found";

      toaster.create({
        title: "Status refreshed",
        description: `TISP: ${tispStatus} · Zoho: ${zohoSummary}`,
        type: "success",
      });
      startCooldown();
    } catch (e) {
      if (dataGenRef.current !== gen) return;

      const message = e instanceof Error ? e.message : "Please try again";
      const isCooldown =
        (e instanceof ApiError && e.status === 429) ||
        /sync cooldown/i.test(message);
      const retryAfter = parseRetryAfterSeconds(message);

      if (isCooldown) {
        startCooldown(
          retryAfter != null ? retryAfter * 1000 : SYNC_COOLDOWN_MS
        );
        toaster.create({
          title: "Sync cooldown",
          description: message,
          type: "info",
        });
      } else {
        toaster.create({
          title: "Refresh failed",
          description: message,
          type: "error",
        });
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRemoveExtraTvs() {
    if (!customer) return;
    setRemovingExtraTvs(true);
    try {
      const res = await api.updateCustomerTvCount(customer.id, 1);
      setCustomer(res.customer);
      onCustomerUpdated?.(res.customer);
      setRemoveExtraTvsOpen(false);
      if (res.zoho?.ok === false) {
        toaster.create({
          title: "Extra TVs removed locally",
          description: `Zoho recurring update failed: ${res.zoho.error || "unknown error"}`,
          type: "warning",
          duration: 10000,
        });
      } else {
        toaster.create({
          title: "Extra TVs removed",
          description: "Recurring invoice no longer includes the Extra TV charge.",
          type: "success",
        });
      }
    } catch (e) {
      toaster.create({
        title: "Could not remove extra TVs",
        description: e instanceof Error ? e.message : "Please try again",
        type: "error",
      });
    } finally {
      setRemovingExtraTvs(false);
    }
  }

  const canRetryBilling =
    !readOnly &&
    customer?.customerType !== "B2B" &&
    customer?.status === "active" &&
    !zohoLoading &&
    (customer.zohoBillingStatus === "pending" ||
      customer.zohoBillingStatus === "failed" ||
      hasFormerTenantInvoices ||
      // Linked in Zoho but no invoices yet (signup invoice never created/sent)
      (Boolean(zohoStatus?.linked) &&
        (zohoStatus?.invoiceCount ?? 0) === 0 &&
        !customer.trialPeriodEnabled) ||
      // Not linked at all
      (!zohoStatus?.linked && customer.zohoBillingStatus !== "completed"));

  const retryBillingLabel = hasFormerTenantInvoices
    ? "Replace former Zoho contact"
    : "Retry billing setup";

  function openRetryBillingFlow() {
    if (inCooldown) {
      toaster.create({
        title: "Sync cooldown",
        description: `Try again in ${remainingSeconds} seconds`,
        type: "info",
      });
      return;
    }
    if (hasFormerTenantInvoices) {
      setPaymentAlreadyMade(true);
      setPaymentMethod("");
      setMpesaCode("");
      setPaystackReference("");
      setBankReference("");
      setReplaceDialogOpen(true);
      return;
    }
    void runRetryBilling();
  }

  async function runRetryBilling(options?: {
    paymentAlreadyMade?: boolean;
    paymentMethod?: "mpesa" | "paystack" | "bank";
    mpesaCode?: string;
    paystackReference?: string;
    bankReference?: string;
  }) {
    if (inCooldown) {
      toaster.create({
        title: "Sync cooldown",
        description: `Try again in ${remainingSeconds} seconds`,
        type: "info",
      });
      return;
    }

    setRetryingBilling(true);
    try {
      const res = await api.retryBillingOnboarding(customerId, options);
      setCustomer(res.customer);
      setZohoStatus(res.zoho);
      onCustomerUpdated?.(res.customer);
      setReplaceDialogOpen(false);

      const parts: string[] = [];
      const invoice = res.billing.invoice;
      if (invoice?.created && invoice.invoiceNumber) {
        parts.push(`Invoice ${invoice.invoiceNumber} created`);
      } else if (invoice?.reused && invoice.invoiceNumber) {
        parts.push(`Reused open invoice ${invoice.invoiceNumber}`);
      }
      if (options?.paymentAlreadyMade) {
        parts.push("marked paid (payment already made)");
      } else if (invoice?.emailed) {
        parts.push("emailed to customer");
      }
      if (res.billing.recurring?.created) {
        parts.push("recurring profile created");
      } else if (res.billing.recurring?.updated) {
        parts.push("recurring profile updated");
      }

      toaster.create({
        title: "Billing onboarding complete",
        description: parts.length > 0 ? parts.join(" · ") : "Zoho billing updated",
        type: "success",
      });
      startCooldown();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Please try again";
      const isCooldown =
        (e instanceof ApiError && e.status === 429) ||
        /sync cooldown/i.test(message);
      const retryAfter = parseRetryAfterSeconds(message);
      if (isCooldown) {
        startCooldown(
          retryAfter != null ? retryAfter * 1000 : SYNC_COOLDOWN_MS
        );
      }
      toaster.create({
        title: isCooldown ? "Sync cooldown" : "Billing onboarding failed",
        description: message,
        type: isCooldown ? "info" : "error",
      });
    } finally {
      setRetryingBilling(false);
    }
  }

  function confirmReplaceDialog() {
    if (paymentAlreadyMade) {
      if (!paymentMethod) {
        toaster.create({
          title: "Payment method required",
          description: "Select M-Pesa, Paystack, or Bank",
          type: "error",
        });
        return;
      }
      if (paymentMethod === "mpesa" && !/^[A-Z0-9]{8,15}$/i.test(mpesaCode.trim())) {
        toaster.create({
          title: "M-Pesa code required",
          description: "Enter a valid M-Pesa receipt code (8–15 letters/numbers)",
          type: "error",
        });
        return;
      }
      if (paymentMethod === "paystack" && !paystackReference.trim()) {
        toaster.create({
          title: "Paystack reference required",
          description: "Enter the Paystack / Zoho payment REFERENCE#",
          type: "error",
        });
        return;
      }
      void runRetryBilling({
        paymentAlreadyMade: true,
        paymentMethod,
        mpesaCode:
          paymentMethod === "mpesa" ? mpesaCode.trim().toUpperCase() : undefined,
        paystackReference:
          paymentMethod === "paystack" ? paystackReference.trim() : undefined,
        bankReference:
          paymentMethod === "bank" ? bankReference.trim() || undefined : undefined,
      });
      return;
    }
    void runRetryBilling({ paymentAlreadyMade: false });
  }

  const revealPanel = useCallback(() => {
    scrollPanelIntoView(panelRef.current);
  }, []);

  useEffect(() => {
    if (loading || hasRevealedRef.current) return;
    hasRevealedRef.current = true;
    const timer = window.setTimeout(revealPanel, 80);
    return () => clearTimeout(timer);
  }, [loading, revealPanel]);

  const shellProps = {
    ref: panelRef,
    scrollMarginTop: "1rem",
    scrollMarginBottom: "2rem",
    maxW: "100%" as const,
    minW: 0,
    overflowX: "hidden" as const,
    css: expandPanelMotion,
  };

  if (loading) {
    return (
      <Box {...shellProps}>
        <TransactionExpandSkeleton />
      </Box>
    );
  }

  if (error) {
    return (
      <Box {...shellProps}>
        <Box bg="red.50" borderRadius="md" px={4} py={3} fontSize="sm" color="red.700">
          {error}
        </Box>
      </Box>
    );
  }

  if (!customer) return null;

  const statusLabel = displayCustomerStatus(customer);

  const paymentFrequencyLabel =
    customer.paymentFrequency === "custom" && customer.customPeriodDays
      ? `Custom (${customer.customPeriodDays} days)`
      : customer.paymentFrequency;

  const tispNarrations = buildTispNarrations(customer, integrations);
  const zohoNarrations = buildZohoNarrations(customer, integrations, zohoStatus);

  return (
    <>
    <Box {...shellProps}>
      <Box
        bg="bg.panel"
        borderRadius="lg"
        border="1px solid"
        borderColor="brand.200"
        boxShadow="lg"
        overflow="hidden"
      >
      <Flex
        direction={{ base: "column", sm: "row" }}
        align={{ base: "stretch", sm: "start" }}
        justify="space-between"
        gap={{ base: 2, sm: 3 }}
        px={{ base: 2.5, sm: 4 }}
        py={{ base: 2.5, sm: 4 }}
        borderBottom="1px solid"
        borderColor="border.muted"
        minW={0}
      >
        <Box minW={0} flex="1" overflow="hidden">
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text
              fontSize={{ base: "lg", sm: "xl" }}
              fontWeight="bold"
              color="fg"
              lineHeight="1.2"
              textTransform="none"
              overflowWrap="anywhere"
            >
              {formatTitleCase(customerDisplayTitle(customer) || customer.fullName)}
            </Text>
            <TextStatus status={statusLabel} />
          </Flex>
        </Box>
        <Flex
          align="center"
          gap={2}
          flexShrink={0}
          flexWrap="wrap"
          justify={{ base: "space-between", sm: "flex-end" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Flex align="center" gap={2} minW={0}>
            <Badge
              colorPalette={customer.customerType === "C2B" ? "brand" : "blue"}
              variant="subtle"
            >
              {customer.customerType}
            </Badge>
            {isShopPremise(customer) ? (
              <Badge colorPalette="orange" variant="subtle">
                Shop
              </Badge>
            ) : null}
            {customer.customerType === "B2B" &&
            customer.agencyId &&
            customer.agencyName ? (
              <Box
                asChild
                fontSize="sm"
                color="blue.600"
                fontWeight="medium"
                textDecoration="underline"
                _hover={{ color: "blue.700" }}
                whiteSpace="nowrap"
                maxW={{ base: "140px", sm: "220px" }}
                overflow="hidden"
                textOverflow="ellipsis"
                title={formatTitleCase(customer.agencyName)}
              >
                <RouterLink to={`/agencies/${customer.agencyId}`}>
                  {formatTitleCase(customer.agencyName)}
                </RouterLink>
              </Box>
            ) : null}
            <Text fontWeight="bold" fontSize={{ base: "md", sm: "lg" }} color="fg" whiteSpace="nowrap">
              {hidePricing
                ? `${customer.productMbps + Number(customer.productExtraBandwidth || 0)} Mbps`
                : formatCurrency(customer.packagePrice)}
            </Text>
          </Flex>
          <Flex align="center" gap={1}>
            <IconButton
              aria-label={
                inCooldown
                  ? `Refresh available in ${remainingSeconds} seconds`
                  : "Refresh from Zoho"
              }
              title={
                inCooldown
                  ? `Available in ${remainingSeconds}s`
                  : "Refresh from Zoho (TISP + billing)"
              }
              variant="outline"
              size="sm"
              borderRadius="md"
              disabled={inCooldown}
              loading={refreshing}
              onClick={() => void handleRefresh()}
            >
              <FiRefreshCw />
            </IconButton>
            {!readOnly ? (
              <CustomerActionMenu
                customer={customer}
                onAction={onAction}
                allowPermanentDelete={allowPermanentDelete}
              />
            ) : null}
            {onClose ? (
              <IconButton
                aria-label="Close"
                variant="ghost"
                size="sm"
                onClick={onClose}
              >
                <FiX />
              </IconButton>
            ) : null}
          </Flex>
        </Flex>
      </Flex>

      {customer.catalogPackageMissing ? (
        <Box
          mx={{ base: 2.5, sm: 4 }}
          mb={2}
          px={2.5}
          py={2}
          bg="orange.50"
          border="1px solid"
          borderColor="orange.200"
          borderRadius="md"
        >
          <CatalogPackageMissingBadge />
        </Box>
      ) : null}

      {customer.dstvSerialMissing && (
        <Box
          mx={{ base: 2.5, sm: 4 }}
          mb={2}
          px={2.5}
          py={2}
          bg="orange.50"
          border="1px solid"
          borderColor="orange.200"
          borderRadius="md"
        >
          <DstvSerialMissingBadge />
        </Box>
      )}

      <TabStrip tabs={tabs} active={activeTab} onChange={(id) => setActiveTab(id as TabId)} />

      <Box p={{ base: 2.5, md: 4 }} minH={{ base: "auto", md: "280px" }} minW={0}>
        <Box hidden={activeTab !== "status"}>
          <Stack gap={{ base: 3, md: 4 }}>
            <StatusNarrationBlock
              title="TISP"
              items={tispNarrations}
              loading={integrationsLoading}
              skeletonCount={2}
            />
            <StatusNarrationBlock
              title="Zoho"
              items={zohoNarrations}
              loading={integrationsLoading || zohoLoading}
              skeletonCount={4}
            />
          </Stack>
        </Box>

        <Box hidden={activeTab !== "package"}>
          <DetailGrid>
            <DetailCard
              label="Package"
              value={formatCustomerPackageLabel(
                customer.productName,
                customer.productMbps,
                customer.productExtraBandwidth
              )}
              highlight
              span={{ base: "1 / -1", md: "span 1" }}
            />
            <DetailCard label="Customer number" value={customer.customerNumber} mono />
            <DetailCard
              label="Building"
              value={formatTitleCase(customer.buildingName)}
              span={{ base: "1 / -1", sm: "span 1" }}
            />
            {isShopPremise(customer) ? (
              <>
                <DetailCard
                  label="Business name"
                  value={customer.businessName || "—"}
                />
                <DetailCard
                  label="Shop location"
                  value={customer.shopLocation || "—"}
                />
                {customer.block ? (
                  <DetailCard label="Block" value={customer.block} />
                ) : null}
                <DetailCard
                  label="Unit code"
                  value={customer.apartmentNumber}
                  mono
                />
              </>
            ) : (
              <>
                <DetailCard label="Apartment number" value={customer.apartmentNumber} mono />
                {customer.block ? (
                  <DetailCard label="Block" value={customer.block} />
                ) : null}
              </>
            )}
            <DetailCard label="Payment frequency" value={paymentFrequencyLabel} />
            {formatPauseCreditDetail(customer) ? (
              <DetailCard
                label="Pause credit"
                value={formatPauseCreditDetail(customer)}
                highlight={!customer.pauseCreditAppliedAt}
                span={{ base: "1 / -1", md: "span 1" }}
              />
            ) : null}
            {customer.trialPeriodEnabled && customer.trialEndsAt ? (
              <DetailCard
                label="Trial period"
                value={
                  new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                    ? `Active — first invoice ${formatDate(customer.trialEndsAt)}`
                    : `Ended ${formatDate(customer.trialEndsAt)}`
                }
                highlight={
                  new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                }
                span={{ base: "1 / -1", lg: "span 1" }}
              />
            ) : null}
            <DetailCard
              label="Agency"
              value={
                customer.customerType === "B2B" ? (
                  customer.agencyId && customer.agencyName ? (
                    <Box
                      asChild
                      color="brand.600"
                      fontWeight="semibold"
                      textDecoration="underline"
                      _hover={{ color: "brand.700" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <RouterLink to={`/agencies/${customer.agencyId}`}>
                        {formatTitleCase(customer.agencyName)}
                      </RouterLink>
                    </Box>
                  ) : (
                    customer.agencyName || "—"
                  )
                ) : (
                  "— (C2B — billed to customer)"
                )
              }
              span={{ base: "1 / -1", md: "span 1" }}
            />
            {!hidePricing ? (
              <DetailCard label="Package price" value={formatCurrency(customer.packagePrice)} />
            ) : null}
            {packageIncludesTv(customer.categoryCode, customer.hasDstv) ? (
              <DetailCard
                label="Number of TVs"
                value={
                  extraTvCount(customer.tvCount) > 0 ? (
                    <Stack gap={2} align="flex-start">
                      <Text>
                        {customer.tvCount || 1} (
                        {extraTvCount(customer.tvCount)} extra ·{" "}
                        {formatCurrency(extraTvFee(customer.tvCount))})
                      </Text>
                      {!readOnly && customer.status === "active" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setRemoveExtraTvsOpen(true)}
                        >
                          Remove extra TVs
                        </Button>
                      ) : null}
                    </Stack>
                  ) : (
                    "1 (included)"
                  )
                }
              />
            ) : null}
            {customer.hasDstv && (
              <DetailCard
                label="DSTV IUC/Serial"
                value={customer.dstvDecoderSerial || "Not set — edit customer to add"}
                mono={Boolean(customer.dstvDecoderSerial)}
                highlight={!customer.dstvDecoderSerial}
                span={{ base: "1 / -1", lg: "span 1" }}
              />
            )}
            <DetailCard label="VAT exempt" value={customer.isVatExempt ? "Yes" : "No"} />
            <DetailCard label="Type" value={customer.customerType} />
            <DetailCard
              label="Last payment"
              value={
                integrations?.zohoLastPaymentDate ||
                integrations?.lastPaymentDate ||
                customer.lastPaymentDate
                  ? formatDateOnly(
                      integrations?.zohoLastPaymentDate ||
                        integrations?.lastPaymentDate ||
                        customer.lastPaymentDate
                    )
                  : null
              }
            />
            {!hideFinancials && (zohoStatus?.creditBalance || 0) > 0 ? (
              <DetailCard
                label="Overpayment"
                value={formatCurrency(zohoStatus!.creditBalance!)}
                highlight
              />
            ) : null}
          </DetailGrid>
        </Box>

        <Box hidden={activeTab !== "connection"}>
          <DetailGrid>
            <DetailCard
              label="IP address"
              value={customer.ipAddress}
              mono
              highlight={Boolean(customer.ipAddress)}
              span={{ base: "1 / -1", md: "span 1" }}
            />
            <DetailCard
              label="Due date"
              value={
                customer.tispDueDate
                  ? formatDateOnly(customer.tispDueDate)
                  : null
              }
              highlight={Boolean(customer.tispDueDate)}
            />
            <DetailCard
              label="Service status"
              value={displayCustomerStatus(customer)}
            />
            <DetailCard
              label="Line status"
              value={
                oltLoading
                  ? "Loading…"
                  : formatOnuPhaseStatus(oltStatus?.onu?.phaseStatus) ||
                    (oltStatus?.skipped
                      ? formatOltSkipReason(oltStatus.reason)
                      : oltStatus?.error
                        ? "Unavailable"
                        : oltStatus && !oltStatus.onu
                          ? "Not found on OLT"
                          : null)
              }
              highlight={oltStatus?.onu?.phaseStatus === "Working"}
            />
            <DetailCard
              label="OLT service"
              value={
                oltLoading
                  ? "Loading…"
                  : formatOnuAdminStatus(oltStatus?.onu?.adminStatus)
              }
              highlight={oltStatus?.onu?.adminStatus === "ENABLE"}
            />
            <DetailCard
              label="ONU label"
              value={
                oltLoading
                  ? "Loading…"
                  : formatOnuLabel(oltStatus?.onu?.description) || null
              }
              span={{ base: "1 / -1", md: "span 1" }}
            />
            <DetailCard
              label="Fiber distance"
              value={
                oltLoading
                  ? "Loading…"
                  : formatOpticalDistance(oltStatus?.onu?.onuRttDistance)
              }
            />
            <DetailCard
              label="Last checked"
              value={
                oltLoading
                  ? "Loading…"
                  : oltStatus?.checkedAt
                    ? formatRelativeTime(oltStatus.checkedAt)
                    : null
              }
            />
          </DetailGrid>
          <Flex
            mt={{ base: 2.5, md: 3 }}
            gap={2}
            align="center"
            justify="space-between"
            flexWrap="wrap"
          >
            <Text
              fontSize="2xs"
              color="fg.muted"
              lineHeight="1.4"
              px={{ base: 0.5, md: 0 }}
            >
              {oltStatus?.onu
                ? "Live status from the building OLT."
                : "Live ONU status loads from OLTs configured on this building."}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                oltLoadedRef.current = false;
                void loadOltStatus();
              }}
              loading={oltLoading}
            >
              <FiRefreshCw />
              Refresh status
            </Button>
          </Flex>
        </Box>

        <Box hidden={activeTab !== "contact"}>
          <DetailGrid columns={{ base: "1fr", sm: "1fr 1fr" }}>
            <DetailCard
              label="Phone"
              value={
                customer.phone ||
                (customer.customerType === "B2B" ? customer.agencyPhone : null) ||
                "—"
              }
              highlight
            />
            <DetailCard
              label="Email"
              value={
                customer.email ||
                (customer.customerType === "B2B" ? customer.agencyEmail : null) ||
                "—"
              }
              span={{ base: "1 / -1", sm: "span 1" }}
            />
          </DetailGrid>
        </Box>

        <Box hidden={activeTab !== "invoices"} minH="180px">
          <Box>
            {zohoStatus?.lastSyncedAt ? (
              <Text fontSize="xs" color="fg.muted" mb={2}>
                Last updated: {formatRelativeTime(zohoStatus.lastSyncedAt) || "—"}
                {zohoStatus.cacheFresh ? " (cached)" : ""}
              </Text>
            ) : null}
            {hasFormerTenantInvoices && canRetryBilling ? (
              <Box
                mb={2}
                px={2.5}
                py={2}
                bg="orange.50"
                border="1px solid"
                borderColor="orange.100"
                borderRadius="md"
              >
                <Text fontSize="xs" color="orange.900" fontWeight="medium">
                  {(zohoStatus?.formerTenantInvoiceCount || 0) > 0
                    ? `${zohoStatus?.formerTenantInvoiceCount} invoice${
                        (zohoStatus?.formerTenantInvoiceCount || 0) === 1 ? "" : "s"
                      } from the previous tenant are hidden — this apartment’s Zoho contact was reused.`
                    : "This apartment’s Zoho contact still belongs to the previous tenant."}
                </Text>
                <Text fontSize="xs" color="orange.800" mt={0.5}>
                  Archive the former Zoho contact as{" "}
                  {customer.customerNumber?.replace(/-CXL-\d+$/i, "") ||
                    "the apartment number"}
                  -CXL-… and create a fresh contact for this customer. If they
                  already paid, you will enter the payment reference — no new
                  invoice email is sent.
                </Text>
                <Button
                  mt={2}
                  size="sm"
                  colorPalette="orange"
                  loading={retryingBilling}
                  disabled={inCooldown}
                  onClick={() => openRetryBillingFlow()}
                >
                  {retryBillingLabel}
                </Button>
              </Box>
            ) : null}
            {customer.trialPeriodEnabled && customer.trialEndsAt ? (
              <Box
                mb={2}
                px={2.5}
                py={1.5}
                bg="purple.50"
                border="1px solid"
                borderColor="purple.100"
                borderRadius="md"
              >
                <Text fontSize="xs" color="purple.800" fontWeight="medium">
                  {new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                    ? "30-day trial active"
                    : "Trial period ended"}
                </Text>
                <Text fontSize="xs" color="purple.700" mt={0.5}>
                  {new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                    ? `No signup invoice — recurring billing starts ${formatDate(customer.trialEndsAt)}.`
                    : `First invoice was scheduled for ${formatDate(customer.trialEndsAt)}.`}
                </Text>
              </Box>
            ) : null}
            {zohoStatus?.billedViaAgency && (
              <Box
                mb={2}
                px={2.5}
                py={1.5}
                bg="blue.50"
                border="1px solid"
                borderColor="blue.100"
                borderRadius="md"
              >
                <Text fontSize="xs" color="blue.800" fontWeight="medium">
                  {zohoStatus.billingNote ||
                    `B2B — invoiced to agency ${zohoStatus.agencyName || "agency"}, not individually`}
                </Text>
              </Box>
            )}
            {zohoLoading ? (
              <DataTableLoadingSkeleton columns={6} rows={4} fill={false} showHeader={false} />
            ) : !zohoStatus?.linked ? (
              <Box textAlign="center">
                <EmptyState>
                  {customer.zohoBillingStatus === "completed"
                    ? "No Zoho contact linked for this customer"
                    : "Billing setup incomplete — Zoho contact not linked"}
                </EmptyState>
                {canRetryBilling && !hasFormerTenantInvoices ? (
                  <Button
                    mt={3}
                    size="sm"
                    colorPalette="brand"
                    loading={retryingBilling}
                    disabled={inCooldown}
                    onClick={() => openRetryBillingFlow()}
                  >
                    {retryBillingLabel}
                  </Button>
                ) : null}
              </Box>
            ) : sortedInvoices.length === 0 ? (
              <Box textAlign="center">
                <EmptyState>
                  {hasFormerTenantInvoices
                    ? "No invoices for this customer yet on a fresh Zoho contact."
                    : customer.trialPeriodEnabled && customer.trialEndsAt
                    ? new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                      ? `Trial active — first invoice scheduled ${formatDate(customer.trialEndsAt)}`
                      : "No invoices found for this customer"
                    : customer.zohoBillingStatus === "completed"
                      ? "No invoices found for this customer"
                      : "Billing setup incomplete — no signup invoice yet"}
                </EmptyState>
                {canRetryBilling && !hasFormerTenantInvoices ? (
                  <Button
                    mt={3}
                    size="sm"
                    colorPalette="brand"
                    loading={retryingBilling}
                    disabled={inCooldown}
                    onClick={() => openRetryBillingFlow()}
                  >
                    {retryBillingLabel}
                  </Button>
                ) : null}
              </Box>
            ) : (
              <>
                <Stack
                  gap={0}
                  divideY="1px"
                  divideColor="gray.100"
                  border="1px solid"
                  borderColor="border.muted"
                  borderRadius="md"
                  overflow="hidden"
                  display={{ base: "flex", lg: "none" }}
                  w="full"
                >
                  {sortedInvoices.map((invoice) => (
                    <Flex key={invoice.id} px={2.5} py={2} justify="space-between" gap={2} minW={0}>
                      <Box flex={1} minW={0}>
                        <Text fontSize="xs" fontWeight="semibold" color="brand.700" fontFamily="mono" lineClamp={1}>
                          {invoice.invoiceNumber || invoice.id}
                        </Text>
                        <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                          Sent {invoice.date ? formatDate(invoice.date) : "—"}
                          {" · "}
                          Due {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                        </Text>
                      </Box>
                      <Box textAlign="right" flexShrink={0}>
                        <Text fontSize="xs" fontWeight="semibold" whiteSpace="nowrap">
                          {invoice.balanceDue != null ? formatCurrency(invoice.balanceDue) : "—"}
                        </Text>
                        <Box mt={0.5} display="flex" justifyContent="flex-end">
                          <TextStatus status={invoice.status} />
                        </Box>
                      </Box>
                    </Flex>
                  ))}
                </Stack>
                <Box display={{ base: "none", lg: "block" }}>
                  <DataTable>
                    <Table.Header>
                      <Table.Row>
                        <DataTableSortHeader label="Invoice" column="invoiceNumber" sorts={invoiceSorts} onSort={toggleInvoiceSort} />
                        <DataTableSortHeader label="Date sent" column="date" sorts={invoiceSorts} onSort={toggleInvoiceSort} defaultDir="desc" />
                        <DataTableSortHeader label="Due date" column="dueDate" sorts={invoiceSorts} onSort={toggleInvoiceSort} defaultDir="desc" />
                        <DataTableSortHeader label="Status" column="status" sorts={invoiceSorts} onSort={toggleInvoiceSort} />
                        <DataTableSortHeader label="Total" column="total" sorts={invoiceSorts} onSort={toggleInvoiceSort} defaultDir="desc" />
                        <DataTableSortHeader label="Balance" column="balanceDue" sorts={invoiceSorts} onSort={toggleInvoiceSort} defaultDir="desc" />
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {sortedInvoices.map((invoice) => (
                        <Table.Row key={invoice.id} _hover={{ bg: "bg.subtle" }}>
                          <Table.Cell {...dataTableCellProps} fontFamily="mono" color="brand.700">
                            {invoice.invoiceNumber || invoice.id}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {invoice.date ? formatDate(invoice.date) : "—"}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps}>
                            <TextStatus status={invoice.status} />
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                            {invoice.total != null ? formatCurrency(invoice.total) : "—"}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {invoice.balanceDue != null ? formatCurrency(invoice.balanceDue) : "—"}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </DataTable>
                </Box>
              </>
            )}
          </Box>
        </Box>

        <Box hidden={activeTab !== "payments"} minH="180px">
          <Box>
            {paymentsLoading ? (
              <DataTableLoadingSkeleton columns={5} rows={4} fill={false} showHeader={false} />
            ) : paymentsError ? (
              <EmptyState>{paymentsError}</EmptyState>
            ) : payments.length === 0 ? (
              <EmptyState>No payments received for this customer</EmptyState>
            ) : (
              <>
                <Stack
                  gap={0}
                  divideY="1px"
                  divideColor="gray.100"
                  border="1px solid"
                  borderColor="border.muted"
                  borderRadius="md"
                  overflow="hidden"
                  display={{ base: "flex", lg: "none" }}
                  w="full"
                >
                  {sortedPayments.map((payment) => (
                    <Flex key={payment.id} px={2.5} py={2} justify="space-between" gap={2} minW={0}>
                      <Box flex={1} minW={0}>
                        <Flex align="center" gap={1.5} mb={0.5}>
                          <Badge
                            colorPalette={SOURCE_COLORS[payment.source] || "gray"}
                            variant="subtle"
                            fontSize="2xs"
                          >
                            {SOURCE_LABELS[payment.source] || payment.source}
                          </Badge>
                        </Flex>
                        <Text fontSize="xs" fontFamily="mono" color="brand.700" lineClamp={1}>
                          {payment.referenceId || "—"}
                        </Text>
                        <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                          {[
                            paymentAppliedInvoice(payment) || "No invoice",
                            payment.paidAt ? formatDate(payment.paidAt) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </Box>
                      <Text fontSize="xs" fontWeight="semibold" whiteSpace="nowrap" flexShrink={0}>
                        {payment.amount != null ? formatCurrency(payment.amount) : "—"}
                      </Text>
                    </Flex>
                  ))}
                </Stack>
                <Box display={{ base: "none", lg: "block" }}>
                  <DataTable>
                    <Table.Header>
                      <Table.Row>
                        <DataTableSortHeader label="Source" column="source" sorts={paymentSorts} onSort={togglePaymentSort} />
                        <DataTableSortHeader label="Reference" column="referenceId" sorts={paymentSorts} onSort={togglePaymentSort} />
                        <DataTableSortHeader label="Amount" column="amount" sorts={paymentSorts} onSort={togglePaymentSort} defaultDir="desc" />
                        <DataTableSortHeader label="Invoice" column="invoiceNumber" sorts={paymentSorts} onSort={togglePaymentSort} />
                        <DataTableSortHeader label="Date" column="paidAt" sorts={paymentSorts} onSort={togglePaymentSort} defaultDir="desc" />
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {sortedPayments.map((payment) => (
                        <Table.Row key={payment.id} _hover={{ bg: "bg.subtle" }}>
                          <Table.Cell {...dataTableCellProps}>
                            <Badge
                              colorPalette={SOURCE_COLORS[payment.source] || "gray"}
                              variant="subtle"
                            >
                              {SOURCE_LABELS[payment.source] || payment.source}
                            </Badge>
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} fontFamily="mono" color="brand.700">
                            {payment.referenceId || "—"}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                            {payment.amount != null ? formatCurrency(payment.amount) : "—"}
                          </Table.Cell>
                          <Table.Cell
                            {...dataTableCellProps}
                            fontFamily={paymentAppliedInvoice(payment) ? "mono" : undefined}
                            color={paymentAppliedInvoice(payment) ? "brand.700" : "fg.muted"}
                          >
                            {paymentAppliedInvoice(payment) || "None"}
                          </Table.Cell>
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {payment.paidAt ? formatDate(payment.paidAt) : "—"}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </DataTable>
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Box>
      </Box>
    </Box>

      <AppDialog
        open={removeExtraTvsOpen}
        onOpenChange={(details) => {
          if (!details.open && !removingExtraTvs) setRemoveExtraTvsOpen(false);
        }}
        maxW="sm"
        showCloseButton
      >
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border.muted"
          px={5}
          py={3.5}
          pr={12}
        >
          <Dialog.Title fontSize="lg">Remove extra TVs</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body px={5} py={4}>
          <Text fontSize="sm">
            This sets the account back to 1 TV and removes the Extra TV line
            ({formatCurrency(EXTRA_TV_UNIT_FEE)} each) from the recurring invoice.
            Existing invoices are not changed.
          </Text>
        </Dialog.Body>
        <Dialog.Footer px={5} py={4} borderTopWidth="1px" borderColor="border.muted" gap={2}>
          <Button
            variant="ghost"
            disabled={removingExtraTvs}
            onClick={() => setRemoveExtraTvsOpen(false)}
          >
            Keep extra TVs
          </Button>
          <Button
            colorPalette="brand"
            loading={removingExtraTvs}
            onClick={() => void handleRemoveExtraTvs()}
          >
            Remove extra TVs
          </Button>
        </Dialog.Footer>
      </AppDialog>

      <AppDialog
        open={replaceDialogOpen}
        onOpenChange={(details) => {
          if (!details.open && !retryingBilling) setReplaceDialogOpen(false);
        }}
        maxW="sm"
        showCloseButton
      >
        <Dialog.Header
          borderBottomWidth="1px"
          borderColor="border.muted"
          px={5}
          py={3.5}
          pr={12}
        >
          <Dialog.Title fontSize="lg">Replace former Zoho contact</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body px={5} py={4}>
          <Stack gap={3}>
            <Field.Root>
              <Field.Label>Has payment already been made?</Field.Label>
              <SelectField
                fieldProps={{
                  value: paymentAlreadyMade ? "yes" : "no",
                  onChange: (e) => {
                    const paid = e.target.value === "yes";
                    setPaymentAlreadyMade(paid);
                    if (!paid) {
                      setPaymentMethod("");
                      setMpesaCode("");
                      setPaystackReference("");
                      setBankReference("");
                    }
                  },
                }}
              >
                <option value="yes">Yes — already paid</option>
                <option value="no">No — create and email signup invoice</option>
              </SelectField>
            </Field.Root>

            {paymentAlreadyMade ? (
              <>
                <Field.Root required>
                  <Field.Label>Payment method</Field.Label>
                  <SelectField
                    fieldProps={{
                      value: paymentMethod,
                      onChange: (e) => {
                        const method = e.target.value as
                          | ""
                          | "mpesa"
                          | "paystack"
                          | "bank";
                        setPaymentMethod(method);
                        if (method !== "mpesa") setMpesaCode("");
                        if (method !== "paystack") setPaystackReference("");
                        if (method !== "bank") setBankReference("");
                      },
                    }}
                  >
                    <option value="">Select payment method…</option>
                    <option value="mpesa">M-Pesa</option>
                    <option value="paystack">Paystack</option>
                    <option value="bank">Direct Bank</option>
                  </SelectField>
                </Field.Root>

                {paymentMethod === "mpesa" ? (
                  <Field.Root required>
                    <Field.Label>Payment REFERENCE# (M-Pesa code)</Field.Label>
                    <Input
                      value={mpesaCode}
                      onChange={(e) =>
                        setMpesaCode(
                          e.target.value.toUpperCase().replace(/\s+/g, "")
                        )
                      }
                      placeholder="e.g. UH39A1LI2Y"
                      fontFamily="mono"
                      autoComplete="off"
                    />
                  </Field.Root>
                ) : null}

                {paymentMethod === "paystack" ? (
                  <Field.Root required>
                    <Field.Label>Paystack / Zoho payment REFERENCE#</Field.Label>
                    <Input
                      value={paystackReference}
                      onChange={(e) => setPaystackReference(e.target.value)}
                      placeholder="Paystack transaction or Zoho reference"
                      fontFamily="mono"
                      autoComplete="off"
                    />
                  </Field.Root>
                ) : null}

                {paymentMethod === "bank" ? (
                  <Field.Root>
                    <Field.Label>Bank transfer reference (optional)</Field.Label>
                    <Input
                      value={bankReference}
                      onChange={(e) => setBankReference(e.target.value)}
                      placeholder="Bank slip / transfer reference"
                      autoComplete="off"
                    />
                  </Field.Root>
                ) : null}
              </>
            ) : null}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer
          px={5}
          py={3}
          borderTopWidth="1px"
          borderColor="border.muted"
          gap={2}
        >
          <Button
            variant="ghost"
            disabled={retryingBilling}
            onClick={() => setReplaceDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            colorPalette="brand"
            loading={retryingBilling}
            onClick={() => confirmReplaceDialog()}
          >
            {paymentAlreadyMade
              ? "Replace contact & mark paid"
              : "Replace contact & email invoice"}
          </Button>
        </Dialog.Footer>
      </AppDialog>
    </>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="sm" color="fg.subtle" py={6} textAlign="center">
      {children}
    </Text>
  );
}

function paymentAppliedInvoice(payment: { invoiceNumber?: string | null }) {
  const value = String(payment.invoiceNumber || "").trim();
  return value || null;
}
