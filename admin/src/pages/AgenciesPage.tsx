import { Fragment, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
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
  Input,
  Table,
} from "@chakra-ui/react";
import { FiBriefcase, FiChevronDown, FiChevronRight } from "react-icons/fi";
import { api, type Agency, type ListPagination } from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canMutateAgencies } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { cacheKeyFromParams } from "../lib/moduleDataCache";
import {
  beginListLoad,
  endListLoad,
  seedListState,
  storeListState,
} from "../lib/listLoad";
import { useVisibilityRefresh } from "../hooks/useVisibilityRefresh";
import { AppDialog } from "../components/ui/AppDialog";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, ListPageStack, PageErrorBanner } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { AgencyExpandPanel } from "../components/agencies/AgencyExpandPanel";
import { DisplayText } from "../components/ui/DisplayText";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { agencyExportColumns } from "../lib/dataTableExportColumns";
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
  dataTableTitleColumnHeaderProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";

const PAGE_SIZE = 30;

type AgencySortKey = "name" | "contactPerson" | "phone" | "email" | "activeCustomers";

function agenciesListCacheKey(params: Record<string, string>) {
  return cacheKeyFromParams("agencies:list", params);
}

const DEFAULT_AGENCIES_CACHE_KEY = agenciesListCacheKey({
  page: "1",
  limit: String(PAGE_SIZE),
  sortBy: "name",
  sortDir: "asc",
});

