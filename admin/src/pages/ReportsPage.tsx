import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  Input,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import {
  FiDownload,
  FiEye,
  FiFile,
  FiFileText,
  FiSearch,
  FiStar,
} from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import {
  api,
  type ReportDefinition,
  type ReportFamily,
} from "../lib/api";
import { ReportsPageSkeleton } from "../components/PageSkeletons";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { DateField } from "../components/ui/DateField";
import { PAGE_STACK_GAP, PageErrorBanner, PageHeader } from "../components/ui/pageLayout";
import { toaster } from "../components/ui/toaster";
import { AppDialog } from "../components/ui/AppDialog";
import { useAuth } from "../lib/authContext";
import { canAccessFinance, isPartner } from "../lib/rbac";
import {
  getFavoriteReportIds,
  toggleFavoriteReport,
} from "../lib/reportLibraryPrefs";
import { ReportSchedulesPanel } from "../components/ReportSchedulesPanel";
import { SelectField } from "../components/ui/SelectField";

const FAMILIES: ReportFamily[] = [
  "Executive",
  "Financial",
  "Billing",
  "Forecasting",
  "Customer",
  "Network",
  "Audit",
];

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const FAMILY_COLORS: Record<string, string> = {
  Executive: "purple",
  Financial: "green",
  Billing: "teal",
  Forecasting: "orange",
  Customer: "blue",
  Network: "cyan",
  Audit: "gray",
};

type ReportFilterValues = {
  from: string;
  to: string;
  month: string;
  year: string;
  monthFrom: string;
  monthTo: string;
};

type PreviewState = {
  id: string;
  title: string;
  period: { from: string; to: string } | null;
  summary: Record<string, unknown> | null;
  matrix?: {
    rowHeaderKey?: string;
    rowHeaderLabel?: string;
    groups: Array<{
      label: string;
      columns: Array<{ key: string; label: string }>;
    }>;
  } | null;
  sections: Array<{
    title: string | null;
    headers: Array<{ key: string; label: string }>;
    rows: Array<Record<string, unknown>>;
    totalRows: number;
  }>;
  truncated: boolean;
};

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

function defaultMonth() {
  return new Date().toISOString().slice(0, 7);
}

function defaultYear() {
  return String(new Date().getFullYear());
}

function createDefaultFilters(): ReportFilterValues {
  return {
    from: defaultFromDate(),
    to: defaultToDate(),
    month: defaultMonth(),
    year: defaultYear(),
    monthFrom: "1",
    monthTo: "12",
  };
}

function reportNeedsFilters(report: ReportDefinition) {
  return Boolean(
    report.dateFilter || report.monthFilter || report.yearFilter || report.monthRangeFilter
  );
}

function buildFilterParams(report: ReportDefinition, values: ReportFilterValues) {
  const params: Record<string, string> = {};
  if (report.dateFilter) {
    params.from = values.from;
    params.to = values.to;
  }
  if (report.monthFilter) params.month = values.month;
  if (report.yearFilter) params.year = values.year;
  if (report.monthRangeFilter) {
    params.monthFrom = values.monthFrom;
    params.monthTo = values.monthTo;
  }
  return params;
}

