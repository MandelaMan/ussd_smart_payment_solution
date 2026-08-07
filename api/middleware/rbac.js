const { requirePermission, requireAdministrator } = require("./permissions");
const { requireRole } = require("./auth");
const { isAdministrator, normalizeSystemRole } = require("../rbac/permissionService");

const ROLES = Object.freeze({
  ADMIN: "admin",
  USER: "user",
  // Legacy aliases kept for migration-era code paths / JWT claims until re-login
  SUPPORT: "support",
  CFO: "cfo",
  PARTNER: "partner",
  CEO: "ceo",
});

function normalizeRole(role) {
  if (role === "viewer") return ROLES.USER;
  if (role === "admin") return ROLES.ADMIN;
  if (
    role === "support" ||
    role === "cfo" ||
    role === "partner" ||
    role === "ceo" ||
    role === "user"
  ) {
    return normalizeSystemRole(role) === "admin" ? ROLES.ADMIN : ROLES.USER;
  }
  return ROLES.USER;
}

/**
 * Capability middleware — permission-key based.
 * Legacy role names are no longer checked; effective permissions decide access.
 */
module.exports = {
  ROLES,
  normalizeRole,
  isAdministrator,
  requireAdministrator,
  requireAdmin: requirePermission("users.view", "settings.view", "system_logs.view"),
  /** Prefer explicit permission on user-management routes. */
  requireManageUsers: requirePermission("users.view"),
  requireFinance: requirePermission(
    "dashboard.finance",
    "transactions.view",
    "billing.view",
    "analytics.view"
  ),
  requireFinanceWrite: requirePermission(
    "billing.sync",
    "billing.allocate",
    "billing.actions",
    "billing.communicate"
  ),
  requirePartner: requirePermission("dashboard.partner"),
  requirePartnerDashboard: requirePermission("dashboard.partner", "dashboard.finance"),
  requireReportsAccess: requirePermission("reports.view"),
  requireCustomerRead: requirePermission("customers.view"),
  requireCustomerFinancialRead: requirePermission("customers.financials"),
  requireCustomerWrite: requirePermission("customers.create", "customers.edit"),
  requireAgencyWrite: requirePermission("agencies.create", "agencies.edit"),
  requireConfigRead: requirePermission(
    "packages.view",
    "buildings.view",
    "pops.view",
    "apartments.view",
    "agencies.view"
  ),
  requireConfigWrite: requirePermission(
    "packages.create",
    "packages.edit",
    "buildings.create",
    "buildings.edit",
    "pops.create",
    "pops.edit"
  ),
  requireOps: requirePermission("system_logs.view"),
  requireRole,
  requirePermission,
};
