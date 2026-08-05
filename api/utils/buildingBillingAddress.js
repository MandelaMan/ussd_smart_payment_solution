/**
 * Map a building's postal address into customer billing_* fields
 * (Zoho Books billing_address shape). PO Box has no Zoho key — fold into
 * address / street2 so invoices still show it.
 */

function trimOrEmpty(value) {
  if (value == null) return "";
  return String(value).trim();
}

function pick(source, ...keys) {
  for (const key of keys) {
    const v = trimOrEmpty(source?.[key]);
    if (v) return v;
  }
  return "";
}

function formatPoBox(poBox) {
  const s = trimOrEmpty(poBox);
  if (!s) return "";
  if (/^p\.?\s*o\.?\s*box\b/i.test(s)) return s;
  return `P.O. Box ${s}`;
}

/**
 * @param {object|null|undefined} building - mapped or raw building row
 * @returns {{
 *   billingAttention: string|null,
 *   billingAddress: string|null,
 *   billingStreet2: string|null,
 *   billingCity: string|null,
 *   billingState: string|null,
 *   billingZip: string|null,
 *   billingCountry: string|null,
 * }|null}
 */
function buildingToBillingAddress(building) {
  if (!building || typeof building !== "object") return null;

  const attention = pick(building, "addressAttention", "address_attention");
  let address = pick(building, "addressStreet", "address_street");
  let street2 = pick(building, "addressStreet2", "address_street2");
  const poBox = formatPoBox(
    pick(building, "addressPoBox", "address_po_box", "poBox")
  );
  const city = pick(building, "addressCity", "address_city");
  const state = pick(building, "addressState", "address_state");
  const zip = pick(building, "addressZip", "address_zip");
  let country = pick(building, "addressCountry", "address_country");

  if (poBox) {
    if (!address) {
      address = poBox;
    } else if (!street2) {
      street2 = poBox;
    } else {
      street2 = `${street2}; ${poBox}`;
    }
  }

  const hasAny =
    attention || address || street2 || city || state || zip || country;
  if (!hasAny) return null;
  if (!country) country = "Kenya";

  return {
    billingAttention: attention || null,
    billingAddress: address || null,
    billingStreet2: street2 || null,
    billingCity: city || null,
    billingState: state || null,
    billingZip: zip || null,
    billingCountry: country || null,
  };
}

function normalizeBuildingAddressFields(data = {}) {
  const trimOrNull = (v) => {
    const s = trimOrEmpty(v);
    return s || null;
  };
  return {
    addressAttention: trimOrNull(data.addressAttention),
    addressStreet: trimOrNull(data.addressStreet),
    addressStreet2: trimOrNull(data.addressStreet2),
    addressPoBox: trimOrNull(data.addressPoBox),
    addressCity: trimOrNull(data.addressCity),
    addressState: trimOrNull(data.addressState),
    addressZip: trimOrNull(data.addressZip),
    addressCountry: trimOrNull(data.addressCountry),
  };
}

module.exports = {
  buildingToBillingAddress,
  normalizeBuildingAddressFields,
  formatPoBox,
};
