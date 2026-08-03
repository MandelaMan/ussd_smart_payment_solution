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

function resolveReportSections(report) {
  if (Array.isArray(report.sections) && report.sections.length) {
    return report.sections;
  }
  return [
    {
      title: null,
      headers: report.headers || [],
      rows: report.rows || [],
    },
  ];
}

function maxHeaderCount(report) {
  if (report.matrix?.groups?.length) {
    return Math.max(
      2,
      1 + report.matrix.groups.reduce((n, g) => n + (g.columns || []).length, 0)
    );
  }
  return Math.max(
    2,
    ...(resolveReportSections(report).map((s) => (s.headers || []).length) || [0]),
    report.headers?.length || 0
  );
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

  sheet.mergeCells(rowIndex, 1, rowIndex, maxHeaderCount(report));
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

function writeExcelSection(sheet, section, startRowIndex) {
  let rowIndex = startRowIndex;
  const headers = section.headers || [];
  const rows = section.rows || [];

  if (section.title) {
    sheet.mergeCells(rowIndex, 1, rowIndex, Math.max(headers.length, 2));
    const titleCell = sheet.getCell(rowIndex, 1);
    titleCell.value = section.title;
    titleCell.font = { bold: true, size: 11 };
    rowIndex += 1;
  }

  const headerRow = sheet.getRow(rowIndex);
  headers.forEach((h, i) => {
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
  rowIndex += 1;

  for (const row of rows) {
    const dataRow = sheet.getRow(rowIndex);
    headers.forEach((h, i) => {
      const cell = dataRow.getCell(i + 1);
      cell.value = cellValue(row[h.key]);
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
      };
    });
    dataRow.commit();
    rowIndex += 1;
  }

  if (section.totals) {
    rowIndex += 1;
    const totals = section.totals;
    if (totals.count != null) {
      const countRow = sheet.getRow(rowIndex);
      countRow.getCell(1).value = totals.countLabel || "Count";
      countRow.getCell(2).value = totals.count;
      countRow.getCell(1).font = { bold: true };
      countRow.getCell(2).font = { bold: true };
      rowIndex += 1;
    }
    if (totals.value != null) {
      const totalRow = sheet.getRow(rowIndex);
      totalRow.getCell(1).value = totals.label || "Total (KES)";
      totalRow.getCell(2).value = totals.value;
      totalRow.getCell(1).font = { bold: true };
      totalRow.getCell(2).font = { bold: true };
      rowIndex += 1;
    }
    if (Array.isArray(totals.lines)) {
      for (const line of totals.lines) {
        const lineRow = sheet.getRow(rowIndex);
        lineRow.getCell(1).value = line.label || "";
        lineRow.getCell(2).value = line.value ?? "";
        lineRow.getCell(1).font = { bold: true };
        rowIndex += 1;
      }
    }
  }

  headers.forEach((h, i) => {
    const col = sheet.getColumn(i + 1);
    const maxLen = Math.max(
      Number(col.width) || 0,
      h.label.length,
      ...rows.slice(0, 100).map((r) => cellValue(r[h.key]).length)
    );
    col.width = Math.min(Math.max(maxLen + 2, 12), 40);
  });

  return rowIndex + 1;
}

function writeExcelMatrix(sheet, report, startRowIndex) {
  const matrix = report.matrix;
  const groups = matrix.groups || [];
  const rows = report.rows || [];
  const rowHeaderKey = matrix.rowHeaderKey || "customer";
  const rowHeaderLabel = matrix.rowHeaderLabel || "Customer";
  let rowIndex = startRowIndex;
  const groupRowIndex = rowIndex;
  const subRowIndex = rowIndex + 1;

  // Customer label spans both header rows.
  sheet.mergeCells(groupRowIndex, 1, subRowIndex, 1);
  const customerHeader = sheet.getCell(groupRowIndex, 1);
  customerHeader.value = rowHeaderLabel;
  customerHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  customerHeader.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  customerHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F4C5C" },
  };

  const groupHeaderRow = sheet.getRow(groupRowIndex);
  let col = 2;
  for (const group of groups) {
    const span = (group.columns || []).length;
    if (span <= 0) continue;
    const startCol = col;
    const endCol = col + span - 1;
    if (span > 1) {
      sheet.mergeCells(groupRowIndex, startCol, groupRowIndex, endCol);
    }
    const cell = groupHeaderRow.getCell(startCol);
    cell.value = group.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    for (let c = startCol; c <= endCol; c += 1) {
      const gCell = groupHeaderRow.getCell(c);
      gCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1A6B8A" },
      };
      gCell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      gCell.border = {
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
    }
    col = endCol + 1;
  }
  groupHeaderRow.height = 22;
  groupHeaderRow.commit();

  const subHeaderRow = sheet.getRow(subRowIndex);
  subHeaderRow.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F4C5C" },
  };
  col = 2;
  for (const group of groups) {
    for (const column of group.columns || []) {
      const cell = subHeaderRow.getCell(col);
      cell.value = column.label;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
      cell.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2A8AAB" },
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
      col += 1;
    }
  }
  subHeaderRow.height = 30;
  subHeaderRow.commit();
  rowIndex = subRowIndex + 1;

  const flatColumns = groups.flatMap((g) => g.columns || []);

  for (const row of rows) {
    const dataRow = sheet.getRow(rowIndex);
    dataRow.getCell(1).value = cellValue(row[rowHeaderKey]);
    dataRow.getCell(1).font = { bold: true };
    flatColumns.forEach((column, i) => {
      dataRow.getCell(i + 2).value = cellValue(row[column.key]);
      dataRow.getCell(i + 2).border = {
        bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
      };
    });
    dataRow.commit();
    rowIndex += 1;
  }

  sheet.getColumn(1).width = 16;
  flatColumns.forEach((column, i) => {
    const isDate = String(column.label || "").toLowerCase().includes("date");
    sheet.getColumn(i + 2).width = isDate ? 12 : 14;
  });

  return rowIndex + 1;
}

