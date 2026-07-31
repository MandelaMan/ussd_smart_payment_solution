const { emitSyncEvent } = require("../socket");
const syncJobRepo = require("../repositories/syncJob.repository");

async function ensureSyncJobRecord(job, integration) {
  if (job.data?.syncJobDbId) return job.data.syncJobDbId;
  const id = await syncJobRepo.createSyncJob({
    integration,
    jobId: String(job.id),
    correlationId: job.data?.correlationId || String(job.id),
    metadata: { triggeredBy: job.data?.triggeredBy || "scheduled" },
  });
  job.data.syncJobDbId = id;
  return id;
}

function createProgressReporter({
  integration,
  correlationId,
  syncJobDbId,
  total = 0,
  onDbProgress,
}) {
  let processed = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  let lastSocketAt = 0;
  let lastDbAt = 0;

  const report = async (patch = {}) => {
    if (patch.processed != null) processed = patch.processed;
    if (patch.created != null) created = patch.created;
    if (patch.updated != null) updated = patch.updated;
    if (patch.failed != null) failed = patch.failed;
    if (patch.incrementProcessed) processed += patch.incrementProcessed;
    if (patch.incrementCreated) created += patch.incrementCreated;
    if (patch.incrementUpdated) updated += patch.incrementUpdated;
    if (patch.incrementFailed) failed += patch.incrementFailed;

    const now = Date.now();
    const isFinal =
      patch.force === true || (total > 0 && processed >= total);
    // Throttle socket/DB writes during large syncs; always flush on completion.
    const shouldEmit =
      isFinal || processed % 25 === 0 || now - lastSocketAt >= 750;
    if (!shouldEmit) return;

    lastSocketAt = now;
    const payload = {
      integration,
      correlationId,
      syncJobDbId,
      status: "running",
      progress: {
        processed,
        total: patch.total != null ? patch.total : total,
        percent: total > 0 ? Math.round((processed / total) * 100) : 0,
        created,
        updated,
        failed,
        phase: patch.phase || null,
      },
    };

    emitSyncEvent("sync:progress", payload);

    if (onDbProgress && (isFinal || now - lastDbAt >= 2000)) {
      lastDbAt = now;
      await onDbProgress({
        recordsProcessed: processed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsFailed: failed,
      });
    }
  };

  return { report, getCounts: () => ({ processed, created, updated, failed }) };
}

async function runWorkerSafely(handler, job) {
  try {
    return await handler(job);
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      stack: err.stack,
    };
  }
}

module.exports = { createProgressReporter, runWorkerSafely, ensureSyncJobRecord };
