const store = require("../services/customerModuleStore");
const { emitAdminUpdate } = require("../lib/adminEvents");
const { logActivitySafe } = require("../services/activityLogStore");

async function listPops(req, res, next) {
  try {
    const { search, ipSetup } = req.query;
    const result = await store.listPops({ search, ipSetup });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function createPop(req, res, next) {
  try {
    const { name, c2bCode, b2bCode, ipSetup, dstvSetup, ipPrefixes } =
      req.body || {};
    const id = await store.createPop({
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      dstvSetup,
      ipPrefixes,
    });
    const pop = await store.getPopMapped(id);
    emitAdminUpdate("pops", { action: "created", popId: id });
    emitAdminUpdate("buildings", { action: "pop_created", popId: id });
    await logActivitySafe({
      eventType: "building_created",
      title: "POP created",
      message: pop?.name || `POP #${id}`,
      source: "admin",
      referenceId: String(id),
      metadata: { popId: id },
    });
    return res.status(201).json({ ok: true, id, pop });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_pop_name")) {
        return res.status(409).json({ error: "A POP with this name already exists" });
      }
      if (msg.includes("uk_pop_c2b")) {
        return res.status(409).json({ error: "C2B code is already in use" });
      }
      if (msg.includes("uk_pop_b2b")) {
        return res.status(409).json({ error: "B2B code is already in use" });
      }
      return res.status(409).json({ error: "Duplicate POP record" });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function updatePop(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { name, c2bCode, b2bCode, ipSetup, dstvSetup, ipPrefixes } =
      req.body || {};
    await store.updatePop(id, {
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      dstvSetup,
      ipPrefixes,
    });
    const pop = await store.getPopMapped(id);
    emitAdminUpdate("pops", { action: "updated", popId: id });
    emitAdminUpdate("buildings", { action: "pop_updated", popId: id });
    await logActivitySafe({
      eventType: "building_updated",
      title: "POP updated",
      message: pop?.name || `POP #${id}`,
      source: "admin",
      referenceId: String(id),
      metadata: { popId: id },
    });
    return res.json({ ok: true, pop });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Duplicate POP record" });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function listPopOlts(req, res, next) {
  try {
    const popId = Number(req.params.id);
    const pop = await store.getPopById(popId);
    if (!pop) {
      return res.status(404).json({ error: "POP not found" });
    }
    const olts = await store.listPopOlts(popId);
    return res.json({ ok: true, olts });
  } catch (err) {
    return next(err);
  }
}

async function createPopOlt(req, res, next) {
  try {
    const popId = Number(req.params.id);
    const row = await store.createPopOlt(popId, req.body || {});
    const olt = store.mapPopOltRow(row);
    emitAdminUpdate("pops", { action: "olt_created", popId });
    emitAdminUpdate("buildings", { action: "olt_created", popId });
    return res.status(201).json({ ok: true, olt });
  } catch (err) {
    if (err.message === "POP not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function updatePopOlt(req, res, next) {
  try {
    const popId = Number(req.params.id);
    const oltId = Number(req.params.oltId);
    const existing = await store.getPopOltById(oltId);
    if (!existing || Number(existing.pop_id) !== popId) {
      return res.status(404).json({ error: "OLT not found" });
    }
    const row = await store.updatePopOlt(oltId, req.body || {});
    const olt = store.mapPopOltRow(row);
    emitAdminUpdate("pops", { action: "olt_updated", popId, oltId });
    emitAdminUpdate("buildings", { action: "olt_updated", popId, oltId });
    return res.json({ ok: true, olt });
  } catch (err) {
    if (err.message === "OLT not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function deletePopOlt(req, res, next) {
  try {
    const popId = Number(req.params.id);
    const oltId = Number(req.params.oltId);
    const existing = await store.getPopOltById(oltId);
    if (!existing || Number(existing.pop_id) !== popId) {
      return res.status(404).json({ error: "OLT not found" });
    }
    await store.deletePopOlt(oltId);
    emitAdminUpdate("pops", { action: "olt_deleted", popId, oltId });
    emitAdminUpdate("buildings", { action: "olt_deleted", popId, oltId });
    return res.json({ ok: true });
  } catch (err) {
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  listPops,
  createPop,
  updatePop,
  listPopOlts,
  createPopOlt,
  updatePopOlt,
  deletePopOlt,
};
