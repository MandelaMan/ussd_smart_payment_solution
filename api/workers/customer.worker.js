const { loadEnv } = require("../config/env");
const { createProgressReporter, ensureSyncJobRecord } = require("./base.worker");
const crmService = require("../services/external/crm.service");
const ispService = require("../services/external/isp.service");
const customerRepo = require("../repositories/customer.repository");
const customerStore = require("../services/customerModuleStore");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const integrationStateRepo = require("../repositories/integrationState.repository");
const syncJobRepo = require("../repositories/syncJob.repository");
const { INTEGRATIONS } = require("../queue/definitions");
const { emitSyncEvent } = require("../socket");
const { syncLog } = require("../lib/structuredLogger");
const { invalidateDashboardCaches } = require("../lib/cache");
const { mapWithConcurrency } = require("../utils/mapWithConcurrency");
const {
  normalizeSubscriptionStatus,
} = require("../utils/subscriptionStatus");

const env = loadEnv();
const INTEGRATION = INTEGRATIONS.CUSTOMER;

function isTispNotFoundError(message) {
  const lower = String(message || "").toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("missing") ||
    lower.includes("does not exist") ||
    lower.includes("no client")
  );
}

/**
 * Customers (TISP) sync — calls TISP ClientStatus for every non-cancelled
 * customer. Never touches Zoho. Always full scan (TISP has no incremental cursor).
 */
async function processCustomerSyncJob(job) {
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

  // Always sync all active customers — TISP has no updated_after filter.
  const updatedAfter = null;
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
        const result = await ispService.fetchCustomerStatus(customer.customerNumber, {
          correlationId,
        });

        if (result.ok) {
          const rawStatus =
            result.raw?.status ??
            result.raw?.Status ??
            result.raw?.subscriptionStatus ??
            null;
          const normalized = rawStatus
            ? normalizeSubscriptionStatus(String(rawStatus))
            : "Active";

          await customerStore.updateCustomerSubscriptionStatus(
            customer.id,
            normalized
          );
          try {
            await integrationSnapshot.upsertTispSnapshot(customer.id, result.raw);
          } catch (e) {
            console.warn("TISP snapshot save failed:", e.message);
          }
          await customerStore.updateCustomerTispSync(customer.id, "synced", null);
          updated += 1;
        } else if (isTispNotFoundError(result.error)) {
          await customerStore.updateCustomerSubscriptionStatus(
            customer.id,
            "Not on TISP"
          );
          await customerStore.updateCustomerTispSync(
            customer.id,
            "failed",
            result.error || "Not found on TISP"
          );
          updated += 1;
        } else {
          await customerStore.updateCustomerTispSync(
            customer.id,
            "failed",
            result.error || "TISP lookup failed"
          );
          failed += 1;
        }
      } catch (err) {
        const message = err?.message || "TISP sync failed";
        try {
          if (isTispNotFoundError(message)) {
            await customerStore.updateCustomerSubscriptionStatus(
              customer.id,
              "Not on TISP"
            );
          }
          await customerStore.updateCustomerTispSync(customer.id, "failed", message);
        } catch {
          /* ignore persist errors */
        }
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
