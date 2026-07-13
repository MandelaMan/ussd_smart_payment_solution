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
import { FiCheck, FiClock, FiRefreshCw, FiX } from "react-icons/fi";
import {
  api,
  formatCurrency,
  formatDate,
  type Customer,
  type CustomerPayment,
  type CustomerZohoStatus,
  type ZohoInvoice,
} from "../../lib/api";
import { formatCustomerPackageLabel, formatTitleCase } from "../../lib/formatText";
import { displayCustomerStatus, normalizeSubscriptionStatus } from "../../lib/customerStatus";
import { useSyncCooldown } from "../../hooks/useSyncCooldown";
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
  >
): CustomerZohoStatus {
  const unpaid = invoices.filter((inv) => (inv.balanceDue || 0) > 0);
  const creditBalance = Number(billing?.creditBalance) || 0;
  return {
    linked,
    zohoContactId,
    invoices,
    invoiceCount: invoices.length,
    unpaidCount: unpaid.length,
    totalBalanceDue: unpaid.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0),
    creditBalance: creditBalance > 0 ? creditBalance : 0,
    billedViaAgency: billing?.billedViaAgency,
    agencyName: billing?.agencyName,
    billingNote: billing?.billingNote,
    lastSyncedAt: billing?.lastSyncedAt,
    fromSnapshot: billing?.fromSnapshot,
    cacheFresh: billing?.cacheFresh,
  };
}

type SyncChipState = "ok" | "failed" | "pending" | "unknown" | "loading";

