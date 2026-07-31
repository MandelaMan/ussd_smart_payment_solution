import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Flex,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiAlertCircle, FiRefreshCw } from "react-icons/fi";
import {
  api,
  formatCurrency,
  formatDate,
  type Customer,
  type ReconciliationCustomerDetail,
  type ReconciliationCustomerRow,
} from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import {
  DetailCard,
  DetailGrid,
  EntityExpandShell,
} from "../module/EntityExpandShell";
import { TransactionExpandSkeleton } from "../PageSkeletons";
import { toaster } from "../ui/toaster";
import { TabStrip } from "../ui/TabStrip";
import { DataTable, dataTableCellProps, DataTableColumnHeader } from "../ui/DataTable";
import { ReconciliationStatusBadge } from "./ReconciliationStatusBadge";
import { ReconciliationSystemChecks } from "./ReconciliationSystemChecks";
import { TextStatus } from "../ui/TextStatus";

type Props = {
  customerId: number;
  /** List-row data for instant overview while detail loads. */
  initialRow?: ReconciliationCustomerRow;
  onActionComplete?: () => void;
};

function initialDetailFromRow(row: ReconciliationCustomerRow): ReconciliationCustomerDetail {
  return {
    ...row,
    customer: { customerType: row.customerType } as Customer,
    invoices: [],
    mpesaPayments: [],
    zohoPayments: [],
    recurringInvoices: [],
    validations: [],
    auditTrail: [],
    activityTrail: [],
    zohoError: null,
    tispError: null,
  };
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "timeline", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function MobileRecordList({
  children,
  empty,
}: {
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) {
    return (
      <Text fontSize="xs" color="fg.subtle" py={4} textAlign="center">
        No records
      </Text>
    );
  }
  return (
    <Stack
      gap={0}
      divideY="1px"
      divideColor="gray.100"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
      w="full"
    >
      {children}
    </Stack>
  );
}

function MobileRecordRow({
  title,
  meta,
  trailing,
}: {
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Flex px={2.5} py={2} gap={2} justify="space-between" align="flex-start" w="full" minW={0}>
      <Box flex={1} minW={0}>
        <Text fontSize="xs" fontWeight="semibold" color="fg" lineClamp={1}>
          {title}
        </Text>
        {meta ? (
          <Box fontSize="2xs" color="fg.muted" mt={0.5} lineHeight="1.35">
            {meta}
          </Box>
        ) : null}
      </Box>
      {trailing ? (
        <Box flexShrink={0} textAlign="right" maxW="42%" minW={0}>
          {trailing}
        </Box>
      ) : null}
    </Flex>
  );
}

export function ReconciliationExpandPanel({
  customerId,
  initialRow,
  onActionComplete,
}: Props) {
  const [detail, setDetail] = useState<ReconciliationCustomerDetail | null>(() =>
    initialRow ? initialDetailFromRow(initialRow) : null,
  );
  const [loading, setLoading] = useState(!initialRow);
  const [acting, setActing] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const data = await api.getReconciliationCustomer(customerId, refresh);
      setDetail(data);
    } catch (e) {
      toaster.error({
        title: "Failed to load reconciliation detail",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    setActing(true);
    try {
      const result = await api.executeReconciliationAction(customerId, action, payload);
      toaster.success({ title: result.message || "Action completed" });
      await load(true);
      onActionComplete?.();
    } catch (e) {
      toaster.error({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setActing(false);
    }
  }

  if (loading && !detail) {
    return <TransactionExpandSkeleton />;
  }

  if (!detail) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Reconciliation data unavailable.
      </Text>
    );
  }

  const metrics = detail.metrics;

  return (
    <EntityExpandShell
      icon={FiAlertCircle}
      title={detail.customerName}
      subtitle={`${detail.customerNumber} · ${detail.buildingName || "—"}`}
      badge={<ReconciliationStatusBadge status={detail.primaryStatus} />}
      value={
        <Text fontWeight="bold" fontSize="sm">
          {formatCurrency(metrics.outstandingBalance)} due
        </Text>
      }
      status={<TextStatus status={metrics.subscriptionStatus} />}
      actions={
        <Button
          size="xs"
          variant="outline"
          loading={loading}
          onClick={() => load(true)}
        >
          <FiRefreshCw />
          Refresh
        </Button>
      }
      accent={
        detail.primaryStatus === "connected_without_payment" ? "red.500" : "brand.600"
      }
    >
      <Stack gap={{ base: 2, md: 3 }}>
        {(detail.billedViaAgency || detail.customer?.customerType === "B2B") && (
          <Box bg="blue.50" border="1px solid" borderColor="blue.100" borderRadius="md" px={{ base: 2.5, md: 3 }} py={{ base: 1.5, md: 2 }}>
            <Text fontSize="xs" color="blue.800" fontWeight="medium">
              {detail.billingNote ||
                `B2B — billed via ${detail.agencyName || detail.customer?.agencyName || "agency"}, not individually`}
            </Text>
          </Box>
        )}

        {(detail.zohoError || detail.tispError) && (
          <Box bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="md" px={{ base: 2.5, md: 3 }} py={{ base: 1.5, md: 2 }}>
            <Text fontSize="xs" color="orange.800">
              {detail.zohoError && `Zoho: ${detail.zohoError}`}
              {detail.zohoError && detail.tispError ? " · " : ""}
              {detail.tispError && `TISP: ${detail.tispError}`}
            </Text>
          </Box>
        )}

        <TabStrip tabs={[...TABS]} active={tab} onChange={(id) => setTab(id as TabId)} />

        {tab === "overview" && (
          <Stack gap={{ base: 2, md: 3 }}>
            <ReconciliationSystemChecks detail={detail} />

            <DetailGrid>
              <DetailCard label="Expected Amount" value={formatCurrency(metrics.expectedAmount)} />
              <DetailCard label="Amount Paid (last)" value={formatCurrency(metrics.amountPaid)} />
              <DetailCard label="Outstanding" value={formatCurrency(metrics.outstandingBalance)} />
              <DetailCard
                label="Billing Frequency"
                value={formatTitleCase(metrics.billingFrequency)}
              />
              <DetailCard label="Package" value={detail.productName || "—"} />
              <DetailCard label="Account" value={formatTitleCase(metrics.accountStatus || "—")} />
              <DetailCard label="TISP Service" value={metrics.subscriptionStatus} />
              <DetailCard
                label="Zoho Billing"
                value={
                  metrics.zohoLinked
                    ? metrics.outstandingBalance > 0
                      ? `${formatCurrency(metrics.outstandingBalance)} due`
                      : "Linked · Paid up"
                    : "Not linked"
                }
              />
              <DetailCard
                label="Recurring Invoice"
                value={metrics.recurringInvoiceActive ? "Active" : "Stopped / Missing"}
              />
              <DetailCard label="Unmatched M-Pesa" value={String(metrics.unmatchedMpesaCount)} />
            </DetailGrid>

            {detail.recommendations?.length > 0 && (
              <Box>
                <Text fontSize="2xs" fontWeight="semibold" color="fg.muted" mb={1.5}>
                  Recommended Actions
                </Text>
                <Flex gap={1.5} wrap="wrap">
                  {detail.recommendations.map((rec) => (
                    <Button
                      key={rec.action}
                      size="xs"
                      variant="outline"
                      loading={acting}
                      onClick={() => {
                        if (rec.action === "resume_recurring_invoice") {
                          runAction("resume_recurring_invoice", {
                            recurringInvoiceId: detail.recurringInvoices?.[0]?.id,
                          });
                        } else if (rec.action === "allocate_payment") {
                          const unmatched = detail.mpesaPayments?.find((p) => !p.matchedToZoho);
                          if (unmatched?.id) {
                            runAction("allocate_payment", {
                              mpesaPaymentId: unmatched.id,
                            });
                          } else {
                            toaster.info({ title: "No unallocated M-Pesa payment found" });
                          }
                        } else if (rec.action === "refresh_tisp_status") {
                          runAction("refresh_status");
                        } else {
                          toaster.info({ title: rec.label, description: rec.detail || undefined });
                        }
                      }}
                    >
                      {rec.label}
                    </Button>
                  ))}
                </Flex>
              </Box>
            )}
          </Stack>
        )}

        {tab === "invoices" && (
          <>
            <Box display={{ base: "block", lg: "none" }}>
              <MobileRecordList empty={(detail.invoices || []).length === 0}>
                {(detail.invoices || []).map((inv) => (
                  <MobileRecordRow
                    key={inv.id}
                    title={inv.invoiceNumber || inv.id}
                    meta={
                      <Text>
                        {[
                          inv.date ? formatDate(inv.date) : null,
                          inv.dueDate ? `Due ${formatDate(inv.dueDate)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    }
                    trailing={
                      <Box>
                        <Text fontSize="xs" fontWeight="semibold" color="brand.800" whiteSpace="nowrap">
                          {formatCurrency(inv.balanceDue)}
                        </Text>
                        <Box mt={0.5} display="flex" justifyContent="flex-end">
                          <TextStatus status={inv.status} />
                        </Box>
                      </Box>
                    }
                  />
                ))}
              </MobileRecordList>
            </Box>
            <Box display={{ base: "none", lg: "block" }}>
              <DataTable>
                <Table.Header>
                  <Table.Row>
                    <DataTableColumnHeader>Invoice</DataTableColumnHeader>
                    <DataTableColumnHeader>Date</DataTableColumnHeader>
                    <DataTableColumnHeader>Due</DataTableColumnHeader>
                    <DataTableColumnHeader>Status</DataTableColumnHeader>
                    <DataTableColumnHeader textAlign="right">Balance</DataTableColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {(detail.invoices || []).map((inv) => (
                    <Table.Row key={inv.id}>
                      <Table.Cell {...dataTableCellProps}>{inv.invoiceNumber || inv.id}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>{inv.date ? formatDate(inv.date) : "—"}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>{inv.dueDate ? formatDate(inv.dueDate) : "—"}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <TextStatus status={inv.status} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} textAlign="right">
                        {formatCurrency(inv.balanceDue)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            </Box>
          </>
        )}

        {tab === "payments" && (
          <>
            <Box display={{ base: "block", lg: "none" }}>
              <MobileRecordList
                empty={[...(detail.mpesaPayments || []), ...(detail.zohoPayments || [])].length === 0}
              >
                {[...(detail.mpesaPayments || []), ...(detail.zohoPayments || [])].map((p) => (
                  <MobileRecordRow
                    key={p.id}
                    title={p.referenceId || p.id}
                    meta={
                      <Text>
                        {[p.source?.toUpperCase(), p.paidAt ? formatDate(String(p.paidAt)) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    }
                    trailing={
                      <Text fontSize="xs" fontWeight="semibold" color="brand.800" whiteSpace="nowrap">
                        {formatCurrency(p.amount)}
                      </Text>
                    }
                  />
                ))}
              </MobileRecordList>
            </Box>
            <Box display={{ base: "none", lg: "block" }}>
              <DataTable>
                <Table.Header>
                  <Table.Row>
                    <DataTableColumnHeader>Source</DataTableColumnHeader>
                    <DataTableColumnHeader>Reference</DataTableColumnHeader>
                    <DataTableColumnHeader>Date</DataTableColumnHeader>
                    <DataTableColumnHeader textAlign="right">Amount</DataTableColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {[...(detail.mpesaPayments || []), ...(detail.zohoPayments || [])].map((p) => (
                    <Table.Row key={p.id}>
                      <Table.Cell {...dataTableCellProps}>{p.source?.toUpperCase()}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>{p.referenceId || "—"}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {p.paidAt ? formatDate(String(p.paidAt)) : "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} textAlign="right">
                        {formatCurrency(p.amount)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            </Box>
          </>
        )}

        {tab === "timeline" && (
          <Stack
            gap={0}
            divideY="1px"
            divideColor="gray.100"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            overflow="hidden"
            w="full"
          >
            {[...(detail.auditTrail || []), ...(detail.activityTrail || [])]
              .sort(
                (a, b) =>
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              )
              .slice(0, 40)
              .map((entry) => (
                <Flex
                  key={`${"actionType" in entry ? "audit" : "activity"}-${entry.id}`}
                  gap={2}
                  px={{ base: 2.5, md: 3 }}
                  py={{ base: 2, md: 2.5 }}
                  fontSize="xs"
                  align="flex-start"
                  w="full"
                  minW={0}
                >
                  <Text color="fg.muted" minW={{ base: "72px", md: "140px" }} flexShrink={0} fontSize="2xs">
                    {formatDate(entry.createdAt)}
                  </Text>
                  <Text color="fg" flex={1} minW={0} lineHeight="1.4">
                    {"actionType" in entry
                      ? `${entry.actionType}${entry.userEmail ? ` · ${entry.userEmail}` : ""}`
                      : `${entry.title}${
                          "actorName" in entry && entry.actorName
                            ? ` · ${entry.actorName}`
                            : ""
                        }`}
                  </Text>
                </Flex>
              ))}
            {[...(detail.auditTrail || []), ...(detail.activityTrail || [])].length === 0 ? (
              <Text fontSize="xs" color="fg.subtle" py={4} textAlign="center">
                No audit activity
              </Text>
            ) : null}
          </Stack>
        )}
      </Stack>
    </EntityExpandShell>
  );
}
