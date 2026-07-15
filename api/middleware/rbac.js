const { requireRole } = require("./auth");

const ROLES = Object.freeze({
  ADMIN: "admin",
  SUPPORT: "support",
  CFO: "cfo",
  PARTNER: "partner",
  CEO: "ceo",
});

function normalizeRole(role) {
  if (role === "viewer") return ROLES.SUPPORT;
  return role;
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const role = normalizeRole(req.user.role);
    if (!roles.includes(role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

/** Dashboard, BI, transactions, reconciliation reads, report analytics. */
const FINANCE_READ = [ROLES.ADMIN, ROLES.CFO, ROLES.CEO];
/** Sync, allocate, reconciliation actions, billing send. */
const FINANCE_WRITE = [ROLES.ADMIN, ROLES.CFO];

module.exports = {
  ROLES,
  normalizeRole,
  requireAdmin: requireRoles(ROLES.ADMIN),
  requireFinance: requireRoles(...FINANCE_READ),
  requireFinanceWrite: requireRoles(...FINANCE_WRITE),
  requirePartner: requireRoles(ROLES.PARTNER),
  requirePartnerDashboard: requireRoles(ROLES.ADMIN, ROLES.PARTNER),
  requireReportsAccess: requireRoles(ROLES.ADMIN, ROLES.CFO, ROLES.PARTNER, ROLES.CEO),
  requireCustomerRead: requireRoles(
    ROLES.ADMIN,
    ROLES.SUPPORT,
    ROLES.CFO,
    ROLES.PARTNER,
    ROLES.CEO
  ),
  requireCustomerFinancialRead: requireRoles(
    ROLES.ADMIN,
    ROLES.SUPPORT,
    ROLES.CFO,
    ROLES.CEO
  ),
  requireCustomerWrite: requireRoles(ROLES.ADMIN, ROLES.SUPPORT),
  requireAgencyWrite: requireRoles(ROLES.ADMIN, ROLES.SUPPORT),
  requireConfigRead: requireRoles(ROLES.ADMIN, ROLES.SUPPORT),
  requireConfigWrite: requireRoles(ROLES.ADMIN),
  requireOps: requireRoles(ROLES.ADMIN),
  requireRole,
};
