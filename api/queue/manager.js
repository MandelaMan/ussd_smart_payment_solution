const { Queue, QueueEvents } = require("bullmq");
const { loadEnv } = require("../config/env");
const { getBullConnection, defaultJobOptions } = require("./connection");
const { getQueueConfig, ALL_INTEGRATIONS } = require("./definitions");
const { createCorrelationId } = require("../lib/correlation");
const syncJobRepo = require("../repositories/syncJob.repository");
const { syncLog } = require("../lib/structuredLogger");

const env = loadEnv();
const queues = new Map();
const dlqQueues = new Map();
const queueEvents = new Map();
let initialized = false;

function getQueue(integration, { withEvents = true } = {}) {
  const cfg = getQueueConfig(integration);
  if (!queues.has(integration)) {
    const queue = new Queue(cfg.name, {
      connection: getBullConnection(),
      defaultJobOptions: defaultJobOptions(integration),
    });
    queues.set(integration, queue);

    const dlq = new Queue(cfg.dlqName, {
      connection: getBullConnection(),
    });
    dlqQueues.set(integration, dlq);
  }

  if (withEvents && !queueEvents.has(integration)) {
    const queue = queues.get(integration);
    const dlq = dlqQueues.get(integration);
    const events = new QueueEvents(cfg.name, { connection: getBullConnection() });
    queueEvents.set(integration, events);

    events.on("failed", async ({ jobId, failedReason }) => {
      try {
        const job = await queue.getJob(jobId);
        if (!job) return;
        const attemptsMade = job.attemptsMade || 0;
        const maxAttempts = job.opts?.attempts || 1;
        if (attemptsMade >= maxAttempts) {
          await dlq.add(
            "dead-letter",
            { ...job.data, failedReason, originalJobId: jobId },
            { jobId: `dlq-${jobId}` }
          );
          syncLog.warn("job_moved_to_dlq", {
            integration,
            jobId,
            failedReason,
          });
        }
      } catch (err) {
        syncLog.error("dlq_handler_error", { integration, error: err });
      }
    });
  }
  return queues.get(integration);
}

function buildDedupeJobId(integration, suffix = "scheduled") {
  return `${integration}-${suffix}`;
}

/**
 * Enqueue a sync job. Returns immediately with job metadata.
 */
async function enqueueSync(integration, payload = {}, options = {}) {
  if (!env.SYNC_ENABLED) {
    return { ok: false, error: "Background sync is disabled" };
  }

  const cfg = getQueueConfig(integration);
  const queue = getQueue(integration);
  const correlationId = payload.correlationId || createCorrelationId(integration);

  const dedupeKey = options.dedupeKey || buildDedupeJobId(integration, payload.triggeredBy || "manual");
  const existing = await queue.getJob(dedupeKey);
  if (existing) {
    const state = await existing.getState();
    if (["waiting", "delayed", "active", "paused"].includes(state)) {
      return {
        ok: false,
        error: "Sync already queued or running",
        jobId: existing.id,
        state,
      };
    }
  }

  const dbJobId = await syncJobRepo.createSyncJob({
    integration,
    jobId: dedupeKey,
    correlationId,
    metadata: {
      triggeredBy: payload.triggeredBy || "manual",
      userId: payload.userId || null,
      ...payload.metadata,
    },
  });

  const job = await queue.add(
    cfg.defaultJobName,
    {
      ...payload,
      integration,
      correlationId,
      syncJobDbId: dbJobId,
    },
    {
      jobId: dedupeKey,
      ...options.bullOptions,
    }
  );

  syncLog.job({
    integration,
    jobId: job.id,
    event: "enqueued",
    correlationId,
    triggeredBy: payload.triggeredBy,
  });

  return {
    ok: true,
    jobId: job.id,
    syncJobDbId: dbJobId,
    correlationId,
    integration,
    status: "queued",
  };
}

async function retryFailedJob(integration, jobId) {
  const queue = getQueue(integration);
  const job = await queue.getJob(jobId);
  if (!job) {
    const dlq = dlqQueues.get(integration);
    const dlqJob = await dlq?.getJob(`dlq-${jobId}`);
    if (!dlqJob) return { ok: false, error: "Job not found" };
    return enqueueSync(integration, dlqJob.data, {
      dedupeKey: `${integration}-retry-${Date.now()}`,
    });
  }
  const state = await job.getState();
  if (state === "failed") {
    await job.retry();
    return { ok: true, jobId: job.id, status: "retrying" };
  }
  return { ok: false, error: `Job is ${state}, cannot retry` };
}

async function clearRepeatableJobs(integration) {
  const queue = getQueue(integration);
  const repeatable = await queue.getRepeatableJobs();
  for (const job of repeatable) {
    await queue.removeRepeatableByKey(job.key);
  }
  return repeatable.length;
}

async function clearAllRepeatableJobs() {
  const counts = await Promise.all(
    ALL_INTEGRATIONS.map(async (integration) => {
      const removed = await clearRepeatableJobs(integration);
      return { integration, removed };
    })
  );
  const total = counts.reduce((sum, row) => sum + row.removed, 0);
  if (total > 0) {
    syncLog.info("repeatable_jobs_cleared", { total, counts });
  }
  return { total, counts };
}

async function getQueueStats(integration) {
  const queue = getQueue(integration, { withEvents: false });
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { integration, waiting, active, completed, failed, delayed };
}

async function getAllQueueStats() {
  const stats = await Promise.all(ALL_INTEGRATIONS.map((i) => getQueueStats(i)));
  return stats;
}

async function closeQueues() {
  const closes = [];
  for (const q of queues.values()) closes.push(q.close());
  for (const q of dlqQueues.values()) closes.push(q.close());
  for (const e of queueEvents.values()) closes.push(e.close());
  queues.clear();
  dlqQueues.clear();
  queueEvents.clear();
  initialized = false;
  await Promise.all(closes);
}

function isQueueInitialized() {
  return initialized;
}

function markQueuesInitialized() {
  initialized = true;
}

module.exports = {
  getQueue,
  enqueueSync,
  retryFailedJob,
  clearRepeatableJobs,
  clearAllRepeatableJobs,
  getQueueStats,
  getAllQueueStats,
  closeQueues,
  isQueueInitialized,
  markQueuesInitialized,
  buildDedupeJobId,
};
