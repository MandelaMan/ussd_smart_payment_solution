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
      hasEmail: req.query.hasEmail,
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

function longerText(a, b) {
  const left = a == null ? "" : String(a);
  const right = b == null ? "" : String(b);
  return right.length > left.length ? right : left || null;
}

function mergeEmailConversations(localMessages, zohoMessages) {
  const byKey = new Map();
  for (const msg of localMessages) {
    const key = msg.zohoMessageId
      ? `z:${msg.zohoMessageId}`
      : `l:${msg.localId || msg.id}`;
    byKey.set(key, msg);
  }
  for (const msg of zohoMessages) {
    const key = msg.zohoMessageId ? `z:${msg.zohoMessageId}` : msg.id;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...msg,
        ...existing,
        summary: longerText(existing.summary, msg.summary) || existing.summary,
        bodyHtml: longerText(existing.bodyHtml, msg.bodyHtml),
        bodyText: longerText(existing.bodyText, msg.bodyText),
        attachmentNames:
          (msg.attachmentNames?.length || 0) >
          (existing.attachmentNames?.length || 0)
            ? msg.attachmentNames
            : existing.attachmentNames?.length
              ? existing.attachmentNames
              : msg.attachmentNames,
      });
    } else {
      byKey.set(key, msg);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
}

function parseEmailAttachments(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Error("Invalid attachments payload");
    }
  }
  if (!Array.isArray(list)) throw new Error("Attachments must be an array");
  if (list.length > 5) throw new Error("Maximum 5 attachments allowed");

  return list.map((item, index) => {
    const fileName = String(item?.fileName || item?.name || `file-${index + 1}`).slice(
      0,
      200
    );
    const contentType = String(
      item?.contentType || item?.mimeType || "application/octet-stream"
    );
    const base64 = String(item?.contentBase64 || item?.base64 || "").replace(
      /^data:[^;]+;base64,/,
      ""
    );
    if (!base64) throw new Error(`Attachment "${fileName}" is empty`);
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      throw new Error(`Attachment "${fileName}" could not be decoded`);
    }
    if (buffer.length > 8 * 1024 * 1024) {
      throw new Error(`Attachment "${fileName}" exceeds 8MB limit`);
    }
    return { fileName, contentType, buffer };
  });
}

async function createEmailProspect(req, res, next) {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const apartmentNumber = String(req.body?.apartmentNumber || "").trim();
    const buildingId =
      req.body?.buildingId != null && req.body.buildingId !== ""
        ? Number(req.body.buildingId)
        : null;

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required" });
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

    const existing = await leadStore.getLeadByEmail(email);
    if (existing && !["converted", "closed"].includes(existing.status)) {
      const lead = await leadStore.updateLead(existing.id, {
        name,
        email,
        phone: phone || existing.phone,
        apartmentNumber: apartmentNumber || null,
        buildingId: Number.isFinite(buildingId) ? buildingId : null,
        buildingInterest,
      });
      return res.json({ ok: true, lead, created: false });
    }

    const id = await leadStore.createLead({
      source: "email",
      status: "new",
      name,
      phone: phone || null,
      email,
      apartmentNumber: apartmentNumber || null,
      buildingId: Number.isFinite(buildingId) ? buildingId : null,
      buildingInterest,
      conversationState: "agent",
    });
    const lead = await leadStore.getLeadById(id);
    emitSyncEvent("leads:created", { leadId: id, source: "email" });
    emitAdminUpdate("leads", { action: "created", leadId: id, source: "email" });
    res.status(201).json({ ok: true, lead, created: true });
  } catch (err) {
    next(err);
  }
}

