/**
 * Forecast intelligence — forward-looking planning (not historical replay).
 * Used by Analytics Forecast tab and Phase 3 scenario / insight engines.
 */
const { query } = require("../config/db");
const { getUpcomingInvoiceForecast } = require("./billingForecastStore");
const {
  getKpiSnapshot,
  buildCustomerFilters,
  resolveDateRange,
} = require("./kpiEngine");

function round0(n) {
  return Math.round(Number(n) || 0);
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function ymdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

async function forecastHorizon(days, startDate) {
  return getUpcomingInvoiceForecast({ days, startDate: startDate || ymdLocal() });
}

async function getAtRiskInvoices(limit = 50) {
  const rows = await query(
    `SELECT zi.invoice_number, c.id AS customer_id, c.customer_number,
            TRIM(CONCAT(c.first_name, ' ', c.last_name)) AS customer_name,
            zi.due_date,
            GREATEST(DATEDIFF(CURDATE(), COALESCE(zi.due_date, zi.invoice_date)), 0) AS days_overdue,
            COALESCE(zi.balance_due, 0) AS balance_due
     FROM zoho_customer_invoices zi
     JOIN customers c ON c.id = zi.customer_id
     WHERE COALESCE(zi.balance_due, 0) > 0
       AND COALESCE(zi.due_date, zi.invoice_date) < CURDATE()
       AND c.status = 'active'
     ORDER BY days_overdue DESC, balance_due DESC
     LIMIT ?`,
    [limit]
  ).catch(() => []);
  return rows.map((r) => ({
    invoiceNumber: r.invoice_number,
    customerId: r.customer_id,
    customerNumber: r.customer_number,
    customerName: r.customer_name,
    dueDate: r.due_date,
    daysOverdue: Number(r.days_overdue || 0),
    balanceDue: round0(r.balance_due),
    risk: Number(r.days_overdue) >= 60 ? "high" : Number(r.days_overdue) >= 30 ? "medium" : "low",
  }));
}

async function getChurnRiskCustomers(filters = {}, limit = 40) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const range = resolveDateRange(filters.from, filters.to);
  const rows = await query(
    `SELECT c.id AS customer_id, c.customer_number,
            TRIM(CONCAT(c.first_name, ' ', c.last_name)) AS customer_name,
            b.name AS building,
            COUNT(pt.id) AS failed_count,
            MAX(pt.created_at) AS last_failed_at,
            COALESCE((
              SELECT SUM(zi.balance_due) FROM zoho_customer_invoices zi
              WHERE zi.customer_id = c.id AND zi.balance_due > 0
            ), 0) AS outstanding
     FROM payment_transactions pt
     JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
     LEFT JOIN products p ON p.id = c.product_id
     LEFT JOIN buildings b ON b.id = c.building_id
     WHERE pt.status = 'FAILED'
       AND pt.created_at >= ? AND pt.created_at <= ?
       AND c.status = 'active'${filterSql}
     GROUP BY c.id, c.customer_number, customer_name, b.name
     HAVING COUNT(pt.id) >= 2
     ORDER BY failed_count DESC, outstanding DESC
     LIMIT ?`,
    [range.from, `${range.to} 23:59:59`, ...filterParams, limit]
  ).catch(() => []);

  return rows.map((r) => ({
    customerId: r.customer_id,
    customerNumber: r.customer_number,
    customerName: r.customer_name,
    building: r.building,
    failedPayments: Number(r.failed_count || 0),
    lastFailedAt: r.last_failed_at,
    outstanding: round0(r.outstanding),
    riskScore: Math.min(
      100,
      Number(r.failed_count || 0) * 15 + (Number(r.outstanding) > 0 ? 20 : 0)
    ),
  }));
}

async function getCollectedInWindow(from, to, filters = {}) {
  const { sql: filterSql, params: filterParams } = buildCustomerFilters(filters);
  const [row] = await query(
    `SELECT COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS collected
     FROM payment_transactions pt
     JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
     LEFT JOIN products p ON p.id = c.product_id
     WHERE pt.created_at >= ? AND pt.created_at <= ?${filterSql}`,
    [from, `${to} 23:59:59`, ...filterParams]
  );
  return round0(row?.collected);
}

/**
 * Month-end cash projection: opening collected (MTD) + remaining expected invoices this month.
 */
