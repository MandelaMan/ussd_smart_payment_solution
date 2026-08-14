const store = require("../services/installationStore");
const { logActivity } = require("../services/activityLogStore");

async function listInstallations(req, res, next) {
  try {
    const result = await store.listInstallations({
      status: req.query.status,
      kind: req.query.kind,
      technicianId: req.query.technicianId,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function listTechnicians(req, res, next) {
  try {
    const technicians = await store.listTechnicians();
    return res.json({ ok: true, technicians });
  } catch (err) {
    return next(err);
  }
}

async function getInstallation(req, res, next) {
  try {
    const installation = await store.getInstallationById(req.params.id);
    if (!installation) return res.status(404).json({ error: "Installation not found" });
    return res.json({ ok: true, installation });
  } catch (err) {
    return next(err);
  }
}

async function assignInstallation(req, res, next) {
  try {
    const technicianId =
      req.body?.technicianId === null || req.body?.technicianId === ""
        ? null
        : req.body?.technicianId;
    const installation = await store.assignTechnician(req.params.id, technicianId, {
      actorId: req.user?.id,
    });
    await logActivity({
      eventType: "installation_assigned",
      title: technicianId ? "Installation assigned" : "Installation unassigned",
      message: `${installation.customerNumber}: ${installation.displayDateTime}${
        installation.technicianName ? ` → ${installation.technicianName}` : ""
      }`,
      source: "admin",
      status: "success",
      customerRef: installation.customerNumber,
      metadata: {
        installationId: installation.id,
        technicianId: installation.technicianId,
      },
    }).catch(() => {});
    return res.json({ ok: true, installation });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

async function updateInstallation(req, res, next) {
  try {
    const installation = await store.updateInstallation(req.params.id, {
      status: req.body?.status,
      scheduledAt: req.body?.scheduledAt || req.body?.installationScheduledAt,
      notes: req.body?.notes,
    });
    await logActivity({
      eventType: "installation_updated",
      title: "Installation updated",
      message: `${installation.customerNumber}: ${installation.status}`,
      source: "admin",
      status: "success",
      customerRef: installation.customerNumber,
      metadata: { installationId: installation.id, status: installation.status },
    }).catch(() => {});
    return res.json({ ok: true, installation });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
}

module.exports = {
  listInstallations,
  listTechnicians,
  getInstallation,
  assignInstallation,
  updateInstallation,
};
