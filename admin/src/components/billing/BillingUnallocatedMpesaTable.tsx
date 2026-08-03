import { Fragment, useCallback, useEffect, useState } from "react";
import { Button, Box, Input, Table, Text } from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight, FiRefreshCw } from "react-icons/fi";
import { useDebouncedSearch } from "../../hooks/useDebouncedValue";
import { useMobileViewport } from "../../hooks/useMobileViewport";
import {
  api,
  formatCurrency,
  formatDate,
  type ListPagination,
  type UnmatchedMpesaPayment,
} from "../../lib/api";
import { FilterField } from "../module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../ui/FilterToolbar";
import {
  DataTable,
  DataTableCard,
  DataTableColumnHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableExpandRowProps,
} from "../ui/DataTable";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../PageSkeletons";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../ui/MobileDataList";
import { MobilePageChrome } from "../ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../ui/ListPageStickyChrome";
import { DataTableExportButton } from "../ui/DataTableExportButton";
import { unmatchedMpesaExportColumns } from "../../lib/dataTableExportColumns";
import {
  exportTableData,
  type ExportFormat,
  type ExportScope,
} from "../../lib/tableExport";
import { UnmatchedMpesaExpandPanel } from "./UnmatchedMpesaExpandPanel";
import { useBillingReconciliation } from "./BillingReconciliationContext";
import { useAuth } from "../../lib/authContext";
import { canOperateFinance } from "../../lib/rbac";

const PAGE_SIZE = 30;

type Props = {
  reloadKey?: number;
  onReload?: () => void;
};

export function BillingUnallocatedMpesaTable({ reloadKey = 0, onReload }: Props) {
  const isMobile = useMobileViewport();
  const { user } = useAuth();
  const allowSync = canOperateFinance(user);
  const { syncing, runSync } = useBillingReconciliation();
  const [searchInput, setSearchInput] = useState("");
  const { query: search, pending: searchPending } = useDebouncedSearch(searchInput);
  const [allRows, setAllRows] = useState<UnmatchedMpesaPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listReconciliationUnmatchedMpesa();
      setAllRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [reloadKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filtered = allRows.filter((row) => {
    const term = search.toLowerCase();
    if (!term) return true;
    const hay = [
      row.referenceId,
      row.accountReference,
      row.phone,
      row.suggestedCustomerNumber,
      row.customerName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(term);
  });

  const tableBusy = loading || searchPending;

  const pagination: ListPagination = {
    page,
    limit: PAGE_SIZE,
    total: filtered.length,
    pages: Math.ceil(filtered.length / PAGE_SIZE) || 1,
  };

  const rows = isMobile
    ? filtered.slice(0, page * PAGE_SIZE)
    : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const colSpan = 8;

  function handleAllocated() {
    load();
    onReload?.();
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const filterTags: string[] = [];
      if (search) filterTags.push(search);
      await exportTableData({
        scope,
        format,
        filenameBase: "unallocated-mpesa",
        filterTags,
        title: "Unallocated M-Pesa Payments",
        columns: unmatchedMpesaExportColumns,
        viewRows: rows,
        fetchAllRows: async () => filtered,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <ListPageTableSection
      chrome={
        <ListPageStickyChrome>
          <Box display={{ base: "block", lg: "none" }}>
            <MobilePageChrome
              title="Unallocated M-Pesa"
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              searchPlaceholder="Receipt, account, phone…"
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
                entityLabel="unallocated payments"
                viewCount={rows.length}
                totalCount={filtered.length}
                loading={exporting}
                onExport={handleExport}
              />
            }
          >
            <FilterField label="Search" flex={FILTER_FLEX.search} hideOnMobile>
              <Input
                size="sm"
                placeholder="Receipt, account ref, phone, customer…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </FilterField>
          </FilterToolbar>
        </ListPageStickyChrome>
      }
    >
      {error && (
        <Text color="red.600" fontSize="sm">
          {error}
        </Text>
      )}

      {tableBusy ? (
        <DataTableCard
          pagination={pagination}
          onPageChange={setPage}
          loading
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
          loadedCount={rows.length}
        >
          <ResponsiveListViews
        mobile={
            <MobileDataList
              items={rows}
              getKey={(row) => String(row.id)}
              expandedId={expanded != null ? String(expanded) : null}
              renderCard={(row, isOpen) => (
                <MobileDataCard
                  variant="row"
                  title={row.referenceId || "—"}
                  subtitle={row.customerName || row.accountReference || "No account ref"}
                  trailing={
                    <Text fontSize="sm" fontWeight="semibold" color="brand.800">
                      {formatCurrency(row.amount)}
                    </Text>
                  }
                  isOpen={isOpen}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                />
              )}
              renderExpanded={(row) => (
                <UnmatchedMpesaExpandPanel paymentId={row.id} onComplete={handleAllocated} />
              )}
              emptyMessage={
                <Text fontSize="sm" color="fg.muted" py={8} textAlign="center">
                  No unallocated M-Pesa payments
                </Text>
              }
            />
        }
        desktop={
              <DataTable fixedLayout>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader w={DATA_TABLE_LEADING_COL_WIDTH} />
                    <DataTableColumnHeader>Receipt</DataTableColumnHeader>
                    <DataTableColumnHeader>Customer</DataTableColumnHeader>
                    <DataTableColumnHeader>Phone</DataTableColumnHeader>
                    <DataTableColumnHeader textAlign="right">Amount</DataTableColumnHeader>
                    <DataTableColumnHeader>Channel</DataTableColumnHeader>
                    <DataTableColumnHeader>Date</DataTableColumnHeader>
                    <DataTableColumnHeader>Action</DataTableColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <Table.Row
                        cursor="pointer"
                        bg={expanded === row.id ? "brand.50" : undefined}
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        <Table.Cell {...dataTableCellProps}>
                          {expanded === row.id ? (
                            <FiChevronDown size={16} />
                          ) : (
                            <FiChevronRight size={16} />
                          )}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} fontFamily="mono" fontSize="sm">
                          {row.referenceId || "—"}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} fontSize="sm">
                          {row.customerName ? (
                            <>
                              <Text fontWeight="medium">{row.customerName}</Text>
                              <Text fontSize="xs" color="fg.muted">
                                {row.accountReference || "—"}
                              </Text>
                            </>
                          ) : (
                            row.accountReference || row.suggestedCustomerNumber || "—"
                          )}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} fontSize="sm">
                          {row.phone || "—"}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} textAlign="right" fontSize="sm" fontWeight="semibold">
                          {formatCurrency(row.amount)}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} fontSize="sm">
                          {row.channel || "—"}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps} fontSize="sm">
                          {row.paidAt ? formatDate(row.paidAt) : "—"}
                        </Table.Cell>
                        <Table.Cell {...dataTableCellProps}>
                          <Button
                            size="xs"
                            variant="outline"
                            colorPalette="brand"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded(row.id);
                            }}
                          >
                            Review & allocate
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                      {expanded === row.id && (
                        <Table.Row {...dataTableExpandRowProps}>
                          <Table.Cell colSpan={colSpan} p={3}>
                            <UnmatchedMpesaExpandPanel
                              paymentId={row.id}
                              onComplete={handleAllocated}
                            />
                          </Table.Cell>
                        </Table.Row>
                      )}
                    </Fragment>
                  ))}
                </Table.Body>
              </DataTable>
        }
      />
        </DataTableCard>
      )}
    </ListPageTableSection>
  );
}
