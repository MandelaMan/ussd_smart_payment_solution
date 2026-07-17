import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Input, Stack, Table, Text } from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight, FiRefreshCw } from "react-icons/fi";
import { useDebouncedSearch } from "../../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../../hooks/useMobileViewport";
import {
  api,
  formatCurrency,
  formatDateOnly,
  type ListPagination,
  type ReconciliationCustomerRow,
  type ReconciliationSyncProgress,
} from "../../lib/api";
import {
  moduleStatusParam,
  rowBillingGapIssue,
  BILLING_GAP_ISSUE_LABELS,
  BILLING_GAP_STATUSES,
  type BillingModuleDef,
} from "../../lib/billingReconciliationNav";
import { formatTitleCase } from "../../lib/formatText";
import { FilterField } from "../module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../ui/FilterToolbar";
import { SelectField } from "../ui/SelectField";
import { MobilePageChrome } from "../ui/MobilePageChrome";
import {
  DataTable,
  DataTableCard,
  DataTableColumnHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableExpandRowProps,
} from "../ui/DataTable";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../PageSkeletons";
import { DisplayText } from "../ui/DisplayText";
import { ReconciliationExpandPanel } from "../reconciliation/ReconciliationExpandPanel";
import { ReconciliationStatusBadge } from "../reconciliation/ReconciliationStatusBadge";
import { TextStatus } from "../ui/TextStatus";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../ui/MobileDataList";
import { BillingSyncProgressBanner } from "./BillingSyncProgressBanner";
import { DataTableExportButton } from "../ui/DataTableExportButton";
import { useBillingReconciliation } from "./BillingReconciliationContext";
import type { ExportFormat, ExportScope } from "../../lib/tableExport";
import { useAuth } from "../../lib/auth";
import { canOperateFinance } from "../../lib/rbac";

const BROWSE_PAGE_SIZE = 10;
const SEARCH_PAGE_SIZE = 25;

type Column =
  | "issue"
  | "issueType"
  | "outstanding"
  | "service"
  | "frequency"
  | "lastInvoice"
  | "lastPayment"
  | "tispDue"
  | "action";

type Props = {
  module: BillingModuleDef;
  columns?: Column[];
  reloadKey?: number;
  /** Show expected invoice amount under customer name (billing gaps). */
  showInvoiceAmountUnderCustomer?: boolean;
};

const DEFAULT_COLUMNS: Column[] = ["issue", "outstanding", "service", "action"];

