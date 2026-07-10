const store = require("../services/customerModuleStore");

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
    return res.status(201).json({ ok: true, id });
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
    const product = await store.updateProduct(Number(req.params.id), req.body || {});
    return res.json({ ok: true, product });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_products_building_price")) {
        return res.status(409).json({
          error: "Another package in this building already uses this price",
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

module.exports = { listProducts, createProduct, updateProduct };
