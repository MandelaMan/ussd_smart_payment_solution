/**
 * Zoho Books transaction number series for recurring invoices.
 *
 * Series live on the Internet/DSTV location (associated_series):
 * Enaki Series, Skynest Series, Colosseum Series, GM Azalea Series.
 * Recurring create must send autonumbergenerationgroup_id — otherwise
 * child invoices use Default Transaction Series.
 */

const DEFAULT_SERIES_NAME_RE = /\bdefault\b/i;

const SERIES_RULES = [
  {
    hint: "skynest",
    names: ["skynest"],
    prefixes: ["SKY", "SKYB"],
  },
  {
    hint: "enaki",
    names: ["enaki"],
    prefixes: ["ET", "ETH"],
  },
  {
    hint: "colosseum",
    names: ["colosseum"],
    prefixes: ["CL", "CLB"],
  },
  {
    hint: "azalea",
    names: ["azalea", "brookside", "taarifa"],
    prefixes: ["AZE", "AZEB"],
  },
];

function textOf(value) {
  return String(value || "").trim().toLowerCase();
}

function codeOf(value) {
  return String(value || "").trim().toUpperCase();
}

function codeMatchesPrefix(value, prefixes) {
  const code = codeOf(value);
  if (!code) return false;
  return prefixes.some((prefix) => code === prefix || code.startsWith(`${prefix}-`));
}

function customerLocationHaystack(customer = {}) {
  return [
    customer.popName,
    customer.pop_name,
    customer.buildingName,
    customer.building_name,
  ]
    .map(textOf)
    .filter(Boolean)
    .join(" ");
}

function customerSeriesHint(customer = {}) {
  const haystack = customerLocationHaystack(customer);
  const codes = [
    customer.customerNumber,
    customer.customer_number,
    customer.c2bCode,
    customer.c2b_code,
    customer.b2bCode,
    customer.b2b_code,
    customer.buildingCode,
    customer.building_code,
  ];

  for (const rule of SERIES_RULES) {
    if (rule.names.some((name) => haystack.includes(name))) return rule.hint;
    if (codes.some((code) => codeMatchesPrefix(code, rule.prefixes))) {
      return rule.hint;
    }
  }
  return null;
}

function seriesNameOf(series) {
  return String(
    series?.autonumbergenerationgroup_name || series?.name || ""
  ).trim();
}

function seriesIdOf(series) {
  const id = series?.autonumbergenerationgroup_id || series?.id;
  return id != null && String(id).trim() ? String(id).trim() : "";
}

function isDefaultSeries(series) {
  return DEFAULT_SERIES_NAME_RE.test(seriesNameOf(series));
}

/**
 * Pick the Zoho series for this customer/POP from a location's associated_series.
 */
function pickZohoTransactionSeries(seriesList, customer) {
  const hint = customerSeriesHint(customer);
  if (!hint || !Array.isArray(seriesList) || !seriesList.length) return null;

  const matches = seriesList.filter((series) => {
    if (isDefaultSeries(series)) return false;
    return seriesNameOf(series).toLowerCase().includes(hint);
  });
  const picked = matches.find((series) => seriesIdOf(series)) || matches[0] || null;
  if (!picked || !seriesIdOf(picked)) return null;
  return picked;
}

function invoiceSeriesPayload(locationId, series) {
  const payload = {};
  if (locationId) payload.location_id = String(locationId);
  const seriesId = seriesIdOf(series);
  if (seriesId) payload.autonumbergenerationgroup_id = seriesId;
  return Object.keys(payload).length ? payload : null;
}

module.exports = {
  SERIES_RULES,
  customerSeriesHint,
  pickZohoTransactionSeries,
  invoiceSeriesPayload,
  seriesIdOf,
  seriesNameOf,
};
