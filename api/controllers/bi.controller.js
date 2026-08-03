const { getBiDashboard } = require("../services/biAnalyticsStore");
const { getForecastIntelligence } = require("../services/forecastIntelligenceStore");
const { getCache, setCache } = require("../lib/cache");

function parseFilters(query = {}) {
  return {
    from: query.from || null,
    to: query.to || null,
    buildingId: query.buildingId || null,
    productId: query.productId || null,
    agencyId: query.agencyId || null,
    customerStatus: query.customerStatus || null,
    subscriptionStatus: query.subscriptionStatus || null,
    hasDstv: query.hasDstv || null,
    internetOnly: query.internetOnly || null,
    internetTv: query.internetTv || null,
  };
}

function cacheKeyFor(filters) {
  return JSON.stringify(filters);
}

async function getDashboard(req, res, next) {
  try {
    const filters = parseFilters(req.query);
    const key = cacheKeyFor(filters);
    const cached = await getCache("bi-dashboard", key);
    if (cached) {
      return res.json({ ...cached, meta: { ...cached.meta, cached: true } });
    }

    const data = await getBiDashboard(filters);
    await setCache("bi-dashboard", key, data, 120);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function getForecast(req, res, next) {
  try {
    const filters = parseFilters(req.query);
    const key = `forecast:${cacheKeyFor(filters)}`;
    const cached = await getCache("bi-forecast", key);
    if (cached) {
      return res.json({ ...cached, meta: { ...cached.meta, cached: true } });
    }
    const data = await getForecastIntelligence(filters);
    await setCache("bi-forecast", key, data, 90);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

function rowsToCsv(rows, columns) {
  const header = columns.join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const val = row[col] ?? "";
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

async function exportSection(req, res, next) {
  try {
    const filters = parseFilters(req.query);
    const section = String(req.query.section || "revenueByPackage");
    const data = await getBiDashboard(filters);

    let rows = [];
    let columns = [];
    let filename = "bi-export";

    switch (section) {
      case "revenueByPackage":
        rows = data.revenue.byPackage;
        columns = ["package", "customers", "monthlyRevenue", "revenue"];
        filename = "revenue-by-package";
        break;
      case "monthlyRevenue":
        rows = data.revenue.monthlyTrend;
        columns = ["month", "totalRevenue"];
        filename = "monthly-revenue";
        break;
      case "salesLeaderboard":
        rows = data.sales.leaderboard;
        columns = ["agent", "customersAcquired", "revenue"];
        filename = "sales-leaderboard";
        break;
      case "geographic":
        rows = data.customers.geographic;
        columns = ["area", "customers", "mrr"];
        filename = "geographic-distribution";
        break;
      default:
        return res.status(400).json({ error: "Unknown export section" });
    }

    const csv = rowsToCsv(rows, columns);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}-${data.period.from}-to-${data.period.to}.csv"`
    );
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getDashboard,
  getForecast,
  exportSection,
};
