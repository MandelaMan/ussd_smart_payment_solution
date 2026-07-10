const { toExcel, toPdf } = require("./reportExport");

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function reportToCsv(report) {
  const headerLine = report.headers.map((h) => csvCell(h.label)).join(",");
  const lines = [headerLine];
  for (const row of report.rows) {
    lines.push(report.headers.map((h) => csvCell(row[h.key])).join(","));
  }
  return lines.join("\n");
}

async function sendTableExport(res, report, format, filenameBase) {
  const safeFormat = String(format || "csv").toLowerCase();

  if (safeFormat === "xls" || safeFormat === "xlsx") {
    const buffer = await toExcel(report);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filenameBase}.xlsx"`
    );
    return res.send(Buffer.from(buffer));
  }

  if (safeFormat === "pdf") {
    const buffer = await toPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filenameBase}.pdf"`
    );
    return res.send(buffer);
  }

  const csv = reportToCsv(report);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenameBase}.csv"`
  );
  return res.send(csv);
}

module.exports = { reportToCsv, sendTableExport };
