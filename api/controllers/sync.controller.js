const syncJobRepo = require("../repositories/syncJob.repository");
const integrationStateRepo = require("../repositories/integrationState.repository");
const {
  enqueueSync,
  retryFailedJob,
  getAllQueueStats,
} = require("../queue/manager");
const { INTEGRATIONS, ALL_INTEGRATIONS } = require("../queue/definitions");
const { loadEnv } = require("../config/env");
const { pingRedis } = require("../config/redis");
const { SCHEDULES } = require("../queue/schedulers");
const { getZohoBudgetStatus } = require("../lib/zohoApiBudget");
const { getZohoApiUsageReport } = require("../lib/zohoApiUsage");
const { getZohoSyncPolicy } = require("../lib/zohoSyncPolicy");

const INTEGRATION_LABELS = {
  [INTEGRATIONS.CUSTOMER]: "Customers (TISP)",
  [INTEGRATIONS.ZOHO_CONTACTS]: "Contacts (Zoho)",
  [INTEGRATIONS.INVOICE]: "Invoices (Zoho)",
  [INTEGRATIONS.ZOHO_RECURRING]: "Recurring Invoices (Zoho)",
  [INTEGRATIONS.ZOHO_PAYMENTS]: "Payments (Zoho)",
  [INTEGRATIONS.PAYMENT]: "Unmatched M-Pesa",
  [INTEGRATIONS.ZOHO_ESTIMATES]: "Estimates (Zoho)",
  [INTEGRATIONS.ZOHO_CREDIT_NOTES]: "Credit Notes (Zoho)",
  [INTEGRATIONS.RECONCILIATION]: "Billing Reconciliation",
  [INTEGRATIONS.PRODUCTS]: "Products / Packages",
};

async function getOverview(_req, res, next) {
  try {
    const env = loadEnv();
    const [states, runningJobs, queueStats, redisOk, zohoBudget, apiUsage] = await Promise.all([
      integrationStateRepo.getAllIntegrationStates(),
      syncJobRepo.getRunningSyncJobs(),
      getAllQueueStats().catch(() => []),
      pingRedis(),
      getZohoBudgetStatus(),
      getZohoApiUsageReport().catch(() => null),
    ]);

    const stateMap = new Map(
      states.map((s) => [s.integration, integrationStateRepo.mapIntegrationStateRow(s)])
    );

    const integrations = ALL_INTEGRATIONS.map((integration) => {
      const schedule = SCHEDULES.find((s) => s.integration === integration);
      const latest = null;
      return {
        integration,
        label: INTEGRATION_LABELS[integration] || integration,
        intervalMs: schedule?.intervalMs || null,
        state: stateMap.get(integration) || null,
        queue: queueStats.find((q) => q.integration === integration) || null,
      };
    });

    res.json({
      syncEnabled: env.SYNC_ENABLED,
      redisConnected: redisOk,
      zohoBudget,
      apiUsage,
      zohoSyncPolicy: getZohoSyncPolicy(),
      integrations,
      runningJobs: runningJobs.map(syncJobRepo.mapSyncJobRow),
    });
  } catch (e) {
    next(e);
  }
}

async function listJobs(req, res, next) {
  try {
    const jobs = await syncJobRepo.listRecentSyncJobs({
      integration: req.query.integration || null,
      limit: Number(req.query.limit) || 50,
    });
    res.json({ data: jobs.map(syncJobRepo.mapSyncJobRow) });
  } catch (e) {
    next(e);
  }
}

async function getJob(req, res, next) {
  try {
    const job = await syncJobRepo.getSyncJobById(Number(req.params.id));
    if (!job) return res.status(404).json({ error: "Sync job not found" });
    res.json(syncJobRepo.mapSyncJobRow(job));
  } catch (e) {
    next(e);
  }
}

async function triggerSync(req, res, next) {
  try {
    const integration = req.params.integration;
    if (!ALL_INTEGRATIONS.includes(integration)) {
      return res.status(400).json({ error: "Unknown integration" });
    }

    const result = await enqueueSync(integration, {
      triggeredBy: "manual",
      userId: req.user?.id,
      fullZoho:
        integration === INTEGRATIONS.RECONCILIATION
          ? req.body?.fullZoho === true
          : false,
      browseOnly:
        integration === INTEGRATIONS.RECONCILIATION
          ? req.body?.fullZoho !== true
          : undefined,
      // Customers (TISP) always full-scans every active customer — TISP has no cursor.
      incremental:
        integration === INTEGRATIONS.CUSTOMER
          ? false
          : req.body?.incremental !== false,
      metadata: { userEmail: req.user?.email },
    });

    if (!result.ok) {
      return res.status(409).json(result);
    }

    res.status(202).json(result);
  } catch (e) {
    next(e);
  }
}

async function retryJob(req, res, next) {
  try {
    const integration = req.params.integration;
    const { jobId } = req.body || {};
    if (!jobId) return res.status(400).json({ error: "jobId is required" });

    const result = await retryFailedJob(integration, jobId);
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
  } catch (e) {
    next(e);
  }
}

async function getRunning(_req, res, next) {
  try {
    const jobs = await syncJobRepo.getRunningSyncJobs();
    res.json({ data: jobs.map(syncJobRepo.mapSyncJobRow) });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getOverview,
  listJobs,
  getJob,
  triggerSync,
  retryJob,
  getRunning,
};