export function AgenciesPage() {
  const { user } = useAuth();
  const isMobile = useMobileViewport();
  const canMutate = canMutateAgencies(user);
  const seeded = seedListState<Agency>(DEFAULT_AGENCIES_CACHE_KEY);
  const [agencies, setAgencies] = useState<Agency[]>(() => seeded.rows);
  const [pagination, setPagination] = useState<ListPagination>(() => {
    const p = seeded.pagination as ListPagination | null;
    return p || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 };
  });
  const [loading, setLoading] = useState(() => !seeded.hasCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const agenciesRef = useRef(agencies);
  agenciesRef.current = agencies;
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Agency | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");
  const { sorts, toggleSort, sortQuery } = useTableSort<AgencySortKey>({
    sortBy: "name",
    sortDir: "asc",
  });

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const append = isMobile && page > 1;
    beginListLoad({
      hasRows: agenciesRef.current.length > 0,
      append,
      silent: opts?.silent,
      setLoading,
      setLoadingMore,
    });
    setError("");
    try {
      const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
      if (search.trim()) params.search = search.trim();
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      const res = await api.listAgencies(params);
      const nextRows = mergeInfinitePage(
        agenciesRef.current,
        res.agencies,
        page,
        isMobile,
        (a) => a.id
      );
      setAgencies(nextRows);
      setPagination(res.pagination);
      if (!append) {
        storeListState(agenciesListCacheKey(params), nextRows, res.pagination);
      }
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load agencies");
      }
    } finally {
      endListLoad({ setLoading, setLoadingMore });
    }
  }, [search, page, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  function handleSort(
    column: AgencySortKey,
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
    void load();
  }, [load]);

  useVisibilityRefresh(() => {
    void load({ silent: true });
  });

  function resetForm() {
    setName("");
    setEmail("");
    setPhone("");
    setContactPerson("");
    setDiscountPercent("");
  }

  function openEdit(agency: Agency) {
    setEditing(agency);
    setName(agency.name);
    setEmail(agency.email);
    setPhone(agency.phone);
    setContactPerson(agency.contactPerson || "");
    setDiscountPercent(
      agency.discountPercent != null && agency.discountPercent > 0
        ? String(agency.discountPercent)
        : ""
    );
  }

  function closeEdit() {
    setEditing(null);
    resetForm();
  }

  function parseDiscountInput() {
    const raw = discountPercent.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("Discount percent must be a number between 0 and 100");
    }
    return n;
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createAgency({
        name,
        email,
        phone,
        contactPerson: contactPerson || undefined,
        discountPercent: parseDiscountInput(),
      });
      toaster.create({ title: "Agency created", type: "success" });
      resetForm();
      setShowForm(false);
      load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to create agency",
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
      await api.updateAgency(editing.id, {
        name,
        email,
        phone,
        contactPerson: contactPerson || undefined,
        discountPercent: parseDiscountInput(),
      });
      toaster.create({ title: "Agency updated", type: "success" });
      closeEdit();
      setExpanded(null);
      load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to update agency",
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
      if (search.trim()) filterTags.push(search.trim());
      await exportTableData({
        scope,
        format,
        filenameBase: "agencies",
        filterTags,
        columns: agencyExportColumns,
        viewRows: agencies,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listAgencies({
              page: String(pageNum),
              limit: String(limit),
              ...(search.trim() ? { search: search.trim() } : {}),
              sortBy: sortQuery.sortBy,
              sortDir: sortQuery.sortDir,
            }).then((res) => ({
              data: res.agencies,
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
        title="Agencies"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Name, email, phone…"
        sortOptions={[
          {
            key: "name",
            label: "Agency",
            active: sorts[0]?.sortBy === "name",
            direction: sorts[0]?.sortBy === "name" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("name"),
          },
          {
            key: "contactPerson",
            label: "Contact",
            active: sorts[0]?.sortBy === "contactPerson",
            direction: sorts[0]?.sortBy === "contactPerson" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("contactPerson"),
          },
          {
            key: "activeCustomers",
            label: "Customers",
            active: sorts[0]?.sortBy === "activeCustomers",
            direction: sorts[0]?.sortBy === "activeCustomers" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("activeCustomers", "desc"),
          },
        ]}
        desktopActions={
          <Flex gap={2} align="center" flexWrap="wrap">
            <DataTableExportButton
              entityLabel="agencies"
              viewCount={agencies.length}
              totalCount={pagination.total}
              loading={exporting}
              onExport={handleExport}
            />
            {canMutate ? (
              <Button colorPalette="brand" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                <FiBriefcase />
                Add Agency
              </Button>
            ) : null}
          </Flex>
        }
            />

            <FilterToolbar embedded>
          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
            <Input size="sm" placeholder="Name, email, phone…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} borderRadius="md" />
          </FilterField>
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >

      {showForm && (
        <Box bg="bg.panel" borderRadius="lg" border="1px solid" borderColor="border.muted" p={5}>
          <Heading size="sm" mb={4}>New agency</Heading>
          <AgencyForm
            name={name} setName={setName} email={email} setEmail={setEmail}
            phone={phone} setPhone={setPhone} contactPerson={contactPerson} setContactPerson={setContactPerson}
            discountPercent={discountPercent} setDiscountPercent={setDiscountPercent}
            onSubmit={handleCreate} submitting={submitting} onCancel={() => { setShowForm(false); resetForm(); }}
          />
        </Box>
      )}

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={agencies.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="agencies"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" fieldCount={2} />}
            desktop={<DataTableLoadingSkeleton columns={5} fill />}
          />
        ) : agencies.length === 0 ? (
          <EmptyState>No agencies found</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={agencies}
                getKey={(a) => a.id}
                expandedId={expanded}
                renderCard={(a, isOpen) => (
                  <MobileDataCard
                    title={a.name}
                    subtitle={a.contactPerson}
                    trailing={
                      <Badge colorPalette="brand" variant="subtle" px={2}>
                        {a.activeCustomers ?? 0}
                      </Badge>
                    }
                    isOpen={isOpen}
                    onClick={() => setExpanded(isOpen ? null : a.id)}
                    fields={[
                      { label: "Phone", value: a.phone },
                      { label: "Email", value: a.email },
                    ]}
                  />
                )}
                renderExpanded={(a) => (
                  <AgencyExpandPanel agency={a} onEdit={openEdit} canEdit={canMutate} />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Agency" column="name" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Contact" column="contactPerson" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Customers" column="activeCustomers" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Phone" column="phone" sorts={sorts} onSort={handleSort} />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {agencies.map((a) => {
                const isOpen = expanded === a.id;
                return (
                  <Fragment key={a.id}>
                    <Table.Row bg={isOpen ? "brand.50" : undefined} cursor="pointer" onClick={() => setExpanded(isOpen ? null : a.id)} _hover={{ bg: isOpen ? "brand.50" : "gray.50" }}>
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>{isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}</Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        <DisplayText value={a.name} fontWeight="semibold" />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={a.contactPerson} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <Badge colorPalette="brand" variant="subtle" px={2}>
                          {a.activeCustomers ?? 0}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted">{a.phone}</Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={5} p={3} bg="surface.50" borderBottom="none">
                          <AgencyExpandPanel agency={a} onEdit={openEdit} canEdit={canMutate} />
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

      <AppDialog open={!!editing} onOpenChange={(d) => !d.open && closeEdit()} maxW="lg">
        <Dialog.Header pr={12}>
          <Dialog.Title>Edit agency</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <AgencyForm
            name={name} setName={setName} email={email} setEmail={setEmail}
            phone={phone} setPhone={setPhone} contactPerson={contactPerson} setContactPerson={setContactPerson}
            discountPercent={discountPercent} setDiscountPercent={setDiscountPercent}
            onSubmit={handleUpdate} submitting={editSubmitting} onCancel={closeEdit} submitLabel="Save changes"
          />
        </Dialog.Body>
      </AppDialog>
    </ListPageStack>
  );
}

function AgencyForm({
  name, setName, email, setEmail, phone, setPhone, contactPerson, setContactPerson,
  discountPercent, setDiscountPercent,
  onSubmit, submitting, onCancel, submitLabel = "Save agency",
}: {
  name: string; setName: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  contactPerson: string; setContactPerson: (v: string) => void;
  discountPercent: string; setDiscountPercent: (v: string) => void;
  onSubmit: (e: FormEvent) => void; submitting: boolean; onCancel: () => void;
  submitLabel?: string;
}) {
  return (
    <form onSubmit={onSubmit}>
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
        <Field.Root required><Field.Label>Agency name</Field.Label><Input value={name} onChange={(e) => setName(e.target.value)} /></Field.Root>
        <Field.Root required><Field.Label>Contact person</Field.Label><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} /></Field.Root>
        <Field.Root required><Field.Label>Email</Field.Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field.Root>
        <Field.Root required><Field.Label>Phone</Field.Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field.Root>
        <Field.Root>
          <Field.Label>Discount % (optional)</Field.Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.01}
            placeholder="0"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
          />
        </Field.Root>
      </Grid>
      <Flex gap={2} mt={4}>
        <Button type="submit" colorPalette="brand" loading={submitting}>{submitLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </Flex>
    </form>
  );
}
