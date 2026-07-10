const { query } = require("../config/db");
const pendingUpgradeStore = require("../services/pendingUpgradeStore");
const customerStore = require("../services/customerModuleStore");
const { formatDateOnly } = require("../utils/lastPaymentDate");
const {
  resolveCustomerNumberFromInvoice,
  handleSubscriptionPaymentReceived,
} = require("../services/paymentReceivedHandler");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const { processZohoWebhookPayload } = require("../services/zohoWebhook.service");

function extractPaidInvoice(body) {
  if (!body || typeof body !== "object") return null;

  const invoice =
    body.invoice ||
    body.data?.invoice ||
    body.payload?.invoice ||
    (body.invoice_id ? body : null);

  if (!invoice?.invoice_id) return null;

  const status = String(invoice.status || "").toLowerCase();
  const balance =
    invoice.balance != null ? Number(invoice.balance) : null;

  const isPaid =
    status === "paid" ||
    (status === "partially_paid" && balance != null && balance <= 0);

  if (!isPaid) return null;
  return invoice;
}

async function zohoWebhook(req, res, next) {
  try {
    const configuredSecret = process.env.ZOHO_WEBHOOK_SECRET;
    const providedSecret =
      req.headers["x-zoho-webhook-secret"] ||
      req.headers["x-webhook-secret"] ||
      req.query.secret;

    if (configuredSecret && providedSecret !== configuredSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const invoice = extractPaidInvoice(req.body);
    if (invoice) {
      const result = await pendingUpgradeStore.tryCompleteUpgradeFromInvoice(
        String(invoice.invoice_id)
      );

      const customerRef = resolveCustomerNumberFromInvoice(invoice);
      const paymentDate = formatDateOnly(
        invoice.last_payment_date || invoice.payment_date || invoice.date
      );
      const amount =
        invoice.total != null
          ? Number(invoice.total)
          : invoice.amount != null
            ? Number(invoice.amount)
            : null;

      let reconciliation = null;
      if (customerRef && !result.completed) {
        try {
          reconciliation = await handleSubscriptionPaymentReceived({
            customerNumber: customerRef,
            amount,
            paymentDate,
            referenceId: `ZOHO-${invoice.invoice_id}`,
            source: "Zoho Books",
          });
        } catch (e) {
          console.error("Zoho webhook payment reconciliation failed:", e.message);
          reconciliation = { ok: false, error: e.message };
        }

        try {
          await integrationSnapshot.recordZohoPaymentByCustomerNumber(customerRef, {
            invoiceId: invoice.invoice_id,
            invoiceNumber: invoice.invoice_number,
            paymentId: `ZOHO-${invoice.invoice_id}`,
            amount,
            referenceId: `ZOHO-${invoice.invoice_id}`,
            paidAt: paymentDate,
            remainingBalance: invoice.balance != null ? Number(invoice.balance) : 0,
          });
        } catch (e) {
          console.warn("Zoho webhook snapshot update failed:", e.message);
        }
      }

      try {
        await processZohoWebhookPayload(req.body);
      } catch (e) {
        console.warn("Zoho webhook entity sync failed:", e.message);
      }

      return res.json({
        ok: true,
        handled: result.completed === true || reconciliation?.ok === true,
        invoiceId: String(invoice.invoice_id),
        upgrade: result,
        reconciliation,
      });
    }

    const generic = await processZohoWebhookPayload(req.body);
    return res.json({ ok: true, ...generic });
  } catch (err) {
    return next(err);
  }
}

async function getLoginStats(_req, res, next) {
  try {
    const [revenueRow] = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS total_revenue,
        COUNT(*) AS total_transactions,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
      FROM payment_transactions
    `);

    const [todayRow] = await query(`
      SELECT
        COUNT(*) AS transactions,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
      FROM payment_transactions
      WHERE DATE(created_at) = CURDATE()
    `);

    const [monthRow] = await query(`
      SELECT
        COUNT(*) AS transactions,
        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount ELSE 0 END), 0) AS revenue
      FROM payment_transactions
      WHERE YEAR(created_at) = YEAR(CURDATE())
        AND MONTH(created_at) = MONTH(CURDATE())
    `);

    const [returningRow] = await query(`
      SELECT COUNT(*) AS count FROM (
        SELECT phone FROM payment_transactions
        WHERE status = 'SUCCESS' AND phone IS NOT NULL AND phone != ''
        GROUP BY phone HAVING COUNT(*) > 1
      ) rc
    `);

    const [customersRow] = await query(`
      SELECT COUNT(*) AS count FROM customers WHERE status = 'active'
    `);

    const total = Number(revenueRow.total_transactions || 0);
    const success = Number(revenueRow.success_count || 0);

    return res.json({
      totalRevenue: Number(revenueRow.total_revenue || 0),
      totalTransactions: total,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      failedCount: Number(revenueRow.failed_count || 0),
      todayTransactions: Number(todayRow.transactions || 0),
      todayRevenue: Number(todayRow.revenue || 0),
      monthRevenue: Number(monthRow.revenue || 0),
      monthTransactions: Number(monthRow.transactions || 0),
      returningCustomers: Number(returningRow.count || 0),
      activeCustomers: Number(customersRow.count || 0),
      integrationsActive: 3,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getLoginStats, zohoWebhook };
