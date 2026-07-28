const oltEmsService = require("../services/oltEmsService");

async function listOnus(req, res, next) {
  try {
    if (!oltEmsService.isOltEmsConfigured()) {
      return res.status(503).json({ error: "OLT EMS is not configured" });
    }

    const oltMac =
      String(req.query.oltMac || process.env.OLT_EMS_DEFAULT_MAC || "").trim();
    if (!oltMac) {
      return res.status(400).json({ error: "oltMac is required" });
    }

    const portIndex = Number(req.query.portIndex || 1);
    const indexStr = String(req.query.indexStr || "0-0-1-1-0").trim();
    const onus = await oltEmsService.getOnuList({
      oltMac,
      portIndex,
      indexStr,
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
      oltMac,
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
    if (!oltEmsService.isOltEmsConfigured()) {
      return res.status(503).json({ error: "OLT EMS is not configured" });
    }

    const oltMac =
      String(req.query.oltMac || process.env.OLT_EMS_DEFAULT_MAC || "").trim();
    const indexStr = String(req.query.indexStr || "").trim();
    const onuIndex = Number(req.query.onuIndex || 1);
    const portIndex = Number(req.query.portIndex || 1);
    const slotIndex = Number(req.query.slotIndex || 0);

    if (!oltMac || !indexStr) {
      return res.status(400).json({ error: "oltMac and indexStr are required" });
    }

    const ability = await oltEmsService.getOnuAbility({
      oltMac,
      indexStr,
      onuIndex,
      portIndex,
      slotIndex,
    });

    return res.json({ ok: true, ability });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listOnus,
  getOnuAbility,
};
