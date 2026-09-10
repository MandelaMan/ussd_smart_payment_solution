const store = require("../services/customerModuleStore");
const { emitAdminUpdate } = require("../lib/adminEvents");
const { logActivitySafe } = require("../services/activityLogStore");
const { syncProductToTispSafe, tispLabelFromProduct } = require("./tisp.controller");
const {
  syncAssignedCustomersAfterProductChange,
  migrateAssignedCustomers,
} = require("../services/productAssignedCustomerSync");

async function listProducts(req, res, next) {
  try {
    let {
      buildingId,
      paymentFrequency,
      categoryId,
      planId,
      activeOnly,
      search,
      page,
      limit,
      unpaginated,
      sortBy,
      sortDir,
    } = req.query;
    if (paymentFrequency === "custom") paymentFrequency = "monthly";
    const result = await store.listProducts({
      buildingId: buildingId ? Number(buildingId) : undefined,
      paymentFrequency: paymentFrequency || undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      planId: planId ? Number(planId) : undefined,
      activeOnly: activeOnly !== "false",
      search,
      page,
      limit,
      unpaginated: unpaginated === "true",
      sortBy,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function createProduct(req, res, next) {
  try {
    const { planVariantId, buildingId, mbps, price, monthlyPrice, extraBandwidth } = req.body || {};

    if (!planVariantId || !buildingId || price == null) {
      return res.status(400).json({
        error: "Category plan, billing frequency, building, and price are required",
      });
    }

    const id = await store.createProduct({
      planVariantId: Number(planVariantId),
      buildingId: Number(buildingId),
      mbps: mbps != null ? Number(mbps) : undefined,
      price: Number(price),
      monthlyPrice:
        monthlyPrice != null ? Number(monthlyPrice) : undefined,
      extraBandwidth:
        extraBandwidth != null ? Number(extraBandwidth) : undefined,
    });
    const product = await store.getProductListRow(Number(id));
    const tisp = product
      ? await syncProductToTispSafe(product)
      : { ok: false, error: "Saved package could not be reloaded for TISP" };
    emitAdminUpdate("products", { action: "created", productId: id, buildingId: Number(buildingId) });
    await logActivitySafe({
      eventType: "product_created",
      title: "Package created",
      message: `Package #${id} · building ${buildingId}${
        mbps != null ? ` · ${mbps} Mbps` : ""
      }`,
      source: "admin",
      referenceId: String(id),
      amount: price != null ? Number(price) : null,
      metadata: {
        productId: id,
        buildingId: Number(buildingId),
        tispOk: tisp?.ok !== false,
        tispPackage: tisp?.packageLabel || null,
        tispError: tisp?.error || null,
      },
    });
    return res.status(201).json({ ok: true, id, tisp });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_products_building_price")) {
        return res.status(409).json({
          error: "Another package in this building already uses this price",
        });
      }
      return res.status(409).json({
        error:
          "A price for this package variant already exists for the selected building",
      });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const before = await store.getProductListRow(Number(req.params.id));
    const previousPackageLabel = tispLabelFromProduct(before);
    const product = await store.updateProduct(Number(req.params.id), req.body || {});
    const tisp = await syncProductToTispSafe(product, { previousPackageLabel });
    const productId = product?.id ?? Number(req.params.id);
    const billing = await syncAssignedCustomersAfterProductChange(productId, {
      before,
      after: product,
    });
    emitAdminUpdate("products", {
      action: "updated",
      productId: product?.id ?? Number(req.params.id),
      buildingId: product?.buildingId ?? null,
    });
    await logActivitySafe({
      eventType: "product_updated",
      title: "Package updated",
      message: product?.name
        ? String(product.name)
        : `Package #${productId}`,
      source: "admin",
      referenceId: String(productId),
      amount: product?.price != null ? Number(product.price) : null,
      metadata: {
        productId,
        buildingId: product?.buildingId ?? null,
        tispOk: tisp?.ok !== false,
        tispPackage: tisp?.packageLabel || null,
        tispError: tisp?.error || null,
        billingCustomers: billing.customers,
        zohoUpdated: billing.zohoUpdated,
        zohoFailed: billing.zohoFailed,
        tispFailed: billing.tispFailed,
      },
    });
    return res.json({ ok: true, product, tisp, billing });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_products_building_price")) {
        return res.status(409).json({
          error: "Another package in this building already uses this price",
        });
      }
      if (msg.includes("uk_product_building_variant")) {
        return res.status(409).json({
          error:
            "A price for this package variant already exists for the selected building",
        });
      }
      return res.status(409).json({ error: "Duplicate package record" });
    }
    if (err.message === "Product not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const productId = Number(req.params.id);
    const targetProductId = Number(
      req.body?.targetProductId ?? req.query?.targetProductId ?? 0
    );
    const assigned = await store.listCustomersOnProduct(productId);
    let billing = null;
    if (assigned.length) {
      if (!targetProductId) {
        return res.status(409).json({
          error: `This package has ${assigned.length} customer${
            assigned.length === 1 ? "" : "s"
          }. Choose another package in the same building to move them to.`,
          code: "PACKAGE_HAS_CUSTOMERS",
          customerCount: assigned.length,
        });
      }
      billing = await migrateAssignedCustomers(productId, targetProductId);
    }
    const result = await store.deleteProduct(productId);
    emitAdminUpdate("products", {
      action: "deleted",
      productId,
    });
    await logActivitySafe({
      eventType: "product_deleted",
      title: "Package deleted",
      message: `Package #${productId}`,
      source: "admin",
      referenceId: String(productId),
      metadata: {
        productId,
        targetProductId: targetProductId || null,
        billingCustomers: billing?.customers || 0,
        zohoUpdated: billing?.zohoUpdated || 0,
        zohoFailed: billing?.zohoFailed || 0,
      },
    });
    return res.json({ ok: true, ...result, billing });
  } catch (err) {
    if (err.message === "Product not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.code === "PACKAGE_HAS_CUSTOMERS") {
      return res.status(409).json({
        error: err.message,
        code: err.code,
        customerCount: err.customerCount || 0,
      });
    }
    if (err.code === "TARGET_PRODUCT_REQUIRED" || err.code === "TARGET_PRODUCT_BUILDING") {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.code === "ER_ROW_IS_REFERENCED_2" || err.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({
        error:
          "Cannot delete package — it is still referenced by other records. Mark it inactive instead.",
      });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = { listProducts, createProduct, updateProduct, deleteProduct };
