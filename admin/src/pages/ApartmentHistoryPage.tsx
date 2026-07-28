import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Button,
  Input,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import {
  api,
  formatDate,
  type ApartmentHistoryEntry,
  type Building,
  type ListPagination,
} from "../lib/api";
import { ApartmentHistoryExpandPanel } from "../components/apartments/ApartmentHistoryExpandPanel";
import {
  ApartmentHistoryTimeline,
  ApartmentHistoryTimelineSkeleton,
} from "../components/apartments/ApartmentHistoryTimeline";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { SelectField } from "../components/ui/SelectField";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { DisplayText } from "../components/ui/DisplayText";
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableEqualDataCodeColumnHeaderProps,
  dataTableTitleColumnHeaderProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";
import { toaster } from "../components/ui/toaster";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { apartmentHistoryExportColumns } from "../lib/dataTableExportColumns";
import {
  exportTableData,
  fetchAllPaginatedRows,
  type ExportFormat,
  type ExportScope,
} from "../lib/tableExport";

const PAGE_SIZE = 30;

const REASON_LABELS: Record<string, string> = {
  signup: "Signed up",
  switch_in: "Moved in",
  switch_out: "Moved out",
  cancel: "Cancelled",
};

const expandedRowMotion = {
  animation: "apartment-row-focus 0.3s ease-out",
  "@keyframes apartment-row-focus": {
    from: { backgroundColor: "var(--chakra-colors-white)" },
    to: { backgroundColor: "var(--chakra-colors-brand-100)" },
  },
} as const;