async function getCashFlowProjection(filters = {}) {
  const today = ymdLocal();
  const [y, m] = today.split("-").map(Number);
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const daysLeft = Math.max(0, lastDay - Number(today.slice(8, 10)));

  const [collectedMtd, remaining, kpis, weeklyBuckets] = await Promise.all([
    getCollectedInWindow(monthStart, today, filters),
    forecastHorizon(daysLeft || 1, today),
    getKpiSnapshot(filters, { from: monthStart, to: today }),
    Promise.all([7, 14, 21, 30].map(async (d) => {
      const f = await forecastHorizon(d, today);
      return {
        horizonDays: d,
        expectedInvoices: f.invoiceCount,
        expectedAmount: round0(f.anticipatedAmount),
      };
    })),
  ]);

  const remainingExpected = round0(remaining.anticipatedAmount);
  const projectedMonthEnd = collectedMtd + remainingExpected;
  const atRisk = await getAtRiskInvoices(200);
  const atRiskTotal = atRisk.reduce((s, r) => s + r.balanceDue, 0);

  return {
    asOf: today,
    monthStart,
    monthEnd,
    collectedMtd,
    remainingExpected,
    projectedMonthEnd,
    mrr: kpis.mrr,
    outstandingBalance: kpis.outstandingBalance,
    atRiskTotal,
    coverageVsMrr: kpis.mrr > 0 ? round1((projectedMonthEnd / kpis.mrr) * 100) : 0,
    horizons: weeklyBuckets,
  };
}

function buildScenarios(base) {
  const shocks = [-20, -10, 0, 10];
  return shocks.map((pct) => {
    const factor = 1 + pct / 100;
    const projectedCollections = round0(base.remainingExpected * factor);
    const monthEnd = round0(base.collectedMtd + projectedCollections);
    return {
      label:
        pct === 0
          ? "Base case"
          : pct < 0
            ? `Collections ${Math.abs(pct)}% below plan`
            : `Collections ${pct}% above plan`,
      shockPct: pct,
      remainingExpected: projectedCollections,
      projectedMonthEnd: monthEnd,
      gapVsMrr: round0(monthEnd - base.mrr),
      coverageVsMrr: base.mrr > 0 ? round1((monthEnd / base.mrr) * 100) : 0,
    };
  });
}

function buildRuleInsights({
  kpis,
  cash,
  due30,
  due7,
  atRisk,
  churnRisk,
  scenarios,
}) {
  const insights = [];

  if (cash.coverageVsMrr < 85) {
    insights.push({
      severity: "warning",
      title: "Month-end cash below MRR coverage",
      detail: `Projected collections cover ${cash.coverageVsMrr}% of MRR. Gap of KES ${Math.max(0, cash.mrr - cash.projectedMonthEnd).toLocaleString()}.`,
      action: "Open Forecast → At-risk list and prioritize 30+ day overdue.",
    });
  } else {
    insights.push({
      severity: "success",
      title: "Cash coverage on track",
      detail: `Projected month-end is ${cash.coverageVsMrr}% of MRR (KES ${cash.projectedMonthEnd.toLocaleString()}).`,
      action: "Monitor 7-day due queue to lock the week.",
    });
  }

  if (atRisk.length > 0) {
    const high = atRisk.filter((r) => r.risk === "high").length;
    insights.push({
      severity: high > 0 ? "danger" : "warning",
      title: `${atRisk.length} invoices at risk of non-payment`,
      detail: `KES ${cash.atRiskTotal.toLocaleString()} overdue${high ? ` · ${high} high-risk (60+ days)` : ""}.`,
      action: "Export At-Risk Revenue report or open Billing Health.",
    });
  }

  if (churnRisk.length > 0) {
    insights.push({
      severity: "warning",
      title: `${churnRisk.length} customers show repeated payment failure`,
      detail: "Two or more failed M-Pesa attempts in the selected period — elevated churn risk.",
      action: "Review High-Risk Customers report and trigger billing communications.",
    });
  }

  if (due7.invoiceCount > 0) {
    insights.push({
      severity: "info",
      title: `${due7.invoiceCount} invoices due in 7 days`,
      detail: `Expected value KES ${round0(due7.anticipatedAmount).toLocaleString()}.`,
      action: "Confirm Zoho recurring profiles and collection readiness.",
    });
  }

  const down10 = scenarios.find((s) => s.shockPct === -10);
  if (down10) {
    insights.push({
      severity: "info",
      title: "Scenario: collections −10%",
      detail: `Month-end would be KES ${down10.projectedMonthEnd.toLocaleString()} (${down10.coverageVsMrr}% of MRR).`,
      action: "Use Scenario modelling on the Forecast tab for board prep.",
    });
  }

  if (kpis.collectionRate < 70 && kpis.mrr > 0) {
    insights.push({
      severity: "danger",
      title: "Collection rate under 70%",
      detail: `Period collection rate is ${kpis.collectionRate}% versus MRR obligation.`,
      action: "Open Revenue & Cash and Billing Health tabs.",
    });
  }

  if (due30.invoiceCount === 0) {
    insights.push({
      severity: "warning",
      title: "No recurring invoices scheduled in 30 days",
      detail: "Zoho recurring next_invoice_date window is empty — check sync and trial schedules.",
      action: "Run Zoho sync and review Missing Recurring Invoices (when available).",
    });
  }

  return insights.slice(0, 8);
}

