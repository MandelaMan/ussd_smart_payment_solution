const { query } = require("../config/db");
const { getReportAnalytics } = require("./reportAnalyticsStore");
const { getLeadStats } = require("./leadStore");
const { formatProductNameForDisplay } = require("../utils/productNameDisplay");
const {
  MRR_EXPR,
  resolveDateRange,
  buildCustomerFilters,
  getKpiSnapshot,
  getExpectedCollections,
} = require("./kpiEngine");

async function getMonthlyRevenueSeries(filters, months = 12) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT DATE_FORMAT(pt.created_at, '%Y-%m') AS month,
      COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS total_revenue,
      COUNT(DISTINCT CASE WHEN pt.status = 'SUCCESS' THEN pt.account_reference END) AS payers
     FROM payment_transactions pt
     JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
     LEFT JOIN products p ON p.id = c.product_id
     WHERE pt.created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)${filterSql}
     GROUP BY DATE_FORMAT(pt.created_at, '%Y-%m')
     ORDER BY month ASC`,
    [months, ...filterParams]
  );
  return rows.map((r) => ({
    month: r.month,
    totalRevenue: Number(r.total_revenue),
    // Payments are not tagged as recurring vs installation — surface total only.
    recurringRevenue: Number(r.total_revenue),
    installationRevenue: 0,
  }));
}

async function getCollectionPerformance(filters, months = 12) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT DATE_FORMAT(zi.invoice_date, '%Y-%m') AS month,
      COALESCE(SUM(zi.total), 0) AS invoiced,
      COALESCE(SUM(GREATEST(COALESCE(zi.total, 0) - COALESCE(zi.balance_due, 0), 0)), 0) AS paid,
      COALESCE(SUM(GREATEST(COALESCE(zi.balance_due, 0), 0)), 0) AS outstanding
     FROM zoho_customer_invoices zi
     JOIN customers c ON c.id = zi.customer_id
     LEFT JOIN products p ON p.id = c.product_id
     WHERE zi.invoice_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)${filterSql}
     GROUP BY DATE_FORMAT(zi.invoice_date, '%Y-%m')
     ORDER BY month ASC`,
    [months, ...filterParams]
  ).catch(() => []);
  return rows.map((r) => ({
    month: r.month,
    invoiced: Math.round(Number(r.invoiced || 0)),
    paid: Math.round(Number(r.paid || 0)),
    outstanding: Math.round(Number(r.outstanding || 0)),
  }));
}

function buildLeadFunnel(leadStats) {
  const s = leadStats?.byStatus || {};
  const contacted = Number(s.contacted || 0);
  const interested = Number(s.interested || 0);
  const qualified = Number(s.qualified || 0);
  const converted = Number(s.converted || 0);
  const closed = Number(s.closed || 0);
  const total = Number(leadStats?.total || 0);
  return [
    { stage: "All Leads", count: total },
    { stage: "Interested+", count: interested + converted },
    { stage: "Contacted+", count: interested + contacted + qualified + converted + closed },
    { stage: "Qualified+", count: qualified + converted + closed },
    { stage: "Converted", count: converted },
  ];
}

function buildLeadSources(leadStats) {
  const bySource = leadStats?.bySource || {};
  return [
    { source: "WhatsApp", count: Number(bySource.whatsapp || 0) },
    { source: "Signup", count: Number(bySource.signup || 0) },
    { source: "Manual", count: Number(bySource.manual || 0) },
    { source: "Website", count: Number(bySource.web || 0) },
    { source: "Embed Form", count: Number(bySource.embed || 0) },
  ].filter((r) => r.count > 0);
}

async function getRevenueByPackage(filters, range) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const params = [range.from, `${range.to} 23:59:59`, ...filterParams];
  const rows = await query(
    `SELECT p.id AS product_id, p.name AS package, p.mbps, p.has_dstv,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS customers,
      COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN c.status = 'active' THEN (${MRR_EXPR}) ELSE 0 END), 0) AS monthly_revenue
     FROM products p
     JOIN customers c ON c.product_id = p.id
     LEFT JOIN payment_transactions pt ON UPPER(pt.account_reference) = UPPER(c.customer_number)
       AND pt.status = 'SUCCESS' AND pt.created_at >= ? AND pt.created_at <= ?
     WHERE 1=1${filterSql}
     GROUP BY p.id, p.name, p.mbps, p.has_dstv
     HAVING customers > 0
     ORDER BY monthly_revenue DESC
     LIMIT 25`,
    params
  );
  return rows.map((r) => ({
    package: r.mbps
      ? `${formatProductNameForDisplay(r.package)} (${r.mbps}M)`
      : formatProductNameForDisplay(r.package),
    packageId: r.product_id,
    customers: Number(r.customers),
    monthlyRevenue: Math.round(Number(r.monthly_revenue)),
    revenue: Number(r.revenue),
    hasDstv: Boolean(r.has_dstv),
  }));
}

