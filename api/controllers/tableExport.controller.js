const { sendTableExport } = require("../utils/tableExportResponse");

const MAX_EXPORT_ROWS = 5000;

function normalizeReport(body) {
  const title = String(body?.title || "Export").trim() || "Export";
  const headers = Array.isArray(body?.headers) ? body.headers : [];
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  const normalizedHeaders = headers
    .map((header, index) => ({
      key: String(header?.key || `c${index}`),
      label: String(header?.label || header?.key || `Column ${index + 1}`),
    }))
    .filter((header) => header.label);

  if (!normalizedHeaders.length) {
    const error = new Error("Export headers are required");
    error.status = 400;
    throw error;
  }

  const normalizedRows = rows.map((row) => {
    const mapped = {};
    for (const header of normalizedHeaders) {
      mapped[header.key] = row?.[header.key] ?? "";
    }
    return mapped;
  });

  return { title, headers: normalizedHeaders, rows: normalizedRows };
}

async function exportTableReport(req, res, next) {
  try {
    const format = String(req.body?.format || "csv").toLowerCase();
    const filenameBase = String(req.body?.filenameBase || "export")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "export";

    const report = normalizeReport(req.body);
    if (report.rows.length > MAX_EXPORT_ROWS) {
      return res.status(400).json({
        error: `Export is limited to ${MAX_EXPORT_ROWS.toLocaleString()} rows. Try CSV or narrow your filters.`,
      });
    }

    return sendTableExport(res, report, format, filenameBase);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = { exportTableReport };
