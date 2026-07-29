const store = require("../services/customerModuleStore");
const { emitAdminUpdate } = require("../lib/adminEvents");

async function listBuildings(req, res, next) {
  try {
    const { search, ipSetup, page, limit, sortBy, sortDir } = req.query;
    const result = await store.listBuildings({
      search,
      ipSetup,
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
    const { name, c2bCode, b2bCode, ipSetup, dstvSetup, ipPrefixes } =
      req.body || {};
    const id = await store.createBuilding({
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      dstvSetup,
      ipPrefixes,
    });
    const building = await store.getBuildingMapped(id);
    emitAdminUpdate("buildings", { action: "created", buildingId: id });
    return res.status(201).json({ ok: true, id, building });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      const msg = String(err.message || "");
      if (msg.includes("uk_building_name")) {
        return res.status(409).json({ error: "A building with this name already exists" });
      }
      if (msg.includes("uk_building_c2b")) {
        return res.status(409).json({ error: "C2B code is already in use" });
      }
      if (msg.includes("uk_building_b2b")) {
        return res.status(409).json({ error: "B2B code is already in use" });
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
    const { name, c2bCode, b2bCode, ipSetup, dstvSetup, ipPrefixes } =
      req.body || {};
    await store.updateBuilding(id, {
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      dstvSetup,
      ipPrefixes,
    });
    const building = await store.getBuildingMapped(id);
    emitAdminUpdate("buildings", { action: "updated", buildingId: id });
    return res.json({ ok: true, building });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
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
    return res.json({ ok: true, olts });
  } catch (err) {
    return next(err);
  }
}

async function createBuildingOlt(req, res, next) {
  try {
    const buildingId = Number(req.params.id);
    const row = await store.createBuildingOlt(buildingId, req.body || {});
    const olt = store.mapBuildingOltRow(row);
    emitAdminUpdate("buildings", { action: "olt_created", buildingId });
    return res.status(201).json({ ok: true, olt });
  } catch (err) {
    if (err.message === "Building not found") {
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
    const existing = await store.getBuildingOltById(oltId);
    if (!existing || Number(existing.building_id) !== buildingId) {
      return res.status(404).json({ error: "OLT not found" });
    }
    const row = await store.updateBuildingOlt(oltId, req.body || {});
    const olt = store.mapBuildingOltRow(row);
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
    const existing = await store.getBuildingOltById(oltId);
    if (!existing || Number(existing.building_id) !== buildingId) {
      return res.status(404).json({ error: "OLT not found" });
    }
    await store.deleteBuildingOlt(oltId);
    emitAdminUpdate("buildings", { action: "olt_deleted", buildingId, oltId });
    return res.json({ ok: true });
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

module.exports = {
  listBuildings,
  createBuilding,
  updateBuilding,
  listBuildingOlts,
  createBuildingOlt,
  updateBuildingOlt,
  deleteBuildingOlt,
};
