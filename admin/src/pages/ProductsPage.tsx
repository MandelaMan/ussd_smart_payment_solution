import { Fragment, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useVisibilityRefresh } from "../hooks/useVisibilityRefresh";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import {
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Table,
  Text,
} from "@chakra-ui/react";
import { FiChevronDown, FiChevronRight, FiPackage } from "react-icons/fi";
import {
  api,
  formatCurrency,
  type Building,
  type ListPagination,
  type PackageCategory,
  type Product,
} from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canMutateConfig } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { cacheKeyFromParams } from "../lib/moduleDataCache";
import {
  getCachedBuildings,
  getCachedPackageCatalog,
} from "../lib/sharedLookups";
import {
  beginListLoad,
  endListLoad,
  seedListState,
  storeListState,
} from "../lib/listLoad";
import { SelectField } from "../components/ui/SelectField";
import { AppDialog } from "../components/ui/AppDialog";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { DataTableLoadingSkeleton, MobileCardListSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { EmptyState, ListPageStack } from "../components/ui/pageLayout";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { ProductExpandPanel } from "../components/products/ProductExpandPanel";
import { DisplayText } from "../components/ui/DisplayText";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import { productExportColumns } from "../lib/dataTableExportColumns";
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
import { TextStatus } from "../components/ui/TextStatus";

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const PAGE_SIZE = 30;

type ProductSortKey =
  | "categoryName"
  | "planName"
  | "buildingName"
  | "mbps"
  | "extraBandwidth"
  | "price"
  | "isActive"
  | "paymentFrequency";

function productsListCacheKey(params: Record<string, string>) {
  return cacheKeyFromParams("products:list", params);
}

const DEFAULT_PRODUCTS_CACHE_KEY = productsListCacheKey({
  page: "1",
  limit: String(PAGE_SIZE),
  activeOnly: "false",
  sortBy: "buildingName",
  sortDir: "asc",
});

export function ProductsPage() {
  const { user } = useAuth();
  const isMobile = useMobileViewport();
  const canMutate = canMutateConfig(user);
  const seeded = seedListState<Product>(DEFAULT_PRODUCTS_CACHE_KEY);
  const [products, setProducts] = useState<Product[]>(() => seeded.rows);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [catalog, setCatalog] = useState<PackageCategory[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [pagination, setPagination] = useState<ListPagination>(() => {
    const p = seeded.pagination as ListPagination | null;
    return p || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 };
  });
  const [loading, setLoading] = useState(() => !seeded.hasCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const productsRef = useRef(products);
  productsRef.current = products;
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearchInput = useDebouncedValue(searchInput);
  const [filterBuildingId, setFilterBuildingId] = useState("");
  const [filterPaymentFrequency, setFilterPaymentFrequency] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [categoryId, setCategoryId] = useState("");
  const [planId, setPlanId] = useState("");
  const [paymentFrequency, setPaymentFrequency] = useState("monthly");
  const [buildingId, setBuildingId] = useState("");
  const [mbps, setMbps] = useState("");
  const [price, setPrice] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [extraBandwidth, setExtraBandwidth] = useState("");
  const { sorts, toggleSort, sortQuery } = useTableSort<ProductSortKey>([
    { sortBy: "buildingName", sortDir: "asc" },
    { sortBy: "planName", sortDir: "asc" },
    { sortBy: "paymentFrequency", sortDir: "asc" },
  ]);

  const selectedCategory = catalog.find((c) => String(c.id) === categoryId);
  const isDstvOnly = selectedCategory?.code === "dstv_only";
  const selectedPlan = selectedCategory?.plans.find((p) => String(p.id) === planId);
  const selectedVariant = selectedPlan?.variants.find(
    (v) => v.paymentFrequency === paymentFrequency
  );

  useEffect(() => {
    if (!isDstvOnly || !selectedCategory?.plans?.length) return;
    const firstPlan = selectedCategory.plans[0];
    if (!planId || !selectedCategory.plans.some((p) => String(p.id) === planId)) {
      setPlanId(String(firstPlan.id));
    }
    setExtraBandwidth("0");
    setMbps("0");
  }, [isDstvOnly, selectedCategory, planId]);

  useEffect(() => {
    if (!selectedVariant) return;
    if (isDstvOnly) {
      setMbps("0");
      return;
    }
    if (!mbps.trim()) {
      setMbps(String(selectedVariant.defaultMbps));
    }
  }, [selectedVariant, mbps, isDstvOnly]);

  const load = useCallback(async (options?: { bustCache?: boolean; silent?: boolean }) => {
    const append = isMobile && page > 1 && !options?.bustCache;
    beginListLoad({
      hasRows: productsRef.current.length > 0 && !options?.bustCache,
      append,
      silent: options?.silent,
      setLoading,
      setLoadingMore,
    });
    setError("");
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(PAGE_SIZE),
        activeOnly: "false",
      };
      if (search.trim()) params.search = search.trim();
      if (filterBuildingId) params.buildingId = filterBuildingId;
      if (filterPaymentFrequency) params.paymentFrequency = filterPaymentFrequency;
      params.sortBy = sortQuery.sortBy;
      params.sortDir = sortQuery.sortDir;
      if (options?.bustCache) params._ts = String(Date.now());
      const res = await api.listProducts(params);
      const nextRows = mergeInfinitePage(
        productsRef.current,
        res.products,
        page,
        isMobile && !options?.bustCache && !options?.silent,
        (p) => p.id
      );
      setProducts(nextRows);
      setPagination(res.pagination);
      if (!append && !options?.bustCache) {
        const cacheParams = { ...params };
        delete cacheParams._ts;
        storeListState(productsListCacheKey(cacheParams), nextRows, res.pagination);
      }
    } catch (e) {
      if (!options?.silent) {
        setError(e instanceof Error ? e.message : "Failed to load packages");
      }
    } finally {
      endListLoad({ setLoading, setLoadingMore });
    }
  }, [search, filterBuildingId, filterPaymentFrequency, page, sortQuery.sortBy, sortQuery.sortDir, isMobile]);

  function handleSort(
    column: ProductSortKey,
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

  useEffect(() => {
    let cancelled = false;
    const hasLookups = buildings.length > 0 && catalog.length > 0;
    if (!hasLookups) setLookupsLoading(true);
    Promise.all([getCachedBuildings(), getCachedPackageCatalog()])
      .then(([b, c]) => {
        if (cancelled) return;
        setBuildings(b.buildings);
        setCatalog(c.categories);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLookupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount lookups
  }, []);

  useVisibilityRefresh(() => {
    void load({ silent: true });
  });

  const buildingFilterOptions = useMemo(
    () => [
      { value: "", label: "All buildings" },
      ...buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: `${b.ipSetup} · ${b.dstvSetup === "headend_coax" ? "Headend" : "Decoder"} · C2B ${b.c2bCode}`,
        keywords: `${b.c2bCode} ${b.b2bCode}`,
      })),
    ],
    [buildings]
  );

  function resetForm() {
    setCategoryId("");
    setPlanId("");
    setPaymentFrequency("monthly");
    setBuildingId(filterBuildingId || "");
    setMbps("");
    setPrice("");
    setMonthlyPrice("");
    setExtraBandwidth("");
    setIsActive(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setCategoryId(product.categoryId ? String(product.categoryId) : "");
    setPlanId(product.planId ? String(product.planId) : "");
    setPaymentFrequency(product.paymentFrequency);
    setBuildingId(String(product.buildingId));
    setMbps(String(product.mbps));
    setPrice(String(product.price));
    setMonthlyPrice(String(product.monthlyPrice ?? product.price));
    setExtraBandwidth(String(product.extraBandwidth ?? 0));
    setIsActive(Boolean(product.isActive));
  }

  function closeEdit() {
    setEditing(null);
    resetForm();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!selectedVariant) {
      toaster.create({ title: "Select a valid package variant", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api.createProduct({
        planVariantId: selectedVariant.id,
        buildingId: Number(buildingId),
        mbps: isDstvOnly
          ? 0
          : mbps
            ? Number(mbps)
            : Number(selectedVariant.defaultMbps),
        price: Number(price),
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : undefined,
        extraBandwidth: isDstvOnly ? 0 : extraBandwidth ? Number(extraBandwidth) : 0,
      });
      toaster.create({ title: "Building price saved", type: "success" });
      resetForm();
      setShowForm(false);
      await load({ bustCache: true });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to save package price",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!selectedVariant) {
      toaster.create({ title: "Select a valid package variant", type: "error" });
      return;
    }
    if (!buildingId) {
      toaster.create({ title: "Select a building", type: "error" });
      return;
    }
    setEditSubmitting(true);
    const expandedId = editing.id;
    try {
      const res = await api.updateProduct(editing.id, {
        planVariantId: selectedVariant.id,
        buildingId: Number(buildingId),
        mbps: isDstvOnly ? 0 : Number(mbps),
        price: Number(price),
        monthlyPrice: monthlyPrice ? Number(monthlyPrice) : Number(price),
        extraBandwidth: isDstvOnly ? 0 : extraBandwidth ? Number(extraBandwidth) : 0,
        isActive,
      });
      if (res.product) {
        setProducts((prev) =>
          prev.map((p) => (p.id === res.product.id ? res.product : p))
        );
      }
      toaster.create({ title: "Package updated", type: "success" });
      closeEdit();
      setExpanded(expandedId);
      await load({ bustCache: true });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to update package",
        type: "error",
      });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingProduct) return;
    setDeleteSubmitting(true);
    try {
      await api.deleteProduct(deletingProduct.id);
      toaster.create({ title: "Package deleted", type: "success" });
      setDeletingProduct(null);
      if (expanded === deletingProduct.id) setExpanded(null);
      if (editing?.id === deletingProduct.id) closeEdit();
      await load({ bustCache: true });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to delete package",
        type: "error",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function handleExport(scope: ExportScope, format: ExportFormat) {
    setExporting(true);
    try {
      const filterTags: string[] = [];
      const bldg = buildings.find((b) => String(b.id) === filterBuildingId);
      if (bldg) filterTags.push(bldg.name);
      if (filterPaymentFrequency) filterTags.push(filterPaymentFrequency);
      if (search.trim()) filterTags.push(search.trim());
      await exportTableData({
        scope,
        format,
        filenameBase: "packages",
        filterTags,
        columns: productExportColumns,
        viewRows: products,
        fetchAllRows: () =>
          fetchAllPaginatedRows((pageNum, limit) =>
            api.listProducts({
              page: String(pageNum),
              limit: String(limit),
              activeOnly: "false",
              ...(search.trim() ? { search: search.trim() } : {}),
              ...(filterBuildingId ? { buildingId: filterBuildingId } : {}),
              ...(filterPaymentFrequency
                ? { paymentFrequency: filterPaymentFrequency }
                : {}),
              sortBy: sortQuery.sortBy,
              sortDir: sortQuery.sortDir,
            }).then((res) => ({
              data: res.products,
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
        title="Packages"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Package name…"
        sortOptions={[
          {
            key: "categoryName",
            label: "Category",
            active: sorts[0]?.sortBy === "categoryName",
            direction: sorts[0]?.sortBy === "categoryName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("categoryName"),
          },
          {
            key: "buildingName",
            label: "Building",
            active: sorts[0]?.sortBy === "buildingName",
            direction: sorts[0]?.sortBy === "buildingName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("buildingName"),
          },
          {
            key: "price",
            label: "Price",
            active: sorts[0]?.sortBy === "price",
            direction: sorts[0]?.sortBy === "price" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("price", "desc"),
          },
          {
            key: "mbps",
            label: "Speed",
            active: sorts[0]?.sortBy === "mbps",
            direction: sorts[0]?.sortBy === "mbps" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("mbps", "desc"),
          },
        ]}
        desktopActions={
          <Flex gap={2} align="center" flexWrap="wrap">
            <DataTableExportButton
              entityLabel="packages"
              viewCount={products.length}
              totalCount={pagination.total}
              loading={exporting}
              onExport={handleExport}
            />
            {canMutate ? (
              <Button colorPalette="brand" onClick={() => { setShowForm(!showForm); resetForm(); }}>
                <FiPackage />
                Set building price
              </Button>
            ) : null}
          </Flex>
        }
            />

            <FilterToolbar embedded>
          <FilterField label="Search" flex={FILTER_FLEX.search} minW={0} hideOnMobile>
            <Input size="sm" placeholder="Package name…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} borderRadius="md" />
          </FilterField>
          <FilterField label="Building" flex={FILTER_FLEX.wide} minW={0} hideOnMobile>
            <SearchableSelect
              size="sm"
              value={filterBuildingId}
              onChange={(nextBuildingId) => {
                setFilterBuildingId(nextBuildingId);
                setPage(1);
                setExpanded(null);
              }}
              options={buildingFilterOptions}
              isLoading={lookupsLoading}
              placeholder="All buildings"
              searchPlaceholder="Search buildings…"
              emptyLabel="No buildings match"
            />
          </FilterField>
          <FilterField label="Billing" flex={FILTER_FLEX.standard} minW={0} hideOnMobile>
            <SelectField
              size="sm"
              fieldProps={{
                value: filterPaymentFrequency,
                onChange: (e) => {
                  setFilterPaymentFrequency(e.target.value);
                  setPage(1);
                  setExpanded(null);
                },
                borderRadius: "md",
              }}
            >
              <option value="">All billing</option>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SelectField>
          </FilterField>
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >

      {showForm && (
        <Box bg="bg.panel" borderRadius="lg" border="1px solid" borderColor="border.muted" p={5}>
          <Heading size="sm" mb={4}>Set building price</Heading>
          <ProductForm
            catalog={catalog}
            lookupsLoading={lookupsLoading}
            categoryId={categoryId} setCategoryId={setCategoryId}
            planId={planId} setPlanId={setPlanId}
            paymentFrequency={paymentFrequency} setPaymentFrequency={setPaymentFrequency}
            buildingId={buildingId} setBuildingId={setBuildingId}
            mbps={mbps} setMbps={setMbps}
            price={price} setPrice={setPrice}
            monthlyPrice={monthlyPrice} setMonthlyPrice={setMonthlyPrice}
            extraBandwidth={extraBandwidth} setExtraBandwidth={setExtraBandwidth}
            buildings={buildings} isActive={isActive} setIsActive={setIsActive}
            selectedCategory={selectedCategory} selectedPlan={selectedPlan} selectedVariant={selectedVariant}
            isDstvOnly={isDstvOnly}
            readOnlyStructure={false} showStatus={false}
            onSubmit={handleCreate} submitting={submitting}
            onCancel={() => { setShowForm(false); resetForm(); }}
          />
        </Box>
      )}

      {error && <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">{error}</Box>}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={products.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="packages"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton fill variant="card" />}
            desktop={<DataTableLoadingSkeleton columns={9} fill />}
          />
        ) : products.length === 0 ? (
          <EmptyState>No packages found</EmptyState>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={products}
                getKey={(p) => p.id}
                expandedId={expanded}
                emptyMessage={
                  <Text color="fg.subtle" fontSize="sm">No packages found</Text>
                }
                renderCard={(p, isOpen) => (
                  <MobileDataCard
                    title={p.planName || p.name}
                    subtitle={p.categoryName}
                    trailing={<TextStatus status={p.isActive ? "Active" : "Inactive"} />}
                    isOpen={isOpen}
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    fields={[
                      { label: "Building", value: p.buildingName },
                      {
                        label: "Speed",
                        value:
                          p.categoryCode === "dstv_only"
                            ? "—"
                            : `${p.mbps + Number(p.extraBandwidth || 0)} Mbps${
                                Number(p.extraBandwidth || 0) > 0
                                  ? ` (${p.mbps} + ${Number(p.extraBandwidth || 0)} extra)`
                                  : ""
                              }`,
                      },
                      { label: "Price", value: formatCurrency(p.price) },
                      { label: "Billing", value: p.paymentFrequency },
                    ]}
                  />
                )}
                renderExpanded={(p) => (
                  <ProductExpandPanel
                    product={p}
                    onEdit={openEdit}
                    onDelete={canMutate ? setDeletingProduct : undefined}
                    canEdit={canMutate}
                    deleting={deleteSubmitting && deletingProduct?.id === p.id}
                  />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout scrollMinW="1080px">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader {...dataTableTitleColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                <DataTableSortHeader label="Category" column="categoryName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Plan" column="planName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Building" column="buildingName" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Speed" column="mbps" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Extra bandwidth" column="extraBandwidth" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Price" column="price" sorts={sorts} onSort={handleSort} defaultDir="desc" />
                <DataTableSortHeader label="Status" column="isActive" sorts={sorts} onSort={handleSort} />
                <DataTableSortHeader label="Billing" column="paymentFrequency" sorts={sorts} onSort={handleSort} />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {products.map((p) => {
                const isOpen = expanded === p.id;
                const isDstvOnlyRow = p.categoryCode === "dstv_only";
                return (
                  <Fragment key={p.id}>
                    <Table.Row bg={isOpen ? "brand.50" : undefined} cursor="pointer" onClick={() => setExpanded(isOpen ? null : p.id)} _hover={{ bg: isOpen ? "brand.50" : "gray.50" }}>
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>{isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={p.categoryName} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold">
                        <DisplayText value={p.planName || p.name} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <DisplayText value={p.buildingName} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {isDstvOnlyRow
                          ? "—"
                          : `${p.mbps + Number(p.extraBandwidth || 0)} Mbps`}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        {isDstvOnlyRow ? "—" : `${Number(p.extraBandwidth || 0)} Mbps`}
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} fontWeight="semibold" whiteSpace="nowrap">{formatCurrency(p.price)}</Table.Cell>
                      <Table.Cell {...dataTableCellProps}>
                        <TextStatus status={p.isActive ? "Active" : "Inactive"} />
                      </Table.Cell>
                      <Table.Cell {...dataTableCellProps} color="fg.muted" textTransform="capitalize">{p.paymentFrequency}</Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row {...dataTableExpandRowProps}>
                        <Table.Cell colSpan={9} p={3} bg="surface.50" borderBottom="none">
                          <ProductExpandPanel
                            product={p}
                            onEdit={openEdit}
                            onDelete={canMutate ? setDeletingProduct : undefined}
                            canEdit={canMutate}
                            deleting={deleteSubmitting && deletingProduct?.id === p.id}
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

      <AppDialog open={!!editing} onOpenChange={(d) => !d.open && closeEdit()} maxW="2xl">
        <Dialog.Header borderBottomWidth="1px" borderColor="border.muted" pr={12}>
          <Dialog.Title>Edit package</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body py={5} overflowY="auto" maxH="min(70vh, 640px)" minW={0}>
          <ProductForm
            catalog={catalog}
            lookupsLoading={lookupsLoading}
            categoryId={categoryId} setCategoryId={setCategoryId}
            planId={planId} setPlanId={setPlanId}
            paymentFrequency={paymentFrequency} setPaymentFrequency={setPaymentFrequency}
            buildingId={buildingId} setBuildingId={setBuildingId}
            mbps={mbps} setMbps={setMbps}
            price={price} setPrice={setPrice}
            monthlyPrice={monthlyPrice} setMonthlyPrice={setMonthlyPrice}
            extraBandwidth={extraBandwidth} setExtraBandwidth={setExtraBandwidth}
            buildings={buildings} isActive={isActive} setIsActive={setIsActive}
            selectedCategory={selectedCategory} selectedPlan={selectedPlan} selectedVariant={selectedVariant}
            isDstvOnly={isDstvOnly}
            readOnlyStructure={false} showStatus
            onSubmit={handleUpdate} submitting={editSubmitting} onCancel={closeEdit}
            submitLabel="Save changes"
          />
        </Dialog.Body>
      </AppDialog>

      <AppDialog
        open={Boolean(deletingProduct)}
        onOpenChange={(d) => {
          if (!d.open && !deleteSubmitting) setDeletingProduct(null);
        }}
        maxW="md"
      >
        <Box px={5} py={4} borderBottomWidth="1px" borderColor="border.muted">
          <Heading size="sm">Delete package</Heading>
          {deletingProduct ? (
            <Text fontSize="sm" color="fg.muted" mt={1}>
              Remove{" "}
              <Text as="span" fontWeight="semibold" color="fg">
                {deletingProduct.planName || deletingProduct.name}
              </Text>
              {" "}
              for {deletingProduct.buildingName}? This cannot be undone.
            </Text>
          ) : null}
        </Box>
        <Flex
          px={5}
          py={4}
          gap={2}
          justify="flex-end"
          borderTopWidth="1px"
          borderColor="border.muted"
        >
          <Button
            variant="ghost"
            disabled={deleteSubmitting}
            onClick={() => setDeletingProduct(null)}
          >
            Cancel
          </Button>
          <Button
            colorPalette="red"
            loading={deleteSubmitting}
            onClick={() => void handleDeleteConfirm()}
          >
            Delete package
          </Button>
        </Flex>
      </AppDialog>
    </ListPageStack>
  );
}

function ProductForm({
  catalog,
  lookupsLoading = false,
  categoryId, setCategoryId,
  planId, setPlanId,
  paymentFrequency, setPaymentFrequency,
  buildingId, setBuildingId,
  mbps, setMbps,
  price, setPrice,
  monthlyPrice, setMonthlyPrice,
  extraBandwidth, setExtraBandwidth,
  buildings, isActive, setIsActive,
  selectedCategory, selectedPlan, selectedVariant,
  isDstvOnly = false,
  readOnlyStructure, showStatus,
  onSubmit, submitting, onCancel, submitLabel = "Save price",
}: {
  catalog: PackageCategory[];
  lookupsLoading?: boolean;
  categoryId: string; setCategoryId: (v: string) => void;
  planId: string; setPlanId: (v: string) => void;
  paymentFrequency: string; setPaymentFrequency: (v: string) => void;
  buildingId: string; setBuildingId: (v: string) => void;
  mbps: string; setMbps: (v: string) => void;
  price: string; setPrice: (v: string) => void;
  monthlyPrice: string; setMonthlyPrice: (v: string) => void;
  extraBandwidth: string; setExtraBandwidth: (v: string) => void;
  buildings: Building[];
  isActive: boolean; setIsActive: (v: boolean) => void;
  selectedCategory?: PackageCategory;
  selectedPlan?: PackageCategory["plans"][number];
  selectedVariant?: PackageCategory["plans"][number]["variants"][number];
  isDstvOnly?: boolean;
  readOnlyStructure: boolean;
  showStatus: boolean;
  onSubmit: (e: FormEvent) => void; submitting: boolean; onCancel: () => void;
  submitLabel?: string;
}) {
  const fieldsDisabled = submitting || lookupsLoading;
  const internetFieldsDisabled = fieldsDisabled || isDstvOnly;
  const examplePrice = useMemo(() => {
    if (!selectedCategory || !selectedPlan || !selectedVariant) return null;
    if (selectedCategory.code === "internet_apartonet" && selectedPlan.code === "basic") {
      if (selectedVariant.paymentFrequency === "monthly") return 3900;
      if (selectedVariant.paymentFrequency === "quarterly") return 10500;
      if (selectedVariant.paymentFrequency === "yearly") return 39000;
    }
    return null;
  }, [selectedCategory, selectedPlan, selectedVariant]);

  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: `${b.ipSetup} · ${b.dstvSetup === "headend_coax" ? "Headend" : "Decoder"} · C2B ${b.c2bCode}`,
        keywords: `${b.c2bCode} ${b.b2bCode}`,
      })),
    [buildings]
  );

  const selectedBuilding = buildings.find((b) => String(b.id) === buildingId);
  const buildingUsesDecoder = selectedBuilding?.dstvSetup === "decoder";
  const categoryHasDecoderFee = Boolean(
    selectedCategory?.requiresDecoderFee || selectedCategory?.hasDstv
  );
  const showDecoderFeeNotice = categoryHasDecoderFee && buildingUsesDecoder;
  const showHeadendNoDecoderNotice =
    categoryHasDecoderFee && selectedBuilding?.dstvSetup === "headend_coax";

  return (
    <form onSubmit={onSubmit}>
      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={4}>
        <Field.Root required>
          <Field.Label>Category</Field.Label>
          <SelectField
            disabled={readOnlyStructure || fieldsDisabled}
            isLoading={lookupsLoading}
            fieldProps={{
              value: categoryId,
              onChange: (e) => {
                setCategoryId(e.target.value);
                setPlanId("");
              },
            }}
          >
            <option value="">{lookupsLoading ? "Loading…" : "Select category"}</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </SelectField>
        </Field.Root>
        <Field.Root required={!isDstvOnly}>
          <Field.Label>Plan</Field.Label>
          <SelectField
            disabled={readOnlyStructure || !categoryId || internetFieldsDisabled}
            isLoading={lookupsLoading}
            fieldProps={{
              value: planId,
              onChange: (e) => setPlanId(e.target.value),
              bg: isDstvOnly ? "bg.subtle" : undefined,
            }}
          >
            <option value="">
              {lookupsLoading
                ? "Loading…"
                : isDstvOnly
                  ? "DSTV Only"
                  : "Select plan"}
            </option>
            {(selectedCategory?.plans || []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectField>
          {isDstvOnly ? (
            <Field.HelperText>DSTV Only has no internet plan tiers.</Field.HelperText>
          ) : null}
        </Field.Root>
        <Field.Root required>
          <Field.Label>Billing frequency</Field.Label>
          <SelectField
            disabled={readOnlyStructure || fieldsDisabled}
            fieldProps={{
              value: paymentFrequency,
              onChange: (e) => setPaymentFrequency(e.target.value),
            }}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </SelectField>
        </Field.Root>
        <Field.Root required={!isDstvOnly}>
          <Field.Label>Speed (Mbps)</Field.Label>
          <Input
            type="number"
            min={1}
            value={isDstvOnly ? "" : mbps}
            onChange={(e) => setMbps(e.target.value)}
            placeholder={
              isDstvOnly
                ? "Not applicable"
                : selectedVariant
                  ? String(selectedVariant.defaultMbps)
                  : "e.g. 30"
            }
            disabled={internetFieldsDisabled}
            bg={isDstvOnly ? "bg.subtle" : undefined}
          />
          {isDstvOnly ? (
            <Field.HelperText>Speed is not used for DSTV Only.</Field.HelperText>
          ) : null}
        </Field.Root>
        {!readOnlyStructure && (
          <Field.Root required>
            <Field.Label>Building</Field.Label>
            <SearchableSelect
              value={buildingId}
              onChange={setBuildingId}
              options={buildingOptions}
              isLoading={lookupsLoading}
              disabled={fieldsDisabled}
              placeholder="Select building"
              searchPlaceholder="Search buildings…"
              emptyLabel="No buildings match your search"
            />
          </Field.Root>
        )}
        {readOnlyStructure && (
          <Field.Root>
            <Field.Label>Building</Field.Label>
            <Input value={buildings.find((b) => String(b.id) === buildingId)?.name || ""} readOnly bg="bg.subtle" />
          </Field.Root>
        )}
        <Field.Root required>
          <Field.Label>Price (KES, incl. VAT)</Field.Label>
          <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={examplePrice ? String(examplePrice) : undefined} disabled={fieldsDisabled} />
          {examplePrice != null && (
            <Field.HelperText>Reference price for this variant: {formatCurrency(examplePrice)}</Field.HelperText>
          )}
        </Field.Root>
        <Field.Root>
          <Field.Label>Monthly base price</Field.Label>
          <Input type="number" value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} placeholder="Optional — used for custom billing periods" disabled={fieldsDisabled} />
        </Field.Root>
        <Field.Root>
          <Field.Label>Extra bandwidth (Mbps)</Field.Label>
          <Input
            type="number"
            min={0}
            value={isDstvOnly ? "0" : extraBandwidth}
            onChange={(e) => setExtraBandwidth(e.target.value)}
            placeholder="0"
            disabled={internetFieldsDisabled}
            bg={isDstvOnly ? "bg.subtle" : undefined}
          />
          {isDstvOnly ? (
            <Field.HelperText>Extra bandwidth is not used for DSTV Only.</Field.HelperText>
          ) : null}
        </Field.Root>
        {showDecoderFeeNotice && (
          <Box gridColumn={{ md: "1 / -1" }} bg="orange.50" borderRadius="md" px={3} py={2}>
            <Text fontSize="sm" color="orange.800">
              One-off decoder fee: {formatCurrency(selectedCategory?.decoderFeeAmount || 2900)}. Applies to this building because it uses individual DSTV decoders.
            </Text>
          </Box>
        )}
        {showHeadendNoDecoderNotice && (
          <Box gridColumn={{ md: "1 / -1" }} bg="bg.subtle" borderRadius="md" px={3} py={2}>
            <Text fontSize="sm" color="fg.muted">
              No decoder fee — {selectedBuilding?.name || "this building"} uses headend coax (shared DSTV), not individual decoders.
            </Text>
          </Box>
        )}
        {showStatus && (
          <Field.Root>
            <Field.Label>Status</Field.Label>
            <SelectField disabled={fieldsDisabled} fieldProps={{ value: isActive ? "active" : "inactive", onChange: (e) => setIsActive(e.target.value === "active") }}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectField>
          </Field.Root>
        )}
      </Grid>
      <Flex gap={2} mt={4}>
        <Button type="submit" colorPalette="brand" loading={submitting} disabled={lookupsLoading}>{submitLabel}</Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
      </Flex>
    </form>
  );
}