function ReportFiltersForm({
  report,
  filters,
  onChange,
}: {
  report: ReportDefinition;
  filters: ReportFilterValues;
  onChange: (patch: Partial<ReportFilterValues>) => void;
}) {
  if (!reportNeedsFilters(report)) {
    return (
      <Text fontSize="sm" color="fg.muted">
        No period filters for this report.
      </Text>
    );
  }

  return (
    <Stack gap={2}>
      <Flex gap={3} flexWrap="nowrap" align="flex-end" overflowX="auto">
        {report.dateFilter ? (
          <>
            <Box flex="1" minW="140px">
              <Text fontSize="xs" color="fg.muted" mb={1}>
                From
              </Text>
              <DateField value={filters.from} onChange={(v) => onChange({ from: v })} />
            </Box>
            <Box flex="1" minW="140px">
              <Text fontSize="xs" color="fg.muted" mb={1}>
                To
              </Text>
              <DateField value={filters.to} onChange={(v) => onChange({ to: v })} />
            </Box>
          </>
        ) : null}

        {report.monthFilter ? (
          <Box minW="160px" maxW="220px">
            <Text fontSize="xs" color="fg.muted" mb={1}>
              Month
            </Text>
            <Input
              size="sm"
              type="month"
              value={filters.month}
              onChange={(e) => onChange({ month: e.target.value })}
            />
          </Box>
        ) : null}

        {report.yearFilter ? (
          <Box minW="100px" maxW="120px" flexShrink={0}>
            <Text fontSize="xs" color="fg.muted" mb={1}>
              Year
            </Text>
            <Input
              size="sm"
              type="number"
              min={2000}
              max={2100}
              value={filters.year}
              onChange={(e) => onChange({ year: e.target.value })}
            />
          </Box>
        ) : null}

        {report.monthRangeFilter ? (
          <>
            <Box flex="1" minW="140px">
              <Text fontSize="xs" color="fg.muted" mb={1}>
                From month
              </Text>
              <SelectField
                size="sm"
                fieldProps={{
                  value: filters.monthFrom,
                  onChange: (e) => onChange({ monthFrom: e.target.value }),
                }}
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Box>
            <Box flex="1" minW="140px">
              <Text fontSize="xs" color="fg.muted" mb={1}>
                To month
              </Text>
              <SelectField
                size="sm"
                fieldProps={{
                  value: filters.monthTo,
                  onChange: (e) => onChange({ monthTo: e.target.value }),
                }}
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
            </Box>
          </>
        ) : null}
      </Flex>

      {report.monthRangeFilter ? (
        <Flex gap={1} flexWrap="wrap">
          {(
            [
              ["All months", 1, 12],
              ["This month", new Date().getMonth() + 1, new Date().getMonth() + 1],
              ["Q1", 1, 3],
              ["Q2", 4, 6],
              ["Q3", 7, 9],
              ["Q4", 10, 12],
            ] as const
          ).map(([label, fromM, toM]) => (
            <Button
              key={label}
              size="xs"
              variant="outline"
              onClick={() => onChange({ monthFrom: String(fromM), monthTo: String(toM) })}
            >
              {label}
            </Button>
          ))}
        </Flex>
      ) : null}
    </Stack>
  );
}

