const path = require("path");
const fs = require("fs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const LOGO_WIDTH = 140;
const LOGO_HEIGHT = 48;
const LOGO_EXCEL_ROW_HEIGHT = 52;

function resolveReportLogoPath() {
  const candidates = [
    path.join(__dirname, "../../admin/public/logo.png"),
    path.join(__dirname, "../../admin/dist/logo.png"),
    path.join(process.cwd(), "admin/public/logo.png"),
    path.join(process.cwd(), "admin/dist/logo.png"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function cellValue(val) {
  if (val == null) return "";
  if (val instanceof Date) return val.toISOString().slice(0, 19).replace("T", " ");
  return String(val);
}

function summaryTotalLabel(summary) {
  return summary?.totalLabel || "Total";
}

function appendReportSummaryRows(sheet, report, startRowIndex) {
  let rowIndex = startRowIndex;
  const summary = report.summary;
  if (!summary) return rowIndex;

  const writeLabelValue = (label, value, bold = false) => {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    if (bold) {
      row.getCell(1).font = { bold: true };
      row.getCell(2).font = { bold: true };
    }
    rowIndex += 1;
  };

  sheet.mergeCells(rowIndex, 1, rowIndex, Math.max(report.headers.length, 2));
  const heading = sheet.getCell(rowIndex, 1);
  heading.value = "Summary";
  heading.font = { bold: true, size: 11 };
  rowIndex += 1;

  if (summary.total != null) {
    writeLabelValue(summaryTotalLabel(summary), summary.total, true);
  }
  if (summary.totalOutstanding != null) {
    writeLabelValue("Total outstanding (KES)", summary.totalOutstanding, true);
  }
  if (summary.activeCustomers != null) {
    writeLabelValue("Active customers", summary.activeCustomers, true);
  }
  if (summary.totalAmount != null) {
    writeLabelValue("Total amount (KES)", summary.totalAmount, true);
  }

  if (Array.isArray(summary.lines) && summary.lines.length) {
    for (const item of summary.lines) {
      writeLabelValue(item.label || "", item.value ?? "");
    }
  }

  if (Array.isArray(summary.byReason) && summary.byReason.length) {
    rowIndex += 1;
    const reasonHeader = sheet.getRow(rowIndex);
    reasonHeader.getCell(1).value = "Reason";
    reasonHeader.getCell(2).value = "Count";
    reasonHeader.getCell(3).value = "Outstanding (KES)";
    reasonHeader.eachCell((cell) => {
      cell.font = { bold: true };
    });
    rowIndex += 1;

    for (const item of summary.byReason) {
      const row = sheet.getRow(rowIndex);
      row.getCell(1).value = item.label || item.reason || "";
      row.getCell(2).value = item.count ?? 0;
      row.getCell(3).value = item.outstanding ?? 0;
      rowIndex += 1;
    }
  }

  return rowIndex + 1;
}

async function toExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Starlynx Admin";
  workbook.created = new Date();

  const logoPath = resolveReportLogoPath();
  let headerRowIndex = 1;

  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  if (logoPath) {
    sheet.getRow(1).height = LOGO_EXCEL_ROW_HEIGHT;
    const imageId = workbook.addImage({
      filename: logoPath,
      extension: "png",
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
    });
    headerRowIndex = 2;
  }

  if (report.period) {
    const titleRowIndex = headerRowIndex;
    sheet.mergeCells(titleRowIndex, 1, titleRowIndex, report.headers.length);
    const titleCell = sheet.getCell(titleRowIndex, 1);
    titleCell.value = `${report.title} (${report.period.from} to ${report.period.to})`;
    titleCell.font = { bold: true, size: 12 };
    headerRowIndex = titleRowIndex + 2;
  }

  if (report.summary) {
    headerRowIndex = appendReportSummaryRows(sheet, report, headerRowIndex);
  }

  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  const headerRow = sheet.getRow(headerRowIndex);
  report.headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A6B8A" },
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
    };
  });
  headerRow.commit();

  for (const row of report.rows) {
    const dataRow = sheet.addRow(
      report.headers.map((h) => cellValue(row[h.key]))
    );
    dataRow.eachCell((cell) => {
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
      };
    });
  }

  report.headers.forEach((h, i) => {
    const col = sheet.getColumn(i + 1);
    const maxLen = Math.max(
      h.label.length,
      ...report.rows.slice(0, 100).map((r) => cellValue(r[h.key]).length)
    );
    col.width = Math.min(Math.max(maxLen + 2, 12), 40);
  });

  sheet.addRow([]);
  const summaryParts = [`Total rows: ${report.rows.length}`];
  if (report.summary?.total != null) {
    summaryParts.push(`${summaryTotalLabel(report.summary)}: ${report.summary.total}`);
  }
  if (report.summary?.totalOutstanding != null) {
    summaryParts.push(`Total outstanding: ${report.summary.totalOutstanding}`);
  }
  if (report.summary?.activeCustomers != null) {
    summaryParts.push(`Active customers: ${report.summary.activeCustomers}`);
  }
  if (report.summary?.totalAmount != null) {
    summaryParts.push(`Total amount: ${report.summary.totalAmount}`);
  }
  if (Array.isArray(report.summary?.lines)) {
    for (const item of report.summary.lines) {
      summaryParts.push(`${item.label}: ${item.value ?? ""}`);
    }
  }
  const summaryRow = sheet.addRow([summaryParts.join(" · ")]);
  summaryRow.getCell(1).font = { italic: true, color: { argb: "FF666666" } };

  return workbook.xlsx.writeBuffer();
}

