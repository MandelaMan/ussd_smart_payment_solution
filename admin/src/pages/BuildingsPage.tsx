import { Fragment, type FormEvent, useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
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
  IconButton,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import {
  FiChevronDown,
  FiChevronRight,
  FiHome,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import { api, formatDate, type Building, type ListPagination } from "../lib/api";
import { useAuth } from "../lib/auth";
import { canMutateConfig } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
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

type BuildingSortKey = "name" | "c2bCode" | "b2bCode" | "ipSetup" | "createdAt";

export function BuildingsPage() {
  const { user } = useAuth();
  const isMobile = useMobileViewport();
  const canMutate = canMutateConfig(user);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [ipSetup, setIpSetup] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Building | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [name, setName] = useState("");
  const [c2bCode, setC2bCode] = useState("");
  const [b2bCode, setB2bCode] = useState("");
  const [formIpSetup, setFormIpSetup] = useState<"STATIC" | "PPOE">("STATIC");
  const [formDstvSetup, setFormDstvSetup] = useState<"headend_coax" | "decoder">("decoder");
  const [prefixInput, setPrefixInput] = useState("");
  const [ipPrefixes, setIpPrefixes] = useState<string[]>([]);
  const { sorts, toggleSort, sortQuery } = useTableSort<BuildingSortKey>({
    sortBy: "name",
    sortDir: "asc",
  });

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
      if (ipSetup) params.ipSetup = ipSetup;
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      const res = await api.listBuildings(params);
      setBuildings((prev) =>
        mergeInfinitePage(prev, res.buildings, page, isMobile, (b) => b.id)
      );
      setPagination(res.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load buildings");
    } finally {
      setLoading(false);
      setLoadingMore(false);
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
    load();
  }, [load]);

  function openEdit(building: Building) {
    setEditing(building);
    setName(building.name);
    setC2bCode(building.c2bCode);
    setB2bCode(building.b2bCode);
    setFormIpSetup(building.ipSetup);
    setFormDstvSetup(building.dstvSetup || "decoder");
    setIpPrefixes(building.ipPrefixes || []);
    setPrefixInput("");
  }

  function closeEdit() {
    setEditing(null);
    resetForm();
  }

  function resetForm() {
    setName("");
    setC2bCode("");
    setB2bCode("");
    setFormIpSetup("STATIC");
    setFormDstvSetup("decoder");
    setIpPrefixes([]);
    setPrefixInput("");
  }

  function addPrefix() {
    const value = prefixInput.trim();
    if (!value) return;
    if (ipPrefixes.includes(value)) {
      toaster.create({ title: "Prefix already added", type: "warning" });
      return;
    }
    setIpPrefixes([...ipPrefixes, value]);
    setPrefixInput("");
  }

  function removePrefix(index: number) {
    setIpPrefixes(ipPrefixes.filter((_, i) => i !== index));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (formIpSetup === "STATIC" && ipPrefixes.length === 0) {
      toaster.create({ title: "Add at least one IP prefix for STATIC buildings", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api.createBuilding({
        name,
        c2bCode: c2bCode.toUpperCase(),
        b2bCode: b2bCode.toUpperCase(),
        ipSetup: formIpSetup,
        dstvSetup: formDstvSetup,
        ipPrefixes: formIpSetup === "STATIC" ? ipPrefixes : [],
      });
      toaster.create({ title: "Building created", type: "success" });
      resetForm();
      setShowForm(false);
      load();
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
    setEditSubmitting(true);
    try {
      await api.updateBuilding(editing.id, {
        name,
        c2bCode: c2bCode.toUpperCase(),
        b2bCode: b2bCode.toUpperCase(),
        ipSetup: formIpSetup,
        dstvSetup: formDstvSetup,
        ...(formIpSetup === "PPOE"
          ? { ipPrefixes: [] }
          : ipPrefixes.length > 0
            ? { ipPrefixes }
            : {}),
      });
      toaster.create({ title: "Building updated", type: "success" });
      closeEdit();
      setExpanded(null);
      load();
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
      await exportTableData({
        scope,
        format,
        filenameBase: "buildings",
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
              <Button colorPalette="brand" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                <FiHome />
                Add Building
              </Button>
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
            name={name} setName={setName}
            c2bCode={c2bCode} setC2bCode={setC2bCode}
            b2bCode={b2bCode} setB2bCode={setB2bCode}
            formIpSetup={formIpSetup} setFormIpSetup={setFormIpSetup} setIpPrefixes={setIpPrefixes}
            formDstvSetup={formDstvSetup} setFormDstvSetup={setFormDstvSetup}
            prefixInput={prefixInput} setPrefixInput={setPrefixInput}
            ipPrefixes={ipPrefixes} addPrefix={addPrefix} removePrefix={removePrefix}
            onSubmit={handleCreate} submitting={submitting}
            requireIpPrefixes
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
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={3} />}
            desktop={<DataTableLoadingSkeleton columns={6} fill />}
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
                      { label: "C2B", value: b.c2bCode },
                      { label: "B2B", value: b.b2bCode },
                      { label: "DSTV", value: b.dstvSetup === "headend_coax" ? "Headend coax" : "Decoder" },
                      { label: "Added", value: b.createdAt ? formatDate(b.createdAt) : "—" },
                    ]}
                  />
                )}
                renderExpanded={(b) => (
                  <BuildingExpandPanel building={b} onEdit={openEdit} canEdit={canMutate} />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Building" column="name" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="C2B" column="c2bCode" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="B2B" column="b2bCode" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="IP setup" column="ipSetup" sorts={sorts} onSort={handleSort} />
                <Table.ColumnHeader>DSTV setup</Table.ColumnHeader>
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
                      <Table.Cell {...dataTableCellProps} color="fg.muted">
                        {b.createdAt ? formatDate(b.createdAt) : "—"}
                      </Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={7} p={3} bg="surface.50" borderBottom="none">
                          <BuildingExpandPanel building={b} onEdit={openEdit} canEdit={canMutate} />
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

      <AppDialog open={!!editing} onOpenChange={(d) => !d.open && closeEdit()} maxW="2xl">
        <Dialog.Header pr={12}>
          <Dialog.Title>Edit building</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <BuildingForm
            name={name} setName={setName}
            c2bCode={c2bCode} setC2bCode={setC2bCode}
            b2bCode={b2bCode} setB2bCode={setB2bCode}
            formIpSetup={formIpSetup} setFormIpSetup={setFormIpSetup} setIpPrefixes={setIpPrefixes}
            formDstvSetup={formDstvSetup} setFormDstvSetup={setFormDstvSetup}
            prefixInput={prefixInput} setPrefixInput={setPrefixInput}
            ipPrefixes={ipPrefixes} addPrefix={addPrefix} removePrefix={removePrefix}
            onSubmit={handleUpdate} submitting={editSubmitting}
            onCancel={closeEdit}
            submitLabel="Save changes"
            requireIpPrefixes={false}
          />
        </Dialog.Body>
      </AppDialog>
    </ListPageStack>
  );
}

function BuildingForm({
  name, setName, c2bCode, setC2bCode, b2bCode, setB2bCode,
  formIpSetup, setFormIpSetup, formDstvSetup, setFormDstvSetup, setIpPrefixes, prefixInput, setPrefixInput,
  ipPrefixes, addPrefix, removePrefix, onSubmit, submitting, onCancel,
  submitLabel = "Save building", requireIpPrefixes = false,
}: {
  name: string; setName: (v: string) => void;
  c2bCode: string; setC2bCode: (v: string) => void;
  b2bCode: string; setB2bCode: (v: string) => void;
  formIpSetup: "STATIC" | "PPOE"; setFormIpSetup: (v: "STATIC" | "PPOE") => void;
  formDstvSetup: "headend_coax" | "decoder";
  setFormDstvSetup: (v: "headend_coax" | "decoder") => void;
  setIpPrefixes: (v: string[]) => void;
  prefixInput: string; setPrefixInput: (v: string) => void;
  ipPrefixes: string[]; addPrefix: () => void; removePrefix: (i: number) => void;
  onSubmit: (e: FormEvent) => void; submitting: boolean; onCancel: () => void;
  submitLabel?: string;
  requireIpPrefixes?: boolean;
}) {
  const ipPrefixesRequired = requireIpPrefixes ?? false;
  return (
    <form onSubmit={onSubmit}>
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
        <Field.Root required>
          <Field.Label>Building name</Field.Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field.Root>
        <Field.Root required>
          <Field.Label>IP setup</Field.Label>
          <SelectField
            fieldProps={{
              value: formIpSetup,
              onChange: (e) => {
                const v = e.target.value as "STATIC" | "PPOE";
                setFormIpSetup(v);
                if (v === "PPOE") setIpPrefixes([]);
              },
            }}
          >
            <option value="STATIC">STATIC</option>
            <option value="PPOE">PPOE</option>
          </SelectField>
        </Field.Root>
        <Field.Root required>
          <Field.Label>DSTV setup</Field.Label>
          <SelectField
            fieldProps={{
              value: formDstvSetup,
              onChange: (e) =>
                setFormDstvSetup(e.target.value as "headend_coax" | "decoder"),
            }}
          >
            <option value="headend_coax">Headend coax</option>
            <option value="decoder">Decoder</option>
          </SelectField>
        </Field.Root>
        <Field.Root required>
          <Field.Label>C2B code</Field.Label>
          <Input value={c2bCode} onChange={(e) => setC2bCode(e.target.value.toUpperCase())} maxLength={10} />
        </Field.Root>
        <Field.Root required>
          <Field.Label>B2B code</Field.Label>
          <Input value={b2bCode} onChange={(e) => setB2bCode(e.target.value.toUpperCase())} maxLength={10} />
        </Field.Root>
        {formIpSetup === "STATIC" && (
          <Box gridColumn={{ md: "span 2" }}>
            <Field.Root required={ipPrefixesRequired}>
              <Field.Label>IP prefixes</Field.Label>
              <Flex gap={2} mb={2}>
                <Input
                  value={prefixInput}
                  onChange={(e) => setPrefixInput(e.target.value)}
                  placeholder="e.g. 10.12.10."
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPrefix(); } }}
                />
                <Button type="button" variant="outline" onClick={addPrefix}><FiPlus /> Add</Button>
              </Flex>
              <Stack gap={1}>
                {ipPrefixes.map((p, i) => (
                  <Flex key={p} align="center" justify="space-between" bg="bg.subtle" px={3} py={1.5} borderRadius="md" fontSize="sm">
                    <Text fontFamily="mono">{p.endsWith(".") ? p : `${p}.`}x</Text>
                    <IconButton aria-label="Remove" size="xs" variant="ghost" colorPalette="red" onClick={() => removePrefix(i)}>
                      <FiTrash2 />
                    </IconButton>
                  </Flex>
                ))}
              </Stack>
            </Field.Root>
          </Box>
        )}
      </Grid>
      <Flex gap={2} mt={4}>
        <Button type="submit" colorPalette="brand" loading={submitting}>{submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </Flex>
    </form>
  );
}
