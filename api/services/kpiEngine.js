/**
 * Shared metric dictionary + KPI calculation engine.
 *
 * Every dashboard and report MUST use these helpers for standardized KPIs.
 * Do not re-implement MRR / ARPU / collection rate / churn elsewhere.
 *
 * Definitions (canonical):
 * - MRR: sum of frequency-normalized package_price for status=active customers
 * - ARR: MRR × 12
 * - ARPU: MRR / active customers
 * - Revenue (collected): SUCCESS payment_transactions.amount in period
 * - Collection Rate: Revenue(collected in period) / MRR × 100
 *   (period collections vs current monthly recurring obligation)
 * - Outstanding Balance: SUM(zoho balance_due > 0)
 * - Expected Collections: upcoming invoice forecast anticipatedAmount (horizon days)
 * - Churn Rate: cancelled-in-period / (active + cancelled-in-period) × 100
 * - Active Customers: status = active
 * - Suspended Customers: active account with suspended/unknown TISP subscription
 * - CLV: ARPU / monthlyChurnFraction; if churn=0 → ARPU × 24
 * - Payment Success Rate: SUCCESS txns / all txns in period × 100
 * - Average Days to Pay: avg (payment_date - invoice_date) for paid Zoho invoices in period
 */

const { query } = require("../config/db");

const METRIC_DICTIONARY = [
  { key: "mrr", label: "Monthly Recurring Revenue (MRR)", unit: "KES" },
  { key: "arr", label: "Annual Recurring Revenue (ARR)", unit: "KES" },
  { key: "arpu", label: "Average Revenue Per User (ARPU)", unit: "KES" },
  { key: "revenueCollected", label: "Revenue Collected", unit: "KES" },
  { key: "collectionRate", label: "Collection Rate", unit: "%" },
  { key: "outstandingBalance", label: "Outstanding Balance", unit: "KES" },
  { key: "expectedCollections", label: "Expected Collections", unit: "KES" },
  { key: "churnRate", label: "Churn Rate", unit: "%" },
  { key: "activeCustomers", label: "Active Customers", unit: "count" },
  { key: "suspendedCustomers", label: "Suspended Customers", unit: "count" },
  { key: "clv", label: "Customer Lifetime Value (CLV)", unit: "KES" },
  { key: "paymentSuccessRate", label: "Payment Success Rate", unit: "%" },
  { key: "invoiceSuccessRate", label: "Invoice Success Rate", unit: "%" },
  { key: "avgDaysToPay", label: "Average Days to Pay", unit: "days" },
];

/** SQL expression: normalize package_price to a monthly amount. Alias customers as `c`. */
const MRR_EXPR = `
  CASE c.payment_frequency
    WHEN 'monthly' THEN c.package_price
    WHEN 'quarterly' THEN c.package_price / 3
    WHEN 'yearly' THEN c.package_price / 12
    WHEN 'custom' THEN (c.package_price / GREATEST(COALESCE(c.custom_period_days, 30), 1)) * 30
    ELSE c.package_price
  END
`;

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function round0(n) {
  return Math.round(Number(n) || 0);
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Resolve from/to without UTC month-end drift. Defaults: last 30 days → today. */
function resolveDateRange(from, to) {
  const now = new Date();
  const resolvedTo = to && String(to).trim() ? String(to).slice(0, 10) : ymdLocal(now);
  if (from && String(from).trim()) {
    return { from: String(from).slice(0, 10), to: resolvedTo };
  }
  const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: ymdLocal(fromDate), to: resolvedTo };
}

function prevPeriodRange(from, to) {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const days = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1);
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: ymdLocal(prevStart), to: ymdLocal(prevEnd) };
}

function pctChange(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return round1(((c - p) / p) * 100);
}

function computeArr(mrr) {
  return round0(Number(mrr) || 0) * 12;
}

function computeArpu(mrr, activeCustomers) {
  const active = Number(activeCustomers) || 0;
  return active > 0 ? round0((Number(mrr) || 0) / active) : 0;
}

function computeCollectionRate(collected, mrr) {
  const expected = Number(mrr) || 0;
  if (expected <= 0) return 0;
  return round1(((Number(collected) || 0) / expected) * 100);
}

function computeChurnRate(churned, active) {
  const a = Number(active) || 0;
  const c = Number(churned) || 0;
  if (a + c <= 0) return 0;
  return round1((c / (a + c)) * 100);
}

function computeClv(arpu, churnRatePct) {
  const monthlyChurnFraction = (Number(churnRatePct) || 0) / 100;
  if (monthlyChurnFraction > 0) return round0((Number(arpu) || 0) / monthlyChurnFraction);
  return round0((Number(arpu) || 0) * 24);
}

/**
 * Shared customer-scope filters for KPI / BI queries.
 * customers alias `c`, products alias `p` (LEFT JOIN when product filters used).
 */
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

/**
 * Canonical KPI snapshot used by Analytics, CEO pulse, and Executive reports.
 */
