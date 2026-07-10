const { loadEnv } = require("../config/env");

/**
 * Central policy for when background jobs may call Zoho Books.
 * Default: minimal — webhooks + manual refresh + infrequent incremental lists only.
 */
function getZohoSyncPolicy() {
  const env = loadEnv();
  const mode = String(process.env.ZOHO_SYNC_MODE || "minimal").toLowerCase();

  const scheduledModules =
    mode === "minimal"
      ? parseModuleList(process.env.ZOHO_SCHEDULED_MODULES || "zoho-contacts,invoices")
      : parseModuleList(
          process.env.ZOHO_SCHEDULED_MODULES ||
            "zoho-contacts,invoices,zoho-recurring,zoho-payments,zoho-estimates,zoho-credit-notes"
        );

  return {
    mode,
    scheduledModules: [...scheduledModules],
    incrementalLookbackDays: env.ZOHO_INCREMENTAL_LOOKBACK_DAYS,
    fullReconciliationScheduled: env.RECONCILIATION_FULL_ZOHO_SCHEDULED,
    backgroundSyncEnabled: env.ZOHO_BACKGROUND_SYNC_ENABLED,
    syncIntervalMs: env.ZOHO_SYNC_INTERVAL_MS,
  };
}

function parseModuleList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isScheduledZohoModule(integration) {
  const modules = parseModuleList(
    String(process.env.ZOHO_SCHEDULED_MODULES || "zoho-contacts,invoices")
  );
  const mode = String(process.env.ZOHO_SYNC_MODE || "minimal").toLowerCase();
  if (mode === "minimal") {
    return modules.includes(integration);
  }
  const full = parseModuleList(
    process.env.ZOHO_SCHEDULED_MODULES ||
      "zoho-contacts,invoices,zoho-recurring,zoho-payments,zoho-estimates,zoho-credit-notes"
  );
  return full.includes(integration);
}

/** Only explicit refresh / manual full sync / payment flows may hit Zoho per customer. */
function mayCallZohoForCustomer(options = {}) {
  // Explicit refresh / allow flags win over skipZoho (callers often pass both).
  if (options.refreshZoho === true) return true;
  if (options.allowZohoApi === true) return true;
  if (options.skipZoho === true) return false;
  return false;
}

module.exports = {
  getZohoSyncPolicy,
  isScheduledZohoModule,
  mayCallZohoForCustomer,
};
