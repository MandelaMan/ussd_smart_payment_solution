import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiCheck, FiClock, FiRefreshCw, FiX } from "react-icons/fi";
import {
  api,
  formatCurrency,
  formatDate,
  type Customer,
  type CustomerEvent,
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
  { id: "contact", label: "Contact info" },
  { id: "activity", label: "Activity" },
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
    "billedViaAgency" | "agencyName" | "billingNote" | "lastSyncedAt" | "fromSnapshot" | "cacheFresh"
  >
): CustomerZohoStatus {
  const unpaid = invoices.filter((inv) => (inv.balanceDue || 0) > 0);
  return {
    linked,
    zohoContactId,
    invoices,
    invoiceCount: invoices.length,
    unpaidCount: unpaid.length,
    totalBalanceDue: unpaid.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0),
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
    >
      <Text fontWeight="medium" color="gray.600">
        {label}
      </Text>
      {icon ? (
        <Box aria-hidden>{icon}</Box>
      ) : (
        <Box w="14px" h="14px" borderRadius="full" bg="gray.200" aria-hidden />
      )}
      <Text fontWeight="semibold">{statusText}</Text>
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
  const [events, setEvents] = useState<CustomerEvent[]>([]);
  const [zohoStatus, setZohoStatus] = useState<CustomerZohoStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("package");
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState("");
  const {
    sorts: eventSorts,
    toggleSort: toggleEventSort,
  } = useTableSort<"eventType" | "createdAt">({ sortBy: "createdAt", sortDir: "desc" });
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

  const sortedEvents = useMemo(
    () =>
      sortRows(events, eventSorts, {
        eventType: (event) => event.eventType,
        createdAt: (event) => event.createdAt,
      }),
    [events, eventSorts]
  );

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
        setEvents(res.events);
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
      setEvents(res.events);
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
        customer.subscriptionStatus.toLowerCase() !== "unknown" &&
        customer.tispSyncStatus !== "pending"
    );

  const tispSyncState: SyncChipState =
    customer.tispSyncStatus === "synced" || tispHealthy
      ? "ok"
      : customer.tispSyncStatus === "failed"
        ? "failed"
        : "pending";

  const zohoLinkedOnly =
    customer.zohoBillingStatus === "pending" &&
    Boolean(zohoStatus?.linked) &&
    (zohoStatus?.invoiceCount ?? 0) === 0;

  const zohoBillingHealthy =
    customer.zohoBillingStatus === "completed" ||
    Boolean(zohoStatus?.linked && (zohoStatus.invoiceCount ?? 0) > 0);

  const zohoSyncState: SyncChipState = zohoLoading
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
        bg="white"
        borderRadius="lg"
        border="1px solid"
        borderColor="brand.200"
        boxShadow="lg"
        overflow="hidden"
      >
      <Flex
        align="start"
        justify="space-between"
        gap={3}
        px={4}
        py={4}
        borderBottom="1px solid"
        borderColor="gray.100"
      >
        <Box minW={0} flex="1">
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text fontSize="xl" fontWeight="bold" color="gray.900" lineHeight="1.2" textTransform="none">
              {formatTitleCase(customer.fullName)}
            </Text>
            <TextStatus status={statusLabel} />
          </Flex>
          <Flex align="center" gap={4} mt={2.5} flexWrap="wrap">
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
                customer.zohoBillingStatus === "failed"
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
                customer.zohoBillingStatus === "failed"
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
        <Flex align="center" gap={2} flexShrink={0} onClick={(e) => e.stopPropagation()}>
          <Badge
            colorPalette={customer.customerType === "C2B" ? "brand" : "blue"}
            variant="subtle"
          >
            {customer.customerType}
          </Badge>
          <Text fontWeight="bold" fontSize="lg" color="gray.900">
            {hidePricing ? `${customer.productMbps} Mbps` : formatCurrency(customer.packagePrice)}
          </Text>
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

      {customer.dstvSerialMissing && (
        <Box
          mx={4}
          mb={3}
          px={3}
          py={2.5}
          bg="orange.50"
          border="1px solid"
          borderColor="orange.200"
          borderRadius="md"
        >
          <DstvSerialMissingBadge />
        </Box>
      )}

      <TabStrip tabs={tabs} active={activeTab} onChange={(id) => setActiveTab(id as TabId)} />

      <Box p={4} minH="280px">
        <Box hidden={activeTab !== "package"}>
          <DetailGrid>
            <DetailCard
              label="Package"
              value={formatCustomerPackageLabel(customer.productName, customer.productMbps)}
              highlight
            />
            <DetailCard label="Customer number" value={customer.customerNumber} mono />
            <DetailCard label="Building" value={formatTitleCase(customer.buildingName)} />
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
              />
            ) : null}
            <DetailCard
              label="Agency"
              value={
                customer.customerType === "B2B"
                  ? customer.agencyName
                  : "— (C2B — billed to customer)"
              }
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
              />
            )}
            <DetailCard label="VAT exempt" value={customer.isVatExempt ? "Yes" : "No"} />
            <DetailCard
              label="Last payment"
              value={customer.lastPaymentDate ? formatDate(customer.lastPaymentDate) : null}
            />
          </DetailGrid>
        </Box>

        <Box hidden={activeTab !== "contact"}>
          <DetailGrid>
            <DetailCard label="Phone" value={customer.phone} highlight />
            <DetailCard label="Email" value={customer.email} />
            <DetailCard label="IP address" value={customer.ipAddress} mono />
            <DetailCard label="Customer type" value={customer.customerType} />
            <DetailCard label="Created" value={formatDate(customer.createdAt)} />
          </DetailGrid>
        </Box>

        <Box hidden={activeTab !== "activity"}>
          <Box>
            <SectionTitle>Recent activity</SectionTitle>
            {sortedEvents.length === 0 ? (
              <EmptyState>No activity recorded yet</EmptyState>
            ) : (
              <DataTable>
                <Table.Header>
                  <Table.Row>
                    <DataTableSortHeader label="Event" column="eventType" sorts={eventSorts} onSort={toggleEventSort} />
                    <DataTableSortHeader label="Date" column="createdAt" sorts={eventSorts} onSort={toggleEventSort} defaultDir="desc" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {sortedEvents.map((ev) => (
                    <Table.Row key={ev.id} _hover={{ bg: "gray.50" }}>
                      <Table.Cell {...dataTableCellProps} fontWeight="medium" textTransform="capitalize">
                        {ev.eventType.replace(/_/g, " ")}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="gray.600">
                        {formatDate(ev.createdAt)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            )}
          </Box>
        </Box>

        <Box hidden={activeTab !== "invoices"} minH="180px">
          <Box>
            {zohoStatus?.lastSyncedAt ? (
              <Text fontSize="xs" color="gray.500" mb={2}>
                Last updated: {formatRelativeTime(zohoStatus.lastSyncedAt) || "—"}
                {zohoStatus.cacheFresh ? " (cached)" : ""}
              </Text>
            ) : null}
            {customer.trialPeriodEnabled && customer.trialEndsAt ? (
              <Box
                mb={3}
                px={3}
                py={2}
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
                mb={3}
                px={3}
                py={2}
                bg="blue.50"
                border="1px solid"
                borderColor="blue.100"
                borderRadius="md"
              >
                <Text fontSize="xs" color="blue.800" fontWeight="medium">
                  B2B billing via {zohoStatus.agencyName || "agency"}
                </Text>
                <Text fontSize="xs" color="blue.700" mt={0.5}>
                  {zohoStatus.billingNote ||
                    "Invoices are issued to the managing agency, not this customer individually."}
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
                    <Table.Row key={invoice.id} _hover={{ bg: "gray.50" }}>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" color="brand.700">
                        {invoice.invoiceNumber || invoice.id}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="gray.600">
                        {invoice.date ? formatDate(invoice.date) : "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <TextStatus status={invoice.status} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        {invoice.total != null ? formatCurrency(invoice.total) : "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="gray.600">
                        {invoice.balanceDue != null ? formatCurrency(invoice.balanceDue) : "—"}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
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
                    <Table.Row key={payment.id} _hover={{ bg: "gray.50" }}>
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
                      <Table.Cell {...dataTableCellProps} color="gray.600">
                        {payment.invoiceNumber || "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="gray.600">
                        {payment.paidAt ? formatDate(payment.paidAt) : "—"}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            )}
          </Box>
        </Box>
      </Box>
      </Box>
    </Box>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text
      fontSize="sm"
      fontWeight="semibold"
      color="gray.800"
      mb={3}
    >
      {children}
    </Text>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Text fontSize="sm" color="gray.400" py={6} textAlign="center">
      {children}
    </Text>
  );
}
