export type PremiseType = "apartment" | "shop";

export function normalizePremiseType(value: unknown): PremiseType {
  return String(value || "")
    .trim()
    .toLowerCase() === "shop"
    ? "shop"
    : "apartment";
}

export function isShopPremise(
  value:
    | { premiseType?: string | null }
    | string
    | null
    | undefined
): boolean {
  if (value && typeof value === "object") {
    return normalizePremiseType(value.premiseType) === "shop";
  }
  return normalizePremiseType(value) === "shop";
}

export function customerDisplayTitle(customer: {
  fullName?: string | null;
  businessName?: string | null;
  premiseType?: string | null;
}): string {
  if (isShopPremise(customer) && customer.businessName) {
    return customer.businessName;
  }
  return String(customer.fullName || "").trim();
}

export function customerUnitLine(customer: {
  apartmentNumber?: string | null;
  shopLocation?: string | null;
  businessName?: string | null;
  premiseType?: string | null;
}): string {
  if (isShopPremise(customer)) {
    return customer.shopLocation || customer.apartmentNumber || "";
  }
  return customer.apartmentNumber || "";
}
