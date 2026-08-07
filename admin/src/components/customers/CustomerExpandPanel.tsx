import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiRefreshCw, FiX } from "react-icons/fi";
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
import { summarizeOverdueZohoInvoices } from "../../lib/zohoInvoiceStatus";
import { formatCustomerPackageLabel, formatTitleCase } from "../../lib/formatText";
import { displayCustomerStatus, normalizeSubscriptionStatus } from "../../lib/customerStatus";
import {
  parseRetryAfterSeconds,
  SYNC_COOLDOWN_MS,
  useSyncCooldown,
} from "../../hooks/useSyncCooldown";
import { useTableSort } from "../../hooks/useTableSort";
import { sortRows } from "../../lib/tableSort";
import { DataTableLoadingSkeleton, TransactionExpandSkeleton } from "../PageSkeletons";
import { toaster } from "../ui/toaster";
import {
  CustomerActionMenu,
  type CustomerAction,
} from "./CustomerActionMenu";
import { TabStrip } from "../ui/TabStrip";
import { DataTable, DataTableSortHeader, dataTableCellProps, DataTableColumnHeader } from "../ui/DataTable";
import { TextStatus } from "../ui/TextStatus";
import { DetailCard, DetailGrid } from "../module/EntityExpandShell";
import { DstvSerialMissingBadge } from "./DstvSerialMissingBadge";
import { CatalogPackageMissingBadge } from "./CatalogPackageMissingBadge";

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
};

function narrationToneColor(tone: StatusTone) {
  if (tone === "ok") return "green.700";
  if (tone === "warn") return "orange.700";
  if (tone === "bad") return "red.700";
  return "fg";
}

