import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiMail, FiEye, FiRefreshCw } from "react-icons/fi";
import { useDebouncedSearch } from "../../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../../hooks/useMobileViewport";
import {
  api,
  formatDate,
  type BillingCommunicationCandidate,
  type BillingCommunicationPreview,
  type ListPagination,
} from "../../lib/api";
import { FilterField } from "../module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../ui/FilterToolbar";
import { SelectField } from "../ui/SelectField";
import { MobilePageChrome } from "../ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../ui/ListPageStickyChrome";
import {
  DataTable,
  DataTableCard,
  DataTableColumnHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
} from "../ui/DataTable";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../PageSkeletons";
import { ReconciliationStatusBadge } from "../reconciliation/ReconciliationStatusBadge";
import { RowCheckbox } from "../ui/RowCheckbox";
import { toaster } from "../ui/toaster";
import { BillingEmailPreviewDialog } from "./BillingEmailPreviewDialog";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../ui/MobileDataList";
import { EmptyState, PageErrorBanner } from "../ui/pageLayout";
import { DataTableExportButton } from "../ui/DataTableExportButton";
import { billingCommunicationExportColumns } from "../../lib/dataTableExportColumns";
import {
  exportTableData,
  fetchAllPaginatedRows,
  type ExportFormat,
  type ExportScope,
} from "../../lib/tableExport";
import { useBillingReconciliation } from "./BillingReconciliationContext";
import { useAuth } from "../../lib/auth";
import { canOperateFinance } from "../../lib/rbac";

const PAGE_SIZE = 30;

type Props = {
  reloadKey?: number;
  onReload?: () => void;
  mailConfigured?: boolean;
};

