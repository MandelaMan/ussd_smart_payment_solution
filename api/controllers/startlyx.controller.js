const startlyx = require("../services/startlyx/startlyxClient");
const appSettingsStore = require("../services/appSettingsStore");
const { emitAdminUpdate } = require("../lib/adminEvents");

function sendStartlyxError(res, err) {
  const status = startlyx.clientStatusFromError(err);
  return res.status(status).json({
    ok: false,
    error: err.message || "Startlyx request failed",
    code: err.code || null,
  });
}

async function getIptvStatus(req, res, next) {
  try {
    const status = await startlyx.pingAuth();
    return res.json({ ok: true, ...status });
  } catch (err) {
    return next(err);
  }
}

async function getIptvSettings(req, res, next) {
  try {
    const saved = await appSettingsStore.getStartlyxSettings();
    return res.json({
      ok: true,
      ...appSettingsStore.toPublicStartlyxSettings(saved),
    });
  } catch (err) {
    return next(err);
  }
}

async function updateIptvSettings(req, res, next) {
  try {
    const saved = await appSettingsStore.saveStartlyxSettings(
      {
        baseUrl: req.body?.baseUrl,
        adminEmail: req.body?.adminEmail,
        adminPassword: req.body?.adminPassword,
      },
      req.user?.id || null
    );
    startlyx.applySavedSettings(saved);
    emitAdminUpdate("settings", { action: "iptv_startlyx_updated" });
    const status = await startlyx.pingAuth();
    return res.json({
      ok: true,
      settings: appSettingsStore.toPublicStartlyxSettings(saved),
      status,
    });
  } catch (err) {
    if (
      err.message?.includes("required") ||
      err.message?.includes("valid")
    ) {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
}

async function listIptvChannels(req, res, next) {
  try {
    const data = await startlyx.listChannels();
    return res.json({ ok: true, ...data });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

async function listIptvPackages(req, res, next) {
  try {
    const packages = await startlyx.listPackages();
    return res.json({ ok: true, packages });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

async function listIptvUsers(req, res, next) {
  try {
    const users = await startlyx.listUsersWithAccess();
    return res.json({ ok: true, users });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

async function simulateIptvCustomer(req, res, next) {
  try {
    const body = req.body || {};
    const result = await startlyx.simulateCustomer({
      email: body.email,
      username: body.username,
      phone_number: body.phoneNumber || body.phone_number,
      address: body.address,
      package_id: body.packageId || body.package_id,
      duration_months: body.durationMonths || body.duration_months,
    });
    return res.status(result.userCreated || result.subscriptionCreated ? 201 : 200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

async function disconnectIptvUser(req, res, next) {
  try {
    const result = await startlyx.disconnectUser(req.params.id);
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

async function reconnectIptvUser(req, res, next) {
  try {
    const body = req.body || {};
    const result = await startlyx.reconnectUser(req.params.id, {
      package_id: body.packageId || body.package_id,
      duration_months: body.durationMonths || body.duration_months,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof startlyx.StartlyxError) return sendStartlyxError(res, err);
    return next(err);
  }
}

module.exports = {
  getIptvStatus,
  getIptvSettings,
  updateIptvSettings,
  listIptvChannels,
  listIptvPackages,
  listIptvUsers,
  simulateIptvCustomer,
  disconnectIptvUser,
  reconnectIptvUser,
};
