import { Fragment, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useVisibilityRefresh } from "../hooks/useVisibilityRefresh";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import {
  FiChevronDown,
  FiChevronRight,
  FiHome,
  FiServer,
} from "react-icons/fi";
import { api, formatDate, type Building, type ListPagination, type Pop } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canMutateConfig } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { cacheKeyFromParams } from "../lib/moduleDataCache";
import { getCachedPops, invalidateSharedLookups } from "../lib/sharedLookups";
import {
  beginListLoad,
  endListLoad,
  seedListState,
  storeListState,
} from "../lib/listLoad";
import { SelectField } from "../components/ui/SelectField";
import { DisplayText } from "../components/ui/DisplayText";
import { AppDialog } from "../components/ui/AppDialog";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { BuildingExpandPanel } from "../components/buildings/BuildingExpandPanel";
import { PopManageDialog } from "../components/buildings/PopManageDialog";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { buildingExportColumns } from "../lib/dataTableExportColumns";
import {
  exportTableData,
  fetchAllPaginatedRows,
  type ExportFormat,
  type ExportScope,
} from "../lib/tableExport";
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

const PAGE_SIZE = 30;
const TABLE_COL_SPAN = 9;

type BuildingSortKey = "name" | "popName" | "c2bCode" | "b2bCode" | "ipSetup" | "createdAt";

function buildingsListCacheKey(params: Record<string, string>) {
  return cacheKeyFromParams("buildings:list", params);
}

const DEFAULT_BUILDINGS_CACHE_KEY = buildingsListCacheKey({
  page: "1",
  limit: String(PAGE_SIZE),
  sortBy: "name",
  sortDir: "asc",
});

function normalizePrefix(value: string) {
  return value.trim().replace(/\.+$/, "");
}