async function getKpiSnapshot(filters = {}, rangeInput = {}) {
  const range = resolveDateRange(rangeInput.from, rangeInput.to);
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const dateParams = [range.from, `${range.to} 23:59:59`];
  const prev = prevPeriodRange(range.from, range.to);
  const prevDateParams = [prev.from, `${prev.to} 23:59:59`];

  const [
    [counts],
    [prevCounts],
    [mrrRow],
    [revenueNow],
    [revenuePrev],
    [outstanding],
    [dstvRow],
    [paymentMix],
    [avgPay],
  ] = await Promise.all([
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
      `SELECT
        SUM(CASE WHEN c.created_at >= ? AND c.created_at <= ? THEN 1 ELSE 0 END) AS new_customers,
        SUM(CASE WHEN c.status = 'cancelled' AND c.updated_at >= ? AND c.updated_at <= ? THEN 1 ELSE 0 END) AS churned,
        SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active
       FROM customers c
       LEFT JOIN products p ON p.id = c.product_id
       WHERE 1=1${filterSql}`,
      [...prevDateParams, ...prevDateParams, ...filterParams]
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
    query(
      `SELECT
         COUNT(*) AS total_txns,
         SUM(CASE WHEN pt.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_txns
       FROM payment_transactions pt
       JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
       LEFT JOIN products p ON p.id = c.product_id
       WHERE pt.created_at >= ? AND pt.created_at <= ?${filterSql}`,
      [...dateParams, ...filterParams]
    ).catch(() => [{ total_txns: 0, success_txns: 0 }]),
    query(
      `SELECT AVG(DATEDIFF(zp.payment_date, zi.invoice_date)) AS avg_days
       FROM zoho_customer_payments zp
       JOIN zoho_customer_invoices zi ON zi.invoice_id = zp.invoice_id
       JOIN customers c ON c.id = zp.customer_id
       LEFT JOIN products p ON p.id = c.product_id
       WHERE zp.payment_date >= ? AND zp.payment_date <= ?
         AND zi.invoice_date IS NOT NULL
         AND zp.payment_date IS NOT NULL${filterSql}`,
      [...dateParams, ...filterParams]
    ).catch(() => [{ avg_days: null }]),
  ]);

  const active = Number(counts?.active || 0);
  const newCustomers = Number(counts?.new_customers || 0);
  const churned = Number(counts?.churned || 0);
  const prevNew = Number(prevCounts?.new_customers || 0);
  const prevChurned = Number(prevCounts?.churned || 0);
  const prevActive = Number(prevCounts?.active || 0);
  const mrr = round0(mrrRow?.mrr);
  const collected = Number(revenueNow?.revenue || 0);
  const collectedPrev = Number(revenuePrev?.revenue || 0);
  const outstandingBal = Number(outstanding?.outstanding || 0);
  const collectionRate = computeCollectionRate(collected, mrr);
  const churnRate = computeChurnRate(churned, active);
  const prevChurnRate = computeChurnRate(prevChurned, prevActive);
  const arpu = computeArpu(mrr, active);
  const clvEstimate = computeClv(arpu, churnRate);
  const arr = computeArr(mrr);
  const totalTxns = Number(paymentMix?.total_txns || 0);
  const successTxns = Number(paymentMix?.success_txns || 0);
  const paymentSuccessRate =
    totalTxns > 0 ? round1((successTxns / totalTxns) * 100) : 0;
  const avgDaysToPay =
    avgPay?.avg_days != null ? round1(avgPay.avg_days) : null;

  // Backward-compatible shape for BI / CEO dashboards + extended dictionary keys.
  return {
    period: range,
    previousPeriod: prev,
    totalActiveCustomers: active,
    totalSuspendedCustomers: Number(counts?.suspended || 0),
    totalDisconnectedCustomers: Number(counts?.disconnected || 0),
    mrr,
    arr,
    revenueCollectedThisMonth: round0(collected),
    outstandingInvoiceBalance: round0(outstandingBal),
    collectionRate,
    newCustomersThisMonth: newCustomers,
    customerChurnRate: churnRate,
    activeTvSubscribers: Number(dstvRow?.tv_subscribers || 0),
    arpu,
    avgCustomerLifetimeValue: clvEstimate,
    paymentSuccessRate,
    avgDaysToPay,
    invoiceSuccessRate: null, // requires Zoho status taxonomy; filled when invoice pipeline is complete
    avgInstallationTimeDays: null,
    activeSupportTickets: null,
    networkUptimePct: null,
    // Dictionary aliases
    activeCustomers: active,
    suspendedCustomers: Number(counts?.suspended || 0),
    revenueCollected: round0(collected),
    outstandingBalance: round0(outstandingBal),
    churnRate,
    clv: clvEstimate,
    trends: {
      revenueCollected: pctChange(collected, collectedPrev),
      newCustomers: pctChange(newCustomers, prevNew),
      mrr: null,
      churnRate: pctChange(churnRate, prevChurnRate),
    },
  };
}

async function getExpectedCollections(options = {}) {
  const { getUpcomingInvoiceForecast } = require("./billingForecastStore");
  const days = Number(options.days) > 0 ? Number(options.days) : 30;
  const forecast = await getUpcomingInvoiceForecast({
    days,
    startDate: options.startDate,
  });
  return {
    horizonDays: days,
    expectedCollections: round0(forecast?.anticipatedAmount || 0),
    invoiceCount: Number(forecast?.invoiceCount || forecast?.items?.length || 0),
    forecast,
  };
}

module.exports = {
  METRIC_DICTIONARY,
  MRR_EXPR,
  resolveDateRange,
  prevPeriodRange,
  pctChange,
  buildCustomerFilters,
  computeArr,
  computeArpu,
  computeCollectionRate,
  computeChurnRate,
  computeClv,
  getKpiSnapshot,
  getExpectedCollections,
};
