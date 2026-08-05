import type { Building } from "./api";

/** Format PO Box for Zoho street lines (Books has no dedicated po_box field). */
export function formatPoBox(poBox: string | null | undefined): string {
  const s = String(poBox || "").trim();
  if (!s) return "";
  if (/^p\.?\s*o\.?\s*box\b/i.test(s)) return s;
  return `P.O. Box ${s}`;
}

export type BillingAddressFields = {
  billingAttention: string;
  billingAddress: string;
  billingStreet2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingCountry: string;
};

/**
 * Map building postal address → customer billing fields (Zoho billing_address).
 * Returns null when the building has no address configured.
 */
export function buildingToBillingAddress(
  building: Building | null | undefined
): BillingAddressFields | null {
  if (!building) return null;

  const attention = String(building.addressAttention || "").trim();
  let address = String(building.addressStreet || "").trim();
  let street2 = String(building.addressStreet2 || "").trim();
  const poBox = formatPoBox(building.addressPoBox);
  const city = String(building.addressCity || "").trim();
  const state = String(building.addressState || "").trim();
  const zip = String(building.addressZip || "").trim();
  let country = String(building.addressCountry || "").trim();

  if (poBox) {
    if (!address) address = poBox;
    else if (!street2) street2 = poBox;
    else street2 = `${street2}; ${poBox}`;
  }

  if (!attention && !address && !street2 && !city && !state && !zip && !country) {
    return null;
  }

  return {
    billingAttention: attention,
    billingAddress: address,
    billingStreet2: street2,
    billingCity: city,
    billingState: state,
    billingZip: zip,
    billingCountry: country || "Kenya",
  };
}

export function isBillingAddressEmpty(fields: {
  billingAttention?: string;
  billingAddress?: string;
  billingStreet2?: string;
  billingCity?: string;
  billingState?: string;
  billingZip?: string;
  billingCountry?: string;
}): boolean {
  // Country defaults to "Kenya" in the form — ignore it when deciding emptiness.
  return !(
    String(fields.billingAttention || "").trim() ||
    String(fields.billingAddress || "").trim() ||
    String(fields.billingStreet2 || "").trim() ||
    String(fields.billingCity || "").trim() ||
    String(fields.billingState || "").trim() ||
    String(fields.billingZip || "").trim()
  );
}
