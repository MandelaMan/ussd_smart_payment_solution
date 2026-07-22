const CUSTOMER_IMPORT_HEADERS = [
  "first_name",
  "last_name",
  "middle_name",
  "phone",
  "email",
  "customer_type",
  "apartment_number",
  "building_name",
  "payment_frequency",
  "custom_period_days",
  "product_name",
  "is_vat_exempt",
  "agency_name",
  "ip_prefix",
  "ip_last_octet",
  "dstv_decoder_serial",
];

const EXAMPLE_ROW = [
  "John",
  "Smith",
  "",
  "0712345678",
  "john@example.com",
  "C2B",
  "S444",
  "Enaki",
  "monthly",
  "",
  "Basic - Internet + Apartonet Channels",
  "No",
  "",
  "10.12.10.",
  "42",
  "",
];

function escapeCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCustomerImportTemplateCsv() {
  const lines = [
    CUSTOMER_IMPORT_HEADERS.map(escapeCsvCell).join(","),
    EXAMPLE_ROW.map(escapeCsvCell).join(","),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCustomerImportCsv(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row");
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.every((c) => !String(c).trim())) continue;

    const row = {};
    headers.forEach((h, idx) => {
      row[h] = String(cells[idx] ?? "").trim();
    });
    rows.push({ line: i + 1, ...row });
  }

  return rows;
}

module.exports = {
  CUSTOMER_IMPORT_HEADERS,
  buildCustomerImportTemplateCsv,
  parseCustomerImportCsv,
};
