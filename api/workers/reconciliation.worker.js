const reconciliationStore = require("../services/reconciliationStore");
const syncJobRepo = require("../repositories/syncJob.repository");
const integrationStateRepo = require("../repositories/integrationState.repository");
const customerRepo = require("../repositories/customer.repository");
const { loadEnv } = require("../config/env");
const { INTEGRATIONS } = require("../queue/definitions");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { ensureSyncJobRecord } = require("./base.worker");
const {
  canRunBackgroundBatch,
  getZohoBudgetStatus,
  logBudgetSkip,
} = require("../lib/zohoApiBudget");

const INTEGRATION = INTEGRATIONS.RECONCILIATION;

async function processReconciliationSyncJob(job) {
  const started = Date.now();
  const env = loadEnv();
  let {
    correlationId,
    triggeredBy = "queue",
    userId = null,
    fullZoho = true,
    browseOnly = false,
  } = job.data;

  if (triggeredBy !== "manual" && fullZoho === false) {
    browseOnly = true;
  }

  const syncJobDbId = await ensureSyncJobRecord(job, INTEGRATION);
  await syncJobRepo.markSyncJobRunning(syncJobDbId, job.id);

  if (fullZoho && triggeredBy !== "manual") {
    const customerCount = await customerRepo.countActiveCustomers();
    const estimate = customerCount * env.ZOHO_CALLS_PER_CUSTOMER_ESTIMATE;
    if (!(await canRunBackgroundBatch(estimate))) {
      const status = await getZohoBudgetStatus();
      logBudgetSkip(INTEGRATION, "full_zoho_downgraded_to_quick", status);
      fullZoho = false;
    }
  }

  emitSyncEvent("sync:started", {
    integration: INTEGRATION,
    correlationId,
    syncJobDbId,
    jobId: job.id,
  });

  const onProgress = async (progress) => {
    emitSyncEvent("sync:progress", {
      integration: INTEGRATION,
      correlationId,
      syncJobDbId,
      status: "running",
      progress,
    });
    await syncJobRepo.updateSyncJobProgress(syncJobDbId, {
      recordsProcessed: progress.processed,
      recordsFailed: 0,
    });
  };

  try {
    const result = await reconciliationStore.doRunSync({
      triggeredBy,
      userId,
      fullZoho,
      browseOnly,
      onProgress,
      syncJobDbId,
    });

    const now = new Date();
    await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
      lastSyncedAt: now,
      lastSuccessAt: now,
      lastError: null,
    });

    await syncJobRepo.completeSyncJob(syncJobDbId, {
      recordsProcessed: result.customersScanned || 0,
      recordsUpdated: result.customersScanned || 0,
      lastSyncedAt: now,
    });

    await invalidateDashboardCaches();

    const durationMs = Date.now() - started;
    const payload = {
      ok: true,
      integration: INTEGRATION,
      ...result,
      fullZoho,
      durationMs,
      correlationId,
      syncJobDbId,
    };

    emitSyncEvent("sync:completed", payload);
    syncLog.job({
      integration: INTEGRATION,
      jobId: job.id,
      event: "completed",
      durationMs,
      correlationId,
      ...result,
    });

    return payload;
  } catch (err) {
    await syncJobRepo.failSyncJob(syncJobDbId, err.message);
    await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
      lastError: err.message,
    });

    emitSyncEvent("sync:failed", {
      integration: INTEGRATION,
      correlationId,
      syncJobDbId,
      error: err.message,
    });

    syncLog.job({
      integration: INTEGRATION,
      jobId: job.id,
      event: "failed",
      correlationId,
      error: err,
    });

    throw err;
  }
}

module.exports = { processReconciliationSyncJob, INTEGRATION };
