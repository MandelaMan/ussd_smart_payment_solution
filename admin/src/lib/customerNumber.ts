/** Match server buildCustomerNumber: POP[-BUILDING]-APT or POP[-BUILDING]-SHP-LOCATION */

const SHOP_LOCATION_CODE_MAX = 20;

export function shopLocationCode(value: string | null | undefined): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, SHOP_LOCATION_CODE_MAX);
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
    : apartmentNumber.trim().toUpperCase();
  if (!popCode || !unit) return "";
  const unitSegment = isShop ? `SHP-${unit}` : unit;
  if (buildingCode && buildingCode !== popCode) {
    return `${popCode}-${buildingCode}-${unitSegment}`;
  }
  return `${popCode}-${unitSegment}`;
}