async function getGeographicDistribution(filters) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT b.id AS building_id, b.name AS area,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS customers,
      COALESCE(SUM(CASE WHEN c.status = 'active' THEN (${MRR_EXPR}) ELSE 0 END), 0) AS mrr
     FROM buildings b
     LEFT JOIN customers c ON c.building_id = b.id
     LEFT JOIN products p ON p.id = c.product_id
     WHERE 1=1${filterSql}
     GROUP BY b.id, b.name
     HAVING customers > 0
     ORDER BY customers DESC`,
    filterParams
  );
  return rows.map((r) => ({
    buildingId: r.building_id,
    area: r.area,
    customers: Number(r.customers),
    mrr: Math.round(Number(r.mrr)),
  }));
}

async function getSalesLeaderboard(filters, range) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const params = [range.from, `${range.to} 23:59:59`, ...filterParams];
  const rows = await query(
    `SELECT a.id AS agency_id, a.name AS agent,
      COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS customers_acquired,
      COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
     FROM agencies a
     LEFT JOIN customers c ON c.agency_id = a.id
     LEFT JOIN products p ON p.id = c.product_id
     LEFT JOIN payment_transactions pt ON UPPER(pt.account_reference) = UPPER(c.customer_number)
       AND pt.status = 'SUCCESS' AND pt.created_at >= ? AND pt.created_at <= ?
     WHERE 1=1${filterSql}
     GROUP BY a.id, a.name
     ORDER BY revenue DESC
     LIMIT 15`,
    params
  );
  return rows.map((r) => ({
    agencyId: r.agency_id,
    agent: r.agent,
    customersAcquired: Number(r.customers_acquired),
    revenue: Number(r.revenue),
    // Lead→customer conversion by agency is not tracked yet.
    conversionRate: null,
  }));
}

async function getPaymentStatusDistribution(filters) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT
      CASE
        WHEN LOWER(c.subscription_status) LIKE '%suspend%' THEN 'Suspended'
        WHEN LOWER(c.subscription_status) LIKE '%active%' THEN 'Paid'
        WHEN c.last_payment_date IS NULL THEN 'Pending'
        ELSE 'Overdue'
      END AS payment_status,
      COUNT(*) AS count
     FROM customers c
     LEFT JOIN products p ON p.id = c.product_id
     WHERE c.status = 'active'${filterSql}
     GROUP BY 1`,
    filterParams
  );
  return rows.map((r) => ({ status: r.payment_status, count: Number(r.count) }));
}