export function BuildingsPage() {
  const { user } = useAuth();
  const isMobile = useMobileViewport();
  const canMutate = canMutateConfig(user);
  const seeded = seedListState<Building>(DEFAULT_BUILDINGS_CACHE_KEY);
  const [buildings, setBuildings] = useState<Building[]>(() => seeded.rows);
  const [pops, setPops] = useState<Pop[]>([]);
  const [pagination, setPagination] = useState<ListPagination>(() => {
    const p = seeded.pagination as ListPagination | null;
    return p || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 };
  });
  const [loading, setLoading] = useState(() => !seeded.hasCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const buildingsRef = useRef(buildings);
  buildingsRef.current = buildings;
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [ipSetup, setIpSetup] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showManagePops, setShowManagePops] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Building | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [formPopId, setFormPopId] = useState<number | "">("");
  const [name, setName] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [ipPrefixes, setIpPrefixes] = useState<string[]>([]);
  const [addressAttention, setAddressAttention] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressStreet2, setAddressStreet2] = useState("");
  const [addressPoBox, setAddressPoBox] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [addressCountry, setAddressCountry] = useState("Kenya");
  const { sorts, toggleSort, sortQuery } = useTableSort<BuildingSortKey>({
    sortBy: "name",
    sortDir: "asc",
  });

  const selectedPop = useMemo(
    () => (formPopId === "" ? undefined : pops.find((p) => p.id === formPopId)),
    [formPopId, pops]
  );

  function buildingAddressPayload() {
    const hasAny =
      addressAttention.trim() ||
      addressStreet.trim() ||
      addressStreet2.trim() ||
      addressPoBox.trim() ||
      addressCity.trim() ||
      addressState.trim() ||
      addressZip.trim() ||
      addressCountry.trim();
    return {
      addressAttention: addressAttention.trim(),
      addressStreet: addressStreet.trim(),
      addressStreet2: addressStreet2.trim(),
      addressPoBox: addressPoBox.trim(),
      addressCity: addressCity.trim(),
      addressState: addressState.trim(),
      addressZip: addressZip.trim(),
      addressCountry: hasAny ? addressCountry.trim() || "Kenya" : "",
    };
  }

  const loadPops = useCallback(async (opts?: { force?: boolean }) => {
    try {
      const res = await getCachedPops(opts);
      setPops(res.pops || []);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to load POPs",
        type: "error",
      });
    }
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const append = isMobile && page > 1;
    beginListLoad({
      hasRows: buildingsRef.current.length > 0,
      append,
      silent: opts?.silent,
      setLoading,
      setLoadingMore,
    });
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
      };
      if (search.trim()) params.search = search.trim();
      if (ipSetup) params.ipSetup = ipSetup;
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      const res = await api.listBuildings(params);
      const nextRows = mergeInfinitePage(
        buildingsRef.current,
        res.buildings,
        page,
        isMobile && !opts?.silent,
        (b) => b.id
      );
      setBuildings(nextRows);
      setPagination(res.pagination);
      if (!append) {
        storeListState(buildingsListCacheKey(params), nextRows, res.pagination);
      }
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load buildings");
      }
    } finally {
      endListLoad({ setLoading, setLoadingMore });
    }
  }, [search, ipSetup, page, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  function handleSort(
    column: BuildingSortKey,
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
    void loadPops();
  }, [loadPops]);

  useEffect(() => {
    load();
  }, [load]);

  useVisibilityRefresh(() => {
    void load({ silent: true });
    void loadPops({ force: true });
  });

  function setFormPopAndFilterPrefixes(nextPopId: number | "") {
    setFormPopId(nextPopId);
    if (nextPopId === "") {
      setIpPrefixes([]);
      return;
    }
    const pop = pops.find((p) => p.id === nextPopId);
    const pool = new Set((pop?.ipPrefixes || []).map(normalizePrefix));
    if (pop?.ipSetup !== "STATIC") {
      setIpPrefixes([]);
      return;
    }
    setIpPrefixes((prev) => prev.filter((p) => pool.has(normalizePrefix(p))));
  }

  function openEdit(building: Building) {
    setEditing(building);
    setFormPopId(building.popId);
    setName(building.name);
    setBuildingCode(building.buildingCode || "");
    setIpPrefixes(building.ipPrefixes || []);
    setAddressAttention(building.addressAttention || "");
    setAddressStreet(building.addressStreet || "");
    setAddressStreet2(building.addressStreet2 || "");
    setAddressPoBox(building.addressPoBox || "");
    setAddressCity(building.addressCity || "");
    setAddressState(building.addressState || "");
    setAddressZip(building.addressZip || "");
    setAddressCountry(building.addressCountry || "Kenya");
  }

  function closeEdit() {
    setEditing(null);
    resetForm();
  }

  function resetForm() {
    setFormPopId("");
    setName("");
    setBuildingCode("");
    setIpPrefixes([]);
    setAddressAttention("");
    setAddressStreet("");
    setAddressStreet2("");
    setAddressPoBox("");
    setAddressCity("");
    setAddressState("");
    setAddressZip("");
    setAddressCountry("Kenya");
  }

  function togglePrefix(prefix: string) {
    const key = normalizePrefix(prefix);
    setIpPrefixes((prev) => {
      const has = prev.some((p) => normalizePrefix(p) === key);
      if (has) return prev.filter((p) => normalizePrefix(p) !== key);
      return [...prev, prefix];
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (formPopId === "") {
      toaster.create({ title: "Select a POP", type: "warning" });
      return;
    }
    setSubmitting(true);
    try {
      const popIsStatic = selectedPop?.ipSetup === "STATIC";
      await api.createBuilding({
        name,
        popId: formPopId,
        buildingCode: buildingCode.trim() || null,
        ipPrefixes: popIsStatic ? ipPrefixes : [],
        ...buildingAddressPayload(),
      });
      toaster.create({ title: "Building created", type: "success" });
      resetForm();
      setShowForm(false);
      invalidateSharedLookups();
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to create building",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (formPopId === "") {
      toaster.create({ title: "Select a POP", type: "warning" });
      return;
    }
    setEditSubmitting(true);
    try {
      const popIsStatic = selectedPop?.ipSetup === "STATIC";
      await api.updateBuilding(editing.id, {
        name,
        popId: formPopId,
        buildingCode: buildingCode.trim() || null,
        ipPrefixes: popIsStatic ? ipPrefixes : [],
        ...buildingAddressPayload(),
      });
      toaster.create({ title: "Building updated", type: "success" });
      closeEdit();
      setExpanded(null);
      invalidateSharedLookups();
      void load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to update building",
        type: "error",
      });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const filterTags: string[] = [];
      if (ipSetup) filterTags.push(ipSetup);
      if (search.trim()) filterTags.push(search.trim());
      await exportTableData({
        scope,
        format,
        filenameBase: "buildings",
        filterTags,
        columns: buildingExportColumns,
        viewRows: buildings,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listBuildings({
              page: String(pageNum),
              limit: String(limit),
              ...(search.trim() ? { search: search.trim() } : {}),
              ...(ipSetup ? { ipSetup } : {}),
              sortBy: sortQuery.sortBy,
              sortDir: sortQuery.sortDir,
            }).then((res) => ({
              data: res.buildings,
              pagination: res.pagination,
            }))
          ),
      });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Export failed",
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
        title="Buildings"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Name or codes…"
        filterTitle="Filters"
        activeFilterCount={ipSetup ? 1 : 0}
        onClearFilters={() => { setIpSetup(""); setPage(1); setExpanded(null); }}
        filterContent={
          <FilterField label="IP setup" flex={FILTER_FLEX.standard} minW={0}>
            <SelectField
              size="sm"
              fieldProps={{
                value: ipSetup,
                onChange: (e) => { setIpSetup(e.target.value); setPage(1); setExpanded(null); },
                borderRadius: "md",
              }}
            >
              <option value="">All</option>
              <option value="STATIC">STATIC</option>
              <option value="PPOE">PPOE</option>
            </SelectField>
          </FilterField>
        }
        sortOptions={[
          {
            key: "name",
            label: "Name",
            active: sorts[0]?.sortBy === "name",
            direction: sorts[0]?.sortBy === "name" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("name"),
          },
          {
            key: "popName",
            label: "POP",
            active: sorts[0]?.sortBy === "popName",
            direction: sorts[0]?.sortBy === "popName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("popName"),
          },
          {
            key: "c2bCode",
            label: "C2B code",
            active: sorts[0]?.sortBy === "c2bCode",
            direction: sorts[0]?.sortBy === "c2bCode" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("c2bCode"),
          },
          {
            key: "ipSetup",
            label: "IP setup",
            active: sorts[0]?.sortBy === "ipSetup",
            direction: sorts[0]?.sortBy === "ipSetup" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("ipSetup"),
          },
          {
            key: "createdAt",
            label: "Created",
            active: sorts[0]?.sortBy === "createdAt",
            direction: sorts[0]?.sortBy === "createdAt" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("createdAt", "desc"),
          },
        ]}
        desktopActions={
          <Flex gap={2} align="center" flexWrap="wrap">
            <DataTableExportButton
              entityLabel="buildings"
              viewCount={buildings.length}
              totalCount={pagination.total}
              loading={exporting}
              onExport={handleExport}
            />
            {canMutate ? (
              <>
                <Button variant="outline" onClick={() => setShowManagePops(true)}>
                  <FiServer />
                  Manage POPs
                </Button>
                <Button colorPalette="brand" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                  <FiHome />
                  Add Building
                </Button>
              </>
            ) : null}
          </Flex>
        }
            />

            <FilterToolbar embedded>
          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
            <Input
              size="sm"
              placeholder="Name or codes…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              borderRadius="md"
            />
          </FilterField>
          <FilterField label="IP setup" flex={FILTER_FLEX.standard} minW={0} hideOnMobile>
            <SelectField
              size="sm"
              fieldProps={{
                value: ipSetup,
                onChange: (e) => { setIpSetup(e.target.value); setPage(1); setExpanded(null); },
                borderRadius: "md",
              }}
            >
              <option value="">All</option>
              <option value="STATIC">STATIC</option>
              <option value="PPOE">PPOE</option>
            </SelectField>
          </FilterField>
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >

      {showForm && (
        <Box bg="bg.panel" borderRadius="lg" border="1px solid" borderColor="border.muted" p={5}>
          <Heading size="sm" mb={4}>New building</Heading>
          <BuildingForm
            pops={pops}
            formPopId={formPopId}
            setFormPopId={setFormPopAndFilterPrefixes}
            selectedPop={selectedPop}
            name={name} setName={setName}
            buildingCode={buildingCode} setBuildingCode={setBuildingCode}
            ipPrefixes={ipPrefixes} togglePrefix={togglePrefix}
            addressAttention={addressAttention} setAddressAttention={setAddressAttention}
            addressStreet={addressStreet} setAddressStreet={setAddressStreet}
            addressStreet2={addressStreet2} setAddressStreet2={setAddressStreet2}
            addressPoBox={addressPoBox} setAddressPoBox={setAddressPoBox}
            addressCity={addressCity} setAddressCity={setAddressCity}
            addressState={addressState} setAddressState={setAddressState}
            addressZip={addressZip} setAddressZip={setAddressZip}
            addressCountry={addressCountry} setAddressCountry={setAddressCountry}
            onSubmit={handleCreate} submitting={submitting}
            onCancel={() => { setShowForm(false); resetForm(); }}
          />
        </Box>
      )}

      {error && (
        <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">{error}</Box>
      )}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={buildings.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="buildings"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={4} />}
            desktop={<DataTableLoadingSkeleton columns={TABLE_COL_SPAN} fill />}
          />
        ) : buildings.length === 0 ? (
          <EmptyState>No buildings found</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={buildings}
                getKey={(b) => b.id}
                expandedId={expanded}
                renderCard={(b, isOpen) => (
                  <MobileDataCard
                    title={b.name}
                    trailing={
                      <Badge colorPalette={b.ipSetup === "STATIC" ? "blue" : "purple"} variant="subtle">
                        {b.ipSetup}
                      </Badge>
                    }
                    isOpen={isOpen}
                    onClick={() => setExpanded(isOpen ? null : b.id)}
                    fields={[
                      { label: "POP", value: b.popName || "—" },
                      { label: "Bldg code", value: b.buildingCode || "—" },
                      { label: "C2B", value: b.c2bCode },
                      { label: "B2B", value: b.b2bCode },
                      { label: "DSTV", value: b.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder" },
                      { label: "OLTs", value: b.oltCount ? `${b.oltCount}` : "None" },
                      { label: "Added", value: b.createdAt ? formatDate(b.createdAt) : "—" },
                    ]}
                  />
                )}
                renderExpanded={(b) => (
                  <BuildingExpandPanel
                    building={b}
                    onEdit={openEdit}
                    onChanged={() => void load({ silent: true })}
                    canEdit={canMutate}
                  />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Building" column="name" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="POP" column="popName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="C2B" column="c2bCode" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="B2B" column="b2bCode" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="IP setup" column="ipSetup" sorts={sorts} onSort={handleSort} />
                <Table.ColumnHeader>DSTV</Table.ColumnHeader>
                <Table.ColumnHeader>OLTs</Table.ColumnHeader>
                <DataTableSortHeader label="Added" column="createdAt" sorts={sorts} onSort={handleSort} defaultDir="desc" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {buildings.map((b) => {
                const isOpen = expanded === b.id;
                return (
                  <Fragment key={b.id}>
                    <Table.Row
                      bg={isOpen ? "brand.50" : undefined}
                      cursor="pointer"
                      onClick={() => setExpanded(isOpen ? null : b.id)}
                      _hover={{ bg: isOpen ? "brand.50" : "gray.50" }}
                    >
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                        {isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        <DisplayText value={b.name} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={b.popName || "—"} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" textTransform="uppercase">{b.c2bCode}</Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontFamily="mono" textTransform="uppercase">{b.b2bCode}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge colorPalette={b.ipSetup === "STATIC" ? "blue" : "purple"} variant="subtle">
                          {b.ipSetup}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {b.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder"}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge colorPalette={(b.oltCount || 0) > 0 ? "green" : "gray"} variant="subtle">
                          {b.oltCount || 0}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {b.createdAt ? formatDate(b.createdAt) : "—"}
                      </Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={TABLE_COL_SPAN} p={3} bg="surface.50" borderBottom="none">
                          <BuildingExpandPanel
                            building={b}
                            onEdit={openEdit}
                            onChanged={() => void load({ silent: true })}
                            canEdit={canMutate}
                          />
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
      </ListPageTableSection>

      <AppDialog open={!!editing} onOpenChange={(d) => !d.open && closeEdit()} maxW="3xl">
        <Dialog.Header pr={12} flexShrink={0}>
          <Dialog.Title>Edit building</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body overflowY="auto" flex="1" minH={0} maxH="min(75vh, 720px)">
          <BuildingForm
            pops={pops}
            formPopId={formPopId}
            setFormPopId={setFormPopAndFilterPrefixes}
            selectedPop={selectedPop}
            name={name} setName={setName}
            buildingCode={buildingCode} setBuildingCode={setBuildingCode}
            ipPrefixes={ipPrefixes} togglePrefix={togglePrefix}
            addressAttention={addressAttention} setAddressAttention={setAddressAttention}
            addressStreet={addressStreet} setAddressStreet={setAddressStreet}
            addressStreet2={addressStreet2} setAddressStreet2={setAddressStreet2}
            addressPoBox={addressPoBox} setAddressPoBox={setAddressPoBox}
            addressCity={addressCity} setAddressCity={setAddressCity}
            addressState={addressState} setAddressState={setAddressState}
            addressZip={addressZip} setAddressZip={setAddressZip}
            addressCountry={addressCountry} setAddressCountry={setAddressCountry}
            onSubmit={handleUpdate} submitting={editSubmitting}
            onCancel={closeEdit}
            submitLabel="Save changes"
          />
        </Dialog.Body>
      </AppDialog>

      {canMutate ? (
        <PopManageDialog
          open={showManagePops}
          onOpenChange={setShowManagePops}
          onChanged={() => {
            invalidateSharedLookups();
            void loadPops({ force: true });
            void load({ silent: true });
          }}
        />
      ) : null}
    </ListPageStack>
  );
}

function BuildingForm({
  pops,
  formPopId,
  setFormPopId,
  selectedPop,
  name, setName,
  buildingCode, setBuildingCode,
  ipPrefixes, togglePrefix,
  addressAttention, setAddressAttention,
  addressStreet, setAddressStreet,
  addressStreet2, setAddressStreet2,
  addressPoBox, setAddressPoBox,
  addressCity, setAddressCity,
  addressState, setAddressState,
  addressZip, setAddressZip,
  addressCountry, setAddressCountry,
  onSubmit, submitting, onCancel,
  submitLabel = "Save building",
}: {
  pops: Pop[];
  formPopId: number | "";
  setFormPopId: (v: number | "") => void;
  selectedPop?: Pop;
  name: string; setName: (v: string) => void;
  buildingCode: string; setBuildingCode: (v: string) => void;
  ipPrefixes: string[];
  togglePrefix: (prefix: string) => void;
  addressAttention: string; setAddressAttention: (v: string) => void;
  addressStreet: string; setAddressStreet: (v: string) => void;
  addressStreet2: string; setAddressStreet2: (v: string) => void;
  addressPoBox: string; setAddressPoBox: (v: string) => void;
  addressCity: string; setAddressCity: (v: string) => void;
  addressState: string; setAddressState: (v: string) => void;
  addressZip: string; setAddressZip: (v: string) => void;
  addressCountry: string; setAddressCountry: (v: string) => void;
  onSubmit: (e: FormEvent) => void; submitting: boolean; onCancel: () => void;
  submitLabel?: string;
}) {
  const pool = selectedPop?.ipPrefixes || [];
  const showPrefixPicker = selectedPop?.ipSetup === "STATIC";
  const selectedKeys = new Set(ipPrefixes.map(normalizePrefix));
  const exampleApt = "401A";
  const popC2b = selectedPop?.c2bCode || "POP";
  const codePreview =
    buildingCode.trim() &&
    buildingCode.trim().toUpperCase() !== popC2b.toUpperCase()
      ? `${popC2b}-${buildingCode.trim().toUpperCase()}-${exampleApt}`
      : `${popC2b}-${exampleApt}`;

  return (
    <form onSubmit={onSubmit}>
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
        <Field.Root required>
          <Field.Label>POP</Field.Label>
          <SelectField
            fieldProps={{
              value: formPopId === "" ? "" : String(formPopId),
              onChange: (e) => {
                const raw = e.target.value;
                setFormPopId(raw === "" ? "" : Number(raw));
              },
            }}
          >
            <option value="">Select POP…</option>
            {pops.map((pop) => (
              <option key={pop.id} value={pop.id}>
                {pop.name} ({pop.ipSetup})
              </option>
            ))}
          </SelectField>
        </Field.Root>
        <Field.Root required>
          <Field.Label>Building name</Field.Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field.Root>
        <Field.Root>
          <Field.Label>Building code</Field.Label>
          <Input
            value={buildingCode}
            onChange={(e) => setBuildingCode(e.target.value.toUpperCase())}
            maxLength={10}
            placeholder="e.g. TGA (optional for 1:1 POPs)"
            fontFamily="mono"
          />
          <Text fontSize="xs" color="fg.muted" mt={1}>
            Customer numbers: <Text as="span" fontFamily="mono">{codePreview}</Text>
            {" "}— leave blank for Enaki/Colosseum/Skynest-style POP-APT numbers.
          </Text>
        </Field.Root>
        {selectedPop ? (
          <Box>
            <Text fontSize="sm" color="fg.muted" mt={{ base: 0, md: 8 }}>
              Inherited from POP: C2B <Text as="span" fontFamily="mono">{selectedPop.c2bCode}</Text>
              {" · "}B2B <Text as="span" fontFamily="mono">{selectedPop.b2bCode}</Text>
              {" · "}{selectedPop.ipSetup}
              {" · "}{selectedPop.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder"}
            </Text>
          </Box>
        ) : null}
        {showPrefixPicker ? (
          <Box gridColumn={{ md: "span 2" }}>
            <Field.Root>
              <Field.Label>Assigned IP prefixes</Field.Label>
              <Text fontSize="xs" color="fg.muted" mb={2}>
                Select from this POP&apos;s prefix pool. Optional — assign now or update later.
              </Text>
              {pool.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  This POP has no prefixes yet. Add them under Manage POPs.
                </Text>
              ) : (
                <Flex gap={2} flexWrap="wrap">
                  {pool.map((prefix) => {
                    const key = normalizePrefix(prefix);
                    const active = selectedKeys.has(key);
                    const display = prefix.endsWith(".") ? prefix : `${prefix}.`;
                    return (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={active ? "solid" : "outline"}
                        colorPalette={active ? "brand" : "gray"}
                        fontFamily="mono"
                        onClick={() => togglePrefix(prefix)}
                      >
                        {display}x
                      </Button>
                    );
                  })}
                </Flex>
              )}
              {ipPrefixes.length > 0 ? (
                <Stack gap={1} mt={3}>
                  <Text fontSize="xs" color="fg.muted">
                    {ipPrefixes.length} selected
                  </Text>
                </Stack>
              ) : null}
            </Field.Root>
          </Box>
        ) : selectedPop?.ipSetup === "PPOE" ? (
          <Box gridColumn={{ md: "span 2" }}>
            <Text fontSize="sm" color="fg.muted">
              PPOE POP — no static IP prefixes are assigned to buildings.
            </Text>
          </Box>
        ) : null}
      </Grid>

      <Box mt={6}>
        <Heading size="sm" mb={3}>Address</Heading>
        <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
          <Field.Root>
            <Field.Label>Attention</Field.Label>
            <Input
              value={addressAttention}
              onChange={(e) => setAddressAttention(e.target.value)}
              placeholder="Billing contact / building manager"
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>PO Box</Field.Label>
            <Input
              value={addressPoBox}
              onChange={(e) => setAddressPoBox(e.target.value)}
              placeholder="e.g. 12345-00100"
              autoComplete="off"
            />
          </Field.Root>
          <Box gridColumn={{ md: "span 2" }}>
            <Field.Root>
              <Field.Label>Street</Field.Label>
              <Input
                value={addressStreet}
                onChange={(e) => setAddressStreet(e.target.value)}
                placeholder="Street / building location"
                autoComplete="off"
              />
            </Field.Root>
          </Box>
          <Box gridColumn={{ md: "span 2" }}>
            <Field.Root>
              <Field.Label>Street 2</Field.Label>
              <Input
                value={addressStreet2}
                onChange={(e) => setAddressStreet2(e.target.value)}
                placeholder="Floor, wing, landmark"
                autoComplete="off"
              />
            </Field.Root>
          </Box>
          <Field.Root>
            <Field.Label>City</Field.Label>
            <Input
              value={addressCity}
              onChange={(e) => setAddressCity(e.target.value)}
              placeholder="Nairobi"
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>State / County</Field.Label>
            <Input
              value={addressState}
              onChange={(e) => setAddressState(e.target.value)}
              placeholder="Nairobi"
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>ZIP / Postal code</Field.Label>
            <Input
              value={addressZip}
              onChange={(e) => setAddressZip(e.target.value)}
              placeholder="00100"
              autoComplete="off"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>Country</Field.Label>
            <Input
              value={addressCountry}
              onChange={(e) => setAddressCountry(e.target.value)}
              placeholder="Kenya"
              autoComplete="off"
            />
          </Field.Root>
        </Grid>
      </Box>

      <Flex gap={2} mt={4}>
        <Button type="submit" colorPalette="brand" loading={submitting}>{submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </Flex>
    </form>
  );
}
