const leadStore = require("../services/leadStore");
const { emitSyncEvent } = require("../socket");
const { emitAdminUpdate } = require("../lib/adminEvents");

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

async function createProspect(req, res, next) {
  try {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const apartmentNumber = String(req.body?.apartmentNumber || "").trim();
    const buildingId =
      req.body?.buildingId != null && req.body.buildingId !== ""
        ? Number(req.body.buildingId)
        : null;

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!phone || phone.replace(/\D/g, "").length < 9) {
      return res.status(400).json({ error: "A valid phone number is required" });
    }
    if (email && !email.includes("@")) {
      return res.status(400).json({ error: "Email is invalid" });
    }

    let buildingInterest = req.body?.buildingInterest
      ? String(req.body.buildingInterest).trim()
      : null;
    if (buildingId && Number.isFinite(buildingId) && !buildingInterest) {
      try {
        const { query } = require("../config/db");
        const rows = await query(
          `SELECT name FROM buildings WHERE id = ? LIMIT 1`,
          [buildingId]
        );
        buildingInterest = rows[0]?.name || null;
      } catch {
        /* optional */
      }
    }

    const whatsappLeadBot = require("../services/whatsappLeadBot");
    const waId = whatsappLeadBot.toWhatsAppId(phone);

    const existing = await leadStore.getWhatsAppLeadByPhone(phone);
    if (existing && !["converted", "closed"].includes(existing.status)) {
      const lead = await leadStore.updateLead(existing.id, {
        name,
        email: email || null,
        phone,
        apartmentNumber: apartmentNumber || null,
        buildingId: Number.isFinite(buildingId) ? buildingId : null,
        buildingInterest,
        whatsappWaId: waId || existing.whatsappWaId,
      });
      return res.json({ ok: true, lead, created: false });
    }

    const id = await leadStore.createLead({
      source: "whatsapp",
      status: "new",
      name,
      phone,
      email: email || null,
      apartmentNumber: apartmentNumber || null,
      buildingId: Number.isFinite(buildingId) ? buildingId : null,
      buildingInterest,
      whatsappWaId: waId,
      conversationState: "agent",
    });
    const lead = await leadStore.getLeadById(id);
    emitSyncEvent("leads:created", { leadId: id, source: "whatsapp" });
    emitAdminUpdate("leads", { action: "created", leadId: id });
    res.status(201).json({ ok: true, lead, created: true });
  } catch (err) {
    next(err);
  }
}

async function getWhatsAppLeadByPhone(req, res, next) {
  try {
    const phone = String(req.query.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ error: "phone query is required" });
    }
    const lead = await leadStore.getWhatsAppLeadByPhone(phone);
    if (!lead) {
      return res.json({ lead: null, messages: [] });
    }
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
      "apartmentNumber",
      "buildingId",
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
    emitAdminUpdate("leads", { action: "updated", leadId: lead.id });
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
    emitAdminUpdate("leads", { action: "updated", leadId: existing.id });
    res.json({ ok: true, lead, messages });
  } catch (err) {
    next(err);
  }
}

async function sendWhatsAppReply(req, res, next) {
  try {
    const whatsappLeadBot = require("../services/whatsappLeadBot");
    const body = String(req.body?.body || req.body?.text || "").trim();
    const result = await whatsappLeadBot.sendLeadReply(req.params.id, body, {
      userId: req.user?.id || null,
    });
    emitSyncEvent("leads:updated", { leadId: result.lead.id });
    emitAdminUpdate("leads", { action: "updated", leadId: result.lead.id });
    res.json({
      ok: true,
      lead: result.lead,
      messages: result.messages,
      sendMode: result.sendMode,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

async function sendWhatsAppToCustomer(req, res, next) {
  try {
    const whatsappLeadBot = require("../services/whatsappLeadBot");
    const body = String(req.body?.body || req.body?.text || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const name = req.body?.name ? String(req.body.name).trim() : null;
    const customerId =
      req.body?.customerId != null ? Number(req.body.customerId) : null;

    const result = await whatsappLeadBot.sendCustomerMessage(
      {
        phone,
        name,
        customerId: Number.isFinite(customerId) ? customerId : null,
        text: body,
      },
      { userId: req.user?.id || null }
    );

    emitSyncEvent("leads:updated", { leadId: result.lead.id });
    emitAdminUpdate("leads", { action: "updated", leadId: result.lead.id });
    res.json({
      ok: true,
      lead: result.lead,
      messages: result.messages,
      sendMode: result.sendMode,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = {
  listLeads,
  getLeadStats,
  getLead,
  createProspect,
  getWhatsAppLeadByPhone,
  updateLead,
  addLeadNote,
  sendWhatsAppReply,
  sendWhatsAppToCustomer,
};
