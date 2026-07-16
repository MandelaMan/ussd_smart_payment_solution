const { query } = require("../config/db");
const { sendTableExport } = require("../utils/tableExportResponse");
const { listIntegrationEvents } = require("../services/integrationEventStore");
const { listActivity } = require("../services/activityLogStore");

function buildWhere(conditions, params) {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function parseFilters(queryParams) {
  const conditions = [];
  const params = [];
  const { status, search, from, to, channel } = queryParams;

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (channel) {
    conditions.push("channel = ?");
    params.push(channel);
  }
  if (from) {
    conditions.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("created_at <= ?");
    params.push(to);
  }
  if (search) {
    conditions.push(
      "(phone LIKE ? OR mpesa_receipt LIKE ? OR account_reference LIKE ? OR checkout_request_id LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  return { conditions, params };
}

function escapeCsv(val) {
  const s = val == null ? "" : String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n");
}

function formatChartRows(rows) {
  return rows.map((d) => ({
    day: d.day,
    count: Number(d.count),
    revenue: Number(d.revenue),
    success: Number(d.success_count),
    failed: Number(d.failed_count),
  }));
}

async function queryRevenueChartByMonth(year, monthNum) {
  const rows = await query(
    `SELECT DATE(created_at) AS day,
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
     FROM payment_transactions
     WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [year, monthNum]
  );
  return formatChartRows(rows);
}

async function queryRevenueChartByYear(year) {
  const rows = await query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-01') AS day,
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
     FROM payment_transactions
     WHERE YEAR(created_at) = ?
     GROUP BY YEAR(created_at), MONTH(created_at)
     ORDER BY MONTH(created_at) ASC`,
    [year]
  );
  const formatted = formatChartRows(rows);
  const byMonth = new Map(
    formatted.map((row) => [new Date(row.day).getMonth() + 1, row])
  );
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const existing = byMonth.get(month);
    if (existing) return existing;
    return {
      day: `${year}-${String(month).padStart(2, "0")}-01`,
      count: 0,
      revenue: 0,
      success: 0,
      failed: 0,
    };
  });
}

async function getRevenueChart(req, res, next) {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = req.query.month;

    if (!month) {
      return res.status(400).json({ error: "Month is required." });
    }

    if (month === "all") {
      const chart = await queryRevenueChartByYear(year);
      return res.json({ month: "all", year, chart });
    }

    const monthNum = parseInt(month, 10);
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: "Invalid month. Use all or 1-12." });
    }

    const chart = await queryRevenueChartByMonth(year, monthNum);
    return res.json({ month: String(monthNum), year, chart });
  } catch (err) {
    return next(err);
  }
}

