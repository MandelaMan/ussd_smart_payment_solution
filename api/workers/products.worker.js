const integrationStateRepo = require("../repositories/integrationState.repository");
const syncJobRepo = require("../repositories/syncJob.repository");
const { INTEGRATIONS } = require("../queue/definitions");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { ensureSyncJobRecord } = require("./base.worker");

const INTEGRATION = INTEGRATIONS.PRODUCTS;

async function processProductsSyncJob(job) {
  const started = Date.now();
  const { correlationId } = job.data;
  const syncJobDbId = await ensureSyncJobRecord(job, INTEGRATION);
  await syncJobRepo.markSyncJobRunning(syncJobDbId, job.id);

  emitSyncEvent("sync:started", {
    integration: INTEGRATION,
    correlationId,
    syncJobDbId,
    jobId: job.id,
  });

  const { syncCatalogPackagesToTisp } = require("../controllers/tisp.controller");
  const results = await syncCatalogPackagesToTisp({
    correlationId,
  });
  const processed = Array.isArray(results) ? results.length : 0;
  const failed = (results || []).filter((row) => !row.ok);
  const now = new Date();

  await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
    lastSyncedAt: now,
    lastSuccessAt: failed.length === processed && processed > 0 ? null : now,
    lastError: failed[0]?.error || null,
  });

  await syncJobRepo.completeSyncJob(syncJobDbId, {
    recordsProcessed: processed,
    lastSyncedAt: now,
  });

  await invalidateDashboardCaches();

  const durationMs = Date.now() - started;
  const result = {
    ok: true,
    integration: INTEGRATION,
    processed,
    failed: failed.length,
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

module.exports = { processProductsSyncJob, INTEGRATION };
