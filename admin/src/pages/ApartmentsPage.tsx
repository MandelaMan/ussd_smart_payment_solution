import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Button,
  Stack,
  Table,
} from "@chakra-ui/react";
import { FiChevronRight } from "react-icons/fi";
import {
  api,
  formatDate,
  type ApartmentUnit,
  type Building,
  type ListPagination,
} from "../lib/api";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { EmptyState, ListPageStack, PageErrorBanner } from "../components/ui/pageLayout";
import { SelectField } from "../components/ui/SelectField";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { DisplayText } from "../components/ui/DisplayText";
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  dataTableCellProps,
  dataTableEqualDataCodeColumnHeaderProps,
  dataTableTitleColumnHeaderProps,
} from "../components/ui/DataTable";
import { toaster } from "../components/ui/toaster";

const PAGE_SIZE = 30;

type ApartmentSortKey =
  | "buildingName"
  | "apartmentNumber"
  | "occupancyStatus"
  | "currentIp"
  | "tenureCount"
  | "lastActivityAt";

function apartmentPath(unit: ApartmentUnit, suffix = "") {
  return `/apartments/${unit.buildingId}/${encodeURIComponent(unit.apartmentNumber)}${suffix}`;
}

export function ApartmentsPage() {
  const navigate = useNavigate();
  const isMobile = useMobileViewport();
  const [rows, setRows] = useState<ApartmentUnit[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [buildingId, setBuildingId] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [page, setPage] = useState(1);
  const { sorts, toggleSort, sortQuery } = useTableSort<ApartmentSortKey>({
    sortBy: "buildingName",
    sortDir: "asc",
  });

  useEffect(() => {
    api
      .listBuildings({ limit: "100" })
      .then((res) => setBuildings(res.buildings || res.data || []))
      .catch(() => setBuildings([]));
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
        sortBy: sortQuery.sortBy,
        sortDir: sortQuery.sortDir,
      };
      if (search.trim()) params.search = search.trim();
      if (buildingId) params.buildingId = buildingId;
      if (occupancy) params.occupancy = occupancy;
      const res = await api.listApartments(params);
      setRows((prev) =>
        mergeInfinitePage(
          prev,
          res.data,
          page,
          isMobile,
          (row) => `${row.buildingId}:${row.apartmentNumber}`
        )
      );
      setPagination(res.pagination);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Failed to load apartments";
      setError(message);
      toaster.create({ title: message, type: "error" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [
    search,
    buildingId,
    occupancy,
    page,
    sortQuery.sortBy,
    sortQuery.sortDir,
    isMobile,
  ]);

  function handleSort(
    column: ApartmentSortKey,
    defaultDir: "asc" | "desc" = "asc",
    additive = false
  ) {
    toggleSort(column, defaultDir, additive);
    setPage(1);
  }

  useEffect(() => {
    const nextSearch = debouncedSearchInput.trim();
    if (nextSearch === search) return;
    setSearch(nextSearch);
    setPage(1);
  }, [debouncedSearchInput, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeFilterCount = (buildingId ? 1 : 0) + (occupancy ? 1 : 0);

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome>
            <MobilePageChrome
        title="Apartments"
        description="Occupancy by building"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Unit, building, IP…"
        filterTitle="Filters"
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setBuildingId("");
          setOccupancy("");
          setPage(1);
        }}
        filterContent={
          <Stack gap={3}>
            <FilterField label="Building" flex={FILTER_FLEX.standard} minW={0}>
              <SearchableSelect
                value={buildingId}
                onChange={(v) => {
                  setBuildingId(v);
                  setPage(1);
                }}
                options={buildingFilterOptions}
                placeholder="All buildings"
              />
            </FilterField>
            <FilterField label="Occupancy" flex={FILTER_FLEX.standard} minW={0}>
              <SelectField
                size="sm"
                fieldProps={{
                  value: occupancy,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                    setOccupancy(e.target.value);
                    setPage(1);
                  },
                  borderRadius: "md",
                }}
              >
                <option value="">All</option>
                <option value="occupied">Occupied</option>
                <option value="vacant">Vacant</option>
              </SelectField>
            </FilterField>
          </Stack>
        }
        sortOptions={[
          {
            key: "buildingName",
            label: "Building",
            active: sorts[0]?.sortBy === "buildingName",
            direction:
              sorts[0]?.sortBy === "buildingName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("buildingName"),
          },
          {
            key: "apartmentNumber",
            label: "Unit",
            active: sorts[0]?.sortBy === "apartmentNumber",
            direction:
              sorts[0]?.sortBy === "apartmentNumber"
                ? sorts[0].sortDir
                : undefined,
            onClick: () => handleSort("apartmentNumber"),
          },
          {
            key: "occupancyStatus",
            label: "Status",
            active: sorts[0]?.sortBy === "occupancyStatus",
            direction:
              sorts[0]?.sortBy === "occupancyStatus"
                ? sorts[0].sortDir
                : undefined,
            onClick: () => handleSort("occupancyStatus"),
          },
          {
            key: "lastActivityAt",
            label: "Last activity",
            active: sorts[0]?.sortBy === "lastActivityAt",
            direction:
              sorts[0]?.sortBy === "lastActivityAt"
                ? sorts[0].sortDir
                : undefined,
            onClick: () => handleSort("lastActivityAt", "desc"),
          },
        ]}
        desktopActions={
          <Button asChild size="sm" variant="outline">
            <RouterLink to="/apartments/ledger">Occupancy ledger</RouterLink>
          </Button>
        }
            />

            <Box display={{ base: "none", lg: "block" }}>
        <FilterToolbar embedded>
          <FilterField label="Building" flex={FILTER_FLEX.wide}>
            <SearchableSelect
              value={buildingId}
              onChange={(v) => {
                setBuildingId(v);
                setPage(1);
              }}
              options={buildingFilterOptions}
              placeholder="All buildings"
            />
          </FilterField>
          <FilterField label="Occupancy" flex={FILTER_FLEX.standard}>
            <SelectField
              size="sm"
              fieldProps={{
                value: occupancy,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  setOccupancy(e.target.value);
                  setPage(1);
                },
              }}
            >
              <option value="">All</option>
              <option value="occupied">Occupied</option>
              <option value="vacant">Vacant</option>
            </SelectField>
          </FilterField>
        </FilterToolbar>
            </Box>
          </ListPageStickyChrome>
        }
      >

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={rows.length}
        pagination={pagination}
        onPageChange={setPage}
        itemLabel="apartments"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={3} />}
            desktop={<DataTableLoadingSkeleton columns={6} fill />}
          />
        ) : rows.length === 0 ? (
          <EmptyState>No apartments found</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={rows}
                getKey={(u) => `${u.buildingId}:${u.apartmentNumber}`}
                renderCard={(u) => (
                  <MobileDataCard
                    title={u.apartmentNumber}
                    subtitle={u.buildingName}
                    trailing={
                      <Badge
                        colorPalette={u.occupied ? "green" : "gray"}
                        variant="subtle"
                      >
                        {u.occupied ? "Occupied" : "Vacant"}
                      </Badge>
                    }
                    onClick={() => navigate(apartmentPath(u))}
                    showChevron
                    fields={[
                      {
                        label: "IP",
                        value: u.currentIp || u.lastKnownIp || "—",
                      },
                      {
                        label: "Network",
                        value: u.ipSetup,
                      },
                      {
                        label: "Tenures",
                        value: String(u.tenureCount),
                      },
                    ]}
                  />
                )}
              />
            }
            desktop={
              <DataTable fixedLayout>
                <Table.Header>
                  <Table.Row>
                    <DataTableSortHeader
                      label="Unit"
                      column="apartmentNumber"
                      sorts={sorts}
                      onSort={handleSort}
                      headerProps={dataTableTitleColumnHeaderProps}
                    />
                    <DataTableSortHeader
                      label="Building"
                      column="buildingName"
                      sorts={sorts}
                      onSort={handleSort}
                    />
                    <DataTableSortHeader
                      label="Status"
                      column="occupancyStatus"
                      sorts={sorts}
                      onSort={handleSort}
                    />
                    <DataTableSortHeader
                      label="IP"
                      column="currentIp"
                      sorts={sorts}
                      onSort={handleSort}
                      headerProps={dataTableEqualDataCodeColumnHeaderProps}
                    />
                    <DataTableSortHeader
                      label="Tenures"
                      column="tenureCount"
                      sorts={sorts}
                      onSort={handleSort}
                    />
                    <DataTableSortHeader
                      label="Last activity"
                      column="lastActivityAt"
                      sorts={sorts}
                      onSort={handleSort}
                      defaultDir="desc"
                    />
                    <Table.ColumnHeader w="40px" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((unit) => (
                    <Table.Row
                      key={`${unit.buildingId}-${unit.apartmentNumber}`}
                      cursor="pointer"
                      _hover={{ bg: "bg.muted" }}
                      onClick={() => navigate(apartmentPath(unit))}
                    >
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={unit.apartmentNumber} fontWeight="semibold" />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={unit.buildingName} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge
                          colorPalette={unit.occupied ? "green" : "gray"}
                          variant="subtle"
                        >
                          {unit.occupied ? "Occupied" : "Vacant"}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText
                          value={unit.currentIp || unit.lastKnownIp || null}
                          fontFamily="mono"
                          fontSize="sm"
                        />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {unit.tenureCount}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {unit.lastActivityAt
                          ? formatDate(unit.lastActivityAt)
                          : "—"}
                      </Table.Cell>
                      <Table.Cell>
                        <Box color="fg.muted">
                          <FiChevronRight />
                        </Box>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </DataTable>
            }
          />
        )}
      </DataTableCard>
      </ListPageTableSection>
    </ListPageStack>
  );
}
