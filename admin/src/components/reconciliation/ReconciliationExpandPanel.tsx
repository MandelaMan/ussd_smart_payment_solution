import { useCallback, useEffect, useState } from "react";
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
      <Text fontSize="sm" color="gray.500">
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
      <Stack gap={3} p={3}>
        {(detail.billedViaAgency || detail.customer?.customerType === "B2B") && (
          <Box bg="blue.50" border="1px solid" borderColor="blue.100" borderRadius="md" px={3} py={2}>
            <Text fontSize="xs" color="blue.800" fontWeight="medium">
              B2B — billed via {detail.agencyName || detail.customer?.agencyName || "agency"}
            </Text>
            <Text fontSize="xs" color="blue.700" mt={0.5}>
              {detail.billingNote ||
                "Individual Zoho invoices are not created for B2B customers. Use Agencies to invoice."}
            </Text>
          </Box>
        )}

        {(detail.zohoError || detail.tispError) && (
          <Box bg="orange.50" border="1px solid" borderColor="orange.200" borderRadius="md" px={3} py={2}>
            <Text fontSize="xs" color="orange.800">
              {detail.zohoError && `Zoho: ${detail.zohoError}`}
              {detail.zohoError && detail.tispError ? " · " : ""}
              {detail.tispError && `TISP: ${detail.tispError}`}
            </Text>
          </Box>
        )}

        <TabStrip tabs={[...TABS]} active={tab} onChange={(id) => setTab(id as TabId)} />

        {tab === "overview" && (
          <Stack gap={3}>
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
                <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={2}>
                  Recommended Actions
                </Text>
                <Flex gap={2} wrap="wrap">
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
        )}

        {tab === "payments" && (
          <Stack gap={3}>
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
          </Stack>
        )}

        {tab === "timeline" && (
          <Stack gap={2}>
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
                  fontSize="xs"
                  borderBottom="1px solid"
                  borderColor="gray.100"
                  pb={2}
                >
                  <Text color="gray.500" minW="140px">
                    {formatDate(entry.createdAt)}
                  </Text>
                  <Text color="gray.800" flex={1}>
                    {"actionType" in entry
                      ? `${entry.actionType}${entry.userEmail ? ` · ${entry.userEmail}` : ""}`
                      : entry.title}
                  </Text>
                </Flex>
              ))}
          </Stack>
        )}
      </Stack>
    </EntityExpandShell>
  );
}
