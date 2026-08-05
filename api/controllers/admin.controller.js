const { query } = require("../config/db");
const { sendTableExport } = require("../utils/tableExportResponse");
const { listIntegrationEvents } = require("../services/integrationEventStore");
const { listActivity } = require("../services/activityLogStore");

// Best-effort cache for optional org-balance derivation.
// updatedSubscriptions.json can be large and is not required for core dashboard KPIs.
let _updatedSubscriptionsJsonCache = {
  expiresAt: 0,
  parsed: null,
};

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

function normalizeChartDay(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  // MySQL DATE / DATE_FORMAT may arrive as "YYYY-MM-DD" or a Date-like string.
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw.slice(0, 10);
}

function formatChartRows(rows) {
  return rows.map((d) => ({
    day: normalizeChartDay(d.day),
    count: Number(d.count),
    revenue: Number(d.revenue),
    success: Number(d.success_count),
    failed: Number(d.failed_count),
  }));
}

async function queryRevenueChartByMonth(year, monthNum) {
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(year, monthNum, 1)).toISOString().slice(0, 10); // first day of next month
  // Aggregate inside each source first so large payment tables are not UNION-expanded row-by-row.
  const rows = await query(
    `SELECT
      t.day,
      COALESCE(SUM(t.count), 0) AS count,
      COALESCE(SUM(t.revenue), 0) AS revenue,
      COALESCE(SUM(t.success_count), 0) AS success_count,
      COALESCE(SUM(t.failed_count), 0) AS failed_count
     FROM (
       SELECT
         DATE(pt.created_at) AS day,
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
         SUM(CASE WHEN pt.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN pt.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
       FROM payment_transactions pt
       WHERE pt.created_at >= ? AND pt.created_at < ?
       GROUP BY DATE(pt.created_at)
       UNION ALL
       SELECT
         zp.payment_date AS day,
         COUNT(*) AS count,
         COALESCE(SUM(zp.amount), 0) AS revenue,
         COUNT(*) AS success_count,
         0 AS failed_count
       FROM zoho_customer_payments zp
       WHERE zp.payment_date >= ? AND zp.payment_date < ?
       GROUP BY zp.payment_date
     ) t
     GROUP BY t.day
     ORDER BY t.day ASC`,
    [monthStart, monthEnd, monthStart, monthEnd]
  );
  return formatChartRows(rows);
}

