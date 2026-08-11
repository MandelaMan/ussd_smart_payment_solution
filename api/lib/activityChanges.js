/**
 * Structured before→after change entries for activity audit.
 * @typedef {{ field: string, label: string, from: string|null, to: string|null }} ActivityChange
 */

function norm(value) {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * @param {ActivityChange[]} changes
 * @param {string} field
 * @param {string} label
 * @param {unknown} from
 * @param {unknown} to
 * @param {{ secret?: boolean }} [opts]
 */
function pushChange(changes, field, label, from, to, opts = {}) {
  if (opts.secret) {
    const a = norm(from);
    const b = norm(to);
    if (a === b) return;
    changes.push({
      field,
      label,
      from: a ? "••••" : null,
      to: b ? "Updated" : null,
    });
    return;
  }
  const a = norm(from);
  const b = norm(to);
  if (a === b) return;
  changes.push({ field, label, from: a, to: b });
}

/**
 * Diff common customer profile fields for edit-customer audit.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @param {{ previousProductName?: string|null, nextProductName?: string|null }} [extra]
 * @returns {ActivityChange[]}
 */
function diffCustomerDetails(before, after, extra = {}) {
  /** @type {ActivityChange[]} */
  const changes = [];
  const pairs = [
    ["firstName", "First name"],
    ["lastName", "Last name"],
    ["middleName", "Middle name"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["billingAttention", "Billing attention"],
    ["billingAddress", "Billing address"],
    ["billingStreet2", "Billing street 2"],
    ["billingCity", "Billing city"],
    ["billingState", "Billing state"],
    ["billingZip", "Billing ZIP"],
    ["billingCountry", "Billing country"],
    ["isVatExempt", "VAT exempt"],
    ["ipAddress", "IP address"],
    ["apartmentNumber", "Apartment"],
    ["customerNumber", "Customer number"],
    ["dstvDecoderSerial", "DSTV decoder serial"],
    ["ppoeUsername", "PPPoE username"],
    ["paymentFrequency", "Payment frequency"],
    ["customPeriodDays", "Custom period (days)"],
    ["packagePrice", "Package price"],
  ];

  for (const [field, label] of pairs) {
    pushChange(changes, field, label, before?.[field], after?.[field]);
  }

  pushChange(
    changes,
    "product",
    "Package",
    extra.previousProductName || before?.productName || before?.productId,
    extra.nextProductName || after?.productName || after?.productId
  );

  pushChange(
    changes,
    "tispPassword",
    "PPPoE / TISP password",
    before?.tispPassword,
    after?.tispPassword,
    { secret: true }
  );

  return changes;
}

/**
 * @param {string} label
 * @param {unknown} from
 * @param {unknown} to
 * @returns {ActivityChange[]}
 */
function singleChange(field, label, from, to) {
  /** @type {ActivityChange[]} */
  const changes = [];
  pushChange(changes, field, label, from, to);
  return changes;
}

module.exports = {
  pushChange,
  diffCustomerDetails,
  singleChange,
  norm,
};