function ReportPreviewTable({ preview }: { preview: PreviewState }) {
  return (
    <Stack gap={3}>
      {preview.summary ? (
        <Text fontSize="sm" color="fg.muted">
          {typeof preview.summary.total === "number"
            ? `${preview.summary.total} records`
            : "Summary ready"}
          {typeof preview.summary.totalOutstanding === "number"
            ? ` · outstanding ${preview.summary.totalOutstanding}`
            : ""}
          {typeof preview.summary.totalAmount === "number"
            ? ` · total ${preview.summary.totalAmount}`
            : ""}
        </Text>
      ) : null}

      {preview.sections.map((section, idx) => {
        const matrix = preview.matrix;
        const useMatrixHeaders = Boolean(matrix?.groups?.length) && !section.title;
        const flatColumns = useMatrixHeaders
          ? matrix!.groups.flatMap((g) => g.columns)
          : section.headers;
        const rowHeaderKey = matrix?.rowHeaderKey || "customer";
        const rowHeaderLabel = matrix?.rowHeaderLabel || "Customer";

        return (
          <Box key={idx} overflowX="auto">
            {section.title ? (
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                {section.title}
              </Text>
            ) : null}
            <Table.Root size="sm" variant="outline">
              <Table.Header>
                {useMatrixHeaders ? (
                  <>
                    <Table.Row>
                      <Table.ColumnHeader rowSpan={2}>{rowHeaderLabel}</Table.ColumnHeader>
                      {matrix!.groups.map((group) => (
                        <Table.ColumnHeader
                          key={group.label}
                          colSpan={group.columns.length}
                          textAlign="center"
                        >
                          {group.label}
                        </Table.ColumnHeader>
                      ))}
                    </Table.Row>
                    <Table.Row>
                      {flatColumns.map((h) => (
                        <Table.ColumnHeader key={h.key}>{h.label}</Table.ColumnHeader>
                      ))}
                    </Table.Row>
                  </>
                ) : (
                  <Table.Row>
                    {section.headers.map((h) => (
                      <Table.ColumnHeader key={h.key}>{h.label}</Table.ColumnHeader>
                    ))}
                  </Table.Row>
                )}
              </Table.Header>
              <Table.Body>
                {section.rows.slice(0, 50).map((row, rIdx) => (
                  <Table.Row key={rIdx}>
                    {useMatrixHeaders ? (
                      <>
                        <Table.Cell>
                          {row[rowHeaderKey] == null ? "" : String(row[rowHeaderKey])}
                        </Table.Cell>
                        {flatColumns.map((h) => (
                          <Table.Cell key={h.key}>
                            {row[h.key] == null ? "" : String(row[h.key])}
                          </Table.Cell>
                        ))}
                      </>
                    ) : (
                      section.headers.map((h) => (
                        <Table.Cell key={h.key}>
                          {row[h.key] == null ? "" : String(row[h.key])}
                        </Table.Cell>
                      ))
                    )}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            <Text fontSize="xs" color="fg.subtle" mt={1}>
              Showing {Math.min(50, section.rows.length)} of {section.totalRows}
              {preview.truncated ? " · truncated preview" : ""}
            </Text>
          </Box>
        );
      })}
    </Stack>
  );
}

function ReportRunnerDialog({
  report,
  open,
  filters,
  onFiltersChange,
  preview,
  previewing,
  downloading,
  onClose,
  onDownload,
}: {
  report: ReportDefinition | null;
  open: boolean;
  filters: ReportFilterValues;
  onFiltersChange: (patch: Partial<ReportFilterValues>) => void;
  preview: PreviewState | null;
  previewing: boolean;
  downloading: string | null;
  onClose: () => void;
  onDownload: (format: "xlsx" | "pdf" | "csv") => void;
}) {
  if (!report) return null;

  const downloadBusy = downloading?.startsWith(`${report.id}:`);

  return (
    <AppDialog
      open={open}
      onOpenChange={(d) => !d.open && onClose()}
      nearFullScreen
    >
      <Box
        px={5}
        py={3.5}
        pr={12}
        borderBottomWidth="1px"
        borderColor="border.muted"
        flexShrink={0}
      >
        <Text fontSize="lg" fontWeight="semibold" lineHeight="1.25">
          {report.title}
        </Text>
      </Box>

      <Dialog.Body px={5} py={4} flex="1" minH={0} overflowY="auto">
        <Stack gap={5}>
          <ReportFiltersForm report={report} filters={filters} onChange={onFiltersChange} />

          <Box>
            <Flex align="center" justify="space-between" gap={2} mb={2} flexWrap="wrap">
              <Text fontSize="sm" fontWeight="medium">
                Preview
              </Text>
              {previewing ? (
                <Text fontSize="xs" color="fg.muted">
                  Loading…
                </Text>
              ) : null}
            </Flex>
            {previewing && !(preview && preview.id === report.id) ? (
              <Text fontSize="sm" color="fg.muted">
                Loading preview…
              </Text>
            ) : preview && preview.id === report.id ? (
              <Stack gap={2} opacity={previewing ? 0.6 : 1}>
                {preview.period ? (
                  <Text fontSize="xs" color="fg.muted">
                    {preview.period.from} → {preview.period.to}
                  </Text>
                ) : null}
                <ReportPreviewTable preview={preview} />
              </Stack>
            ) : (
              <Text fontSize="sm" color="fg.muted">
                Preview will appear here once data loads.
              </Text>
            )}
          </Box>
        </Stack>
      </Dialog.Body>

      <Dialog.Footer
        px={5}
        py={3}
        borderTopWidth="1px"
        borderColor="border.muted"
        gap={2}
        flexWrap="wrap"
        justifyContent="space-between"
        flexShrink={0}
      >
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Flex gap={2} flexWrap="wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(downloadBusy)}
            loading={downloading === `${report.id}:xlsx`}
            onClick={() => onDownload("xlsx")}
          >
            <FiFile /> Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(downloadBusy)}
            loading={downloading === `${report.id}:csv`}
            onClick={() => onDownload("csv")}
          >
            <FiDownload /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={Boolean(downloadBusy)}
            loading={downloading === `${report.id}:pdf`}
            onClick={() => onDownload("pdf")}
          >
            <FiFileText /> PDF
          </Button>
        </Flex>
      </Dialog.Footer>
    </AppDialog>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const partnerView = isPartner(user);
  const showAnalyticsLink = canAccessFinance(user);

  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [family, setFamily] = useState<string>("All");
  const [filtersByReport, setFiltersByReport] = useState<Record<string, ReportFilterValues>>({});
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteReportIds());
  const [showUnavailable, setShowUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.listReports();
        if (!cancelled) setReports(res.reports);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load reports");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeReport = useMemo(
    () => reports.find((r) => r.id === activeReportId) || null,
    [reports, activeReportId]
  );

  const getReportFilters = useCallback(
    (reportId: string) => filtersByReport[reportId] || createDefaultFilters(),
    [filtersByReport]
  );

  const patchReportFilters = useCallback((reportId: string, patch: Partial<ReportFilterValues>) => {
    setFiltersByReport((prev) => ({
      ...prev,
      [reportId]: { ...(prev[reportId] || createDefaultFilters()), ...patch },
    }));
  }, []);

  const activeFilters = activeReport
    ? getReportFilters(activeReport.id)
    : createDefaultFilters();
  const activeFiltersKey = activeReport
    ? [
        activeReport.id,
        activeFilters.from,
        activeFilters.to,
        activeFilters.month,
        activeFilters.year,
        activeFilters.monthFrom,
        activeFilters.monthTo,
      ].join("|")
    : "";

  useEffect(() => {
    if (!activeReport) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPreviewing(true);
      try {
        const data = await api.previewReport(
          activeReport.id,
          buildFilterParams(activeReport, getReportFilters(activeReport.id))
        );
        if (cancelled) return;
        setPreview(data);
      } catch (e) {
        if (cancelled) return;
        setPreview(null);
        toaster.create({
          title: e instanceof Error ? e.message : "Preview failed",
          type: "error",
        });
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeReport, activeFiltersKey, getReportFilters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter((r) => {
      if (!showUnavailable && r.available === false) return false;
      if (family !== "All" && (r.family || r.category) !== family) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.id.includes(q) ||
        (r.family || r.category).toLowerCase().includes(q)
      );
    });
  }, [reports, search, family, showUnavailable]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReportDefinition[]>();
    for (const fam of FAMILIES) map.set(fam, []);
    for (const r of filtered) {
      const key = (r.family || r.category) as ReportFamily;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].filter(([, list]) => list.length > 0);
  }, [filtered]);

  const favoriteReports = useMemo(
    () => reports.filter((r) => favorites.includes(r.id)),
    [reports, favorites]
  );

  function openReport(report: ReportDefinition) {
    if (report.available === false) {
      toaster.create({ title: "Report not available yet", type: "warning" });
      return;
    }
    setPreview(null);
    setPreviewing(true);
    setActiveReportId(report.id);
  }

  function closeReport() {
    setActiveReportId(null);
    setPreview(null);
    setPreviewing(false);
  }

  async function handleDownload(format: "xlsx" | "pdf" | "csv") {
    if (!activeReport) return;
    const key = `${activeReport.id}:${format}`;
    setDownloading(key);
    try {
      await api.downloadReport(activeReport.id, {
        ...buildFilterParams(activeReport, getReportFilters(activeReport.id)),
        format,
      });
      toaster.create({ title: `${activeReport.title} downloaded`, type: "success" });
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Download failed",
        type: "error",
      });
    } finally {
      setDownloading(null);
    }
  }

  function handleFavorite(id: string) {
    setFavorites(toggleFavoriteReport(id));
  }

  if (loading) return <ReportsPageSkeleton />;

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title="Reports"
        description={
          partnerView
            ? "Downloadable partner reports — export the underlying data"
            : "Single source of truth for downloadable business reports"
        }
        actions={
          showAnalyticsLink ? (
            <Button asChild size="sm" variant="outline">
              <RouterLink to="/analytics">Open Analytics</RouterLink>
            </Button>
          ) : undefined
        }
      />

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      <FilterToolbar>
        <FilterField label="Search" flex={FILTER_FLEX.search}>
          <Flex align="center" gap={2}>
            <Box color="fg.muted">
              <FiSearch />
            </Box>
            <Input
              size="sm"
              placeholder="Search reports…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Flex>
        </FilterField>
      </FilterToolbar>

      <Flex gap={2} flexWrap="wrap" align="center">
        <Button
          size="xs"
          variant={family === "All" ? "solid" : "outline"}
          colorPalette="brand"
          onClick={() => setFamily("All")}
        >
          All
        </Button>
        {FAMILIES.map((f) => (
          <Button
            key={f}
            size="xs"
            variant={family === f ? "solid" : "outline"}
            colorPalette="brand"
            onClick={() => setFamily(f)}
          >
            {f}
          </Button>
        ))}
        <Button
          size="xs"
          variant="ghost"
          ml="auto"
          onClick={() => setShowUnavailable((v) => !v)}
        >
          {showUnavailable ? "Hide upcoming" : "Show upcoming"}
        </Button>
      </Flex>

      {favoriteReports.length > 0 && family === "All" && !search && (
        <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={3} maxW="md">
          <Text fontSize="sm" fontWeight="semibold" mb={2}>
            Favorites
          </Text>
          <Stack gap={1}>
            {favoriteReports.slice(0, 6).map((r) => (
              <Text key={r.id} fontSize="sm" color="fg.muted">
                {r.title}
              </Text>
            ))}
          </Stack>
        </Box>
      )}

      <Text fontSize="sm" color="fg.muted">
        {filtered.length} report{filtered.length === 1 ? "" : "s"}
        {partnerView ? " · partner catalog" : ""}
      </Text>

      <Stack gap={6}>
        {grouped.map(([fam, list]) => (
          <Stack key={fam} gap={3}>
            <Flex align="center" gap={2}>
              <Text fontSize="md" fontWeight="semibold">
                {fam}
              </Text>
              <Badge colorPalette={FAMILY_COLORS[fam] || "gray"}>{list.length}</Badge>
            </Flex>
            <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={3}>
              {list.map((report) => {
                const unavailable = report.available === false;
                const isFav = favorites.includes(report.id);
                return (
                  <Box
                    key={report.id}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="lg"
                    p={4}
                    opacity={unavailable ? 0.65 : 1}
                    bg="bg"
                  >
                    <Flex justify="space-between" align="flex-start" gap={2} mb={3}>
                      <Stack gap={1} flex="1" minW={0}>
                        <Text fontWeight="semibold" fontSize="sm">
                          {report.title}
                        </Text>
                        <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                          {report.description}
                        </Text>
                      </Stack>
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label="Favorite"
                        onClick={() => handleFavorite(report.id)}
                        color={isFav ? "orange.500" : undefined}
                      >
                        <FiStar />
                      </Button>
                    </Flex>
                    {unavailable ? (
                      <Badge size="sm" colorPalette="orange">
                        Coming soon
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        colorPalette="brand"
                        variant="outline"
                        onClick={() => openReport(report)}
                      >
                        <FiEye /> Open report
                      </Button>
                    )}
                  </Box>
                );
              })}
            </SimpleGrid>
          </Stack>
        ))}
      </Stack>

      <ReportRunnerDialog
        report={activeReport}
        open={Boolean(activeReport)}
        filters={activeFilters}
        onFiltersChange={(patch) => {
          if (activeReport) patchReportFilters(activeReport.id, patch);
        }}
        preview={preview}
        previewing={previewing}
        downloading={downloading}
        onClose={closeReport}
        onDownload={(format) => void handleDownload(format)}
      />

      {!partnerView && reports.length > 0 ? (
        <ReportSchedulesPanel reports={reports} />
      ) : null}
    </Stack>
  );
}