async function queryRevenueChartByYear(year) {
  const yearStart = new Date(Date.UTC(year, 0, 1)).toISOString().slice(0, 10);
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1)).toISOString().slice(0, 10); // first day of next year
  // Pre-aggregate by month in each source (≤12 rows each) before merging.
  const rows = await query(
    `SELECT
      t.day,
      COALESCE(SUM(t.count), 0) AS count,
      COALESCE(SUM(t.revenue), 0) AS revenue,
      COALESCE(SUM(t.success_count), 0) AS success_count,
      COALESCE(SUM(t.failed_count), 0) AS failed_count
     FROM (
       SELECT
         DATE_FORMAT(pt.created_at, '%Y-%m-01') AS day,
         COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END), 0) AS revenue,
         SUM(CASE WHEN pt.status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN pt.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
       FROM payment_transactions pt
       WHERE pt.created_at >= ? AND pt.created_at < ?
       GROUP BY DATE_FORMAT(pt.created_at, '%Y-%m-01')
       UNION ALL
       SELECT
         DATE_FORMAT(zp.payment_date, '%Y-%m-01') AS day,
         COUNT(*) AS count,
         COALESCE(SUM(zp.amount), 0) AS revenue,
         COUNT(*) AS success_count,
         0 AS failed_count
       FROM zoho_customer_payments zp
       WHERE zp.payment_date >= ? AND zp.payment_date < ?
       GROUP BY DATE_FORMAT(zp.payment_date, '%Y-%m-01')
     ) t
     GROUP BY t.day
     ORDER BY t.day ASC`,
    [yearStart, yearEnd, yearStart, yearEnd]
  );
  const formatted = formatChartRows(rows);
  const byMonth = new Map(
    formatted.map((row) => {
      const parts = String(row.day).split("-");
      const month = Number(parts[1]) || new Date(row.day).getUTCMonth() + 1;
      return [month, row];
    })
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
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear + 1}-01-01`;
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
      query(
        `
        SELECT
          (
            COUNT(*)
            + (SELECT COUNT(*)
               FROM zoho_customer_payments zp
               WHERE zp.payment_date >= ? AND zp.payment_date < ?
              )
          ) AS total,
          (
            SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)
            + (SELECT COUNT(*)
               FROM zoho_customer_payments zp
               WHERE zp.payment_date >= ? AND zp.payment_date < ?
              )
          ) AS success_count,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
          (
            COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0)
            + (SELECT COALESCE(SUM(zp.amount), 0)
               FROM zoho_customer_payments zp
               WHERE zp.payment_date >= ? AND zp.payment_date < ?
              )
          ) AS total_revenue
        FROM payment_transactions pt
        WHERE pt.created_at >= ? AND pt.created_at < ?
      `,
        [
          yearStart,
          yearEnd,
          yearStart,
          yearEnd,
          yearStart,
          yearEnd,
          yearStart,
          yearEnd,
        ]
      ),
      query(`
        SELECT
          SUM(x.txn_count) AS total,
          SUM(x.revenue) AS revenue
        FROM (
          SELECT
            1 AS txn_count,
            CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END AS revenue
          FROM payment_transactions
          WHERE created_at >= CURDATE()
            AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
          UNION ALL
          SELECT
            1 AS txn_count,
            COALESCE(amount, 0) AS revenue
          FROM zoho_customer_payments
          WHERE payment_date = CURDATE()
        ) x
      `),
      query(`
        SELECT
          SUM(x.txn_count) AS total,
          SUM(x.revenue) AS revenue
        FROM (
          SELECT
            1 AS txn_count,
            CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END AS revenue
          FROM payment_transactions
          WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
            AND created_at < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)
          UNION ALL
          SELECT
            1 AS txn_count,
            COALESCE(amount, 0) AS revenue
          FROM zoho_customer_payments
          WHERE YEAR(payment_date) = YEAR(CURDATE())
            AND MONTH(payment_date) = MONTH(CURDATE())
        ) x
      `),
      query(
        `SELECT
          SUM(x.txn_count) AS total,
          SUM(x.revenue) AS revenue
         FROM (
           SELECT
             1 AS txn_count,
             CASE WHEN pt.status = 'SUCCESS' THEN pt.amount ELSE 0 END AS revenue
           FROM payment_transactions pt
           WHERE pt.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           UNION ALL
           SELECT
             1 AS txn_count,
             COALESCE(zp.amount, 0) AS revenue
           FROM zoho_customer_payments zp
           WHERE zp.payment_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         ) x`,
        [days, days]
      ),
      query(`
        SELECT COUNT(*) AS count FROM (
          SELECT phone FROM (
            SELECT phone
            FROM payment_transactions
            WHERE status = 'SUCCESS' AND phone IS NOT NULL AND phone != ''
              AND created_at >= ? AND created_at < ?
            UNION ALL
            SELECT c.phone
            FROM zoho_customer_payments zp
            JOIN customers c ON c.id = zp.customer_id
            WHERE c.phone IS NOT NULL
              AND c.phone != ''
              AND zp.payment_date >= ? AND zp.payment_date < ?
          ) rc
          GROUP BY phone HAVING COUNT(*) > 1
        ) rc2
      `, [yearStart, yearEnd, yearStart, yearEnd]),
      query(`
        SELECT COUNT(DISTINCT customer_ref) AS count FROM (
          SELECT account_reference AS customer_ref
          FROM payment_transactions
          WHERE status = 'SUCCESS'
            AND account_reference IS NOT NULL
            AND created_at >= ? AND created_at < ?
          UNION ALL
          SELECT c.customer_number AS customer_ref
          FROM zoho_customer_payments zp
          JOIN customers c ON c.id = zp.customer_id
          WHERE c.customer_number IS NOT NULL
            AND zp.payment_date >= ? AND zp.payment_date < ?
        ) u
      `, [yearStart, yearEnd, yearStart, yearEnd]),
      query(
        `SELECT COUNT(*) AS count FROM (
          SELECT customer_ref, MIN(first_paid_date) AS first_pay
          FROM (
            SELECT
              pt.account_reference AS customer_ref,
              DATE(pt.created_at) AS first_paid_date
            FROM payment_transactions pt
            WHERE pt.status = 'SUCCESS' AND pt.account_reference IS NOT NULL
            UNION ALL
            SELECT
              c.customer_number AS customer_ref,
              zp.payment_date AS first_paid_date
            FROM zoho_customer_payments zp
            JOIN customers c ON c.id = zp.customer_id
            WHERE zp.payment_date IS NOT NULL
          ) allp
          GROUP BY customer_ref
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
        `SELECT
          b.name AS building,
          COALESCE(mp.revenue, 0) + COALESCE(zp.revenue, 0) AS revenue,
          COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) AS subscribers
         FROM buildings b
         LEFT JOIN customers c ON c.building_id = b.id
         LEFT JOIN (
           SELECT
             c.building_id,
             COALESCE(SUM(pt.amount), 0) AS revenue
           FROM payment_transactions pt
           JOIN customers c ON c.customer_number = pt.account_reference
           WHERE pt.status = 'SUCCESS'
             AND pt.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           GROUP BY c.building_id
         ) mp ON mp.building_id = b.id
         LEFT JOIN (
           SELECT
             c.building_id,
             COALESCE(SUM(zp.amount), 0) AS revenue
           FROM zoho_customer_payments zp
           JOIN customers c ON c.id = zp.customer_id
           WHERE zp.payment_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           GROUP BY c.building_id
         ) zp ON zp.building_id = b.id
         GROUP BY b.id, b.name
         HAVING revenue > 0 OR subscribers > 0
         ORDER BY revenue DESC
         LIMIT 12`,
        [days, days]
      ),
      query(
        `
        SELECT COALESCE(AVG(x.amount), 0) AS avg_amount
        FROM (
          SELECT pt.amount
          FROM payment_transactions pt
          WHERE pt.status = 'SUCCESS'
            AND pt.created_at >= ? AND pt.created_at < ?
            AND pt.amount IS NOT NULL
          UNION ALL
          SELECT zp.amount
          FROM zoho_customer_payments zp
          WHERE zp.payment_date >= ? AND zp.payment_date < ?
            AND zp.amount IS NOT NULL
        ) x
        `,
        [yearStart, yearEnd, yearStart, yearEnd]
      ),
      customerStore.getSubscriberStats(days).catch(() => emptySubscribers),
    ]);

    // Optional: derive "org balance" signals from the live ISP transaction log.
    // This is best-effort: updatedSubscriptions.json may be empty or contain STK snapshots with OrgAccountBalance="0".
    let orgBalanceTotal = 0;
    let orgBalanceActive = 0;
    let orgBalanceSuspended = 0;
    let orgBalanceUpdatedAt = null;
    try {
      const fs = require("fs/promises");
      const path = require("path");
      const SUBS_FILE = path.resolve(__dirname, "../../logs/updatedSubscriptions.json");
      const CACHE_MS = 10_000;
      const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

      let parsed = _updatedSubscriptionsJsonCache.parsed;
      const now = Date.now();

      // Skip heavy parsing if file is huge or we recently parsed it.
      if (!parsed || now > _updatedSubscriptionsJsonCache.expiresAt) {
        const stat = await fs.stat(SUBS_FILE).catch(() => null);
        if (!stat || stat.size === 0) {
          parsed = [];
        } else if (stat.size > MAX_FILE_BYTES) {
          parsed = [];
        } else {
          const raw = await fs.readFile(SUBS_FILE, "utf8");
          parsed = JSON.parse(raw || "[]");
        }

        _updatedSubscriptionsJsonCache = {
          expiresAt: now + CACHE_MS,
          parsed,
        };
      }

      if (Array.isArray(parsed) && parsed.length > 0) {
        const byAccount = new Map();
        for (const rec of parsed) {
          const account = String(
            rec?.customerAccount ??
              rec?.ispPayload?.BillRefNumber ??
              rec?.ispPayload?.CustomerAccount ??
              rec?.ispPayload?.BillRef ??
              rec?.rawTx?.BillRefNumber ??
              rec?.rawTx?.AccountReference ??
              ""
          ).trim();
          if (!account) continue;

          const balRaw =
            rec?.ispPayload?.OrgAccountBalance ??
            rec?.ispPayload?.OrgAccountBal ??
            rec?.rawTx?.OrgAccountBalance ??
            rec?.rawTx?.OrgAccountBal ??
            null;
          const bal = balRaw != null && String(balRaw).trim() !== "" ? Number(balRaw) : null;

          const updatedAtStr = rec?.lastUpdatedAt ?? rec?.updatedAt ?? null;
          const updatedAtMs = updatedAtStr ? new Date(updatedAtStr).getTime() : 0;

          const prev = byAccount.get(account);
          if (!prev || updatedAtMs >= (prev.updatedAtMs || 0)) {
            byAccount.set(account, { account, bal, updatedAtMs });
          }
        }

        if (byAccount.size > 0) {
          let anyNonZero = false;
          for (const { bal } of byAccount.values()) {
            if (!Number.isFinite(bal)) continue;
            orgBalanceTotal += bal;
            if (bal > 0) {
              orgBalanceActive += 1;
              anyNonZero = true;
            } else {
              orgBalanceSuspended += 1;
            }
          }

          // UpdatedAt: use latest seen timestamp among records.
          const latest = Array.from(byAccount.values()).reduce((acc, r) =>
            (r.updatedAtMs || 0) > (acc.updatedAtMs || 0) ? r : acc, { updatedAtMs: 0 });
          if (latest?.updatedAtMs) {
            orgBalanceUpdatedAt = new Date(latest.updatedAtMs).toISOString();
          }

          subscribers.orgBalanceTotal = orgBalanceTotal;
          subscribers.orgBalanceActive = orgBalanceActive;
          subscribers.orgBalanceSuspended = orgBalanceSuspended;
          subscribers.orgBalanceUpdatedAt = orgBalanceUpdatedAt;

          // Only override dashboard subscriber counts when we have evidence of non-zero org balance.
          if (anyNonZero) {
            subscribers.tispActive = orgBalanceActive;
            subscribers.tispSuspended = orgBalanceSuspended;
            subscribers.tispPaused = 0;
            subscribers.tispUnknown = orgBalanceSuspended;
          }
        }
      }
    } catch {
      /* best-effort */
    }

    return res.json({
      mpesa: {
        total: Number(mpesaStats.total || 0),
        success: Number(mpesaStats.success_count || 0),
        failed: Number(mpesaStats.failed_count || 0),
        pending: Number(mpesaStats.pending_count || 0),
        revenue: Number(mpesaStats.total_revenue || 0),
        orgBalanceTotal,
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
      zp.id,
      'zoho' AS source,
      CASE
        WHEN LOWER(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.payment_status')),
          'paid'
        )) IN ('paid', 'success') THEN 'SUCCESS'
        ELSE UPPER(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.payment_status')),
          'PAID'
        ))
      END AS status,
      zp.amount,
      c.customer_number AS customer_ref,
      c.phone,
      COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.description')), ''),
        NULLIF(zp.reference_number, ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.payment_number')), ''),
        zp.payment_id
      ) AS reference_id,
      COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.payment_mode_formatted')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.payment_mode')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.account_name')), ''),
        'Zoho'
      ) AS channel,
      NULL AS checkout_request_id,
      COALESCE(
        NULLIF(zp.invoice_number, ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(zp.raw_json, '$.invoice_numbers')), '')
      ) AS detail,
      'paid' AS outcome,
      NULL AS zoho_action,
      zp.payment_date AS created_at
    FROM zoho_customer_payments zp
    LEFT JOIN customers c ON c.id = zp.customer_id

    UNION ALL

    SELECT
      ie.id,
      CASE WHEN ie.source = 'zoho' THEN 'zoho_invoice' ELSE ie.source END AS source,
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