const expandPanelRowMotion = {
  animation: "apartment-expand-row-in 0.35s ease-out",
  "@keyframes apartment-expand-row-in": {
    from: { opacity: 0, transform: "translateY(-8px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
} as const;

function reasonLabel(reason: string) {
  return REASON_LABELS[reason] || reason.replace(/_/g, " ");
}

type ApartmentHistorySortKey =
  | "buildingName"
  | "apartmentNumber"
  | "customerName"
  | "customerNumber"
  | "movedInAt"
  | "movedOutAt"
  | "reason"
  | "customerStatus";

export function ApartmentHistoryPage() {
  const isMobile = useMobileViewport();
  const [rows, setRows] = useState<ApartmentHistoryEntry[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [buildingId, setBuildingId] = useState("");
  const [apartmentInput, setApartmentInput] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const debouncedApartmentInput = useDebouncedValue(apartmentInput);
  const [currentOnly, setCurrentOnly] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [unitTimeline, setUnitTimeline] = useState<ApartmentHistoryEntry[]>([]);
  const [unitTimelineLoading, setUnitTimelineLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [unitTimelineKey, setUnitTimelineKey] = useState<string | null>(null);
  const { sorts, toggleSort, sortQuery } = useTableSort<ApartmentHistorySortKey>({
    sortBy: "movedInAt",
    sortDir: "desc",
  });

  useEffect(() => {
    setBuildingsLoading(true);
    api
      .listBuildings({ limit: "100" })
      .then((res) => setBuildings(res.buildings))
      .catch(() => {})
      .finally(() => setBuildingsLoading(false));
  }, []);

  const buildingFilterOptions = useMemo(
    () => [
      { value: "", label: "All buildings" },
      ...buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: `${b.ipSetup} · C2B ${b.c2bCode}`,
        keywords: `${b.c2bCode} ${b.b2bCode}`,
      })),
    ],
    [buildings]
  );

  const load = useCallback(async () => {
    const append = isMobile && page > 1;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      if (search.trim()) params.search = search.trim();
      if (buildingId) params.buildingId = buildingId;
      if (apartmentNumber.trim()) params.apartmentNumber = apartmentNumber.trim();
      if (currentOnly) params.currentOnly = currentOnly;
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      const res = await api.listApartmentHistory(params);
      setRows((prev) => mergeInfinitePage(prev, res.data, page, isMobile, (row) => row.id));
      setPagination(res.pagination);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to load apartment history";
      setError(message);
      toaster.create({ title: message, type: "error" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, buildingId, apartmentNumber, currentOnly, page, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  function handleSort(
    column: ApartmentHistorySortKey,
    defaultDir: "asc" | "desc" = "asc",
    additive = false
  ) {
    toggleSort(column, defaultDir, additive);
    setPage(1);
    setExpanded(null);
  }

  useEffect(() => {
    const nextSearch = debouncedSearchInput.trim();
    const nextApartment = debouncedApartmentInput.trim().toUpperCase();
    if (nextSearch === search && nextApartment === apartmentNumber) return;
    setSearch(nextSearch);
    setApartmentNumber(nextApartment);
    setPage(1);
    setExpanded(null);
  }, [debouncedSearchInput, debouncedApartmentInput, search, apartmentNumber]);

  useEffect(() => {
    load();
  }, [load]);

  const showUnitTimeline = Boolean(buildingId && apartmentNumber.trim());
  const activeUnitTimelineKey = showUnitTimeline
    ? `${buildingId}:${apartmentNumber.trim()}`
    : null;
  const visibleUnitTimeline =
    activeUnitTimelineKey && unitTimelineKey === activeUnitTimelineKey
      ? unitTimeline
      : [];

  useEffect(() => {
    if (!showUnitTimeline || !activeUnitTimelineKey) {
      setUnitTimelineLoading(false);
      return;
    }
    let cancelled = false;
    setUnitTimelineLoading(true);
    api
      .getApartmentHistory(Number(buildingId), apartmentNumber.trim())
      .then((res) => {
        if (!cancelled) {
          setUnitTimeline(res.history);
          setUnitTimelineKey(activeUnitTimelineKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnitTimeline([]);
          setUnitTimelineKey(activeUnitTimelineKey);
        }
      })
      .finally(() => {
        if (!cancelled) setUnitTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeUnitTimelineKey, apartmentNumber, buildingId, showUnitTimeline]);

  function expandPanelProps(row: ApartmentHistoryEntry) {
    const rowKey = `${row.buildingId}:${row.apartmentNumber}`;
    if (activeUnitTimelineKey && rowKey === activeUnitTimelineKey) {
      return {
        unitHistory: visibleUnitTimeline,
        unitHistoryLoading: unitTimelineLoading,
      };
    }
    return {};
  }

  function toggleRow(id: number) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  const advancedFilters = (
    <>
      <FilterField label="Building" flex={FILTER_FLEX.wide} minW={0}>
        <SearchableSelect
          size="sm"
          value={buildingId}
          onChange={(nextBuildingId) => {
            setBuildingId(nextBuildingId);
            setPage(1);
            setExpanded(null);
          }}
          options={buildingFilterOptions}
          isLoading={buildingsLoading}
          placeholder="All buildings"
          searchPlaceholder="Search buildings…"
          emptyLabel="No buildings match"
        />
      </FilterField>

      <FilterField label="Apartment" flex={FILTER_FLEX.standard} minW={0}>
        <Input
          size="sm"
          placeholder="e.g. B19"
          value={apartmentInput}
          onChange={(e) => setApartmentInput(e.target.value)}
          borderRadius="md"
        />
      </FilterField>

      <FilterField label="Occupancy" flex={FILTER_FLEX.standard} minW={0} hideOnMobile>
        <SelectField
          size="sm"
          fieldProps={{
            value: currentOnly,
            onChange: (e) => {
              setCurrentOnly(e.target.value);
              setPage(1);
              setExpanded(null);
            },
            borderRadius: "md",
          }}
        >
          <option value="">All records</option>
          <option value="true">Current tenants only</option>
        </SelectField>
      </FilterField>
    </>
  );

  const selectedBuildingName =
    buildings.find((b) => String(b.id) === buildingId)?.name ?? "";

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      await exportTableData({
        scope,
        format,
        filenameBase: "apartment-history",
        columns: apartmentHistoryExportColumns,
        viewRows: rows,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listApartmentHistory({
              page: String(pageNum),
              limit: String(limit),
              ...(search.trim() ? { search: search.trim() } : {}),
              ...(buildingId ? { buildingId } : {}),
              ...(apartmentNumber.trim()
                ? { apartmentNumber: apartmentNumber.trim() }
                : {}),
              ...(currentOnly ? { currentOnly } : {}),
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

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome>
            <MobilePageChrome
        title="Occupancy ledger"
        description="Cross-building occupancy events. Open Apartments for unit-centric views."
        desktopActions={
          <>
            <DataTableExportButton
              entityLabel="apartment history"
              viewCount={rows.length}
              totalCount={pagination.total}
              loading={exporting}
              onExport={handleExport}
            />
            <Button asChild size="sm" variant="outline">
              <RouterLink to="/apartments">Apartments overview</RouterLink>
            </Button>
          </>
        }
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Tenant, customer #, apartment…"
        chips={[
          { key: "all", label: "All", active: currentOnly === "", onClick: () => { setCurrentOnly(""); setPage(1); setExpanded(null); } },
          { key: "current", label: "Current", active: currentOnly === "true", onClick: () => { setCurrentOnly("true"); setPage(1); setExpanded(null); } },
        ]}
        filterTitle="Filters"
        activeFilterCount={(buildingId ? 1 : 0) + (apartmentInput.trim() ? 1 : 0)}
        onClearFilters={() => {
          setBuildingId("");
          setApartmentInput("");
          setPage(1);
          setExpanded(null);
        }}
        filterContent={advancedFilters}
        sortOptions={[
          {
            key: "movedInAt",
            label: "Moved in",
            active: sorts[0]?.sortBy === "movedInAt",
            direction: sorts[0]?.sortBy === "movedInAt" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("movedInAt", "desc"),
          },
          {
            key: "customerName",
            label: "Tenant",
            active: sorts[0]?.sortBy === "customerName",
            direction: sorts[0]?.sortBy === "customerName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("customerName"),
          },
          {
            key: "apartmentNumber",
            label: "Apartment",
            active: sorts[0]?.sortBy === "apartmentNumber",
            direction: sorts[0]?.sortBy === "apartmentNumber" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("apartmentNumber"),
          },
        ]}
            />

            <FilterToolbar embedded>
          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
            <Input
              size="sm"
              placeholder="Tenant, customer #, apartment…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              borderRadius="md"
            />
          </FilterField>

          {advancedFilters}
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >

      {showUnitTimeline ? (
        <Box
          key={activeUnitTimelineKey ?? "unit-timeline"}
          bg="bg.panel"
          borderRadius={{ base: 0, lg: "lg" }}
          borderWidth={{ base: 0, lg: "1px" }}
          borderStyle="solid"
          borderColor="border"
          mx={{ base: -4, lg: 0 }}
          px={{ base: 4, lg: 5 }}
          py={5}
          minW={0}
        >
          <Text fontSize="sm" fontWeight="semibold" color="fg" mb={4} lineHeight="1.4">
            Occupancy timeline — {apartmentNumber}
            {selectedBuildingName ? ` · ${selectedBuildingName}` : ""}
          </Text>
          {unitTimelineLoading && visibleUnitTimeline.length === 0 ? (
            <ApartmentHistoryTimelineSkeleton steps={3} />
          ) : (
            <Box opacity={unitTimelineLoading ? 0.65 : 1} transition="opacity 0.2s ease">
              <ApartmentHistoryTimeline
                entries={visibleUnitTimeline}
                highlightEntryId={expanded ?? undefined}
                emptyMessage={`No occupancy history for apartment ${apartmentNumber}`}
              />
            </Box>
          )}
        </Box>
      ) : null}

      {error && (
        <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm" mx={{ base: 0, lg: 0 }}>
          {error}
        </Box>
      )}

      <DataTableCard
        loading={loading && rows.length === 0}
        loadingMore={loadingMore}
        loadedCount={rows.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="records"
      >
        {loading && rows.length === 0 ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" />}
            desktop={<DataTableLoadingSkeleton columns={9} fill />}
          />
        ) : rows.length === 0 ? (
          <EmptyState>No apartment history found</EmptyState>
        ) : (
          <Box opacity={loading ? 0.65 : 1} transition="opacity 0.2s ease" pointerEvents={loading ? "none" : undefined}>
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={rows}
                getKey={(row) => row.id}
                expandedId={expanded}
                renderCard={(row, isOpen) => (
                  <MobileDataCard
                    title={row.customerName}
                    subtitle={`${row.buildingName} · ${row.apartmentNumber}`}
                    trailing={
                      row.isCurrent ? (
                        <Badge colorPalette="green" variant="subtle">
                          Current
                        </Badge>
                      ) : (
                        <Badge colorPalette="gray" variant="subtle">
                          Former
                        </Badge>
                      )
                    }
                    isOpen={isOpen}
                    dimmed={expanded !== null && !isOpen}
                    onClick={() => toggleRow(row.id)}
                    fields={[
                      { label: "Customer #", value: row.customerNumber },
                      { label: "Moved in", value: formatDate(row.movedInAt) },
                      { label: "Moved out", value: row.movedOutAt ? formatDate(row.movedOutAt) : "—" },
                      { label: "Event", value: reasonLabel(row.reason) },
                    ]}
                  />
                )}
                renderExpanded={(row) => (
                  <ApartmentHistoryExpandPanel entry={row} {...expandPanelProps(row)} />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Building" column="buildingName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Apartment" column="apartmentNumber" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Tenant" column="customerName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Customer #" column="customerNumber" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="Moved in" column="movedInAt" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Moved out" column="movedOutAt" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Event" column="reason" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Status" column="customerStatus" sorts={sorts} onSort={handleSort} />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => {
                const isOpen = expanded === row.id;
                const isDimmed = expanded !== null && !isOpen;

                return (
                  <Fragment key={row.id}>
                    <Table.Row
                      bg={isOpen ? "brand.100" : undefined}
                      cursor="pointer"
                      opacity={isDimmed ? 0.45 : 1}
                      css={isOpen ? expandedRowMotion : undefined}
                      transition="opacity 0.25s ease"
                      onClick={() => toggleRow(row.id)}
                      _hover={{ bg: isOpen ? "brand.100" : "gray.50" }}
                    >
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                        {isOpen ? (
                          <Box color="brand.600">
                            <FiChevronDown size={16} />
                          </Box>
                        ) : (
                          <FiChevronRight size={16} />
                        )}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={row.buildingName} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" fontWeight="medium" textTransform="uppercase">
                        {row.apartmentNumber}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        <DisplayText value={row.customerName} />
                      </Table.Cell>
                      <Table.Cell
                        {...dataTableCellProps}
                        fontFamily="mono"
                        color="brand.700"
                        textTransform="uppercase"
                      >
                        {row.customerNumber}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {formatDate(row.movedInAt)}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {row.movedOutAt ? formatDate(row.movedOutAt) : "—"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} textTransform="capitalize">
                        {reasonLabel(row.reason)}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {row.isCurrent ? (
                          <Badge colorPalette="green" variant="subtle">
                            Current tenant
                          </Badge>
                        ) : (
                          <Badge colorPalette="gray" variant="subtle">
                            Former tenant
                          </Badge>
                        )}
                      </Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row
                        id={`apartment-expand-${row.id}`}
                        {...dataTableExpandRowProps}
                        css={expandPanelRowMotion}
                      >
                        <Table.Cell
                          colSpan={9}
                          p={4}
                          bg="brand.50"
                          borderBottom="2px solid"
                          borderColor="brand.200"
                        >
                          <ApartmentHistoryExpandPanel entry={row} {...expandPanelProps(row)} />
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
          </Box>
        )}
      </DataTableCard>
      </ListPageTableSection>
    </ListPageStack>
  );
}