async function getStats(req, res, next) {
  try {
    const period = req.query.period || "30d";
    const days = period === "7d" ? 6 : period === "90d" ? 89 : 29;
    const customerStore = require("../services/customerModuleStore");
    const emptySubscribers = {
      total: 0,
      active: 0,
      cancelled: 0,
      c2b: 0,
      b2b: 0,
      tispFailed: 0,
      tispPending: 0,
      newInPeriod: 0,
      buildings: 0,
      agencies: 0,
      topBuildings: [],
      topPackages: [],
      avgCustomerPayment: 0,
      avgPaymentsPerCustomer: 0,
      tispActive: 0,
      tispSuspended: 0,
      tispUnknown: 0,
    };

    // Run independent aggregates in parallel — sequential awaits were the main dashboard bottleneck.
    // Skip unused chart/recentActivity/activityFeed work (UI uses /revenue-chart + /activity).
    const [
      [mpesaStats],
      [todayStats],
      [monthStats],
      [periodStats],
      [returningCustomers],
      [uniqueCustomers],
      [newCustomers],
      [zohoStats],
      [tispStats],
      statusBreakdown,
      channelBreakdown,
      integrationBreakdown,
      topCustomers,
      revenueByBuilding,
      avgTransactionRows,
      subscribers,
    ] = await Promise.all([
      query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS total_revenue
        FROM payment_transactions
      `),
      query(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
        FROM payment_transactions
        WHERE created_at >= CURDATE()
          AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
      `),
      query(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
        FROM payment_transactions
        WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
          AND created_at < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
      `),
      query(
        `SELECT COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
         FROM payment_transactions
         WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [days]
      ),
      query(`
        SELECT COUNT(*) AS count FROM (
          SELECT phone FROM payment_transactions
          WHERE status = 'SUCCESS' AND phone IS NOT NULL AND phone != ''
          GROUP BY phone HAVING COUNT(*) > 1
        ) rc
      `),
      query(`
        SELECT COUNT(DISTINCT account_reference) AS count
        FROM payment_transactions
        WHERE status = 'SUCCESS' AND account_reference IS NOT NULL
      `),
      query(
        `SELECT COUNT(*) AS count FROM (
          SELECT account_reference, MIN(created_at) AS first_pay
          FROM payment_transactions
          WHERE status = 'SUCCESS' AND account_reference IS NOT NULL
          GROUP BY account_reference
          HAVING first_pay >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        ) nc`,
        [days]
      ),
      query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status IN ('paid', 'success') THEN 1 ELSE 0 END) AS success_count
        FROM integration_events WHERE source = 'zoho'
      `),
      query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_count
        FROM integration_events WHERE source = 'tisp'
      `),
      query(`
        SELECT status, COUNT(*) AS count
        FROM payment_transactions
        GROUP BY status
      `),
      query(`
        SELECT COALESCE(channel, 'Unknown') AS channel, COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
        FROM payment_transactions
        GROUP BY channel
      `),
      query(`
        SELECT source,
          COUNT(*) AS total,
          SUM(CASE WHEN source = 'zoho' AND status IN ('paid','success') THEN 1
                   WHEN source = 'tisp' AND outcome = 'success' THEN 1 ELSE 0 END) AS success
        FROM integration_events
        GROUP BY source
      `),
      query(`
        SELECT account_reference AS customer, phone,
          COUNT(*) AS payments,
          COALESCE(SUM(amount), 0) AS total_spent,
          MAX(created_at) AS last_payment
        FROM payment_transactions
        WHERE status = 'SUCCESS' AND account_reference IS NOT NULL
        GROUP BY account_reference, phone
        ORDER BY total_spent DESC
        LIMIT 5
      `),
      query(
        `SELECT b.name AS building,
          COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
          COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS subscribers
         FROM buildings b
         LEFT JOIN customers c ON c.building_id = b.id
         LEFT JOIN payment_transactions pt ON pt.account_reference = c.customer_number
           AND pt.status = 'SUCCESS'
           AND pt.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY b.id, b.name
         HAVING revenue > 0 OR subscribers > 0
         ORDER BY revenue DESC
         LIMIT 12`,
        [days]
      ),
      query(`
        SELECT COALESCE(AVG(amount), 0) AS avg_amount
        FROM payment_transactions WHERE status = 'SUCCESS'
      `),
      customerStore.getSubscriberStats(days).catch(() => emptySubscribers),
    ]);

    return res.json({
      mpesa: {
        total: Number(mpesaStats.total || 0),
        success: Number(mpesaStats.success_count || 0),
        failed: Number(mpesaStats.failed_count || 0),
        pending: Number(mpesaStats.pending_count || 0),
        revenue: Number(mpesaStats.total_revenue || 0),
      },
      today: {
        transactions: Number(todayStats.total || 0),
        revenue: Number(todayStats.revenue || 0),
      },
      month: {
        transactions: Number(monthStats.total || 0),
        revenue: Number(monthStats.revenue || 0),
      },
      period: {
        days,
        transactions: Number(periodStats.total || 0),
        revenue: Number(periodStats.revenue || 0),
      },
      customers: {
        unique: Number(uniqueCustomers.count || 0),
        returning: Number(returningCustomers.count || 0),
        newInPeriod: Number(newCustomers.count || 0),
        returningRate:
          Number(uniqueCustomers.count || 0) > 0
            ? Math.round(
                (Number(returningCustomers.count || 0) /
                  Number(uniqueCustomers.count || 0)) *
                  100
              )
            : 0,
      },
      zoho: {
        total: Number(zohoStats.total || 0),
        success: Number(zohoStats.success_count || 0),
      },
      tisp: {
        total: Number(tispStats.total || 0),
        success: Number(tispStats.success_count || 0),
      },
      avgTransaction: Number(avgTransactionRows[0]?.avg_amount || 0),
      recentActivity: [],
      activityFeed: [],
      chart: [],
      statusBreakdown: statusBreakdown.map((d) => ({
        status: d.status,
        count: Number(d.count),
      })),
      channelBreakdown: channelBreakdown.map((d) => ({
        channel: d.channel,
        count: Number(d.count),
        revenue: Number(d.revenue),
      })),
      integrationBreakdown: integrationBreakdown.map((d) => ({
        source: d.source,
        total: Number(d.total),
        success: Number(d.success),
      })),
      topCustomers: topCustomers.map((d) => ({
        customer: d.customer,
        phone: d.phone,
        payments: Number(d.payments),
        totalSpent: Number(d.total_spent),
        lastPayment: d.last_payment,
      })),
      revenueByBuilding: revenueByBuilding.map((d) => ({
        building: d.building,
        revenue: Number(d.revenue),
        subscribers: Number(d.subscribers),
      })),
      subscribers,
    });
  } catch (err) {
    return next(err);
  }
}

