const { query } = require("../config/db");
const store = require("./customerModuleStore");
const { logActivity } = require("./activityLogStore");

function mapPendingRow(row) {
  if (!row) return null;
  let quote = null;
  if (row.quote_json) {
    try {
      quote =
        typeof row.quote_json === "string"
          ? JSON.parse(row.quote_json)
          : row.quote_json;
    } catch {
      quote = null;
    }
  }
  return {
    id: row.id,
    customerId: row.customer_id,
    targetProductId: row.target_product_id,
    paymentMethod: row.payment_method,
    topUpAmount: Number(row.top_up_amount),
    status: row.status,
    zohoInvoiceId: row.zoho_invoice_id,
    zohoInvoiceNumber: row.zoho_invoice_number,
    mpesaCheckoutRequestId: row.mpesa_checkout_request_id,
    quote,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    targetProductMbps: row.target_product_mbps ?? null,
    targetProductName: row.target_product_name ?? null,
  };
}

async function getActivePendingUpgrade(customerId) {
  const rows = await query(
    `SELECT pu.*, p.mbps AS target_product_mbps, p.name AS target_product_name
     FROM pending_upgrades pu
     JOIN products p ON p.id = pu.target_product_id
     WHERE pu.customer_id = ? AND pu.status = 'payment_pending'
     ORDER BY pu.created_at DESC
     LIMIT 1`,
    [customerId]
  );
  return mapPendingRow(rows[0]);
}

async function getPendingUpgradeById(id) {
  const rows = await query(
    `SELECT pu.*, p.mbps AS target_product_mbps, p.name AS target_product_name
     FROM pending_upgrades pu
     JOIN products p ON p.id = pu.target_product_id
     WHERE pu.id = ?
     LIMIT 1`,
    [id]
  );
  return mapPendingRow(rows[0]);
}

async function findPendingByCheckoutRequestId(checkoutRequestId) {
  if (!checkoutRequestId) return null;
  const rows = await query(
    `SELECT pu.*, p.mbps AS target_product_mbps, p.name AS target_product_name
     FROM pending_upgrades pu
     JOIN products p ON p.id = pu.target_product_id
     WHERE pu.mpesa_checkout_request_id = ? AND pu.status = 'payment_pending'
     LIMIT 1`,
    [String(checkoutRequestId)]
  );
  return mapPendingRow(rows[0]);
}

async function findPendingByZohoInvoiceId(invoiceId) {
  if (!invoiceId) return null;
  const rows = await query(
    `SELECT pu.*, p.mbps AS target_product_mbps, p.name AS target_product_name
     FROM pending_upgrades pu
     JOIN products p ON p.id = pu.target_product_id
     WHERE pu.zoho_invoice_id = ? AND pu.status = 'payment_pending'
     LIMIT 1`,
    [String(invoiceId)]
  );
  return mapPendingRow(rows[0]);
}

async function setCustomerUpgradePaymentStatus(customerId, status) {
  await query(`UPDATE customers SET upgrade_payment_status = ? WHERE id = ?`, [
    status,
    customerId,
  ]);
}

async function createPendingUpgrade({
  customerId,
  targetProductId,
  paymentMethod,
  topUpAmount,
  quote,
  zohoInvoiceId = null,
  zohoInvoiceNumber = null,
  mpesaCheckoutRequestId = null,
}) {
  const existing = await getActivePendingUpgrade(customerId);
  if (existing) {
    throw new Error(
      "Customer already has a pending upgrade awaiting payment. Complete or cancel it first."
    );
  }

  const result = await query(
    `INSERT INTO pending_upgrades
       (customer_id, target_product_id, payment_method, top_up_amount, status,
        zoho_invoice_id, zoho_invoice_number, mpesa_checkout_request_id, quote_json)
     VALUES (?, ?, ?, ?, 'payment_pending', ?, ?, ?, ?)`,
    [
      customerId,
      targetProductId,
      paymentMethod,
      topUpAmount,
      zohoInvoiceId,
      zohoInvoiceNumber,
      mpesaCheckoutRequestId,
      quote ? JSON.stringify(quote) : null,
    ]
  );

  await setCustomerUpgradePaymentStatus(customerId, "payment_pending");
  return getPendingUpgradeById(result.insertId);
}

async function attachCheckoutToPendingUpgrade(pendingId, checkoutRequestId) {
  await query(
    `UPDATE pending_upgrades SET mpesa_checkout_request_id = ? WHERE id = ?`,
    [String(checkoutRequestId), pendingId]
  );
}

