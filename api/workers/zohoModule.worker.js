const { createProgressReporter, ensureSyncJobRecord } = require("./base.worker");
const { syncZohoModule } = require("../services/zoho/zohoIncrementalSync.service");
const syncJobRepo = require("../repositories/syncJob.repository");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { isScheduledZohoModule } = require("../lib/zohoSyncPolicy");

const MODULE_BY_INTEGRATION = {
  "zoho-contacts": "contacts",
  invoices: "invoices",
  "zoho-recurring": "recurringinvoices",
  "zoho-payments": "customerpayments",
  "zoho-estimates": "estimates",
  "zoho-credit-notes": "creditnotes",
};

function createZohoModuleProcessor(integration) {
  const moduleKey = MODULE_BY_INTEGRATION[integration];
  if (!moduleKey) {
    throw new Error(`No Zoho module mapping for integration: ${integration}`);
  }

  return async function processZohoModuleJob(job) {
    const started = Date.now();
    const { correlationId, incremental = true, triggeredBy = "scheduled" } = job.data;

    if (triggeredBy === "scheduled" && !isScheduledZohoModule(integration)) {
      syncLog.info("zoho_sync_skipped_policy", { integration, triggeredBy });
      return { ok: true, skipped: true, integration, reason: "not_in_scheduled_modules" };
    }

    const source =
      triggeredBy === "manual"
        ? "manual"
        : triggeredBy === "webhook"
          ? "webhook"
          : "scheduled";

    const syncJobDbId = await ensureSyncJobRecord(job, integration);
    await syncJobRepo.markSyncJobRunning(syncJobDbId, job.id);

    emitSyncEvent("sync:started", {
      integration,
      correlationId,
      syncJobDbId,
      jobId: job.id,
    });

    const reporter = createProgressReporter({
      integration,
      correlationId,
      syncJobDbId,
      total: 0,
      onDbProgress: (counts) => syncJobRepo.updateSyncJobProgress(syncJobDbId, counts),
    });

    const result = await syncZohoModule(moduleKey, {
      incremental,
      correlationId,
      source,
      onProgress: async (progress) => {
        await reporter.report({
          processed: progress.processed,
          created: 0,
          updated: progress.updated,
          failed: progress.failed,
          total: progress.processed,
          phase: progress.hasMore ? `page ${progress.page}` : "complete",
        });
      },
    });

    let emailRepair = null;
    if (integration === "invoices") {
      try {
        const {
          repairZohoInvoiceEmailAssociations,
        } = require("../services/zohoInvoiceEmailRepair");
        emailRepair = await repairZohoInvoiceEmailAssociations({
          correlationId,
        });
      } catch (err) {
        syncLog.warn("zoho_invoice_email_repair_skipped", {
          integration,
          correlationId,
          error: err.message || String(err),
        });
      }
    }

    await syncJobRepo.completeSyncJob(syncJobDbId, {
      recordsProcessed: result.processed,
      recordsCreated: 0,
      recordsUpdated: result.updated,
      recordsFailed: result.failed,
      lastSyncedAt: new Date(),
    });

    await invalidateDashboardCaches();

    const durationMs = Date.now() - started;
    const payload = {
      ok: true,
      integration,
      ...result,
      emailRepair,
      durationMs,
      correlationId,
      syncJobDbId,
    };

    emitSyncEvent("sync:completed", payload);
    syncLog.job({
      integration,
      jobId: job.id,
      event: "completed",
      durationMs,
      correlationId,
      ...result,
    });

    return payload;
  };
}

module.exports = {
  createZohoModuleProcessor,
  MODULE_BY_INTEGRATION,
};