async function listMpesaTransactions(req, res, next) {
  try {
    const { page = "1", limit = "20" } = req.query;
    const { conditions, params } = parseFilters(req.query);

    const where = buildWhere(conditions, params);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM payment_transactions ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await query(
      `SELECT * FROM payment_transactions ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      data: rows.map(formatMpesaRow),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function exportMpesaTransactions(req, res, next) {
  try {
    const { conditions, params } = parseFilters(req.query);
    const where = buildWhere(conditions, params);

    const rows = await query(
      `SELECT * FROM payment_transactions ${where} ORDER BY created_at DESC LIMIT 5000`,
      params
    );

    const csv = rowsToCsv(
      [
        "id",
        "mpesa_receipt",
        "phone",
        "account_reference",
        "amount",
        "status",
        "channel",
        "created_at",
      ],
      rows.map((r) => ({
        id: r.id,
        mpesa_receipt: r.mpesa_receipt,
        phone: r.phone,
        account_reference: r.account_reference,
        amount: r.amount,
        status: r.status,
        channel: r.channel,
        created_at: r.created_at,
      }))
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="mpesa-transactions.csv"'
    );
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
}

async function exportIntegrationEvents(req, res, next) {
  try {
    const source = req.params.source;
    if (!["zoho", "tisp"].includes(source)) {
      return res.status(400).json({ error: "Invalid source" });
    }

    const result = await listIntegrationEvents({
      source,
      status: req.query.status,
      search: req.query.search,
      from: req.query.from,
      to: req.query.to,
      page: 1,
      limit: 5000,
    });

    const csv = rowsToCsv(
      ["id", "customer_no", "amount", "status", "outcome", "channel", "created_at"],
      result.data.map((r) => ({
        id: r.id,
        customer_no: r.customerNo,
        amount: r.amount,
        status: r.status,
        outcome: r.outcome,
        channel: r.channel,
        created_at: r.createdAt,
      }))
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${source}-events.csv"`
    );
    return res.send(csv);
  } catch (err) {
    return next(err);
  }
}

