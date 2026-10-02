const { getPartnerDashboard } = require("../services/partnerAnalyticsStore");
const { resolvePartnerAccessFromReq } = require("../rbac/partnerAccess");

async function getDashboard(req, res, next) {
  try {
    const months = Number(req.query.months) || 12;
    const access = resolvePartnerAccessFromReq(req);
    const dashboard = await getPartnerDashboard({
      months,
      customerScope: access.customerScope,
    });
    res.json({
      ...dashboard,
      partnerType: access.type,
      customerScope: access.customerScope,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { getDashboard };