async function cancelPendingUpgrade(pendingId) {
  const pending = await getPendingUpgradeById(pendingId);
  if (!pending || pending.status !== "payment_pending") return null;
  await query(
    `UPDATE pending_upgrades SET status = 'cancelled', completed_at = NOW() WHERE id = ?`,
    [pendingId]
  );
  await setCustomerUpgradePaymentStatus(pending.customerId, "none");
  return getPendingUpgradeById(pendingId);
}

async function completePendingUpgrade(pendingId) {
  const pending = await getPendingUpgradeById(pendingId);
  if (!pending) return { ok: false, reason: "not_found" };
  if (pending.status !== "payment_pending") {
    return { ok: false, reason: "not_pending", status: pending.status };
  }

  const customer = await store.getCustomerContext(pending.customerId);
  if (!customer || customer.status !== "active") {
    await query(
      `UPDATE pending_upgrades SET status = 'failed', completed_at = NOW() WHERE id = ?`,
      [pendingId]
    );
    await setCustomerUpgradePaymentStatus(pending.customerId, "none");
    return { ok: false, reason: "customer_inactive" };
  }

  const currentMbps = customer.product_mbps;
  const quote = pending.quote || {};
  if (quote.paymentFrequency) {
    await store.updateCustomerBillingCycle(
      pending.customerId,
      quote.paymentFrequency,
      quote.customPeriodDays
    );
  }

  await store.changeCustomerProduct(
    pending.customerId,
    pending.targetProductId,
    "upgrade"
  );

  const ctx = await store.getCustomerContext(pending.customerId);
  let tispError = null;
  let zohoError = null;
  try {
    const {
      pushCustomerToTisp,
      runZohoSyncForCustomer,
    } = require("../controllers/customers.controller");
    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (e) {
      tispError = e.message;
    }
    try {
      const zoho = await runZohoSyncForCustomer(pending.customerId, {
        syncRecurring: true,
      });
      if (zoho && zoho.ok === false) {
        zohoError = zoho.error || "Zoho sync failed";
      }
    } catch (e) {
      zohoError = e.message;
    }
  } catch (e) {
    tispError = e.message;
  }

  await query(
    `UPDATE pending_upgrades SET status = 'completed', completed_at = NOW() WHERE id = ?`,
    [pendingId]
  );
  await setCustomerUpgradePaymentStatus(pending.customerId, "none");

  const customerRow = await store.getCustomerById(pending.customerId);

  try {
    await logActivity({
      eventType: "upgrade_payment_completed",
      title: "Upgrade completed after payment",
      message: `${customerRow?.customerNumber}: ${currentMbps} → ${pending.targetProductMbps} Mbps${
        zohoError ? ` · Zoho: ${zohoError}` : ""
      }`,
      source: "tisp",
      status: tispError || zohoError ? "failed" : "success",
      customerRef: customerRow?.customerNumber,
      amount: pending.topUpAmount,
      referenceId: pending.zohoInvoiceId || pending.mpesaCheckoutRequestId,
    });
  } catch (logErr) {
    console.error("activity log (upgrade complete) failed:", logErr.message);
  }

  try {
    await logActivity({
      eventType: "customer_upgraded",
      title: "Customer package upgraded",
      message: `${customerRow?.customerNumber}: ${currentMbps} → ${pending.targetProductMbps} Mbps`,
      source: "tisp",
      status: tispError ? "failed" : "success",
      customerRef: customerRow?.customerNumber,
    });
  } catch (logErr) {
    console.error("activity log (upgrade) failed:", logErr.message);
  }

  return {
    ok: true,
    customer: customerRow,
    tispError,
    zohoError,
    pendingUpgradeId: pendingId,
  };
}

async function tryCompleteUpgradeFromStk({ checkoutRequestId }) {
  const pending = await findPendingByCheckoutRequestId(checkoutRequestId);
  if (!pending) return { completed: false };
  const result = await completePendingUpgrade(pending.id);
  return { completed: true, ...result };
}

async function tryCompleteUpgradeFromInvoice(invoiceId) {
  const pending = await findPendingByZohoInvoiceId(invoiceId);
  if (!pending) return { completed: false };
  const result = await completePendingUpgrade(pending.id);
  return { completed: true, ...result };
}

module.exports = {
  getActivePendingUpgrade,
  getPendingUpgradeById,
  findPendingByCheckoutRequestId,
  findPendingByZohoInvoiceId,
  createPendingUpgrade,
  attachCheckoutToPendingUpgrade,
  cancelPendingUpgrade,
  completePendingUpgrade,
  tryCompleteUpgradeFromStk,
  tryCompleteUpgradeFromInvoice,
  setCustomerUpgradePaymentStatus,
};
