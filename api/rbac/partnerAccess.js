/**
 * Partner subtype access: Investor, DSTV Partner, Internet Partner.
 * All partner types are view-only. DSTV partners are limited to DSTV subscribers.
 */

const { AsyncLocalStorage } = require("node:async_hooks");

function isAdminRole(role) {
  return role === "admin";
}

const PARTNER_TYPES = Object.freeze({
  INVESTOR: "investor",
  DSTV: "dstv",
  INTERNET: "internet",
});

const PARTNER_TYPE_PERMISSIONS = Object.freeze({
  investor: "partner.investor",
  dstv: "partner.dstv",
  internet: "partner.internet",
});

const PARTNER_TYPE_GROUPS = Object.freeze({
  investor: "partner-investor",
  dstv: "partner-dstv",
  internet: "customer-relations",
});

const partnerCustomerScopeAls = new AsyncLocalStorage();

function permissionSetFrom(input) {
  if (input instanceof Set) return input;
  if (Array.isArray(input)) return new Set(input);
  return new Set();
}

function groupSlugSet(groups) {
  return new Set(
    (groups || []).map((g) => (typeof g === "string" ? g : g?.slug)).filter(Boolean)
  );
}

function hasPartnerMarker(perms, slugs) {
  return (
    perms.has("dashboard.partner") ||
    perms.has(PARTNER_TYPE_PERMISSIONS.investor) ||
    perms.has(PARTNER_TYPE_PERMISSIONS.dstv) ||
    perms.has(PARTNER_TYPE_PERMISSIONS.internet) ||
    slugs.has(PARTNER_TYPE_GROUPS.investor) ||
    slugs.has(PARTNER_TYPE_GROUPS.dstv) ||
    slugs.has(PARTNER_TYPE_GROUPS.internet)
  );
}

function typeFromMarkers(perms, slugs) {
  const investor =
    perms.has(PARTNER_TYPE_PERMISSIONS.investor) ||
    slugs.has(PARTNER_TYPE_GROUPS.investor);
  const internet =
    perms.has(PARTNER_TYPE_PERMISSIONS.internet) ||
    slugs.has(PARTNER_TYPE_GROUPS.internet);
  const dstv =
    perms.has(PARTNER_TYPE_PERMISSIONS.dstv) || slugs.has(PARTNER_TYPE_GROUPS.dstv);

  if (investor) return PARTNER_TYPES.INVESTOR;
  if (internet) return PARTNER_TYPES.INTERNET;
  if (dstv) return PARTNER_TYPES.DSTV;
  return PARTNER_TYPES.INTERNET;
}

/**
 * @param {{ role?: string, permissions?: string[]|Set<string>, groups?: Array<{slug?: string}|string> }} user
 */
function resolvePartnerAccess(user) {
  if (!user || isAdminRole(user.role)) {
    return {
      isPartner: false,
      type: null,
      customerScope: "all",
    };
  }

  const perms = permissionSetFrom(user.permissions);
  const slugs = groupSlugSet(user.groups);
  if (!hasPartnerMarker(perms, slugs)) {
    return {
      isPartner: false,
      type: null,
      customerScope: "all",
    };
  }

  const type = typeFromMarkers(perms, slugs);
  const widened =
    type === PARTNER_TYPES.INVESTOR ||
    type === PARTNER_TYPES.INTERNET ||
    perms.has(PARTNER_TYPE_PERMISSIONS.internet) ||
    slugs.has(PARTNER_TYPE_GROUPS.internet) ||
    perms.has(PARTNER_TYPE_PERMISSIONS.investor) ||
    slugs.has(PARTNER_TYPE_GROUPS.investor);

  return {
    isPartner: true,
    type,
    customerScope: widened ? "all" : "dstv",
  };
}

function resolvePartnerAccessFromReq(req) {
  return resolvePartnerAccess({
    role: req?.user?.role,
    permissions: req?.userPermissionSet || req?.userPermissions || req?.user?.permissions,
    groups: req?.userGroups || req?.user?.groups,
  });
}

function customerHasDstv(customer) {
  if (!customer) return false;
  return Boolean(
    customer.hasDstv ||
      customer.has_dstv ||
      customer.product_has_dstv ||
      customer.productHasDstv
  );
}

function partnerCanViewCustomer(access, customer) {
  if (!access?.isPartner || access.customerScope !== "dstv") return true;
  return customerHasDstv(customer);
}

function runWithPartnerCustomerScope(customerScope, fn) {
  return partnerCustomerScopeAls.run(
    { customerScope: customerScope === "dstv" ? "dstv" : "all" },
    fn
  );
}

function currentPartnerCustomerScope() {
  return partnerCustomerScopeAls.getStore()?.customerScope || "all";
}

/** SQL fragment: restrict to DSTV subscribers. Empty unless DSTV scope is active. */
function dstvCustomerSql(customerRef = "c") {
  if (currentPartnerCustomerScope() !== "dstv") return "";
  return ` AND EXISTS (
    SELECT 1 FROM products __dstv_p
    WHERE __dstv_p.id = ${customerRef}.product_id
      AND __dstv_p.has_dstv = 1
  )`;
}

/** SQL fragment when `products` is already joined. */
function dstvProductSql(productRef = "p") {
  if (currentPartnerCustomerScope() !== "dstv") return "";
  return ` AND ${productRef}.has_dstv = 1`;
}

/** SQL fragment: payments whose account reference is a DSTV customer. */
function dstvPaymentSql(paymentRef = "payment_transactions") {
  if (currentPartnerCustomerScope() !== "dstv") return "";
  return ` AND EXISTS (
    SELECT 1 FROM customers __dstv_c
    JOIN products __dstv_p ON __dstv_p.id = __dstv_c.product_id
    WHERE UPPER(__dstv_c.customer_number) = UPPER(${paymentRef}.account_reference)
      AND __dstv_p.has_dstv = 1
  )`;
}

function kpiFiltersForPartnerScope() {
  if (currentPartnerCustomerScope() !== "dstv") return {};
  return { hasDstv: true };
}

module.exports = {
  PARTNER_TYPES,
  PARTNER_TYPE_PERMISSIONS,
  PARTNER_TYPE_GROUPS,
  resolvePartnerAccess,
  resolvePartnerAccessFromReq,
  customerHasDstv,
  partnerCanViewCustomer,
  runWithPartnerCustomerScope,
  currentPartnerCustomerScope,
  dstvCustomerSql,
  dstvProductSql,
  dstvPaymentSql,
  kpiFiltersForPartnerScope,
};
