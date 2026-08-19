function publicBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function envUrl(envValue, fallback) {
  const trimmed = String(envValue || "").trim();
  return trimmed || fallback;
}

async function getSettings(req, res, next) {
  try {
    const base = publicBaseUrl(req);
    const appSettingsStore = require("../services/appSettingsStore");
    const { getZohoMailConfig, isZohoMailConfigured } = require("../utils/zohoMail");
    const emailSettings = await appSettingsStore.getCommunicationEmailSettings();
    const customerEmailSettings =
      await appSettingsStore.getCustomerEmailSettings();
    const mailStatus = await getZohoMailConfig();
    const whatsappSettings =
      await appSettingsStore.getCommunicationWhatsAppSettings();
    const whatsappPublic =
      appSettingsStore.toPublicWhatsAppSettings(whatsappSettings);

    res.json({
      webhooks: {
        mpesa: {
          callback: envUrl(process.env.MPESA_CALLBACK_URL, `${base}/api/payment/callback`),
          confirmation: envUrl(
            process.env.MPESA_CONFIRMATION_URL,
            `${base}/api/payment/confirmation`
          ),
          validation: envUrl(
            process.env.MPESA_VALIDATION_URL,
            `${base}/api/payment/validation`
          ),
          b2cResult: envUrl(
            process.env.MPESA_B2C_RESULT_URL,
            `${base}/api/payment/b2c/result`
          ),
          b2cTimeout: envUrl(
            process.env.MPESA_B2C_TIMEOUT_URL,
            `${base}/api/payment/b2c/timeout`
          ),
        },
        zoho: {
          invoicePaid: `${base}/api/public/zoho/webhook`,
          secretConfigured: Boolean(String(process.env.ZOHO_WEBHOOK_SECRET || "").trim()),
          setupHint:
            "In Zoho Books → Settings → Automation → Workflow Rules, trigger on Invoice Paid and POST the invoice JSON to invoicePaid with header x-zoho-webhook-secret (zero outbound API calls).",
        },
        leads: {
          publicForm: `${base}/leads`,
          signupForm: `${base}/signup`,
          embedScript: `${base}/leads/embed.js`,
          embedSnippet: `<div id="starlynx-lead-form"></div>\n<script src="${base}/leads/embed.js" async></script>`,
          whatsappWebhook: `${base}/api/public/whatsapp/webhook`,
          whatsappVerifyTokenConfigured:
            whatsappPublic.webhookVerifyTokenConfigured,
          whatsappConfigured: whatsappPublic.configured,
        },
      },
      communication: {
        email: {
          fromAddress: emailSettings.fromAddress,
          fromName: emailSettings.fromName,
          accountId: emailSettings.accountId,
          configured: isZohoMailConfigured(),
          oauthTokenConfigured: mailStatus.oauthTokenConfigured,
          dnsHint:
            "Use a single SPF TXT on @ for sulsolutions.biz (merge includes). Enable DKIM in Zoho Mail Admin, then add DMARC on _dmarc.",
        },
        customerEmail: {
          invoiceCcEmails: customerEmailSettings.invoiceCcEmails,
          templates: customerEmailSettings.templates,
          welcomeEnabled: customerEmailSettings.welcomeEnabled,
          welcomeSubject: customerEmailSettings.welcomeSubject,
          welcomeBodyHtml: customerEmailSettings.welcomeBodyHtml,
          welcomeCcEmails: customerEmailSettings.welcomeCcEmails,
        },
        whatsapp: whatsappPublic,
      },
      integrations: {
        xtreamSyncEnabled: process.env.XTREAM_SYNC_ENABLED !== "false",
        mpesaStkLiveAmount: process.env.MPESA_STK_USE_LIVE_AMOUNT === "true",
        zohoTaxInclusive: process.env.ZOHO_INVOICE_TAX_INCLUSIVE === "true",
      },
      roles: [
        {
          id: "admin",
          label: "Administrator",
          description:
            "System role with full access by default. Permissions can still be revoked via individual denies. Administrator accounts cannot be deactivated.",
        },
        {
          id: "user",
          label: "User",
          description:
            "Standard employee role with least-privilege defaults. Access is granted through User Groups and individual permission overrides.",
        },
      ],
      permissionModel: {
        inheritance: [
          "System role defaults",
          "User group permissions (merged)",
          "Individual grants / denies (highest priority)",
        ],
        groups: [
          "Sales",
          "Finance",
          "Support",
          "Network Operations",
          "Management",
          "Installations",
          "Customer Relations",
          "Billing",
        ],
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getSettings };
