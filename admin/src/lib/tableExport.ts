import type { ListPagination } from "./api";

export type ExportScope = "view" | "all";
export type ExportFormat = "csv" | "xls" | "pdf";

export const DEFAULT_EXPORT_FORMATS: ExportFormat[] = ["csv", "xls", "pdf"];

export type ExportColumn<T> = {
  key?: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
};

export type ExportColumnOption = {
  key: string;
  label: string;
  required?: boolean;
};

export type ExportOptions = {
  columns?: "all" | string[];
};

export function resolveExportColumnKeys(
  options: ExportColumnOption[],
  selection: "all" | string[]
): string[] {
  if (selection === "all") return options.map((col) => col.key);
  const keys = new Set<string>();
  for (const col of options) {
    if (col.required) keys.add(col.key);
  }
  for (const key of selection) keys.add(key);
  return options.filter((col) => keys.has(col.key)).map((col) => col.key);
}

export function filterExportColumnsByKeys<T>(
  columns: ExportColumn<T>[],
  keys: string[]
): ExportColumn<T>[] {
  const keySet = new Set(keys);
  const keyed = columns.filter((col) => col.key && keySet.has(col.key));
  if (keyed.length) return keyed;
  return columns.filter((_, index) => keySet.has(`c${index}`));
}

export type TableExportReport = {
  title: string;
  headers: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null | undefined>>;
};

function escapeCsvCell(value: unknown): string {
  const text =
    value == null
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number"
          ? String(value)
          : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((col) => escapeCsvCell(col.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escapeCsvCell(col.value(row))).join(","));
  }
  return lines.join("\n");
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = "text/csv;charset=utf-8"
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCsvExport<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  downloadTextFile(filename, rowsToCsv(columns, rows));
}

export function buildExportFilename(
  base: string,
  scope: ExportScope,
  format: ExportFormat
) {
  const ext = format === "xls" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
  const suffix = scope === "view" ? "current-view" : "all-records";
  return `${base}-${suffix}.${ext}`;
}

export function titleFromFilenameBase(base: string) {
  return base
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function columnsToReport<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[]
): TableExportReport {
  const headers = columns.map((col, index) => ({
    key: `c${index}`,
    label: col.header,
  }));
  const dataRows = rows.map((row) => {
    const mapped: Record<string, string> = {};
    columns.forEach((col, index) => {
      const value = col.value(row);
      mapped[`c${index}`] = value == null ? "" : String(value);
    });
    return mapped;
  });
  return { title, headers, rows: dataRows };
}

export async function fetchAllPaginatedRows<T>(
  fetchPage: (
    page: number,
    limit: number
  ) => Promise<{ data: T[]; pagination: ListPagination }>,
  pageSize = 100
): Promise<T[]> {
  const first = await fetchPage(1, pageSize);
  const rows = [...first.data];
  for (let page = 2; page <= first.pagination.pages; page += 1) {
    const next = await fetchPage(page, pageSize);
    rows.push(...next.data);
  }
  return rows;
}

async function downloadServerTableExport(
  report: TableExportReport,
  format: ExportFormat,
  filename: string
) {
  const { api } = await import("./api");
  await api.exportTableReport(report, format, filename);
}

export async function exportTableData<T>({
  scope,
  format,
  filenameBase,
  title,
  columns,
  columnKeys,
  viewRows,
  fetchAllRows,
}: {
  scope: ExportScope;
  format: ExportFormat;
  filenameBase: string;
  title?: string;
  columns: ExportColumn<T>[];
  columnKeys?: "all" | string[];
  viewRows: T[];
  fetchAllRows: () => Promise<T[]>;
}) {
  const rows = scope === "view" ? viewRows : await fetchAllRows();
  const filename = buildExportFilename(filenameBase, scope, format);
  const exportColumns =
    columnKeys && columnKeys !== "all"
      ? filterExportColumnsByKeys(columns, columnKeys)
      : columns;

  if (format === "csv") {
    downloadCsvExport(filename, exportColumns, rows);
    return;
  }

  const report = columnsToReport(
    title ?? titleFromFilenameBase(filenameBase),
    exportColumns,
    rows
  );
  await downloadServerTableExport(report, format, filename);
}
