const { query } = require("../config/db");
const { normalizeSubscriptionStatus } = require("../utils/subscriptionStatus");
const { attributeDocumentAmount, unitWeight } = require("../utils/b2bDocumentAttribution");
const {
  getKpiSnapshot,
  getExpectedCollections,
  resolveDateRange: resolveKpiDateRange,
} = require("./kpiEngine");

/**
 * Report catalog. `family` is the Reports IA grouping.
 * `category` kept for backward compatibility (= family for most).
 */
const REPORT_DEFINITIONS = [
  // —— Executive ——
  {
    id: "business-health-summary",
    title: "Business Health Summary",
    description: "Canonical KPIs from the shared metric engine for the selected period.",
    category: "Executive",
    family: "Executive",
    dateFilter: true,
  },
  {
    id: "executive-monthly",
    title: "Executive Monthly Report",
    description: "Board-ready monthly pack: revenue, collections, customers, churn, and packages.",
    category: "Executive",
    family: "Executive",
    dateFilter: false,
    monthFilter: true,
  },
  {
    id: "executive-weekly",
    title: "Executive Weekly Summary",
    description: "Last-7-day KPI snapshot for leadership stand-ups.",
    category: "Executive",
    family: "Executive",
    dateFilter: true,
    available: true,
  },

  // —— Financial ——
  {
    id: "revenue-summary",
    title: "Revenue Summary",
    description: "Daily revenue, transaction counts, and success/failure breakdown.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "transaction-list",
    title: "Payment Transactions",
    description: "All M-Pesa payment transactions in the selected period.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "channel-breakdown",
    title: "Channel Breakdown",
    description: "Transaction volume and revenue grouped by payment channel.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "arpu-analysis",
    title: "ARPU by Building",
    description: "Average revenue per paying customer by property.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "outstanding-invoices",
    title: "Outstanding Invoices",
    description: "Zoho invoices with balance due greater than zero.",
    category: "Financial",
    family: "Financial",
    dateFilter: false,
  },
  {
    id: "ar-aging",
    title: "Accounts Receivable Aging",
    description: "Outstanding invoice balances bucketed 0–30 / 31–60 / 61–90 / 90+ days.",
    category: "Financial",
    family: "Financial",
    dateFilter: false,
  },
  {
    id: "collections-summary",
    title: "Collections Summary",
    description: "Successful collections by day with totals for the period.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "revenue-by-package",
    title: "Revenue by Package",
    description: "Successful payment revenue attributed by customer package.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "revenue-by-customer",
    title: "Revenue by Customer",
    description: "Highest-paying customers ranked by total successful payments.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "revenue-by-region",
    title: "Revenue by Region",
    description: "Collected revenue grouped by building / POP.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "forecast-vs-actual-revenue",
    title: "Forecast vs Actual Revenue",
    description: "MRR obligation vs collected revenue for the selected period.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
  },
  {
    id: "deferred-revenue",
    title: "Deferred Revenue",
    description: "Requires prepaid / unearned revenue tracking — not yet wired.",
    category: "Financial",
    family: "Financial",
    dateFilter: true,
    available: false,
  },

  // —— Billing ——
  {
    id: "failed-payments",
    title: "Failed Payments",
    description: "Failed M-Pesa transactions with result codes and descriptions.",
    category: "Billing",
    family: "Billing",
    dateFilter: true,
  },
  {
    id: "collection-efficiency",
    title: "Collection Efficiency",
    description: "Daily payment success rates and collection performance.",
    category: "Billing",
    family: "Billing",
    dateFilter: true,
  },
  {
    id: "billing-reconciliation",
    title: "Billing Reconciliation",
    description: "Customers with billing, payment, and service status mismatches.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
  },
  {
    id: "invoices-vs-payments",
    title: "Invoices vs Payments",
    description:
      "Zoho Books invoices raised in a selected month versus Zoho payments received that month.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
    monthFilter: true,
  },
  {
    id: "customer-monthly-billing-matrix",
    title: "Customer Monthly Billing Matrix",
    description:
      "Customers × selected months in a year: invoice amount/date and payment amount/date per month. Invoices land in the month they were raised. Months with no raise show projected dates/amounts from Zoho recurring (including stopped) or last-invoice cadence; otherwise No recurring. Projected invoice total is the scheduled expected bill for the selected months (including past months). Consolidated B2B amounts are split per managed house.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
    yearFilter: true,
    monthRangeFilter: true,
  },
  {
    id: "collection-gap-by-customer",
    title: "Collection Gap by Customer",
    description:
      "Per-customer expected bill vs invoiced share vs collected share for a month. Splits consolidated B2B agency documents across managed houses so Skynest/Diar-style portfolios show a true unit-level collection gap.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
    monthFilter: true,
  },
  {
    id: "payment-frequency-mix",
    title: "Billing Frequency Mix",
    description: "Active subscribers grouped by monthly, quarterly, or yearly billing.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
  },
  {
    id: "monthly-payment-churn",
    title: "Monthly Payment Churn",
    description:
      "Customers churned in a selected month from cancellations, disconnects, and unpaid billing.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
    monthFilter: true,
  },
  {
    id: "suspended-billing",
    title: "Suspended Billing",
    description: "Active accounts with suspended / non-active subscription status.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
  },
  {
    id: "failed-billing",
    title: "Failed Billing",
    description: "Alias of failed payment attempts for billing ops.",
    category: "Billing",
    family: "Billing",
    dateFilter: true,
  },
  {
    id: "missing-recurring-invoices",
    title: "Missing Recurring Invoices",
    description: "Requires Zoho recurring gap detection — Phase 1 catalog; runner pending.",
    category: "Billing",
    family: "Billing",
    dateFilter: false,
    available: false,
  },
  {
    id: "credit-notes-adjustments",
    title: "Credit Notes & Adjustments",
    description: "Requires Zoho credit note sync — not yet available.",
    category: "Billing",
    family: "Billing",
    dateFilter: true,
    available: false,
  },

  // —— Forecasting ——
  {
    id: "upcoming-invoices",
    title: "Upcoming Invoice Schedule",
    description: "Invoices scheduled in the near term and anticipated collection amount.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "expected-collections",
    title: "Expected Collections",
    description: "Forward-looking expected invoice value for the next 30 days.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "renewals-due",
    title: "Renewals Due",
    description: "Customers with upcoming recurring invoice dates.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "mrr-arr-forecast",
    title: "MRR / ARR Forecast",
    description: "Current secured MRR and ARR from the metric engine.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "at-risk-revenue",
    title: "At-Risk Revenue",
    description: "Outstanding balances on overdue Zoho invoices.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "cash-flow-projection",
    title: "Cash Flow Projection",
    description: "Scenario modelling reserved for Phase 3.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: true,
    available: false,
  },
  {
    id: "invoice-generation-forecast",
    title: "Invoice Generation Forecast",
    description: "Same horizon as upcoming invoices — scheduled invoice count and value.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "subscription-renewal-forecast",
    title: "Subscription Renewal Forecast",
    description: "Renewals due in the next 30 days.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },
  {
    id: "revenue-forecast",
    title: "Revenue Forecast",
    description: "Expected collections vs current MRR obligation.",
    category: "Forecasting",
    family: "Forecasting",
    dateFilter: false,
  },

  // —— Customer ——
  {
    id: "top-customers",
    title: "Top Customers by Spend",
    description: "Highest-paying customers ranked by total successful payments.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "subscriber-census",
    title: "Subscriber Census",
    description: "Active and cancelled subscribers grouped by building and type.",
    category: "Customer",
    family: "Customer",
    dateFilter: false,
  },
  {
    id: "active-customers",
    title: "Active Customers",
    description: "All active customers with package, building, and MRR contribution.",
    category: "Customer",
    family: "Customer",
    dateFilter: false,
  },
  {
    id: "package-distribution",
    title: "Package Distribution",
    description: "Subscriber counts per package, Mbps tier, and building.",
    category: "Customer",
    family: "Customer",
    dateFilter: false,
  },
  {
    id: "customer-lifecycle",
    title: "Customer Lifecycle Events",
    description: "Upgrades, downgrades, apartment switches, and cancellations.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "new-subscribers",
    title: "New Customers",
    description: "Customers created during the selected period.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "churn-analysis",
    title: "Churn Report",
    description: "Cancelled subscribers with tenure and last package details.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "dstv-iuc-roster",
    title: "DSTV IUC / Serial Roster",
    description: "DSTV customers with IUC/serial, building, and status.",
    category: "Customer",
    family: "Customer",
    dateFilter: false,
  },
  {
    id: "agency-performance",
    title: "Agency Performance",
    description: "Customer counts and attributed revenue per agency.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "high-risk-customers",
    title: "High-Risk Customers",
    description: "Customers with consecutive failed M-Pesa payments in the period.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "consecutive-failed-payments",
    title: "Customers with Consecutive Failed Payments",
    description: "Same as high-risk — failed payment streaks.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },
  {
    id: "reconnection-report",
    title: "Reconnection Report",
    description: "Requires reconnect lifecycle events — catalogued for Phase 1.",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
    available: false,
  },
  {
    id: "customer-lifetime-value",
    title: "Customer Lifetime Value",
    description: "CLV estimate from shared metric engine (ARPU ÷ churn).",
    category: "Customer",
    family: "Customer",
    dateFilter: true,
  },

  // —— Network ——
  {
    id: "customers-by-pop-package",
    title: "Customers by POP & Package",
    description: "Active customers grouped by POP (building) and package.",
    category: "Network",
    family: "Network",
    dateFilter: false,
  },
  {
    id: "building-occupancy",
    title: "Building Occupancy",
    description: "Active customers and unique apartments per building.",
    category: "Network",
    family: "Network",
    dateFilter: false,
  },
  {
    id: "active-connections",
    title: "Active Connections",
    description: "Requires live TISP/OLT connection feed — Phase 2.",
    category: "Network",
    family: "Network",
    dateFilter: false,
    available: false,
  },
  {
    id: "offline-customers",
    title: "Offline Customers",
    description: "Requires network monitoring — Phase 2.",
    category: "Network",
    family: "Network",
    dateFilter: false,
    available: false,
  },
  {
    id: "installation-report",
    title: "Installation Report",
    description: "Requires field-service install events — Phase 2.",
    category: "Network",
    family: "Network",
    dateFilter: true,
    available: false,
  },
  {
    id: "technician-performance",
    title: "Technician Performance",
    description: "Requires technician assignment data — Phase 2.",
    category: "Network",
    family: "Network",
    dateFilter: true,
    available: false,
  },
  {
    id: "bandwidth-utilization",
    title: "Bandwidth Utilization",
    description: "Requires bandwidth telemetry — Phase 2.",
    category: "Network",
    family: "Network",
    dateFilter: true,
    available: false,
  },

  // —— Audit ——
  {
    id: "tisp-sync-health",
    title: "TISP Sync Health",
    description: "Customer TISP provisioning status with error details.",
    category: "Audit",
    family: "Audit",
    dateFilter: false,
  },
  {
    id: "api-errors",
    title: "API Error Log",
    description: "Failed API calls across TISP, Zoho, and M-Pesa services.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
  },
  {
    id: "integration-events",
    title: "Integration Events",
    description: "Zoho and TISP integration events with outcomes.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
  },
  {
    id: "user-activity",
    title: "User Activity",
    description: "Requires admin activity audit log — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
  {
    id: "invoice-audit-trail",
    title: "Invoice Audit Trail",
    description: "Requires invoice change history — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
  {
    id: "payment-audit-trail",
    title: "Payment Audit Trail",
    description: "Requires payment change history — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
  {
    id: "manual-adjustments",
    title: "Manual Adjustments",
    description: "Requires adjustment ledger — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
  {
    id: "deleted-records",
    title: "Deleted Records",
    description: "Requires soft-delete audit — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
  {
    id: "permission-changes",
    title: "Permission Changes",
    description: "Requires RBAC change log — catalogued.",
    category: "Audit",
    family: "Audit",
    dateFilter: true,
    available: false,
  },
];

/** Partner-safe reports: aggregate metrics only — no transaction-level or internal ops data. */
const PARTNER_REPORT_IDS = new Set([
  "revenue-summary",
  "channel-breakdown",
  "collection-efficiency",
  "arpu-analysis",
  "subscriber-census",
  "package-distribution",
  "customers-by-pop-package",
  "building-occupancy",
  "agency-performance",
  "customer-lifecycle",
  "new-subscribers",
  "churn-analysis",
  "monthly-payment-churn",
  "payment-frequency-mix",
  "business-health-summary",
  "revenue-by-package",
  "revenue-by-region",
  "active-customers",
]);

function listReportDefinitions() {
  return REPORT_DEFINITIONS.map((r) => ({
    ...r,
    available: r.available !== false,
    family: r.family || r.category,
  }));
}

function listPartnerReportDefinitions() {
  return listReportDefinitions().filter((r) => PARTNER_REPORT_IDS.has(r.id));
}

function isPartnerReport(id) {
  return PARTNER_REPORT_IDS.has(id);
}

function getReportDefinition(id) {
  return REPORT_DEFINITIONS.find((r) => r.id === id) || null;
}

function resolveDateRange(from, to) {
  return resolveKpiDateRange(from, to);
}

function resolveMonthRange(month) {
  const normalized = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    throw new Error("month must be in YYYY-MM format");
  }
  const [yearStr, monthStr] = normalized.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error("month must be in YYYY-MM format");
  }
  // Use local calendar day — NOT Date#toISOString() (UTC shifts the last day
  // backward for positive-offset timezones, e.g. July → …-07-30).
  const lastDay = new Date(year, monthNum, 0).getDate();
  const start = `${yearStr}-${monthStr}-01`;
  const end = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { month: normalized, from: start, to: end };
}

function resolveYearRange(year) {
  const normalized = String(year || "").trim();
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error("year must be in YYYY format");
  }
  const yearNum = Number(normalized);
  if (!Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error("year must be in YYYY format");
  }
  return {
    year: normalized,
    from: `${normalized}-01-01`,
    to: `${normalized}-12-31`,
  };
}

/** Year plus optional inclusive month span (1–12). Defaults to full year. */
function resolveYearMonthSpan(year, monthFrom, monthTo) {
  const base = resolveYearRange(year);
  let fromM = Number(monthFrom);
  let toM = Number(monthTo);
  if (!Number.isFinite(fromM)) fromM = 1;
  if (!Number.isFinite(toM)) toM = 12;
  fromM = Math.min(12, Math.max(1, Math.trunc(fromM)));
  toM = Math.min(12, Math.max(1, Math.trunc(toM)));
  if (fromM > toM) {
    const swap = fromM;
    fromM = toM;
    toM = swap;
  }
  const fromMm = String(fromM).padStart(2, "0");
  const toMm = String(toM).padStart(2, "0");
  const lastDay = new Date(Number(base.year), toM, 0).getDate();
  return {
    year: base.year,
    monthFrom: fromM,
    monthTo: toM,
    from: `${base.year}-${fromMm}-01`,
    to: `${base.year}-${toMm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatMonthSpanLabel(monthFrom, monthTo) {
  if (monthFrom === 1 && monthTo === 12) return "All months";
  if (monthFrom === monthTo) return MONTH_NAMES[monthFrom - 1];
  return `${MONTH_NAMES[monthFrom - 1]}–${MONTH_NAMES[monthTo - 1]}`;
}

function dateWhere(column, from, to) {
  const conditions = [`${column} >= ?`, `${column} <= ?`];
  const params = [from, `${to} 23:59:59`];
  return { clause: `WHERE ${conditions.join(" AND ")}`, params };
}

function formatRow(row, headers) {
  const out = {};
  for (const h of headers) {
    const val = row[h.key];
    out[h.key] = val == null ? "" : val;
  }
  return out;
}

async function revenueSummary(from, to) {
  const headers = [
    { key: "day", label: "Date" },
    { key: "total_count", label: "Transactions" },
    { key: "success_count", label: "Successful" },
    { key: "failed_count", label: "Failed" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT DATE(created_at) AS day,
      COUNT(*) AS total_count,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions ${clause}
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    params
  );
  return {
    title: "Revenue Summary",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function transactionList(from, to) {
  const headers = [
    { key: "created_at", label: "Date" },
    { key: "mpesa_receipt", label: "Receipt" },
    { key: "phone", label: "Phone" },
    { key: "account_reference", label: "Account Ref" },
    { key: "amount", label: "Amount (KES)" },
    { key: "status", label: "Status" },
    { key: "channel", label: "Channel" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT created_at, mpesa_receipt, phone, account_reference, amount, status, channel
     FROM payment_transactions ${clause}
     ORDER BY created_at DESC
     LIMIT 5000`,
    params
  );
  return {
    title: "Payment Transactions",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function failedPayments(from, to) {
  const headers = [
    { key: "created_at", label: "Date" },
    { key: "phone", label: "Phone" },
    { key: "account_reference", label: "Account Ref" },
    { key: "amount", label: "Amount (KES)" },
    { key: "result_code", label: "Result Code" },
    { key: "result_desc", label: "Description" },
    { key: "channel", label: "Channel" },
  ];
  const rows = await query(
    `SELECT created_at, phone, account_reference, amount, result_code, result_desc, channel
     FROM payment_transactions
     WHERE status = 'FAILED' AND created_at >= ? AND created_at <= ?
     ORDER BY created_at DESC
     LIMIT 5000`,
    [from, `${to} 23:59:59`]
  );
  return {
    title: "Failed Payments",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function channelBreakdown(from, to) {
  const headers = [
    { key: "channel", label: "Channel" },
    { key: "total_count", label: "Transactions" },
    { key: "success_count", label: "Successful" },
    { key: "failed_count", label: "Failed" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT COALESCE(channel, 'Unknown') AS channel,
      COUNT(*) AS total_count,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions ${clause}
     GROUP BY channel
     ORDER BY revenue DESC`,
    params
  );
  return {
    title: "Channel Breakdown",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function topCustomers(from, to) {
  const headers = [
    { key: "customer_number", label: "Customer No." },
    { key: "phone", label: "Phone" },
    { key: "payments", label: "Payments" },
    { key: "total_spent", label: "Total Spent (KES)" },
    { key: "last_payment", label: "Last Payment" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT account_reference AS customer_number, phone,
      COUNT(*) AS payments,
      COALESCE(SUM(amount), 0) AS total_spent,
      MAX(created_at) AS last_payment
     FROM payment_transactions ${clause} AND status = 'SUCCESS'
       AND account_reference IS NOT NULL AND account_reference != ''
     GROUP BY account_reference, phone
     ORDER BY total_spent DESC
     LIMIT 500`,
    params
  );
  return {
    title: "Top Customers by Spend",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function subscriberCensus() {
  const headers = [
    { key: "building", label: "Building" },
    { key: "customer_type", label: "Type" },
    { key: "active_count", label: "Active" },
    { key: "cancelled_count", label: "Cancelled" },
    { key: "total_count", label: "Total" },
  ];
  const rows = await query(
    `SELECT b.name AS building, c.customer_type,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
      COUNT(*) AS total_count
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     GROUP BY b.name, c.customer_type
     ORDER BY b.name, c.customer_type`
  );
  return {
    title: "Subscriber Census",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function packageDistribution() {
  const headers = [
    { key: "building", label: "Building" },
    { key: "package", label: "Package" },
    { key: "mbps", label: "Mbps" },
    { key: "frequency", label: "Frequency" },
    { key: "active_count", label: "Active Subscribers" },
    { key: "cancelled_count", label: "Cancelled" },
  ];
  const rows = await query(
    `SELECT b.name AS building, p.name AS package, p.mbps,
      p.payment_frequency AS frequency,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN c.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
     FROM customers c
     JOIN products p ON p.id = c.product_id
     JOIN buildings b ON b.id = c.building_id
     GROUP BY b.name, p.name, p.mbps, p.payment_frequency
     ORDER BY b.name, p.mbps DESC`
  );
  return {
    title: "Package Distribution",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

/**
 * Customers grouped by POP (building) and package with package amounts.
 * Amounts use each customer's package_price; totals cover active subscribers only.
 */
async function customersByPopPackage() {
  const headers = [
    { key: "pop", label: "POP" },
    { key: "package", label: "Package" },
    { key: "mbps", label: "Mbps" },
    { key: "frequency", label: "Frequency" },
    { key: "customers", label: "Active Customers" },
    { key: "unit_amount", label: "Package Amount (KES)" },
    { key: "total_amount", label: "Total Amount (KES)" },
  ];
  const rows = await query(
    `SELECT b.name AS pop,
            p.name AS \`package\`,
            p.mbps,
            c.payment_frequency AS frequency,
            COUNT(*) AS customers,
            ROUND(AVG(c.package_price), 2) AS unit_amount,
            ROUND(SUM(c.package_price), 2) AS total_amount
     FROM customers c
     JOIN products p ON p.id = c.product_id
     JOIN buildings b ON b.id = c.building_id
     WHERE c.status = 'active'
     GROUP BY b.id, b.name, p.id, p.name, p.mbps, c.payment_frequency
     ORDER BY b.name ASC, total_amount DESC, p.mbps DESC`
  );

  let totalCustomers = 0;
  let totalAmount = 0;
  for (const row of rows) {
    totalCustomers += Number(row.customers) || 0;
    totalAmount += Number(row.total_amount) || 0;
  }

  const formatted = rows.map((r) => formatRow(r, headers));
  formatted.push(
    formatRow(
      {
        pop: "TOTAL",
        package: "",
        mbps: "",
        frequency: "",
        customers: totalCustomers,
        unit_amount: "",
        total_amount: Math.round(totalAmount * 100) / 100,
      },
      headers
    )
  );

  return {
    title: "Customers by POP & Package",
    headers,
    rows: formatted,
    summary: {
      activeCustomers: totalCustomers,
      totalAmount: Math.round(totalAmount * 100) / 100,
    },
  };
}

async function buildingOccupancy() {
  const headers = [
    { key: "building", label: "Building" },
    { key: "active_customers", label: "Active Customers" },
    { key: "unique_apartments", label: "Occupied Apartments" },
    { key: "c2b_count", label: "C2B" },
    { key: "b2b_count", label: "B2B" },
  ];
  const rows = await query(
    `SELECT b.name AS building,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active_customers,
      COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.apartment_number END) AS unique_apartments,
      SUM(CASE WHEN c.status = 'active' AND c.customer_type = 'C2B' THEN 1 ELSE 0 END) AS c2b_count,
      SUM(CASE WHEN c.status = 'active' AND c.customer_type = 'B2B' THEN 1 ELSE 0 END) AS b2b_count
     FROM buildings b
     LEFT JOIN customers c ON c.building_id = b.id
     GROUP BY b.id, b.name
     ORDER BY active_customers DESC`
  );
  return {
    title: "Building Occupancy",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function agencyPerformance(from, to) {
  const headers = [
    { key: "agency", label: "Agency" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "active_customers", label: "Active Customers" },
    { key: "total_customers", label: "Total Customers" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const rows = await query(
    `SELECT a.name AS agency, a.email, a.phone,
      SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END) AS active_customers,
      COUNT(DISTINCT c.id) AS total_customers,
      COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
     FROM agencies a
     LEFT JOIN customers c ON c.agency_id = a.id
     LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
       AND pt.status = 'SUCCESS'
       AND pt.created_at >= ? AND pt.created_at <= ?
     GROUP BY a.id, a.name, a.email, a.phone
     ORDER BY revenue DESC`,
    [from, `${to} 23:59:59`]
  );
  return {
    title: "Agency Performance",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function tispSyncHealth() {
  const headers = [
    { key: "customer_number", label: "Customer No." },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "tisp_sync_status", label: "Sync Status" },
    { key: "tisp_sync_error", label: "Error" },
    { key: "status", label: "Subscription" },
  ];
  const rows = await query(
    `SELECT c.customer_number,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
      b.name AS building,
      c.tisp_sync_status, c.tisp_sync_error, c.status
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     WHERE c.status = 'active'
     ORDER BY
       CASE c.tisp_sync_status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
       c.customer_number
     LIMIT 5000`
  );
  return {
    title: "TISP Sync Health",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function customerLifecycle(from, to) {
  const headers = [
    { key: "created_at", label: "Date" },
    { key: "customer_number", label: "Customer No." },
    { key: "customer_name", label: "Name" },
    { key: "event_type", label: "Event" },
    { key: "old_product", label: "Old Package" },
    { key: "new_product", label: "New Package" },
    { key: "notes", label: "Notes" },
  ];
  const { clause, params } = dateWhere("e.created_at", from, to);
  const rows = await query(
    `SELECT e.created_at, c.customer_number,
      CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
      e.event_type,
      op.name AS old_product, np.name AS new_product, e.notes
     FROM customer_events e
     JOIN customers c ON c.id = e.customer_id
     LEFT JOIN products op ON op.id = e.old_product_id
     LEFT JOIN products np ON np.id = e.new_product_id
     ${clause}
     ORDER BY e.created_at DESC
     LIMIT 5000`,
    params
  );
  return {
    title: "Customer Lifecycle Events",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function apiErrors(from, to) {
  const headers = [
    { key: "created_at", label: "Date" },
    { key: "service", label: "Service" },
    { key: "operation", label: "Operation" },
    { key: "endpoint", label: "Endpoint" },
    { key: "http_status", label: "HTTP Status" },
    { key: "error_message", label: "Error" },
    { key: "customer_number", label: "Customer No." },
  ];
  const rows = await query(
    `SELECT created_at, service, operation, endpoint, http_status,
      error_message, customer_number
     FROM api_call_logs
     WHERE status = 'failure' AND created_at >= ? AND created_at <= ?
     ORDER BY created_at DESC
     LIMIT 5000`,
    [from, `${to} 23:59:59`]
  );
  return {
    title: "API Error Log",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function newSubscribers(from, to) {
  const headers = [
    { key: "created_at", label: "Created" },
    { key: "customer_number", label: "Customer No." },
    { key: "full_name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "building", label: "Building" },
    { key: "package", label: "Package" },
    { key: "customer_type", label: "Type" },
    { key: "package_price", label: "Price (KES)" },
  ];
  const { clause, params } = dateWhere("c.created_at", from, to);
  const rows = await query(
    `SELECT c.created_at, c.customer_number,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
      c.phone, b.name AS building, p.name AS package,
      c.customer_type, c.package_price
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     JOIN products p ON p.id = c.product_id
     ${clause}
     ORDER BY c.created_at DESC
     LIMIT 5000`,
    params
  );
  return {
    title: "New Subscribers",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function integrationEvents(from, to) {
  const headers = [
    { key: "created_at", label: "Date" },
    { key: "source", label: "Source" },
    { key: "customer_no", label: "Customer No." },
    { key: "amount", label: "Amount (KES)" },
    { key: "status", label: "Status" },
    { key: "outcome", label: "Outcome" },
    { key: "channel", label: "Channel" },
    { key: "reference_id", label: "Reference" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT created_at, source, customer_no, amount, status, outcome, channel, reference_id
     FROM integration_events ${clause}
     ORDER BY created_at DESC
     LIMIT 5000`,
    params
  );
  return {
    title: "Integration Events",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function collectionEfficiency(from, to) {
  const headers = [
    { key: "day", label: "Date" },
    { key: "total_count", label: "Attempts" },
    { key: "success_count", label: "Successful" },
    { key: "failed_count", label: "Failed" },
    { key: "success_rate", label: "Success Rate (%)" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const { clause, params } = dateWhere("created_at", from, to);
  const rows = await query(
    `SELECT DATE(created_at) AS day,
      COUNT(*) AS total_count,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
      ROUND(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS success_rate,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions ${clause}
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    params
  );
  return {
    title: "Collection Efficiency",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function arpuAnalysis(from, to) {
  const headers = [
    { key: "building", label: "Building" },
    { key: "payers", label: "Paying Customers" },
    { key: "revenue", label: "Revenue (KES)" },
    { key: "arpu", label: "ARPU (KES)" },
  ];
  const rows = await query(
    `SELECT b.name AS building,
      COUNT(DISTINCT CASE WHEN pt.status = 'SUCCESS' THEN pt.account_reference END) AS payers,
      COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
      ROUND(COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) /
        NULLIF(COUNT(DISTINCT CASE WHEN pt.status = 'SUCCESS' THEN pt.account_reference END), 0), 0) AS arpu
     FROM buildings b
     JOIN customers c ON c.building_id = b.id AND c.status = 'active'
     LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
       AND pt.status = 'SUCCESS'
       AND pt.created_at >= ? AND pt.created_at <= ?
     GROUP BY b.id, b.name
     HAVING payers > 0
     ORDER BY arpu DESC`,
    [from, `${to} 23:59:59`]
  );
  return {
    title: "ARPU by Building",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function churnAnalysis(from, to) {
  const headers = [
    { key: "cancelled_at", label: "Cancelled" },
    { key: "customer_number", label: "Customer No." },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "package", label: "Last Package" },
    { key: "customer_type", label: "Type" },
    { key: "cancellation_reason", label: "Reason" },
    { key: "onu_collected_at", label: "ONU Collected" },
    { key: "dstv_decoder_collected_at", label: "DSTV Decoder Collected" },
    { key: "tenure_days", label: "Tenure (Days)" },
  ];
  const rows = await query(
    `SELECT c.updated_at AS cancelled_at, c.customer_number,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
      b.name AS building, p.name AS package, c.customer_type,
      COALESCE(c.cancellation_reason, '') AS cancellation_reason,
      c.onu_collected_at,
      c.dstv_decoder_collected_at,
      DATEDIFF(c.updated_at, c.created_at) AS tenure_days
     FROM customers c
     JOIN buildings b ON b.id = c.building_id
     JOIN products p ON p.id = c.product_id
     WHERE c.status = 'cancelled'
       AND c.updated_at >= ? AND c.updated_at <= ?
     ORDER BY c.updated_at DESC
     LIMIT 5000`,
    [from, `${to} 23:59:59`]
  );
  return {
    title: "Churn Analysis",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

const MONTHLY_PAYMENT_CHURN_UNION_SQL = `
  SELECT
    'cancelled' AS churn_reason,
    c.updated_at AS churned_at,
    c.customer_number,
    CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
    b.name AS building,
    p.name AS package,
    c.customer_type,
    COALESCE(c.subscription_status, '') AS subscription_status,
    c.last_payment_date,
    COALESCE(c.cancellation_reason, '') AS cancellation_detail,
    c.onu_collected_at,
    c.dstv_decoder_collected_at,
    NULL AS oldest_overdue_date,
    0 AS outstanding_balance
  FROM customers c
  JOIN buildings b ON b.id = c.building_id
  JOIN products p ON p.id = c.product_id
  WHERE c.status = 'cancelled'
    AND c.updated_at >= ?
    AND c.updated_at <= ?

  UNION ALL

  SELECT
    'disconnected' AS churn_reason,
    e.created_at AS churned_at,
    c.customer_number,
    CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
    b.name AS building,
    p.name AS package,
    c.customer_type,
    COALESCE(c.subscription_status, '') AS subscription_status,
    c.last_payment_date,
    COALESCE(e.notes, '') AS cancellation_detail,
    NULL AS onu_collected_at,
    NULL AS dstv_decoder_collected_at,
    NULL AS oldest_overdue_date,
    0 AS outstanding_balance
  FROM customer_events e
  JOIN customers c ON c.id = e.customer_id
  JOIN buildings b ON b.id = c.building_id
  JOIN products p ON p.id = c.product_id
  WHERE e.event_type = 'disconnect'
    AND e.created_at >= ?
    AND e.created_at <= ?

  UNION ALL

  SELECT
    'unpaid_overdue' AS churn_reason,
    DATE_ADD(MIN(COALESCE(zi.due_date, ?)), INTERVAL 14 DAY) AS churned_at,
    c.customer_number,
    CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
    b.name AS building,
    p.name AS package,
    c.customer_type,
    COALESCE(c.subscription_status, '') AS subscription_status,
    c.last_payment_date,
    '' AS cancellation_detail,
    NULL AS onu_collected_at,
    NULL AS dstv_decoder_collected_at,
    MIN(zi.due_date) AS oldest_overdue_date,
    ROUND(SUM(COALESCE(zi.balance_due, 0)), 2) AS outstanding_balance
  FROM customers c
  JOIN buildings b ON b.id = c.building_id
  JOIN products p ON p.id = c.product_id
  JOIN zoho_customer_invoices zi ON zi.customer_id = c.id
  WHERE c.status = 'active'
    AND zi.balance_due > 0
    AND zi.due_date IS NOT NULL
    AND zi.due_date >= ?
    AND zi.due_date <= ?
    AND (
      c.last_payment_date IS NULL
      OR c.last_payment_date < DATE_SUB(zi.due_date, INTERVAL 1 DAY)
    )
  GROUP BY c.id, c.customer_number, c.first_name, c.middle_name, c.last_name,
           b.name, p.name, c.customer_type, c.subscription_status, c.last_payment_date
  HAVING DATE_ADD(MIN(zi.due_date), INTERVAL 14 DAY) <= ?

  UNION ALL

  SELECT
    'long_unpaid' AS churn_reason,
    DATE_SUB(?, INTERVAL 1 DAY) AS churned_at,
    c.customer_number,
    CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
    b.name AS building,
    p.name AS package,
    c.customer_type,
    COALESCE(c.subscription_status, '') AS subscription_status,
    c.last_payment_date,
    '' AS cancellation_detail,
    NULL AS onu_collected_at,
    NULL AS dstv_decoder_collected_at,
    MIN(zi.due_date) AS oldest_overdue_date,
    ROUND(SUM(COALESCE(zi.balance_due, 0)), 2) AS outstanding_balance
  FROM customers c
  JOIN buildings b ON b.id = c.building_id
  JOIN products p ON p.id = c.product_id
  JOIN zoho_customer_invoices zi ON zi.customer_id = c.id
  WHERE c.status = 'active'
    AND zi.balance_due > 0
    AND zi.due_date < ?
    AND (
      c.last_payment_date IS NULL
      OR c.last_payment_date < DATE_SUB(?, INTERVAL 60 DAY)
    )
  GROUP BY c.id, c.customer_number, c.first_name, c.middle_name, c.last_name,
           b.name, p.name, c.customer_type, c.subscription_status, c.last_payment_date
`;

function monthlyPaymentChurnParams(period) {
  return [
    period.from,
    `${period.to} 23:59:59`,
    period.from,
    `${period.to} 23:59:59`,
    period.from,
    period.from,
    period.to,
    period.to,
    `${period.to} 23:59:59`,
    `${period.to} 23:59:59`,
    period.from,
    period.from,
  ];
}

const CHURN_REASON_LABELS = {
  cancelled: "Cancelled",
  disconnected: "Disconnected",
  unpaid_overdue: "Unpaid (overdue)",
  long_unpaid: "Long unpaid",
};

async function getMonthlyPaymentChurnSummary(month) {
  const period = resolveMonthRange(month);
  const params = monthlyPaymentChurnParams(period);

  const [reasonRows, [totalRow]] = await Promise.all([
    query(
      `SELECT x.churn_reason AS reason,
              COUNT(*) AS count,
              COALESCE(SUM(x.outstanding_balance), 0) AS outstanding
       FROM (${MONTHLY_PAYMENT_CHURN_UNION_SQL}) x
       GROUP BY x.churn_reason
       ORDER BY count DESC`,
      params
    ),
    query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(x.outstanding_balance), 0) AS total_outstanding
       FROM (${MONTHLY_PAYMENT_CHURN_UNION_SQL}) x`,
      params
    ),
  ]);

  const byReasonMap = new Map(
    reasonRows.map((row) => [
      row.reason,
      {
        reason: row.reason,
        label: CHURN_REASON_LABELS[row.reason] || row.reason,
        count: Number(row.count || 0),
        outstanding: Number(row.outstanding || 0),
      },
    ])
  );

  const byReason = Object.keys(CHURN_REASON_LABELS).map((reason) =>
    byReasonMap.get(reason) || {
      reason,
      label: CHURN_REASON_LABELS[reason],
      count: 0,
      outstanding: 0,
    }
  );

  return {
    month: period.month,
    period: { from: period.from, to: period.to },
    total: Number(totalRow?.total || 0),
    totalOutstanding: Number(totalRow?.total_outstanding || 0),
    byReason,
  };
}

async function monthlyPaymentChurn(month) {
  const period = resolveMonthRange(month);
  const headers = [
    { key: "month", label: "Month" },
    { key: "churn_reason", label: "Reason" },
    { key: "cancellation_detail", label: "Cancellation notes" },
    { key: "churned_at", label: "Date" },
    { key: "customer_number", label: "Customer No." },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "package", label: "Package" },
    { key: "customer_type", label: "Type" },
    { key: "subscription_status", label: "Service Status" },
    { key: "onu_collected_at", label: "ONU Collected" },
    { key: "dstv_decoder_collected_at", label: "DSTV Decoder Collected" },
    { key: "last_payment_date", label: "Last Payment" },
    { key: "oldest_overdue_date", label: "Oldest Overdue" },
    { key: "outstanding_balance", label: "Outstanding (KES)" },
  ];

  const rows = await query(
    `SELECT
       ? AS month,
       x.churn_reason,
       x.cancellation_detail,
       x.churned_at,
       x.customer_number,
       x.full_name,
       x.building,
       x.package,
       x.customer_type,
       x.subscription_status,
       x.onu_collected_at,
       x.dstv_decoder_collected_at,
       x.last_payment_date,
       x.oldest_overdue_date,
       x.outstanding_balance
     FROM (${MONTHLY_PAYMENT_CHURN_UNION_SQL}) x
     ORDER BY x.churned_at DESC
     LIMIT 10000`,
    [period.month, ...monthlyPaymentChurnParams(period)]
  );

  const summary = await getMonthlyPaymentChurnSummary(period.month);

  return {
    title: "Monthly Payment Churn",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    period: { from: period.from, to: period.to },
    month: period.month,
    summary: {
      total: summary.total,
      totalLabel: "Total churned",
      totalOutstanding: summary.totalOutstanding,
      byReason: summary.byReason.map((r) => ({
        label: r.label,
        count: r.count,
        outstanding: r.outstanding,
      })),
    },
  };
}

async function paymentFrequencyMix() {
  const headers = [
    { key: "frequency", label: "Billing Frequency" },
    { key: "active_count", label: "Active Subscribers" },
    { key: "share_pct", label: "Share (%)" },
  ];
  const rows = await query(
    `SELECT payment_frequency AS frequency,
      COUNT(*) AS active_count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM customers WHERE status = 'active'), 1) AS share_pct
     FROM customers
     WHERE status = 'active'
     GROUP BY payment_frequency
     ORDER BY active_count DESC`
  );
  return {
    title: "Billing Frequency Mix",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

/**
 * Per-customer DSTV decoder IUC/serial roster.
 * Active DSTV accounts only; Account Status is Active / Suspended / Paused.
 */
async function dstvIucRoster() {
  const headers = [
    { key: "iuc_serial", label: "IUC/Serial Number" },
    { key: "customer_number", label: "Customer No" },
    { key: "building", label: "Building" },
    { key: "account_status", label: "Account Status" },
  ];

  const rows = await query(
    `SELECT c.customer_number,
      b.name AS building,
      c.dstv_decoder_serial AS iuc_serial,
      c.subscription_status
     FROM customers c
     JOIN products p ON p.id = c.product_id
     JOIN buildings b ON b.id = c.building_id
     WHERE p.has_dstv = 1
       AND c.status = 'active'
     ORDER BY
       b.name ASC,
       c.customer_number ASC
     LIMIT 10000`
  );

  let activeCount = 0;
  let suspendedCount = 0;
  let pausedCount = 0;

  const formatted = rows.map((r) => {
    const accountStatus = normalizeSubscriptionStatus(r.subscription_status);

    if (accountStatus === "Active") activeCount += 1;
    else if (accountStatus === "Suspended") suspendedCount += 1;
    else if (accountStatus === "Paused") pausedCount += 1;

    return formatRow(
      {
        iuc_serial: r.iuc_serial || "",
        customer_number: r.customer_number,
        building: r.building,
        account_status: accountStatus,
      },
      headers
    );
  });

  return {
    title: "DSTV IUC / Serial Roster",
    headers,
    rows: formatted,
    summary: {
      total: formatted.length,
      totalLabel: "Total DSTV customers",
      lines: [
        { label: "Active", value: activeCount },
        { label: "Suspended", value: suspendedCount },
        { label: "Paused", value: pausedCount },
      ],
    },
  };
}

async function upcomingInvoicesReport() {
  const { getUpcomingInvoiceForecast } = require("./billingForecastStore");
  const forecast = await getUpcomingInvoiceForecast({ days: 7 });
  const headers = [
    { key: "scheduled_date", label: "Scheduled Date" },
    { key: "customer_number", label: "Customer No." },
    { key: "customer_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "expected_amount", label: "Expected (KES)" },
    { key: "frequency", label: "Frequency" },
    { key: "source", label: "Source" },
  ];
  const rows = forecast.items.map((item) => ({
    scheduled_date: item.scheduledDate,
    customer_number: item.customerNumber,
    customer_name: item.customerName,
    building: item.buildingName || "",
    expected_amount: item.expectedAmount,
    frequency: item.paymentFrequency,
    source: item.source === "trial" ? "Trial first invoice" : "Recurring",
  }));
  return {
    title: "Upcoming Invoices (Next 7 Days)",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: forecast.invoiceCount,
      totalLabel: "Total invoices",
      totalOutstanding: forecast.anticipatedAmount,
    },
    period: { from: forecast.windowStart, to: forecast.windowEnd },
  };
}

async function billingReconciliationReport() {
  const reconciliationStore = require("./reconciliationStore");
  const result = await reconciliationStore.listCustomers({ page: 1, limit: 10000 });
  const headers = [
    { key: "customer_number", label: "Customer No." },
    { key: "customer_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "primary_status", label: "Status" },
    { key: "outstanding", label: "Outstanding (KES)" },
    { key: "expected", label: "Expected (KES)" },
    { key: "service_status", label: "Service" },
    { key: "recommendations", label: "Recommended Actions" },
  ];
  const rows = result.data.map((row) => ({
    customer_number: row.customerNumber,
    customer_name: row.customerName,
    building: row.buildingName,
    primary_status: row.primaryStatus,
    outstanding: row.metrics?.outstandingBalance ?? 0,
    expected: row.metrics?.expectedAmount ?? 0,
    service_status: row.metrics?.subscriptionStatus ?? "",
    recommendations: (row.recommendations || []).map((r) => r.label).join("; "),
  }));
  return {
    title: "Billing Reconciliation Exceptions",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

/** Raised Zoho invoices only: real Zoho invoice_id, not draft/void. */
function raisedZohoInvoiceSql(alias = "zi") {
  const p = alias ? `${alias}.` : "";
  return `
  ${p}invoice_id IS NOT NULL
  AND TRIM(${p}invoice_id) <> ''
  AND LOWER(TRIM(COALESCE(${p}status, ''))) <> 'draft'
  AND LOWER(TRIM(COALESCE(${p}status, ''))) NOT LIKE '%void%'
`;
}

/**
 * B2B agency payments/invoices are snapshotted onto every managed house.
 * Deduplicate by Zoho id so each Books document counts once.
 * Prefer a C2B row when both exist (correct agency attribution); otherwise MIN(id).
 * (Avoid GROUP_CONCAT — it truncates and is slow on large B2B fan-out.)
 */
const DEDUPED_INVOICE_IDS_SQL = `
  SELECT zi2.invoice_id,
         COALESCE(
           MIN(CASE WHEN c2.customer_type = 'C2B' THEN zi2.id END),
           MIN(zi2.id)
         ) AS keep_id
  FROM zoho_customer_invoices zi2
  JOIN customers c2 ON c2.id = zi2.customer_id
  WHERE zi2.invoice_date >= ? AND zi2.invoice_date <= ?
    AND ${raisedZohoInvoiceSql("zi2")}
  GROUP BY zi2.invoice_id
`;

const DEDUPED_PAYMENT_IDS_SQL = `
  SELECT zp2.payment_id,
         COALESCE(
           MIN(CASE WHEN c2.customer_type = 'C2B' THEN zp2.id END),
           MIN(zp2.id)
         ) AS keep_id
  FROM zoho_customer_payments zp2
  JOIN customers c2 ON c2.id = zp2.customer_id
  WHERE zp2.payment_date >= ? AND zp2.payment_date <= ?
    AND zp2.payment_id IS NOT NULL
    AND TRIM(zp2.payment_id) <> ''
  GROUP BY zp2.payment_id
`;

/** Totals-only: same amounts as C2B-preferring dedupe, no customers join. */
const FAST_DEDUPED_INVOICE_IDS_SQL = `
  SELECT invoice_id, MIN(id) AS keep_id
  FROM zoho_customer_invoices
  WHERE invoice_date >= ? AND invoice_date <= ?
    AND ${raisedZohoInvoiceSql("")}
  GROUP BY invoice_id
`;

const FAST_DEDUPED_PAYMENT_IDS_SQL = `
  SELECT payment_id, MIN(id) AS keep_id
  FROM zoho_customer_payments
  WHERE payment_date >= ? AND payment_date <= ?
    AND payment_id IS NOT NULL
    AND TRIM(payment_id) <> ''
  GROUP BY payment_id
`;

async function getInvoicesVsPaymentsSummary(month) {
  const period = resolveMonthRange(month);

  const [[invoiceRow], [paymentRow]] = await Promise.all([
    query(
      `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(zi.total), 0) AS invoice_total,
              COALESCE(SUM(GREATEST(COALESCE(zi.balance_due, 0), 0)), 0) AS outstanding_total
       FROM zoho_customer_invoices zi
       INNER JOIN (${FAST_DEDUPED_INVOICE_IDS_SQL}) d ON d.keep_id = zi.id`,
      [period.from, period.to]
    ),
    query(
      `SELECT COUNT(*) AS payment_count,
              COALESCE(SUM(zp.amount), 0) AS payment_total
       FROM zoho_customer_payments zp
       INNER JOIN (${FAST_DEDUPED_PAYMENT_IDS_SQL}) d ON d.keep_id = zp.id`,
      [period.from, period.to]
    ),
  ]);

  const invoiceCount = Number(invoiceRow?.invoice_count || 0);
  const invoiceTotal = Number(invoiceRow?.invoice_total || 0);
  const outstandingTotal = Number(invoiceRow?.outstanding_total || 0);
  const paymentCount = Number(paymentRow?.payment_count || 0);
  const paymentTotal = Number(paymentRow?.payment_total || 0);

  return {
    month: period.month,
    period: { from: period.from, to: period.to },
    invoiceCount,
    invoiceTotal,
    outstandingTotal,
    paymentCount,
    paymentTotal,
    net: paymentTotal - invoiceTotal,
    source: "zoho_books_synced",
  };
}

async function loadInvoicesVsPaymentsData(month) {
  const period = resolveMonthRange(month);
  const summary = await getInvoicesVsPaymentsSummary(period.month);

  const [invoiceRows, paymentRows] = await Promise.all([
    query(
      `SELECT
         zi.invoice_date AS record_date,
         zi.invoice_number AS document_number,
         CASE
           WHEN c.customer_type = 'B2B' THEN COALESCE(a.name, c.customer_number)
           ELSE c.customer_number
         END AS customer_number,
         CASE
           WHEN c.customer_type = 'B2B' THEN COALESCE(a.name, 'Agency')
           ELSE TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name))
         END AS full_name,
         CASE
           WHEN c.customer_type = 'B2B' THEN 'Agency billing'
           ELSE b.name
         END AS building,
         COALESCE(zi.total, 0) AS amount,
         zi.status AS status,
         COALESCE(zi.balance_due, 0) AS balance_due
       FROM zoho_customer_invoices zi
       INNER JOIN (${DEDUPED_INVOICE_IDS_SQL}) d ON d.keep_id = zi.id
       JOIN customers c ON c.id = zi.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id
       LEFT JOIN buildings b ON b.id = c.building_id
       ORDER BY zi.invoice_date ASC, zi.invoice_number ASC
       LIMIT 20000`,
      [period.from, period.to]
    ),
    query(
      `SELECT
         zp.payment_date AS record_date,
         COALESCE(zp.reference_number, zp.payment_id) AS document_number,
         CASE
           WHEN c.customer_type = 'B2B' THEN COALESCE(a.name, c.customer_number)
           ELSE c.customer_number
         END AS customer_number,
         CASE
           WHEN c.customer_type = 'B2B' THEN COALESCE(a.name, 'Agency')
           ELSE TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name))
         END AS full_name,
         CASE
           WHEN c.customer_type = 'B2B' THEN 'Agency billing'
           ELSE b.name
         END AS building,
         COALESCE(zp.amount, 0) AS amount,
         COALESCE(zp.invoice_number, '') AS related_invoice
       FROM zoho_customer_payments zp
       INNER JOIN (${DEDUPED_PAYMENT_IDS_SQL}) d ON d.keep_id = zp.id
       JOIN customers c ON c.id = zp.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id
       LEFT JOIN buildings b ON b.id = c.building_id
       ORDER BY zp.payment_date ASC, zp.reference_number ASC
       LIMIT 20000`,
      [period.from, period.to]
    ),
  ]);

  return {
    period,
    summary,
    invoiceRows,
    paymentRows,
  };
}

async function invoicesVsPayments(month) {
  const { period, summary, invoiceRows, paymentRows } =
    await loadInvoicesVsPaymentsData(month);

  const invoiceHeaders = [
    { key: "record_date", label: "Date" },
    { key: "document_number", label: "Invoice No." },
    { key: "customer_number", label: "Customer / Agency" },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "amount", label: "Amount (KES)" },
    { key: "status", label: "Status" },
    { key: "balance_due", label: "Balance Due (KES)" },
  ];

  const paymentHeaders = [
    { key: "record_date", label: "Date" },
    { key: "document_number", label: "Payment Ref." },
    { key: "customer_number", label: "Customer / Agency" },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "amount", label: "Amount (KES)" },
    { key: "related_invoice", label: "Related Invoice" },
  ];

  const netLabel =
    summary.net >= 0 ? "Payments exceed invoices (KES)" : "Invoices exceed payments (KES)";

  return {
    title: "Invoices vs Payments (Zoho Books)",
    headers: invoiceHeaders,
    rows: [],
    period: { from: period.from, to: period.to },
    month: period.month,
    sections: [
      {
        title: "1. Invoices raised",
        headers: invoiceHeaders,
        rows: invoiceRows.map((r) => formatRow(r, invoiceHeaders)),
        totals: {
          countLabel: "Invoice count",
          count: summary.invoiceCount,
          label: "Invoice total (KES)",
          value: summary.invoiceTotal,
          lines: [
            {
              label: "Outstanding on these invoices (KES)",
              value: summary.outstandingTotal,
            },
          ],
        },
      },
      {
        title: "2. Payments received",
        headers: paymentHeaders,
        rows: paymentRows.map((r) => formatRow(r, paymentHeaders)),
        totals: {
          countLabel: "Payment count",
          count: summary.paymentCount,
          label: "Payment total (KES)",
          value: summary.paymentTotal,
        },
      },
    ],
    summary: {
      total: summary.invoiceCount + summary.paymentCount,
      totalLabel: "Total records",
      lines: [
        { label: "Source", value: "Zoho Books (synced)" },
        { label: "Invoice count", value: summary.invoiceCount },
        { label: "Invoice total (KES)", value: summary.invoiceTotal },
        { label: "Payment count", value: summary.paymentCount },
        { label: "Payment total (KES)", value: summary.paymentTotal },
        { label: netLabel, value: Math.abs(summary.net) },
      ],
    },
  };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function monthKeyFromDate(value) {
  const d = dateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d.slice(5, 7);
}

/** Month key for matrix invoices: month the invoice was raised. */
function invoiceRaiseDate(row) {
  return row?.invoice_date || null;
}

function emptyMonthBucket() {
  return {
    invoiceAmount: 0,
    invoiceDate: "",
    paymentAmount: 0,
    paymentDate: "",
  };
}

/** True when year-month is the current calendar month or later. */
function isOpenOrFutureYearMonth(year, monthNum, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return Number(year) > y || (Number(year) === y && Number(monthNum) >= m);
}

function daysInMonth(year, monthNum) {
  return new Date(Number(year), Number(monthNum), 0).getDate();
}

function recurringMonthStep(frequency, customPeriodDays) {
  const freq = String(frequency || "monthly").toLowerCase();
  if (freq === "quarterly") return 3;
  if (freq === "yearly") return 12;
  if (freq === "custom") {
    const days = Math.max(Number(customPeriodDays) || 30, 1);
    return Math.max(1, Math.round(days / 30));
  }
  return 1;
}

/**
 * Project recurring invoice dates across a year month span from next_invoice_date.
 * @returns {Map<string, string>} month key "MM" → YYYY-MM-DD
 */
function projectRecurringDatesInSpan(
  nextInvoiceDate,
  year,
  monthFrom,
  monthTo,
  frequency,
  customPeriodDays
) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const start = dateOnly(nextInvoiceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return out;

  const step = recurringMonthStep(frequency, customPeriodDays);
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const dayOfMonth = Number(start.slice(8, 10));
  const periodStart = `${year}-${String(monthFrom).padStart(2, "0")}-01`;
  const periodEnd = `${year}-${String(monthTo).padStart(2, "0")}-${String(
    daysInMonth(year, monthTo)
  ).padStart(2, "0")}`;

  let guard = 0;
  // Walk forward from next_invoice_date until we enter / pass the selected span.
  while (guard < 240) {
    const dim = daysInMonth(y, m);
    const d = Math.min(dayOfMonth, dim);
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (dateStr > periodEnd) break;
    if (dateStr >= periodStart && y === Number(year) && m >= monthFrom && m <= monthTo) {
      const mm = String(m).padStart(2, "0");
      if (!out.has(mm)) out.set(mm, dateStr);
    }
    m += step;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

function isUsableRecurringForProjection(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  // Keep stopped/paused — Zoho still has a profile and next_invoice_date.
  if (s.includes("expire") || s.includes("deleted") || s.includes("void")) return false;
  return true;
}

/** Active B2B managed houses keyed by agency_id for consolidated document splits. */
async function loadAgencyPeerIndex() {
  const rows = await query(
    `SELECT c.id,
            c.customer_number,
            c.customer_type,
            c.agency_id,
            COALESCE(c.package_price, 0) AS package_price,
            a.discount_percent
     FROM customers c
     LEFT JOIN agencies a ON a.id = c.agency_id
     WHERE c.customer_type = 'B2B'
       AND c.agency_id IS NOT NULL
       AND c.status = 'active'
     ORDER BY c.agency_id ASC, c.customer_number ASC
     LIMIT 20000`
  );
  /** @type {Map<number, any[]>} */
  const byAgency = new Map();
  /** @type {Map<number, any>} */
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.id);
    const agencyId = Number(row.agency_id);
    byId.set(id, row);
    if (!byAgency.has(agencyId)) byAgency.set(agencyId, []);
    byAgency.get(agencyId).push(row);
  }
  return { byAgency, byId };
}

/**
 * Customer × month matrix: invoice amount/date and payment amount/date for selected months of a year.
 * Invoices are bucketed by invoice_date (month raised).
 * Consolidated B2B agency documents are split across each managed house.
 */
async function customerMonthlyBillingMatrix(year, { monthFrom, monthTo } = {}) {
  const period = resolveYearMonthSpan(year, monthFrom, monthTo);
  const selectedMonths = [];
  for (let m = period.monthFrom; m <= period.monthTo; m += 1) {
    selectedMonths.push(m);
  }
  const spanLabel = formatMonthSpanLabel(period.monthFrom, period.monthTo);

  // Prefer active customers; also include inactive with activity in-year via UNION
  // of lean id lists (avoids expensive OR + DISTINCT subqueries on large tables).
  const [
    activeCustomers,
    invoiceActivityIds,
    paymentActivityIds,
    agencyPeerIndex,
    recurringRows,
    lastInvoiceRows,
  ] = await Promise.all([
      query(
        `SELECT c.id,
                c.customer_number,
                c.customer_type,
                c.status,
                c.agency_id,
                c.payment_frequency,
                c.custom_period_days,
                COALESCE(c.package_price, 0) AS package_price,
                TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS full_name,
                b.name AS building,
                a.name AS agency_name,
                a.discount_percent,
                zc.zoho_contact_id
         FROM customers c
         LEFT JOIN buildings b ON b.id = c.building_id
         LEFT JOIN agencies a ON a.id = c.agency_id
         LEFT JOIN zoho_customer_contacts zc ON zc.customer_id = c.id
         WHERE c.status = 'active'
         ORDER BY c.customer_number ASC
         LIMIT 15000`
      ),
      query(
        `SELECT DISTINCT zi.customer_id AS id
         FROM zoho_customer_invoices zi
         WHERE zi.invoice_date >= ? AND zi.invoice_date <= ?
           AND ${raisedZohoInvoiceSql("zi")}
         LIMIT 20000`,
        [period.from, period.to]
      ),
      query(
        `SELECT DISTINCT zp.customer_id AS id
         FROM zoho_customer_payments zp
         WHERE zp.payment_date >= ? AND zp.payment_date <= ?
           AND zp.payment_id IS NOT NULL AND TRIM(zp.payment_id) <> ''
         LIMIT 20000`,
        [period.from, period.to]
      ),
      loadAgencyPeerIndex(),
      query(
        `SELECT zri.customer_id,
                zri.status,
                zri.next_invoice_date,
                zc.zoho_contact_id
         FROM zoho_recurring_invoices zri
         LEFT JOIN zoho_customer_contacts zc ON zc.customer_id = zri.customer_id
         WHERE zri.recurring_invoice_id IS NOT NULL
           AND TRIM(zri.recurring_invoice_id) <> ''
         ORDER BY zri.next_invoice_date ASC
         LIMIT 30000`
      ),
      query(
        `SELECT zi.customer_id,
                MAX(zi.invoice_date) AS last_invoice_date
         FROM zoho_customer_invoices zi
         WHERE ${raisedZohoInvoiceSql("zi")}
         GROUP BY zi.customer_id
         LIMIT 30000`
      ),
    ]);

  /** @type {Map<number, { nextInvoiceDate: string, status: string }>} */
  const recurringByCustomer = new Map();
  /** @type {Map<string, { nextInvoiceDate: string, status: string }>} */
  const recurringByContact = new Map();
  for (const row of recurringRows) {
    if (!isUsableRecurringForProjection(row.status)) continue;
    const next = dateOnly(row.next_invoice_date);
    if (!next) continue;
    const entry = {
      nextInvoiceDate: next,
      status: row.status || "active",
    };
    const id = Number(row.customer_id);
    if (Number.isFinite(id) && id > 0) {
      const existing = recurringByCustomer.get(id);
      // Prefer active profiles, then earliest next date.
      const prefer =
        !existing ||
        (String(entry.status).toLowerCase().includes("active") &&
          !String(existing.status).toLowerCase().includes("active")) ||
        (next && (!existing.nextInvoiceDate || next < existing.nextInvoiceDate));
      if (prefer) recurringByCustomer.set(id, entry);
    }
    const contactId = row.zoho_contact_id ? String(row.zoho_contact_id) : "";
    if (contactId) {
      const existing = recurringByContact.get(contactId);
      const prefer =
        !existing ||
        (String(entry.status).toLowerCase().includes("active") &&
          !String(existing.status).toLowerCase().includes("active")) ||
        (next && (!existing.nextInvoiceDate || next < existing.nextInvoiceDate));
      if (prefer) recurringByContact.set(contactId, entry);
    }
  }

  /** @type {Map<number, string>} */
  const lastInvoiceByCustomer = new Map();
  for (const row of lastInvoiceRows) {
    const id = Number(row.customer_id);
    const d = dateOnly(row.last_invoice_date);
    if (Number.isFinite(id) && id > 0 && d) lastInvoiceByCustomer.set(id, d);
  }

  const customerById = new Map(activeCustomers.map((c) => [Number(c.id), c]));
  for (const [id, peer] of agencyPeerIndex.byId) {
    if (!customerById.has(id)) customerById.set(id, peer);
  }

  const missingIds = [
    ...new Set([
      ...invoiceActivityIds.map((r) => Number(r.id)),
      ...paymentActivityIds.map((r) => Number(r.id)),
    ]),
  ].filter((id) => Number.isFinite(id) && id > 0 && !customerById.has(id));

  if (missingIds.length) {
    const placeholders = missingIds.map(() => "?").join(",");
    const extras = await query(
      `SELECT c.id,
              c.customer_number,
              c.customer_type,
              c.status,
              c.agency_id,
              c.payment_frequency,
              c.custom_period_days,
              COALESCE(c.package_price, 0) AS package_price,
              TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS full_name,
              b.name AS building,
              a.name AS agency_name,
              a.discount_percent,
              zc.zoho_contact_id
       FROM customers c
       LEFT JOIN buildings b ON b.id = c.building_id
       LEFT JOIN agencies a ON a.id = c.agency_id
       LEFT JOIN zoho_customer_contacts zc ON zc.customer_id = c.id
       WHERE c.id IN (${placeholders})
       ORDER BY c.customer_number ASC`,
      missingIds
    );
    for (const c of extras) customerById.set(Number(c.id), c);
  }

  const customers = [...customerById.values()].sort((a, b) =>
    String(a.customer_number).localeCompare(String(b.customer_number))
  );

  // SQL-deduped documents only — amounts are then split across B2B managed houses.
  const [invoiceRows, paymentRows] = await Promise.all([
    query(
      `SELECT zi.id,
              zi.customer_id,
              zi.invoice_id,
              zi.invoice_number,
              zi.invoice_date,
              zi.due_date,
              zi.raw_json,
              COALESCE(zi.total, 0) AS amount,
              c.customer_number,
              c.customer_type,
              c.agency_id,
              COALESCE(c.package_price, 0) AS package_price,
              a.discount_percent
       FROM zoho_customer_invoices zi
       INNER JOIN (${DEDUPED_INVOICE_IDS_SQL}) d ON d.keep_id = zi.id
       JOIN customers c ON c.id = zi.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id`,
      [period.from, period.to]
    ),
    query(
      `SELECT zp.id,
              zp.customer_id,
              zp.payment_id,
              zp.reference_number,
              zp.invoice_number AS related_invoice,
              zp.payment_date,
              zp.raw_json,
              COALESCE(zp.amount, 0) AS amount,
              c.customer_number,
              c.customer_type,
              c.agency_id,
              COALESCE(c.package_price, 0) AS package_price,
              a.discount_percent
       FROM zoho_customer_payments zp
       INNER JOIN (${DEDUPED_PAYMENT_IDS_SQL}) d ON d.keep_id = zp.id
       JOIN customers c ON c.id = zp.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id`,
      [period.from, period.to]
    ),
  ]);

  /** @type {Map<number, Record<string, ReturnType<typeof emptyMonthBucket>>>} */
  const byCustomer = new Map();
  for (const c of customers) {
    const months = {};
    for (const m of selectedMonths) {
      months[String(m).padStart(2, "0")] = emptyMonthBucket();
    }
    byCustomer.set(Number(c.id), months);
  }

  function ensureCustomerMonths(customerId) {
    const id = Number(customerId);
    if (byCustomer.has(id)) return byCustomer.get(id);
    const months = {};
    for (const m of selectedMonths) {
      months[String(m).padStart(2, "0")] = emptyMonthBucket();
    }
    byCustomer.set(id, months);
    return months;
  }

  const selectedMonthKeys = new Set(selectedMonths.map((m) => String(m).padStart(2, "0")));

  for (const row of invoiceRows) {
    const month = monthKeyFromDate(invoiceRaiseDate(row));
    if (!month || !selectedMonthKeys.has(month)) continue;
    const keepCustomer = {
      id: Number(row.customer_id),
      customer_number: row.customer_number,
      customer_type: row.customer_type,
      agency_id: row.agency_id,
      package_price: row.package_price,
      discount_percent: row.discount_percent,
    };
    const shares = attributeDocumentAmount({
      amount: row.amount,
      rawJson: row.raw_json,
      keepCustomer,
      agencyPeers: agencyPeerIndex.byAgency.get(Number(row.agency_id)) || [keepCustomer],
    });
    const d = dateOnly(row.invoice_date);
    for (const share of shares) {
      const bucket = ensureCustomerMonths(share.customerId)[month];
      bucket.invoiceAmount += Number(share.amount) || 0;
      if (!bucket.invoiceDate || d < bucket.invoiceDate) bucket.invoiceDate = d;
    }
  }

  for (const row of paymentRows) {
    const month = monthKeyFromDate(row.payment_date);
    if (!month || !selectedMonthKeys.has(month)) continue;
    const keepCustomer = {
      id: Number(row.customer_id),
      customer_number: row.customer_number,
      customer_type: row.customer_type,
      agency_id: row.agency_id,
      package_price: row.package_price,
      discount_percent: row.discount_percent,
    };
    const shares = attributeDocumentAmount({
      amount: row.amount,
      rawJson: row.raw_json,
      keepCustomer,
      agencyPeers: agencyPeerIndex.byAgency.get(Number(row.agency_id)) || [keepCustomer],
    });
    const d = dateOnly(row.payment_date);
    for (const share of shares) {
      const bucket = ensureCustomerMonths(share.customerId)[month];
      bucket.paymentAmount += Number(share.amount) || 0;
      if (!bucket.paymentDate || d < bucket.paymentDate) bucket.paymentDate = d;
    }
  }

  const matrixGroups = selectedMonths.map((monthNum) => {
    const mm = String(monthNum).padStart(2, "0");
    return {
      label: MONTH_NAMES[monthNum - 1],
      columns: [
        { key: `m${mm}_invoice_amount`, label: "Invoice Amount" },
        { key: `m${mm}_invoice_date`, label: "Invoice Date" },
        { key: `m${mm}_payment_amount`, label: "Payment Amount" },
        { key: `m${mm}_payment_date`, label: "Payment Date" },
      ],
    };
  });

  const flatHeaders = [
    { key: "customer", label: "Customer" },
    ...matrixGroups.flatMap((g) => g.columns),
  ];

  const matrixRows = [];
  /** @type {Map<number, Map<string, string>|null>} */
  const projectedByCustomer = new Map();
  let yearProjectedInvoiceTotal = 0;
  for (const c of customers) {
    const months = byCustomer.get(Number(c.id)) || {};
    const hasActivity = Object.values(months).some(
      (m) => m.invoiceAmount > 0 || m.paymentAmount > 0
    );
    if (String(c.status).toLowerCase() !== "active" && !hasActivity) continue;

    const row = {
      customer: c.customer_number,
      customer_name: c.full_name || "",
      building: c.building || "",
      customer_type: c.customer_type || "",
    };

    for (const m of selectedMonths) {
      const mm = String(m).padStart(2, "0");
      const bucket = months[mm] || emptyMonthBucket();
      let invoiceAmount =
        bucket.invoiceAmount > 0 ? Math.round(bucket.invoiceAmount * 100) / 100 : "";
      let invoiceDate = bucket.invoiceDate || "";
      let amountIsProjected = false;

      if (!projectedByCustomer.has(Number(c.id))) {
        const byId = recurringByCustomer.get(Number(c.id));
        const contactId = c.zoho_contact_id ? String(c.zoho_contact_id) : "";
        const byContact = contactId ? recurringByContact.get(contactId) : null;
        const scheduleStart =
          byId?.nextInvoiceDate ||
          byContact?.nextInvoiceDate ||
          lastInvoiceByCustomer.get(Number(c.id)) ||
          "";
        projectedByCustomer.set(
          Number(c.id),
          scheduleStart
            ? projectRecurringDatesInSpan(
                scheduleStart,
                period.year,
                period.monthFrom,
                period.monthTo,
                c.payment_frequency,
                c.custom_period_days
              )
            : null
        );
      }
      const projected = projectedByCustomer.get(Number(c.id));
      const expectedUnit = unitWeight({
        package_price: c.package_price,
        discount_percent:
          String(c.customer_type || "").toUpperCase() === "B2B" ? c.discount_percent : null,
      });
      const scheduledDate = projected?.get(mm) || "";
      if (scheduledDate && expectedUnit > 0) {
        yearProjectedInvoiceTotal += expectedUnit;
      }

      // No raised invoice: show scheduled expected date/amount for any selected month
      // (including past months — what was projected before the month closed).
      if (!invoiceDate && !(Number(invoiceAmount) > 0)) {
        if (projected) {
          invoiceDate = scheduledDate;
          if (invoiceDate && expectedUnit > 0) {
            invoiceAmount = Math.round(expectedUnit * 100) / 100;
            amountIsProjected = true;
          }
        } else {
          invoiceDate = "No recurring";
        }
      }

      row[`m${mm}_invoice_amount`] = invoiceAmount;
      row[`m${mm}_invoice_date`] = invoiceDate;
      row[`m${mm}_invoice_projected`] = amountIsProjected ? 1 : "";
      row[`m${mm}_payment_amount`] =
        bucket.paymentAmount > 0 ? Math.round(bucket.paymentAmount * 100) / 100 : "";
      row[`m${mm}_payment_date`] = bucket.paymentDate || "";
    }

    matrixRows.push(row);
  }

  let yearInvoiceTotal = 0;
  let yearPaymentTotal = 0;
  for (const row of matrixRows) {
    for (const m of selectedMonths) {
      const mm = String(m).padStart(2, "0");
      if (!row[`m${mm}_invoice_projected`]) {
        yearInvoiceTotal += Number(row[`m${mm}_invoice_amount`]) || 0;
      }
      yearPaymentTotal += Number(row[`m${mm}_payment_amount`]) || 0;
    }
  }
  yearProjectedInvoiceTotal = Math.round(yearProjectedInvoiceTotal * 100) / 100;

  // Sort by invoice date (earliest dated cell in the selected span); "No recurring" / blank last.
  matrixRows.sort((a, b) => {
    const rank = (row) => {
      let earliest = null;
      let onlyNoRecurring = true;
      let hasAnyDateCell = false;
      for (const m of selectedMonths) {
        const mm = String(m).padStart(2, "0");
        const d = String(row[`m${mm}_invoice_date`] || "").trim();
        if (!d) continue;
        hasAnyDateCell = true;
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          onlyNoRecurring = false;
          if (!earliest || d < earliest) earliest = d;
        } else if (d !== "No recurring") {
          onlyNoRecurring = false;
        }
      }
      if (earliest) return { bucket: 0, date: earliest };
      if (hasAnyDateCell && onlyNoRecurring) return { bucket: 2, date: "9999-99-99" };
      return { bucket: 1, date: "9999-99-98" }; // blank / other — above No recurring
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra.bucket !== rb.bucket) return ra.bucket - rb.bucket;
    if (ra.date !== rb.date) return ra.date < rb.date ? -1 : 1;
    return String(a.customer || "").localeCompare(String(b.customer || ""));
  });

  return {
    title: `Customer Monthly Billing Matrix (${period.year} · ${spanLabel})`,
    headers: flatHeaders,
    rows: matrixRows.map((r) => formatRow(r, flatHeaders)),
    period: { from: period.from, to: period.to },
    year: period.year,
    monthFrom: period.monthFrom,
    monthTo: period.monthTo,
    matrix: {
      rowHeaderLabel: "Customer",
      rowHeaderKey: "customer",
      groups: matrixGroups,
    },
    summary: {
      total: matrixRows.length,
      totalLabel: "Customers",
      lines: [
        { label: "Year", value: period.year },
        { label: "Months", value: spanLabel },
        {
          label: "Projected invoice total (KES)",
          value: Math.round(yearProjectedInvoiceTotal * 100) / 100,
        },
        { label: "Invoiced total (KES)", value: Math.round(yearInvoiceTotal * 100) / 100 },
        { label: "Payments collected (KES)", value: Math.round(yearPaymentTotal * 100) / 100 },
      ],
    },
  };
}

/**
 * Per-customer expected vs invoiced vs collected for a month.
 * Consolidated B2B documents are split so unit-level gaps are visible.
 */
async function collectionGapByCustomer(month) {
  const period = resolveMonthRange(month);
  const [customers, agencyPeerIndex, invoiceRows, paymentRows] = await Promise.all([
    query(
      `SELECT c.id,
              c.customer_number,
              c.customer_type,
              c.status,
              c.agency_id,
              c.payment_frequency,
              c.custom_period_days,
              COALESCE(c.package_price, 0) AS package_price,
              TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS full_name,
              b.name AS building,
              a.name AS agency_name,
              a.discount_percent
       FROM customers c
       LEFT JOIN buildings b ON b.id = c.building_id
       LEFT JOIN agencies a ON a.id = c.agency_id
       WHERE c.status = 'active'
       ORDER BY c.customer_number ASC
       LIMIT 15000`
    ),
    loadAgencyPeerIndex(),
    query(
      `SELECT zi.id,
              zi.customer_id,
              zi.invoice_date,
              zi.due_date,
              zi.raw_json,
              COALESCE(zi.total, 0) AS amount,
              c.customer_number,
              c.customer_type,
              c.agency_id,
              COALESCE(c.package_price, 0) AS package_price,
              a.discount_percent
       FROM zoho_customer_invoices zi
       INNER JOIN (${DEDUPED_INVOICE_IDS_SQL}) d ON d.keep_id = zi.id
       JOIN customers c ON c.id = zi.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id`,
      [period.from, period.to]
    ),
    query(
      `SELECT zp.id,
              zp.customer_id,
              zp.payment_date,
              zp.raw_json,
              COALESCE(zp.amount, 0) AS amount,
              c.customer_number,
              c.customer_type,
              c.agency_id,
              COALESCE(c.package_price, 0) AS package_price,
              a.discount_percent
       FROM zoho_customer_payments zp
       INNER JOIN (${DEDUPED_PAYMENT_IDS_SQL}) d ON d.keep_id = zp.id
       JOIN customers c ON c.id = zp.customer_id
       LEFT JOIN agencies a ON a.id = c.agency_id`,
      [period.from, period.to]
    ),
  ]);

  /** @type {Map<number, { expected: number, invoiced: number, collected: number }>} */
  const totals = new Map();
  for (const c of customers) {
    const freq = String(c.payment_frequency || "monthly").toLowerCase();
    let monthly = Number(c.package_price) || 0;
    if (freq === "quarterly") monthly /= 3;
    else if (freq === "yearly") monthly /= 12;
    else if (freq === "custom") {
      const days = Math.max(Number(c.custom_period_days) || 30, 1);
      monthly = (monthly / days) * 30;
    }
    const expected = unitWeight({
      package_price: monthly,
      discount_percent:
        String(c.customer_type || "").toUpperCase() === "B2B" ? c.discount_percent : null,
    });
    totals.set(Number(c.id), {
      expected: Math.round(expected * 100) / 100,
      invoiced: 0,
      collected: 0,
    });
  }

  function ensureTotals(customerId) {
    const id = Number(customerId);
    if (!totals.has(id)) {
      totals.set(id, { expected: 0, invoiced: 0, collected: 0 });
    }
    return totals.get(id);
  }

  for (const row of invoiceRows) {
    const keepCustomer = {
      id: Number(row.customer_id),
      customer_number: row.customer_number,
      customer_type: row.customer_type,
      agency_id: row.agency_id,
      package_price: row.package_price,
      discount_percent: row.discount_percent,
    };
    const shares = attributeDocumentAmount({
      amount: row.amount,
      rawJson: row.raw_json,
      keepCustomer,
      agencyPeers: agencyPeerIndex.byAgency.get(Number(row.agency_id)) || [keepCustomer],
    });
    for (const share of shares) {
      ensureTotals(share.customerId).invoiced += Number(share.amount) || 0;
    }
  }

  for (const row of paymentRows) {
    const keepCustomer = {
      id: Number(row.customer_id),
      customer_number: row.customer_number,
      customer_type: row.customer_type,
      agency_id: row.agency_id,
      package_price: row.package_price,
      discount_percent: row.discount_percent,
    };
    const shares = attributeDocumentAmount({
      amount: row.amount,
      rawJson: row.raw_json,
      keepCustomer,
      agencyPeers: agencyPeerIndex.byAgency.get(Number(row.agency_id)) || [keepCustomer],
    });
    for (const share of shares) {
      ensureTotals(share.customerId).collected += Number(share.amount) || 0;
    }
  }

  const headers = [
    { key: "customer_number", label: "Customer" },
    { key: "customer_name", label: "Name" },
    { key: "customer_type", label: "Type" },
    { key: "agency", label: "Agency" },
    { key: "building", label: "Building" },
    { key: "expected", label: "Expected (KES)" },
    { key: "invoiced", label: "Invoiced share (KES)" },
    { key: "collected", label: "Collected share (KES)" },
    { key: "gap_vs_expected", label: "Gap vs expected (KES)" },
    { key: "gap_vs_invoice", label: "Gap vs invoice (KES)" },
    { key: "collection_status", label: "Status" },
  ];

  const customerById = new Map(customers.map((c) => [Number(c.id), c]));
  for (const [id, peer] of agencyPeerIndex.byId) {
    if (!customerById.has(id)) customerById.set(id, peer);
  }

  const rows = [];
  let sumExpected = 0;
  let sumInvoiced = 0;
  let sumCollected = 0;
  let unpaidCount = 0;
  let unbilledCount = 0;
  let partialCount = 0;
  let collectedCount = 0;

  for (const [id, t] of totals) {
    const c = customerById.get(id);
    if (!c) continue;
    const expected = Math.round((t.expected || 0) * 100) / 100;
    const invoiced = Math.round((t.invoiced || 0) * 100) / 100;
    const collected = Math.round((t.collected || 0) * 100) / 100;
    if (expected <= 0 && invoiced <= 0 && collected <= 0) continue;

    const gapExpected = Math.round((expected - collected) * 100) / 100;
    const gapInvoice = Math.round((invoiced - collected) * 100) / 100;
    let status = "Collected";
    if (invoiced <= 0 && collected <= 0) {
      status = "Unbilled";
      unbilledCount += 1;
    } else if (collected <= 0) {
      status = "Unpaid";
      unpaidCount += 1;
    } else if (expected > 0 && collected + 0.5 < expected * 0.95) {
      status = "Partial";
      partialCount += 1;
    } else if (invoiced > 0 && collected + 0.5 < invoiced * 0.95) {
      status = "Partial";
      partialCount += 1;
    } else {
      collectedCount += 1;
    }

    sumExpected += expected;
    sumInvoiced += invoiced;
    sumCollected += collected;

    rows.push({
      customer_number: c.customer_number,
      customer_name: c.full_name || "",
      customer_type: c.customer_type || "",
      agency: c.agency_name || "",
      building: c.building || "",
      expected,
      invoiced,
      collected,
      gap_vs_expected: gapExpected,
      gap_vs_invoice: gapInvoice,
      collection_status: status,
    });
  }

  rows.sort((a, b) => Number(b.gap_vs_expected) - Number(a.gap_vs_expected));

  const collectionRate =
    sumExpected > 0 ? Math.round((sumCollected / sumExpected) * 1000) / 10 : 0;

  return {
    title: `Collection Gap by Customer (${period.month})`,
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    period: { from: period.from, to: period.to },
    month: period.month,
    summary: {
      total: rows.length,
      totalLabel: "Customers",
      lines: [
        { label: "Month", value: period.month },
        { label: "Expected (KES)", value: Math.round(sumExpected * 100) / 100 },
        { label: "Invoiced share (KES)", value: Math.round(sumInvoiced * 100) / 100 },
        { label: "Collected share (KES)", value: Math.round(sumCollected * 100) / 100 },
        {
          label: "Gap vs expected (KES)",
          value: Math.round((sumExpected - sumCollected) * 100) / 100,
        },
        { label: "Collection rate", value: `${collectionRate}%` },
        { label: "Collected", value: collectedCount },
        { label: "Partial", value: partialCount },
        { label: "Unpaid", value: unpaidCount },
        { label: "Unbilled", value: unbilledCount },
      ],
    },
  };
}

async function businessHealthSummary(from, to) {
  const kpis = await getKpiSnapshot({}, { from, to });
  const expected = await getExpectedCollections({ days: 30 }).catch(() => ({
    expectedCollections: 0,
    invoiceCount: 0,
  }));
  const headers = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
    { key: "unit", label: "Unit" },
  ];
  const rows = [
    { metric: "Active customers", value: kpis.activeCustomers, unit: "count" },
    { metric: "Suspended customers", value: kpis.suspendedCustomers, unit: "count" },
    { metric: "MRR", value: kpis.mrr, unit: "KES" },
    { metric: "ARR", value: kpis.arr, unit: "KES" },
    { metric: "ARPU", value: kpis.arpu, unit: "KES" },
    { metric: "Revenue collected", value: kpis.revenueCollected, unit: "KES" },
    { metric: "Outstanding balance", value: kpis.outstandingBalance, unit: "KES" },
    { metric: "Expected collections (30d)", value: expected.expectedCollections, unit: "KES" },
    { metric: "Collection rate", value: kpis.collectionRate, unit: "%" },
    { metric: "Payment success rate", value: kpis.paymentSuccessRate, unit: "%" },
    { metric: "Churn rate", value: kpis.churnRate, unit: "%" },
    { metric: "New customers", value: kpis.newCustomersThisMonth, unit: "count" },
    { metric: "CLV", value: kpis.clv, unit: "KES" },
    { metric: "Avg days to pay", value: kpis.avgDaysToPay ?? "—", unit: "days" },
  ];
  return {
    title: "Business Health Summary",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.length,
      totalLabel: "Metrics",
      lines: [
        { label: "Period", value: `${from} → ${to}` },
        { label: "Source", value: "kpiEngine" },
      ],
    },
  };
}

async function executiveMonthlyReport(month) {
  const period = resolveMonthRange(month);
  return businessHealthSummary(period.from, period.to);
}

async function outstandingInvoicesReport() {
  const headers = [
    { key: "invoice_number", label: "Invoice #" },
    { key: "customer_number", label: "Customer #" },
    { key: "invoice_date", label: "Invoice date" },
    { key: "due_date", label: "Due date" },
    { key: "total", label: "Total" },
    { key: "balance_due", label: "Balance due" },
    { key: "status", label: "Status" },
  ];
  const rows = await query(
    `SELECT zi.invoice_number, c.customer_number, zi.invoice_date, zi.due_date,
            COALESCE(zi.total, 0) AS total, COALESCE(zi.balance_due, 0) AS balance_due, zi.status
     FROM zoho_customer_invoices zi
     JOIN customers c ON c.id = zi.customer_id
     WHERE COALESCE(zi.balance_due, 0) > 0
       AND zi.invoice_id IS NOT NULL AND TRIM(zi.invoice_id) <> ''
       AND LOWER(TRIM(COALESCE(zi.status, ''))) <> 'draft'
       AND LOWER(TRIM(COALESCE(zi.status, ''))) NOT LIKE '%void%'
     ORDER BY zi.due_date ASC, zi.balance_due DESC
     LIMIT 20000`
  );
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.balance_due || 0), 0);
  return {
    title: "Outstanding Invoices",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.length,
      totalLabel: "Invoices",
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    },
  };
}

async function arAgingReport() {
  const headers = [
    { key: "bucket", label: "Aging bucket" },
    { key: "invoice_count", label: "Invoices" },
    { key: "balance", label: "Balance due (KES)" },
  ];
  const rows = await query(
    `SELECT
       CASE
         WHEN DATEDIFF(CURDATE(), COALESCE(zi.due_date, zi.invoice_date)) <= 30 THEN '0-30'
         WHEN DATEDIFF(CURDATE(), COALESCE(zi.due_date, zi.invoice_date)) <= 60 THEN '31-60'
         WHEN DATEDIFF(CURDATE(), COALESCE(zi.due_date, zi.invoice_date)) <= 90 THEN '61-90'
         ELSE '90+'
       END AS bucket,
       COUNT(*) AS invoice_count,
       COALESCE(SUM(zi.balance_due), 0) AS balance
     FROM zoho_customer_invoices zi
     WHERE COALESCE(zi.balance_due, 0) > 0
       AND zi.invoice_id IS NOT NULL AND TRIM(zi.invoice_id) <> ''
     GROUP BY bucket
     ORDER BY FIELD(bucket, '0-30', '31-60', '61-90', '90+')`
  ).catch(() => []);
  return {
    title: "Accounts Receivable Aging",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.reduce((s, r) => s + Number(r.invoice_count || 0), 0),
      totalOutstanding: rows.reduce((s, r) => s + Number(r.balance || 0), 0),
    },
  };
}

async function collectionsSummaryReport(from, to) {
  const headers = [
    { key: "day", label: "Date" },
    { key: "success_count", label: "Successful payments" },
    { key: "amount", label: "Collected (KES)" },
  ];
  const { clause, params } = dateWhere("pt.created_at", from, to);
  const rows = await query(
    `SELECT DATE(pt.created_at) AS day,
            SUM(CASE WHEN pt.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
            COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS amount
     FROM payment_transactions pt
     ${clause}
     GROUP BY DATE(pt.created_at)
     ORDER BY day ASC`,
    params
  );
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    title: "Collections Summary",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: { total: rows.length, totalAmount: Math.round(totalAmount * 100) / 100 },
  };
}

async function revenueByPackageReport(from, to) {
  const headers = [
    { key: "package_name", label: "Package" },
    { key: "payers", label: "Paying customers" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const { clause, params } = dateWhere("pt.created_at", from, to);
  const rows = await query(
    `SELECT COALESCE(p.name, 'Unknown') AS package_name,
            COUNT(DISTINCT pt.account_reference) AS payers,
            COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions pt
     JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
     LEFT JOIN products p ON p.id = c.product_id
     ${clause} AND pt.status = 'SUCCESS'
     GROUP BY COALESCE(p.name, 'Unknown')
     ORDER BY revenue DESC
     LIMIT 500`,
    params
  );
  return {
    title: "Revenue by Package",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.length,
      totalAmount: rows.reduce((s, r) => s + Number(r.revenue || 0), 0),
    },
  };
}

async function revenueByRegionReport(from, to) {
  const headers = [
    { key: "building", label: "Building / POP" },
    { key: "payers", label: "Paying customers" },
    { key: "revenue", label: "Revenue (KES)" },
  ];
  const { clause, params } = dateWhere("pt.created_at", from, to);
  const rows = await query(
    `SELECT COALESCE(b.name, 'Unassigned') AS building,
            COUNT(DISTINCT pt.account_reference) AS payers,
            COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue
     FROM payment_transactions pt
     JOIN customers c ON UPPER(c.customer_number) = UPPER(pt.account_reference)
     LEFT JOIN buildings b ON b.id = c.building_id
     ${clause} AND pt.status = 'SUCCESS'
     GROUP BY COALESCE(b.name, 'Unassigned')
     ORDER BY revenue DESC
     LIMIT 500`,
    params
  );
  return {
    title: "Revenue by Region",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.length,
      totalAmount: rows.reduce((s, r) => s + Number(r.revenue || 0), 0),
    },
  };
}

async function forecastVsActualRevenue(from, to) {
  const kpis = await getKpiSnapshot({}, { from, to });
  const headers = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value (KES)" },
  ];
  const rows = [
    { metric: "MRR (expected monthly obligation)", value: kpis.mrr },
    { metric: "Collected in period", value: kpis.revenueCollected },
    { metric: "Variance (collected − MRR)", value: kpis.revenueCollected - kpis.mrr },
    { metric: "Collection rate %", value: kpis.collectionRate },
  ];
  return {
    title: "Forecast vs Actual Revenue",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      lines: [
        { label: "Period", value: `${from} → ${to}` },
        { label: "Collection rate", value: `${kpis.collectionRate}%` },
      ],
    },
  };
}

async function suspendedBillingReport() {
  const headers = [
    { key: "customer_number", label: "Customer #" },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "subscription_status", label: "Subscription" },
    { key: "package_price", label: "Package price" },
  ];
  const rows = await query(
    `SELECT c.customer_number,
            TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS full_name,
            b.name AS building,
            c.subscription_status,
            c.package_price
     FROM customers c
     LEFT JOIN buildings b ON b.id = c.building_id
     WHERE c.status = 'active'
       AND (
         LOWER(COALESCE(c.subscription_status, '')) LIKE '%suspend%'
         OR c.subscription_status IS NULL
         OR TRIM(c.subscription_status) = ''
         OR LOWER(TRIM(c.subscription_status)) IN ('unknown', 'not on tisp', 'not_on_tisp')
         OR (
           LOWER(TRIM(c.subscription_status)) <> 'active'
           AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%pause%'
           AND LOWER(COALESCE(c.subscription_status, '')) NOT LIKE '%cancel%'
         )
       )
     ORDER BY c.customer_number ASC
     LIMIT 15000`
  );
  return {
    title: "Suspended Billing",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: { total: rows.length, totalLabel: "Customers" },
  };
}

async function expectedCollectionsReport() {
  const expected = await getExpectedCollections({ days: 30 });
  const forecast = expected.forecast || {};
  const items = forecast.items || forecast.invoices || forecast.rows || [];
  const headers = [
    { key: "customer_number", label: "Customer #" },
    { key: "next_invoice_date", label: "Next invoice" },
    { key: "amount", label: "Expected amount" },
  ];
  const rows = Array.isArray(items)
    ? items.slice(0, 5000).map((i) => ({
        customer_number: i.customerNumber || i.customer_number || "",
        next_invoice_date:
          i.nextInvoiceDate || i.next_invoice_date || i.dueDate || "",
        amount: i.expectedAmount || i.amount || i.packagePrice || i.package_price || 0,
      }))
    : [];
  return {
    title: "Expected Collections (30 days)",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: expected.invoiceCount || rows.length,
      totalAmount: expected.expectedCollections,
      lines: [{ label: "Horizon", value: "30 days" }],
    },
  };
}

async function mrrArrForecastReport() {
  const kpis = await getKpiSnapshot({}, {});
  const headers = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value (KES)" },
  ];
  const rows = [
    { metric: "MRR (secured)", value: kpis.mrr },
    { metric: "ARR (MRR × 12)", value: kpis.arr },
    { metric: "ARPU", value: kpis.arpu },
    { metric: "Active customers", value: kpis.activeCustomers },
  ];
  return {
    title: "MRR / ARR Forecast",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: { lines: [{ label: "Source", value: "kpiEngine" }] },
  };
}

async function revenueForecastReport() {
  const [kpis, expected] = await Promise.all([
    getKpiSnapshot({}, {}),
    getExpectedCollections({ days: 30 }),
  ]);
  const headers = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
  ];
  const rows = [
    { metric: "Current MRR", value: kpis.mrr },
    { metric: "Expected collections (30d)", value: expected.expectedCollections },
    { metric: "Scheduled invoices (30d)", value: expected.invoiceCount },
    { metric: "Outstanding balance", value: kpis.outstandingBalance },
  ];
  return {
    title: "Revenue Forecast",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
  };
}

async function atRiskRevenueReport() {
  const headers = [
    { key: "invoice_number", label: "Invoice #" },
    { key: "customer_number", label: "Customer #" },
    { key: "due_date", label: "Due date" },
    { key: "days_overdue", label: "Days overdue" },
    { key: "balance_due", label: "At-risk amount" },
  ];
  const rows = await query(
    `SELECT zi.invoice_number, c.customer_number, zi.due_date,
            GREATEST(DATEDIFF(CURDATE(), COALESCE(zi.due_date, zi.invoice_date)), 0) AS days_overdue,
            COALESCE(zi.balance_due, 0) AS balance_due
     FROM zoho_customer_invoices zi
     JOIN customers c ON c.id = zi.customer_id
     WHERE COALESCE(zi.balance_due, 0) > 0
       AND COALESCE(zi.due_date, zi.invoice_date) < CURDATE()
     ORDER BY days_overdue DESC, balance_due DESC
     LIMIT 20000`
  ).catch(() => []);
  return {
    title: "At-Risk Revenue",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      total: rows.length,
      totalOutstanding: rows.reduce((s, r) => s + Number(r.balance_due || 0), 0),
    },
  };
}

async function activeCustomersReport() {
  const headers = [
    { key: "customer_number", label: "Customer #" },
    { key: "full_name", label: "Name" },
    { key: "building", label: "Building" },
    { key: "package_name", label: "Package" },
    { key: "package_price", label: "Price" },
    { key: "payment_frequency", label: "Billing" },
    { key: "subscription_status", label: "Subscription" },
  ];
  const rows = await query(
    `SELECT c.customer_number,
            TRIM(CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name)) AS full_name,
            b.name AS building,
            p.name AS package_name,
            c.package_price,
            c.payment_frequency,
            c.subscription_status
     FROM customers c
     LEFT JOIN buildings b ON b.id = c.building_id
     LEFT JOIN products p ON p.id = c.product_id
     WHERE c.status = 'active'
     ORDER BY c.customer_number ASC
     LIMIT 15000`
  );
  return {
    title: "Active Customers",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: { total: rows.length, totalLabel: "Customers" },
  };
}

async function highRiskCustomersReport(from, to) {
  const headers = [
    { key: "customer_number", label: "Customer #" },
    { key: "failed_count", label: "Failed payments" },
    { key: "last_failed_at", label: "Last failed" },
  ];
  const { clause, params } = dateWhere("pt.created_at", from, to);
  const rows = await query(
    `SELECT UPPER(pt.account_reference) AS customer_number,
            COUNT(*) AS failed_count,
            MAX(pt.created_at) AS last_failed_at
     FROM payment_transactions pt
     ${clause} AND pt.status = 'FAILED'
     GROUP BY UPPER(pt.account_reference)
     HAVING COUNT(*) >= 2
     ORDER BY failed_count DESC, last_failed_at DESC
     LIMIT 5000`,
    params
  );
  return {
    title: "High-Risk Customers (consecutive / repeated failed payments)",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: { total: rows.length, totalLabel: "Customers" },
  };
}

async function customerLifetimeValueReport(from, to) {
  const kpis = await getKpiSnapshot({}, { from, to });
  const headers = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
  ];
  const rows = [
    { metric: "ARPU", value: kpis.arpu },
    { metric: "Churn rate %", value: kpis.churnRate },
    { metric: "Estimated CLV", value: kpis.clv },
    { metric: "Active customers", value: kpis.activeCustomers },
  ];
  return {
    title: "Customer Lifetime Value",
    headers,
    rows: rows.map((r) => formatRow(r, headers)),
    summary: {
      lines: [
        { label: "Formula", value: "CLV = ARPU ÷ monthly churn; if churn=0 → ARPU × 24" },
        { label: "Source", value: "kpiEngine" },
      ],
    },
  };
}

const RUNNERS = {
  "revenue-summary": revenueSummary,
  "transaction-list": transactionList,
  "failed-payments": failedPayments,
  "failed-billing": failedPayments,
  "channel-breakdown": channelBreakdown,
  "top-customers": topCustomers,
  "revenue-by-customer": topCustomers,
  "subscriber-census": subscriberCensus,
  "package-distribution": packageDistribution,
  "customers-by-pop-package": customersByPopPackage,
  "building-occupancy": buildingOccupancy,
  "agency-performance": agencyPerformance,
  "tisp-sync-health": tispSyncHealth,
  "customer-lifecycle": customerLifecycle,
  "api-errors": apiErrors,
  "new-subscribers": newSubscribers,
  "integration-events": integrationEvents,
  "collection-efficiency": collectionEfficiency,
  "arpu-analysis": arpuAnalysis,
  "churn-analysis": churnAnalysis,
  "monthly-payment-churn": monthlyPaymentChurn,
  "payment-frequency-mix": paymentFrequencyMix,
  "dstv-iuc-roster": dstvIucRoster,
  "billing-reconciliation": billingReconciliationReport,
  "upcoming-invoices": upcomingInvoicesReport,
  "invoice-generation-forecast": upcomingInvoicesReport,
  "subscription-renewal-forecast": upcomingInvoicesReport,
  "renewals-due": upcomingInvoicesReport,
  "invoices-vs-payments": invoicesVsPayments,
  "customer-monthly-billing-matrix": customerMonthlyBillingMatrix,
  "collection-gap-by-customer": collectionGapByCustomer,
  "business-health-summary": businessHealthSummary,
  "executive-weekly": businessHealthSummary,
  "executive-monthly": executiveMonthlyReport,
  "outstanding-invoices": outstandingInvoicesReport,
  "ar-aging": arAgingReport,
  "collections-summary": collectionsSummaryReport,
  "revenue-by-package": revenueByPackageReport,
  "revenue-by-region": revenueByRegionReport,
  "forecast-vs-actual-revenue": forecastVsActualRevenue,
  "suspended-billing": suspendedBillingReport,
  "expected-collections": expectedCollectionsReport,
  "mrr-arr-forecast": mrrArrForecastReport,
  "revenue-forecast": revenueForecastReport,
  "at-risk-revenue": atRiskRevenueReport,
  "active-customers": activeCustomersReport,
  "high-risk-customers": highRiskCustomersReport,
  "consecutive-failed-payments": highRiskCustomersReport,
  "customer-lifetime-value": customerLifetimeValueReport,
};

async function runReport(reportId, { from, to, month, year, monthFrom, monthTo } = {}) {
  const def = getReportDefinition(reportId);
  if (!def) return null;
  if (def.available === false) {
    throw new Error("This report is not yet available.");
  }

  const runner = RUNNERS[reportId];
  if (!runner) return null;

  if (def.dateFilter) {
    const range = resolveDateRange(from, to);
    const result = await runner(range.from, range.to);
    return { ...result, period: range };
  }

  if (def.monthFilter) {
    const range = resolveMonthRange(month || new Date().toISOString().slice(0, 7));
    const result = await runner(range.month);
    return { ...result, period: { from: range.from, to: range.to }, month: range.month };
  }

  if (def.yearFilter) {
    if (def.monthRangeFilter) {
      const range = resolveYearMonthSpan(year || new Date().getFullYear(), monthFrom, monthTo);
      const result = await runner(range.year, {
        monthFrom: range.monthFrom,
        monthTo: range.monthTo,
      });
      return {
        ...result,
        period: { from: range.from, to: range.to },
        year: range.year,
        monthFrom: range.monthFrom,
        monthTo: range.monthTo,
      };
    }
    const range = resolveYearRange(year || new Date().getFullYear());
    const result = await runner(range.year);
    return { ...result, period: { from: range.from, to: range.to }, year: range.year };
  }

  const result = await runner();
  return result;
}

module.exports = {
  listReportDefinitions,
  listPartnerReportDefinitions,
  isPartnerReport,
  getReportDefinition,
  runReport,
  getMonthlyPaymentChurnSummary,
  getInvoicesVsPaymentsSummary,
};
