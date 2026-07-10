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
            "Full access including user management, settings, logs, and all modules. Administrator accounts cannot be deactivated.",
        },
        {
          id: "support",
          label: "Customer support",
          description: "View and manage customers and configuration; no financials or logs",
        },
        {
          id: "cfo",
          label: "CFO",
          description: "Financial reports and transactions; no customer write or settings",
        },
        {
          id: "partner",
          label: "Partner",
          description:
            "Read-only partner dashboard, reports (Excel/PDF), and customer list; aggregate metrics only — no edits, billing, or transaction detail",
        },
      ],
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getSettings };