function toPdf(report) {
  return new Promise((resolve, reject) => {
    const logoPath = resolveReportLogoPath();
    const doc = new PDFDocument({
      size: "A4",
      layout: report.headers.length > 6 ? "landscape" : "portrait",
      margin: 40,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;
    let y = doc.page.margins.top;

    if (logoPath) {
      doc.image(logoPath, startX, y, { width: LOGO_WIDTH });
      y += LOGO_HEIGHT + 14;
    }

    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111111");
    doc.text(report.title, startX, y, { align: "left", width: doc.page.width - startX * 2 });
    y = doc.y + 4;

    if (report.period) {
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#666666")
        .text(`Period: ${report.period.from} to ${report.period.to}`, startX, y);
      y = doc.y + 6;
    }

    if (report.summary) {
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#111111");
      doc.text("Summary", startX, y);
      y = doc.y + 4;
      doc.fontSize(9).font("Helvetica").fillColor("#333333");
      if (report.summary.total != null) {
        doc.text(`${summaryTotalLabel(report.summary)}: ${report.summary.total}`, startX, y);
        y = doc.y + 2;
      }
      if (report.summary.totalOutstanding != null) {
        doc.text(
          `Total outstanding (KES): ${Number(report.summary.totalOutstanding).toLocaleString("en-KE")}`,
          startX,
          y
        );
        y = doc.y + 2;
      }
      if (report.summary.activeCustomers != null) {
        doc.text(`Active customers: ${report.summary.activeCustomers}`, startX, y);
        y = doc.y + 2;
      }
      if (report.summary.totalAmount != null) {
        doc.text(
          `Total amount (KES): ${Number(report.summary.totalAmount).toLocaleString("en-KE")}`,
          startX,
          y
        );
        y = doc.y + 2;
      }
      if (Array.isArray(report.summary.lines) && report.summary.lines.length) {
        for (const item of report.summary.lines) {
          doc.text(`${item.label || ""}: ${item.value ?? ""}`, startX, y);
          y = doc.y + 2;
        }
      }
      if (Array.isArray(report.summary.byReason) && report.summary.byReason.length) {
        y += 4;
        for (const item of report.summary.byReason) {
          doc.text(
            `${item.label || item.reason}: ${item.count ?? 0} · Outstanding KES ${Number(item.outstanding ?? 0).toLocaleString("en-KE")}`,
            startX,
            y
          );
          y = doc.y + 2;
        }
      }
      y += 8;
    }

    doc
      .fontSize(9)
      .fillColor("#333333")
      .text(
        `Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
        startX,
        y
      );
    y = doc.y + 14;

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / report.headers.length;
    const cellPadX = 4;
    const cellPadY = 4;
    const minRowHeight = 18;
    const textWidth = colWidth - cellPadX * 2;

    function measureWrappedHeight(text, fontName, fontSize) {
      doc.font(fontName).fontSize(fontSize);
      const measured = doc.heightOfString(String(text || ""), {
        width: textWidth,
        lineGap: 1,
      });
      return Math.max(minRowHeight, Math.ceil(measured + cellPadY * 2));
    }

    function drawWrappedCell(text, x, cellY, fontName, fontSize, color) {
      doc.font(fontName).fontSize(fontSize).fillColor(color);
      // No height/ellipsis cap — row height is pre-measured so full text stays visible.
      doc.text(String(text || ""), x + cellPadX, cellY + cellPadY, {
        width: textWidth,
        lineGap: 1,
        ellipsis: false,
      });
    }

    function drawHeaderRow() {
      const headerHeight = Math.max(
        minRowHeight,
        ...report.headers.map((h) => measureWrappedHeight(h.label, "Helvetica-Bold", 8))
      );
      report.headers.forEach((h, i) => {
        const x = startX + i * colWidth;
        doc.rect(x, y, colWidth, headerHeight).fill("#1A6B8A");
        drawWrappedCell(h.label, x, y, "Helvetica-Bold", 8, "#FFFFFF");
      });
      y += headerHeight;
      doc.fillColor("#333333");
    }

    function ensureSpace(neededHeight) {
      const bottom = doc.page.height - doc.page.margins.bottom;
      if (y + neededHeight > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow();
      }
    }

    drawHeaderRow();

    for (let ri = 0; ri < report.rows.length; ri++) {
      const row = report.rows[ri];
      const values = report.headers.map((h) => cellValue(row[h.key]));
      const rowHeight = Math.max(
        minRowHeight,
        ...values.map((value) => measureWrappedHeight(value, "Helvetica", 7))
      );
      ensureSpace(rowHeight);
      if (ri % 2 === 1) {
        doc.rect(startX, y, pageWidth, rowHeight).fill("#F7F9FB");
      }
      values.forEach((value, i) => {
        const x = startX + i * colWidth;
        drawWrappedCell(value, x, y, "Helvetica", 7, "#333333");
      });
      y += rowHeight;
    }

    ensureSpace(24);
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666");
    const footerParts = [`Total rows: ${report.rows.length}`];
    if (report.summary?.total != null) {
      footerParts.push(`${summaryTotalLabel(report.summary)}: ${report.summary.total}`);
    }
    if (report.summary?.totalOutstanding != null) {
      footerParts.push(
        `Total outstanding: KES ${Number(report.summary.totalOutstanding).toLocaleString("en-KE")}`
      );
    }
    if (report.summary?.activeCustomers != null) {
      footerParts.push(`Active customers: ${report.summary.activeCustomers}`);
    }
    if (report.summary?.totalAmount != null) {
      footerParts.push(
        `Total amount: KES ${Number(report.summary.totalAmount).toLocaleString("en-KE")}`
      );
    }
    if (Array.isArray(report.summary?.lines)) {
      for (const item of report.summary.lines) {
        footerParts.push(`${item.label}: ${item.value ?? ""}`);
      }
    }
    doc.text(footerParts.join(" · "), startX, y + 8, {
      width: pageWidth,
      ellipsis: false,
    });

    doc.end();
  });
}

module.exports = { toExcel, toPdf, resolveReportLogoPath };
