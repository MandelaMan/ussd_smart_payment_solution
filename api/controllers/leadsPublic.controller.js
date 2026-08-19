const { query } = require("../config/db");
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

async function signupFormConfig() {
  const leadCfg = await leadFormConfig();
  const buildings = await query(
    `SELECT DISTINCT b.id, b.name
     FROM buildings b
     INNER JOIN products p ON p.building_id = b.id AND p.is_active = 1
     ORDER BY b.name ASC`
  );
  return {
    brandName: leadCfg.brandName,
    title: process.env.SIGNUP_FORM_TITLE || "Get Connected Now — Starlynx Utility",
    subtitle:
      process.env.SIGNUP_FORM_SUBTITLE ||
      "24/7 Telephone, WhatsApp and onsite support Monday to Saturday.",
    successMessage:
      process.env.SIGNUP_FORM_SUCCESS ||
      "Thanks! We received your signup. Our team will verify your details and convert you to a full customer shortly.",
    buildings: buildings.map((b) => ({ id: Number(b.id), name: b.name })),
  };
}

async function getSignupFormConfig(req, res, next) {
  try {
    publicCors(res);
    res.json(await signupFormConfig());
  } catch (err) {
    next(err);
  }
}

async function getSignupPackages(req, res, next) {
  try {
    publicCors(res);
    const buildingId = Number(req.query.buildingId);
    if (!Number.isFinite(buildingId) || buildingId <= 0) {
      return res.status(400).json({ error: "Select a building" });
    }
    const rows = await query(
      `SELECT p.id, p.name, p.mbps, p.price, p.payment_frequency AS paymentFrequency,
              p.has_dstv AS hasDstv, p.building_id AS buildingId,
              c.id AS categoryId, c.name AS categoryName,
              pl.id AS planId, pl.name AS planName
       FROM products p
       LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
       LEFT JOIN package_plans pl ON pl.id = v.plan_id
       LEFT JOIN package_categories c ON c.id = pl.category_id
       WHERE p.building_id = ? AND p.is_active = 1
       ORDER BY c.sort_order, pl.sort_order,
                FIELD(p.payment_frequency, 'monthly', 'quarterly', 'yearly'), p.price`,
      [buildingId]
    );
    res.json({
      packages: rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        mbps: Number(p.mbps || 0),
        price: Number(p.price || 0),
        paymentFrequency: p.paymentFrequency,
        hasDstv: Boolean(p.hasDstv),
        buildingId: Number(p.buildingId),
        categoryId: p.categoryId != null ? Number(p.categoryId) : null,
        categoryName: p.categoryName || null,
        planId: p.planId != null ? Number(p.planId) : null,
        planName: p.planName || null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function findActiveCustomerByPhone(phone) {
  const variants = leadStore.phoneMatchVariants(phone);
  const local9 = String(phone || "").replace(/\D/g, "").slice(-9);
  if (!variants.length && local9.length < 9) return null;
  const phoneList = variants.length ? variants : [local9];
  const placeholders = phoneList.map(() => "?").join(", ");
  const rows = await query(
    `SELECT id, customer_number AS customerNumber, status
     FROM customers
     WHERE status <> 'cancelled'
       AND (
         phone IN (${placeholders})
         OR RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', ''), 9) = ?
       )
     ORDER BY id DESC
     LIMIT 1`,
    [...phoneList, local9]
  );
  return rows[0] || null;
}

async function submitSignup(req, res, next) {
  try {
    publicCors(res);

    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const apartmentNumber = String(req.body?.apartmentNumber || "").trim();
    const buildingId = Number(req.body?.buildingId);
    const productId = Number(req.body?.productId);
    const dstvDecoderSerial = String(req.body?.dstvDecoderSerial || "")
      .trim()
      .toUpperCase();
    const message = String(req.body?.message || "").trim();
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    if (!firstName || firstName.length < 2) {
      return res.status(400).json({ error: "Please enter your first name" });
    }
    if (!lastName || lastName.length < 2) {
      return res.status(400).json({ error: "Please enter your last name" });
    }
    if (!phone || !PHONE_RE.test(phone)) {
      return res.status(400).json({ error: "Please enter a valid phone number" });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email" });
    }
    if (!apartmentNumber) {
      return res.status(400).json({ error: "Please enter your apartment / unit number" });
    }
    if (!Number.isFinite(buildingId) || buildingId <= 0) {
      return res.status(400).json({ error: "Please select your building" });
    }
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ error: "Please select a package" });
    }

    const honeypot = String(req.body?.companyWebsite || "").trim();
    if (honeypot) {
      return res.json({ ok: true, id: null });
    }

    const existingCustomer = await findActiveCustomerByPhone(phone);
    if (existingCustomer) {
      return res.status(409).json({
        error:
          "An account with this phone number already exists. Please contact Starlynx support.",
      });
    }

    const [building] = await query(
      `SELECT id, name FROM buildings WHERE id = ? LIMIT 1`,
      [buildingId]
    );
    if (!building) {
      return res.status(400).json({ error: "Selected building was not found" });
    }

    const [product] = await query(
      `SELECT p.id, p.name, p.mbps, p.price, p.payment_frequency AS paymentFrequency,
              p.has_dstv AS hasDstv, p.building_id AS buildingId, p.is_active AS isActive,
              c.id AS categoryId, c.name AS categoryName,
              pl.id AS planId, pl.name AS planName
       FROM products p
       LEFT JOIN package_plan_variants v ON v.id = p.plan_variant_id
       LEFT JOIN package_plans pl ON pl.id = v.plan_id
       LEFT JOIN package_categories c ON c.id = pl.category_id
       WHERE p.id = ? LIMIT 1`,
      [productId]
    );
    if (!product || Number(product.buildingId) !== buildingId || !product.isActive) {
      return res.status(400).json({ error: "Selected package is not available for this building" });
    }
    if (product.hasDstv && !dstvDecoderSerial) {
      return res.status(400).json({
        error: "Please enter your DSTV decoder serial number for this package",
      });
    }

    const signup = {
      firstName: firstName.slice(0, 80),
      lastName: lastName.slice(0, 80),
      productId: Number(product.id),
      productName: product.name,
      mbps: Number(product.mbps || 0),
      price: Number(product.price || 0),
      paymentFrequency: product.paymentFrequency,
      hasDstv: Boolean(product.hasDstv),
      categoryId: product.categoryId != null ? Number(product.categoryId) : null,
      categoryName: product.categoryName || null,
      planId: product.planId != null ? Number(product.planId) : null,
      planName: product.planName || null,
      dstvDecoderSerial: dstvDecoderSerial || null,
      customerType: "C2B",
    };

    const metadata = {
      userAgent: req.headers["user-agent"] || null,
      referer: req.headers.referer || req.headers.referrer || null,
      pageUrl: req.body?.pageUrl || null,
      signup,
    };

    const summary = [
      `Signup request from ${fullName}`,
      `Phone ${phone}`,
      `Email ${email}`,
      `${building.name} · apt ${apartmentNumber}`,
      `${product.name}${product.paymentFrequency ? ` · ${product.paymentFrequency}` : ""}`,
      dstvDecoderSerial ? `DSTV serial ${dstvDecoderSerial}` : null,
      message || null,
    ]
      .filter(Boolean)
      .join("\n");

    const existingLead = await leadStore.getOpenLeadByPhone(phone);
    let id;
    let created = true;
    if (existingLead) {
      const mergedMeta =
        existingLead.metadata && typeof existingLead.metadata === "object"
          ? { ...existingLead.metadata, ...metadata, signup }
          : metadata;
      await leadStore.updateLead(existingLead.id, {
        source: existingLead.source === "whatsapp" ? existingLead.source : "signup",
        status: "interested",
        name: fullName.slice(0, 200),
        phone: phone.slice(0, 32),
        email: email.slice(0, 191),
        interest: String(product.name || "Signup").slice(0, 100),
        buildingInterest: building.name,
        apartmentNumber: apartmentNumber.slice(0, 50),
        buildingId,
        message: message ? message.slice(0, 4000) : existingLead.message,
        metadata: mergedMeta,
      });
      id = existingLead.id;
      created = false;
    } else {
      id = await leadStore.createLead({
        source: "signup",
        status: "interested",
        name: fullName.slice(0, 200),
        phone: phone.slice(0, 32),
        email: email.slice(0, 191),
        interest: String(product.name || "Signup").slice(0, 100),
        buildingInterest: building.name,
        apartmentNumber: apartmentNumber.slice(0, 50),
        buildingId,
        message: message ? message.slice(0, 4000) : null,
        metadata,
      });
    }

    await leadStore.addMessage({
      leadId: id,
      direction: "inbound",
      channel: "web",
      body: summary.slice(0, 4000),
    });

    emitSyncEvent("leads:created", { leadId: id, source: "signup", status: "interested" });
    emitAdminUpdate("leads", {
      action: created ? "created" : "updated",
      leadId: id,
      source: "signup",
      status: "interested",
    });
    await logActivitySafe({
      eventType: created ? "lead_created" : "lead_updated",
      title: "Customer signup received",
      message: [fullName, phone, building.name, product.name]
        .filter(Boolean)
        .join(" · "),
      source: "admin",
      customerRef: phone,
      referenceId: String(id),
      metadata: { leadId: id, source: "signup", status: "interested" },
    });

    const form = await signupFormConfig();
    res.status(created ? 201 : 200).json({
      ok: true,
      id,
      created,
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
  getSignupFormConfig,
  getSignupPackages,
  submitSignup,
  whatsappWebhookVerify,
  whatsappWebhook,
  whatsappStatus,
};
