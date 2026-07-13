const { loadEnv } = require("../config/env");
const { INTEGRATIONS } = require("./definitions");
const { enqueueSync, getQueue, markQueuesInitialized, clearAllRepeatableJobs } = require("./manager");
const { syncLog } = require("../lib/structuredLogger");
const { getZohoSyncPolicy, isScheduledZohoModule } = require("../lib/zohoSyncPolicy");

const env = loadEnv();
const policy = getZohoSyncPolicy();

const ZOHO_SYNC_INTERVAL_MS = policy.syncIntervalMs;

const ALL_SCHEDULES = [
  {
    integration: INTEGRATIONS.CUSTOMER,
    jobId: "repeat-customers",
    intervalMs: env.CUSTOMER_SYNC_INTERVAL_MS,
    // Full TISP ClientStatus scan — no Zoho; TISP has no incremental cursor.
    payload: { triggeredBy: "scheduled", incremental: false },
    enabled: true,
  },
  {
    integration: INTEGRATIONS.ZOHO_CONTACTS,
    jobId: "repeat-zoho-contacts",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.ZOHO_CONTACTS),
  },
  {
    integration: INTEGRATIONS.INVOICE,
    jobId: "repeat-invoices",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.INVOICE),
  },
  {
    integration: INTEGRATIONS.ZOHO_RECURRING,
    jobId: "repeat-zoho-recurring",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.ZOHO_RECURRING),
  },
  {
    integration: INTEGRATIONS.ZOHO_PAYMENTS,
    jobId: "repeat-zoho-payments",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.ZOHO_PAYMENTS),
  },
  {
    integration: INTEGRATIONS.PAYMENT,
    jobId: "repeat-payments",
    intervalMs: env.PAYMENT_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: true,
  },
  {
    integration: INTEGRATIONS.ZOHO_ESTIMATES,
    jobId: "repeat-zoho-estimates",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.ZOHO_ESTIMATES),
  },
  {
    integration: INTEGRATIONS.ZOHO_CREDIT_NOTES,
    jobId: "repeat-zoho-credit-notes",
    intervalMs: ZOHO_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", incremental: true },
    enabled: policy.backgroundSyncEnabled && isScheduledZohoModule(INTEGRATIONS.ZOHO_CREDIT_NOTES),
  },
  {
    integration: INTEGRATIONS.RECONCILIATION,
    jobId: "repeat-reconciliation-quick",
    intervalMs: env.RECONCILIATION_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", fullZoho: false, browseOnly: true },
    enabled: true,
  },
  {
    integration: INTEGRATIONS.RECONCILIATION,
    jobId: "repeat-reconciliation-full",
    intervalMs: env.RECONCILIATION_FULL_ZOHO_INTERVAL_MS,
    payload: { triggeredBy: "scheduled", fullZoho: true, browseOnly: false },
    enabled: policy.fullReconciliationScheduled && policy.backgroundSyncEnabled,
  },
  {
    integration: INTEGRATIONS.PRODUCTS,
    jobId: "repeat-products",
    intervalMs: env.PRODUCTS_SYNC_INTERVAL_MS,
    payload: { triggeredBy: "scheduled" },
    enabled: true,
  },
];

const SCHEDULES = ALL_SCHEDULES.filter((s) => s.enabled);

async function registerRepeatableJobs() {
  if (!env.SYNC_ENABLED || !env.SYNC_SCHEDULER_ENABLED) {
    syncLog.info("sync_scheduler_disabled");
    return;
  }

  syncLog.info("sync_scheduler_policy", {
    mode: policy.mode,
    zohoModules: [...policy.scheduledModules],
    zohoIntervalMs: ZOHO_SYNC_INTERVAL_MS,
    fullReconciliationScheduled: policy.fullReconciliationScheduled,
  });

  // Remove stale repeatable jobs (e.g. recurring/payments left from before minimal mode).
  await clearAllRepeatableJobs();

  for (const schedule of SCHEDULES) {
    const queue = getQueue(schedule.integration);
    const jobId = schedule.jobId || `repeat-${schedule.integration}`;

    await queue.add(
      `scheduled-${schedule.integration}`,
      {
        ...schedule.payload,
        integration: schedule.integration,
      },
      {
        jobId,
        repeat: { every: schedule.intervalMs },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    syncLog.info("sync_schedule_registered", {
      integration: schedule.integration,
      jobId,
      intervalMs: schedule.intervalMs,
      fullZoho: schedule.payload.fullZoho,
    });
  }

  markQueuesInitialized();
}

async function triggerInitialSync() {
  if (!env.SYNC_ENABLED) return;

  // Boot: local-only jobs — never enqueue Zoho API work on startup.
  const quickJobs = [
    { integration: INTEGRATIONS.PAYMENT, payload: { triggeredBy: "boot", incremental: true } },
    {
      integration: INTEGRATIONS.RECONCILIATION,
      payload: { triggeredBy: "boot", fullZoho: false, browseOnly: true },
    },
  ];

  for (const job of quickJobs) {
    try {
      await enqueueSync(job.integration, job.payload, {
        dedupeKey: `${job.integration}-boot`,
      });
    } catch (err) {
      syncLog.warn("initial_sync_enqueue_failed", {
        integration: job.integration,
        error: err.message,
      });
    }
  }
}

module.exports = {
  registerRepeatableJobs,
  triggerInitialSync,
  SCHEDULES,
  ALL_SCHEDULES,
};
