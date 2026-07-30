import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useVisibilityRefresh } from "../hooks/useVisibilityRefresh";
import { mergeInfinitePage, useMobileViewport } from "../hooks/useMobileViewport";
import { useTableSort } from "../hooks/useTableSort";
import { Link, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Input,
  Stack,
  Table,
  Text,
  Textarea,
} from "@chakra-ui/react";
import {
  FiChevronDown,
  FiChevronRight,
  FiUpload,
  FiUserPlus,
} from "react-icons/fi";
import {
  api,
  formatCurrency,
  formatDateOnly,
  type Building,
  type Customer,
  type PackageCategory,
  type Product,
  type UpgradePaymentMethod,
  type UpgradeQuote,
  type PendingUpgrade,
} from "../lib/api";
import { toaster } from "../components/ui/toaster";
import { CustomerEditDialog } from "../components/customers/CustomerEditDialog";
import { DstvSerialMissingBadge } from "../components/customers/DstvSerialMissingBadge";
import { CatalogPackageMissingBadge } from "../components/customers/CatalogPackageMissingBadge";
import {
  CustomerActionDialog,
} from "../components/customers/CustomerActionDialog";
import type { CustomerAction } from "../components/customers/CustomerActionMenu";
import { CustomerExpandPanel } from "../components/customers/CustomerExpandPanel";
import type { ApartmentHistoryEntry } from "../lib/api";

/** TISP due dates may be ISO or "DD MMM YYYY hh:mm A". */
function formatTispDueDateDisplay(value: string | null | undefined): string {
  if (!value) return "—";
  const only = formatDateOnly(value);
  if (only && only !== "—" && !Number.isNaN(new Date(value).getTime())) {
    return only;
  }
  return String(value).replace(/\s+\d{1,2}:\d{2}\s*[AP]M$/i, "").trim() || String(value);
}
import {
  DataTable,
  DataTableCard,
  DataTableSortHeader,
  type DataTableSkeletonColumnKind,
  DATA_TABLE_LEADING_COL_WIDTH,
  dataTableCellProps,
  dataTableTypeColumnHeaderProps,
  dataTableCustomerColumnHeaderProps,
  dataTableEqualDataColumnHeaderProps,
  dataTableEqualDataCodeColumnHeaderProps,
  dataTableTypeCellProps,
  dataTableCustomerWrapCellProps,
  dataTableEqualDataCellProps,
  dataTableColumnHeaderProps,
  dataTableExpandRowProps,
} from "../components/ui/DataTable";
import { TextStatus } from "../components/ui/TextStatus";
import type { CancelCustomerPayload, ListPagination, CustomerImportEvent } from "../lib/api";
import {
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  displayCustomerStatus,
  parseStatusFilterParam,
  serializeStatusFilter,
  statusFiltersEqual,
  type SubscriptionStatusLabel,
} from "../lib/customerStatus";
import { StatusMultiSelect } from "../components/ui/StatusMultiSelect";
import { CustomerTypeConvertDialog } from "../components/customers/CustomerTypeConvertDialog";
import { CustomerImportProgressDialog } from "../components/customers/CustomerImportProgressDialog";
import { RowCheckbox } from "../components/ui/RowCheckbox";
import { ModalShell } from "../components/ui/ModalShell";
import { CUSTOMER_EXPORT_COLUMN_OPTIONS } from "../lib/customerExportColumns";
import { DataTableExportButton } from "../components/ui/DataTableExportButton";
import type { ExportFormat, ExportOptions, ExportScope } from "../lib/tableExport";
import { SelectField } from "../components/ui/SelectField";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { formatDisplayText } from "../lib/formatText";
import { DisplayText } from "../components/ui/DisplayText";
import { useAuth } from "../lib/auth";
import { canDeleteCustomer, canMutateCustomers, canSeeCustomerFinancials, hidePricing } from "../lib/rbac";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { MobileDataCard, MobileDataList, ResponsiveListViews } from "../components/ui/MobileDataList";
import { MobileFAB, MobilePageChrome } from "../components/ui/MobilePageChrome";
import { ListPageStickyChrome, ListPageTableSection } from "../components/ui/ListPageStickyChrome";
import { ListPageStack } from "../components/ui/pageLayout";
import { MobileCardListSkeleton, DataTableLoadingSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_CONTROL_HEIGHT } from "../theme";

const PAGE_SIZE = 30;

function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

type CustomerSortKey =
  | "customerType"
  | "customerName"
  | "customerNumber"
  | "buildingName"
  | "apartmentNumber"
  | "productName"
  | "paymentFrequency"
  | "subscriptionStatus"
  | "tispDueDate"
  | "packagePrice";

const TYPE_COLORS: Record<string, string> = {
  C2B: "brand",
  B2B: "blue",
};

const expandedRowMotion = {
  animation: "customer-row-focus 0.3s ease-out",
  "@keyframes customer-row-focus": {
    from: { backgroundColor: "var(--chakra-colors-white)" },
    to: { backgroundColor: "var(--chakra-colors-brand-100)" },
  },
} as const;

