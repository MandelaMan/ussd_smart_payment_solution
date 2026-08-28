/** Match server buildCustomerNumber: POP[-BUILDING]-APT or POP[-BUILDING]-SHP-LOCATION */

const SHOP_LOCATION_CODE_MAX = 20;
export const APARTMENT_UNIT_MAX = 16;
export const BLOCK_MAX = 50;

export function shopLocationCode(value: string | null | undefined): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, SHOP_LOCATION_CODE_MAX);
}

export function normalizeBlockInput(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .slice(0, BLOCK_MAX);
}

/** Keep unit typing to letters/numbers and at most one hyphen (4G, APT-101). */
export function apartmentUnitInput(value: string | null | undefined): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, APARTMENT_UNIT_MAX);
}

export function apartmentUnitLooksCompound(
  value: string | null | undefined,
  building?: {
    c2bCode?: string | null;
    b2bCode?: string | null;
    buildingCode?: string | null;
  } | null
): boolean {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return false;
  if (/BLOCK/.test(raw) || (raw.match(/-/g) || []).length > 1) return true;
  const compact = raw.replace(/-/g, "");
  const segments = raw.split("-").filter(Boolean);
  const codes = [building?.c2bCode, building?.b2bCode, building?.buildingCode]
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean);
  for (const code of codes) {
    if (segments.includes(code)) return true;
    if (
      compact.startsWith(code) &&
      compact.length > code.length &&
      /[0-9]/.test(compact.slice(code.length))
    ) {
      return true;
    }
  }
  return false;
}

export function formatCustomerBlock(block: string | null | undefined): string {
  const s = String(block || "").trim();
  if (!s) return "";
  return /^block\b/i.test(s) ? s : `Block ${s}`;
}

export function buildCustomerNumberPreview(
  building: {
    c2bCode?: string | null;
    b2bCode?: string | null;
    buildingCode?: string | null;
  } | null | undefined,
  customerType: "C2B" | "B2B",
  apartmentNumber: string,
  premiseType: "apartment" | "shop" = "apartment"
): string {
  if (!building) return "";
  const popCode = String(
    customerType === "B2B" ? building.b2bCode : building.c2bCode || ""
  )
    .trim()
    .toUpperCase();
  const buildingCode = String(building.buildingCode || "")
    .trim()
    .toUpperCase();
  const isShop = premiseType === "shop";
  const unit = isShop
    ? shopLocationCode(apartmentNumber)
    : apartmentUnitInput(apartmentNumber).replace(/^-|-$/g, "");
  if (!popCode || !unit) return "";
  const unitSegment = isShop ? `SHP-${unit}` : unit;
  if (buildingCode && buildingCode !== popCode) {
    return `${popCode}-${buildingCode}-${unitSegment}`;
  }
  return `${popCode}-${unitSegment}`;
}
