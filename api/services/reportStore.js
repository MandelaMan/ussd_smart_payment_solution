const { query } = require("../config/db");

const REPORT_DEFINITIONS = [
  {
    id: "revenue-summary",
    title: "Revenue Summary",
    description: "Daily revenue, transaction counts, and success/failure breakdown.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "transaction-list",
    title: "Payment Transactions",
    description: "All M-Pesa payment transactions in the selected period.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "failed-payments",
    title: "Failed Payments",
    description: "Failed M-Pesa transactions with result codes and descriptions.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "channel-breakdown",
    title: "Channel Breakdown",
    description: "Transaction volume and revenue grouped by payment channel.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "top-customers",
    title: "Top Customers by Spend",
    description: "Highest-paying customers ranked by total successful payments.",
    category: "Customers",
    dateFilter: true,
  },
  {
    id: "subscriber-census",
    title: "Subscriber Census",
    description: "Active and cancelled subscribers grouped by building and type.",
    category: "Customers",
    dateFilter: false,
  },
  {
    id: "package-distribution",
    title: "Package Distribution",
    description: "Subscriber counts per package, Mbps tier, and building.",
    category: "Customers",
    dateFilter: false,
  },
  {
    id: "building-occupancy",
    title: "Building Occupancy",
    description: "Active customers and unique apartments per building.",
    category: "Operations",
    dateFilter: false,
  },
  {
    id: "agency-performance",
    title: "Agency Performance",
    description: "Customer counts and attributed revenue per agency.",
    category: "Operations",
    dateFilter: true,
  },
  {
    id: "tisp-sync-health",
    title: "TISP Sync Health",
    description: "Customer TISP provisioning status with error details.",
    category: "Integrations",
    dateFilter: false,
  },
  {
    id: "customer-lifecycle",
    title: "Customer Lifecycle Events",
    description: "Upgrades, downgrades, apartment switches, and cancellations.",
    category: "Customers",
    dateFilter: true,
  },
  {
    id: "api-errors",
    title: "API Error Log",
    description: "Failed API calls across TISP, Zoho, and M-Pesa services.",
    category: "Integrations",
    dateFilter: true,
  },
  {
    id: "new-subscribers",
    title: "New Subscribers",
    description: "Customers created during the selected period.",
    category: "Customers",
    dateFilter: true,
  },
  {
    id: "integration-events",
    title: "Integration Events",
    description: "Zoho and TISP integration events with outcomes.",
    category: "Integrations",
    dateFilter: true,
  },
  {
    id: "collection-efficiency",
    title: "Collection Efficiency",
    description: "Daily payment success rates and collection performance.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "arpu-analysis",
    title: "ARPU by Building",
    description: "Average revenue per paying customer by property.",
    category: "Financial",
    dateFilter: true,
  },
  {
    id: "churn-analysis",
    title: "Churn Analysis",
    description: "Cancelled subscribers with tenure and last package details.",
    category: "Customers",
    dateFilter: true,
  },
  {
    id: "payment-frequency-mix",
    title: "Billing Frequency Mix",
    description: "Active subscribers grouped by monthly, quarterly, or yearly billing.",
    category: "Customers",
    dateFilter: false,
  },
  {
    id: "billing-reconciliation",
    title: "Billing Reconciliation",
    description: "Customers with billing, payment, and service status mismatches.",
    category: "Financial",
    dateFilter: false,
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
  "building-occupancy",
  "agency-performance",
  "customer-lifecycle",
  "new-subscribers",
  "churn-analysis",
  "payment-frequency-mix",
]);

function listReportDefinitions() {
  return REPORT_DEFINITIONS;
}

function listPartnerReportDefinitions() {
  return REPORT_DEFINITIONS.filter((r) => PARTNER_REPORT_IDS.has(r.id));
}

function isPartnerReport(id) {
  return PARTNER_REPORT_IDS.has(id);
}

function getReportDefinition(id) {
  return REPORT_DEFINITIONS.find((r) => r.id === id) || null;
}

function resolveDateRange(from, to) {
  const now = new Date();
  const resolvedTo = to || now.toISOString().slice(0, 10);
  const fromDate = from
    ? new Date(from)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const resolvedFrom = from || fromDate.toISOString().slice(0, 10);
  return { from: resolvedFrom, to: resolvedTo };
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
    { key: "tenure_days", label: "Tenure (Days)" },
  ];
  const rows = await query(
    `SELECT c.updated_at AS cancelled_at, c.customer_number,
      CONCAT(c.first_name, ' ', COALESCE(c.middle_name, ''), ' ', c.last_name) AS full_name,
      b.name AS building, p.name AS package, c.customer_type,
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

const RUNNERS = {
  "revenue-summary": revenueSummary,
  "transaction-list": transactionList,
  "failed-payments": failedPayments,
  "channel-breakdown": channelBreakdown,
  "top-customers": topCustomers,
  "subscriber-census": subscriberCensus,
  "package-distribution": packageDistribution,
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
  "payment-frequency-mix": paymentFrequencyMix,
  "billing-reconciliation": billingReconciliationReport,
};

async function runReport(reportId, { from, to } = {}) {
  const def = getReportDefinition(reportId);
  if (!def) return null;

  const runner = RUNNERS[reportId];
  if (!runner) return null;

  if (def.dateFilter) {
    const range = resolveDateRange(from, to);
    const result = await runner(range.from, range.to);
    return { ...result, period: range };
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
};