export function BillingCustomerTable({
  module,
  columns = DEFAULT_COLUMNS,
  reloadKey = 0,
  showInvoiceAmountUnderCustomer = false,
}: Props) {
  const isMobile = useMobileViewport();
  const { user } = useAuth();
  const allowSync = canOperateFinance(user);
  const { syncing, runSync } = useBillingReconciliation();
  const [searchInput, setSearchInput] = useState("");
  const { query: debouncedQuery, pending: searchPending } = useDebouncedSearch(searchInput);
  const [search, setSearch] = useState("");
  const [issueTypeFilter, setIssueTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ReconciliationCustomerRow[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: BROWSE_PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [syncProgress, setSyncProgress] = useState<ReconciliationSyncProgress | null>(null);
  const [exporting, setExporting] = useState(false);
  const [browseMode, setBrowseMode] = useState(true);
  const loadGenRef = useRef(0);

  const baseStatus = moduleStatusParam(module);
  const activeStatus = issueTypeFilter || baseStatus;
  const searchActive = search.length > 0;
  // Billing Gaps search: live-check the customer and show them even when clean,
  // so staff can confirm "no billing gaps". Optional gap-type filter still applies.
  const statusForQuery =
    searchActive && module.id === "billing-gaps"
      ? issueTypeFilter || undefined
      : activeStatus;
  const pageSize = searchActive ? SEARCH_PAGE_SIZE : BROWSE_PAGE_SIZE;
  const syncRunning = syncStatus === "running";
  const tableBusy = loading || searchPending;

  useEffect(() => {
    if (debouncedQuery === search) return;
    setSearch(debouncedQuery);
    setPage(1);
    setExpanded(null);
  }, [debouncedQuery, search]);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [activeStatus]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!baseStatus) return;
      const gen = ++loadGenRef.current;
      const pageForQuery = searchActive ? page : 1;
      const append = Boolean(isMobile && searchActive && pageForQuery > 1 && !opts?.silent);
      if (!opts?.silent) {
        if (append) setLoadingMore(true);
        else setLoading(true);
      }
      setError("");
      try {
        const res = await api.listReconciliationCustomers({
          page: String(pageForQuery),
          limit: String(pageSize),
          search: searchActive ? search : undefined,
          status: statusForQuery,
          sortBy: "priority",
          sortDir: "desc",
        });
        // Live Zoho search is slow — ignore stale responses from earlier keystrokes
        // (e.g. intermediate "t50" finishing after "t506").
        if (gen !== loadGenRef.current) return;
        setBrowseMode(Boolean(res.browseMode) && !searchActive);
        setSyncStatus(res.sync?.status ?? "idle");
        setSyncProgress(res.sync?.progress ?? null);
        if (opts?.silent && isMobile && searchActive && pageForQuery > 1) {
          setPagination(res.pagination);
        } else {
          setRows((prev) =>
            mergeInfinitePage(
              prev,
              res.data,
              pageForQuery,
              isMobile && searchActive && !opts?.silent,
              (row) => row.customerId
            )
          );
          setPagination(res.pagination);
        }
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (gen !== loadGenRef.current) return;
        if (!opts?.silent) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [page, pageSize, search, searchActive, baseStatus, statusForQuery, reloadKey, isMobile],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!syncRunning) return;
    const id = window.setInterval(() => {
      load({ silent: true });
    }, 3000);
    return () => window.clearInterval(id);
  }, [syncRunning, load]);

  const colSpan = 2 + columns.length;
  const showIssueTypeFilter = Boolean(module.statusFilters?.length);
  // Browse sync banner is misleading during search ("N matching" = table rows, not filter hits).
  const showProgress =
    !searchActive &&
    !searchPending &&
    (syncRunning || Boolean(syncProgress?.partialReady));
  const showTable = !tableBusy && rows.length > 0;
  const emptyMessage =
    tableBusy || syncRunning ? null : (
      <Text fontSize="sm" color="fg.muted" py={8} textAlign="center">
        {searchActive
          ? "No active customers match your search"
          : "No billing gaps in the preview batch"}
      </Text>
    );

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    if (!activeStatus) return;
    setExporting(true);
    try {
      const params: Record<string, string> = {
        scope,
        status: activeStatus,
      };
      if (searchActive && search.trim()) params.search = search.trim();
      if (scope === "view") {
        params.page = String(searchActive ? page : 1);
        params.limit = String(pageSize);
      }
      await api.exportReconciliation(params, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const tableBody = (
    <DataTable fixedLayout>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader w={DATA_TABLE_LEADING_COL_WIDTH} />
          <DataTableColumnHeader>Customer</DataTableColumnHeader>
          {columns.includes("issueType") && <DataTableColumnHeader>Gap type</DataTableColumnHeader>}
          {columns.includes("frequency") && <DataTableColumnHeader>Frequency</DataTableColumnHeader>}
          {columns.includes("lastInvoice") && <DataTableColumnHeader>Last invoice</DataTableColumnHeader>}
          {columns.includes("lastPayment") && <DataTableColumnHeader>Last payment</DataTableColumnHeader>}
          {columns.includes("tispDue") && <DataTableColumnHeader>TISP due</DataTableColumnHeader>}
          {columns.includes("outstanding") && (
            <DataTableColumnHeader textAlign="right">Outstanding</DataTableColumnHeader>
          )}
          {columns.includes("service") && <DataTableColumnHeader>TISP</DataTableColumnHeader>}
          {columns.includes("issue") && <DataTableColumnHeader>Issue</DataTableColumnHeader>}
          {columns.includes("action") && <DataTableColumnHeader>Action</DataTableColumnHeader>}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => {
          const gapStatus = rowBillingGapIssue(row);
          return (
            <Fragment key={row.customerId}>
              <Table.Row
                cursor="pointer"
                bg={expanded === row.customerId ? "brand.50" : undefined}
                onClick={() =>
                  setExpanded(expanded === row.customerId ? null : row.customerId)
                }
              >
                <Table.Cell {...dataTableCellProps}>
                  {expanded === row.customerId ? (
                    <FiChevronDown size={16} />
                  ) : (
                    <FiChevronRight size={16} />
                  )}
                </Table.Cell>
                <Table.Cell {...dataTableCellProps}>
                  <DisplayText value={row.customerName} fontWeight="medium" fontSize="sm" />
                  <Text fontSize="xs" color="fg.muted">
                    {row.customerNumber}
                  </Text>
                  {showInvoiceAmountUnderCustomer && (
                    <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                      Invoice {formatCurrency(row.metrics.expectedAmount)}
                    </Text>
                  )}
                </Table.Cell>
                {columns.includes("issueType") && (
                  <Table.Cell {...dataTableCellProps}>
                    {gapStatus ? (
                      <ReconciliationStatusBadge status={gapStatus} />
                    ) : row.primaryStatus === "current" ||
                      row.primaryStatus === "paid" ? (
                      <ReconciliationStatusBadge status="no_gaps" />
                    ) : (
                      <ReconciliationStatusBadge status={row.primaryStatus} />
                    )}
                  </Table.Cell>
                )}
                {columns.includes("frequency") && (
                  <Table.Cell {...dataTableCellProps} fontSize="sm">
                    {formatTitleCase(row.metrics.billingFrequency)}
                  </Table.Cell>
                )}
                {columns.includes("lastInvoice") && (
                  <Table.Cell {...dataTableCellProps} fontSize="sm" whiteSpace="nowrap">
                    {formatDateOnly(row.metrics.lastInvoiceDate)}
                  </Table.Cell>
                )}
                {columns.includes("lastPayment") && (
                  <Table.Cell {...dataTableCellProps} fontSize="sm" whiteSpace="nowrap">
                    {formatDateOnly(row.metrics.lastPaymentDate)}
                  </Table.Cell>
                )}
                {columns.includes("tispDue") && (
                  <Table.Cell {...dataTableCellProps} fontSize="sm" whiteSpace="nowrap">
                    {formatDateOnly(row.metrics.tispDueDate)}
                  </Table.Cell>
                )}
                {columns.includes("outstanding") && (
                  <Table.Cell {...dataTableCellProps} textAlign="right" fontSize="sm">
                    {formatCurrency(row.metrics.outstandingBalance)}
                  </Table.Cell>
                )}
                {columns.includes("service") && (
                  <Table.Cell {...dataTableCellProps}>
                    <TextStatus status={row.metrics.subscriptionStatus} />
                  </Table.Cell>
                )}
                {columns.includes("issue") && (
                  <Table.Cell {...dataTableCellProps} fontSize="xs" color="fg" maxW="280px">
                    <Text lineClamp={2}>{row.issueBasis || "—"}</Text>
                  </Table.Cell>
                )}
                {columns.includes("action") && (
                  <Table.Cell {...dataTableCellProps} fontSize="xs" color="brand.700" fontWeight="medium">
                    {row.actionLabel || "—"}
                  </Table.Cell>
                )}
              </Table.Row>
              {expanded === row.customerId && (
                <Table.Row {...dataTableExpandRowProps}>
                  <Table.Cell colSpan={colSpan} p={3}>
                    <ReconciliationExpandPanel
                      customerId={row.customerId}
                      initialRow={row}
                      onActionComplete={() => load()}
                    />
                  </Table.Cell>
                </Table.Row>
              )}
            </Fragment>
          );
        })}
      </Table.Body>
    </DataTable>
  );

  const tableSkeleton = (
    <DataTableCard
      pagination={browseMode ? undefined : pagination}
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
  );

  return (
    <Stack gap={3}>
      <Box display={{ base: "block", lg: "none" }}>
        <MobilePageChrome
          title={module.label}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          searchPlaceholder="Exact customer number, apartment, or name…"
          chips={
            showIssueTypeFilter
              ? [
                  {
                    key: "all",
                    label: "All",
                    active: !issueTypeFilter,
                    onClick: () => setIssueTypeFilter(""),
                  },
                  ...BILLING_GAP_STATUSES.map((status) => ({
                    key: status,
                    label: BILLING_GAP_ISSUE_LABELS[status],
                    active: issueTypeFilter === status,
                    onClick: () => setIssueTypeFilter(status),
                  })),
                ]
              : undefined
          }
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
        actions={
          <DataTableExportButton
            entityLabel="billing customers"
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
            placeholder="Exact customer number, apartment, or name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </FilterField>
        {showIssueTypeFilter && (
          <FilterField label="Gap type" flex={FILTER_FLEX.standard}>
            <SelectField
              size="sm"
              fieldProps={{
                value: issueTypeFilter,
                onChange: (e) => setIssueTypeFilter(e.target.value),
              }}
            >
              <option value="">All gap types</option>
              {BILLING_GAP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BILLING_GAP_ISSUE_LABELS[status]}
                </option>
              ))}
            </SelectField>
          </FilterField>
        )}
      </FilterToolbar>

      {error && (
        <Text color="red.600" fontSize="sm">
          {error}
        </Text>
      )}

      {showProgress && (
        <BillingSyncProgressBanner
          status={syncStatus}
          progress={syncProgress}
          rowCount={rows.length}
        />
      )}

      {tableBusy ? (
        tableSkeleton
      ) : (
        <ResponsiveListViews
          mobile={
            showTable ? (
              <DataTableCard
                pagination={browseMode ? undefined : pagination}
                onPageChange={setPage}
                loadingMore={loadingMore}
                loadedCount={rows.length}
              >
                <MobileDataList
                  items={rows}
                  getKey={(row) => String(row.customerId)}
                  expandedId={expanded != null ? String(expanded) : null}
                  renderCard={(row, isOpen) => {
                    const gapStatus = rowBillingGapIssue(row);
                    const statusForBadge =
                      gapStatus ||
                      (row.primaryStatus === "current" || row.primaryStatus === "paid"
                        ? "no_gaps"
                        : row.primaryStatus);

                    return (
                      <MobileDataCard
                        variant="row"
                        compact
                        title={row.customerNumber}
                        subtitle={
                          <Box>
                            <Text fontSize="sm" lineHeight="1.35" lineClamp={2}>
                              {row.customerName}
                            </Text>
                            {showInvoiceAmountUnderCustomer ? (
                              <Text fontSize="xs" color="fg.muted" fontWeight="medium" mt={0.5}>
                                Invoice {formatCurrency(row.metrics.expectedAmount)}
                              </Text>
                            ) : null}
                          </Box>
                        }
                        statusLine={
                          columns.includes("issueType") ? (
                            <ReconciliationStatusBadge status={statusForBadge} />
                          ) : row.issueBasis ? (
                            <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                              {row.issueBasis}
                            </Text>
                          ) : undefined
                        }
                        trailing={
                          columns.includes("outstanding") ? (
                            <Text fontSize="sm" fontWeight="semibold" color="brand.800" whiteSpace="nowrap">
                              {formatCurrency(row.metrics.outstandingBalance)}
                            </Text>
                          ) : (
                            <ReconciliationStatusBadge status={row.primaryStatus} />
                          )
                        }
                        isOpen={isOpen}
                        onClick={() =>
                          setExpanded(expanded === row.customerId ? null : row.customerId)
                        }
                      />
                    );
                  }}
                  renderExpanded={(row) => (
                    <Box mx={{ base: -1, sm: 0 }}>
                      <ReconciliationExpandPanel
                        customerId={row.customerId}
                        initialRow={row}
                        onActionComplete={() => load()}
                      />
                    </Box>
                  )}
                  emptyMessage={emptyMessage}
                />
              </DataTableCard>
            ) : (
              !syncRunning && emptyMessage
            )
          }
          desktop={
            showTable ? (
              <DataTableCard
                pagination={browseMode ? undefined : pagination}
                onPageChange={setPage}
                loadingMore={loadingMore}
                loadedCount={rows.length}
              >
                {tableBody}
              </DataTableCard>
            ) : (
              !syncRunning && emptyMessage
            )
          }
        />
      )}
    </Stack>
  );
}
