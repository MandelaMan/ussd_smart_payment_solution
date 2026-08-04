/**
 * Build Zoho Books billing_address object from a local customer (or row).
 * Returns null when no address fields are set.
 */
function buildZohoBillingAddress(customer) {
  if (!customer || typeof customer !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const v = customer[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };
  const address = {
    attention: pick("billingAttention", "billing_attention"),
    address: pick("billingAddress", "billing_address"),
    street2: pick("billingStreet2", "billing_street2"),
    city: pick("billingCity", "billing_city"),
    state: pick("billingState", "billing_state"),
    zip: pick("billingZip", "billing_zip"),
    country: pick("billingCountry", "billing_country"),
  };
  const hasAny = Object.values(address).some(Boolean);
  if (!hasAny) return null;
  if (!address.country) address.country = "Kenya";
  return address;
}

module.exports = { buildZohoBillingAddress };