async function getVarianceAnalysis(filters = {}) {
  const range = resolveDateRange(filters.from, filters.to);
  const kpis = await getKpiSnapshot(filters, range);
  const expected = kpis.mrr; // period obligation proxy
  const actual = kpis.revenueCollected;
  const variance = actual - expected;
  const variancePct = expected > 0 ? round1((variance / expected) * 100) : 0;
  return {
    period: range,
    budgetOrExpected: expected,
    actual,
    variance,
    variancePct,
    label: "Collected vs MRR obligation",
  };
}

/**
 * Full Forecast Intelligence payload for Analytics.
 */
async function getForecastIntelligence(filters = {}) {
  const today = ymdLocal();
  const [
    kpis,
    due7,
    due30,
    due60,
    due90,
    cash,
    atRisk,
    churnRisk,
    variance,
  ] = await Promise.all([
    getKpiSnapshot(filters, resolveDateRange(filters.from, filters.to)),
    forecastHorizon(7, today),
    forecastHorizon(30, today),
    forecastHorizon(60, today),
    forecastHorizon(90, today),
    getCashFlowProjection(filters),
    getAtRiskInvoices(40),
    getChurnRiskCustomers(filters, 30),
    getVarianceAnalysis(filters),
  ]);

  const todayItems = (due7.items || []).filter(
    (i) => String(i.scheduledDate).slice(0, 10) === today
  );
  const todayPack = {
    windowDays: 0,
    windowStart: today,
    windowEnd: today,
    invoiceCount: todayItems.length,
    anticipatedAmount: todayItems.reduce((s, i) => s + i.expectedAmount, 0),
    items: todayItems,
  };

  const expectedVsActual = {
    expectedInvoices: due30.invoiceCount,
    expectedValue: round0(due30.anticipatedAmount),
    collectedMtd: cash.collectedMtd,
    outstanding: kpis.outstandingBalance,
    atRisk: cash.atRiskTotal,
    securedMrr: kpis.mrr,
    securedArr: kpis.arr,
  };

  const scenarios = buildScenarios(cash);
  const insights = buildRuleInsights({
    kpis,
    cash,
    due30,
    due7,
    atRisk,
    churnRisk,
    scenarios,
  });

  const dueBuckets = [
    { key: "today", label: "Today", days: 0, invoiceCount: todayPack.invoiceCount, amount: round0(todayPack.anticipatedAmount) },
    { key: "7d", label: "Next 7 days", days: 7, invoiceCount: due7.invoiceCount, amount: round0(due7.anticipatedAmount) },
    { key: "30d", label: "Next 30 days", days: 30, invoiceCount: due30.invoiceCount, amount: round0(due30.anticipatedAmount) },
    { key: "60d", label: "Next 60 days", days: 60, invoiceCount: due60.invoiceCount, amount: round0(due60.anticipatedAmount) },
    { key: "90d", label: "Next 90 days", days: 90, invoiceCount: due90.invoiceCount, amount: round0(due90.anticipatedAmount) },
  ];

  return {
    asOf: today,
    kpis: {
      mrr: kpis.mrr,
      arr: kpis.arr,
      expectedCollections30d: round0(due30.anticipatedAmount),
      collectedMtd: cash.collectedMtd,
      projectedMonthEnd: cash.projectedMonthEnd,
      outstanding: kpis.outstandingBalance,
      atRisk: cash.atRiskTotal,
      collectionRate: kpis.collectionRate,
    },
    dueBuckets,
    expectedVsActual,
    cashFlow: cash,
    scenarios,
    variance,
    atRiskInvoices: atRisk,
    churnRiskCustomers: churnRisk,
    upcomingSample: (due7.items || []).slice(0, 25),
    insights,
    networkReady: false,
    meta: {
      generatedAt: new Date().toISOString(),
      engine: "forecastIntelligenceStore",
    },
  };
}

module.exports = {
  getForecastIntelligence,
  getCashFlowProjection,
  getChurnRiskCustomers,
  getAtRiskInvoices,
  getVarianceAnalysis,
  buildScenarios,
};
