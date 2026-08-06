/** Match server buildCustomerNumber: POP[-BUILDING]-APT */
export function buildCustomerNumberPreview(
  building: {
    c2bCode?: string | null;
    b2bCode?: string | null;
    buildingCode?: string | null;
  } | null | undefined,
  customerType: "C2B" | "B2B",
  apartmentNumber: string
): string {
  if (!building || !apartmentNumber.trim()) return "";
  const popCode = String(
    customerType === "B2B" ? building.b2bCode : building.c2bCode || ""
  )
    .trim()
    .toUpperCase();
  const buildingCode = String(building.buildingCode || "")
    .trim()
    .toUpperCase();
  const apt = apartmentNumber.trim().toUpperCase();
  if (!popCode) return "";
  if (buildingCode && buildingCode !== popCode) {
    return `${popCode}-${buildingCode}-${apt}`;
  }
  return `${popCode}-${apt}`;
}
