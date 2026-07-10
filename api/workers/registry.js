const { Worker } = require("bullmq");
const { workerOptions } = require("../queue/connection");
const { getQueueConfig, ALL_INTEGRATIONS } = require("../queue/definitions");
const { syncLog } = require("../lib/structuredLogger");
const { processCustomerSyncJob } = require("./customer.worker");
const { processInvoiceSyncJob } = require("./invoice.worker");
const { processPaymentSyncJob } = require("./payment.worker");
const { processReconciliationSyncJob } = require("./reconciliation.worker");
const { processProductsSyncJob } = require("./products.worker");
const { createZohoModuleProcessor } = require("./zohoModule.worker");
const syncJobRepo = require("../repositories/syncJob.repository");
const { emitSyncEvent } = require("../socket");
const { runWithZohoPriority } = require("../lib/zohoCallContext");

const HANDLERS = {
  customers: processCustomerSyncJob,
  "zoho-contacts": createZohoModuleProcessor("zoho-contacts"),
  invoices: processInvoiceSyncJob,
  "zoho-recurring": createZohoModuleProcessor("zoho-recurring"),
  "zoho-payments": createZohoModuleProcessor("zoho-payments"),
  payments: processPaymentSyncJob,
  "zoho-estimates": createZohoModuleProcessor("zoho-estimates"),
  "zoho-credit-notes": createZohoModuleProcessor("zoho-credit-notes"),
  reconciliation: processReconciliationSyncJob,
  products: processProductsSyncJob,
};

const workers = [];

function resolveZohoPriority(job) {
  const triggeredBy = job.data?.triggeredBy || "scheduled";
  if (triggeredBy === "manual" || triggeredBy === "boot") return "interactive";
  return "background";
}

function createWorker(integration) {
  const cfg = getQueueConfig(integration);
  const handler = HANDLERS[integration];
  if (!handler) throw new Error(`No handler for integration: ${integration}`);

  const worker = new Worker(
    cfg.name,
    async (job) =>
      runWithZohoPriority(resolveZohoPriority(job), () => handler(job)),
    workerOptions()
  );

  worker.on("completed", (job) => {
    syncLog.job({
      integration,
      jobId: job.id,
      event: "worker_completed",
      correlationId: job.data?.correlationId,
    });
  });

  worker.on("failed", async (job, err) => {
    syncLog.job({
      integration,
      jobId: job?.id,
      event: "worker_failed",
      correlationId: job?.data?.correlationId,
      error: err,
    });

    if (job?.data?.syncJobDbId) {
      const attemptsMade = job.attemptsMade || 0;
      const maxAttempts = job.opts?.attempts || 1;
      if (attemptsMade < maxAttempts) {
        await syncJobRepo.markSyncJobRetrying(job.data.syncJobDbId, err.message);
        emitSyncEvent("sync:retry", {
          integration,
          jobId: job.id,
          correlationId: job.data?.correlationId,
          attempt: attemptsMade,
          maxAttempts,
          error: err.message,
        });
      } else {
        await syncJobRepo.failSyncJob(job.data.syncJobDbId, err.message);
        emitSyncEvent("sync:failed", {
          integration,
          jobId: job.id,
          correlationId: job.data?.correlationId,
          error: err.message,
        });
      }
    }
  });

  workers.push(worker);
  syncLog.info("worker_started", { integration, queue: cfg.name });
  return worker;
}

function startAllWorkers() {
  for (const integration of ALL_INTEGRATIONS) {
    createWorker(integration);
  }
  return workers;
}

async function closeAllWorkers() {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
}

module.exports = {
  createWorker,
  startAllWorkers,
  closeAllWorkers,
  HANDLERS,
};