async function getZohoCustomerPayment(req, res, next) {
  try {
    const rows = await query(
      `SELECT zp.*,
              c.customer_number,
              c.phone AS customer_phone,
              c.first_name,
              c.last_name,
              c.email
       FROM zoho_customer_payments zp
       LEFT JOIN customers c ON c.id = zp.customer_id
       WHERE zp.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const row = rows[0];
    let payload = {};
    try {
      payload =
        typeof row.raw_json === "string"
          ? JSON.parse(row.raw_json)
          : row.raw_json || {};
    } catch {
      payload = {};
    }

    const description =
      payload.description != null ? String(payload.description).trim() : "";
    const paymentNumber =
      payload.payment_number != null ? String(payload.payment_number).trim() : "";
    const paymentMode =
      (payload.payment_mode_formatted != null &&
        String(payload.payment_mode_formatted).trim()) ||
      (payload.payment_mode != null && String(payload.payment_mode).trim()) ||
      null;
    const invoiceNumbers =
      (row.invoice_number && String(row.invoice_number).trim()) ||
      (payload.invoice_numbers != null && String(payload.invoice_numbers).trim()) ||
      null;
    const customerName = [row.first_name, row.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    return res.json({
      payment: {
        id: row.id,
        paymentId: row.payment_id,
        paymentNumber: paymentNumber || null,
        paymentDate: row.payment_date,
        amount: row.amount != null ? Number(row.amount) : null,
        status:
          String(payload.payment_status || "paid").toLowerCase() === "paid" ||
          String(payload.payment_status || "").toLowerCase() === "success"
            ? "SUCCESS"
            : String(payload.payment_status || "PAID").toUpperCase(),
        referenceNumber: row.reference_number || null,
        description: description || null,
        referenceId:
          description ||
          (row.reference_number && String(row.reference_number).trim()) ||
          paymentNumber ||
          row.payment_id,
        channel: paymentMode,
        accountName:
          payload.account_name != null ? String(payload.account_name) : null,
        invoiceNumbers,
        customerId: row.customer_id,
        customerNumber: row.customer_number || null,
        customerName: customerName || null,
        phone: row.customer_phone || null,
        email: row.email || null,
        payload,
        createdAt: row.payment_date,
      },
    });
  } catch (err) {
    return next(err);
  }
}

const SUPPORT_ACTIVITY_TYPES = [
  "customer_created",
  "customer_created_tisp_failed",
  "customer_updated",
  "customer_cancelled",
  "customer_upgraded",
  "customer_downgraded",
  "customer_apartment_switched",
  "customer_type_changed",
  "customer_paused",
  "customer_disconnected",
  "customer_deleted",
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
              reference_id, actor_user_id, actor_name, created_at
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
        actorUserId:
          row.actor_user_id != null ? Number(row.actor_user_id) : null,
        actorName: row.actor_name || null,
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
  getZohoCustomerPayment,
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