async function getDebtAging(filters) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT
      CASE
        WHEN DATEDIFF(CURDATE(), zi.due_date) <= 0 THEN 'Current'
        WHEN DATEDIFF(CURDATE(), zi.due_date) BETWEEN 1 AND 30 THEN '30 Days'
        WHEN DATEDIFF(CURDATE(), zi.due_date) BETWEEN 31 AND 60 THEN '60 Days'
        WHEN DATEDIFF(CURDATE(), zi.due_date) BETWEEN 61 AND 90 THEN '90 Days'
        ELSE '120+ Days'
      END AS bucket,
      COALESCE(SUM(zi.balance_due), 0) AS amount
     FROM zoho_customer_invoices zi
     JOIN customers c ON c.id = zi.customer_id
     LEFT JOIN products p ON p.id = c.product_id
     WHERE zi.balance_due > 0${filterSql}
     GROUP BY bucket`,
    filterParams
  ).catch(() => []);
  const order = ["Current", "30 Days", "60 Days", "90 Days", "120+ Days"];
  return order.map((bucket) => {
    const row = rows.find((r) => r.bucket === bucket);
    return { bucket, amount: Number(row?.amount || 0) };
  });
}

async function getTvAdoption(filters) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const rows = await query(
    `SELECT
      CASE
        WHEN cat.code = 'dstv_only' THEN 'DSTV Only'
        WHEN p.has_dstv = 1 AND pl.name LIKE '%Premium%' THEN 'Premium TV'
        WHEN p.has_dstv = 1 THEN 'Internet + TV'
        ELSE 'Internet Only'
      END AS segment,
      COUNT(*) AS count
     FROM customers c
     JOIN products p ON p.id = c.product_id
     LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
     LEFT JOIN package_plans pl ON pl.id = v.plan_id
     LEFT JOIN package_categories cat ON cat.id = pl.category_id
     WHERE c.status = 'active'${filterSql}
     GROUP BY segment`,
    filterParams
  );
  return rows.map((r) => ({ segment: r.segment, count: Number(r.count) }));
}

async function getUpgradeDowngradeTrend(range) {
  const params = [range.from, `${range.to} 23:59:59`];
  const rows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
      SUM(CASE WHEN event_type IN ('package_upgrade', 'upgrade') THEN 1 ELSE 0 END) AS upgrades,
      SUM(CASE WHEN event_type IN ('package_downgrade', 'downgrade') THEN 1 ELSE 0 END) AS downgrades
     FROM customer_events
     WHERE created_at >= ? AND created_at <= ?
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
    params
  ).catch(() => []);
  return rows.map((r) => ({
    month: r.month,
    upgrades: Number(r.upgrades),
    downgrades: Number(r.downgrades),
  }));
}

async function getFilterOptions() {
  const [buildings, products, agencies] = await Promise.all([
    query(`SELECT id, name FROM buildings ORDER BY name`),
    query(`SELECT id, name, mbps, has_dstv FROM products WHERE is_active = 1 ORDER BY name`),
    query(`SELECT id, name FROM agencies ORDER BY name`),
  ]);
  return {
    buildings: buildings.map((b) => ({ id: b.id, name: b.name })),
    products: products.map((p) => ({
      id: p.id,
      name: p.mbps
        ? `${formatProductNameForDisplay(p.name)} (${p.mbps}M)`
        : formatProductNameForDisplay(p.name),
      hasDstv: Boolean(p.has_dstv),
    })),
    agencies: agencies.map((a) => ({ id: a.id, name: a.name })),
  };
}

async function getBiDashboard(filters = {}) {
  const range = resolveDateRange(filters.from, filters.to);
  const [
    kpis,
    expected,
    reportData,
    monthlyRevenue,
    revenueByPackage,
    geographic,
    salesLeaderboard,
    paymentStatus,
    debtAging,
    tvAdoption,
    upgradeTrend,
    filterOptions,
    collectionPerformance,
    leadStats,
  ] = await Promise.all([
    getKpiSnapshot(filters, range),
    getExpectedCollections({ days: 30 }).catch(() => ({
      expectedCollections: 0,
      invoiceCount: 0,
    })),
    getReportAnalytics(range),
    getMonthlyRevenueSeries(filters, 12),
    getRevenueByPackage(filters, range),
    getGeographicDistribution(filters),
    getSalesLeaderboard(filters, range),
    getPaymentStatusDistribution(filters),
    getDebtAging(filters),
    getTvAdoption(filters),
    getUpgradeDowngradeTrend(range),
    getFilterOptions(),
    getCollectionPerformance(filters, 12),
    getLeadStats().catch(() => ({ total: 0, byStatus: {}, bySource: {} })),
  ]);

  kpis.expectedCollections = expected.expectedCollections;
  kpis.expectedInvoiceCount = expected.invoiceCount;

  const churnSeries = (reportData.subscriberGrowth || []).map((row) => {
    const active = kpis.totalActiveCustomers || 1;
    return {
      day: row.day,
      churnRate: Math.round((row.churned / active) * 1000) / 10,
      newCustomers: row.new,
      lostCustomers: row.churned,
      activeCustomers: active,
    };
  });

  // Historical revenue only — no invented forecast overlay.
  const monthlyTrend = monthlyRevenue.map((row) => ({
    ...row,
    forecast: null,
  }));

  const monthlyChurnFraction = (Number(kpis.customerChurnRate) || 0) / 100;
  const clvByPackage = revenueByPackage.map((p) => {
    const arpu = p.customers > 0 ? p.monthlyRevenue / p.customers : 0;
    const clv =
      monthlyChurnFraction > 0
        ? Math.round(arpu / monthlyChurnFraction)
        : Math.round(arpu * 24);
    return { package: p.package, clv };
  });

  return {
    period: range,
    filters: {
      buildingId: filters.buildingId || null,
      productId: filters.productId || null,
      agencyId: filters.agencyId || null,
      customerStatus: filters.customerStatus || null,
      subscriptionStatus: filters.subscriptionStatus || null,
      hasDstv: filters.hasDstv || null,
    },
    filterOptions,
    kpis,
    revenue: {
      monthlyTrend,
      byPackage: revenueByPackage,
      byArea: geographic.map((g) => ({
        area: g.area,
        buildingId: g.buildingId,
        revenue: g.mrr,
        customers: g.customers,
      })),
      forecast: monthlyTrend,
    },
    customers: {
      growth: reportData.subscriberGrowth || [],
      churn: churnSeries,
      packagePopularity: reportData.packageMix || [],
      tvAdoption,
      geographic,
      clvByPackage,
    },
    sales: {
      leaderboard: salesLeaderboard,
      funnel: buildLeadFunnel(leadStats),
    },
    financial: {
      collectionPerformance,
      debtAging,
      paymentStatus,
    },
    // Operations / Network reserved for Phase 2 — omitted until data sources exist.
    insights: {
      upgradeDowngrade: upgradeTrend,
      referralSources: buildLeadSources(leadStats),
    },
    meta: {
      generatedAt: new Date().toISOString(),
      cached: false,
      metricEngine: "kpiEngine",
    },
  };
}

module.exports = {
  getBiDashboard,
  getFilterOptions,
};
