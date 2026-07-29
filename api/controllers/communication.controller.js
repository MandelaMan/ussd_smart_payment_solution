const customerStore = require("../services/customerModuleStore");
const { sendZohoMail, isZohoMailConfigured, getZohoMailConfig } = require("../utils/zohoMail");
const { logActivity } = require("../services/activityLogStore");
const { emitAdminUpdate } = require("../lib/adminEvents");

async function getChannelStatus(_req, res) {
  const whatsappLeadBot = require("../services/whatsappLeadBot");
  res.json({
    email: getZohoMailConfig(),
    whatsapp: whatsappLeadBot.getStatus(),
  });
}

async function sendCustomerEmail(req, res, next) {
  try {
    if (!isZohoMailConfigured()) {
      return res.status(503).json({
        error:
          "Zoho Mail is not configured — set ZOHO_MAIL_ACCOUNT_ID and ZOHO_MAIL_FROM_ADDRESS",
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

    const result = await sendZohoMail({
      toAddress,
      subject,
      content: html,
    });

    try {
      await logActivity({
        eventType: "communication_email",
        title: "Customer email sent",
        message: `Email to ${toAddress}: ${subject}`,
        source: "admin",
        status: "success",
        customerRef: customer.customerNumber || String(customerId),
        metadata: { toAddress, subject, customerId, messageId: result?.messageId || null },
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
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getChannelStatus,
  sendCustomerEmail,
};
