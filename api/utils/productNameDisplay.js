/**
 * Repair common UTF-8→Latin-1 mojibake in product/package labels
 * (e.g. em dash — stored/read as "ΓÇö" / "γçö").
 */
function repairUtf8Mojibake(value) {
  return String(value || "")
    .replace(/ΓÇö|γçö|â€"|â€”|—|–/gi, "-")
    .replace(/ΓÇô|γçô|â€“/gi, "-")
    .replace(/Â·|ΓÇ£|γç£|·/gi, "-");
}

const PRODUCT_NAME_SEPARATORS =
  /\s*(?:·|•|―|–|—|-|\?\?|Â·|â€"|â€“|â€”|ΓÇö|ΓÇô|ΓÇ£|γçö|γçô|γç£)\s*/gi;

/** Normalize product name separators for API responses and charts (ASCII-safe). */
function formatProductNameForDisplay(value) {
  const raw = repairUtf8Mojibake(String(value || "").trim());
  if (!raw) return "";
  return raw.replace(PRODUCT_NAME_SEPARATORS, " - ");
}

module.exports = {
  repairUtf8Mojibake,
  formatProductNameForDisplay,
};
