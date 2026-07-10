import { Fragment, useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import {
  FiChevronDown,
  FiChevronRight,
  FiRefreshCw,
} from "react-icons/fi";
import { api, formatDate, type ApiCallLog } from "../lib/api";
import { LogExpandPanel } from "../components/LogExpandPanel";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, PAGE_STACK_GAP } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { SelectField } from "../components/ui/SelectField";
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
import { toaster } from "../components/ui/toaster";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { logExportColumns } from "../lib/dataTableExportColumns";
import {
  exportTableData,
  fetchAllPaginatedRows,
  type ExportFormat,
  type ExportScope,
} from "../lib/tableExport";

const SERVICE_LABELS: Record<string, string> = {
  tisp: "TISP",
  zoho: "Zoho",
  mpesa: "M-Pesa",
  other: "Other",
};

const SERVICE_COLORS: Record<string, string> = {
  tisp: "teal",
  zoho: "blue",
  mpesa: "brand",
  other: "gray",
};

const PAGE_SIZE = 20;

type LogSortKey = "endpoint" | "service" | "createdAt" | "customerNumber" | "status";

export function LogsPage() {
  const [service, setService] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ApiCallLog[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const { sorts, toggleSort, sortQuery } = useTableSort<LogSortKey>({
    sortBy: "createdAt",
    sortDir: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      if (service) params.service = service;
      if (status) params.status = status;
      if (search) params.search = search;
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      const res = await api.listLogs(params);
      setRows(res.data);
      setPagination(res.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [page, search, status, service, sortQuery.sortBy, sortQuery.sortDir]);

  function handleSort(
    column: LogSortKey,
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

  async function handleRetry(log: ApiCallLog) {
    setRetryingId(log.id);
    try {
      const res = await api.retryLog(log.id);
      if (res.ok) {
        toaster.create({
          title: "Retry succeeded",
          description: res.message || "API call completed",
          type: "success",
        });
      } else {
        toaster.create({
          title: "Retry failed",
          description: res.error || "The API call failed again",
          type: "error",
          duration: 10000,
        });
      }
      await load();
    } catch (e) {
      toaster.create({
        title: "Retry failed",
        description: e instanceof Error ? e.message : "Could not retry",
        type: "error",
      });
    } finally {
      setRetryingId(null);
    }
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      await exportTableData({
        scope,
        format,
        filenameBase: "api-logs",
        columns: logExportColumns,
        viewRows: rows,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listLogs({
              page: String(pageNum),
              limit: String(limit),
              ...(service ? { service } : {}),
              ...(status ? { status } : {}),
              ...(search ? { search } : {}),
              sortBy: sortQuery.sortBy,
              sortDir: sortQuery.sortDir,
            }).then((res) => ({
              data: res.data,
              pagination: res.pagination,
            }))
          ),
      });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Export failed",
        type: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  function endpointLabel(url: string) {
    try {
      const path = new URL(url).pathname;
      const parts = path.split("/").filter(Boolean);
      return parts[parts.length - 1] || url;
    } catch {
      return url;
    }
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <Flex justify="space-between" align={{ base: "start", md: "center" }} gap={3}>
        <Box>
          <Heading size="lg">Logs</Heading>
          <Text fontSize="sm" color="gray.500">
            API endpoint summary and integration retries — expand a row for payload and response details
          </Text>
        </Box>
        <Flex gap={2} align="center">
          <DataTableExportButton
            entityLabel="logs"
            viewCount={rows.length}
            totalCount={pagination.total}
            loading={exporting}
            onExport={handleExport}
          />
        <Button size="sm" variant="outline" onClick={() => load()} loading={loading}>
          <FiRefreshCw style={{ marginRight: 6 }} />
          Refresh
        </Button>
        </Flex>
      </Flex>

      <FilterToolbar>
          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0}>
            <Input
              size="sm"
              placeholder="Endpoint, customer, error…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </FilterField>
          <FilterField label="Service" flex={FILTER_FLEX.standard} minW={0}>
            <SelectField
              size="sm"
              fieldProps={{
                value: service,
                onChange: (e) => {
                  setService(e.target.value);
                  setPage(1);
                },
              }}
            >
              <option value="">All services</option>
              <option value="tisp">TISP</option>
              <option value="zoho">Zoho</option>
              <option value="mpesa">M-Pesa</option>
            </SelectField>
          </FilterField>
          <FilterField label="Status" flex={FILTER_FLEX.standard} minW={0}>
            <SelectField
              size="sm"
              fieldProps={{
                value: status,
                onChange: (e) => {
                  setStatus(e.target.value);
                  setPage(1);
                },
              }}
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
            </SelectField>
          </FilterField>
      </FilterToolbar>

      {error ? (
        <Text color="red.600" fontSize="sm">
          {error}
        </Text>
      ) : null}

      <DataTableCard
        loading={loading && rows.length === 0}
        pagination={pagination}
        onPageChange={setPage}
        itemLabel="logs"
      >
        {loading && rows.length === 0 ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={2} />}
            desktop={<DataTableLoadingSkeleton columns={7} fill />}
          />
        ) : (
          <ResponsiveListViews
            mobile={
              rows.length === 0 ? (
                <EmptyState>No API logs yet</EmptyState>
              ) : (
                <MobileDataList
                  items={rows}
                  getKey={(row) => row.id}
                  expandedId={expanded}
                  renderCard={(row, isOpen) => (
                    <MobileDataCard
                      title={endpointLabel(row.endpoint)}
                      subtitle={row.operation}
                      leading={
                        <Badge
                          colorPalette={SERVICE_COLORS[row.service] || "gray"}
                          variant="subtle"
                          size="sm"
                        >
                          {SERVICE_LABELS[row.service] || row.service}
                        </Badge>
                      }
                      trailing={<TextStatus status={row.status === "success" ? "Success" : "Failed"} />}
                      isOpen={isOpen}
                      onClick={() => setExpanded((prev) => (prev === row.id ? null : row.id))}
                      fields={[
                        { label: "Called", value: formatDate(row.createdAt) },
                        { label: "Customer #", value: row.customerNumber ?? "—" },
                      ]}
                      footer={
                        row.status === "failure" && row.retryable ? (
                          <Button
                            size="xs"
                            variant="outline"
                            loading={retryingId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(row);
                            }}
                          >
                            Retry
                          </Button>
                        ) : undefined
                      }
                    />
                  )}
                  renderExpanded={(row) => <LogExpandPanel log={row} />}
                />
              )
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Endpoint" column="endpoint" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Service" column="service" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Called" column="createdAt" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Customer #" column="customerNumber" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Status" column="status" sorts={sorts} onSort={handleSort} />
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={7} {...dataTableCellProps} borderBottom="none">
                    <Text py={6} textAlign="center" color="gray.500" fontSize="sm">
                      No API logs yet
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ) : (
                rows.map((row) => (
                  <Fragment key={row.id}>
                    <Table.Row
                      _hover={{ bg: "gray.50" }}
                      cursor="pointer"
                      onClick={() =>
                        setExpanded((prev) => (prev === row.id ? null : row.id))
                      }
                    >
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                        {expanded === row.id ? (
                          <FiChevronDown size={14} />
                        ) : (
                          <FiChevronRight size={14} />
                        )}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Text fontWeight="semibold" fontSize="sm">
                          {endpointLabel(row.endpoint)}
                        </Text>
                        <Text fontSize="xs" color="gray.500" mt={0.5}>
                          {row.operation}
                        </Text>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge
                          colorPalette={SERVICE_COLORS[row.service] || "gray"}
                          variant="subtle"
                          size="sm"
                        >
                          {SERVICE_LABELS[row.service] || row.service}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="gray.600">{formatDate(row.createdAt)}</Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" textTransform="uppercase">
                        {row.customerNumber ?? "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <TextStatus status={row.status === "success" ? "Success" : "Failed"} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {row.status === "failure" && row.retryable ? (
                          <Button
                            size="xs"
                            variant="outline"
                            loading={retryingId === row.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(row);
                            }}
                          >
                            Retry
                          </Button>
                        ) : null}
                      </Table.Cell>
                    </Table.Row>
                    {expanded === row.id ? (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={7} p={3} bg="white" borderBottom="none">
                          <LogExpandPanel log={row} />
                        </Table.Cell>
                      </Table.Row>
                    ) : null}
                  </Fragment>
                ))
              )}
            </Table.Body>
          </DataTable>
            }
          />
        )}
      </DataTableCard>
    </Stack>
  );
}
