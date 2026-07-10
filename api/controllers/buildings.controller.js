const store = require("../services/customerModuleStore");

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
    const { name, c2bCode, b2bCode, ipSetup, ipPrefixes } = req.body || {};
    const id = await store.createBuilding({
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      ipPrefixes,
    });
    const result = await store.listBuildings({ limit: 1, page: 1 });
    const building = result.buildings.find((b) => b.id === id);
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
    const { name, c2bCode, b2bCode, ipSetup, ipPrefixes } = req.body || {};
    await store.updateBuilding(id, {
      name,
      c2bCode,
      b2bCode,
      ipSetup,
      ipPrefixes,
    });
    const row = await store.getBuildingById(id);
    const building = row ? store.mapBuildingRow(row) : null;
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

module.exports = { listBuildings, createBuilding, updateBuilding };
