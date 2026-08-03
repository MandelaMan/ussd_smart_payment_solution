const {
  listReportDefinitions,
  listPartnerReportDefinitions,
  isPartnerReport,
  getReportDefinition,
  runReport,
  getMonthlyPaymentChurnSummary,
  getInvoicesVsPaymentsSummary,
} = require("../services/reportStore");
const { getReportAnalytics } = require("../services/reportAnalyticsStore");
const { toExcel, toPdf, toCsv } = require("../utils/reportExport");
const { getKpiSnapshot, METRIC_DICTIONARY, getExpectedCollections } = require("../services/kpiEngine");
const { normalizeRole, ROLES } = require("../middleware/rbac");

function isPartnerUser(req) {
  return normalizeRole(req.user?.role) === ROLES.PARTNER;
}

function parseReportParams(query = {}) {
  return {
    from: query.from,
    to: query.to,
    month: query.month,
    year: query.year,
    monthFrom: query.monthFrom,
    monthTo: query.monthTo,
    buildingId: query.buildingId,
    productId: query.productId,
    agencyId: query.agencyId,
    customerStatus: query.customerStatus,
    paymentStatus: query.paymentStatus,
  };
}

async function listReports(req, res, next) {
  try {
    const reports = isPartnerUser(req)
      ? listPartnerReportDefinitions()
      : listReportDefinitions();
    return res.json({ reports, families: [
      "Executive",
      "Financial",
      "Billing",
      "Forecasting",
      "Customer",
      "Network",
      "Audit",
    ]});
  } catch (err) {
    return next(err);
  }
}

async function previewReport(req, res, next) {
  try {
    const { id } = req.params;
    if (isPartnerUser(req) && !isPartnerReport(id)) {
      return res.status(403).json({ error: "Report not available for your role." });
    }
    const def = getReportDefinition(id);
    if (!def) return res.status(404).json({ error: "Report not found." });
    if (def.available === false) {
      return res.status(503).json({
        error: "This report is catalogued but not yet available.",
        report: def,
      });
    }

    const report = await runReport(id, parseReportParams(req.query));
    if (!report) return res.status(404).json({ error: "Report not found." });

    const previewLimit = Math.min(Number(req.query.limit) || 100, 500);
    const sections = Array.isArray(report.sections) && report.sections.length
      ? report.sections.map((s) => ({
          title: s.title,
          headers: s.headers,
          rows: (s.rows || []).slice(0, previewLimit),
          totalRows: (s.rows || []).length,
        }))
      : [
          {
            title: null,
            headers: report.headers || [],
            rows: (report.rows || []).slice(0, previewLimit),
            totalRows: (report.rows || []).length,
          },
        ];

    return res.json({
      id,
      title: report.title || def.title,
      period: report.period || null,
      summary: report.summary || null,
      matrix: report.matrix || null,
      sections,
      truncated: sections.some((s) => s.totalRows > previewLimit),
    });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function downloadReport(req, res, next) {
  try {
    const { id } = req.params;
    const format = (req.query.format || "xlsx").toLowerCase();

    if (isPartnerUser(req) && !isPartnerReport(id)) {
      return res.status(403).json({ error: "Report not available for your role." });
    }

    const def = getReportDefinition(id);
    if (!def) {
      return res.status(404).json({ error: "Report not found." });
    }
    if (def.available === false) {
      return res.status(503).json({ error: "This report is not yet available for download." });
    }

    if (!["xlsx", "pdf", "csv"].includes(format)) {
      return res.status(400).json({ error: "Format must be xlsx, pdf, or csv." });
    }

    const report = await runReport(id, parseReportParams(req.query));

    if (!report) {
      return res.status(404).json({ error: "Report not found." });
    }

    const safeName = def.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const dateSuffix = report.period
      ? `-${report.period.from}-to-${report.period.to}`
      : "";
    const ext = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
    const filename = `${safeName}${dateSuffix}.${ext}`;

    if (format === "xlsx") {
      const buffer = await toExcel(report);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buffer));
    }

    if (format === "csv") {
      const buffer = toCsv(report);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

    const buffer = await toPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}

async function getAnalytics(req, res, next) {
  try {
    const data = await getReportAnalytics({
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function getKpis(req, res, next) {
  try {
    const [kpis, expected] = await Promise.all([
      getKpiSnapshot(
        {
          buildingId: req.query.buildingId,
          productId: req.query.productId,
          agencyId: req.query.agencyId,
          customerStatus: req.query.customerStatus,
          subscriptionStatus: req.query.subscriptionStatus,
        },
        { from: req.query.from, to: req.query.to }
      ),
      getExpectedCollections({ days: Number(req.query.horizonDays) || 30 }).catch(() => ({
        expectedCollections: 0,
        invoiceCount: 0,
      })),
    ]);
    kpis.expectedCollections = expected.expectedCollections;
    kpis.expectedInvoiceCount = expected.invoiceCount;
    return res.json({ kpis, dictionary: METRIC_DICTIONARY });
  } catch (err) {
    return next(err);
  }
}

async function getMonthlyPaymentChurnSummaryHandler(req, res, next) {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const summary = await getMonthlyPaymentChurnSummary(month);
    return res.json(summary);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function getInvoicesVsPaymentsSummaryHandler(req, res, next) {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const summary = await getInvoicesVsPaymentsSummary(month);
    return res.json(summary);
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

module.exports = {
  listReports,
  previewReport,
  downloadReport,
  getAnalytics,
  getKpis,
  getMonthlyPaymentChurnSummaryHandler,
  getInvoicesVsPaymentsSummaryHandler,
};
