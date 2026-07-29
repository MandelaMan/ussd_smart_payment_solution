const oltEmsService = require("../services/oltEmsService");
const store = require("../services/customerModuleStore");

async function resolveBuildingOltTarget(buildingId, buildingOltId) {
  if (buildingOltId) {
    const olt = await store.getBuildingOltById(Number(buildingOltId));
    if (!olt || Number(olt.building_id) !== Number(buildingId)) {
      return { error: { status: 404, message: "Building OLT not found" } };
    }
    return { olt, target: oltEmsService.resolveEmsTarget(olt) };
  }

  const olts = await store.listBuildingOlts(buildingId);
  if (!olts.length) {
    return {
      error: {
        status: 400,
        message: "No OLTs configured for this building",
      },
    };
  }
  if (olts.length > 1) {
    return {
      error: {
        status: 400,
        message: "buildingOltId is required when the building has multiple OLTs",
      },
    };
  }

  const raw = await store.getBuildingOltById(olts[0].id);
  return { olt: raw, target: oltEmsService.resolveEmsTarget(raw) };
}

async function listOnus(req, res, next) {
  try {
    const buildingId = Number(req.query.buildingId);
    if (!buildingId) {
      return res.status(400).json({
        error: "buildingId is required (OLT settings are stored per building)",
      });
    }

    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }

    const resolved = await resolveBuildingOltTarget(
      buildingId,
      req.query.buildingOltId
    );
    if (resolved.error) {
      return res
        .status(resolved.error.status)
        .json({ error: resolved.error.message });
    }

    const { olt, target } = resolved;
    if (!oltEmsService.isOltTargetConfigured(target)) {
      return res.status(400).json({
        error:
          "Building OLT is incomplete — set host, MAC, username and password",
      });
    }

    const portIndex = Number(req.query.portIndex || 1);
    const indexStr = String(req.query.indexStr || "0-0-1-1-0").trim();
    const onus = await oltEmsService.getOnuList({
      oltMac: target.mac,
      portIndex,
      indexStr,
      target,
    });

    const items = (onus || []).map((onu) => ({
      authOnu: onu.authOnu,
      authPon: onu.authPon,
      authSlot: onu.authSlot,
      authPonType: onu.authPonType,
      adminStatus: onu.adminStatus,
      phaseStatus: onu.phaseStatus,
      authMode: onu.authMode,
      authInfo: onu.authInfo,
      description: onu.description,
      onuModel: onu.onuModel,
      onuType: onu.onuType,
      onuRttDistance: onu.onuRttDistance,
      indexStr: oltEmsService.buildIndexStrFromOnu(onu),
    }));

    return res.json({
      ok: true,
      buildingId,
      buildingOltId: olt.id,
      oltMac: target.mac,
      portIndex,
      indexStr,
      count: items.length,
      onus: items,
    });
  } catch (err) {
    return next(err);
  }
}

async function getOnuAbility(req, res, next) {
  try {
    const buildingId = Number(req.query.buildingId);
    if (!buildingId) {
      return res.status(400).json({ error: "buildingId is required" });
    }

    const building = await store.getBuildingById(buildingId);
    if (!building) {
      return res.status(404).json({ error: "Building not found" });
    }

    const resolved = await resolveBuildingOltTarget(
      buildingId,
      req.query.buildingOltId
    );
    if (resolved.error) {
      return res
        .status(resolved.error.status)
        .json({ error: resolved.error.message });
    }

    const { target } = resolved;
    if (!oltEmsService.isOltTargetConfigured(target)) {
      return res.status(400).json({
        error:
          "Building OLT is incomplete — set host, MAC, username and password",
      });
    }

    const indexStr = String(req.query.indexStr || "").trim();
    const onuIndex = Number(req.query.onuIndex || 1);
    const portIndex = Number(req.query.portIndex || 1);
    const slotIndex = Number(req.query.slotIndex || 0);

    if (!indexStr) {
      return res.status(400).json({ error: "indexStr is required" });
    }

    const ability = await oltEmsService.getOnuAbility({
      oltMac: target.mac,
      indexStr,
      onuIndex,
      portIndex,
      slotIndex,
      target,
    });

    return res.json({ ok: true, ability });
  } catch (err) {
    return next(err);
  }
}

async function loadRawBuildingOlts(buildingId) {
  const mapped = await store.listBuildingOlts(buildingId);
  const rows = [];
  for (const item of mapped) {
    if (!item.isActive) continue;
    const raw = await store.getBuildingOltById(item.id);
    if (raw) rows.push(raw);
  }
  return rows;
}

async function getCustomerOltStatus(req, res, next) {
  try {
    const customerId = Number(req.params.id);
    const ctx = await store.getCustomerContext(customerId);
    if (!ctx) {
      return res.status(404).json({ error: "Customer not found" });
    }

    let status;
    const linkedTarget = oltEmsService.resolveEmsTarget(ctx);
    if (oltEmsService.isOltTargetConfigured(linkedTarget)) {
      status = await oltEmsService.getCustomerOltStatus(ctx);
      status.buildingOltId =
        ctx.building_olt_id || ctx.linked_building_olt_id || null;
      status.buildingOltName = ctx.building_olt_name || null;
    } else {
      const oltRows = await loadRawBuildingOlts(ctx.building_id);
      if (!oltRows.length) {
        status = {
          ok: true,
          skipped: true,
          reason: "no_building_olt_host",
          building: {
            host: null,
            port: null,
            mac: null,
            username: null,
            configured: false,
          },
          onu: null,
          match: null,
        };
      } else {
        status = await oltEmsService.getCustomerOltStatusAcrossOlts(
          ctx,
          oltRows
        );
      }
    }

    return res.json({
      ok: status.ok,
      skipped: status.skipped || false,
      reason: status.reason || null,
      error: status.error || null,
      building: status.building,
      buildingOltId: status.buildingOltId || null,
      buildingOltName: status.buildingOltName || null,
      match: status.match,
      onu: status.onu,
      onuCount: status.onuCount ?? null,
      linked: {
        buildingOltId: ctx.building_olt_id || null,
        oltMac: ctx.olt_mac || ctx.building_olt_mac || null,
        onuIndexStr: ctx.onu_index_str || null,
        onuSn: ctx.onu_sn || null,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listOnus,
  getOnuAbility,
  getCustomerOltStatus,
};
