const { query } = require("../config/db");
const { formatProductNameForDisplay } = require("../utils/productNameDisplay");

function monthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

async function getPartnerDashboard({ months = 12 } = {}) {
  const monthsBack = Math.min(24, Math.max(3, Number(months) || 12));

  const [
    customerSummary,
    monthlyRevenue,
    monthlyCustomers,
    packageChanges,
    packageMix,
    buildingMix,
    recentLifecycle,
  ] = await Promise.all([
    query(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'active' AND customer_type = 'C2B' THEN 1 ELSE 0 END) AS c2b,
        SUM(CASE WHEN status = 'active' AND customer_type = 'B2B' THEN 1 ELSE 0 END) AS b2b
      FROM customers
    `),
    query(
      `SELECT YEAR(created_at) AS year, MONTH(created_at) AS month,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS payment_count
       FROM payment_transactions
       WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
       GROUP BY YEAR(created_at), MONTH(created_at)
       ORDER BY year ASC, month ASC`,
      [monthsBack - 1]
    ),
    query(
      `SELECT year, month,
        SUM(added) AS added,
        SUM(lost) AS lost
       FROM (
         SELECT YEAR(created_at) AS year, MONTH(created_at) AS month,
           COUNT(*) AS added, 0 AS lost
         FROM customers
         WHERE created_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
         GROUP BY YEAR(created_at), MONTH(created_at)
         UNION ALL
         SELECT YEAR(updated_at) AS year, MONTH(updated_at) AS month,
           0 AS added, COUNT(*) AS lost
         FROM customers
         WHERE status = 'cancelled'
           AND updated_at >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ? MONTH)
         GROUP BY YEAR(updated_at), MONTH(updated_at)
       ) t
       GROUP BY year, month
       ORDER BY year ASC, month ASC`,
      [monthsBack - 1, monthsBack - 1]
    ),
    query(
      `SELECT
        SUM(CASE WHEN event_type = 'upgrade' THEN 1 ELSE 0 END) AS upgrades,
        SUM(CASE WHEN event_type = 'downgrade' THEN 1 ELSE 0 END) AS downgrades,
        SUM(CASE WHEN event_type = 'switch_apartment' THEN 1 ELSE 0 END) AS apartment_switches,
        SUM(CASE WHEN event_type = 'type_change' THEN 1 ELSE 0 END) AS type_changes,
        SUM(CASE WHEN event_type = 'cancel' THEN 1 ELSE 0 END) AS cancellations
       FROM customer_events
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)`,
      [monthsBack]
    ),
    query(`
      SELECT p.name AS package_name, p.mbps,
        COUNT(*) AS subscribers
      FROM products p
      JOIN customers c ON c.product_id = p.id
      WHERE c.status = 'active'
        AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%active%'
      GROUP BY p.id, p.name, p.mbps
      ORDER BY subscribers DESC
      LIMIT 10
    `),
    query(`
      SELECT b.name AS building_name,
        COUNT(*) AS subscribers
      FROM buildings b
      JOIN customers c ON c.building_id = b.id
      WHERE c.status = 'active'
        AND LOWER(COALESCE(c.subscription_status, '')) LIKE '%active%'
      GROUP BY b.id, b.name
      ORDER BY subscribers DESC
      LIMIT 10
    `),
    query(
      `SELECT event_type, COUNT(*) AS count
       FROM customer_events
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         AND event_type IN ('upgrade', 'downgrade', 'switch_apartment', 'type_change', 'cancel', 'created')
       GROUP BY event_type
       ORDER BY count DESC`
    ),
  ]);

  const summary = customerSummary[0] || {};
  const changes = packageChanges[0] || {};

  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - (monthsBack - 1));
  periodStart.setDate(1);

  const [periodRevenue] = await query(
    `SELECT COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions
     WHERE created_at >= ?`,
    [periodStart]
  );

  const [periodAdded] = await query(
    `SELECT COUNT(*) AS count FROM customers WHERE created_at >= ?`,
    [periodStart]
  );

  const [periodLost] = await query(
    `SELECT COUNT(*) AS count FROM customers
     WHERE status = 'cancelled' AND updated_at >= ?`,
    [periodStart]
  );

  const [periodPackageChanges] = await query(
    `SELECT COUNT(*) AS count FROM customer_events
     WHERE event_type IN ('upgrade', 'downgrade', 'switch_apartment', 'type_change')
       AND created_at >= ?`,
    [periodStart]
  );

  const revenueByMonth = monthlyRevenue.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    label: monthLabel(Number(row.year), Number(row.month)),
    revenue: Number(row.revenue || 0),
    paymentCount: Number(row.payment_count || 0),
  }));

  const customerTrend = monthlyCustomers.map((row) => ({
    year: Number(row.year),
    month: Number(row.month),
    label: monthLabel(Number(row.year), Number(row.month)),
    added: Number(row.added || 0),
    lost: Number(row.lost || 0),
    net: Number(row.added || 0) - Number(row.lost || 0),
  }));

  return {
    period: { months: monthsBack, from: periodStart.toISOString().slice(0, 10) },
    customers: {
      total: Number(summary.total || 0),
      active: Number(summary.active || 0),
      cancelled: Number(summary.cancelled || 0),
      c2b: Number(summary.c2b || 0),
      b2b: Number(summary.b2b || 0),
    },
    periodMetrics: {
      revenue: Number(periodRevenue?.revenue || 0),
      added: Number(periodAdded?.count || 0),
      lost: Number(periodLost?.count || 0),
      packageChanges: Number(periodPackageChanges?.count || 0),
    },
    packageChanges: {
      upgrades: Number(changes.upgrades || 0),
      downgrades: Number(changes.downgrades || 0),
      apartmentSwitches: Number(changes.apartment_switches || 0),
      typeChanges: Number(changes.type_changes || 0),
      cancellations: Number(changes.cancellations || 0),
    },
    revenueByMonth,
    customerTrend,
    packageMix: packageMix.map((row) => ({
      packageName: formatProductNameForDisplay(row.package_name),
      mbps: Number(row.mbps || 0),
      subscribers: Number(row.subscribers || 0),
    })),
    buildingMix: buildingMix.map((row) => ({
      buildingName: row.building_name,
      subscribers: Number(row.subscribers || 0),
    })),
    lifecycleBreakdown: recentLifecycle.map((row) => ({
      event: row.event_type,
      count: Number(row.count || 0),
    })),
  };
}

module.exports = { getPartnerDashboard };
