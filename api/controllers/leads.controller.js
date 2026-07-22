const leadStore = require("../services/leadStore");
const { emitSyncEvent } = require("../socket");

async function listLeads(req, res, next) {
  try {
    const result = await leadStore.listLeads({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
      status: req.query.status,
      source: req.query.source,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getLeadStats(req, res, next) {
  try {
    const stats = await leadStore.getLeadStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

async function getLead(req, res, next) {
  try {
    const lead = await leadStore.getLeadById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const messages = await leadStore.listMessages(lead.id);
    res.json({ lead, messages });
  } catch (err) {
    next(err);
  }
}

async function updateLead(req, res, next) {
  try {
    const existing = await leadStore.getLeadById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Lead not found" });

    const allowed = [
      "status",
      "name",
      "phone",
      "email",
      "interest",
      "buildingInterest",
      "message",
      "notes",
      "assignedTo",
      "convertedCustomerId",
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }

    const lead = await leadStore.updateLead(existing.id, patch);
    emitSyncEvent("leads:updated", { leadId: lead.id });
    res.json({ ok: true, lead });
  } catch (err) {
    next(err);
  }
}

async function addLeadNote(req, res, next) {
  try {
    const existing = await leadStore.getLeadById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Lead not found" });

    const body = String(req.body?.body || req.body?.note || "").trim();
    if (!body) return res.status(400).json({ error: "Note body is required" });

    await leadStore.addMessage({
      leadId: existing.id,
      direction: "outbound",
      channel: "system",
      body,
      payload: { type: "note", userId: req.user?.id || null },
    });

    if (existing.status === "new") {
      await leadStore.updateLead(existing.id, { status: "contacted" });
    }

    const messages = await leadStore.listMessages(existing.id);
    const lead = await leadStore.getLeadById(existing.id);
    emitSyncEvent("leads:updated", { leadId: existing.id });
    res.json({ ok: true, lead, messages });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLeads,
  getLeadStats,
  getLead,
  updateLead,
  addLeadNote,
};