async function listLeadEmailConversation(req, res, next) {
  try {
    const leadId = Number(req.params.id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return res.status(400).json({ error: "lead id is required" });
    }

    const lead = await leadStore.getLeadById(leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const {
      sendZohoMail: _s,
      isZohoMailConfigured,
      searchZohoMailConversation,
      loadMailIdentity,
    } = require("../utils/zohoMail");
    const leadEmailStore = require("../services/leadEmailStore");

    const email = String(req.query.email || lead.email || "")
      .trim()
      .toLowerCase();
    const identity = await loadMailIdentity();
    const local = await leadEmailStore.listByLeadId(leadId);
    let zoho = [];
    if (email.includes("@") && isZohoMailConfigured()) {
      zoho = await searchZohoMailConversation(email, { limit: 50 });
    }

    res.json({
      leadId,
      mailbox: {
        fromAddress: identity.fromAddress,
        fromName: identity.fromName,
      },
      email: email || null,
      lead,
      messages: mergeEmailConversations(local, zoho),
    });
  } catch (err) {
    next(err);
  }
}

async function sendLeadEmail(req, res, next) {
  try {
    const {
      sendZohoMail,
      isZohoMailConfigured,
      loadMailIdentity,
    } = require("../utils/zohoMail");
    const leadEmailStore = require("../services/leadEmailStore");
    const { logActivity } = require("../services/activityLogStore");

    if (!isZohoMailConfigured()) {
      return res.status(503).json({
        error:
          "Zoho Mail is not configured — set ZOHO_MAIL_REFRESH_TOKEN with ZohoMail.messages scope",
      });
    }

    const leadId = Number(req.body?.leadId || req.params.id);
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return res.status(400).json({ error: "leadId is required" });
    }

    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || req.body?.content || "").trim();
    if (!subject) return res.status(400).json({ error: "Subject is required" });
    if (!body) return res.status(400).json({ error: "Message body is required" });

    let attachments = [];
    try {
      attachments = parseEmailAttachments(req.body?.attachments);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const lead = await leadStore.getLeadById(leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const toAddress = String(req.body?.to || lead.email || "")
      .trim()
      .toLowerCase();
    if (!toAddress || !toAddress.includes("@")) {
      return res.status(400).json({
        error: "Lead has no email — provide a recipient address",
      });
    }

    if (!lead.email || lead.email.toLowerCase() !== toAddress) {
      await leadStore.updateLead(leadId, { email: toAddress });
    }

    const html = body.includes("<")
      ? body
      : `<div style="font-family:sans-serif;white-space:pre-wrap">${body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</div>`;

    const identity = await loadMailIdentity();
    const result = await sendZohoMail({
      toAddress,
      subject,
      content: html,
      attachments,
    });

    let saved = null;
    try {
      saved = await leadEmailStore.createMessage({
        leadId,
        direction: "outbound",
        fromAddress: identity.fromAddress,
        toAddress,
        subject,
        bodyHtml: html,
        attachmentNames:
          result.attachmentNames || attachments.map((a) => a.fileName),
        zohoMessageId: result?.messageId || null,
        status: "sent",
        createdBy: req.user?.id || null,
      });
    } catch {
      /* local history optional if migration pending */
    }

    if (lead.status === "new") {
      try {
        await leadStore.updateLead(leadId, { status: "contacted" });
      } catch {
        /* optional */
      }
    }

    try {
      await logActivity({
        eventType: "lead_email",
        title: "Lead email sent",
        message: `Email to ${toAddress}: ${subject}`,
        source: "admin",
        status: "success",
        metadata: {
          toAddress,
          subject,
          leadId,
          messageId: result?.messageId || null,
          fromAddress: identity.fromAddress,
        },
      });
    } catch {
      /* optional */
    }

    emitAdminUpdate("leads", { action: "email_sent", leadId });
    emitSyncEvent("leads:updated", { leadId, source: "email" });

    res.json({
      ok: true,
      to: toAddress,
      subject,
      leadId,
      from: identity.fromAddress,
      message: saved,
      attachmentNames: result.attachmentNames || [],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLeads,
  getLeadStats,
  getLead,
  createProspect,
  createEmailProspect,
  getWhatsAppLeadByPhone,
  updateLead,
  addLeadNote,
  sendWhatsAppReply,
  sendWhatsAppToCustomer,
  listLeadEmailConversation,
  sendLeadEmail,
};
