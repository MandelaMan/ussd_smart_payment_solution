/**
 * Pure customer-number helpers (POP[-BUILDING]-APT, cancel archive).
 * Kept free of DB so process-flow tests can cover numbering without MySQL.
 */

function normalizePremiseType(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "shop"
    ? "shop"
    : "apartment";
}

/**
 * Next unused shop unit code in a building: SH01, SH02, … SH99, SH100.
 * `existingUnitCodes` should be every live unit in that building so shops
 * never collide with an apartment already named SH01.
 */
function nextShopUnitCode(existingUnitCodes) {
  const used = new Set(
    (Array.isArray(existingUnitCodes) ? existingUnitCodes : [])
      .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean)
  );
  for (let i = 1; i <= 9999; i++) {
    const code = `SH${String(i).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
  throw new Error("No shop unit codes remaining in this building");
}

/**
 * Match server buildCustomerNumber: POP[-BUILDING]-APT
 * Multi-building POPs: POP-BUILDING-APT (e.g. AZE-TGA-401A).
 * Single-building POPs leave building_code empty → POP-APT (e.g. ET-401A).
 * Shops use the same formula with an auto-assigned SH01 unit segment.
 */
function buildCustomerNumber(building, customerType, apartmentNumber) {
  const popCode = String(
    customerType === "B2B"
      ? building?.b2b_code || building?.b2bCode
      : building?.c2b_code || building?.c2bCode
  )
    .trim()
    .toUpperCase();
  const buildingCode = String(
    building?.building_code || building?.buildingCode || ""
  )
    .trim()
    .toUpperCase();
  const apt = String(apartmentNumber || "")
    .trim()
    .toUpperCase();
  if (!popCode || !apt) return "";
  if (buildingCode && buildingCode !== popCode) {
    return `${popCode}-${buildingCode}-${apt}`;
  }
  return `${popCode}-${apt}`;
}

/**
 * Same apartment, other billing type: CL-A10 ↔ CLB-A10, AZE-TGA-401A ↔ AZEB-TGA-401A.
 */
function alternateTypeCustomerNumber(building, customerType, apartmentNumber) {
  const current = String(customerType || "").toUpperCase();
  if (current !== "C2B" && current !== "B2B") return "";
  const other = current === "B2B" ? "C2B" : "B2B";
  return String(buildCustomerNumber(building, other, apartmentNumber) || "")
    .trim()
    .toUpperCase();
}

/** Live apartment number with any cancel archive suffix stripped (H302-CXL-12 → H302). */
function liveCustomerNumber(customerNumber) {
  return String(customerNumber || "")
    .trim()
    .toUpperCase()
    .replace(/-CXL-\d+$/i, "");
}

/**
 * Archive a cancelled customer's live account number so the next tenant can
 * reuse the apartment-based number. VARCHAR(50): {number}-CXL-{id}
 */
function archiveCancelledCustomerNumber(customerNumber, customerId) {
  const base = liveCustomerNumber(customerNumber);
  const idNum = Number(customerId);
  const idPart =
    Number.isFinite(idNum) && idNum > 0
      ? String(Math.trunc(idNum))
      : String(customerId || Date.now()).replace(/\D/g, "").slice(-8) ||
        String(Date.now()).slice(-8);
  const suffix = `-CXL-${idPart}`;
  const maxBase = Math.max(1, 50 - suffix.length);
  return `${base.slice(0, maxBase)}${suffix}`;
}

/** Alphanumeric-only compare key: ET-T506, et t506, ETT506 → ETT506 */
function compactCustomerNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Canonical paybill shape: uppercase, spaces/underscores/slashes → hyphens.
 * "ET T506", "et_t506", "et-t506" → "ET-T506"
 */
function normalizePaybillAccountRef(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s_./\\]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function paybillRefTokens(value) {
  const normalized = normalizePaybillAccountRef(value);
  const compact = compactCustomerNumber(value);
  const lastSegment = normalized.split("-").filter(Boolean).pop() || "";
  return { normalized, compact, lastSegment };
}

function significantPhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 9) return "";
  return digits.slice(-9);
}

function paybillPhonesMatch(a, b) {
  const left = significantPhoneDigits(a);
  const right = significantPhoneDigits(b);
  return Boolean(left && right && left === right);
}

function customerNumberOf(customer) {
  return liveCustomerNumber(
    customer?.customerNumber || customer?.customer_number || ""
  );
}

function apartmentNumberOf(customer) {
  return String(
    customer?.apartmentNumber || customer?.apartment_number || ""
  )
    .trim()
    .toUpperCase();
}

function isCancelledPaybillCustomer(customer) {
  const status = String(customer?.status || "").toLowerCase();
  if (status === "cancelled") return true;
  const raw = String(
    customer?.customerNumber || customer?.customer_number || ""
  );
  return /-CXL-\d+$/i.test(raw);
}

/**
 * Score how well a stored customer matches a typed paybill BillRefNumber.
 * Higher is better. 0 = no match.
 * 100 exact canonical, 90 compact (ETT506), 70 hyphen-suffix (t506 → ET-T506),
 * 60 apartment number. Phone match adds 20 when MSISDN is provided.
 */
function scoreCustomerAgainstPaybillRef(customer, rawRef, options = {}) {
  if (!customer || isCancelledPaybillCustomer(customer)) return 0;
  const { normalized, compact, lastSegment } = paybillRefTokens(rawRef);
  if (!compact || compact.length < 3) return 0;

  const number = customerNumberOf(customer);
  if (!number) return 0;
  const numNorm = normalizePaybillAccountRef(number);
  const numCompact = compactCustomerNumber(number);
  const apt = apartmentNumberOf(customer);

  let score = 0;
  if (numNorm === normalized) score = 100;
  else if (numCompact === compact) score = 90;
  else if (lastSegment.length >= 3 && numNorm.endsWith(`-${lastSegment}`)) {
    score = 70;
  } else if (
    apt &&
    lastSegment.length >= 3 &&
    (apt === lastSegment || apt === normalized)
  ) {
    score = 60;
  } else {
    return 0;
  }

  if (options.msisdn && paybillPhonesMatch(options.msisdn, customer.phone)) {
    score += 20;
  }
  return score;
}

/**
 * Pick a unique live customer for a messy paybill ref.
 * Returns null when nothing matches or several customers share the top score.
 */
function pickUniquePaybillCustomer(customers, rawRef, options = {}) {
  const list = Array.isArray(customers) ? customers : [];
  const scored = list
    .map((customer) => ({
      customer,
      score: scoreCustomerAgainstPaybillRef(customer, rawRef, options),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (a.customer.id || 0) - (b.customer.id || 0));

  if (!scored.length) return null;
  const best = scored[0].score;
  const ties = scored.filter((row) => row.score === best);
  if (ties.length !== 1) return null;
  return ties[0].customer;
}

/**
 * Acceptable paybill BillRefNumber / AccountReference shapes.
 * Tolerates spaces, mixed case, missing hyphens, and apartment-only tokens
 * (t506) when the last segment contains a digit. Rejects archived cancel
 * numbers and free-text placeholders like "Starlynx Utility".
 */
function isValidPaybillAccountRef(ref) {
  const { normalized, compact, lastSegment } = paybillRefTokens(ref);
  if (!normalized || compact.length < 3) return false;
  if (/-CXL-\d+$/i.test(normalized) || /CXL\d+$/i.test(compact)) return false;
  if (!/[0-9]/.test(lastSegment)) return false;

  // POP-APT or POP-BUILDING-APT after space→hyphen normalize
  if (/^[A-Z0-9]{2,10}(-[A-Z0-9]{1,20}){1,2}$/.test(normalized)) return true;

  // Compact missing hyphens (ETT506) or apartment-only (T506)
  return /^[A-Z0-9]{3,30}$/.test(compact) && /[A-Z]/.test(compact);
}

module.exports = {
  normalizePremiseType,
  nextShopUnitCode,
  buildCustomerNumber,
  alternateTypeCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  compactCustomerNumber,
  normalizePaybillAccountRef,
  paybillRefTokens,
  scoreCustomerAgainstPaybillRef,
  pickUniquePaybillCustomer,
  isValidPaybillAccountRef,
};