function SyncChip({
  label,
  state,
  detail,
  statusLabel,
}: {
  label: string;
  state: SyncChipState;
  detail?: string | null;
  statusLabel?: string;
}) {
  const icon =
    state === "ok" ? (
      <FiCheck />
    ) : state === "failed" ? (
      <FiX />
    ) : state === "pending" || state === "loading" ? (
      <FiClock />
    ) : null;

  const color =
    state === "ok"
      ? "green.600"
      : state === "failed"
        ? "red.600"
        : state === "pending"
          ? "orange.600"
          : state === "loading"
            ? "gray.500"
          : "gray.400";

  const statusText =
    statusLabel ??
    (state === "ok"
      ? "Synced"
      : state === "failed"
        ? "Failed"
        : state === "pending"
          ? "Pending"
          : state === "loading"
            ? "Loading…"
            : "Not checked");

  return (
    <Flex
      align="center"
      gap={1.5}
      fontSize="xs"
      color={color}
      title={detail || undefined}
      minW={0}
      flexShrink={1}
    >
      <Text fontWeight="medium" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      {icon ? (
        <Box aria-hidden flexShrink={0}>{icon}</Box>
      ) : (
        <Box w="14px" h="14px" borderRadius="full" bg="gray.200" aria-hidden flexShrink={0} />
      )}
      <Text fontWeight="semibold" truncate maxW={{ base: "9rem", sm: "none" }}>
        {statusText}
      </Text>
    </Flex>
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
  const [loading, setLoading] = useState(true);
  const [zohoLoading, setZohoLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingBilling, setRetryingBilling] = useState(false);
  const { inCooldown, remainingSeconds, startCooldown } = useSyncCooldown(customerId);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [zohoStatus, setZohoStatus] = useState<CustomerZohoStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("package");
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
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
    setLoading(true);
    setZohoLoading(true);
    setError("");
    setActiveTab("package");
    setZohoStatus(null);
    setPayments([]);
    setPaymentsError("");
    setPaymentsLoading(false);
    paymentsLoadedRef.current = false;
    hasRevealedRef.current = false;

    void api
      .getCustomer(customerId)
      .then((res) => {
        if (cancelled) return;
        setCustomer(res.customer);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void api
      .getCustomerInvoices(customerId)
      .then((invoiceRes) => {
        if (cancelled) return;
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
            }
          )
        );
      })
      .catch(() => {
        if (cancelled) return;
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
        if (!cancelled) setZohoLoading(false);
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

  useEffect(() => {
    if (!customer || activeTab !== "payments" || paymentsLoadedRef.current) return;
    void loadPayments();
  }, [customer, activeTab, loadPayments]);

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
    try {
      const res = await api.refreshCustomer(customerId);
      setCustomer(res.customer);
      setZohoStatus(res.zoho);
      onCustomerUpdated?.(res.customer);

      paymentsLoadedRef.current = false;
      if (activeTab === "payments") {
        await loadPayments();
      }

      const tispStatus = normalizeSubscriptionStatus(res.customer.subscriptionStatus);
      const zohoSummary = res.zoho.linked
        ? `${res.zoho.invoiceCount} invoice${res.zoho.invoiceCount === 1 ? "" : "s"}${
            res.zoho.unpaidCount > 0
              ? `, ${res.zoho.unpaidCount} unpaid (${formatCurrency(res.zoho.totalBalanceDue)})`
              : ""
          }`
        : "No Zoho contact found";

      toaster.create({
        title: "Status refreshed",
        description: `TISP: ${tispStatus} · Zoho: ${zohoSummary}`,
        type: "success",
      });
    } catch (e) {
      toaster.create({
        title: "Refresh failed",
        description: e instanceof Error ? e.message : "Please try again",
        type: "error",
      });
    } finally {
      startCooldown();
      setRefreshing(false);
    }
  }

  const canRetryBilling =
    !readOnly &&
    customer?.customerType !== "B2B" &&
    customer?.status === "active" &&
    (customer.zohoBillingStatus === "pending" ||
      customer.zohoBillingStatus === "failed") &&
    !(zohoStatus?.linked && (zohoStatus.invoiceCount ?? 0) > 0) &&
    !zohoLoading;

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
    } catch (e) {
      toaster.create({
        title: "Billing onboarding failed",
        description: e instanceof Error ? e.message : "Please try again",
        type: "error",
      });
    } finally {
      startCooldown();
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

  const tispHealthy =
    customer.tispSyncStatus === "synced" ||
    Boolean(
      customer.subscriptionStatus &&
        normalizeSubscriptionStatus(customer.subscriptionStatus) !== "Not on TISP" &&
        customer.tispSyncStatus !== "pending"
    );

  const tispSyncState: SyncChipState =
    customer.tispSyncStatus === "synced" || tispHealthy
      ? "ok"
      : customer.tispSyncStatus === "failed"
        ? "failed"
        : "pending";

  const isB2B = customer.customerType === "B2B";

  const zohoLinkedOnly =
    !isB2B &&
    customer.zohoBillingStatus === "pending" &&
    Boolean(zohoStatus?.linked) &&
    (zohoStatus?.invoiceCount ?? 0) === 0;

  const zohoBillingHealthy =
    isB2B ||
    customer.zohoBillingStatus === "completed" ||
    Boolean(zohoStatus?.linked && (zohoStatus.invoiceCount ?? 0) > 0);

  const zohoSyncState: SyncChipState = isB2B
    ? "ok"
    : zohoLoading
      ? "loading"
      : customer.zohoBillingStatus === "failed"
        ? "failed"
        : zohoBillingHealthy && zohoStatus?.linked
          ? "ok"
          : zohoLinkedOnly
            ? "ok"
          : customer.zohoBillingStatus === "pending"
            ? "pending"
            : !zohoStatus
              ? "unknown"
              : zohoStatus.linked
                ? "ok"
                : "failed";

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
          <Flex align="center" gap={{ base: 2, sm: 4 }} mt={2.5} flexWrap="wrap">
            <SyncChip
              label="TISP"
              state={tispSyncState}
              detail={
                tispSyncState === "ok" && customer.tispSyncStatus === "failed"
                  ? customer.subscriptionStatus || "Verified on TISP"
                  : customer.tispSyncError
              }
            />
            <SyncChip
              label="Zoho"
              state={zohoSyncState}
              statusLabel={
                isB2B
                  ? "Not required"
                  : customer.zohoBillingStatus === "failed"
                    ? "Setup failed"
                    : zohoBillingHealthy && zohoStatus?.linked
                      ? "Synced"
                      : zohoLinkedOnly
                        ? "Linked"
                        : customer.zohoBillingStatus === "pending"
                          ? "Setup pending"
                          : customer.zohoBillingStatus === "completed" && zohoStatus?.linked
                            ? "Synced"
                            : undefined
              }
              detail={
                isB2B
                  ? "B2B customers are not Zoho Books contacts"
                  : customer.zohoBillingStatus === "failed"
                  ? customer.zohoBillingError || "Billing setup failed"
                  : zohoBillingHealthy && zohoStatus?.linked
                    ? `${zohoStatus.invoiceCount} invoice${zohoStatus.invoiceCount === 1 ? "" : "s"}`
                    : zohoLinkedOnly
                      ? "Zoho contact linked — no invoices synced to admin yet"
                      : customer.zohoBillingStatus === "pending"
                        ? "Initial invoice and recurring profile not configured in Zoho yet"
                        : zohoStatus?.linked
                          ? `${zohoStatus.invoiceCount} invoice${zohoStatus.invoiceCount === 1 ? "" : "s"}`
                          : zohoStatus
                            ? "Billing setup complete — refresh if contact not shown"
                            : undefined
              }
            />
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
                customer.customerType === "B2B"
                  ? customer.agencyName
                  : "— (C2B — billed to customer)"
              }
              span={{ base: "1 / -1", md: "span 1" }}
            />
            {!hidePricing ? (
              <DetailCard label="Package price" value={formatCurrency(customer.packagePrice)} />
            ) : null}
            {customer.hasDstv && (
              <DetailCard
                label="DSTV decoder serial"
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
              value={customer.lastPaymentDate ? formatDate(customer.lastPaymentDate) : null}
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
              value={customer.tispDueDate ? formatDate(customer.tispDueDate) : null}
              highlight={Boolean(customer.tispDueDate)}
            />
            <DetailCard
              label="Service status"
              value={displayCustomerStatus(customer)}
            />
            <DetailCard label="Uptime" value={null} />
            <DetailCard label="Last seen" value={null} />
            <DetailCard
              label="OLT / ONU"
              value={null}
              span={{ base: "1 / -1", lg: "span 1" }}
            />
            <DetailCard
              label="Signal / RX power"
              value={null}
              span={{ base: "1 / -1", sm: "span 1" }}
            />
            <DetailCard label="Online status" value={null} />
          </DetailGrid>
          <Text
            fontSize="2xs"
            color="fg.muted"
            mt={{ base: 2.5, md: 3 }}
            lineHeight="1.4"
            px={{ base: 0.5, md: 0 }}
          >
            Live uptime and OLT metrics will load from the network NMS when connected.
          </Text>
        </Box>

        <Box hidden={activeTab !== "contact"}>
          <DetailGrid columns={{ base: "1fr", sm: "1fr 1fr" }}>
            <DetailCard label="Phone" value={customer.phone} highlight />
            <DetailCard
              label="Email"
              value={customer.email}
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
                    Retry billing setup
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
                    Retry billing setup
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
