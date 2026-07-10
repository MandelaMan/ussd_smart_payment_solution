const { loadEnv } = require("../config/env");
const { createProgressReporter, ensureSyncJobRecord } = require("./base.worker");
const crmService = require("../services/external/crm.service");
const ispService = require("../services/external/isp.service");
const customerRepo = require("../repositories/customer.repository");
const integrationStateRepo = require("../repositories/integrationState.repository");
const syncJobRepo = require("../repositories/syncJob.repository");
const { INTEGRATIONS } = require("../queue/definitions");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { mapWithConcurrency } = require("../utils/mapWithConcurrency");

const env = loadEnv();
const INTEGRATION = INTEGRATIONS.CUSTOMER;

async function processCustomerSyncJob(job) {
  const started = Date.now();
  const { correlationId, incremental = true } = job.data;
  const syncJobDbId = await ensureSyncJobRecord(job, INTEGRATION);
  await syncJobRepo.markSyncJobRunning(syncJobDbId, job.id);

  emitSyncEvent("sync:started", {
    integration: INTEGRATION,
    correlationId,
    syncJobDbId,
    jobId: job.id,
  });

  const state = await integrationStateRepo.getIntegrationState(INTEGRATION);
  const updatedAfter =
    incremental && state?.last_synced_at ? state.last_synced_at : null;

  const total = await customerRepo.countActiveCustomers(updatedAfter);
  const pageSize = env.SYNC_PAGE_SIZE;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const reporter = createProgressReporter({
    integration: INTEGRATION,
    correlationId,
    syncJobDbId,
    total,
    onDbProgress: (counts) => syncJobRepo.updateSyncJobProgress(syncJobDbId, counts),
  });

  let created = 0;
  let updated = 0;
  let failed = 0;
  let processed = 0;

  for (let page = 1; page <= totalPages; page += 1) {
    const customers = await crmService.listCustomersForSync({
      page,
      pageSize,
      updatedAfter,
    });

    await mapWithConcurrency(customers, env.API_CONCURRENCY, async (customer) => {
      try {
        const result = await ispService.fetchCustomerStatus(
          customer.customerNumber,
          { correlationId }
        );
        if (result.ok && result.status) {
          await customerRepo.updateCustomerSubscriptionStatus(
            customer.id,
            result.status
          );
          updated += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      } finally {
        processed += 1;
        await reporter.report({
          processed,
          created,
          updated,
          failed,
          total,
          phase: `page ${page}/${totalPages}`,
        });
      }
    });

    await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
      syncCursor: { page, totalPages, processed },
    });
  }

  const now = new Date();
  await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
    lastSyncedAt: now,
    lastSuccessAt: now,
    lastError: null,
    syncCursor: null,
  });

  await syncJobRepo.completeSyncJob(syncJobDbId, {
    recordsProcessed: processed,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsFailed: failed,
    lastSyncedAt: now,
  });

  await invalidateDashboardCaches();

  const durationMs = Date.now() - started;
  const result = {
    ok: true,
    integration: INTEGRATION,
    processed,
    created,
    updated,
    failed,
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

module.exports = { processCustomerSyncJob, INTEGRATION };
