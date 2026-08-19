const { query } = require("../config/db");

async function getSetting(key) {
  const rows = await query(
    `SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1`,
    [String(key)]
  );
  if (!rows[0]) return null;
  const raw = rows[0].setting_value;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setSetting(key, value, updatedBy = null) {
  const payload = JSON.stringify(value ?? {});
  await query(
    `INSERT INTO app_settings (setting_key, setting_value, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       setting_value = VALUES(setting_value),
       updated_by = VALUES(updated_by)`,
    [String(key), payload, updatedBy]
  );
  return getSetting(key);
}

const DEFAULT_INVOICE_CC_EMAILS = [
  "support@sulsolutions.biz",
  "director@sulsolutions.biz",
  "accounts@sulsolutions.biz",
  "it@sulsolutions.biz",
];

function normalizeEmailList(value, fallback = []) {
  const raw = Array.isArray(value)
    ? value.join(",")
    : value == null
      ? ""
      : String(value);
  const list = raw
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  if (list.length) return [...new Set(list)];
  return [...fallback];
}

async function getCommunicationEmailSettings() {
  const saved = (await getSetting("communication.email")) || {};
  const envCc = String(process.env.ZOHO_INVOICE_CC_EMAILS || "").trim();
  return {
    fromAddress:
      String(saved.fromAddress || process.env.ZOHO_MAIL_FROM_ADDRESS || "")
        .trim() || "customersupport@sulsolutions.biz",
    fromName:
      String(saved.fromName || process.env.ZOHO_MAIL_FROM_NAME || "").trim() ||
      "Customer Support",
    accountId: String(
      saved.accountId || process.env.ZOHO_MAIL_ACCOUNT_ID || ""
    ).trim() || null,
    invoiceCcEmails: normalizeEmailList(
      saved.invoiceCcEmails != null ? saved.invoiceCcEmails : envCc,
      DEFAULT_INVOICE_CC_EMAILS
    ),
  };
}

async function saveCommunicationEmailSettings(patch = {}, updatedBy = null) {
  const current = await getCommunicationEmailSettings();
  const next = {
    fromAddress:
      patch.fromAddress != null
        ? String(patch.fromAddress).trim()
        : current.fromAddress,
    fromName:
      patch.fromName != null ? String(patch.fromName).trim() : current.fromName,
    accountId:
      patch.accountId != null
        ? String(patch.accountId).trim() || null
        : current.accountId,
    // Invoice CC lives under customer.email; keep writing here only when
    // callers still patch it (back-compat with older admin clients).
    invoiceCcEmails:
      patch.invoiceCcEmails != null
        ? normalizeEmailList(patch.invoiceCcEmails, [])
        : current.invoiceCcEmails,
  };
  if (!next.fromAddress || !next.fromAddress.includes("@")) {
    throw new Error("A valid from address is required");
  }
  if (!next.fromName) {
    throw new Error("From name is required");
  }
  await setSetting("communication.email", next, updatedBy);
  return next;
}

const DEFAULT_WELCOME_SUBJECT = "Welcome to Starlynx — {{customerNumber}}";

const DEFAULT_WELCOME_BODY_HTML = `<p>Dear {{firstName}},</p>
<p>Welcome to <strong>Starlynx</strong>! Your internet service has been set up.</p>
<p>
  <strong>Account number:</strong> {{customerNumber}}<br/>
  <strong>Building:</strong> {{buildingName}}<br/>
  <strong>Apartment:</strong> {{apartmentNumber}}<br/>
  <strong>Package:</strong> {{productName}}<br/>
  <strong>Installation:</strong> {{installationDateTime}}
</p>
<p>Please use your account number as the M-Pesa Paybill reference for payments.</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`;

/** Lifecycle email templates editable under Settings → Customer emails. */
const CUSTOMER_EMAIL_TEMPLATE_DEFS = {
  welcome: {
    label: "Welcome email",
    description: "Sent when a customer is registered.",
    defaultEnabled: true,
    defaultSubject: DEFAULT_WELCOME_SUBJECT,
    defaultBodyHtml: DEFAULT_WELCOME_BODY_HTML,
  },
  upgrade: {
    label: "Upgrade plan",
    description: "Sent after a package upgrade is completed.",
    defaultEnabled: true,
    defaultSubject: "Package upgraded — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx package has been upgraded.</p>
<p>
  <strong>Account:</strong> {{customerNumber}}<br/>
  <strong>Previous package:</strong> {{previousProductName}} ({{previousMbps}} Mbps)<br/>
  <strong>New package:</strong> {{productName}} ({{productMbps}} Mbps)<br/>
  <strong>Billing:</strong> {{paymentFrequency}} · {{packagePrice}}
</p>
<p>Your new speeds should be available shortly.</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  downgrade: {
    label: "Downgrade plan",
    description: "Sent after a package downgrade is completed.",
    defaultEnabled: true,
    defaultSubject: "Package changed — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx package has been changed as requested.</p>
<p>
  <strong>Account:</strong> {{customerNumber}}<br/>
  <strong>Previous package:</strong> {{previousProductName}} ({{previousMbps}} Mbps)<br/>
  <strong>New package:</strong> {{productName}} ({{productMbps}} Mbps)<br/>
  <strong>Billing:</strong> {{paymentFrequency}} · {{packagePrice}}
</p>
<p>If a credit applies, it will appear on your Zoho Books account.</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  apartment_move: {
    label: "Apartment movement",
    description: "Sent when a customer moves to a different apartment (account number may change).",
    defaultEnabled: true,
    defaultSubject: "Apartment move complete — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx service has been moved to a new apartment.</p>
<p>
  <strong>Previous account:</strong> {{previousCustomerNumber}} (apt {{previousApartment}})<br/>
  <strong>New account:</strong> {{customerNumber}} (apt {{apartmentNumber}})<br/>
  <strong>Building:</strong> {{buildingName}}<br/>
  <strong>Package:</strong> {{productName}}<br/>
  <strong>Installation:</strong> {{installationDateTime}}
</p>
<p>Please use your <strong>new</strong> account number as the M-Pesa Paybill reference going forward.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  cancellation: {
    label: "Subscription cancellation",
    description: "Sent when a subscription is cancelled.",
    defaultEnabled: true,
    defaultSubject: "Subscription cancelled — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx subscription on account <strong>{{customerNumber}}</strong> has been cancelled.</p>
<p>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}<br/>
  <strong>Package:</strong> {{productName}}<br/>
  {{#cancellationReason}}<strong>Reason:</strong> {{cancellationReason}}{{/cancellationReason}}
</p>
<p>If this was unexpected or you wish to reconnect, please email wecare@sulsolutions.biz or support@sulsolutions.biz. This is a no-reply email.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`.replace(
      "{{#cancellationReason}}<strong>Reason:</strong> {{cancellationReason}}{{/cancellationReason}}",
      "<strong>Reason:</strong> {{cancellationReason}}"
    ),
  },
  pause: {
    label: "Service pause",
    description: "Sent when service is paused (customer away).",
    defaultEnabled: true,
    defaultSubject: "Service paused — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx service on account <strong>{{customerNumber}}</strong> has been paused.</p>
<p>
  <strong>Pause period:</strong> {{pauseStartDate}} → {{pauseEndDate}}<br/>
  <strong>Reason:</strong> {{pauseReason}}<br/>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}
</p>
<p>Service will remain stopped until the pause ends (or you ask us to resume earlier).</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  disconnect: {
    label: "Service disconnect",
    description: "Sent when service is disconnected / suspended on the network.",
    defaultEnabled: true,
    defaultSubject: "Service disconnected — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your Starlynx internet service on account <strong>{{customerNumber}}</strong> has been disconnected.</p>
<p>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}<br/>
  <strong>Package:</strong> {{productName}}
</p>
<p>To restore service after payment, please email wecare@sulsolutions.biz or support@sulsolutions.biz. This is a no-reply email.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  trial_started: {
    label: "Trial started",
    description: "Sent when a customer signs up with a free trial.",
    defaultEnabled: true,
    defaultSubject: "Your Starlynx trial has started — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Your 30-day Starlynx trial is active.</p>
<p>
  <strong>Account:</strong> {{customerNumber}}<br/>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}<br/>
  <strong>Package:</strong> {{productName}}<br/>
  <strong>Trial ends:</strong> {{trialEndsAt}}
</p>
<p>After the trial, billing continues on your selected plan. Use your account number as the M-Pesa Paybill reference.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  referral_recorded: {
    label: "Referral recorded",
    description:
      "Sent to a referrer when a new customer is onboarded using their apartment as the referral.",
    defaultEnabled: true,
    defaultSubject: "A new customer used your referral — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>A new Starlynx customer has been registered using your referral.</p>
<p>
  <strong>Referred customer:</strong> {{referredCustomerName}} ({{referredCustomerNumber}})<br/>
  <strong>Your account:</strong> {{customerNumber}}<br/>
  <strong>Pending reward:</strong> {{referralDiscountPercent}}% off your next subscription after they complete their first payment
</p>
<p>We will email you again when the discount is applied to your next billing cycle.</p>
<p>This is a no-reply email. If you have any questions, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  referral_reward: {
    label: "Referral reward",
    description:
      "Sent to a referrer when their referral discount is applied to the next subscription cycle.",
    defaultEnabled: true,
    defaultSubject:
      "You've earned a {{referralDiscountPercent}}% referral discount — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Thank you for referring a new Starlynx customer{{#referredCustomerNumber}} (<strong>{{referredCustomerNumber}}</strong>){{/referredCustomerNumber}}.</p>
<p>As a thank you, your <strong>next subscription</strong> will be discounted by <strong>{{referralDiscountPercent}}%</strong>.</p>
<p>
  <strong>Your account:</strong> {{customerNumber}}<br/>
  <strong>Usual package price:</strong> {{packagePrice}}<br/>
  <strong>Next cycle with referral discount:</strong> {{referralDiscountedPrice}}
</p>
<p>After that billing cycle, your recurring amount returns to the normal package price automatically.</p>
<p>This is a no-reply email. If you have any questions, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`.replace(
      "{{#referredCustomerNumber}} (<strong>{{referredCustomerNumber}}</strong>){{/referredCustomerNumber}}",
      " (<strong>{{referredCustomerNumber}}</strong>)"
    ),
  },
  action_opened: {
    label: "Reminder opened",
    description:
      "Sent when staff create a customer-linked reminder (move-out, fault, collections, etc.).",
    defaultEnabled: true,
    defaultSubject: "{{actionTypeName}} — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>Our team has opened a follow-up on your Starlynx account <strong>{{customerNumber}}</strong>.</p>
<p>
  <strong>Type:</strong> {{actionTypeName}}<br/>
  <strong>Details:</strong> {{actionTitle}}<br/>
  <strong>Scheduled for:</strong> {{dueDate}}<br/>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}
</p>
<p>{{actionNotes}}</p>
<p>{{checklistSummary}}</p>
<p>A team member may contact you if we need access to the apartment or equipment.</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
  action_completed: {
    label: "Reminder completed",
    description: "Sent when a customer-linked reminder is marked complete.",
    defaultEnabled: true,
    defaultSubject: "{{actionTypeName}} complete — {{customerNumber}}",
    defaultBodyHtml: `<p>Dear {{firstName}},</p>
<p>We have completed the following follow-up on your Starlynx account <strong>{{customerNumber}}</strong>.</p>
<p>
  <strong>Type:</strong> {{actionTypeName}}<br/>
  <strong>Details:</strong> {{actionTitle}}<br/>
  <strong>Building:</strong> {{buildingName}} · apt {{apartmentNumber}}
</p>
<p>{{actionNotes}}</p>
<p>This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.</p>
<p>Thank you,<br/>Starlynx Customer Support</p>`,
  },
};

const CUSTOMER_EMAIL_TEMPLATE_KEYS = Object.keys(CUSTOMER_EMAIL_TEMPLATE_DEFS);

function coerceBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

const NO_REPLY_CONTACT_COPY =
  "This is a no-reply email. If you have any issues, please email wecare@sulsolutions.biz or support@sulsolutions.biz.";

/** Rewrite legacy “reply to this email” copy in saved templates. */
function migrateNoReplyEmailCopy(html) {
  let out = String(html || "");
  const replacements = [
    [
      /If you have any questions, reply to this email — we are happy to help\./gi,
      NO_REPLY_CONTACT_COPY,
    ],
    [
      /If anything looks wrong, reply to this email\./gi,
      NO_REPLY_CONTACT_COPY,
    ],
    [
      /Reply to this email with any questions\./gi,
      NO_REPLY_CONTACT_COPY,
    ],
    [
      /If this was unexpected or you wish to reconnect, reply to this email and we will help\./gi,
      `If this was unexpected or you wish to reconnect, please email wecare@sulsolutions.biz or support@sulsolutions.biz. This is a no-reply email.`,
    ],
    [
      /Reply to this email if you need changes\./gi,
      NO_REPLY_CONTACT_COPY,
    ],
    [
      /To restore service after payment or for any questions, reply to this email or contact support\./gi,
      `To restore service after payment, please email wecare@sulsolutions.biz or support@sulsolutions.biz. This is a no-reply email.`,
    ],
  ];
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function normalizeTemplateEntry(key, raw = {}) {
  const def = CUSTOMER_EMAIL_TEMPLATE_DEFS[key];
  if (!def) return null;
  const bodyHtml = migrateNoReplyEmailCopy(
    String(raw.bodyHtml || "").trim() || def.defaultBodyHtml
  );
  return {
    enabled: coerceBool(
      raw.enabled != null ? raw.enabled : def.defaultEnabled,
      def.defaultEnabled
    ),
    subject: String(raw.subject || "").trim() || def.defaultSubject,
    bodyHtml,
    ccEmails: normalizeEmailList(raw.ccEmails, []),
    label: def.label,
    description: def.description,
  };
}

function readLegacyWelcomeTemplate(saved = {}) {
  if (
    saved.welcomeEnabled == null &&
    !saved.welcomeSubject &&
    !saved.welcomeBodyHtml &&
    saved.welcomeCcEmails == null
  ) {
    return null;
  }
  return {
    enabled: saved.welcomeEnabled,
    subject: saved.welcomeSubject,
    bodyHtml: saved.welcomeBodyHtml,
    ccEmails: saved.welcomeCcEmails,
  };
}

/**
 * Customer-facing email settings (templates, CC lists, etc.).
 * Stored separately from Zoho Mail identity (communication.email).
 */
async function getCustomerEmailSettings() {
  const saved = (await getSetting("customer.email")) || {};
  const legacy = (await getSetting("communication.email")) || {};
  const envCc = String(process.env.ZOHO_INVOICE_CC_EMAILS || "").trim();

  const invoiceCcSource =
    saved.invoiceCcEmails != null
      ? saved.invoiceCcEmails
      : legacy.invoiceCcEmails != null
        ? legacy.invoiceCcEmails
        : envCc;

  const savedTemplates =
    saved.templates && typeof saved.templates === "object"
      ? saved.templates
      : {};
  const legacyWelcome = readLegacyWelcomeTemplate(saved);

  const templates = {};
  for (const key of CUSTOMER_EMAIL_TEMPLATE_KEYS) {
    const raw =
      savedTemplates[key] != null
        ? savedTemplates[key]
        : key === "welcome" && legacyWelcome
          ? legacyWelcome
          : {};
    templates[key] = normalizeTemplateEntry(key, raw);
  }

  return {
    invoiceCcEmails: normalizeEmailList(
      invoiceCcSource,
      DEFAULT_INVOICE_CC_EMAILS
    ),
    templates,
    // Back-compat flat welcome fields for older clients.
    welcomeEnabled: templates.welcome.enabled,
    welcomeSubject: templates.welcome.subject,
    welcomeBodyHtml: templates.welcome.bodyHtml,
    welcomeCcEmails: templates.welcome.ccEmails,
  };
}

async function saveCustomerEmailSettings(patch = {}, updatedBy = null) {
  const current = await getCustomerEmailSettings();
  const nextTemplates = { ...current.templates };

  if (patch.templates && typeof patch.templates === "object") {
    for (const key of CUSTOMER_EMAIL_TEMPLATE_KEYS) {
      if (patch.templates[key] == null) continue;
      const incoming = patch.templates[key] || {};
      const cur = current.templates[key];
      nextTemplates[key] = normalizeTemplateEntry(key, {
        enabled:
          incoming.enabled != null ? incoming.enabled : cur.enabled,
        subject:
          incoming.subject != null ? incoming.subject : cur.subject,
        bodyHtml:
          incoming.bodyHtml != null ? incoming.bodyHtml : cur.bodyHtml,
        ccEmails:
          incoming.ccEmails != null ? incoming.ccEmails : cur.ccEmails,
      });
    }
  }

  // Legacy flat welcome fields still accepted.
  if (
    patch.welcomeEnabled != null ||
    patch.welcomeSubject != null ||
    patch.welcomeBodyHtml != null ||
    patch.welcomeCcEmails != null
  ) {
    nextTemplates.welcome = normalizeTemplateEntry("welcome", {
      enabled:
        patch.welcomeEnabled != null
          ? patch.welcomeEnabled
          : nextTemplates.welcome.enabled,
      subject:
        patch.welcomeSubject != null
          ? patch.welcomeSubject
          : nextTemplates.welcome.subject,
      bodyHtml:
        patch.welcomeBodyHtml != null
          ? patch.welcomeBodyHtml
          : nextTemplates.welcome.bodyHtml,
      ccEmails:
        patch.welcomeCcEmails != null
          ? patch.welcomeCcEmails
          : nextTemplates.welcome.ccEmails,
    });
  }

  for (const key of CUSTOMER_EMAIL_TEMPLATE_KEYS) {
    const t = nextTemplates[key];
    if (!t.subject) {
      throw new Error(`${CUSTOMER_EMAIL_TEMPLATE_DEFS[key].label} subject is required`);
    }
    if (!t.bodyHtml) {
      throw new Error(`${CUSTOMER_EMAIL_TEMPLATE_DEFS[key].label} body is required`);
    }
  }

  const next = {
    invoiceCcEmails:
      patch.invoiceCcEmails != null
        ? normalizeEmailList(patch.invoiceCcEmails, [])
        : current.invoiceCcEmails,
    templates: Object.fromEntries(
      CUSTOMER_EMAIL_TEMPLATE_KEYS.map((key) => [
        key,
        {
          enabled: nextTemplates[key].enabled,
          subject: nextTemplates[key].subject,
          bodyHtml: nextTemplates[key].bodyHtml,
          ccEmails: nextTemplates[key].ccEmails,
        },
      ])
    ),
  };

  if (!next.invoiceCcEmails.length) {
    throw new Error("At least one invoice CC email is required");
  }

  await setSetting("customer.email", next, updatedBy);
  return getCustomerEmailSettings();
}

const DEFAULT_WHATSAPP_WELCOME =
  "Welcome to Starlynx! What are you interested in?";
const DEFAULT_WHATSAPP_COMPLETE =
  "Thanks! Our sales team will contact you shortly. You can also visit our website for packages.";

function pickSecret(patchValue, currentValue) {
  if (patchValue === undefined || patchValue === null) return currentValue;
  const trimmed = String(patchValue).trim();
  // Blank means "keep existing" so the UI can omit secrets on save.
  if (!trimmed) return currentValue;
  return trimmed;
}

async function getCommunicationWhatsAppSettings() {
  const saved = (await getSetting("communication.whatsapp")) || {};
  return {
    phoneNumberId: String(
      saved.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || ""
    ).trim(),
    accessToken: String(
      saved.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || ""
    ).trim(),
    appSecret: String(
      saved.appSecret || process.env.WHATSAPP_APP_SECRET || ""
    ).trim(),
    webhookVerifyToken: String(
      saved.webhookVerifyToken ||
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
        ""
    ).trim(),
    clickToChatUrl:
      String(
        saved.clickToChatUrl || process.env.WHATSAPP_CLICK_TO_CHAT_URL || ""
      ).trim() || null,
    welcomeMessage:
      String(
        saved.welcomeMessage || process.env.WHATSAPP_WELCOME_MESSAGE || ""
      ).trim() || DEFAULT_WHATSAPP_WELCOME,
    completeMessage:
      String(
        saved.completeMessage || process.env.WHATSAPP_COMPLETE_MESSAGE || ""
      ).trim() || DEFAULT_WHATSAPP_COMPLETE,
    outboundTemplate:
      String(
        saved.outboundTemplate || process.env.WHATSAPP_OUTBOUND_TEMPLATE || ""
      ).trim() || null,
    outboundTemplateLang:
      String(
        saved.outboundTemplateLang ||
          process.env.WHATSAPP_OUTBOUND_TEMPLATE_LANG ||
          "en"
      ).trim() || "en",
  };
}

async function saveCommunicationWhatsAppSettings(patch = {}, updatedBy = null) {
  const current = await getCommunicationWhatsAppSettings();
  const next = {
    phoneNumberId:
      patch.phoneNumberId != null
        ? String(patch.phoneNumberId).trim()
        : current.phoneNumberId,
    accessToken: pickSecret(patch.accessToken, current.accessToken),
    appSecret: pickSecret(patch.appSecret, current.appSecret),
    webhookVerifyToken:
      patch.webhookVerifyToken != null
        ? String(patch.webhookVerifyToken).trim()
        : current.webhookVerifyToken,
    clickToChatUrl:
      patch.clickToChatUrl != null
        ? String(patch.clickToChatUrl).trim() || null
        : current.clickToChatUrl,
    welcomeMessage:
      patch.welcomeMessage != null
        ? String(patch.welcomeMessage).trim() || DEFAULT_WHATSAPP_WELCOME
        : current.welcomeMessage,
    completeMessage:
      patch.completeMessage != null
        ? String(patch.completeMessage).trim() || DEFAULT_WHATSAPP_COMPLETE
        : current.completeMessage,
    outboundTemplate:
      patch.outboundTemplate != null
        ? String(patch.outboundTemplate).trim() || null
        : current.outboundTemplate,
    outboundTemplateLang:
      patch.outboundTemplateLang != null
        ? String(patch.outboundTemplateLang).trim() || "en"
        : current.outboundTemplateLang,
  };

  // Clearing phone number ID disables WhatsApp — drop the stored token too.
  if (patch.phoneNumberId != null && !next.phoneNumberId) {
    next.accessToken =
      patch.accessToken != null && String(patch.accessToken).trim()
        ? String(patch.accessToken).trim()
        : "";
  }

  if (!next.phoneNumberId && !next.accessToken) {
    // WhatsApp disabled — nothing further to validate.
  } else if (!next.phoneNumberId || !next.accessToken) {
    throw new Error("Phone number ID and access token are both required");
  } else if (!next.appSecret) {
    throw new Error(
      "App secret is required for webhook signature verification when WhatsApp is configured"
    );
  }

  await setSetting("communication.whatsapp", next, updatedBy);
  return next;
}

function toPublicWhatsAppSettings(settings) {
  return {
    phoneNumberId: settings.phoneNumberId || "",
    accessTokenConfigured: Boolean(settings.accessToken),
    appSecretConfigured: Boolean(settings.appSecret),
    webhookVerifyToken: settings.webhookVerifyToken || "",
    webhookVerifyTokenConfigured: Boolean(settings.webhookVerifyToken),
    clickToChatUrl: settings.clickToChatUrl,
    welcomeMessage: settings.welcomeMessage,
    completeMessage: settings.completeMessage,
    outboundTemplate: settings.outboundTemplate,
    outboundTemplateLang: settings.outboundTemplateLang,
    configured: Boolean(settings.phoneNumberId && settings.accessToken),
  };
}

module.exports = {
  getSetting,
  setSetting,
  getCommunicationEmailSettings,
  saveCommunicationEmailSettings,
  getCustomerEmailSettings,
  saveCustomerEmailSettings,
  getCommunicationWhatsAppSettings,
  saveCommunicationWhatsAppSettings,
  toPublicWhatsAppSettings,
  normalizeEmailList,
  DEFAULT_INVOICE_CC_EMAILS,
  DEFAULT_WELCOME_SUBJECT,
  DEFAULT_WELCOME_BODY_HTML,
  CUSTOMER_EMAIL_TEMPLATE_DEFS,
  CUSTOMER_EMAIL_TEMPLATE_KEYS,
  DEFAULT_WHATSAPP_WELCOME,
  DEFAULT_WHATSAPP_COMPLETE,
};
