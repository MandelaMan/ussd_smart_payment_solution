const { applyAgencyUnitDiscount } = require("./b2bBilling");

const CUSTOMER_NUMBER_RE = /\b([A-Z]{2,5}B?-[A-Z0-9][A-Z0-9-]*)\b/i;

function parseRawJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function lineItemAmount(item) {
  const qty = Number(item?.quantity ?? 1) || 1;
  if (item?.item_total != null && item.item_total !== "") {
    return Math.round((Number(item.item_total) || 0) * 100) / 100;
  }
  return Math.round((Number(item?.rate) || 0) * qty * 100) / 100;
}

function extractCustomerNumberFromText(...parts) {
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!text) continue;
    const match = text.match(CUSTOMER_NUMBER_RE);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * Allocate from Zoho line_items when descriptions/names embed customer numbers.
 * @returns {Map<number, number>|null}
 */
function extractLineItemAllocations(rawJson, customerNumberToId) {
  const raw = parseRawJson(rawJson);
  const items = raw?.line_items || raw?.invoice?.line_items;
  if (!Array.isArray(items) || !items.length) return null;

  /** @type {Map<number, number>} */
  const out = new Map();
  let matched = 0;
  for (const item of items) {
    const number = extractCustomerNumberFromText(item.description, item.name, item.reference_number);
    if (!number) continue;
    const customerId = customerNumberToId.get(number);
    if (!customerId) continue;
    const amount = lineItemAmount(item);
    if (amount <= 0) continue;
    out.set(customerId, (out.get(customerId) || 0) + amount);
    matched += 1;
  }
  return matched > 0 ? out : null;
}

function unitWeight(customer) {
  const gross = Number(customer?.package_price ?? customer?.packagePrice ?? 0) || 0;
  const discount =
    customer?.discount_percent ?? customer?.discountPercent ?? customer?.agency_discount_percent;
  return Math.max(applyAgencyUnitDiscount(gross, discount), 0);
}

/**
 * Split `total` across customers by negotiated unit weight (package after agency discount).
 * Rounding remainder goes to the last share so the sum matches `total`.
 * @returns {Map<number, number>}
 */
function allocateAmountAmongCustomers(total, customers) {
  const amount = Math.round((Number(total) || 0) * 100) / 100;
  /** @type {Map<number, number>} */
  const out = new Map();
  const peers = (customers || []).filter((c) => c && Number(c.id) > 0);
  if (!peers.length || amount <= 0) return out;

  const weights = peers.map((c) => ({
    id: Number(c.id),
    weight: unitWeight(c) || 1,
  }));
  const weightSum = weights.reduce((s, w) => s + w.weight, 0) || weights.length;

  let allocated = 0;
  const shares = weights.map((w, idx) => {
    const raw =
      idx === weights.length - 1
        ? Math.round((amount - allocated) * 100) / 100
        : Math.round(((amount * w.weight) / weightSum) * 100) / 100;
    if (idx < weights.length - 1) allocated += raw;
    return { id: w.id, amount: raw };
  });

  const sum = shares.reduce((s, x) => s + x.amount, 0);
  if (shares.length && Math.abs(sum - amount) >= 0.01) {
    shares[shares.length - 1].amount =
      Math.round((shares[shares.length - 1].amount + (amount - sum)) * 100) / 100;
  }

  for (const share of shares) {
    if (share.amount === 0) continue;
    out.set(share.id, Math.round(((out.get(share.id) || 0) + share.amount) * 100) / 100);
  }
  return out;
}

function isConsolidatedAgencyDocument(amount, peers) {
  const list = peers || [];
  if (list.length <= 1) return false;
  const maxPkg = Math.max(...list.map((p) => Number(p.package_price) || 0), 0);
  const total = Number(amount) || 0;
  if (maxPkg <= 0) return total > 0 && list.length > 1;
  return total > maxPkg * 1.5;
}

/**
 * Attribute a Zoho document amount to individual customers.
 * C2B / single-house B2B → keep customer.
 * Consolidated B2B agency invoices/payments → split across agency managed houses
 * (line items when present, else pro-rata by package after discount).
 *
 * @returns {Array<{ customerId: number, amount: number }>}
 */
function attributeDocumentAmount({
  amount,
  rawJson = null,
  keepCustomer,
  agencyPeers = [],
} = {}) {
  const total = Math.round((Number(amount) || 0) * 100) / 100;
  if (total <= 0 || !keepCustomer?.id) return [];

  const keepId = Number(keepCustomer.id);
  const isB2B = String(keepCustomer.customer_type || "").toUpperCase() === "B2B";
  const peers =
    isB2B && Array.isArray(agencyPeers) && agencyPeers.length
      ? agencyPeers
      : [{ ...keepCustomer, id: keepId }];

  if (!isB2B || !keepCustomer.agency_id) {
    return [{ customerId: keepId, amount: total }];
  }

  const numberToId = new Map(
    peers
      .filter((p) => p?.customer_number)
      .map((p) => [String(p.customer_number).trim().toUpperCase(), Number(p.id)])
  );

  const fromLines = extractLineItemAllocations(rawJson, numberToId);
  if (fromLines?.size) {
    return [...fromLines.entries()].map(([customerId, share]) => ({
      customerId,
      amount: share,
    }));
  }

  if (!isConsolidatedAgencyDocument(total, peers)) {
    return [{ customerId: keepId, amount: total }];
  }

  const allocated = allocateAmountAmongCustomers(total, peers);
  return [...allocated.entries()].map(([customerId, share]) => ({
    customerId,
    amount: share,
  }));
}

module.exports = {
  attributeDocumentAmount,
  allocateAmountAmongCustomers,
  isConsolidatedAgencyDocument,
  extractLineItemAllocations,
  unitWeight,
};
