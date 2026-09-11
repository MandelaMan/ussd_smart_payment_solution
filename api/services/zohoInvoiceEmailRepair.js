/**
 * Sweep Zoho contacts and attach email-enabled contact persons on
 * recurring profiles + open invoices. Runs during scheduled invoice
 * sync (prod and staging) so auto-send stops failing with
 * "no email address available".
 */

const zohoEntityRepo = require("../repositories/zohoEntity.repository");
const integrationStateRepo = require("../repositories/integrationState.repository");
const {
  getContactFull_JS,
  getRecurringInvoices_JS,
  getRecurringInvoice_JS,
  updateRecurringInvoice_JS,
  resolveInvoiceEmailContactPersons,
  associateEmailContactPersonsOnOpenInvoices,
} = require("../controllers/zoho.controller");
const {
  recurringNeedsEmailContactPersons,
} = require("../utils/zohoContactPersons");
const { canMakeZohoCall } = require("../lib/zohoApiBudget");
const { syncLog } = require("../lib/structuredLogger");

const INTEGRATION = "zoho-invoice-email-repair";
const DEFAULT_BATCH = Number(process.env.ZOHO_EMAIL_REPAIR_BATCH || 40);
const DEFAULT_MAX_MS = Number(process.env.ZOHO_EMAIL_REPAIR_MAX_MS || 90_000);

function parseCursor(state) {
  const raw = state?.sync_cursor;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function repairOneContact(contactId) {
  const contact = await getContactFull_JS(contactId);
  if (!contact?.contact_id) {
    return { skipped: true, reason: "contact_missing" };
  }

  const fields = await resolveInvoiceEmailContactPersons(contact.contact_id, {
    contact,
  });
  if (!fields) {
    return { skipped: true, reason: "no_email_persons" };
  }

  const listed = await getRecurringInvoices_JS({
    customer_id: contact.contact_id,
    per_page: 50,
  });
  let recurringUpdated = 0;
  let recurringChecked = 0;
  for (const row of listed || []) {
    const id = String(row.recurring_invoice_id || row.recurringinvoice_id || "");
    if (!id) continue;
    const full = (await getRecurringInvoice_JS(id)) || row;
    recurringChecked += 1;
    if (!recurringNeedsEmailContactPersons(full, fields)) continue;
    await updateRecurringInvoice_JS(id, fields);
    recurringUpdated += 1;
  }

  const invoices = await associateEmailContactPersonsOnOpenInvoices(
    contact.contact_id,
    { contact }
  );

  return {
    skipped: false,
    recurringChecked,
    recurringUpdated,
    invoicesUpdated: Number(invoices?.updated || 0),
  };
}

/**
 * Continue a batched repair of every local Zoho contact.
 * Safe on staging and production — no environment gate.
 */
async function repairZohoInvoiceEmailAssociations(options = {}) {
  const batchSize = Math.max(
    1,
    Math.min(Number(options.limit || DEFAULT_BATCH), 200)
  );
  const maxMs = Math.max(5_000, Number(options.maxMs || DEFAULT_MAX_MS));
  const started = Date.now();
  const state = await integrationStateRepo.getIntegrationState(INTEGRATION);
  const cursor = parseCursor(state);
  let afterId = String(options.afterId || cursor.afterId || "");

  await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
    status: "running",
    lastAttemptAt: new Date(),
    syncCursor: { ...cursor, afterId, startedAt: new Date().toISOString() },
  });

  let processed = 0;
  let repaired = Number(cursor.repaired || 0);
  let skipped = Number(cursor.skipped || 0);
  let failed = Number(cursor.failed || 0);
  let recurringUpdated = Number(cursor.recurringUpdated || 0);
  let invoicesUpdated = Number(cursor.invoicesUpdated || 0);
  let pausedForBudget = false;
  let wrapped = false;

  while (Date.now() - started < maxMs) {
    if (!(await canMakeZohoCall("background", 4))) {
      pausedForBudget = true;
      break;
    }

    const ids = await zohoEntityRepo.listZohoContactIdsForEmailRepair({
      afterId,
      limit: Math.min(10, batchSize - processed),
    });
    if (!ids.length) {
      if (afterId) {
        wrapped = true;
        afterId = "";
      }
      break;
    }

    for (const contactId of ids) {
      if (processed >= batchSize || Date.now() - started >= maxMs) break;
      if (!(await canMakeZohoCall("background", 4))) {
        pausedForBudget = true;
        break;
      }
      try {
        const result = await repairOneContact(contactId);
        processed += 1;
        afterId = contactId;
        if (result.skipped) skipped += 1;
        else {
          repaired += 1;
          recurringUpdated += Number(result.recurringUpdated || 0);
          invoicesUpdated += Number(result.invoicesUpdated || 0);
        }
      } catch (err) {
        processed += 1;
        failed += 1;
        afterId = contactId;
        syncLog.warn("zoho_invoice_email_repair_failed", {
          contactId,
          error: err.message || String(err),
        });
      }
    }

    if (pausedForBudget || processed >= batchSize) break;
  }

  const now = new Date();
  const nextCursor = {
    afterId,
    repaired,
    skipped,
    failed,
    recurringUpdated,
    invoicesUpdated,
    lastPassAt: wrapped && !afterId ? now.toISOString() : cursor.lastPassAt || null,
    pausedForBudget,
  };

  await integrationStateRepo.upsertIntegrationState(INTEGRATION, {
    status: pausedForBudget ? "paused" : "success",
    lastSyncedAt: now,
    lastSuccessAt: pausedForBudget ? state?.last_success_at || null : now,
    lastAttemptAt: now,
    lastError: pausedForBudget
      ? "Paused — Zoho daily API budget reserved for interactive use"
      : failed > 0
        ? `${failed} contact(s) failed invoice-email repair`
        : null,
    recordsUpdated: recurringUpdated + invoicesUpdated,
    syncCursor: nextCursor,
  });

  const result = {
    ok: true,
    integration: INTEGRATION,
    processed,
    repaired,
    skipped,
    failed,
    recurringUpdated,
    invoicesUpdated,
    pausedForBudget,
    wrapped,
    afterId,
    durationMs: Date.now() - started,
  };
  syncLog.job({
    integration: INTEGRATION,
    event: "zoho_invoice_email_repair",
    ...result,
  });
  return result;
}

module.exports = {
  INTEGRATION,
  repairOneContact,
  repairZohoInvoiceEmailAssociations,
};
