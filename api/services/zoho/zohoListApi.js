const { callZoho, withTimeout } = require("../../controllers/zoho.controller");

const RESOURCE_CONFIG = {
  contacts: { endpoint: "contacts", listKey: "contacts" },
  invoices: { endpoint: "invoices", listKey: "invoices" },
  customerpayments: { endpoint: "customerpayments", listKey: "customerpayments" },
  recurringinvoices: { endpoint: "recurringinvoices", listKey: "recurringinvoices" },
  estimates: { endpoint: "estimates", listKey: "estimates" },
  creditnotes: { endpoint: "creditnotes", listKey: "creditnotes" },
};

function formatZohoModifiedTime(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${oh}${om}`
  );
}

function parseZohoModifiedTime(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Paginated Zoho Books list with optional incremental filter.
 * @param {keyof typeof RESOURCE_CONFIG} resource
 */
async function fetchZohoListPage(resource, options = {}) {
  const cfg = RESOURCE_CONFIG[resource];
  if (!cfg) throw new Error(`Unknown Zoho resource: ${resource}`);

  const page = Number(options.page || 1);
  const perPage = Math.min(Number(options.perPage || 200), 200);
  const params = {
    page,
    per_page: perPage,
    sort_column: "last_modified_time",
    sort_order: "A",
    ...(options.extraParams || {}),
  };

  const modified = formatZohoModifiedTime(options.lastModifiedTime);
  if (modified) params.last_modified_time = modified;

  const data = await withTimeout(
    callZoho(cfg.endpoint, "GET", null, params),
    15_000,
    `zoho-list-${resource}`
  );

  const items = data[cfg.listKey] || data[resource] || [];
  return {
    items,
    page,
    hasMore: Boolean(data.page_context?.has_more_page),
    pageContext: data.page_context || null,
  };
}

async function fetchZohoRecord(resource, recordId) {
  const cfg = RESOURCE_CONFIG[resource];
  if (!cfg || !recordId) return null;
  const singular = cfg.listKey.replace(/s$/, "");
  const data = await withTimeout(
    callZoho(`${cfg.endpoint}/${recordId}`, "GET", null, {}),
    12_000,
    `zoho-get-${resource}`
  );
  return data[singular] || data[cfg.listKey]?.[0] || data;
}

module.exports = {
  RESOURCE_CONFIG,
  formatZohoModifiedTime,
  parseZohoModifiedTime,
  fetchZohoListPage,
  fetchZohoRecord,
};
