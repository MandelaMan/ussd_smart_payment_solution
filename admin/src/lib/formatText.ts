export const DISPLAY_TEXT_MAX_LENGTH = 30;

/** Display person/entity names stored as ALL CAPS in title case. */
export function formatTitleCase(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(\w)/g, (_, letter: string) => letter.toUpperCase());
}

export function isLikelyCode(value: string | null | undefined): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return /^[A-Z0-9-]+$/.test(v) || /^\+?\d[\d\s-]+$/.test(v);
}

export function formatDisplayText(
  value: string | null | undefined,
  maxLength: number = DISPLAY_TEXT_MAX_LENGTH,
  titleCase?: boolean
): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const useTitleCase = titleCase ?? !isLikelyCode(raw);
  const formatted = useTitleCase ? formatTitleCase(raw) : raw;
  if (formatted.length <= maxLength) return formatted;
  return `${formatted.slice(0, maxLength)}…`;
}

export function getDisplayTextFull(
  value: string | null | undefined,
  titleCase?: boolean
): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const useTitleCase = titleCase ?? !isLikelyCode(raw);
  return useTitleCase ? formatTitleCase(raw) : raw;
}

/** Separators used between plan and category in stored product names. */
const PRODUCT_NAME_SEPARATORS =
  /\s*(?:·|•|―|–|—|-|\?\?|Â·|â€"|â€“|â€”|ΓÇö|ΓÇô|ΓÇ£)\s*/g;

/**
 * Repair common UTF-8→Latin-1 mojibake that shows up when stage DB/connection
 * charset differs from local (e.g. em dash — stored/read as "ΓÇö").
 */
function repairUtf8Mojibake(value: string): string {
  return value
    .replace(/ΓÇö|â€"|â€”/g, "—")
    .replace(/ΓÇô|â€“/g, "–")
    .replace(/Â·|ΓÇ£/g, "·");
}

/** Normalize product name separators for display (fixes mojibake like "ΓÇö" / "??"). */
export function formatProductNameForDisplay(value: string | null | undefined): string {
  const raw = repairUtf8Mojibake(String(value || "").trim());
  if (!raw) return "";
  return raw.replace(PRODUCT_NAME_SEPARATORS, " — ");
}

/** Sentence-case labels for table headers (first letter upper, rest lower). Preserves C2B/B2B/TISP acronyms. */
export function formatDataTableColumnLabel(label: string): string {
  const raw = label.trim();
  if (!raw) return "";
  if (/^(C2B|B2B|TISP)$/i.test(raw)) return raw.toUpperCase();
  if (/^TISP\s/i.test(raw)) {
    return `TISP${raw.slice(4).charAt(0).toLowerCase()}${raw.slice(5).toLowerCase()}`;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function formatCustomerPackageLabel(
  productName: string | null | undefined,
  mbps: number | null | undefined
): string {
  const name = formatProductNameForDisplay(productName);
  if (!name) return "";
  if (mbps == null || !Number.isFinite(mbps)) return name;
  return `${name} (${mbps} Mbps)`;
}
