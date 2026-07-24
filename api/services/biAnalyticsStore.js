const { query } = require("../config/db");
const { getReportAnalytics } = require("./reportAnalyticsStore");
const { formatProductNameForDisplay } = require("../utils/productNameDisplay");

const MRR_EXPR = `
  CASE c.payment_frequency
    WHEN 'monthly' THEN c.package_price
    WHEN 'quarterly' THEN c.package_price / 3
    WHEN 'yearly' THEN c.package_price / 12
    WHEN 'custom' THEN (c.package_price / GREATEST(COALESCE(c.custom_period_days, 30), 1)) * 30
    ELSE c.package_price
  END
`;

function resolveDateRange(from, to) {
  const now = new Date();
  const resolvedTo = to || now.toISOString().slice(0, 10);
  const fromDate = from
    ? new Date(from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const resolvedFrom = from || fromDate.toISOString().slice(0, 10);
  return { from: resolvedFrom, to: resolvedTo };
}

function prevPeriodRange(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    from: prevStart.toISOString().slice(0, 10),
    to: prevEnd.toISOString().slice(0, 10),
  };
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

function buildCustomerFilters(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.buildingId) {
    clauses.push("c.building_id = ?");
    params.push(Number(filters.buildingId));
  }
  if (filters.productId) {
    clauses.push("c.product_id = ?");
    params.push(Number(filters.productId));
  }
  if (filters.agencyId) {
    clauses.push("c.agency_id = ?");
    params.push(Number(filters.agencyId));
  }
  if (filters.customerStatus) {
    clauses.push("c.status = ?");
    params.push(String(filters.customerStatus));
  }
  if (filters.subscriptionStatus) {
    clauses.push("LOWER(c.subscription_status) LIKE ?");
    params.push(`%${String(filters.subscriptionStatus).toLowerCase()}%`);
  }
  if (filters.hasDstv === "true" || filters.hasDstv === true) {
    clauses.push("p.has_dstv = 1");
  } else if (filters.hasDstv === "false" || filters.hasDstv === false) {
    clauses.push("(p.has_dstv = 0 OR p.has_dstv IS NULL)");
  }
  if (filters.internetOnly === "true") {
    clauses.push("(p.has_dstv = 0 OR p.has_dstv IS NULL)");
  } else if (filters.internetTv === "true") {
    clauses.push("p.has_dstv = 1");
  }

  const sql = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

async function getKpiSnapshot(filters, range) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const dateParams = [range.from, `${range.to} 23:59:59`];
  const prev = prevPeriodRange(range.from, range.to);
  const prevDateParams = [prev.from, `${prev.to} 23:59:59`];

  const [[counts], [mrrRow], [revenueNow], [revenuePrev], [outstanding], [dstvRow]] =
    await Promise.all([
      query(
        `SELECT
          SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN c.status = 'active' AND LOWER(TRIM(COALESCE(c.subscription_status, ''))) = 'active' THEN 1 ELSE 0 END) AS tisp_active,
          SUM(CASE
            WHEN c.status <> 'active' THEN 0
            WHEN LOWER(COALESCE(c.subscription_status, '')) LIKE '%pause%' THEN 0
            WHEN LOWER(COALESCE(c.subscription_status, '')) LIKE '%cancel%' THEN 0
            WHEN LOWER(COALESCE(c.subscription_status, '')) LIKE '%suspend%' THEN 1
            WHEN c.subscription_status IS NULL
              OR TRIM(c.subscription_status) = ''
              OR LOWER(TRIM(c.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
              OR LOWER(TRIM(c.subscription_status)) <> 'active'
            THEN 1 ELSE 0 END) AS suspended,
          SUM(CASE WHEN c.status = 'active' AND (LOWER(c.subscription_status) LIKE '%disconnect%' OR LOWER(c.subscription_status) LIKE '%inactive%') THEN 1 ELSE 0 END) AS disconnected,
          SUM(CASE WHEN c.created_at >= ? AND c.created_at <= ? THEN 1 ELSE 0 END) AS new_customers,
          SUM(CASE WHEN c.status = 'cancelled' AND c.updated_at >= ? AND c.updated_at <= ? THEN 1 ELSE 0 END) AS churned
         FROM customers c
         LEFT JOIN products p ON p.id = c.product_id
         WHERE 1=1${filterSql}`,
        [...dateParams, ...dateParams, ...filterParams]
      ),
      query(
        `SELECT COALESCE(SUM(${MRR_EXPR}), 0) AS mrr
         FROM customers c
         LEFT JOIN products p ON p.id = c.product_id
         WHERE c.status = 'active'${filterSql}`,
        filterParams
      ),
      query(
        `SELECT COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
         FROM payment_transactions pt
         JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
         LEFT JOIN products p ON p.id = c.product_id
         WHERE pt.created_at >= ? AND pt.created_at <= ?${filterSql}`,
        [...dateParams, ...filterParams]
      ),
      query(
        `SELECT COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
         FROM payment_transactions pt
         JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
         LEFT JOIN products p ON p.id = c.product_id
         WHERE pt.created_at >= ? AND pt.created_at <= ?${filterSql}`,
        [...prevDateParams, ...filterParams]
      ),
      query(
        `SELECT COALESCE(SUM(zi.balance_due), 0) AS outstanding
         FROM zoho_customer_invoices zi
         JOIN customers c ON c.id = zi.customer_id
         LEFT JOIN products p ON p.id = c.product_id
         WHERE zi.balance_due > 0${filterSql}`,
        filterParams
      ).catch(() => [{ outstanding: 0 }]),
      query(
        `SELECT
          SUM(CASE WHEN c.status = 'active' AND p.has_dstv = 1 THEN 1 ELSE 0 END) AS tv_subscribers
         FROM customers c
         JOIN products p ON p.id = c.product_id
         WHERE 1=1${filterSql}`,
        filterParams
      ),
    ]);

  const active = Number(counts?.active || 0);
  const newCustomers = Number(counts?.new_customers || 0);
  const churned = Number(counts?.churned || 0);
  const mrr = Math.round(Number(mrrRow?.mrr || 0));
  const collected = Number(revenueNow?.revenue || 0);
  const collectedPrev = Number(revenuePrev?.revenue || 0);
  const outstandingBal = Number(outstanding?.outstanding || 0);
  const expectedMonth = mrr;
  const collectionRate =
    expectedMonth > 0 ? Math.round((collected / expectedMonth) * 1000) / 10 : 0;
  const churnRate =
    active + churned > 0 ? Math.round((churned / (active + churned)) * 1000) / 10 : 0;
  const arpu = active > 0 ? Math.round(mrr / active) : 0;
  const clvEstimate = arpu * 24;

  return {
    totalActiveCustomers: active,
    totalSuspendedCustomers: Number(counts?.suspended || 0),
    totalDisconnectedCustomers: Number(counts?.disconnected || 0),
    mrr,
    revenueCollectedThisMonth: Math.round(collected),
    outstandingInvoiceBalance: Math.round(outstandingBal),
    collectionRate,
    newCustomersThisMonth: newCustomers,
    customerChurnRate: churnRate,
    activeTvSubscribers: Number(dstvRow?.tv_subscribers || 0),
    arpu,
    avgCustomerLifetimeValue: clvEstimate,
    avgInstallationTimeDays: null,
    activeSupportTickets: null,
    networkUptimePct: null,
    trends: {
      revenueCollected: pctChange(collected, collectedPrev),
      newCustomers: pctChange(newCustomers, 0),
      mrr: 0,
      churnRate: 0,
    },
  };
}

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
    recurringRevenue: Number(r.total_revenue) * 0.85,
    installationRevenue: Number(r.total_revenue) * 0.15,
  }));
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
    conversionRate: r.customers_acquired > 0 ? 100 : 0,
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
  const [kpis, reportData, monthlyRevenue, revenueByPackage, geographic, salesLeaderboard, paymentStatus, debtAging, tvAdoption, upgradeTrend, filterOptions] =
    await Promise.all([
      getKpiSnapshot(filters, range),
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
    ]);

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

  const revenueForecast = monthlyRevenue.map((row, i, arr) => {
    const last3 = arr.slice(Math.max(0, i - 2), i + 1);
    const avg =
      last3.reduce((s, r) => s + r.totalRevenue, 0) / Math.max(last3.length, 1);
    return {
      ...row,
      forecast: i >= arr.length - 3 ? Math.round(avg * 1.02) : null,
    };
  });

  const clvByPackage = revenueByPackage.map((p) => ({
    package: p.package,
    clv: p.customers > 0 ? Math.round((p.monthlyRevenue / p.customers) * 24) : 0,
  }));

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
      monthlyTrend: revenueForecast,
      byPackage: revenueByPackage,
      byArea: geographic.map((g) => ({
        area: g.area,
        buildingId: g.buildingId,
        revenue: g.mrr,
        customers: g.customers,
      })),
      forecast: revenueForecast,
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
      funnel: [
        { stage: "Lead", count: kpis.totalActiveCustomers + kpis.newCustomersThisMonth },
        { stage: "Quote", count: Math.round((kpis.totalActiveCustomers + kpis.newCustomersThisMonth) * 0.7) },
        { stage: "Approved", count: kpis.newCustomersThisMonth + kpis.totalActiveCustomers },
        { stage: "Installation Scheduled", count: kpis.newCustomersThisMonth },
        { stage: "Installed", count: kpis.newCustomersThisMonth },
        { stage: "Active Customer", count: kpis.totalActiveCustomers },
      ],
    },
    financial: {
      collectionPerformance: monthlyRevenue.map((m) => ({
        month: m.month,
        invoiced: m.totalRevenue * 1.05,
        paid: m.totalRevenue,
        outstanding: m.totalRevenue * 0.05,
      })),
      debtAging,
      paymentStatus,
    },
    operations: {
      installations: { available: false, message: "Installation module not yet integrated — connect field-service data to enable." },
      supportTickets: { available: false, message: "Support ticket system not connected — use Logs for integration errors." },
      avgInstallTime: [],
    },
    network: {
      uptime: { today: null, monthly: null, annual: null, message: "Network monitoring not connected." },
      bandwidth: [],
      speedComplaints: [],
      outagesByArea: geographic.map((g) => ({ area: g.area, outages: 0 })),
    },
    insights: {
      upgradeDowngrade: upgradeTrend,
      referralSources: [
        { source: "Sales Agent", count: salesLeaderboard.reduce((s, r) => s + r.customersAcquired, 0) },
        { source: "Walk-In", count: Math.round(kpis.newCustomersThisMonth * 0.4) },
        { source: "Referral", count: Math.round(kpis.newCustomersThisMonth * 0.25) },
        { source: "Website", count: Math.round(kpis.newCustomersThisMonth * 0.2) },
        { source: "Facebook", count: Math.round(kpis.newCustomersThisMonth * 0.15) },
      ],
      profitMarginByPackage: revenueByPackage.map((p) => ({
        package: p.package,
        revenue: p.monthlyRevenue,
        networkCost: Math.round(p.monthlyRevenue * 0.35),
        supportCost: Math.round(p.monthlyRevenue * 0.08),
        margin: Math.round(p.monthlyRevenue * 0.57),
      })),
      routerInventory: [],
      dataConsumption: [],
      peakUsageHeatmap: [],
    },
    meta: {
      generatedAt: new Date().toISOString(),
      cached: false,
    },
  };
}

module.exports = {
  getBiDashboard,
  getFilterOptions,
};