function buildTispNarration(
  customer: Customer,
  integrations: CustomerIntegrationsSummary | null
): StatusNarration {
  // DSTV Only has no ISP bandwidth — never expected on TISP.
  if (
    customer.categoryCode === "dstv_only" ||
    customer.tispSyncStatus === "skipped" ||
    String(customer.productName || "")
      .toLowerCase()
      .includes("dstv only")
  ) {
    return {
      label: "TISP",
      text: "Not applicable — DSTV Only (no bandwidth). Billed in Zoho Books only.",
      tone: "ok",
    };
  }

  // "Internet expires" must be driven by the latest TISP-derived due date
  // (integration snapshot / TISP sync), not by any locally-estimated customer field.
  const due = integrations?.tispDueDate
    ? formatDateOnly(integrations.tispDueDate)
    : null;
  const dueLabel = due && due !== "—" ? due : null;
  const service = displayCustomerStatus(customer);

  // Cancelled first — archived numbers (ET-H302-CXL-237) are never on TISP.
  if (customer.status === "cancelled" || service.toLowerCase().includes("cancel")) {
    return {
      label: "Status",
      text: "Cancelled — churned and no longer counted as a current customer. TISP keeps the live apartment account for the new tenant.",
      tone: "bad",
    };
  }

  if (integrations && !integrations.onTisp) {
    return {
      label: "TISP",
      text: "Not on TISP yet — still on Books as Suspended until they are created and connected.",
      tone: "bad",
    };
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
    return {
      label: "Status",
      text: [
        pauseRange
          ? `Paused (away ${pauseRange}). Internet stopped; billing resumes after return.`
          : dueLabel
            ? `Paused at customer request (away). Internet stopped; due date ${dueLabel}.`
            : "Paused at customer request (away). Internet stopped until they return.",
        pauseNote,
        "Still counted as a customer.",
      ]
        .filter(Boolean)
        .join(" "),
      tone: "warn",
    };
  }
  if (statusLower.includes("suspend")) {
    return {
      label: "Status",
      text: dueLabel
        ? `Suspended — on Books but not active on TISP. Due date ${dueLabel}.`
        : "Suspended — on Books but not active on TISP (or service stopped).",
      tone: "warn",
    };
  }
  if (statusLower.includes("disconnect") || statusLower.includes("inactive")) {
    return {
      label: "TISP",
      text: dueLabel
        ? `Disconnected on TISP (shown as Suspended). Due date ${dueLabel}.`
        : "Disconnected on TISP (shown as Suspended).",
      tone: "warn",
    };
  }
  if (statusLower.includes("active")) {
    return {
      label: "TISP",
      text: dueLabel
        ? `Active on TISP and Books. Internet expires on ${dueLabel}.`
        : "Active on TISP and Books.",
      tone: "ok",
    };
  }

  return {
    label: "TISP",
    text: dueLabel
      ? `Status is ${service}. Due date is ${dueLabel}.`
      : `Status is ${service}.`,
    tone: "neutral",
  };
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
        text: "B2B customer — billing goes through the agency Zoho contact, not an individual contact.",
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
            ? `Former tenant — Zoho contact archived as ${archivedAs} (inactive). Invoices stay on that old contact.`
            : "Former tenant — Zoho contact is inactive/archived.",
          tone: "warn",
        },
      ];
    }
    return [
      {
        label: "Zoho",
        text: archivedAs
          ? `Cancelled in BIX as ${archivedAs}. Open the new active tenant and use Retry billing setup so Zoho renames this old contact and creates a fresh one for the new customer.`
          : "Cancelled in BIX. Open the new active tenant and use Retry billing setup to archive the old Zoho contact and create a new one.",
        tone: "warn",
      },
    ];
  }

  const rows: StatusNarration[] = [];

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Contact",
      text: "No Zoho contact was found for this customer.",
      tone: "bad",
    });
  } else if (integrations?.zohoInactive) {
    rows.push({
      label: "Contact",
      text: "Contact exists in Zoho but is inactive. Edit and save the customer to reactivate it.",
      tone: "warn",
    });
  } else {
    rows.push({
      label: "Contact",
      text: "Contact exists in Zoho and is active.",
      tone: "ok",
    });
  }

  const unpaidCount = zohoStatus?.unpaidCount ?? 0;
  const balanceDue = zohoStatus?.totalBalanceDue ?? 0;
  const invoiceCount =
    integrations?.invoiceCount ?? zohoStatus?.invoiceCount ?? 0;

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Invoice",
      text: "Cannot check invoices until a Zoho contact is linked.",
      tone: "neutral",
    });
  } else if (invoiceCount === 0) {
    rows.push({
      label: "Invoice",
      text: "No invoices found in Zoho for this customer.",
      tone: "warn",
    });
  } else if (unpaidCount > 0 || balanceDue > 0) {
    rows.push({
      label: "Invoice",
      text: `Customer has ${unpaidCount} overdue invoice${unpaidCount === 1 ? "" : "s"} totaling ${formatCurrency(balanceDue)}.`,
      tone: "bad",
    });
  } else {
    rows.push({
      label: "Invoice",
      text: "No overdue invoices — no outstanding invoice balance.",
      tone: "ok",
    });
  }

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Payment",
      text: "Cannot check payments until a Zoho contact is linked.",
      tone: "neutral",
    });
  } else if (unpaidCount > 0 || balanceDue > 0) {
    rows.push({
      label: "Payment",
      text: `Customer has overdue payments of ${formatCurrency(balanceDue)}.`,
      tone: "bad",
    });
  } else if (integrations && !integrations.paymentsInSync) {
    const zoho = integrations.zohoLastPaymentDate
      ? formatDateOnly(integrations.zohoLastPaymentDate)
      : "none";
    rows.push({
      label: "Payment",
      text: `Last payment is being aligned to Zoho (${zoho}). Refresh if this still looks wrong.`,
      tone: "warn",
    });
  } else if (integrations?.zohoLastPaymentDate || integrations?.lastPaymentDate) {
    const paid = formatDateOnly(
      integrations.zohoLastPaymentDate || integrations.lastPaymentDate
    );
    rows.push({
      label: "Payment",
      text: `Last payment on ${paid} (from Zoho). No outstanding payments.`,
      tone: "ok",
    });
  } else {
    rows.push({
      label: "Payment",
      text: "Customer has no outstanding payments.",
      tone: "ok",
    });
  }

  if (!integrations?.onZoho && !zohoStatus?.linked) {
    rows.push({
      label: "Recurring invoice",
      text: "Cannot check recurring billing until a Zoho contact is linked.",
      tone: "neutral",
    });
  } else if (integrations?.hasActiveRecurring) {
    rows.push({
      label: "Recurring invoice",
      text: integrations.nextRecurringDate
        ? `Recurring invoice is active. Next invoice date is ${formatDateOnly(integrations.nextRecurringDate)}.`
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

function StatusNarrationBlock({
  title,
  items,
  loading,
}: {
  title: string;
  items: StatusNarration[];
  loading?: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      px={3}
      py={3}
    >
      <Text fontWeight="bold" fontSize="sm" mb={2}>
        {title}
      </Text>
      {loading ? (
        <Text fontSize="sm" color="fg.muted">
          Checking status…
        </Text>
      ) : (
        <Stack gap={2.5}>
          {items.map((item, index) => {
            const showLabel =
              Boolean(item.label) &&
              item.label.trim().toLowerCase() !== title.trim().toLowerCase();
            return (
              <Box key={`${item.label}-${index}`}>
                {showLabel ? (
                  <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={0.5}>
                    {item.label}
                  </Text>
                ) : null}
                <Text fontSize="sm" color={narrationToneColor(item.tone)} lineHeight="1.45">
                  {item.text}
                </Text>
              </Box>
            );
          })}
        </Stack>
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
  } = useTableSort<"invoiceNumber" | "date" | "status" | "total" | "balanceDue">({
    sortBy: "date",
    sortDir: "desc",
  });
  const {
    sorts: paymentSorts,
    toggleSort: togglePaymentSort,
  } = useTableSort<"source" | "referenceId" | "amount" | "paidAt">({
    sortBy: "paidAt",
    sortDir: "desc",
  });

  const sortedInvoices = useMemo(
    () =>
      sortRows(zohoStatus?.invoices || [], invoiceSorts, {
        invoiceNumber: (invoice) => invoice.invoiceNumber,
        date: (invoice) => invoice.date,
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

  async function handleRetryBilling() {
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
      const res = await api.retryBillingOnboarding(customerId);
      setCustomer(res.customer);
      setZohoStatus(res.zoho);
      onCustomerUpdated?.(res.customer);

      const parts: string[] = [];
      const invoice = res.billing.invoice;
      if (invoice?.created && invoice.invoiceNumber) {
        parts.push(`Invoice ${invoice.invoiceNumber} created`);
      } else if (invoice?.reused && invoice.invoiceNumber) {
        parts.push(`Reused open invoice ${invoice.invoiceNumber}`);
      }
      if (invoice?.emailed) {
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

  const tispNarration = buildTispNarration(customer, integrations);
  const zohoNarrations = buildZohoNarrations(customer, integrations, zohoStatus);

  return (
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
              {formatTitleCase(customer.fullName)}
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
              {hidePricing ? `${customer.productMbps} Mbps` : formatCurrency(customer.packagePrice)}
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
          <Stack gap={3}>
            <StatusNarrationBlock
              title="TISP"
              items={[tispNarration]}
              loading={loading}
            />
            <StatusNarrationBlock
              title="Zoho"
              items={zohoNarrations}
              loading={integrationsLoading}
            />
          </Stack>
        </Box>

        <Box hidden={activeTab !== "package"}>
          <DetailGrid>
            <DetailCard
              label="Package"
              value={formatCustomerPackageLabel(customer.productName, customer.productMbps)}
              highlight
              span={{ base: "1 / -1", md: "span 1" }}
            />
            <DetailCard label="Customer number" value={customer.customerNumber} mono />
            <DetailCard
              label="Building"
              value={formatTitleCase(customer.buildingName)}
              span={{ base: "1 / -1", sm: "span 1" }}
            />
            <DetailCard label="Apartment number" value={customer.apartmentNumber} mono />
            <DetailCard label="Payment frequency" value={paymentFrequencyLabel} />
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
                  Replace the former Zoho contact to archive it as {customer.customerNumber?.replace(/-CXL-\d+$/i, "") || "the apartment number"}-CXL-… and create a fresh contact + signup invoice for this customer.
                </Text>
                <Button
                  mt={2}
                  size="sm"
                  colorPalette="orange"
                  loading={retryingBilling}
                  disabled={inCooldown}
                  onClick={() => void handleRetryBilling()}
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
              <DataTableLoadingSkeleton columns={5} rows={4} fill={false} showHeader={false} />
            ) : !zohoStatus?.linked ? (
              <Box textAlign="center">
                <EmptyState>
                  {customer.zohoBillingStatus === "completed"
                    ? "No Zoho contact linked for this customer"
                    : "Billing setup incomplete — Zoho contact not linked"}
                </EmptyState>
                {canRetryBilling ? (
                  <Button
                    mt={3}
                    size="sm"
                    colorPalette="brand"
                    loading={retryingBilling}
                    disabled={inCooldown}
                    onClick={() => void handleRetryBilling()}
                  >
                    {retryBillingLabel}
                  </Button>
                ) : null}
              </Box>
            ) : sortedInvoices.length === 0 ? (
              <Box textAlign="center">
                <EmptyState>
                  {customer.trialPeriodEnabled && customer.trialEndsAt
                    ? new Date(customer.trialEndsAt) >= new Date(new Date().toDateString())
                      ? `Trial active — first invoice scheduled ${formatDate(customer.trialEndsAt)}`
                      : "No invoices found for this customer"
                    : customer.zohoBillingStatus === "completed"
                      ? "No invoices found for this customer"
                      : "Billing setup incomplete — no signup invoice yet"}
                </EmptyState>
                {canRetryBilling ? (
                  <Button
                    mt={3}
                    size="sm"
                    colorPalette="brand"
                    loading={retryingBilling}
                    disabled={inCooldown}
                    onClick={() => void handleRetryBilling()}
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
                          {invoice.date ? formatDate(invoice.date) : "—"}
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
                        <DataTableSortHeader label="Date" column="date" sorts={invoiceSorts} onSort={toggleInvoiceSort} defaultDir="desc" />
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
                          {[payment.invoiceNumber, payment.paidAt ? formatDate(payment.paidAt) : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
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
                        <DataTableColumnHeader>Invoice</DataTableColumnHeader>
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
                          <Table.Cell {...dataTableCellProps} color="fg.muted">
                            {payment.invoiceNumber || "—"}
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
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="sm" color="fg.subtle" py={6} textAlign="center">
      {children}
    </Text>
  );
}
