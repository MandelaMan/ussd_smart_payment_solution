/**
 * Pure customer-number helpers (POP[-BUILDING]-APT, cancel archive).
 * Kept free of DB so process-flow tests can cover numbering without MySQL.
 */

/**
 * Match server buildCustomerNumber: POP[-BUILDING]-APT
 * Multi-building POPs: POP-BUILDING-APT (e.g. AZE-TGA-401A).
 * Single-building POPs leave building_code empty → POP-APT (e.g. ET-401A).
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

/**
 * Acceptable paybill BillRefNumber / AccountReference shapes.
 * Aligns with buildCustomerNumber output (2–3 hyphen segments), rejects
 * archived cancel numbers and free-text placeholders.
 */
function isValidPaybillAccountRef(ref) {
  const value = String(ref || "")
    .trim()
    .toUpperCase();
  if (!value) return false;
  if (/-CXL-\d+$/i.test(value)) return false;
  // POP-APT or POP-BUILDING-APT (POP codes 2–10 alnum; apt/building 1–20)
  return /^[A-Z0-9]{2,10}(-[A-Z0-9]{1,20}){1,2}$/.test(value);
}

module.exports = {
  buildCustomerNumber,
  liveCustomerNumber,
  archiveCancelledCustomerNumber,
  isValidPaybillAccountRef,
};
