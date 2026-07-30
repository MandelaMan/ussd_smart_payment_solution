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

async function getCommunicationEmailSettings() {
  const saved = (await getSetting("communication.email")) || {};
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
  getCommunicationWhatsAppSettings,
  saveCommunicationWhatsAppSettings,
  toPublicWhatsAppSettings,
  DEFAULT_WHATSAPP_WELCOME,
  DEFAULT_WHATSAPP_COMPLETE,
};
