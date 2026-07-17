import { Fragment, useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Flex,
  Input,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import type { ExportFormat, ExportScope } from "../lib/tableExport";
import { api, formatCurrency, formatDate, type ListPagination, type UnifiedTransaction } from "../lib/api";
import { TransactionExpandPanel } from "../components/TransactionExpandPanel";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { DateField } from "../components/ui/DateField";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { SelectField } from "../components/ui/SelectField";
import { DisplayText } from "../components/ui/DisplayText";
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableTitleColumnHeaderProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";
import { TextStatus } from "../components/ui/TextStatus";

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

const ZOHO_ACTION_LABELS: Record<"created" | "updated", string> = {
  created: "Invoice Created",
  updated: "Invoice Updated",
};

const ZOHO_ACTION_COLORS: Record<"created" | "updated", string> = {
  created: "green",
  updated: "orange",
};

type TransactionSortKey =
  | "source"
  | "customerRef"
  | "referenceId"
  | "amount"
  | "status"
  | "createdAt";

export function TransactionsPage() {
  const isMobile = useMobileViewport();
  const [source, setSource] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<UnifiedTransaction[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  });
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { sorts, toggleSort, sortQuery } = useTableSort<TransactionSortKey>({
    sortBy: "createdAt",
    sortDir: "desc",
  });

  const filters = (): Record<string, string> => {
    const p: Record<string, string> = {
      page: String(page),
      limit: "20",
      sortBy: sortQuery.sortBy,
      sortDir: sortQuery.sortDir,
    };
    if (source !== "all") p.source = source;
    if (search) p.search = search;
    if (status) p.status = status;
    if (channel) p.channel = channel;
    if (from) p.from = from;
    if (to) p.to = to;
    return p;
  };

  const load = useCallback(async () => {
    const append = isMobile && page > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const res = await api.getTransactions(filters());
      setRows((prev) =>
        mergeInfinitePage(
          prev,
          res.data,
          page,
          isMobile,
          (row) => `${row.source}-${row.id}`
        )
      );
      setPagination(res.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [page, search, status, channel, from, to, source, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  function handleSort(
    column: TransactionSortKey,
    defaultDir: "asc" | "desc" = "asc",
    additive = false
  ) {
    toggleSort(column, defaultDir, additive);
    setPage(1);
    setExpanded(null);
  }

  useEffect(() => {
    const next = debouncedSearchInput.trim();
    if (next === search) return;
    setSearch(next);
    setPage(1);
    setExpanded(null);
  }, [debouncedSearchInput, search]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleRow(row: UnifiedTransaction) {
    const key = `${row.source}-${row.id}`;
    setExpanded((prev) => (prev === key ? null : key));
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const params: Record<string, string> = {
        ...filters(),
        scope,
      };
      if (scope === "all") {
        delete params.page;
        delete params.limit;
      }
      await api.exportTransactions(params, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const rowKey = (row: UnifiedTransaction) => `${row.source}-${row.id}`;

  const advancedFilters = (
    <>
      <FilterField label="Status" flex={FILTER_FLEX.standard} minW={0} hideOnMobile>
        <SelectField
          size="sm"
          fieldProps={{
            value: status,
            onChange: (e) => {
              setStatus(e.target.value);
              setPage(1);
              setExpanded(null);
            },
            borderRadius: "md",
          }}
        >
          <option value="">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Pending</option>
          <option value="paid">Paid (Zoho)</option>
        </SelectField>
      </FilterField>

      <FilterField label="Channel" flex={FILTER_FLEX.standard} minW={0}>
        <SelectField
          size="sm"
          fieldProps={{
            value: channel,
            onChange: (e) => {
              setChannel(e.target.value);
              setPage(1);
              setExpanded(null);
            },
            borderRadius: "md",
          }}
        >
          <option value="">All channels</option>
          <option value="STK">STK Push</option>
          <option value="C2B">C2B Paybill</option>
        </SelectField>
      </FilterField>

      <FilterField label="From" flex={FILTER_FLEX.compact} minW={0}>
        <DateField
          size="sm"
          value={from}
          onChange={(value) => {
            setFrom(value);
            setPage(1);
            setExpanded(null);
          }}
          max={to || undefined}
          placeholder="Start date"
        />
      </FilterField>

      <FilterField label="To" flex={FILTER_FLEX.compact} minW={0}>
        <DateField
          size="sm"
          value={to}
          onChange={(value) => {
            setTo(value);
            setPage(1);
            setExpanded(null);
          }}
          min={from || undefined}
          placeholder="End date"
        />
      </FilterField>
    </>
  );

  return (
    <ListPageStack>
      <MobilePageChrome
        title="Transactions"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Phone, receipt, customer…"
        chips={[
          { key: "all", label: "All", active: source === "all", onClick: () => { setSource("all"); setPage(1); setExpanded(null); } },
          { key: "mpesa", label: "M-Pesa", active: source === "mpesa", onClick: () => { setSource("mpesa"); setPage(1); setExpanded(null); } },
          { key: "zoho", label: "Zoho", active: source === "zoho", onClick: () => { setSource("zoho"); setPage(1); setExpanded(null); } },
          { key: "tisp", label: "TISP", active: source === "tisp", onClick: () => { setSource("tisp"); setPage(1); setExpanded(null); } },
          { key: "success", label: "Success", active: status === "SUCCESS", onClick: () => { setStatus(status === "SUCCESS" ? "" : "SUCCESS"); setPage(1); setExpanded(null); } },
          { key: "failed", label: "Failed", active: status === "FAILED", onClick: () => { setStatus(status === "FAILED" ? "" : "FAILED"); setPage(1); setExpanded(null); } },
        ]}
        filterTitle="Filters"
        activeFilterCount={(channel ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)}
        onClearFilters={() => {
          setChannel("");
          setFrom("");
          setTo("");
          setPage(1);
          setExpanded(null);
        }}
        filterContent={advancedFilters}
        sortOptions={[
          {
            key: "createdAt",
            label: "Date",
            active: sorts[0]?.sortBy === "createdAt",
            direction: sorts[0]?.sortBy === "createdAt" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("createdAt", "desc"),
          },
          {
            key: "amount",
            label: "Amount",
            active: sorts[0]?.sortBy === "amount",
            direction: sorts[0]?.sortBy === "amount" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("amount", "desc"),
          },
          {
            key: "status",
            label: "Status",
            active: sorts[0]?.sortBy === "status",
            direction: sorts[0]?.sortBy === "status" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("status"),
          },
          {
            key: "customerRef",
            label: "Customer",
            active: sorts[0]?.sortBy === "customerRef",
            direction: sorts[0]?.sortBy === "customerRef" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("customerRef"),
          },
        ]}
        desktopActions={
          <DataTableExportButton
            entityLabel="transactions"
            viewCount={rows.length}
            totalCount={pagination.total}
            loading={exporting}
            onExport={handleExport}
          />
        }
      />

      <FilterToolbar>
          <FilterField label="Source" flex={FILTER_FLEX.compact} minW={0} hideOnMobile>
            <SelectField
              size="sm"
              fieldProps={{
                value: source,
                onChange: (e) => {
                  setSource(e.target.value);
                  setPage(1);
                  setExpanded(null);
                },
                borderRadius: "md",
              }}
            >
              <option value="all">All sources</option>
              <option value="mpesa">M-Pesa</option>
              <option value="zoho">Zoho</option>
              <option value="tisp">TISP</option>
            </SelectField>
          </FilterField>

          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
            <Input
              size="sm"
              placeholder="Phone, receipt, customer…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              borderRadius="md"
            />
          </FilterField>

          {advancedFilters}
      </FilterToolbar>

      {error && (
        <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
          {error}
        </Box>
      )}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={rows.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="transactions"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="row" />}
            desktop={<DataTableLoadingSkeleton columns={7} fill narrowLeading={1} />}
          />
        ) : rows.length === 0 ? (
          <EmptyState>No transactions found</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={rows}
                getKey={rowKey}
                expandedId={expanded}
                renderCard={(row, isOpen) => (
                  <MobileDataCard
                    variant="row"
                    title={row.customerRef || row.phone || "—"}
                    subtitle={`${formatDate(row.createdAt)} • ${row.referenceId || "—"}`}
                    statusLine={<TextStatus status={row.status} variant="caption" />}
                    trailing={
                      <Text fontWeight="bold" fontSize="md" whiteSpace="nowrap">
                        {formatCurrency(row.amount)}
                      </Text>
                    }
                    isOpen={isOpen}
                    onClick={() => toggleRow(row)}
                  />
                )}
                renderExpanded={(row) => (
                  <TransactionExpandPanel source={row.source} id={row.id} />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Source" column="source" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Customer / Account" column="customerRef" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Reference" column="referenceId" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Amount" column="amount" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Status" column="status" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Date" column="createdAt" sorts={sorts} onSort={handleSort} defaultDir="desc" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => {
                const key = `${row.source}-${row.id}`;
                const isOpen = expanded === key;

                return (
                  <Fragment key={key}>
                    <Table.Row
                      bg={isOpen ? "brand.50" : undefined}
                      cursor="pointer"
                      onClick={() => toggleRow(row)}
                      _hover={{ bg: isOpen ? "brand.50" : "gray.50" }}
                    >
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                        {isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Flex gap={1.5} align="center" flexWrap="wrap">
                          <Badge
                            colorPalette={SOURCE_COLORS[row.source] || "gray"}
                            variant="subtle"
                          >
                            {SOURCE_LABELS[row.source] || row.source}
                          </Badge>
                          {row.source === "zoho" && row.zohoAction && (
                            <Badge
                              colorPalette={ZOHO_ACTION_COLORS[row.zohoAction]}
                              variant="outline"
                              fontSize="2xs"
                            >
                              {ZOHO_ACTION_LABELS[row.zohoAction]}
                            </Badge>
                          )}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="medium">
                        <DisplayText value={row.customerRef || row.phone} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" color="brand.700">
                        {row.referenceId || "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        {formatCurrency(row.amount)}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <TextStatus status={row.status} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {formatDate(row.createdAt)}
                      </Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={7} p={3} bg="surface.50" borderBottom="none">
                          <TransactionExpandPanel source={row.source} id={row.id} />
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Fragment>
                );
              })}
            </Table.Body>
          </DataTable>
            }
          />
        )}
      </DataTableCard>
    </ListPageStack>
  );
}
