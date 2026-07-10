const paymentService = require("../services/external/payment.service");
const reconciliationStore = require("../services/reconciliationStore");
const integrationStateRepo = require("../repositories/integrationState.repository");
const syncJobRepo = require("../repositories/syncJob.repository");
const { INTEGRATIONS } = require("../queue/definitions");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { ensureSyncJobRecord } = require("./base.worker");

const INTEGRATION = INTEGRATIONS.PAYMENT;

async function processPaymentSyncJob(job) {
  const started = Date.now();
  const { correlationId, incremental = true, triggeredBy = "scheduled" } = job.data;
  const syncJobDbId = await ensureSyncJobRecord(job, INTEGRATION);
  await syncJobRepo.markSyncJobRunning(syncJobDbId, job.id);

  emitSyncEvent("sync:started", {
    integration: INTEGRATION,
    correlationId,
    syncJobDbId,
    jobId: job.id,
  });

  const unmatched = await paymentService.loadUnmatchedMpesa();
  await reconciliationStore.setUnmatchedMpesaCache(unmatched);

  const processed = unmatched.length;
  const now = new Date();

  await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
    lastSyncedAt: now,
    lastSuccessAt: now,
    lastAttemptAt: now,
    status: "success",
    lastError: null,
    recordsUpdated: processed,
  });

  await syncJobRepo.completeSyncJob(syncJobDbId, {
    recordsProcessed: processed,
    recordsUpdated: processed,
    lastSyncedAt: now,
    metadata: { unmatchedMpesa: processed },
  });

  await invalidateDashboardCaches();

  const durationMs = Date.now() - started;
  const result = {
    ok: true,
    integration: INTEGRATION,
    processed,
    unmatchedCount: processed,
    durationMs,
  };

  emitSyncEvent("sync:completed", { ...result, correlationId, syncJobDbId });
  syncLog.job({
    integration: INTEGRATION,
    jobId: job.id,
    event: "completed",
    durationMs,
    correlationId,
    ...result,
  });

  return result;
}

module.exports = { processPaymentSyncJob, INTEGRATION };
