const leadStore = require("../services/leadStore");
const whatsappLeadBot = require("../services/whatsappLeadBot");
const { emitSyncEvent } = require("../socket");
const { emitAdminUpdate } = require("../lib/adminEvents");
const { verifyWhatsAppSignature } = require("../middleware/webhookVerify");
const { logActivitySafe } = require("../services/activityLogStore");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,20}$/;

function publicCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Lead-Source, X-Requested-With"
  );
}

async function leadFormConfig() {
  const settings = await whatsappLeadBot.loadWhatsAppSettings();
  return {
    title: process.env.LEAD_FORM_TITLE || "Get connected with Starlynx",
    subtitle:
      process.env.LEAD_FORM_SUBTITLE ||
      "Tell us a bit about yourself and we will get back to you shortly.",
    brandName: process.env.LEAD_FORM_BRAND || "Starlynx",
    interests: [
      { value: "Home Internet", label: "Home Internet" },
      { value: "Internet + DSTV", label: "Internet + DSTV" },
      { value: "Business", label: "Business package" },
      { value: "Other", label: "Other / talk to sales" },
    ],
    whatsappLink: settings.clickToChatUrl || null,
    successMessage:
      process.env.LEAD_FORM_SUCCESS ||
      "Thanks! We received your request and will contact you soon.",
  };
}

async function getLeadFormConfig(req, res) {
  publicCors(res);
  res.json(await leadFormConfig());
}

async function submitLead(req, res, next) {
  try {
    publicCors(res);

    const sourceRaw = String(
      req.body?.source || req.headers["x-lead-source"] || "web"
    ).toLowerCase();
    const source = sourceRaw === "embed" ? "embed" : "web";

    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const interest = String(req.body?.interest || "").trim();
    const buildingInterest = String(
      req.body?.buildingInterest || req.body?.building || ""
    ).trim();
    const message = String(req.body?.message || "").trim();

    if (!name || name.length < 2) {
      return res.status(400).json({ error: "Please enter your name" });
    }
    if (!phone || !PHONE_RE.test(phone)) {
      return res.status(400).json({ error: "Please enter a valid phone number" });
    }
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email" });
    }

    const honeypot = String(req.body?.companyWebsite || "").trim();
    if (honeypot) {
      return res.json({ ok: true, id: null });
    }

    const id = await leadStore.createLead({
      source,
      status: "new",
      name: name.slice(0, 200),
      phone: phone.slice(0, 32),
      email: email ? email.slice(0, 191) : null,
      interest: interest ? interest.slice(0, 100) : null,
      buildingInterest: buildingInterest
        ? buildingInterest.slice(0, 200)
        : null,
      message: message ? message.slice(0, 4000) : null,
      metadata: {
        userAgent: req.headers["user-agent"] || null,
        referer: req.headers.referer || req.headers.referrer || null,
        pageUrl: req.body?.pageUrl || null,
      },
    });

    if (message) {
      await leadStore.addMessage({
        leadId: id,
        direction: "inbound",
        channel: source,
        body: message,
      });
    }

    emitSyncEvent("leads:created", { leadId: id, source });
    emitAdminUpdate("leads", { action: "created", leadId: id, source });
    await logActivitySafe({
      eventType: "lead_created",
      title: "New lead captured",
      message: [req.body?.name, req.body?.phone || req.body?.email, source]
        .filter(Boolean)
        .join(" · "),
      source: "admin",
      customerRef: req.body?.phone || req.body?.email || null,
      referenceId: String(id),
      metadata: { leadId: id, source },
    });
    const form = await leadFormConfig();
    res.status(201).json({
      ok: true,
      id,
      message: form.successMessage,
    });
  } catch (err) {
    next(err);
  }
}

async function whatsappWebhookVerify(req, res) {
  const result = await whatsappLeadBot.verifyWebhookQuery(req.query);
  if (result.ok) {
    return res.status(200).send(result.challenge);
  }
  return res.status(403).send("Forbidden");
}

async function whatsappWebhook(req, res) {
  const signatureCheck = await verifyWhatsAppSignature(req);
  if (!signatureCheck.ok) {
    console.warn("[whatsapp] webhook signature rejected:", signatureCheck.reason);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Always ack quickly so Meta does not retry aggressively
  res.status(200).json({ ok: true });

  setImmediate(async () => {
    try {
      await whatsappLeadBot.processWebhook(req.body);
    } catch (err) {
      console.error("[whatsapp] webhook processing failed:", err.message || err);
    }
  });
}

async function whatsappStatus(req, res) {
  publicCors(res);
  res.json(await whatsappLeadBot.getStatus());
}

module.exports = {
  publicCors,
  getLeadFormConfig,
  submitLead,
  whatsappWebhookVerify,
  whatsappWebhook,
  whatsappStatus,
};