async function toExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Starlynx Admin";
  workbook.created = new Date();

  const logoPath = resolveReportLogoPath();
  let headerRowIndex = 1;
  const hasMatrix = Boolean(report.matrix?.groups?.length);
  const sections = hasMatrix ? [] : resolveReportSections(report);
  const colCount = hasMatrix
    ? 1 + report.matrix.groups.reduce((n, g) => n + (g.columns || []).length, 0)
    : maxHeaderCount(report);

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
    sheet.mergeCells(titleRowIndex, 1, titleRowIndex, Math.max(colCount, 2));
    const titleCell = sheet.getCell(titleRowIndex, 1);
    titleCell.value = `${report.title} (${report.period.from} to ${report.period.to})`;
    titleCell.font = { bold: true, size: 12 };
    headerRowIndex = titleRowIndex + 2;
  }

  if (report.summary) {
    headerRowIndex = appendReportSummaryRows(sheet, report, headerRowIndex);
  }

  const freezeAt = headerRowIndex + (hasMatrix ? 1 : 0);
  sheet.views = [{ state: "frozen", xSplit: hasMatrix ? 1 : 0, ySplit: freezeAt }];

  if (hasMatrix) {
    headerRowIndex = writeExcelMatrix(sheet, report, headerRowIndex);
  } else {
    for (const section of sections) {
      headerRowIndex = writeExcelSection(sheet, section, headerRowIndex);
    }
  }

  const totalRows = hasMatrix
    ? (report.rows || []).length
    : sections.reduce((sum, s) => sum + (s.rows || []).length, 0);
  sheet.addRow([]);
  const summaryParts = [`Total rows: ${totalRows}`];
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
    let pdfReport = report;

    // Wide month matrices don't fit one PDF page — chunk into sections of up to
    // 3 months each so every selected month is included (not only Q1).
    if (report.matrix?.groups?.length) {
      const groups = report.matrix.groups;
      const rowHeaderKey = report.matrix.rowHeaderKey || "customer";
      const rowHeaderLabel = report.matrix.rowHeaderLabel || "Customer";
      const chunkSize = 3;
      const chunks = [];
      for (let i = 0; i < groups.length; i += chunkSize) {
        const slice = groups.slice(i, i + chunkSize);
        const title =
          groups.length <= chunkSize
            ? null
            : slice.length === 1
              ? slice[0].label
              : `${slice[0].label} – ${slice[slice.length - 1].label}`;
        chunks.push({ title, groups: slice });
      }
      pdfReport = {
        ...report,
        matrix: null,
        sections: chunks.map((q) => {
          const headers = [
            { key: rowHeaderKey, label: rowHeaderLabel },
            ...q.groups.flatMap((g) => g.columns || []),
          ];
          return {
            title: q.title,
            headers,
            matrixGroups: q.groups,
            rowHeaderKey,
            rowHeaderLabel,
            rows: (report.rows || []).map((row) => {
              const out = {};
              for (const h of headers) out[h.key] = row[h.key];
              return out;
            }),
          };
        }),
      };
    }

    const sections = resolveReportSections(pdfReport);
    const widestHeaders = sections.reduce(
      (best, section) =>
        (section.headers || []).length > best.length ? section.headers || [] : best,
      pdfReport.headers || []
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: widestHeaders.length > 6 ? "landscape" : "portrait",
      margin: 36,
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
    doc.text(pdfReport.title, startX, y, { align: "left", width: doc.page.width - startX * 2 });
    y = doc.y + 4;

    if (pdfReport.period) {
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#666666")
        .text(`Period: ${pdfReport.period.from} to ${pdfReport.period.to}`, startX, y);
      y = doc.y + 6;
    }

    if (pdfReport.summary) {
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#111111");
      doc.text("Summary", startX, y);
      y = doc.y + 4;
      doc.fontSize(9).font("Helvetica").fillColor("#333333");
      if (pdfReport.summary.total != null) {
        doc.text(`${summaryTotalLabel(pdfReport.summary)}: ${pdfReport.summary.total}`, startX, y);
        y = doc.y + 2;
      }
      if (pdfReport.summary.totalOutstanding != null) {
        doc.text(
          `Total outstanding (KES): ${Number(pdfReport.summary.totalOutstanding).toLocaleString("en-KE")}`,
          startX,
          y
        );
        y = doc.y + 2;
      }
      if (pdfReport.summary.activeCustomers != null) {
        doc.text(`Active customers: ${pdfReport.summary.activeCustomers}`, startX, y);
        y = doc.y + 2;
      }
      if (pdfReport.summary.totalAmount != null) {
        doc.text(
          `Total amount (KES): ${Number(pdfReport.summary.totalAmount).toLocaleString("en-KE")}`,
          startX,
          y
        );
        y = doc.y + 2;
      }
      if (Array.isArray(pdfReport.summary.lines) && pdfReport.summary.lines.length) {
        for (const item of pdfReport.summary.lines) {
          doc.text(`${item.label || ""}: ${item.value ?? ""}`, startX, y);
          y = doc.y + 2;
        }
      }
      if (Array.isArray(pdfReport.summary.byReason) && pdfReport.summary.byReason.length) {
        y += 4;
        for (const item of pdfReport.summary.byReason) {
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

    function drawSection(section) {
      const headers = section.headers || [];
      const rows = section.rows || [];
      const matrixGroups = section.matrixGroups || null;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / Math.max(headers.length, 1);
      const cellPadX = 3;
      const cellPadY = 3;
      const minRowHeight = 16;
      const textWidth = colWidth - cellPadX * 2;

      function measureWrappedHeight(text, fontName, fontSize) {
        doc.font(fontName).fontSize(fontSize);
        const measured = doc.heightOfString(String(text || ""), {
          width: textWidth,
          lineGap: 1,
        });
        return Math.max(minRowHeight, Math.ceil(measured + cellPadY * 2));
      }

      function drawWrappedCell(text, x, cellY, width, fontName, fontSize, color, align = "left") {
        doc.font(fontName).fontSize(fontSize).fillColor(color);
        doc.text(String(text || ""), x + cellPadX, cellY + cellPadY, {
          width: width - cellPadX * 2,
          lineGap: 1,
          align,
          ellipsis: false,
        });
      }

      function drawPlainHeaderRow() {
        const headerHeight = Math.max(
          minRowHeight,
          ...headers.map((h) => measureWrappedHeight(h.label, "Helvetica-Bold", 7))
        );
        headers.forEach((h, i) => {
          const x = startX + i * colWidth;
          doc.rect(x, y, colWidth, headerHeight).fill("#1A6B8A");
          drawWrappedCell(h.label, x, y, colWidth, "Helvetica-Bold", 7, "#FFFFFF");
        });
        y += headerHeight;
        doc.fillColor("#333333");
      }

      function drawMatrixHeaderRows() {
        const groups = matrixGroups || [];
        const rowHeaderLabel = section.rowHeaderLabel || headers[0]?.label || "Customer";
        const subLabels = groups.flatMap((g) => (g.columns || []).map((c) => c.label));
        const groupHeight = 16;
        const subHeight = Math.max(
          18,
          ...subLabels.map((label) => measureWrappedHeight(label, "Helvetica-Bold", 6))
        );
        const totalHeaderHeight = groupHeight + subHeight;

        doc.rect(startX, y, colWidth, totalHeaderHeight).fill("#0F4C5C");
        drawWrappedCell(
          rowHeaderLabel,
          startX,
          y + (totalHeaderHeight - minRowHeight) / 2,
          colWidth,
          "Helvetica-Bold",
          7,
          "#FFFFFF",
          "center"
        );

        let colIndex = 1;
        for (const group of groups) {
          const span = (group.columns || []).length || 1;
          const groupWidth = colWidth * span;
          const x = startX + colIndex * colWidth;
          doc.rect(x, y, groupWidth, groupHeight).fill("#1A6B8A");
          drawWrappedCell(
            group.label,
            x,
            y,
            groupWidth,
            "Helvetica-Bold",
            8,
            "#FFFFFF",
            "center"
          );
          (group.columns || []).forEach((column, offset) => {
            const sx = startX + (colIndex + offset) * colWidth;
            doc.rect(sx, y + groupHeight, colWidth, subHeight).fill("#2A8AAB");
            drawWrappedCell(
              column.label,
              sx,
              y + groupHeight,
              colWidth,
              "Helvetica-Bold",
              6,
              "#FFFFFF",
              "center"
            );
          });
          colIndex += span;
        }

        y += totalHeaderHeight;
        doc.fillColor("#333333");
      }

      function drawHeaderRow() {
        if (matrixGroups?.length) drawMatrixHeaderRows();
        else drawPlainHeaderRow();
      }

      function ensureSpace(neededHeight, redrawHeader = false) {
        const bottom = doc.page.height - doc.page.margins.bottom;
        if (y + neededHeight > bottom) {
          doc.addPage();
          y = doc.page.margins.top;
          if (redrawHeader) drawHeaderRow();
        }
      }

      if (section.title) {
        ensureSpace(28);
        doc.fontSize(12).font("Helvetica-Bold").fillColor("#111111");
        doc.text(section.title, startX, y);
        y = doc.y + 8;
      }

      drawHeaderRow();

      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const values = headers.map((h) => cellValue(row[h.key]));
        const rowHeight = Math.max(
          minRowHeight,
          ...values.map((value) => measureWrappedHeight(value, "Helvetica", 6))
        );
        ensureSpace(rowHeight, true);
        if (ri % 2 === 1) {
          doc.rect(startX, y, pageWidth, rowHeight).fill("#F7F9FB");
        }
        values.forEach((value, i) => {
          const x = startX + i * colWidth;
          drawWrappedCell(value, x, y, colWidth, "Helvetica", 6, "#333333");
        });
        y += rowHeight;
      }

      if (section.totals) {
        ensureSpace(48);
        y += 6;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111");
        const totals = section.totals;
        if (totals.count != null) {
          doc.text(`${totals.countLabel || "Count"}: ${totals.count}`, startX, y);
          y = doc.y + 2;
        }
        if (totals.value != null) {
          doc.text(
            `${totals.label || "Total (KES)"}: ${Number(totals.value).toLocaleString("en-KE")}`,
            startX,
            y
          );
          y = doc.y + 2;
        }
        if (Array.isArray(totals.lines)) {
          for (const line of totals.lines) {
            doc.text(`${line.label || ""}: ${line.value ?? ""}`, startX, y);
            y = doc.y + 2;
          }
        }
      }

      y += 16;
    }

    for (const section of sections) {
      drawSection(section);
    }

    const totalRows = sections.reduce((sum, s) => sum + (s.rows || []).length, 0);
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (y + 24 > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666");
    const footerParts = [`Total rows: ${totalRows}`];
    if (pdfReport.summary?.total != null) {
      footerParts.push(`${summaryTotalLabel(pdfReport.summary)}: ${pdfReport.summary.total}`);
    }
    if (pdfReport.summary?.totalOutstanding != null) {
      footerParts.push(
        `Total outstanding: KES ${Number(pdfReport.summary.totalOutstanding).toLocaleString("en-KE")}`
      );
    }
    if (pdfReport.summary?.activeCustomers != null) {
      footerParts.push(`Active customers: ${pdfReport.summary.activeCustomers}`);
    }
    if (pdfReport.summary?.totalAmount != null) {
      footerParts.push(
        `Total amount: KES ${Number(pdfReport.summary.totalAmount).toLocaleString("en-KE")}`
      );
    }
    if (Array.isArray(pdfReport.summary?.lines)) {
      for (const item of pdfReport.summary.lines) {
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

function toCsv(report) {
  const lines = [];

  if (report.title) lines.push(csvEscape(report.title));
  if (report.period?.from && report.period?.to) {
    lines.push(csvEscape(`Period: ${report.period.from} to ${report.period.to}`));
  }
  lines.push("");

  if (report.matrix?.groups?.length) {
    const groups = report.matrix.groups;
    const rowHeaderKey = report.matrix.rowHeaderKey || "customer";
    const rowHeaderLabel = report.matrix.rowHeaderLabel || "Customer";
    const flatColumns = groups.flatMap((g) => g.columns || []);

    const groupRow = [csvEscape(rowHeaderLabel)];
    const subRow = [""];
    for (const group of groups) {
      const cols = group.columns || [];
      cols.forEach((column, i) => {
        groupRow.push(csvEscape(i === 0 ? group.label : ""));
        subRow.push(csvEscape(column.label || column.key));
      });
    }
    lines.push(groupRow.join(","));
    lines.push(subRow.join(","));

    for (const row of report.rows || []) {
      lines.push(
        [csvEscape(cellValue(row[rowHeaderKey])), ...flatColumns.map((c) => csvEscape(cellValue(row[c.key])))].join(
          ","
        )
      );
    }
    lines.push("");
  } else {
    const sections = resolveReportSections(report);
    for (const section of sections) {
      if (section.title) {
        lines.push(csvEscape(section.title));
      }
      const headers = section.headers || [];
      if (headers.length) {
        lines.push(headers.map((h) => csvEscape(h.label || h.key)).join(","));
      }
      for (const row of section.rows || []) {
        lines.push(headers.map((h) => csvEscape(cellValue(row[h.key]))).join(","));
      }
      lines.push("");
    }
  }

  if (report.summary?.lines?.length) {
    lines.push(csvEscape("Summary"));
    for (const item of report.summary.lines) {
      lines.push(`${csvEscape(item.label || "")},${csvEscape(item.value ?? "")}`);
    }
  }

  return Buffer.from(lines.join("\n"), "utf8");
}

function csvEscape(value) {
  const text = cellValue(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

module.exports = { toExcel, toPdf, toCsv, resolveReportLogoPath };
