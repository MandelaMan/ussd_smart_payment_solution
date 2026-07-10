const { loadEnv } = require("../../config/env");
const { fetchZohoListPage } = require("./zohoListApi");
const zohoEntityRepo = require("../../repositories/zohoEntity.repository");
const integrationStateRepo = require("../../repositories/integrationState.repository");
const {
  canMakeZohoCall,
  getZohoBudgetStatus,
  logBudgetSkip,
} = require("../../lib/zohoApiBudget");
const { recordZohoApiUsage } = require("../../lib/zohoApiUsage");
const { syncLog } = require("../../lib/structuredLogger");

const env = loadEnv();
const MAX_PAGES = env.ZOHO_SYNC_MAX_PAGES;

const MODULES = {
  contacts: {
    integration: "zoho-contacts",
    resource: "contacts",
    upsert: zohoEntityRepo.upsertContactRecord,
    label: "Contacts",
  },
  invoices: {
    integration: "invoices",
    resource: "invoices",
    upsert: zohoEntityRepo.upsertInvoiceRecord,
    label: "Invoices",
  },
  customerpayments: {
    integration: "zoho-payments",
    resource: "customerpayments",
    upsert: zohoEntityRepo.upsertPaymentRecord,
    label: "Customer Payments",
  },
  recurringinvoices: {
    integration: "zoho-recurring",
    resource: "recurringinvoices",
    upsert: zohoEntityRepo.upsertRecurringRecord,
    label: "Recurring Invoices",
  },
  estimates: {
    integration: "zoho-estimates",
    resource: "estimates",
    upsert: zohoEntityRepo.upsertEstimateRecord,
    label: "Estimates",
  },
  creditnotes: {
    integration: "zoho-credit-notes",
    resource: "creditnotes",
    upsert: zohoEntityRepo.upsertCreditNoteRecord,
    label: "Credit Notes",
  },
};

function getModuleConfig(moduleKey) {
  const cfg = MODULES[moduleKey];
  if (!cfg) throw new Error(`Unknown Zoho sync module: ${moduleKey}`);
  return cfg;
}

function resolveModifiedSince(state, incremental) {
  if (!incremental) return null;
  const cursor = state?.sync_cursor;
  if (cursor?.lastModifiedCheckpoint) return cursor.lastModifiedCheckpoint;
  if (state?.last_success_at) return state.last_success_at;

  // First run: lookback window only — never pull the entire Zoho catalog.
  const days = Math.max(1, env.ZOHO_INCREMENTAL_LOOKBACK_DAYS || 7);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Incremental org-level Zoho Books sync for a single module.
 * Uses last_modified_time — never scans all customers individually.
 */
async function syncZohoModule(moduleKey, options = {}) {
  const cfg = getModuleConfig(moduleKey);
  const {
    incremental = true,
    onProgress,
    correlationId,
    source = "scheduled",
  } = options;

  const started = Date.now();
  const state = await integrationStateRepo.getIntegrationState(cfg.integration);
  const modifiedSince = resolveModifiedSince(state, incremental);

  await integrationStateRepo.upsertIntegrationState(cfg.integration, {
    lastSyncedAt: new Date(),
    lastAttemptAt: new Date(),
    status: "running",
    lastError: null,
  });

  let page = 1;
  let hasMore = true;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let apiCallsUsed = 0;
  let pausedForBudget = false;
  let maxModified = modifiedSince ? new Date(modifiedSince) : null;

  while (hasMore) {
    if (page > MAX_PAGES) {
      syncLog.warn("zoho_sync_page_cap", {
        module: moduleKey,
        maxPages: MAX_PAGES,
        processed,
        updated,
      });
      break;
    }

    if (!(await canMakeZohoCall("background", 1))) {
      const status = await getZohoBudgetStatus();
      logBudgetSkip(cfg.integration, "daily_budget_exhausted", status);
      pausedForBudget = true;
      break;
    }

    let pageResult;
    try {
      pageResult = await fetchZohoListPage(cfg.resource, {
        page,
        perPage: env.SYNC_PAGE_SIZE,
        lastModifiedTime: modifiedSince,
      });
      apiCallsUsed += 1;
      await recordZohoApiUsage({
        module: cfg.integration,
        source,
        count: 1,
        correlationId,
      });
    } catch (err) {
      await integrationStateRepo.upsertIntegrationState(cfg.integration, {
        status: "failed",
        lastError: err.message,
        lastAttemptAt: new Date(),
      });
      throw err;
    }

    for (const record of pageResult.items) {
      processed += 1;
      try {
        const result = await cfg.upsert(record);
        if (result.updated) {
          updated += 1;
          const mod = record.last_modified_time
            ? new Date(record.last_modified_time)
            : null;
          if (mod && !Number.isNaN(mod.getTime())) {
            if (!maxModified || mod > maxModified) maxModified = mod;
          }
        } else {
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        syncLog.warn("zoho_entity_upsert_failed", {
          module: moduleKey,
          error: err.message,
          correlationId,
        });
      }
    }

    // Incremental sync: stop when a page returns no rows (filter is working).
    if (incremental && modifiedSince && pageResult.items.length === 0) {
      hasMore = false;
      break;
    }

    hasMore = pageResult.hasMore;
    page += 1;

    if (onProgress) {
      await onProgress({ processed, updated, skipped, failed, page, hasMore });
    }

    if (page > 500) {
      syncLog.warn("zoho_sync_page_limit", { module: moduleKey, page });
      break;
    }
  }

  const now = new Date();
  const checkpoint = maxModified
    ? maxModified.toISOString()
    : modifiedSince || now.toISOString();

  await integrationStateRepo.upsertIntegrationState(cfg.integration, {
    lastSyncedAt: now,
    lastSuccessAt: pausedForBudget ? state?.last_success_at || null : now,
    lastAttemptAt: now,
    status: pausedForBudget ? "paused" : failed > 0 && updated === 0 ? "failed" : "success",
    lastError: pausedForBudget
      ? "Paused — Zoho daily API budget reserved for interactive use"
      : failed > 0
        ? `${failed} record(s) failed to upsert`
        : null,
    recordsUpdated: updated,
    syncCursor: {
      lastModifiedCheckpoint: checkpoint,
      lastPage: page - 1,
      pausedReason: pausedForBudget ? "zoho_budget" : null,
    },
  });

  const durationMs = Date.now() - started;
  const result = {
    ok: true,
    module: moduleKey,
    integration: cfg.integration,
    processed,
    updated,
    skipped,
    failed,
    apiCallsUsed,
    durationMs,
    pausedForBudget,
    incremental: Boolean(modifiedSince),
    checkpoint,
  };

  syncLog.job({
    integration: cfg.integration,
    event: "zoho_module_sync",
    correlationId,
    ...result,
  });

  return result;
}

module.exports = {
  MODULES,
  syncZohoModule,
  getModuleConfig,
};