const expandPanelRowMotion = {
  animation: "customer-expand-row-in 0.35s ease-out",
  "@keyframes customer-expand-row-in": {
    from: { opacity: 0, transform: "translateY(-8px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
} as const;

export function CustomersListPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canMutate = canMutateCustomers(user);
  const isMobile = useMobileViewport();
  const allowPermanentDelete = canDeleteCustomer(user);
  const hidePrices = hidePricing(user);
  const hideFinancials = !canSeeCustomerFinancials(user);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pagination, setPagination] = useState<ListPagination>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [categories, setCategories] = useState<PackageCategory[]>([]);
  const [lookupsLoading, setLookupsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 450);
  const [liveSyncing, setLiveSyncing] = useState(false);
  const loadRequestRef = useRef(0);
  const [buildingId, setBuildingId] = useState("");
  const [statusFilters, setStatusFilters] = useState<SubscriptionStatusLabel[]>(() =>
    parseStatusFilterParam(searchParams.get("status"))
  );
  const [importEvents, setImportEvents] = useState<CustomerImportEvent[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [actionCustomer, setActionCustomer] = useState<Customer | null>(null);
  const [actionType, setActionType] = useState<CustomerAction | null>(null);
  const [actionProductId, setActionProductId] = useState("");
  const [newApartment, setNewApartment] = useState("");
  const [switchIpAddress, setSwitchIpAddress] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelOnuCollectedAt, setCancelOnuCollectedAt] = useState(todayDateInputValue);
  const [cancelDstvDecoderCollectedAt, setCancelDstvDecoderCollectedAt] = useState(
    todayDateInputValue
  );
  const [pauseStartDate, setPauseStartDate] = useState(todayDateInputValue());
  const [pauseEndDate, setPauseEndDate] = useState("");
  const [pauseReason, setPauseReason] = useState("");
  const [actionPackages, setActionPackages] = useState<Product[]>([]);
  const [apartmentHistory, setApartmentHistory] = useState<ApartmentHistoryEntry[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionDataLoading, setActionDataLoading] = useState(false);
  const [upgradeQuote, setUpgradeQuote] = useState<UpgradeQuote | null>(null);
  const [upgradeQuoteLoading, setUpgradeQuoteLoading] = useState(false);
  const upgradeQuoteRequestRef = useRef(0);
  const [pendingUpgrade, setPendingUpgrade] = useState<PendingUpgrade | null>(null);
  const [cancellingPendingUpgrade, setCancellingPendingUpgrade] = useState(false);
  const [upgradePaymentMethod, setUpgradePaymentMethod] =
    useState<UpgradePaymentMethod | "">("");
  const [actionPaymentFrequency, setActionPaymentFrequency] =
    useState<Customer["paymentFrequency"]>("monthly");
  const [actionCustomPeriodDays, setActionCustomPeriodDays] = useState("");
  const [billingPreviewProduct, setBillingPreviewProduct] = useState<Product | null>(null);
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelStep, setBulkCancelStep] = useState<1 | 2>(1);
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkOnuCollectedAt, setBulkOnuCollectedAt] = useState(todayDateInputValue);
  const [bulkDstvDecoderCollectedAt, setBulkDstvDecoderCollectedAt] = useState(
    todayDateInputValue
  );
  const [bulkLoading, setBulkLoading] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [convertCustomer, setConvertCustomer] = useState<Customer | null>(null);
  const { sorts, toggleSort, sortQuery } = useTableSort<CustomerSortKey>([
    { sortBy: "customerName", sortDir: "asc" },
    { sortBy: "customerNumber", sortDir: "asc" },
  ]);

  const loadCustomersRef = useRef<
    (opts?: boolean | { refresh?: boolean; silent?: boolean }) => Promise<void>
  >(async () => {});

  useVisibilityRefresh(() => {
    void loadCustomersRef.current({ silent: true });
  });

  useEffect(() => {
    setLookupsLoading(true);
    Promise.all([
      api.listBuildings({ limit: "100" }),
      api.getPackageCatalog(),
    ])
      .then(([b, c]) => {
        setBuildings(b.buildings);
        setCategories(c.categories);
      })
      .catch(() => {})
      .finally(() => setLookupsLoading(false));
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

  const loadCustomers = useCallback(
    async (refreshOrOpts: boolean | { refresh?: boolean; silent?: boolean } = false) => {
      const refresh =
        typeof refreshOrOpts === "boolean"
          ? refreshOrOpts
          : Boolean(refreshOrOpts.refresh);
      const silent =
        typeof refreshOrOpts === "object" && Boolean(refreshOrOpts.silent);

      const buildParams = () => {
        const params: Record<string, string> = {
          page: String(page),
          limit: String(PAGE_SIZE),
        };
        const query = debouncedSearch.trim();
        if (query.length >= 2) params.search = query;
        if (buildingId) params.buildingId = buildingId;
        if (statusFilters.length) {
          params.subscriptionStatus = serializeStatusFilter(statusFilters);
        }
        if (categoryId) params.categoryId = categoryId;
        if (customerType) params.customerType = customerType;
        params.sortBy = sortQuery.sortBy;
        params.sortDir = sortQuery.sortDir;
        if (refresh) params.refresh = "true";
        return { params, query };
      };

      // Background realtime refresh must not toggle the page spinner or cancel
      // an in-flight initial load (that left the UI stuck on skeleton).
      if (silent) {
        try {
          const { params } = buildParams();
          const res = await api.listCustomers(params);
          setCustomers((prev) =>
            mergeInfinitePage(prev, res.data, page, isMobile && page > 1, (c) => c.id)
          );
          setPagination(res.pagination);
        } catch {
          /* keep current rows */
        }
        return;
      }

      const requestId = ++loadRequestRef.current;
      const append = isMobile && page > 1 && !refresh;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const { params, query } = buildParams();
        const res = await api.listCustomers(params);
        if (requestId !== loadRequestRef.current) return;
        setCustomers((prev) =>
          mergeInfinitePage(prev, res.data, page, isMobile && !refresh, (c) => c.id)
        );
        setPagination(res.pagination);
        if (!append) setSelectedIds(new Set());

        // After search: show DB rows immediately, then patch with live TISP status/due date.
        if (query.length >= 2 && res.data.length > 0) {
          const activeIds = res.data
            .filter((c) => c.status === "active")
            .map((c) => c.id)
            .slice(0, 10);
          if (activeIds.length > 0) {
            setLiveSyncing(true);
            void api
              .refreshCustomersBatch(activeIds, { force: true })
              .then((batch) => {
                if (requestId !== loadRequestRef.current) return;
                if (!batch.customers?.length) return;
                const byId = new Map(batch.customers.map((c) => [c.id, c]));
                setCustomers((prev) =>
                  prev.map((c) => {
                    const next = byId.get(c.id);
                    return next ? { ...c, ...next } : c;
                  })
                );
              })
              .catch(() => {
                /* keep DB snapshot — expand/refresh still available */
              })
              .finally(() => {
                if (requestId === loadRequestRef.current) setLiveSyncing(false);
              });
          }
        } else {
          setLiveSyncing(false);
        }
      } catch (e) {
        if (requestId !== loadRequestRef.current) return;
        const message = e instanceof Error ? e.message : "Failed to load customers";
        setError(message);
        toaster.create({ title: message, type: "error" });
      } finally {
        if (requestId === loadRequestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedSearch, buildingId, statusFilters, categoryId, customerType, page, sortQuery.sortBy, sortQuery.sortDir, isMobile]
  );

  loadCustomersRef.current = loadCustomers;

  function handleSort(
    column: CustomerSortKey,
    defaultDir: "asc" | "desc" = "asc",
    additive = false
  ) {
    toggleSort(column, defaultDir, additive);
    setPage(1);
    setExpanded(null);
    setSelectedIds(new Set());
  }

  const pageCustomerIds = useMemo(
    () => customers.map((customer) => customer.id),
    [customers]
  );

  const selectedCustomers = useMemo(
    () => customers.filter((customer) => selectedIds.has(customer.id)),
    [customers, selectedIds]
  );

  const activeSelectedIds = useMemo(
    () =>
      selectedCustomers
        .filter((customer) => customer.status === "active")
        .map((customer) => customer.id),
    [selectedCustomers]
  );

  const activeSelectedCustomers = useMemo(
    () => selectedCustomers.filter((customer) => customer.status === "active"),
    [selectedCustomers]
  );

  const bulkNeedsDstvDecoder = useMemo(
    () =>
      activeSelectedCustomers.some(
        (customer) => customer.hasDstv && customer.dstvSerialRequired
      ),
    [activeSelectedCustomers]
  );

  const bulkCancelFormValid =
    bulkNotes.trim().length > 0 &&
    Boolean(bulkOnuCollectedAt) &&
    (!bulkNeedsDstvDecoder || Boolean(bulkDstvDecoderCollectedAt));

  const allPageSelected =
    pageCustomerIds.length > 0 &&
    pageCustomerIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageCustomerIds.some((id) => selectedIds.has(id));
  const tableColumnCount = canMutate ? (selectionMode ? 9 : 8) : 8;
  const customerSkeletonKinds: DataTableSkeletonColumnKind[] = [
    ...(canMutate && selectionMode
      ? (["leading", "leading"] as const)
      : (["leading"] as const)),
    "type",
    "customer",
    "code",
    "data",
    "data",
    "data",
    "data",
  ];

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds(new Set());
      }
      return !prev;
    });
  }

  function selectAllOnPage() {
    setSelectedIds(new Set(pageCustomerIds));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openBulkCancelDialog() {
    setBulkCancelStep(1);
    setBulkOnuCollectedAt(todayDateInputValue());
    setBulkDstvDecoderCollectedAt(todayDateInputValue());
    setBulkCancelOpen(true);
  }

  function closeBulkCancelDialog() {
    if (bulkLoading) return;
    setBulkCancelOpen(false);
    setBulkCancelStep(1);
    setBulkNotes("");
    setBulkOnuCollectedAt(todayDateInputValue());
    setBulkDstvDecoderCollectedAt(todayDateInputValue());
  }

  function buildCancelPayload(reason: string, needsDstvDecoder: boolean): CancelCustomerPayload {
    const payload: CancelCustomerPayload = {
      reason: reason.trim(),
      notes: reason.trim(),
      onuCollectedAt: cancelOnuCollectedAt,
    };
    if (needsDstvDecoder) {
      payload.dstvDecoderCollectedAt = cancelDstvDecoderCollectedAt;
    }
    return payload;
  }

  function buildBulkCancelPayload(needsDstvDecoder: boolean): CancelCustomerPayload {
    const payload: CancelCustomerPayload = {
      reason: bulkNotes.trim(),
      notes: bulkNotes.trim(),
      onuCollectedAt: bulkOnuCollectedAt,
    };
    if (needsDstvDecoder) {
      payload.dstvDecoderCollectedAt = bulkDstvDecoderCollectedAt;
    }
    return payload;
  }

  async function submitBulkCancel() {
    if (!activeSelectedIds.length || !bulkCancelFormValid) return;
    setBulkLoading(true);
    try {
      const res = await api.bulkCancelCustomers(
        activeSelectedIds,
        buildBulkCancelPayload(bulkNeedsDstvDecoder)
      );
      toaster.create({
        title: `Cancelled ${res.succeeded} of ${res.total} subscription(s)`,
        description:
          res.failed > 0
            ? `${res.failed} could not be cancelled — see console for details`
            : undefined,
        type: res.failed > 0 ? "warning" : "success",
      });
      if (res.failed > 0) {
        console.table(res.results.filter((row) => !row.ok));
      }
      setBulkCancelOpen(false);
      setBulkCancelStep(1);
      setBulkNotes("");
      setBulkOnuCollectedAt(todayDateInputValue());
      setBulkDstvDecoderCollectedAt(todayDateInputValue());
      clearSelection();
      setExpanded(null);
      const cancelledIds = new Set(
        res.results.filter((row) => row.ok).map((row) => row.id)
      );
      if (cancelledIds.size) {
        setCustomers((prev) => {
          const patched = prev.map((c) =>
            cancelledIds.has(c.id)
              ? { ...c, status: "cancelled" as const, subscriptionStatus: "Cancelled" }
              : c
          );
          if (statusFilters.length > 0 && !statusFilters.includes("Cancelled")) {
            return patched.filter((c) => !cancelledIds.has(c.id));
          }
          return patched;
        });
        setPagination((prev) => {
          if (!prev) return prev;
          if (statusFilters.length > 0 && !statusFilters.includes("Cancelled")) {
            return {
              ...prev,
              total: Math.max(0, Number(prev.total || 0) - cancelledIds.size),
            };
          }
          return prev;
        });
      }
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Bulk cancel failed",
        type: "error",
      });
    } finally {
      setBulkLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [debouncedSearch]);

  useEffect(() => {
    const urlStatuses = parseStatusFilterParam(searchParams.get("status"));
    setStatusFilters((prev) => (statusFiltersEqual(prev, urlStatuses) ? prev : urlStatuses));
  }, [searchParams]);

  function applyStatusFilters(next: SubscriptionStatusLabel[]) {
    setStatusFilters(next);
    setPage(1);
    setExpanded(null);
    const nextParams = new URLSearchParams(searchParams);
    if (next.length) {
      nextParams.set("status", serializeStatusFilter(next));
    } else {
      nextParams.delete("status");
    }
    setSearchParams(nextParams, { replace: true });
  }

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  function toggleRow(id: number) {
    setExpanded((prev) => {
      const next = prev === id ? null : id;
      if (next !== null) {
        window.requestAnimationFrame(() => {
          document
            .getElementById(`customer-expand-${next}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
      return next;
    });
  }

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await api.downloadCustomerImportTemplate();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Download failed",
        type: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  async function handleExport(
    scope: ExportScope,
    format: ExportFormat,
    options?: ExportOptions
  ) {
    setExporting(true);
    try {
      const params: Record<string, string> = {
        sortBy: sortQuery.sortBy,
        sortDir: sortQuery.sortDir,
        scope,
      };
      if (scope === "view") {
        params.page = String(page);
        params.limit = String(PAGE_SIZE);
      }
      if (debouncedSearch.trim().length >= 2) {
        params.search = debouncedSearch.trim();
      }
      if (buildingId) params.buildingId = buildingId;
      if (statusFilters.length) {
        params.subscriptionStatus = serializeStatusFilter(statusFilters);
      }
      if (categoryId) params.categoryId = categoryId;
      if (customerType) params.customerType = customerType;
      if (options?.columns && options.columns !== "all") {
        params.columns = options.columns.join(",");
      }
      const filterTags: string[] = [];
      const bldg = buildings.find((b) => String(b.id) === buildingId);
      if (bldg) filterTags.push(bldg.name);
      if (statusFilters.length) filterTags.push(...statusFilters);
      const cat = categories.find((c) => String(c.id) === categoryId);
      if (cat) filterTags.push(cat.name);
      if (customerType) filterTags.push(customerType);
      if (debouncedSearch.trim().length >= 2) filterTags.push(debouncedSearch.trim());
      await api.exportCustomers(params, format, filterTags);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Export failed",
        type: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportEvents([]);
    setImportDialogOpen(true);
    try {
      await api.importCustomersStream(file, (event) => {
        setImportEvents((prev) => [...prev, event]);
      });
      setExpanded(null);
      loadCustomers(true);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Import failed",
        type: "error",
      });
      setImportDialogOpen(false);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function loadActionPackages(
    customer: Customer,
    type: CustomerAction,
    paymentFrequency: Customer["paymentFrequency"],
    customPeriodDays = ""
  ) {
    const freq = paymentFrequency === "custom" ? "monthly" : paymentFrequency;
    const res = await api.listProducts({
      buildingId: String(customer.buildingId),
      paymentFrequency: freq,
      activeOnly: "true",
      unpaginated: "true",
    });

    const baselinePrice = resolveActionBaselinePrice(
      customer,
      res.products,
      paymentFrequency,
      customPeriodDays
    );

    return res.products
      .filter((p) => {
        if (p.id === customer.productId) return false;
        const price = productPriceAtFrequency(p, paymentFrequency, customPeriodDays);
        if (type === "upgrade") return price > baselinePrice;
        if (type === "downgrade") return price < baselinePrice;
        return false;
      })
      .sort((a, b) => {
        const priceDiff =
          productPriceAtFrequency(a, paymentFrequency, customPeriodDays) -
          productPriceAtFrequency(b, paymentFrequency, customPeriodDays);
        if (priceDiff !== 0) return priceDiff;
        const planDiff = (a.planSortOrder ?? 0) - (b.planSortOrder ?? 0);
        if (planDiff !== 0) return planDiff;
        if (a.mbps !== b.mbps) return a.mbps - b.mbps;
        return Number(a.hasDstv) - Number(b.hasDstv);
      });
  }

  function productPriceAtFrequency(
    product: Product,
    frequency: Customer["paymentFrequency"],
    customPeriodDays: string
  ) {
    if (frequency === "custom") {
      const days = Number(customPeriodDays);
      if (days >= 1) {
        return Math.round((Number(product.monthlyPrice) * days) / 30);
      }
    }
    return Math.round(Number(product.price) || 0);
  }

  function resolveActionBaselinePrice(
    customer: Customer,
    productsAtFreq: Product[],
    frequency: Customer["paymentFrequency"],
    customPeriodDays: string
  ) {
    const sameFrequency = frequency === customer.paymentFrequency;
    const sameCustomPeriod =
      frequency === "custom" &&
      customer.paymentFrequency === "custom" &&
      Number(customPeriodDays) === Number(customer.customPeriodDays ?? 0);

    if (sameFrequency && frequency !== "custom") {
      return Math.round(Number(customer.packagePrice) || 0);
    }
    if (sameCustomPeriod) {
      return Math.round(Number(customer.packagePrice) || 0);
    }

    if (frequency === "custom" && customer.paymentFrequency === "custom") {
      const days = Number(customPeriodDays);
      const currentDays = Number(customer.customPeriodDays) || 30;
      if (days >= 1 && currentDays >= 1) {
        return Math.round((Number(customer.packagePrice) * days) / currentDays);
      }
    }

    const twin =
      productsAtFreq.find(
        (p) =>
          ((customer.planId != null && p.planId === customer.planId) ||
            (!!customer.planName && p.planName === customer.planName)) &&
          Boolean(p.hasDstv) === Boolean(customer.hasDstv)
      ) ??
      productsAtFreq.find(
        (p) =>
          (customer.planId != null && p.planId === customer.planId) ||
          (!!customer.planName && p.planName === customer.planName)
      ) ??
      productsAtFreq.find(
        (p) =>
          p.mbps === customer.productMbps &&
          Boolean(p.hasDstv) === Boolean(customer.hasDstv)
      );

    if (twin) {
      return productPriceAtFrequency(twin, frequency, customPeriodDays);
    }

    return Math.round(Number(customer.packagePrice) || 0);
  }

  function openAction(customer: Customer, type: CustomerAction) {
    if (type === "deletePermanent" && !allowPermanentDelete) return;
    if (!canMutate && type !== "history" && type !== "deletePermanent") return;
    if (type === "edit") {
      setEditCustomer(customer);
      return;
    }
    if (type === "convertType") {
      setConvertCustomer(customer);
      return;
    }

    setActionCustomer(customer);
    setActionType(type);
    setActionProductId("");
    setNewApartment("");
    setSwitchIpAddress("");
    setCancelNotes("");
    setCancelOnuCollectedAt(todayDateInputValue());
    setCancelDstvDecoderCollectedAt(todayDateInputValue());
    setPauseStartDate(todayDateInputValue());
    setPauseEndDate("");
    setPauseReason("");
    setActionPackages([]);
    setApartmentHistory([]);
    setUpgradeQuote(null);
    setPendingUpgrade(null);
    setUpgradePaymentMethod("");
    setBillingPreviewProduct(null);
    setActionPaymentFrequency(customer.paymentFrequency);
    setActionCustomPeriodDays(
      customer.customPeriodDays != null ? String(customer.customPeriodDays) : ""
    );
    setActionDataLoading(
      type === "history" ||
        type === "upgrade" ||
        type === "downgrade" ||
        type === "changePaymentFrequency"
    );

    void (async () => {
      try {
        if (type === "upgrade" || type === "downgrade") {
          setActionPackages(
            await loadActionPackages(
              customer,
              type,
              customer.paymentFrequency,
              customer.customPeriodDays != null
                ? String(customer.customPeriodDays)
                : ""
            )
          );
        }

        if (type === "changePaymentFrequency") {
          await loadBillingPreviewProduct(
            customer,
            customer.paymentFrequency,
            customer.customPeriodDays != null ? String(customer.customPeriodDays) : ""
          );
        }

        if (type === "upgrade" && customer.upgradePaymentStatus === "payment_pending") {
          const res = await api.getCustomer(customer.id);
          setPendingUpgrade(res.pendingUpgrade ?? null);
          if (res.customer) {
            setActionCustomer(res.customer);
          }
        }

        if (type === "history") {
          const res = await api.getApartmentHistory(
            customer.buildingId,
            customer.apartmentNumber
          );
          setApartmentHistory(res.history);
        }
      } catch (e) {
        toaster.create({
          title: "Failed to load action details",
          description: e instanceof Error ? e.message : "Please try again",
          type: "error",
        });
      } finally {
        setActionDataLoading(false);
      }
    })();
  }

  function closeAction() {
    setActionCustomer(null);
    setActionType(null);
    setUpgradeQuote(null);
    setPendingUpgrade(null);
    setUpgradePaymentMethod("");
    setActionPaymentFrequency("monthly");
    setActionCustomPeriodDays("");
    setBillingPreviewProduct(null);
  }

  async function handleCancelPendingUpgrade() {
    if (!actionCustomer) return;
    setCancellingPendingUpgrade(true);
    try {
      const res = await api.cancelPendingUpgrade(actionCustomer.id);
      setPendingUpgrade(null);
      setActionCustomer(res.customer);
      setCustomers((prev) =>
        prev.map((row) => (row.id === res.customer.id ? { ...row, ...res.customer } : row))
      );
      toaster.create({
        title: "Pending upgrade cancelled",
        type: "success",
      });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not cancel pending upgrade",
        type: "error",
      });
    } finally {
      setCancellingPendingUpgrade(false);
    }
  }

  async function loadBillingPreviewProduct(
    customer: Customer,
    frequency: Customer["paymentFrequency"],
    customPeriodDays: string
  ) {
    const unchanged =
      frequency === customer.paymentFrequency &&
      (frequency !== "custom" ||
        Number(customPeriodDays) === (customer.customPeriodDays ?? 0));
    if (unchanged) {
      setBillingPreviewProduct(null);
      return;
    }
    if (frequency === "custom" && (!customPeriodDays || Number(customPeriodDays) < 1)) {
      setBillingPreviewProduct(null);
      return;
    }
    const freq = frequency === "custom" ? "monthly" : frequency;
    setActionDataLoading(true);
    try {
      const res = await api.listProducts({
        buildingId: String(customer.buildingId),
        paymentFrequency: freq,
        activeOnly: "true",
        unpaginated: "true",
      });
      const currentHasDstv = Boolean(customer.hasDstv);
      const match =
        res.products.find(
          (p) =>
            customer.planId != null &&
            p.planId === customer.planId &&
            Boolean(p.hasDstv) === currentHasDstv
        ) ??
        res.products.find(
          (p) =>
            !!customer.planName &&
            p.planName === customer.planName &&
            Boolean(p.hasDstv) === currentHasDstv
        ) ??
        res.products.find(
          (p) =>
            p.mbps === customer.productMbps &&
            Boolean(p.hasDstv) === currentHasDstv
        ) ??
        res.products.find(
          (p) => customer.planId != null && p.planId === customer.planId
        ) ??
        res.products.find((p) => p.mbps === customer.productMbps) ??
        null;
      setBillingPreviewProduct(match);
    } catch {
      setBillingPreviewProduct(null);
    } finally {
      setActionDataLoading(false);
    }
  }

  function billingOptions() {
    return {
      paymentFrequency: actionPaymentFrequency,
      customPeriodDays:
        actionPaymentFrequency === "custom"
          ? Number(actionCustomPeriodDays) || null
          : null,
    };
  }

  async function loadPackageChangeQuote(
    customerId: number,
    productId: string,
    mode: "upgrade" | "downgrade" = "upgrade",
    billingOverride?: {
      paymentFrequency?: Customer["paymentFrequency"];
      customPeriodDays?: number | null;
    }
  ) {
    const billing = billingOverride ?? billingOptions();
    if (!productId) {
      setUpgradeQuote(null);
      setUpgradePaymentMethod("");
      return;
    }
    if (
      billing.paymentFrequency === "custom" &&
      (!billing.customPeriodDays || billing.customPeriodDays < 1)
    ) {
      setUpgradeQuote(null);
      setUpgradePaymentMethod("");
      return;
    }
    setUpgradeQuoteLoading(true);
    setUpgradeQuote(null);
    setPendingUpgrade(null);
    setUpgradePaymentMethod("");
    const requestId = ++upgradeQuoteRequestRef.current;
    try {
      const res =
        mode === "downgrade"
          ? await api.getDowngradeQuote(customerId, Number(productId), billing)
          : await api.getUpgradeQuote(customerId, Number(productId), billing);
      if (requestId !== upgradeQuoteRequestRef.current) return;
      setUpgradeQuote(res.quote);
      if (res.quote.paymentRequired && res.quote.recommendedPaymentMethod !== "none") {
        setUpgradePaymentMethod(res.quote.recommendedPaymentMethod);
      }
    } catch (e) {
      if (requestId !== upgradeQuoteRequestRef.current) return;
      toaster.create({
        title:
          mode === "downgrade"
            ? "Failed to calculate downgrade credit"
            : "Failed to calculate upgrade top-up",
        description: e instanceof Error ? e.message : "Please try again",
        type: "error",
      });
    } finally {
      if (requestId === upgradeQuoteRequestRef.current) {
        setUpgradeQuoteLoading(false);
      }
    }
  }

  async function handleActionPaymentFrequencyChange(
    frequency: Customer["paymentFrequency"]
  ) {
    setActionPaymentFrequency(frequency);
    setActionProductId("");
    setUpgradeQuote(null);
    setPendingUpgrade(null);
    setUpgradePaymentMethod("");
    if (!actionCustomer || !actionType) return;
    if (frequency !== "custom") {
      setActionCustomPeriodDays("");
    }
    if (actionType === "changePaymentFrequency") {
      void loadBillingPreviewProduct(
        actionCustomer,
        frequency,
        frequency === "custom" ? actionCustomPeriodDays : ""
      );
      return;
    }
    if (actionType === "upgrade" || actionType === "downgrade") {
      setActionDataLoading(true);
      try {
        setActionPackages(
          await loadActionPackages(
            actionCustomer,
            actionType,
            frequency,
            frequency === "custom" ? actionCustomPeriodDays : ""
          )
        );
      } catch (e) {
        toaster.create({
          title: "Failed to load packages",
          description: e instanceof Error ? e.message : "Please try again",
          type: "error",
        });
      } finally {
        setActionDataLoading(false);
      }
    }
  }

  function handleCustomPeriodDaysChange(value: string) {
    setActionCustomPeriodDays(value);
    if (actionType === "changePaymentFrequency" && actionCustomer) {
      void loadBillingPreviewProduct(actionCustomer, actionPaymentFrequency, value);
      return;
    }
    if (
      (actionType === "upgrade" || actionType === "downgrade") &&
      actionCustomer &&
      actionPaymentFrequency === "custom"
    ) {
      setActionProductId("");
      setUpgradeQuote(null);
      setUpgradePaymentMethod("");
      if (Number(value) >= 1) {
        setActionDataLoading(true);
        void loadActionPackages(
          actionCustomer,
          actionType,
          "custom",
          value
        )
          .then(setActionPackages)
          .catch((e) => {
            toaster.create({
              title: "Failed to load packages",
              description: e instanceof Error ? e.message : "Please try again",
              type: "error",
            });
          })
          .finally(() => setActionDataLoading(false));
      } else {
        setActionPackages([]);
      }
      return;
    }
    if (
      (actionType === "upgrade" || actionType === "downgrade") &&
      actionProductId &&
      actionCustomer &&
      Number(value) >= 1
    ) {
      void loadPackageChangeQuote(actionCustomer.id, actionProductId, actionType, {
        paymentFrequency: actionPaymentFrequency,
        customPeriodDays: Number(value),
      });
    } else {
      setUpgradeQuote(null);
      setUpgradePaymentMethod("");
    }
  }

  function handleActionProductChange(productId: string) {
    setActionProductId(productId);
    if (
      (actionType === "upgrade" || actionType === "downgrade") &&
      actionCustomer &&
      productId
    ) {
      void loadPackageChangeQuote(
        actionCustomer.id,
        productId,
        actionType
      );
    } else {
      setUpgradeQuote(null);
      setUpgradePaymentMethod("");
    }
  }

  function closeEdit() {
    setEditCustomer(null);
  }

  function handleEditSaved(updated: Customer, tisp?: { ok: boolean; error?: string }) {
    setEditCustomer(null);
    setCustomers((prev) =>
      prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
    );
    if (expanded === updated.id) {
      setPanelRefreshKey((k) => k + 1);
    }
    if (tisp && !tisp.ok) {
      toaster.create({
        title: "Customer updated",
        description: `TISP sync failed: ${tisp.error}`,
        type: "warning",
        duration: 10000,
      });
    } else {
      toaster.create({ title: "Customer updated", type: "success" });
    }
  }

  function handleTypeConverted(
    updated: Customer,
    meta: {
      previousCustomerNumber: string;
      newCustomerNumber: string;
      tisp?: { ok: boolean; error?: string };
    }
  ) {
    setConvertCustomer(null);
    setCustomers((prev) =>
      prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
    );
    if (expanded === updated.id) {
      setPanelRefreshKey((k) => k + 1);
    }
    if (meta.tisp && !meta.tisp.ok) {
      toaster.create({
        title: `Converted to ${updated.customerType}`,
        description: `Customer number: ${meta.previousCustomerNumber} → ${meta.newCustomerNumber}. TISP sync failed: ${meta.tisp.error}`,
        type: "warning",
        duration: 10000,
      });
    } else {
      toaster.create({
        title: `Converted to ${updated.customerType}`,
        description: `Customer number updated to ${meta.newCustomerNumber}`,
        type: "success",
      });
    }
  }

  async function submitAction() {
    if (!actionCustomer || !actionType) return;
    setActionLoading(true);
    const customerId = actionCustomer.id;
    const wasExpanded = expanded === customerId;
    try {
      if (actionType === "upgrade" || actionType === "downgrade") {
        if (actionType === "upgrade") {
          const res = await api.upgradeCustomer(
            actionCustomer.id,
            Number(actionProductId),
            {
              paymentMethod: upgradePaymentMethod || undefined,
              ...billingOptions(),
            }
          );
          if (res.pending) {
            if (res.payment?.method === "invoice") {
              toaster.create({
                title: "Upgrade awaiting payment",
                description: res.payment.invoiceNumber
                  ? `Invoice ${res.payment.invoiceNumber} created. Package will upgrade when payment is received.`
                  : "Zoho invoice created. Package will upgrade when payment is received.",
                type: "success",
                duration: 10000,
              });
            } else if (res.payment?.method === "stk") {
              toaster.create({
                title: "Upgrade awaiting payment",
                description: `STK push sent to ${res.payment.phone}. Package will upgrade when payment is confirmed.`,
                type: "success",
                duration: 10000,
              });
            } else {
              toaster.create({
                title: "Upgrade awaiting payment",
                type: "success",
              });
            }
          } else if (res.tisp && !res.tisp.ok) {
            toaster.create({
              title: "Package upgraded",
              description: `TISP sync failed: ${res.tisp.error}`,
              type: "warning",
              duration: 10000,
            });
          } else {
            toaster.create({ title: "Package upgraded", type: "success" });
          }
        } else {
          const res = await api.downgradeCustomer(
            actionCustomer.id,
            Number(actionProductId),
            billingOptions()
          );
          if (res.creditNoteError) {
            toaster.create({
              title: "Package downgraded",
              description: `Zoho credit note failed: ${res.creditNoteError}`,
              type: "warning",
              duration: 10000,
            });
          } else if (res.creditNote?.creditNoteNumber) {
            toaster.create({
              title: "Package downgraded",
              description: `Zoho credit note ${res.creditNote.creditNoteNumber} raised for ${formatCurrency(res.quote?.creditAmount ?? res.creditNote.total ?? 0)}`,
              type: "success",
              duration: 10000,
            });
          } else if (res.tisp && !res.tisp.ok) {
            toaster.create({
              title: "Package downgraded",
              description: `TISP sync failed: ${res.tisp.error}`,
              type: "warning",
              duration: 10000,
            });
          } else {
            toaster.create({ title: "Package downgraded", type: "success" });
          }
        }
      } else if (actionType === "changePaymentFrequency") {
        const res = await api.changeCustomerPaymentFrequency(actionCustomer.id, {
          paymentFrequency: actionPaymentFrequency,
          customPeriodDays:
            actionPaymentFrequency === "custom"
              ? Number(actionCustomPeriodDays) || null
              : null,
        });
        if (res.tisp && !res.tisp.ok) {
          toaster.create({
            title: "Payment frequency updated",
            description: `TISP sync failed: ${res.tisp.error}`,
            type: "warning",
            duration: 10000,
          });
        } else {
          toaster.create({ title: "Payment frequency updated", type: "success" });
        }
      } else if (actionType === "switch") {
        const res = await api.switchCustomerApartment(
          actionCustomer.id,
          newApartment.trim(),
          { ipAddress: switchIpAddress.trim() || undefined }
        );
        if (res.tisp && !res.tisp.ok) {
          toaster.create({
            title: "Apartment moved",
            description: `TISP sync failed: ${res.tisp.error}`,
            type: "warning",
            duration: 10000,
          });
        } else if (res.zoho && res.zoho.ok === false) {
          toaster.create({
            title: "Apartment moved",
            description: `Zoho sync failed: ${res.zoho.error || "update failed"}`,
            type: "warning",
            duration: 10000,
          });
        } else {
          toaster.create({
            title: "Apartment switched",
            description: res.customer?.customerNumber
              ? `Updated to ${res.customer.customerNumber}${
                  res.customer.ipAddress ? ` · IP ${res.customer.ipAddress}` : ""
                }`
              : undefined,
            type: "success",
          });
        }
      } else if (actionType === "disconnect") {
        const res = await api.disconnectCustomer(actionCustomer.id);
        if (res.tisp && res.tisp.ok === false) {
          toaster.create({
            title: "Suspended locally with TISP issues",
            description: res.tisp.error || "TISP update failed",
            type: "warning",
            duration: 10000,
          });
        } else {
          toaster.create({
            title: "Customer suspended on TISP",
            description: res.tisp?.dueDate
              ? `TISP due date set to ${res.tisp.dueDate}`
              : undefined,
            type: "success",
          });
        }
      } else if (actionType === "pause") {
        const res = await api.pauseCustomer(actionCustomer.id, {
          reason: pauseReason.trim(),
          pauseStartDate,
          pauseEndDate,
        });
        if (res.customer) {
          setCustomers((prev) =>
            prev.map((c) => (c.id === res.customer.id ? { ...c, ...res.customer } : c))
          );
        }
        const zohoDeferred = res.zoho?.recurring?.deferred ?? 0;
        if (res.tisp && res.tisp.ok === false) {
          toaster.create({
            title: "Paused with TISP issues",
            description: res.tisp.error || "TISP update failed",
            type: "warning",
            duration: 10000,
          });
        } else if (res.zoho && res.zoho.ok === false) {
          toaster.create({
            title: "Paused with billing sync issues",
            description: res.zoho.error || "Zoho recurring update failed",
            type: "warning",
            duration: 10000,
          });
        } else {
          toaster.create({
            title: "Service paused",
            description: [
              res.pause?.endDate ? `Away until ${res.pause.endDate}` : null,
              zohoDeferred > 0
                ? `${zohoDeferred} recurring profile${zohoDeferred === 1 ? "" : "s"} deferred`
                : null,
              res.tisp?.dueDate ? `TISP due ${res.tisp.dueDate}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            type: "success",
          });
        }
      } else if (actionType === "cancel") {
        const needsDstvDecoder = Boolean(
          actionCustomer.hasDstv && actionCustomer.dstvSerialRequired
        );
        const res = await api.cancelCustomer(
          actionCustomer.id,
          buildCancelPayload(cancelNotes, needsDstvDecoder)
        );
        toaster.create({
          title: "Subscription cancelled",
          description: "TISP and Zoho are updating in the background",
          type: "success",
        });
        if (res.customer) {
          setCustomers((prev) => {
            const patched = prev.map((c) =>
              c.id === res.customer.id ? { ...c, ...res.customer } : c
            );
            // Hide from current view when Cancelled is not in the status filter.
            if (
              statusFilters.length > 0 &&
              !statusFilters.includes("Cancelled")
            ) {
              return patched.filter((c) => c.status !== "cancelled");
            }
            return patched;
          });
          setPagination((prev) => {
            if (!prev) return prev;
            if (
              statusFilters.length > 0 &&
              !statusFilters.includes("Cancelled")
            ) {
              return {
                ...prev,
                total: Math.max(0, Number(prev.total || 0) - 1),
              };
            }
            return prev;
          });
        }
      } else if (actionType === "deletePermanent") {
        await api.deleteCustomerPermanently(actionCustomer.id);
        toaster.create({ title: "Customer deleted permanently", type: "success" });
        setExpanded(null);
      }
      closeAction();
      // Cancel already patched local rows — skip slow live refresh.
      // Other actions still refresh so TISP/due-date stay accurate.
      if (actionType === "deletePermanent") {
        void loadCustomers(false);
      } else if (actionType !== "cancel") {
        await loadCustomers(true);
      }
      if (wasExpanded && actionType !== "deletePermanent" && actionType !== "cancel") {
        setExpanded(customerId);
        setPanelRefreshKey((k) => k + 1);
      } else if (wasExpanded && actionType === "cancel") {
        // Keep panel open only when Cancelled is still visible in the list.
        if (!statusFilters.length || statusFilters.includes("Cancelled")) {
          setExpanded(customerId);
          setPanelRefreshKey((k) => k + 1);
        } else {
          setExpanded(null);
        }
      }
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Action failed",
        type: "error",
      });
    } finally {
      setActionLoading(false);
    }
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
          isLoading={lookupsLoading}
          placeholder="All buildings"
          searchPlaceholder="Search buildings…"
          emptyLabel="No buildings match"
        />
      </FilterField>

      <FilterField label="Package category" flex={FILTER_FLEX.standard} minW={0}>
        <SelectField
          size="sm"
          isLoading={lookupsLoading}
          fieldProps={{
            value: categoryId,
            onChange: (e) => {
              setCategoryId(e.target.value);
              setPage(1);
              setExpanded(null);
            },
            borderRadius: "md",
          }}
        >
          <option value="">{lookupsLoading ? "Loading…" : "All categories"}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </FilterField>
    </>
  );

  return (
    <ListPageStack>
      <ListPageTableSection
        chrome={
          <ListPageStickyChrome>
            <MobilePageChrome
        title="Customers"
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder="Name, Apt No. , Customer No."
        chips={[
          {
            key: "all",
            label: "All",
            active: statusFilters.length === 0 && !customerType,
            onClick: () => {
              applyStatusFilters([]);
              setCustomerType("");
              setPage(1);
              setExpanded(null);
            },
          },
          ...SUBSCRIPTION_STATUS_FILTER_OPTIONS.map((option) => ({
            key: option.value.toLowerCase(),
            label: option.label,
            active: statusFilters.includes(option.value),
            onClick: () => {
              const next = statusFilters.includes(option.value)
                ? statusFilters.filter((status) => status !== option.value)
                : [...statusFilters, option.value];
              applyStatusFilters(next);
            },
          })),
          { key: "c2b", label: "C2B", active: customerType === "C2B", onClick: () => { setCustomerType(customerType === "C2B" ? "" : "C2B"); setPage(1); setExpanded(null); } },
          { key: "b2b", label: "B2B", active: customerType === "B2B", onClick: () => { setCustomerType(customerType === "B2B" ? "" : "B2B"); setPage(1); setExpanded(null); } },
        ]}
        filterTitle="Filters"
        activeFilterCount={(buildingId ? 1 : 0) + (categoryId ? 1 : 0)}
        onClearFilters={() => {
          setBuildingId("");
          setCategoryId("");
          setPage(1);
          setExpanded(null);
        }}
        filterContent={advancedFilters}
        sortOptions={[
          {
            key: "customerName",
            label: "Customer name",
            active: sorts[0]?.sortBy === "customerName",
            direction: sorts[0]?.sortBy === "customerName" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("customerName"),
          },
          {
            key: "customerNumber",
            label: "Customer number",
            active: sorts[0]?.sortBy === "customerNumber",
            direction: sorts[0]?.sortBy === "customerNumber" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("customerNumber"),
          },
          {
            key: "subscriptionStatus",
            label: "Status",
            active: sorts[0]?.sortBy === "subscriptionStatus",
            direction: sorts[0]?.sortBy === "subscriptionStatus" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("subscriptionStatus"),
          },
          {
            key: "tispDueDate",
            label: "Due date",
            active: sorts[0]?.sortBy === "tispDueDate",
            direction: sorts[0]?.sortBy === "tispDueDate" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("tispDueDate", "desc"),
          },
          {
            key: "packagePrice",
            label: "Package price",
            active: sorts[0]?.sortBy === "packagePrice",
            direction: sorts[0]?.sortBy === "packagePrice" ? sorts[0].sortDir : undefined,
            onClick: () => handleSort("packagePrice", "desc"),
          },
        ]}
        desktopActions={
          <Flex gap={2} align="center" flexShrink={0}>
            <DataTableExportButton
              entityLabel="customers"
              viewCount={customers.length}
              totalCount={pagination.total}
              columnOptions={CUSTOMER_EXPORT_COLUMN_OPTIONS}
              loading={exporting}
              onExport={handleExport}
            />
            {canMutate ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  loading={downloading}
                  onClick={() => void handleDownloadTemplate()}
                >
                  Template
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={importing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FiUpload />
                  Import
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImport(file);
                  }}
                />
                <Button asChild size="sm" colorPalette="brand">
                  <Link to="/customers/new">
                    <FiUserPlus />
                    Add customer
                  </Link>
                </Button>
              </>
            ) : null}
          </Flex>
        }
            />

            <FilterToolbar embedded>
          <FilterField
            label="Search"
            flex={{ base: "1 1 100%", lg: "1.45" }}
            minW={0}
            hideOnMobile
          >
            <Input
              size="sm"
              h={FILTER_CONTROL_HEIGHT}
              placeholder="Name, apartment, customer number…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              borderRadius="md"
            />
          </FilterField>

          {advancedFilters}

          <FilterField label="Type" flex={FILTER_FLEX.compact} minW={0} hideOnMobile>
            <SelectField
              size="sm"
              fieldProps={{
                value: customerType,
                onChange: (e) => {
                  setCustomerType(e.target.value);
                  setPage(1);
                  setExpanded(null);
                },
                borderRadius: "md",
              }}
            >
              <option value="">All types</option>
              <option value="C2B">C2B</option>
              <option value="B2B">B2B</option>
            </SelectField>
          </FilterField>

          <FilterField
            label="Status"
            flex={{ base: "1 1 100%", sm: "1 1 calc(50% - 6px)", lg: "1.15" }}
            minW={{ base: 0, lg: "240px" }}
            hideOnMobile
          >
            <StatusMultiSelect
              size="sm"
              value={statusFilters}
              onChange={applyStatusFilters}
            />
          </FilterField>
            </FilterToolbar>
          </ListPageStickyChrome>
        }
      >
      {canMutate ? (
        <MobileFAB to="/customers/new" aria-label="Add customer">
          <FiUserPlus size={24} />
        </MobileFAB>
      ) : null}

      {liveSyncing ? (
        <Text fontSize="xs" color="fg.muted">
          Updating live TISP status…
        </Text>
      ) : null}

      {error && (
        <Box bg="red.50" color="red.700" p={3} borderRadius="lg" fontSize="sm">
          {error}
        </Box>
      )}

      {canMutate && selectionMode && (
        <Flex
          align="center"
          justify="space-between"
          gap={3}
          wrap="wrap"
          bg="brand.50"
          border="1px solid"
          borderColor="brand.200"
          borderRadius="lg"
          px={4}
          py={3}
        >
          <Text fontSize="sm" fontWeight="medium" color="fg">
            {selectedIds.size > 0
              ? `${selectedIds.size} selected${
                  activeSelectedIds.length !== selectedIds.size
                    ? ` · ${activeSelectedIds.length} active`
                    : ""
                }`
              : "Select customers using the checkboxes below"}
          </Text>
          <Flex gap={2} wrap="wrap">
            {!allPageSelected && pageCustomerIds.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                borderRadius="md"
                onClick={selectAllOnPage}
              >
                Select all on page
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              borderRadius="md"
              onClick={toggleSelectionMode}
            >
              Cancel
            </Button>
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                colorPalette="red"
                variant="outline"
                borderRadius="md"
                disabled={activeSelectedIds.length === 0}
                onClick={openBulkCancelDialog}
              >
                Cancel subscriptions
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button
                size="sm"
                variant="ghost"
                borderRadius="md"
                onClick={clearSelection}
              >
                Clear selection
              </Button>
            )}
          </Flex>
        </Flex>
      )}

      <DataTableCard
        loading={loading}
        loadingMore={loadingMore}
        loadedCount={customers.length}
        pagination={pagination}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          setExpanded(null);
        }}
        itemLabel="customers"
      >
        {loading ? (
          <ResponsiveListViews
            fill
            mobile={<MobileCardListSkeleton rows={10} fill variant="row" />}
            desktop={
              <DataTableLoadingSkeleton
                columns={tableColumnCount}
                narrowLeading={canMutate ? (selectionMode ? 2 : 1) : 1}
                columnKinds={customerSkeletonKinds}
                fill
              />
            }
          />
        ) : customers.length === 0 ? (
          <Stack gap={2} align="center" py={4}>
            <Text textAlign="center" color="fg.subtle" fontSize="sm">
              No customers found
            </Text>
            {canMutate ? (
              <Button asChild size="sm" colorPalette="brand" variant="outline">
                <Link to="/customers/new">Add your first customer</Link>
              </Button>
            ) : null}
          </Stack>
        ) : (
          <ResponsiveListViews
            mobile={
              <MobileDataList
                items={customers}
                getKey={(c) => c.id}
                expandedId={expanded}
                renderCard={(c, isOpen) => {
                  const isDimmed = expanded !== null && !isOpen;
                  return (
                    <MobileDataCard
                      variant="row"
                      title={c.fullName}
                      subtitle={`${formatDisplayText(c.buildingName)} · ${c.apartmentNumber} • ${c.customerNumber}`}
                      leading={
                        canMutate && selectionMode ? (
                          <Box onClick={(e) => e.stopPropagation()}>
                            <RowCheckbox
                              checked={selectedIds.has(c.id)}
                              disabled={c.status === "cancelled"}
                              onChange={() => toggleSelected(c.id)}
                              aria-label={`Select ${c.fullName}`}
                            />
                          </Box>
                        ) : undefined
                      }
                      statusLine={<TextStatus status={displayCustomerStatus(c)} variant="caption" />}
                      trailing={
                        hidePrices ? undefined : (
                          <Text fontWeight="bold" fontSize="md" whiteSpace="nowrap">
                            {formatCurrency(c.packagePrice)}
                          </Text>
                        )
                      }
                      isOpen={isOpen}
                      dimmed={isDimmed}
                      opacity={c.status === "cancelled" ? 0.75 : undefined}
                      onClick={() => toggleRow(c.id)}
                      footer={
                        c.catalogPackageMissing || c.dstvSerialMissing ? (
                          <Stack gap={1}>
                            {c.catalogPackageMissing ? (
                              <CatalogPackageMissingBadge compact />
                            ) : null}
                            {c.dstvSerialMissing ? (
                              <DstvSerialMissingBadge compact />
                            ) : null}
                          </Stack>
                        ) : undefined
                      }
                    />
                  );
                }}
                renderExpanded={(c) => (
                  <CustomerExpandPanel
                    key={`${c.id}-${panelRefreshKey}`}
                    customerId={c.id}
                    onAction={openAction}
                    onClose={() => setExpanded(null)}
                    readOnly={!canMutate}
                    allowPermanentDelete={allowPermanentDelete}
                    hidePricing={hidePrices}
                    hideFinancials={hideFinancials}
                    onCustomerUpdated={(updated) => {
                      setCustomers((prev) =>
                        prev.map((row) =>
                          row.id === updated.id ? { ...row, ...updated } : row
                        )
                      );
                    }}
                  />
                )}
              />
            }
            desktop={
          <DataTable fixedLayout scrollMinW="1024px">
            <Table.Header>
              <Table.Row>
                {canMutate ? (
                  <>
                    <Table.ColumnHeader {...dataTableColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                      <RowCheckbox
                        checked={selectionMode}
                        indeterminate={selectionMode && somePageSelected && !allPageSelected}
                        onChange={toggleSelectionMode}
                        aria-label="Enable customer selection"
                      />
                    </Table.ColumnHeader>
                    {selectionMode ? (
                      <Table.ColumnHeader {...dataTableColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                    ) : null}
                  </>
                ) : (
                  <Table.ColumnHeader {...dataTableColumnHeaderProps} w={DATA_TABLE_LEADING_COL_WIDTH} />
                )}
                <DataTableSortHeader label="Type" column="customerType" sorts={sorts} onSort={handleSort} headerProps={dataTableTypeColumnHeaderProps} />
                <DataTableSortHeader label="Customer" column="customerName" sorts={sorts} onSort={handleSort} headerProps={dataTableCustomerColumnHeaderProps} />
                <DataTableSortHeader label="Customer #" column="customerNumber" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataCodeColumnHeaderProps} />
                <DataTableSortHeader label="Package" column="productName" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataColumnHeaderProps} />
                <DataTableSortHeader label="Frequency" column="paymentFrequency" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataColumnHeaderProps} />
                <DataTableSortHeader label="Status" column="subscriptionStatus" sorts={sorts} onSort={handleSort} headerProps={dataTableEqualDataColumnHeaderProps} />
                <DataTableSortHeader label="Due date" column="tispDueDate" sorts={sorts} onSort={handleSort} defaultDir="desc" headerProps={dataTableEqualDataColumnHeaderProps} />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {customers.map((c) => {
                const isOpen = expanded === c.id;
                const isDimmed = expanded !== null && !isOpen;

                return (
                  <Fragment key={c.id}>
                    <Table.Row
                      bg={isOpen ? "brand.100" : undefined}
                      cursor="pointer"
                      opacity={isDimmed ? 0.45 : c.status === "cancelled" ? 0.75 : 1}
                      css={isOpen ? expandedRowMotion : undefined}
                      transition="opacity 0.25s ease"
                      onClick={() => toggleRow(c.id)}
                      _hover={{ bg: isOpen ? "brand.100" : "gray.50" }}
                    >
                      <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                        {canMutate && selectionMode ? (
                          <RowCheckbox
                            checked={selectedIds.has(c.id)}
                            disabled={c.status === "cancelled"}
                            onChange={() => toggleSelected(c.id)}
                            aria-label={`Select ${c.fullName}`}
                          />
                        ) : isOpen ? (
                          <Box color="brand.600">
                            <FiChevronDown size={16} />
                          </Box>
                        ) : (
                          <FiChevronRight size={16} />
                        )}
                      </Table.Cell>
                      {canMutate && selectionMode ? (
                        <Table.Cell {...dataTableCellProps} w={DATA_TABLE_LEADING_COL_WIDTH}>
                          {isOpen ? (
                            <Box color="brand.600">
                              <FiChevronDown size={16} />
                            </Box>
                          ) : (
                            <FiChevronRight size={16} />
                          )}
                        </Table.Cell>
                      ) : null}
                      <Table.Cell {...dataTableTypeCellProps}>
                        <Badge
                          colorPalette={TYPE_COLORS[c.customerType] || "gray"}
                          variant="subtle"
                        >
                          {c.customerType}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell {...dataTableCustomerWrapCellProps}>
                        <DisplayText
                          value={c.fullName}
                          maxLength={null}
                          fontWeight={isOpen ? "bold" : "semibold"}
                          color={isOpen ? "brand.800" : "gray.900"}
                          whiteSpace="normal"
                          wordBreak="break-word"
                        />
                        <Text
                          fontSize="xs"
                          color="fg.muted"
                          mt={0.5}
                          textTransform="none"
                          whiteSpace="normal"
                          wordBreak="break-word"
                        >
                          {formatDisplayText(c.buildingName)} · {c.apartmentNumber}
                        </Text>
                        {(c.catalogPackageMissing || c.dstvSerialMissing) && (
                          <Stack gap={1} mt={1.5}>
                            {c.catalogPackageMissing ? (
                              <CatalogPackageMissingBadge compact />
                            ) : null}
                            {c.dstvSerialMissing ? (
                              <DstvSerialMissingBadge compact />
                            ) : null}
                          </Stack>
                        )}
                      </Table.Cell>
                      <Table.Cell
                        {...dataTableEqualDataCellProps}
                        fontFamily="mono"
                        color="brand.700"
                        fontWeight="medium"
                        textTransform="uppercase"
                      >
                        {c.customerNumber}
                      </Table.Cell>
                      <Table.Cell {...dataTableEqualDataCellProps}>
                        {hidePrices ? (
                          <Text fontWeight="semibold">{c.productMbps} Mbps</Text>
                        ) : (
                          <>
                            <Text fontWeight="semibold">{formatCurrency(c.packagePrice)}</Text>
                            <Text fontSize="xs" color="fg.muted" mt={0.5}>
                              {c.productMbps} Mbps
                            </Text>
                          </>
                        )}
                      </Table.Cell>
                      <Table.Cell {...dataTableEqualDataCellProps} color="fg.muted" textTransform="capitalize">
                        <PaymentFrequencyText customer={c} />
                      </Table.Cell>
                      <Table.Cell {...dataTableEqualDataCellProps}>
                        <CustomerStatusText customer={c} />
                      </Table.Cell>
                      <Table.Cell {...dataTableEqualDataCellProps} color="fg.muted">
                        {formatTispDueDateDisplay(c.tispDueDate)}
                      </Table.Cell>
                    </Table.Row>
                    {isOpen && (
                      <Table.Row
                        id={`customer-expand-${c.id}`}
                        {...dataTableExpandRowProps}
                        css={expandPanelRowMotion}
                      >
                        <Table.Cell
                          colSpan={tableColumnCount}
                          p={4}
                          bg="brand.50"
                          borderBottom="2px solid"
                          borderColor="brand.200"
                        >
                          <CustomerExpandPanel
                            key={`${c.id}-${panelRefreshKey}`}
                            customerId={c.id}
                            onAction={openAction}
                            onClose={() => setExpanded(null)}
                            readOnly={!canMutate}
                            allowPermanentDelete={allowPermanentDelete}
                            hidePricing={hidePrices}
                            hideFinancials={hideFinancials}
                            onCustomerUpdated={(updated) => {
                              setCustomers((prev) =>
                                prev.map((row) =>
                                  row.id === updated.id ? { ...row, ...updated } : row
                                )
                              );
                            }}
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

      {canMutate ? (
        <>
      <CustomerEditDialog
        customer={editCustomer}
        onClose={closeEdit}
        onSaved={handleEditSaved}
      />
      <CustomerTypeConvertDialog
        customer={convertCustomer}
        onClose={() => setConvertCustomer(null)}
        onConverted={handleTypeConverted}
      />
      <CustomerActionDialog
        customer={actionCustomer}
        buildings={buildings}
        actionType={actionType}
        actionProductId={actionProductId}
        newApartment={newApartment}
        switchIpAddress={switchIpAddress}
        cancelNotes={cancelNotes}
        cancelOnuCollectedAt={cancelOnuCollectedAt}
        cancelDstvDecoderCollectedAt={cancelDstvDecoderCollectedAt}
        pauseStartDate={pauseStartDate}
        pauseEndDate={pauseEndDate}
        pauseReason={pauseReason}
        actionPackages={actionPackages}
        apartmentHistory={apartmentHistory}
        upgradeQuote={upgradeQuote}
        upgradeQuoteLoading={upgradeQuoteLoading}
        pendingUpgrade={pendingUpgrade}
        cancellingPendingUpgrade={cancellingPendingUpgrade}
        upgradePaymentMethod={upgradePaymentMethod}
        actionPaymentFrequency={actionPaymentFrequency}
        actionCustomPeriodDays={actionCustomPeriodDays}
        billingPreviewProduct={billingPreviewProduct}
        loading={actionLoading}
        dataLoading={actionDataLoading}
        onClose={closeAction}
        onSubmit={submitAction}
        onProductChange={handleActionProductChange}
        onPaymentFrequencyChange={handleActionPaymentFrequencyChange}
        onCustomPeriodDaysChange={handleCustomPeriodDaysChange}
        onPaymentMethodChange={setUpgradePaymentMethod}
        onCancelPendingUpgrade={handleCancelPendingUpgrade}
        onApartmentChange={setNewApartment}
        onSwitchIpChange={setSwitchIpAddress}
        onNotesChange={setCancelNotes}
        onOnuCollectedAtChange={setCancelOnuCollectedAt}
        onDstvDecoderCollectedAtChange={setCancelDstvDecoderCollectedAt}
        onPauseStartDateChange={setPauseStartDate}
        onPauseEndDateChange={setPauseEndDate}
        onPauseReasonChange={setPauseReason}
      />
      <CustomerImportProgressDialog
        open={importDialogOpen}
        events={importEvents}
        running={importing}
        onClose={() => setImportDialogOpen(false)}
      />

      <ModalShell
        open={bulkCancelOpen}
        onClose={closeBulkCancelDialog}
        maxW="28rem"
      >
        {bulkCancelStep === 1 ? (
          <>
            <Box px={5} pt={5} pb={4} pr={12} borderBottomWidth="1px" borderColor="border.muted">
              <Text fontSize="lg" fontWeight="semibold">
                Cancel subscriptions
              </Text>
              <Text fontSize="sm" color="fg.muted" mt={1}>
                You are about to cancel {activeSelectedIds.length} active subscription
                {activeSelectedIds.length === 1 ? "" : "s"}.
                {selectedIds.size > activeSelectedIds.length
                  ? ` ${selectedIds.size - activeSelectedIds.length} already cancelled will be skipped.`
                  : ""}
              </Text>
            </Box>
            <Stack gap={4} px={5} py={4}>
              <Field.Root required>
                <Field.Label>Reason for cancellation</Field.Label>
                <Textarea
                  value={bulkNotes}
                  onChange={(e) => setBulkNotes(e.target.value)}
                  placeholder="Reason applies to all selected customers…"
                  rows={3}
                />
              </Field.Root>
              <Field.Root required>
                <Field.Label>ONU collected on</Field.Label>
                <Input
                  type="date"
                  value={bulkOnuCollectedAt}
                  onChange={(e) => setBulkOnuCollectedAt(e.target.value)}
                />
              </Field.Root>
              {bulkNeedsDstvDecoder ? (
                <Field.Root required>
                  <Field.Label>DSTV decoder collected on</Field.Label>
                  <Input
                    type="date"
                    value={bulkDstvDecoderCollectedAt}
                    onChange={(e) => setBulkDstvDecoderCollectedAt(e.target.value)}
                  />
                  <Text fontSize="xs" color="fg.muted" mt={1}>
                    At least one selected customer has a DSTV decoder package.
                  </Text>
                </Field.Root>
              ) : null}
              <Flex justify="flex-end" gap={2}>
                <Button variant="ghost" onClick={closeBulkCancelDialog}>
                  Keep subscriptions
                </Button>
                <Button
                  colorPalette="red"
                  disabled={!bulkCancelFormValid}
                  onClick={() => setBulkCancelStep(2)}
                >
                  Continue
                </Button>
              </Flex>
            </Stack>
          </>
        ) : (
          <>
            <Box px={5} pt={5} pb={4} pr={12} borderBottomWidth="1px" borderColor="border.muted">
              <Text fontSize="lg" fontWeight="semibold">
                Confirm cancellation
              </Text>
              <Text fontSize="sm" color="fg.muted" mt={1}>
                Please confirm you want to cancel {activeSelectedIds.length} subscription
                {activeSelectedIds.length === 1 ? "" : "s"}.
              </Text>
            </Box>
            <Stack gap={4} px={5} py={4}>
              <Box bg="red.50" borderRadius="md" px={3} py={3} fontSize="sm" color="red.800">
                This cannot be undone from here. Cancelled customers remain in history but
                will no longer be active.
              </Box>
              <Flex justify="flex-end" gap={2}>
                <Button
                  variant="ghost"
                  disabled={bulkLoading}
                  onClick={() => setBulkCancelStep(1)}
                >
                  Go back
                </Button>
                <Button
                  colorPalette="red"
                  loading={bulkLoading}
                  disabled={!bulkCancelFormValid}
                  onClick={() => void submitBulkCancel()}
                >
                  Yes, cancel subscriptions
                </Button>
              </Flex>
            </Stack>
          </>
        )}
      </ModalShell>
        </>
      ) : null}
    </ListPageStack>
  );
}

function CustomerStatusText({ customer }: { customer: Customer }) {
  return <TextStatus status={displayCustomerStatus(customer)} />;
}

function PaymentFrequencyText({ customer }: { customer: Customer }) {
  if (customer.paymentFrequency === "custom" && customer.customPeriodDays) {
    return <>Custom ({customer.customPeriodDays} days)</>;
  }
  return <>{customer.paymentFrequency}</>;
}
