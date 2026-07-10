import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  FiBarChart2,
  FiDownload,
  FiFile,
  FiFileText,
} from "react-icons/fi";
import { api, type ReportAnalytics, type ReportDefinition } from "../lib/api";
import { ReportsPageSkeleton } from "../components/PageSkeletons";
import { BusinessInsightsPanel } from "../components/reports/BusinessInsightsPanel";
import { FilterField } from "../components/module/FilterField";
import { FILTER_FLEX, FilterToolbar } from "../components/ui/FilterToolbar";
import { DateField } from "../components/ui/DateField";
import { PAGE_STACK_GAP, PageErrorBanner, PageHeader } from "../components/ui/pageLayout";
import { toaster } from "../components/ui/toaster";
import { useAuth } from "../lib/auth";
import { isPartner } from "../lib/rbac";

const CATEGORY_COLORS: Record<string, string> = {
  Financial: "green",
  Customers: "blue",
  Operations: "orange",
  Integrations: "purple",
};

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultToDate() {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const { user } = useAuth();
  const partnerView = isPartner(user);
  const showAnalytics = !partnerView;

  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [analytics, setAnalytics] = useState<ReportAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(showAnalytics);
  const [error, setError] = useState("");
  const [analyticsError, setAnalyticsError] = useState("");
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(defaultToDate);
  const [downloading, setDownloading] = useState<string | null>(null);

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

  useEffect(() => {
    if (!showAnalytics) return undefined;

    let cancelled = false;
    (async () => {
      setAnalyticsLoading(true);
      setAnalyticsError("");
      try {
        const data = await api.getReportAnalytics({ from, to });
        if (!cancelled) setAnalytics(data);
      } catch (e) {
        if (!cancelled) {
          setAnalyticsError(e instanceof Error ? e.message : "Failed to load analytics");
        }
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, showAnalytics]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReportDefinition[]>();
    for (const r of reports) {
      const list = map.get(r.category) || [];
      list.push(r);
      map.set(r.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [reports]);

  const download = useCallback(
    async (report: ReportDefinition, format: "xlsx" | "pdf") => {
      const key = `${report.id}-${format}`;
      setDownloading(key);
      try {
        const params: Record<string, string> = { format };
        if (report.dateFilter) {
          params.from = from;
          params.to = to;
        }
        await api.downloadReport(report.id, params);
        toaster.create({
          title: "Report downloaded",
          description: `${report.title} (${format.toUpperCase()})`,
          type: "success",
        });
      } catch (e) {
        toaster.create({
          title: "Download failed",
          description: e instanceof Error ? e.message : "Could not download report",
          type: "error",
        });
      } finally {
        setDownloading(null);
      }
    },
    [from, to]
  );

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title={partnerView ? "Reports" : "Reports & Analytics"}
        description={
          partnerView
            ? "Download aggregate business reports in Excel or PDF."
            : "Interactive business insights and downloadable operational reports."
        }
      />

      <FilterToolbar>
        <FilterField label="From" flex={FILTER_FLEX.standard} minW={0}>
          <DateField
            size="sm"
            value={from}
            onChange={setFrom}
            max={to}
            placeholder="Start date"
          />
        </FilterField>
        <FilterField label="To" flex={FILTER_FLEX.standard} minW={0}>
          <DateField
            size="sm"
            value={to}
            onChange={setTo}
            min={from}
            placeholder="End date"
          />
        </FilterField>
        <FilterField label="Applies to" flex={FILTER_FLEX.wide} minW={0}>
          <Text fontSize="xs" color="gray.500" pt={2}>
            {showAnalytics
              ? "Charts and time-based report exports"
              : "Time-based report exports"}
          </Text>
        </FilterField>
      </FilterToolbar>

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}
      {analyticsError ? <PageErrorBanner>{analyticsError}</PageErrorBanner> : null}

      {showAnalytics ? (
        <Box>
          <Flex align="center" gap={2} mb={4}>
            <FiBarChart2 size={16} color="#166a82" />
            <Text fontSize="md" fontWeight="semibold" color="brand.800">
              Visual analytics
            </Text>
          </Flex>
          <BusinessInsightsPanel
            data={analytics}
            loading={analyticsLoading}
            error={analyticsError}
          />
        </Box>
      ) : null}

      <Box borderTop={showAnalytics ? "1px solid" : undefined} borderColor="gray.100" pt={showAnalytics ? 2 : 0}>
        <Text fontSize="md" fontWeight="semibold" color="brand.800" mb={1}>
          Downloadable reports
        </Text>
        <Text fontSize="sm" color="gray.500" mb={4}>
          {partnerView
            ? "Export subscriber, revenue, and occupancy summaries for your records."
            : "Export detailed data in Excel or PDF for sharing and record-keeping."}
        </Text>
      </Box>

      {loading ? (
        <ReportsPageSkeleton />
      ) : (
        grouped.map(([category, items]) => (
          <Box key={category}>
            <Flex align="center" gap={2} mb={3}>
              <Badge colorPalette={CATEGORY_COLORS[category] || "gray"} variant="subtle">
                {category}
              </Badge>
              <Text fontSize="xs" color="gray.400">
                {items.length} report{items.length !== 1 ? "s" : ""}
              </Text>
            </Flex>
            <Grid
              templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" }}
              gap={3}
            >
              {items.map((report) => (
                <Box
                  key={report.id}
                  bg="white"
                  border="1px solid"
                  borderColor="gray.100"
                  borderRadius="lg"
                  p={4}
                  display="flex"
                  flexDirection="column"
                  gap={3}
                >
                  <Box flex={1}>
                    <Text fontWeight="semibold" fontSize="sm" color="gray.800">
                      {report.title}
                    </Text>
                    <Text fontSize="xs" color="gray.500" mt={1} lineHeight="tall">
                      {report.description}
                    </Text>
                    {!report.dateFilter && (
                      <Badge size="sm" variant="outline" colorPalette="gray" mt={2}>
                        Snapshot (no date filter)
                      </Badge>
                    )}
                  </Box>
                  <Flex gap={2}>
                    <Button
                      size="sm"
                      variant="outline"
                      flex={1}
                      loading={downloading === `${report.id}-xlsx`}
                      onClick={() => download(report, "xlsx")}
                    >
                      <FiFile style={{ marginRight: 6 }} />
                      Excel
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      flex={1}
                      loading={downloading === `${report.id}-pdf`}
                      onClick={() => download(report, "pdf")}
                    >
                      <FiFileText style={{ marginRight: 6 }} />
                      PDF
                    </Button>
                  </Flex>
                </Box>
              ))}
            </Grid>
          </Box>
        ))
      )}

      {!loading && reports.length > 0 && (
        <Flex align="center" gap={2} color="gray.400" fontSize="xs">
          <FiDownload size={12} />
          <Text>
            {reports.length} reports available · Excel (.xlsx) and PDF formats supported
          </Text>
        </Flex>
      )}
    </Stack>
  );
}
