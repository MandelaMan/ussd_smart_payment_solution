const {
  listReportDefinitions,
  listPartnerReportDefinitions,
  isPartnerReport,
  getReportDefinition,
  runReport,
  getMonthlyPaymentChurnSummary,
} = require("../services/reportStore");
const { getReportAnalytics } = require("../services/reportAnalyticsStore");
const { toExcel, toPdf } = require("../utils/reportExport");
const { normalizeRole, ROLES } = require("../middleware/rbac");

function isPartnerUser(req) {
  return normalizeRole(req.user?.role) === ROLES.PARTNER;
}

async function listReports(req, res, next) {
  try {
    const reports = isPartnerUser(req)
      ? listPartnerReportDefinitions()
      : listReportDefinitions();
    return res.json({ reports });
  } catch (err) {
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

    if (!["xlsx", "pdf"].includes(format)) {
      return res.status(400).json({ error: "Format must be xlsx or pdf." });
    }

    const report = await runReport(id, {
      from: req.query.from,
      to: req.query.to,
      month: req.query.month,
    });

    if (!report) {
      return res.status(404).json({ error: "Report not found." });
    }

    const safeName = def.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const dateSuffix = report.period
      ? `-${report.period.from}-to-${report.period.to}`
      : "";
    const filename = `${safeName}${dateSuffix}.${format === "xlsx" ? "xlsx" : "pdf"}`;

    if (format === "xlsx") {
      const buffer = await toExcel(report);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(buffer));
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

module.exports = {
  listReports,
  downloadReport,
  getAnalytics,
  getMonthlyPaymentChurnSummary: getMonthlyPaymentChurnSummaryHandler,
};
