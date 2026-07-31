const customerStore = require("../services/customerModuleStore");
const customerEmailStore = require("../services/customerEmailStore");
const appSettingsStore = require("../services/appSettingsStore");
const {
  sendZohoMail,
  isZohoMailConfigured,
  getZohoMailConfig,
  searchZohoMailConversation,
  loadMailIdentity,
  clearMailAccountCache,
} = require("../utils/zohoMail");
const { logActivity } = require("../services/activityLogStore");
const { emitAdminUpdate } = require("../lib/adminEvents");

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function parseAttachments(raw) {
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
  if (list.length > MAX_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_ATTACHMENTS} attachments allowed`);
  }

  return list.map((item, index) => {
    const fileName = String(item?.fileName || item?.name || `file-${index + 1}`).slice(
      0,
      200
    );
    const contentType = String(item?.contentType || item?.mimeType || "application/octet-stream");
    const base64 = String(item?.contentBase64 || item?.base64 || "").replace(
      /^data:[^;]+;base64,/,
      ""
    );
    if (!base64) {
      throw new Error(`Attachment "${fileName}" is empty`);
    }
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) {
      throw new Error(`Attachment "${fileName}" could not be decoded`);
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${fileName}" exceeds 8MB limit`);
    }
    return { fileName, contentType, buffer };
  });
}

function longerText(a, b) {
  const left = a == null ? "" : String(a);
  const right = b == null ? "" : String(b);
  return right.length > left.length ? right : left || null;
}

function mergeConversations(localMessages, zohoMessages) {
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
          (msg.attachmentNames?.length || 0) > (existing.attachmentNames?.length || 0)
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

async function getChannelStatus(_req, res) {
  const whatsappLeadBot = require("../services/whatsappLeadBot");
  res.json({
    email: await getZohoMailConfig(),
    whatsapp: await whatsappLeadBot.getStatus(),
  });
}

async function listCustomerEmailConversation(req, res, next) {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "customerId is required" });
    }

    const customer = await customerStore.getCustomerById(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const email = String(req.query.email || customer.email || "")
      .trim()
      .toLowerCase();

    const identity = await loadMailIdentity();
    const local = await customerEmailStore.listByCustomerId(customerId);
    let zoho = [];
    if (email.includes("@") && isZohoMailConfigured()) {
      zoho = await searchZohoMailConversation(email, { limit: 50 });
    }

    res.json({
      customerId,
      mailbox: {
        fromAddress: identity.fromAddress,
        fromName: identity.fromName,
      },
      email: email || null,
      messages: mergeConversations(local, zoho),
    });
  } catch (err) {
    next(err);
  }
}

async function sendCustomerEmail(req, res, next) {
  try {
    if (!isZohoMailConfigured()) {
      return res.status(503).json({
        error:
          "Zoho Mail is not configured — set ZOHO_MAIL_REFRESH_TOKEN in .env with ZohoMail.messages scope",
      });
    }

    const customerId = Number(req.body?.customerId);
    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "customerId is required" });
    }

    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || req.body?.content || "").trim();
    if (!subject) return res.status(400).json({ error: "Subject is required" });
    if (!body) return res.status(400).json({ error: "Message body is required" });

    let attachments = [];
    try {
      attachments = parseAttachments(req.body?.attachments);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const customer = await customerStore.getCustomerById(customerId);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const toAddress = String(req.body?.to || customer.email || "").trim();
    if (!toAddress || !toAddress.includes("@")) {
      return res.status(400).json({
        error: "Customer has no email on file — provide a recipient address",
      });
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
      saved = await customerEmailStore.createMessage({
        customerId,
        direction: "outbound",
        fromAddress: identity.fromAddress,
        toAddress,
        subject,
        bodyHtml: html,
        attachmentNames: result.attachmentNames || attachments.map((a) => a.fileName),
        zohoMessageId: result?.messageId || null,
        status: "sent",
        createdBy: req.user?.id || null,
      });
    } catch {
      /* local history optional if migration pending */
    }

    try {
      await logActivity({
        eventType: "communication_email",
        title: "Customer email sent",
        message: `Email to ${toAddress}: ${subject}`,
        source: "admin",
        status: "success",
        customerRef: customer.customerNumber || String(customerId),
        metadata: {
          toAddress,
          subject,
          customerId,
          messageId: result?.messageId || null,
          fromAddress: identity.fromAddress,
          attachmentNames: result.attachmentNames || [],
        },
      });
    } catch {
      /* activity optional */
    }

    emitAdminUpdate("communication", {
      action: "email_sent",
      customerId,
    });

    res.json({
      ok: true,
      to: toAddress,
      subject,
      customerId,
      from: identity.fromAddress,
      message: saved,
      attachmentNames: result.attachmentNames || [],
    });
  } catch (err) {
    next(err);
  }
}

async function updateCommunicationEmailSettings(req, res, next) {
  try {
    const saved = await appSettingsStore.saveCommunicationEmailSettings(
      {
        fromAddress: req.body?.fromAddress,
        fromName: req.body?.fromName,
        accountId: req.body?.accountId,
      },
      req.user?.id || null
    );
    clearMailAccountCache();
    emitAdminUpdate("settings", { action: "communication_email_updated" });
    res.json({
      ok: true,
      email: {
        ...(await getZohoMailConfig()),
        ...saved,
      },
    });
  } catch (err) {
    if (err.message?.includes("required") || err.message?.includes("valid")) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

async function updateCommunicationWhatsAppSettings(req, res, next) {
  try {
    const whatsappLeadBot = require("../services/whatsappLeadBot");
    const saved = await appSettingsStore.saveCommunicationWhatsAppSettings(
      {
        phoneNumberId: req.body?.phoneNumberId,
        accessToken: req.body?.accessToken,
        appSecret: req.body?.appSecret,
        webhookVerifyToken: req.body?.webhookVerifyToken,
        clickToChatUrl: req.body?.clickToChatUrl,
        welcomeMessage: req.body?.welcomeMessage,
        completeMessage: req.body?.completeMessage,
        outboundTemplate: req.body?.outboundTemplate,
        outboundTemplateLang: req.body?.outboundTemplateLang,
      },
      req.user?.id || null
    );
    whatsappLeadBot.clearWhatsAppClient();
    emitAdminUpdate("settings", { action: "communication_whatsapp_updated" });
    res.json({
      ok: true,
      whatsapp: appSettingsStore.toPublicWhatsAppSettings(saved),
    });
  } catch (err) {
    if (
      err.message?.includes("required") ||
      err.message?.includes("valid") ||
      err.message?.includes("App secret")
    ) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

module.exports = {
  getChannelStatus,
  listCustomerEmailConversation,
  sendCustomerEmail,
  updateCommunicationEmailSettings,
  updateCommunicationWhatsAppSettings,
};
