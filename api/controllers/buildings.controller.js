const store = require("../services/customerModuleStore");
const { emitAdminUpdate } = require("../lib/adminEvents");
const { logActivitySafe } = require("../services/activityLogStore");

async function listBuildings(req, res, next) {
  try {
    const { search, ipSetup, popId, page, limit, sortBy, sortDir } = req.query;
    const result = await store.listBuildings({
      search,
      ipSetup,
      popId,
      page,
      limit,
      sortBy,
      sortDir,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function createBuilding(req, res, next) {
  try {
    const {
      name,
      popId,
      buildingCode,
      ipPrefixes,
      addressAttention,
      addressStreet,
      addressStreet2,
      addressPoBox,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
    } = req.body || {};
    const id = await store.createBuilding({
      name,
      popId,
      buildingCode,
      ipPrefixes,
      addressAttention,
      addressStreet,
      addressStreet2,
      addressPoBox,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
    });
    const building = await store.getBuildingMapped(id);
    emitAdminUpdate("buildings", { action: "created", buildingId: id });
    await logActivitySafe({
      eventType: "building_created",
      title: "Building created",
      message: building?.name || `Building #${id}`,
      source: "admin",
      referenceId: String(id),
      metadata: { buildingId: id, popId: building?.popId },
    });
    return res.status(201).json({ ok: true, id, building });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_building_name")) {
        return res.status(409).json({ error: "A building with this name already exists" });
      }
      if (msg.includes("uk_building_pop_code")) {
        return res.status(409).json({ error: "Building code is already used under this POP" });
      }
      return res.status(409).json({ error: "Duplicate building record" });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function updateBuilding(req, res, next) {
  try {
    const id = Number(req.params.id);
    const {
      name,
      popId,
      buildingCode,
      ipPrefixes,
      addressAttention,
      addressStreet,
      addressStreet2,
      addressPoBox,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
    } = req.body || {};
    await store.updateBuilding(id, {
      name,
      popId,
      buildingCode,
      ipPrefixes,
      addressAttention,
      addressStreet,
      addressStreet2,
      addressPoBox,
      addressCity,
      addressState,
      addressZip,
      addressCountry,
    });
    const building = await store.getBuildingMapped(id);
    emitAdminUpdate("buildings", { action: "updated", buildingId: id });
    await logActivitySafe({
      eventType: "building_updated",
      title: "Building updated",
      message: building?.name || `Building #${id}`,
      source: "admin",
      referenceId: String(id),
      metadata: { buildingId: id, popId: building?.popId },
    });
    return res.json({ ok: true, building });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_building_pop_code")) {
        return res.status(409).json({ error: "Building code is already used under this POP" });
      }
      return res.status(409).json({ error: "Duplicate building record" });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function listBuildingOlts(req, res, next) {
  try {
    const buildingId = Number(req.params.id);
    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    const olts = await store.listBuildingOlts(buildingId);
    return res.json({ ok: true, olts, popId: building.pop_id });
  } catch (err) {
    return next(err);
  }
}

async function createBuildingOlt(req, res, next) {
  try {
    const buildingId = Number(req.params.id);
    const row = await store.createBuildingOlt(buildingId, req.body || {});
    const olt = store.mapPopOltRow(row);
    emitAdminUpdate("buildings", { action: "olt_created", buildingId });
    return res.status(201).json({ ok: true, olt });
  } catch (err) {
    if (err.message === "Building not found" || err.message === "POP not found") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function updateBuildingOlt(req, res, next) {
  try {
    const buildingId = Number(req.params.id);
    const oltId = Number(req.params.oltId);
    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    const existing = await store.getPopOltById(oltId);
    if (!existing || Number(existing.pop_id) !== Number(building.pop_id)) {
      return res.status(404).json({ error: "OLT not found" });
    }
    const row = await store.updateBuildingOlt(oltId, req.body || {});
    const olt = store.mapPopOltRow(row);
    emitAdminUpdate("buildings", { action: "olt_updated", buildingId, oltId });
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

async function deleteBuildingOlt(req, res, next) {
  try {
    const buildingId = Number(req.params.id);
    const oltId = Number(req.params.oltId);
    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }
    const existing = await store.getPopOltById(oltId);
    if (!existing || Number(existing.pop_id) !== Number(building.pop_id)) {
      return res.status(404).json({ error: "OLT not found" });
    }
    await store.deleteBuildingOlt(oltId);
    emitAdminUpdate("buildings", { action: "olt_deleted", buildingId, oltId });
    return res.json({ ok: true });
  } catch (err) {
    if (err.message) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

module.exports = {
  listBuildings,
  createBuilding,
  updateBuilding,
  listBuildingOlts,
  createBuildingOlt,
  updateBuildingOlt,
  deleteBuildingOlt,
};
