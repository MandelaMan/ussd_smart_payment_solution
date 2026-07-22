const { query } = require("../config/db");
const { formatProductNameForDisplay } = require("../utils/productNameDisplay");
const { getUpcomingInvoiceForecast } = require("./billingForecastStore");

function resolveDateRange(from, to) {
  const now = new Date();
  const resolvedTo = to || now.toISOString().slice(0, 10);
  const fromDate = from
    ? new Date(from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const resolvedFrom = from || fromDate.toISOString().slice(0, 10);
  return { from: resolvedFrom, to: resolvedTo };
}

function dateParams(from, to) {
  return [from, `${to} 23:59:59`];
}

async function getReportAnalytics({ from, to } = {}) {
  const range = resolveDateRange(from, to);
  const { from: resolvedFrom, to: resolvedTo } = range;
  const params = dateParams(resolvedFrom, resolvedTo);

  const [
    summaryRows,
    revenueTrend,
    paymentStatus,
    revenueByChannel,
    subscriberTypeMix,
    revenueByBuilding,
    packageMix,
    subscriberGrowth,
    agencyPerformance,
    lifecycleEvents,
    paymentFrequencyMix,
    tispSyncStatus,
    failureReasons,
    integrationHealth,
    arpuByBuilding,
    upcomingInvoicesForecast,
  ] = await Promise.all([
    query(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS total_revenue,
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        COALESCE(AVG(CASE WHEN status = 'SUCCESS' THEN amount END), 0) AS avg_transaction
       FROM payment_transactions
       WHERE created_at >= ? AND created_at <= ?`,
      params
    ),
    query(
      `SELECT DATE(created_at) AS day,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue,
        COUNT(*) AS transactions,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
       FROM payment_transactions
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      params
    ),
    query(
      `SELECT status,
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
       FROM payment_transactions
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY status`,
      params
    ),
    query(
      `SELECT COALESCE(channel, 'Unknown') AS channel,
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
       FROM payment_transactions
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY channel
       ORDER BY revenue DESC`,
      params
    ),
    query(
      `SELECT customer_type AS type,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
       FROM customers
       GROUP BY customer_type`
    ),
    query(
      `SELECT b.name AS building,
        COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
        COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS subscribers
       FROM buildings b
       LEFT JOIN customers c ON c.building_id = b.id
       LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
         AND pt.status = 'SUCCESS'
         AND pt.created_at >= ? AND pt.created_at <= ?
       GROUP BY b.id, b.name
       HAVING revenue > 0 OR subscribers > 0
       ORDER BY revenue DESC
       LIMIT 10`,
      params
    ),
    query(
      `SELECT p.name AS package, p.mbps,
        SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS subscribers,
        COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
       FROM products p
       JOIN customers c ON c.product_id = p.id
       LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
         AND pt.status = 'SUCCESS'
         AND pt.created_at >= ? AND pt.created_at <= ?
       GROUP BY p.id, p.name, p.mbps
       HAVING subscribers > 0
       ORDER BY subscribers DESC
       LIMIT 8`,
      params
    ),
    query(
      `SELECT day, SUM(new_count) AS new_subscribers, SUM(cancelled_count) AS churned
       FROM (
         SELECT DATE(created_at) AS day, COUNT(*) AS new_count, 0 AS cancelled_count
         FROM customers
         WHERE created_at >= ? AND created_at <= ?
         GROUP BY DATE(created_at)
         UNION ALL
         SELECT DATE(updated_at) AS day, 0 AS new_count, COUNT(*) AS cancelled_count
         FROM customers
         WHERE status = 'cancelled' AND updated_at >= ? AND updated_at <= ?
         GROUP BY DATE(updated_at)
       ) combined
       GROUP BY day
       ORDER BY day ASC`,
      [...params, ...params]
    ),
    query(
      `SELECT a.name AS agency,
        COUNT(DISTINCT c.id) AS customers,
        COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
       FROM agencies a
       LEFT JOIN customers c ON c.agency_id = a.id AND c.status = 'active'
       LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
         AND pt.status = 'SUCCESS'
         AND pt.created_at >= ? AND pt.created_at <= ?
       GROUP BY a.id, a.name
       ORDER BY revenue DESC
       LIMIT 8`,
      params
    ),
    query(
      `SELECT event_type AS event, COUNT(*) AS count
       FROM customer_events
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY event_type
       ORDER BY count DESC`,
      params
    ),
    query(
      `SELECT payment_frequency AS frequency, COUNT(*) AS count
       FROM customers
       WHERE status = 'active'
       GROUP BY payment_frequency
       ORDER BY count DESC`
    ),
    query(
      `SELECT COALESCE(tisp_sync_status, 'unknown') AS status, COUNT(*) AS count
       FROM customers
       WHERE status = 'active'
       GROUP BY tisp_sync_status
       ORDER BY count DESC`
    ),
    query(
      `SELECT COALESCE(NULLIF(TRIM(result_desc), ''), 'Unknown') AS reason,
        COUNT(*) AS count
       FROM payment_transactions
       WHERE status = 'FAILED' AND created_at >= ? AND created_at <= ?
       GROUP BY reason
       ORDER BY count DESC
       LIMIT 6`,
      params
    ),
    query(
      `SELECT source,
        COUNT(*) AS total,
        SUM(CASE WHEN source = 'zoho' AND status IN ('paid','success') THEN 1
                 WHEN source = 'tisp' AND outcome = 'success' THEN 1 ELSE 0 END) AS success
       FROM integration_events
       WHERE created_at >= ? AND created_at <= ?
       GROUP BY source`,
      params
    ),
    query(
      `SELECT b.name AS building,
        COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
        COUNT(DISTINCT CASE WHEN pt.status = 'SUCCESS' THEN pt.account_reference END) AS payers
       FROM buildings b
       JOIN customers c ON c.building_id = b.id AND c.status = 'active'
       LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
         AND pt.status = 'SUCCESS'
         AND pt.created_at >= ? AND pt.created_at <= ?
       GROUP BY b.id, b.name
       HAVING payers > 0
       ORDER BY revenue DESC
       LIMIT 8`,
      params
    ),
    getUpcomingInvoiceForecast({ days: 7 }),
  ]);

  const [subscriberCounts] = await query(
    `SELECT
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) AS new_in_period,
      SUM(CASE WHEN status = 'cancelled' AND updated_at >= ? AND updated_at <= ? THEN 1 ELSE 0 END) AS churned
     FROM customers`,
    [...params, ...params]
  ).catch(() => [{ active: 0, new_in_period: 0, churned: 0 }]);

  const summary = summaryRows[0] || {};
  const totalTx = Number(summary.total_transactions || 0);
  const successCount = Number(summary.success_count || 0);

  return {
    period: range,
    summary: {
      totalRevenue: Number(summary.total_revenue || 0),
      totalTransactions: totalTx,
      successRate: totalTx > 0 ? Math.round((successCount / totalTx) * 100) : 0,
      activeSubscribers: Number(subscriberCounts?.active || 0),
      newSubscribers: Number(subscriberCounts?.new_in_period || 0),
      churned: Number(subscriberCounts?.churned || 0),
      avgTransactionValue: Math.round(Number(summary.avg_transaction || 0)),
    },
    revenueTrend: revenueTrend.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue),
      transactions: Number(r.transactions),
      success: Number(r.success),
      failed: Number(r.failed),
    })),
    paymentStatus: paymentStatus.map((r) => ({
      status: r.status,
      count: Number(r.count),
      revenue: Number(r.revenue),
    })),
    revenueByChannel: revenueByChannel.map((r) => ({
      channel: r.channel,
      count: Number(r.count),
      revenue: Number(r.revenue),
    })),
    subscriberTypeMix: subscriberTypeMix.map((r) => ({
      type: r.type,
      active: Number(r.active_count),
      cancelled: Number(r.cancelled_count),
    })),
    revenueByBuilding: revenueByBuilding.map((r) => ({
      building: r.building,
      revenue: Number(r.revenue),
      subscribers: Number(r.subscribers),
    })),
    packageMix: packageMix.map((r) => ({
      package: r.mbps
        ? `${formatProductNameForDisplay(r.package)} (${r.mbps}M)`
        : formatProductNameForDisplay(r.package),
      subscribers: Number(r.subscribers),
      revenue: Number(r.revenue),
    })),
    subscriberGrowth: subscriberGrowth.map((r) => ({
      day: r.day,
      new: Number(r.new_subscribers),
      churned: Number(r.churned),
    })),
    agencyPerformance: agencyPerformance.map((r) => ({
      agency: r.agency,
      customers: Number(r.customers),
      revenue: Number(r.revenue),
    })),
    lifecycleEvents: lifecycleEvents.map((r) => ({
      event: r.event,
      count: Number(r.count),
    })),
    paymentFrequencyMix: paymentFrequencyMix.map((r) => ({
      frequency: r.frequency,
      count: Number(r.count),
    })),
    tispSyncStatus: tispSyncStatus.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    failureReasons: failureReasons.map((r) => ({
      reason: r.reason,
      count: Number(r.count),
    })),
    integrationHealth: integrationHealth.map((r) => ({
      source: r.source,
      total: Number(r.total),
      success: Number(r.success),
      failed: Number(r.total) - Number(r.success),
    })),
    arpuByBuilding: arpuByBuilding.map((r) => {
      const payers = Number(r.payers);
      const revenue = Number(r.revenue);
      return {
        building: r.building,
        arpu: payers > 0 ? Math.round(revenue / payers) : 0,
        payers,
        revenue,
      };
    }),
    upcomingInvoices: {
      windowStart: upcomingInvoicesForecast.windowStart,
      windowEnd: upcomingInvoicesForecast.windowEnd,
      invoiceCount: upcomingInvoicesForecast.invoiceCount,
      anticipatedAmount: upcomingInvoicesForecast.anticipatedAmount,
    },
  };
}

module.exports = { getReportAnalytics };
