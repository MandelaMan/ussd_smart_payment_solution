/**
 * Build Zoho Books billing_address object from a local customer (or row).
 * Returns null when no address fields are set.
 *
 * Zoho Books caps street lines at 100 characters (and city/state/zip/country
 * at 50). Our DB allows longer values — clamp here so contact sync does not
 * fail with: Please ensure that the "billing_address" has less than 100 characters.
 */

const ZOHO_BILLING_FIELD_MAX = {
  attention: 100,
  address: 100,
  street2: 100,
  city: 50,
  state: 50,
  zip: 50,
  country: 50,
};

function clampField(value, max) {
  const s = String(value || "").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max).trim();
}

function splitAtLimit(value, max) {
  const s = String(value || "").trim();
  if (s.length <= max) return { head: s, tail: "" };
  const window = s.slice(0, max);
  const breakAt = Math.max(
    window.lastIndexOf(","),
    window.lastIndexOf(";"),
    window.lastIndexOf(" ")
  );
  const splitAt = breakAt >= Math.floor(max * 0.5) ? breakAt : max;
  return {
    head: s.slice(0, splitAt).trim(),
    tail: s.slice(splitAt).trim(),
  };
}

/**
 * Keep street line 1 within Zoho's 100-char cap. Overflow goes onto street2
 * (also capped) so invoices still show as much of the address as Books allows.
 */
function splitStreetLines(address, street2, max = ZOHO_BILLING_FIELD_MAX.address) {
  const { head, tail } = splitAtLimit(address, max);
  const line2 = [tail, String(street2 || "").trim()].filter(Boolean).join(", ");
  return {
    address: head,
    street2: clampField(line2, ZOHO_BILLING_FIELD_MAX.street2),
  };
}

function buildZohoBillingAddress(customer) {
  if (!customer || typeof customer !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const v = customer[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };

  const lines = splitStreetLines(
    pick("billingAddress", "billing_address"),
    pick("billingStreet2", "billing_street2")
  );

  const address = {
    attention: clampField(
      pick("billingAttention", "billing_attention"),
      ZOHO_BILLING_FIELD_MAX.attention
    ),
    address: lines.address,
    street2: lines.street2,
    city: clampField(pick("billingCity", "billing_city"), ZOHO_BILLING_FIELD_MAX.city),
    state: clampField(pick("billingState", "billing_state"), ZOHO_BILLING_FIELD_MAX.state),
    zip: clampField(pick("billingZip", "billing_zip"), ZOHO_BILLING_FIELD_MAX.zip),
    country: clampField(
      pick("billingCountry", "billing_country"),
      ZOHO_BILLING_FIELD_MAX.country
    ),
  };
  const hasAny = Object.values(address).some(Boolean);
  if (!hasAny) return null;
  if (!address.country) address.country = "Kenya";
  return address;
}

module.exports = {
  ZOHO_BILLING_FIELD_MAX,
  buildZohoBillingAddress,
  splitStreetLines,
  clampField,
};
