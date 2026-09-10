const { query } = require("../config/db");
const store = require("./customerModuleStore");
const { isB2BCustomer } = require("../utils/b2bBilling");
const {
  emptyBillingSync,
  isProductBillingRelevantChange,
  productFrequencyChanged,
} = require("../utils/productBillingChange");

function isSyncableCustomerStatus(status) {
  const value = String(status || "").toLowerCase();
  return value === "active" || value === "paused";
}

async function applyCatalogPriceToCustomers(productId, { alignPaymentFrequency = false } = {}) {
  const product = await store.getProductById(productId);
  if (!product) throw new Error("Product not found");
  const customers = await store.listCustomersOnProduct(productId);
  for (const customer of customers) {
    let frequency = customer.payment_frequency;
    let days = customer.custom_period_days;
    if (alignPaymentFrequency && frequency !== "custom") {
      frequency = product.payment_frequency;
      days = null;
    }
    const packagePrice = store.resolvePackagePrice(product, frequency, days);
    await query(
      `UPDATE customers
       SET package_price = ?, payment_frequency = ?, custom_period_days = ?
       WHERE id = ?`,
      [packagePrice, frequency, frequency === "custom" ? days : null, customer.id]
    );
  }
  return customers;
}

async function syncCustomerIntegrations(customerIds) {
  const summary = emptyBillingSync();
  summary.customers = customerIds.length;
  if (!customerIds.length) return summary;

  const { runZohoSyncForCustomer, pushCustomerToTisp } = require("../controllers/customers.controller");
  const { refreshAgencyRecurring } = require("./agencyZohoBilling");
  const agencyIds = new Set();

  for (const customerId of customerIds) {
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx || !isSyncableCustomerStatus(ctx.status)) continue;
    summary.active += 1;

    if (isB2BCustomer({ customerType: ctx.customer_type })) {
      summary.zohoSkipped += 1;
      if (ctx.agency_id) agencyIds.add(Number(ctx.agency_id));
    } else {
      const zoho = await runZohoSyncForCustomer(customerId, { syncRecurring: true });
      if (zoho?.ok === false) {
        summary.zohoFailed += 1;
        summary.errors.push({
          customerId,
          customerNumber: ctx.customer_number || null,
          system: "zoho",
          error: zoho.error || "Zoho sync failed",
        });
      } else if (zoho?.skipped) {
        summary.zohoSkipped += 1;
      } else {
        summary.zohoUpdated += 1;
      }
    }

    try {
      await pushCustomerToTisp(ctx, { skipCooldown: true });
    } catch (err) {
      summary.tispFailed += 1;
      summary.errors.push({
        customerId,
        customerNumber: ctx.customer_number || null,
        system: "tisp",
        error: err.message || "TISP sync failed",
      });
    }
  }

  for (const agencyId of agencyIds) {
    try {
      await refreshAgencyRecurring(agencyId);
      summary.agencyUpdated += 1;
    } catch (err) {
      summary.errors.push({
        agencyId,
        system: "zoho",
        error: err.message || "Agency recurring refresh failed",
      });
    }
  }

  return summary;
}

async function syncAssignedCustomersAfterProductChange(productId, { before, after } = {}) {
  if (before && after && !isProductBillingRelevantChange(before, after)) {
    return emptyBillingSync();
  }
  const customers = await applyCatalogPriceToCustomers(productId, {
    alignPaymentFrequency: productFrequencyChanged(before, after),
  });
  return syncCustomerIntegrations(customers.map((row) => Number(row.id)));
}

async function migrateAssignedCustomers(fromProductId, toProductId) {
  const sourceId = Number(fromProductId);
  const targetId = Number(toProductId);
  if (!targetId || targetId === sourceId) {
    const err = new Error("Choose a different package in the same building");
    err.code = "TARGET_PRODUCT_REQUIRED";
    throw err;
  }

  const source = await store.getProductById(sourceId);
  const target = await store.getProductById(targetId);
  if (!source) throw new Error("Product not found");
  if (!target) throw new Error("Destination package not found");
  if (Number(target.building_id) !== Number(source.building_id)) {
    const err = new Error("Destination package must belong to the same building");
    err.code = "TARGET_PRODUCT_BUILDING";
    throw err;
  }

  const customers = await store.listCustomersOnProduct(sourceId);
  if (!customers.length) {
    return emptyBillingSync();
  }

  for (const customer of customers) {
    const status = String(customer.status || "").toLowerCase();
    if (status === "active") {
      await store.changeCustomerProduct(customer.id, targetId, "reassign");
      if (
        customer.payment_frequency !== "custom" &&
        target.payment_frequency &&
        customer.payment_frequency !== target.payment_frequency
      ) {
        await store.updateCustomerBillingCycle(
          customer.id,
          target.payment_frequency,
          null
        );
      }
    } else {
      const frequency =
        customer.payment_frequency === "custom"
          ? "custom"
          : target.payment_frequency || customer.payment_frequency;
      const days = frequency === "custom" ? customer.custom_period_days : null;
      const packagePrice = store.resolvePackagePrice(target, frequency, days);
      await query(
        `UPDATE customers
         SET product_id = ?, package_price = ?, payment_frequency = ?, custom_period_days = ?
         WHERE id = ?`,
        [targetId, packagePrice, frequency, days, customer.id]
      );
    }
  }

  const summary = await syncCustomerIntegrations(
    customers.filter((row) => isSyncableCustomerStatus(row.status)).map((row) => Number(row.id))
  );
  summary.customers = customers.length;
  return summary;
}

module.exports = {
  emptyBillingSync,
  isProductBillingRelevantChange,
  productFrequencyChanged,
  applyCatalogPriceToCustomers,
  syncAssignedCustomersAfterProductChange,
  migrateAssignedCustomers,
};
