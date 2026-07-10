const { getPartnerDashboard } = require("../services/partnerAnalyticsStore");

async function getDashboard(req, res, next) {
  try {
    const months = Number(req.query.months) || 12;
    const dashboard = await getPartnerDashboard({ months });
    res.json(dashboard);
  } catch (e) {
    next(e);
  }
}

module.exports = { getDashboard };