export function BillingCommunicationsTable({
  reloadKey = 0,
  onReload,
  mailConfigured = false,
}: Props) {
  const isMobile = useMobileViewport();
  const { user } = useAuth();
  const allowSync = canOperateFinance(user);
  const allowSend = allowSync;
  const { syncing, runSync } = useBillingReconciliation();
  const [searchInput, setSearchInput] = useState("");
  const { query: debouncedQuery, pending: searchPending } = useDebouncedSearch(searchInput);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BillingCommunicationCandidate[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<BillingCommunicationPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const tableBusy = loading || searchPending;

  useEffect(() => {
    if (debouncedQuery === search) return;
    setSearch(debouncedQuery);
    setPage(1);
  }, [debouncedQuery, search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const load = useCallback(async () => {
    const append = isMobile && page > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const res = await api.listBillingCommunications({
        page: String(page),
        limit: String(PAGE_SIZE),
        search: search || undefined,
        status: statusFilter || undefined,
      });
      setRows((prev) =>
        mergeInfinitePage(prev, res.data, page, isMobile, (row) => row.customerId)
      );
      setPagination(res.pagination);
      if (!append) setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [page, search, statusFilter, reloadKey, isMobile]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const filterTags: string[] = [];
      if (statusFilter) filterTags.push(statusFilter);
      if (search) filterTags.push(search);
      await exportTableData({
        scope,
        format,
        filenameBase: "billing-communications",
        filterTags,
        columns: billingCommunicationExportColumns,
        viewRows: rows,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listBillingCommunications({
              page: String(pageNum),
              limit: String(limit),
              search: search || undefined,
              status: statusFilter || undefined,
            }).then((res) => ({
              data: res.data,
              pagination: res.pagination,
            }))
          ),
      });
    } catch (e) {
      toaster.error({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setExporting(false);
    }
  }

  const colSpan = 9;
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.customerId));
  const sendableSelected = rows.filter((r) => selected.has(r.customerId) && r.canSend);

  function toggleAll() {
    if (allOnPageSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.filter((r) => r.canSend).map((r) => r.customerId)));
    }
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openPreview(customerId: number) {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      setPreview(await api.previewBillingCommunication(customerId));
    } catch (e) {
      setPreviewOpen(false);
      toaster.error({
        title: "Preview failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  async function sendOne(customerId: number) {
    setSending(true);
    try {
      const result = await api.sendBillingCommunication(customerId);
      toaster.success({ title: "Email sent", description: result.message });
      load();
      onReload?.();
    } catch (e) {
      toaster.error({
        title: "Send failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSending(false);
    }
  }

  async function sendSelected() {
    const ids = [...selected].filter((id) => rows.find((r) => r.customerId === id)?.canSend);
    if (!ids.length) return;
    setSending(true);
    try {
      const result = await api.sendBulkBillingCommunications(ids);
      toaster.success({
        title: "Bulk send complete",
        description: `${result.sent} sent, ${result.failed} failed`,
      });
      load();
      onReload?.();
    } catch (e) {
      toaster.error({
        title: "Bulk send failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
    <ListPageTableSection
      chrome={
        <ListPageStickyChrome>
          <Box display={{ base: "block", lg: "none" }}>
            <MobilePageChrome
              title="Communications"
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              searchPlaceholder="Customer number or name…"
              headerActions={
                allowSync ? (
                  <Button size="sm" colorPalette="brand" loading={syncing} onClick={runSync}>
                    <FiRefreshCw />
                  </Button>
                ) : undefined
              }
            />
          </Box>

          <FilterToolbar
            embedded
            actions={
              <DataTableExportButton
                entityLabel="communications"
                viewCount={rows.length}
                totalCount={pagination.total}
                loading={exporting}
                onExport={handleExport}
              />
            }
          >
            <FilterField label="Search" flex={FILTER_FLEX.search} hideOnMobile>
              <Input
                size="sm"
                placeholder="Customer number or name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </FilterField>
            <FilterField label="Billing gap" flex={FILTER_FLEX.standard} hideOnMobile>
              <SelectField
                size="sm"
                fieldProps={{
                  value: statusFilter,
                  onChange: (e) => setStatusFilter(e.target.value),
                }}
              >
                <option value="">All gaps</option>
                <option value="overdue">Overdue</option>
                <option value="missing_invoice,stale_billing">Missing invoice</option>
                <option value="recurring_invoice_stopped">Recurring invoice</option>
                <option value="no_zoho_link">Not in Zoho Books</option>
                <option value="disconnected_not_invoiced">Disconnected, not invoiced</option>
                <option value="paid_but_disconnected">Paid but disconnected</option>
                <option value="connected_without_payment">Connected without payment</option>
                <option value="payment_under_review">Payment under review</option>
              </SelectField>
            </FilterField>
          </FilterToolbar>
        </ListPageStickyChrome>
      }
    >
      {!mailConfigured && (
        <Box py={2} px={3} bg="orange.50" border="1px solid" borderColor="orange.100" borderRadius="md">
          <Text fontSize="sm" color="orange.800" display={{ base: "none", lg: "block" }}>
            Zoho Mail is not configured — set ZOHO_MAIL_ACCOUNT_ID and ZOHO_MAIL_FROM_ADDRESS in server
            .env (OAuth token needs ZohoMail.messages.CREATE scope).
          </Text>
          <Text fontSize="sm" color="orange.800" display={{ base: "block", lg: "none" }}>
            Zoho Mail is not configured — sending is disabled.
          </Text>
        </Box>
      )}

      {allowSend && sendableSelected.length > 0 && (
        <Flex justify="flex-end">
          <Button
            size="sm"
            colorPalette="brand"
            loading={sending}
            onClick={sendSelected}
          >
            <FiMail />
            Send to {sendableSelected.length} selected
          </Button>
        </Flex>
      )}

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {tableBusy ? (
        <DataTableCard
          pagination={pagination}
          onPageChange={setPage}
          loading
          loadingMore={loadingMore}
          loadedCount={rows.length}
        >
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" />}
            desktop={<DataTableLoadingSkeleton columns={colSpan} fill />}
          />
        </DataTableCard>
      ) : (
        <DataTableCard
          pagination={pagination}
          onPageChange={setPage}
          loadingMore={loadingMore}
          loadedCount={rows.length}
        >
          {rows.length === 0 ? (
            <EmptyState>No billing communications match your filters</EmptyState>
          ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={rows}
                getKey={(row) => row.customerId}
                renderCard={(row) => (
                  <MobileDataCard
                    variant="row"
                    title={row.customerName}
                    subtitle={row.customerNumber}
                    trailing={<ReconciliationStatusBadge status={row.primaryStatus} />}
                    showChevron={false}
                    footer={
                      <Flex gap={2} wrap="wrap">
                        <Button size="sm" variant="ghost" onClick={() => openPreview(row.customerId)}>
                          <FiEye />
                          Preview
                        </Button>
                        {allowSend && (
                          <Button
                            size="sm"
                            variant="outline"
                            colorPalette="brand"
                            disabled={!row.canSend}
                            loading={sending}
                            onClick={() => sendOne(row.customerId)}
                          >
                            <FiMail />
                            Send
                          </Button>
                        )}
                      </Flex>
                    }
                  />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader w="40px">
                  <RowCheckbox
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all sendable on page"
                  />
                </Table.ColumnHeader>
                <Table.ColumnHeader w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableColumnHeader>Customer</DataTableColumnHeader>
                <DataTableColumnHeader>Gap</DataTableColumnHeader>
                <DataTableColumnHeader>Template</DataTableColumnHeader>
                <DataTableColumnHeader>Email</DataTableColumnHeader>
                <DataTableColumnHeader>Last sent</DataTableColumnHeader>
                <DataTableColumnHeader>Actions</DataTableColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <Table.Row key={row.customerId}>
                  <Table.Cell {...dataTableCellProps}>
                    <RowCheckbox
                      checked={selected.has(row.customerId)}
                      disabled={!row.canSend}
                      onChange={() => toggleOne(row.customerId)}
                      aria-label={`Select ${row.customerNumber}`}
                    />
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps} />
                  <Table.Cell {...dataTableCellProps}>
                    <Text fontWeight="medium" fontSize="sm">
                      {row.customerName}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {row.customerNumber}
                    </Text>
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps}>
                    <ReconciliationStatusBadge status={row.primaryStatus} />
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps} fontSize="xs">
                    {row.templateLabel || "—"}
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps} fontSize="xs">
                    {row.email ? (
                      <Stack gap={0}>
                        <Text>{row.email}</Text>
                        {row.emailSource && (
                          <Badge size="sm" variant="subtle" colorPalette="gray">
                            {row.emailSource}
                          </Badge>
                        )}
                      </Stack>
                    ) : (
                      <Text color="orange.600">No email</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps} fontSize="xs">
                    {row.lastSentAt ? formatDate(row.lastSentAt) : "—"}
                  </Table.Cell>
                  <Table.Cell {...dataTableCellProps}>
                    <Flex gap={1}>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => openPreview(row.customerId)}
                      >
                        <FiEye />
                        Preview
                      </Button>
                      {allowSend && (
                        <Button
                          size="xs"
                          variant="outline"
                          colorPalette="brand"
                          disabled={!row.canSend}
                          loading={sending}
                          onClick={() => sendOne(row.customerId)}
                        >
                          <FiMail />
                          Send
                        </Button>
                      )}
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </DataTable>
            }
          />
          )}
        </DataTableCard>
      )}
    </ListPageTableSection>

      <BillingEmailPreviewDialog
        open={previewOpen}
        onOpenChange={(e) => setPreviewOpen(e.open)}
        preview={preview}
        loading={previewLoading}
        onSend={async () => {
          if (!preview) return;
          await sendOne(preview.customerId);
          setPreviewOpen(false);
        }}
        sending={sending}
      />
    </>
  );
}