async function getMpesaTransaction(req, res, next) {
  try {
    const rows = await query(
      `SELECT * FROM payment_transactions WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const events = await query(
      `SELECT * FROM integration_events
       WHERE payment_transaction_id = ?
       ORDER BY created_at ASC`,
      [req.params.id]
    );

    return res.json({
      transaction: formatMpesaRow(rows[0]),
      integrations: events.map((e) => ({
        id: e.id,
        source: e.source,
        status: e.status,
        outcome: e.outcome,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function listZohoEvents(req, res, next) {
  try {
    const result = await listIntegrationEvents({
      source: "zoho",
      status: req.query.status,
      search: req.query.search,
      from: req.query.from,
      to: req.query.to,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(100, parseInt(req.query.limit, 10) || 20),
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function listTispEvents(req, res, next) {
  try {
    const result = await listIntegrationEvents({
      source: "tisp",
      status: req.query.status,
      search: req.query.search,
      from: req.query.from,
      to: req.query.to,
      page: parseInt(req.query.page, 10) || 1,
      limit: Math.min(100, parseInt(req.query.limit, 10) || 20),
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

function formatMpesaRow(row) {
  return {
    id: row.id,
    checkoutRequestId: row.checkout_request_id,
    merchantRequestId: row.merchant_request_id,
    mpesaReceipt: row.mpesa_receipt,
    phone: row.phone,
    amount: row.amount != null ? Number(row.amount) : null,
    accountReference: row.account_reference,
    status: row.status,
    resultCode: row.result_code,
    resultDesc: row.result_desc,
    transactionDate: row.transaction_date,
    channel: row.channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const UNIFIED_TX_SQL = `
  SELECT * FROM (
    SELECT
      id,
      'mpesa' AS source,
      status,
      amount,
      account_reference AS customer_ref,
      phone,
      mpesa_receipt AS reference_id,
      channel,
      checkout_request_id,
      result_desc AS detail,
      NULL AS outcome,
      NULL AS zoho_action,
      created_at
    FROM payment_transactions

    UNION ALL

    SELECT
      ie.id,
      ie.source,
      ie.status,
      ie.amount,
      ie.customer_no AS customer_ref,
      pt.phone,
      ie.reference_id,
      ie.channel,
      pt.checkout_request_id,
      NULL AS detail,
      ie.outcome,
      CASE
        WHEN ie.source = 'zoho'
          AND JSON_UNQUOTE(JSON_EXTRACT(ie.raw_payload, '$.result.strategy')) = 'created_and_paid'
          THEN 'created'
        WHEN ie.source = 'zoho' AND ie.status IN ('paid', 'success') THEN 'updated'
        ELSE NULL
      END AS zoho_action,
      ie.created_at
    FROM integration_events ie
    LEFT JOIN payment_transactions pt ON pt.id = ie.payment_transaction_id
  ) unified
`;

function parseUnifiedFilters(queryParams) {
  const conditions = [];
  const params = [];
  const { status, search, from, to, channel, source, customerRef } = queryParams;

  if (customerRef) {
    conditions.push("customer_ref = ?");
    params.push(customerRef);
  }
  if (source && source !== "all") {
    conditions.push("source = ?");
    params.push(source);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (channel && source !== "zoho" && source !== "tisp") {
    conditions.push("channel = ?");
    params.push(channel);
  }
  if (from) {
    conditions.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("created_at <= ?");
    params.push(to);
  }
  if (search) {
    conditions.push(
      "(customer_ref LIKE ? OR reference_id LIKE ? OR phone LIKE ? OR checkout_request_id LIKE ?)"
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  return { conditions, params };
}

function formatUnifiedRow(row) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    amount: row.amount != null ? Number(row.amount) : null,
    customerRef: row.customer_ref,
    phone: row.phone,
    referenceId: row.reference_id,
    channel: row.channel,
    checkoutRequestId: row.checkout_request_id,
    detail: row.detail,
    outcome: row.outcome,
    zohoAction:
      row.zoho_action === "created" || row.zoho_action === "updated"
        ? row.zoho_action
        : null,
    createdAt: row.created_at,
  };
}

async function listUnifiedTransactions(req, res, next) {
  try {
    const { page = "1", limit = "20", sortBy, sortDir } = req.query;
    const { conditions, params } = parseUnifiedFilters(req.query);
    const where = buildWhere(conditions, params);
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const { resolveListSort } = require("../utils/listSort");
    const sort = resolveListSort(
      { sortBy, sortDir },
      {
        allowed: [
          { key: "source", sql: "source" },
          { key: "customerRef", sql: "customer_ref" },
          { key: "referenceId", sql: "reference_id" },
          { key: "amount", sql: "amount" },
          { key: "status", sql: "status" },
          { key: "createdAt", sql: "created_at" },
        ],
        defaultSort: { sortBy: "createdAt", sortDir: "desc" },
      }
    );

    const countRows = await query(
      `SELECT COUNT(*) AS total FROM (${UNIFIED_TX_SQL}) unified ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await query(
      `SELECT * FROM (${UNIFIED_TX_SQL}) unified ${where}
       ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      data: rows.map(formatUnifiedRow),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function getIntegrationEvent(req, res, next) {
  try {
    const rows = await query(
      `SELECT ie.*, pt.checkout_request_id, pt.mpesa_receipt, pt.phone AS mpesa_phone,
              pt.account_reference AS mpesa_account
       FROM integration_events ie
       LEFT JOIN payment_transactions pt ON pt.id = ie.payment_transaction_id
       WHERE ie.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Event not found" });
    }

    const row = rows[0];
    let payload = {};
    try {
      payload =
        typeof row.raw_payload === "string"
          ? JSON.parse(row.raw_payload)
          : row.raw_payload || {};
    } catch {
      payload = {};
    }

    return res.json({
      event: {
        id: row.id,
        source: row.source,
        status: row.status,
        customerNo: row.customer_no,
        amount: row.amount != null ? Number(row.amount) : null,
        referenceId: row.reference_id,
        outcome: row.outcome,
        channel: row.channel,
        checkoutRequestId: row.checkout_request_id,
        mpesaReceipt: row.mpesa_receipt,
        phone: row.mpesa_phone,
        accountReference: row.mpesa_account,
        payload,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    return next(err);
  }
}

const SUPPORT_ACTIVITY_TYPES = [
  "customer_created",
  "customer_created_tisp_failed",
  "customer_cancelled",
  "customer_upgraded",
  "customer_downgraded",
  "customer_apartment_switched",
  "customer_type_changed",
  "tisp_reconnected",
  "tisp_reconnect_failed",
];

async function getSupportStats(req, res, next) {
  try {
    const period = req.query.period || "30d";
    const days = period === "7d" ? 6 : period === "90d" ? 89 : 29;

    const customerStore = require("../services/customerModuleStore");
    const subscribers = await customerStore.getSubscriberStats(days);

    const subscriptionStatus = await query(`
      SELECT
        CASE
          WHEN subscription_status IS NULL OR subscription_status = '' THEN 'unknown'
          ELSE LOWER(subscription_status)
        END AS status,
        COUNT(*) AS count
      FROM customers
      WHERE status = 'active'
      GROUP BY 1
      ORDER BY count DESC
    `);

    const tispSync = await query(`
      SELECT
        SUM(CASE WHEN tisp_sync_status = 'synced' THEN 1 ELSE 0 END) AS synced,
        SUM(CASE WHEN tisp_sync_status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN tisp_sync_status = 'pending' OR tisp_sync_status IS NULL THEN 1 ELSE 0 END) AS pending
      FROM customers
      WHERE status = 'active'
    `);

    const placeholders = SUPPORT_ACTIVITY_TYPES.map(() => "?").join(", ");
    const activityRows = await query(
      `SELECT id, event_type, title, message, source, status, customer_ref,
              reference_id, created_at
       FROM activity_logs
       WHERE event_type IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT 40`,
      SUPPORT_ACTIVITY_TYPES
    );

    return res.json({
      period: { days },
      subscribers: {
        total: subscribers.total,
        active: subscribers.active,
        cancelled: subscribers.cancelled,
        c2b: subscribers.c2b,
        b2b: subscribers.b2b,
        tispFailed: subscribers.tispFailed,
        tispPending: subscribers.tispPending,
        newInPeriod: subscribers.newInPeriod,
        buildings: subscribers.buildings,
        agencies: subscribers.agencies,
        topBuildings: subscribers.topBuildings,
        topPackages: subscribers.topPackages,
      },
      subscriptionStatus: subscriptionStatus.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
      tispSync: {
        synced: Number(tispSync[0]?.synced || 0),
        failed: Number(tispSync[0]?.failed || 0),
        pending: Number(tispSync[0]?.pending || 0),
      },
      activity: activityRows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        title: row.title,
        message: row.message,
        source: row.source,
        status: row.status,
        customerRef: row.customer_ref,
        referenceId: row.reference_id,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function exportUnifiedTransactions(req, res, next) {
  try {
    const scope = String(req.query.scope || "all").toLowerCase();
    const format = String(req.query.format || "csv").toLowerCase();
    const { page = "1", limit = "20", sortBy, sortDir } = req.query;
    const { conditions, params } = parseUnifiedFilters(req.query);
    const where = buildWhere(conditions, params);

    const { resolveListSort } = require("../utils/listSort");
    const sort = resolveListSort(
      { sortBy, sortDir },
      {
        allowed: [
          { key: "source", sql: "source" },
          { key: "customerRef", sql: "customer_ref" },
          { key: "referenceId", sql: "reference_id" },
          { key: "amount", sql: "amount" },
          { key: "status", sql: "status" },
          { key: "createdAt", sql: "created_at" },
        ],
        defaultSort: { sortBy: "createdAt", sortDir: "desc" },
      }
    );

    let limitNum;
    let offset;
    if (scope === "view") {
      const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
      limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
      offset = (pageNum - 1) * limitNum;
    } else {
      limitNum = 5000;
      offset = 0;
    }

    const rows = await query(
      `SELECT * FROM (${UNIFIED_TX_SQL}) unified ${where}
       ORDER BY ${sort.orderClause} LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const headers = [
      { key: "source", label: "Source" },
      { key: "customer_ref", label: "Customer" },
      { key: "reference_id", label: "Reference" },
      { key: "amount", label: "Amount" },
      { key: "status", label: "Status" },
      { key: "channel", label: "Channel" },
      { key: "detail", label: "Detail" },
      { key: "outcome", label: "Outcome" },
      { key: "created_at", label: "Created" },
    ];

    const report = {
      title: "Transactions",
      headers,
      rows: rows.map((row) => ({
        source: row.source,
        customer_ref: row.customer_ref,
        reference_id: row.reference_id,
        amount: row.amount,
        status: row.status,
        channel: row.channel,
        detail: row.detail,
        outcome: row.outcome,
        created_at: row.created_at,
      })),
    };

    const scopeSuffix = scope === "view" ? "current-view" : "all-records";
    return sendTableExport(res, report, format, `transactions-${scopeSuffix}`);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getStats,
  getSupportStats,
  getRevenueChart,
  listMpesaTransactions,
  listUnifiedTransactions,
  exportUnifiedTransactions,
  getMpesaTransaction,
  getIntegrationEvent,
  listZohoEvents,
  listTispEvents,
  exportMpesaTransactions,
  exportIntegrationEvents,
  getActivityFeed: async (req, res, next) => {
    try {
      const limit = Math.min(100, parseInt(req.query.limit, 10) || 40);
      const feed = await listActivity({ limit });
      return res.json({ data: feed });
    } catch (err) {
      return next(err);
    }
  },
};
