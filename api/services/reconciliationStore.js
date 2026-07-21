const { query } = require("../config/db");
const customerStore = require("./customerModuleStore");
const { logActivity } = require("./activityLogStore");
const { mapWithConcurrency } = require("../utils/mapWithConcurrency");
const {
  computeCustomerReconciliation,
  aggregateSummary,
  buildIssueTiles,
  recordToIssuePreview,
  roundMoney,
} = require("../utils/reconciliationEngine");
const {
  isB2BCustomer,
  getZohoContactLookupKeys,
  resolveAgencyForCustomer,
  filterAgencyInvoicesForCustomer,
  b2bBillingMeta,
} = require("../utils/b2bBilling");
const {
  findContactByLookupKeys_JS,
  getInvoices_JS,
  getCustomerPayments_JS,
  getRecurringInvoices_JS,
  resumeRecurringInvoice_JS,
  markInvoiceAsPaid_JS,
} = require("../controllers/zoho.controller");
const { getTISPCustomer } = require("../controllers/tisp.controller");
const { processUnallocatedMpesaPayment, applyZohoPaymentForMpesa, logZohoMpesaPaymentResult } = require("../controllers/mpesa.controller");
const { normalizeSubscriptionStatus } = require("../utils/subscriptionStatus");
const integrationSnapshot = require("../repositories/integrationSnapshot.repository");
const { mayCallZohoForCustomer } = require("../lib/zohoSyncPolicy");

const SYNC_INTERVAL_MS = Number(process.env.RECONCILIATION_SYNC_INTERVAL_MS || 5 * 60 * 1000);
const ZOHO_CONCURRENCY = Number(process.env.RECONCILIATION_ZOHO_CONCURRENCY || 3);
/** Max customers loaded on billing gaps browse (no search) — saves Zoho API budget. */
const BROWSE_BATCH = Number(
  process.env.RECONCILIATION_BROWSE_BATCH ||
    process.env.RECONCILIATION_INITIAL_BATCH ||
    10
);
/** During a full manual sync, mark partial results ready after this many customers. */
const PARTIAL_READY_BATCH = Number(process.env.RECONCILIATION_PARTIAL_READY_BATCH || 20);

/** @type {{ at: number | null, lastFullZohoAt: number | null, records: Map<number, object>, unmatchedMpesa: object[], sync: object }} */
const snapshot = {
  at: null,
  lastFullZohoAt: null,
  records: new Map(),
  unmatchedMpesa: [],
  sync: {
    status: "idle",
    lastCompletedAt: null,
    lastError: null,
    runId: null,
    progress: {
      phase: "idle",
      processed: 0,
      total: 0,
      issuesFound: 0,
      partialReady: false,
    },
  },
};

let scheduledTimer = null;
let syncInProgress = false;
let activeSyncPromise = null;
let schemaReady = false;
let dbHydratePromise = null;

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function ensureReconciliationSchema() {
  if (schemaReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS reconciliation_sync_runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'running',
        triggered_by VARCHAR(64) NULL,
        user_id INT UNSIGNED NULL,
        customers_scanned INT UNSIGNED NOT NULL DEFAULT 0,
        issues_found INT UNSIGNED NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        metadata JSON NULL,
        INDEX idx_reconciliation_sync_started (started_at DESC)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS reconciliation_actions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        customer_id INT UNSIGNED NULL,
        customer_number VARCHAR(64) NULL,
        action_type VARCHAR(64) NOT NULL,
        previous_value TEXT NULL,
        new_value TEXT NULL,
        reason TEXT NULL,
        user_id INT UNSIGNED NULL,
        user_email VARCHAR(255) NULL,
        metadata JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_reconciliation_actions_customer (customer_id),
        INDEX idx_reconciliation_actions_created (created_at DESC)
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS billing_insights_cache (
        id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
        summary_json JSON NOT NULL,
        sync_status VARCHAR(32) NOT NULL DEFAULT 'idle',
        sync_progress_json JSON NULL,
        last_sync_at DATETIME NULL,
        last_full_zoho_at DATETIME NULL,
        is_partial TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS reconciliation_customer_cache (
        customer_id INT UNSIGNED NOT NULL PRIMARY KEY,
        customer_number VARCHAR(64) NOT NULL,
        primary_status VARCHAR(64) NOT NULL,
        statuses_json JSON NOT NULL,
        record_json JSON NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_reconciliation_customer_cache_status (primary_status),
        INDEX idx_reconciliation_customer_cache_number (customer_number)
      )
    `);
    schemaReady = true;
  } catch (e) {
    console.warn("[reconciliation] schema ensure skipped:", e.message);
  }
}

async function waitForSyncInProgress() {
  if (activeSyncPromise) {
    await activeSyncPromise.catch(() => {});
  }
}

function waitForPartialReady(timeoutMs = 45000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (snapshot.sync.progress?.partialReady) return resolve(true);
      if (snapshot.sync.status !== "running") return resolve(false);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}

function buildSyncMeta() {
  const records = Array.from(snapshot.records.values());
  const progress = snapshot.sync.progress || {
    phase: "idle",
    processed: 0,
    total: 0,
    issuesFound: 0,
    partialReady: false,
  };

  return {
    status: snapshot.sync.status,
    lastSyncAt:
      snapshot.sync.lastCompletedAt ||
      (snapshot.at ? new Date(snapshot.at).toISOString() : null),
    lastError: snapshot.sync.lastError,
    customerCount: records.length,
    issueCustomerCount: records.filter(
      (r) => r.primaryStatus !== "current" && r.primaryStatus !== "paid"
    ).length,
    fullZohoReady: Boolean(snapshot.lastFullZohoAt) && !isFullZohoStale(),
    progress: {
      phase: progress.phase,
      processed: progress.processed,
      total: progress.total,
      issuesFound: progress.issuesFound,
      partialReady: Boolean(progress.partialReady),
    },
  };
}

function summaryForPersistence() {
  const payload = buildSummaryPayload();
  const { issueTiles, ...summary } = payload;
  return summary;
}

function mergeLiveSyncStatus(summary) {
  if (!summary || typeof summary !== "object") return summary;
  if (snapshot.sync.status === "running") {
    summary.sync = { ...(summary.sync || {}), ...buildSyncMeta() };
  }
  return summary;
}

async function loadInsightsFromDb() {
  await ensureReconciliationSchema();
  try {
    const rows = await query(`SELECT * FROM billing_insights_cache WHERE id = 1 LIMIT 1`);
    const row = rows[0];
    if (!row?.summary_json) return null;

    const summary = parseJson(row.summary_json);
    if (!summary) return null;

    if (row.last_sync_at) {
      snapshot.sync.lastCompletedAt = new Date(row.last_sync_at).toISOString();
    }
    if (row.last_full_zoho_at) {
      snapshot.lastFullZohoAt = new Date(row.last_full_zoho_at).getTime();
    }
    if (row.updated_at) {
      snapshot.at = new Date(row.updated_at).getTime();
    }
    snapshot.sync.progress = parseJson(row.sync_progress_json, snapshot.sync.progress);
    if (snapshot.sync.status !== "running") {
      snapshot.sync.status = row.sync_status || snapshot.sync.status;
    }

    summary.fromCache = true;
    summary.cacheUpdatedAt = row.updated_at
      ? new Date(row.updated_at).toISOString()
      : null;
    summary.cachePartial = Boolean(row.is_partial);
    return mergeLiveSyncStatus(summary);
  } catch (e) {
    console.warn("[reconciliation] load insights cache skipped:", e.message);
    return null;
  }
}

async function persistInsightsCache({ partial = false } = {}) {
  await ensureReconciliationSchema();
  try {
    const summary = summaryForPersistence();
    const syncMeta = buildSyncMeta();
    await query(
      `INSERT INTO billing_insights_cache
        (id, summary_json, sync_status, sync_progress_json, last_sync_at, last_full_zoho_at, is_partial)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        summary_json = VALUES(summary_json),
        sync_status = VALUES(sync_status),
        sync_progress_json = VALUES(sync_progress_json),
        last_sync_at = VALUES(last_sync_at),
        last_full_zoho_at = VALUES(last_full_zoho_at),
        is_partial = VALUES(is_partial),
        updated_at = CURRENT_TIMESTAMP`,
      [
        JSON.stringify(summary),
        syncMeta.status,
        JSON.stringify(syncMeta.progress || null),
        syncMeta.lastSyncAt ? new Date(syncMeta.lastSyncAt) : null,
        snapshot.lastFullZohoAt ? new Date(snapshot.lastFullZohoAt) : null,
        partial ? 1 : 0,
      ]
    );
  } catch (e) {
    console.warn("[reconciliation] persist insights cache skipped:", e.message);
  }
}

async function upsertCustomerCacheRecord(record) {
  if (!record?.customerId) return;
  await query(
    `INSERT INTO reconciliation_customer_cache
      (customer_id, customer_number, primary_status, statuses_json, record_json)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      customer_number = VALUES(customer_number),
      primary_status = VALUES(primary_status),
      statuses_json = VALUES(statuses_json),
      record_json = VALUES(record_json),
      updated_at = CURRENT_TIMESTAMP`,
    [
      record.customerId,
      record.customerNumber,
      record.primaryStatus || "unknown",
      JSON.stringify(record.statuses || []),
      JSON.stringify(record),
    ]
  );
}

async function clearCustomerCache() {
  await ensureReconciliationSchema();
  try {
    await query(`DELETE FROM reconciliation_customer_cache`);
  } catch (e) {
    console.warn("[reconciliation] clear customer cache skipped:", e.message);
  }
}

async function hydrateSnapshotFromCustomerCache() {
  await ensureReconciliationSchema();
  try {
    const rows = await query(
      `SELECT record_json FROM reconciliation_customer_cache ORDER BY customer_id ASC`
    );
    if (!rows.length) return false;

    snapshot.records = new Map();
    for (const row of rows) {
      const record = parseJson(row.record_json);
      if (record?.customerId) {
        snapshot.records.set(record.customerId, record);
      }
    }
    return snapshot.records.size > 0;
  } catch (e) {
    console.warn("[reconciliation] hydrate customer cache skipped:", e.message);
    return false;
  }
}

async function ensureDbHydrated() {
  if (snapshot.records.size > 0) return;
  if (!dbHydratePromise) {
    dbHydratePromise = (async () => {
      await loadInsightsFromDb();
      await hydrateSnapshotFromCustomerCache();
    })().finally(() => {
      dbHydratePromise = null;
    });
  }
  await dbHydratePromise;
}

async function syncCustomersIncremental(
  customers,
  { fullZoho, onProgress, maxCustomers, replaceCache = true } = {}
) {
  const toProcess = maxCustomers ? customers.slice(0, maxCustomers) : customers;
  const total = toProcess.length;

  if (replaceCache) {
    await clearCustomerCache();
    snapshot.records = new Map();
  }

  snapshot.sync.progress = {
    phase: fullZoho ? "zoho" : "quick",
    processed: 0,
    total,
    issuesFound: 0,
    partialReady: false,
  };

  const processCustomer = async (customer) => {
    const record = await buildCustomerRecord(customer, {
      skipZoho: !fullZoho,
      allowZohoApi: fullZoho,
      fetchTisp: fullZoho,
    });
    snapshot.records.set(record.customerId, record);
    snapshot.sync.progress.processed += 1;
    if (record.primaryStatus !== "current" && record.primaryStatus !== "paid") {
      snapshot.sync.progress.issuesFound += 1;
    }
    try {
      await upsertCustomerCacheRecord(record);
    } catch (e) {
      console.warn("[reconciliation] customer cache upsert skipped:", e.message);
    }
    if (onProgress) {
      await onProgress({ ...snapshot.sync.progress });
    }
    return record;
  };

  const concurrency = fullZoho ? ZOHO_CONCURRENCY : 8;

  if (!maxCustomers && toProcess.length > PARTIAL_READY_BATCH) {
    const priority = toProcess.slice(0, PARTIAL_READY_BATCH);
    const rest = toProcess.slice(PARTIAL_READY_BATCH);
    if (priority.length) {
      await mapWithConcurrency(priority, concurrency, processCustomer);
      snapshot.sync.progress.partialReady = true;
      snapshot.at = Date.now();
      await persistInsightsCache({ partial: true });
    }
    if (rest.length) {
      await mapWithConcurrency(rest, concurrency, processCustomer);
    }
  } else {
    await mapWithConcurrency(toProcess, concurrency, processCustomer);
    if (toProcess.length > 0) {
      snapshot.sync.progress.partialReady = true;
    }
  }

  snapshot.at = Date.now();
  return Array.from(snapshot.records.values());
}

async function ensureSnapshotLoaded({ fullZoho = false } = {}) {
  await waitForSyncInProgress();
  const empty = snapshot.records.size === 0;
  const stale = ensureSnapshotFresh();
  const needsFullZoho = fullZoho && (empty || stale || !snapshot.lastFullZohoAt);
  const needsQuickSync = !fullZoho && (empty || stale);
  if ((needsFullZoho || needsQuickSync) && snapshot.sync.status !== "running") {
    await runSync({
      triggeredBy: "scheduled",
      fullZoho: needsFullZoho,
    });
  }
  await waitForSyncInProgress();
}

async function findZohoContact(customer) {
  return findContactByLookupKeys_JS(getZohoContactLookupKeys(customer), {
    customer,
  });
}

function mapInvoice(inv) {
  return {
    id: String(inv.invoice_id),
    invoiceNumber: inv.invoice_number || null,
    date: inv.date || null,
    dueDate: inv.due_date || null,
    status: inv.status || "unknown",
    total: inv.total != null ? Number(inv.total) : null,
    balanceDue: inv.balance != null ? Number(inv.balance) : null,
  };
}

function mapRecurring(inv) {
  return {
    id: String(inv.recurring_invoice_id || inv.recurringinvoice_id || inv.id),
    status: inv.recurrence_status || inv.status || "unknown",
    nextInvoiceDate: inv.next_invoice_date || null,
    lastSentDate: inv.last_sent_date || null,
  };
}

async function loadMpesaForCustomer(customerNumber) {
  const rows = await query(
    `SELECT id, amount, mpesa_receipt, phone, channel, status, created_at, transaction_date, account_reference
     FROM payment_transactions
     WHERE status = 'SUCCESS'
       AND (account_reference = ? OR account_reference LIKE ?)
     ORDER BY COALESCE(transaction_date, created_at) DESC
     LIMIT 50`,
    [customerNumber, `%${customerNumber}%`]
  );
  return rows;
}

async function loadZohoPaidRefs(customerNumber) {
  const rows = await query(
    `SELECT reference_id, raw_payload
     FROM integration_events
     WHERE source = 'zoho' AND status = 'paid'
       AND (customer_no = ? OR customer_no LIKE ?)
     ORDER BY created_at DESC
     LIMIT 100`,
    [customerNumber, `%${customerNumber}%`]
  );
  const refs = new Set();
  for (const row of rows) {
    if (row.reference_id) refs.add(String(row.reference_id).trim().toLowerCase());
    try {
      const payload = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;
      const txId = payload?.meta?.transactionId || payload?.result?.reference_number;
      if (txId) refs.add(String(txId).trim().toLowerCase());
    } catch {
      // ignore parse errors
    }
  }
  return refs;
}

async function buildCustomerRecord(customer, options = {}) {
  const skipZohoApi = options.skipZoho === true;
  const refreshZoho = options.refreshZoho === true;
  let zohoError = null;
  let tispError = null;
  let invoices = [];
  let zohoPayments = [];
  let recurringInvoices = [];
  let outstandingBalance = 0;
  let creditBalance = 0;
  let zohoContactId = null;
  let loadedZohoFromDb = false;

  const mpesaRows = await loadMpesaForCustomer(customer.customerNumber);
  const zohoPaidRefs = await loadZohoPaidRefs(customer.customerNumber);

  const mpesaPayments = mpesaRows.map((row) => {
    const receipt = row.mpesa_receipt || null;
    const matchedToZoho =
      receipt && zohoPaidRefs.has(String(receipt).trim().toLowerCase());
    return {
      id: row.id,
      source: "mpesa",
      amount: row.amount != null ? Number(row.amount) : null,
      referenceId: receipt,
      phone: row.phone || null,
      channel: row.channel || null,
      status: row.status,
      paidAt: row.transaction_date || row.created_at,
      matchedToZoho: Boolean(matchedToZoho),
    };
  });

  let storedSnapshot = null;
  if (!refreshZoho) {
    try {
      storedSnapshot = await integrationSnapshot.loadCustomerBillingSnapshot(customer.id);
      if (storedSnapshot.hasData) {
        loadedZohoFromDb = true;
        zohoContactId = storedSnapshot.zohoContactId;
        creditBalance = roundMoney(storedSnapshot.creditBalance || 0);
        invoices = storedSnapshot.invoices || [];
        zohoPayments = storedSnapshot.zohoPayments || [];
        recurringInvoices = storedSnapshot.recurringInvoices || [];
        outstandingBalance = invoices.reduce(
          (sum, inv) => sum + roundMoney(inv.balanceDue ?? 0),
          0
        );
        if (isB2BCustomer(customer)) {
          invoices = filterAgencyInvoicesForCustomer(invoices, customer.customerNumber);
          recurringInvoices = [];
          outstandingBalance = invoices.reduce(
            (sum, inv) => sum + roundMoney(inv.balanceDue ?? 0),
            0
          );
        }
      }
    } catch (e) {
      console.warn("[reconciliation] snapshot load skipped:", e.message);
    }
  }

  if (!loadedZohoFromDb && mayCallZohoForCustomer(options)) {
    try {
      const contact = await findZohoContact(customer);
      if (contact?.contact_id) {
        zohoContactId = contact.contact_id;
        creditBalance = roundMoney(
          contact.outstanding_receivable_amount < 0
            ? Math.abs(contact.outstanding_receivable_amount)
            : 0
        );

        const [rawInvoices, rawPayments, rawRecurring] = await Promise.all([
          getInvoices_JS({ customer_id: zohoContactId, per_page: 50 }),
          getCustomerPayments_JS({ customer_id: zohoContactId, per_page: 50 }),
          getRecurringInvoices_JS({ customer_id: zohoContactId, per_page: 20 }),
        ]);

        invoices = (rawInvoices || []).map(mapInvoice);
        outstandingBalance = invoices.reduce(
          (sum, inv) => sum + roundMoney(inv.balanceDue ?? 0),
          0
        );

        zohoPayments = (rawPayments || []).map((p) => ({
          id: String(p.payment_id),
          source: "zoho",
          amount: p.amount != null ? Number(p.amount) : null,
          referenceId: p.reference_number || p.payment_number || String(p.payment_id),
          paidAt: p.date || p.payment_date || p.created_time,
          invoiceNumber: Array.isArray(p.invoices)
            ? p.invoices[0]?.invoice_number || null
            : null,
        }));

        recurringInvoices = (rawRecurring || []).map(mapRecurring);

        if (isB2BCustomer(customer)) {
          invoices = filterAgencyInvoicesForCustomer(invoices, customer.customerNumber);
          recurringInvoices = [];
          outstandingBalance = invoices.reduce(
            (sum, inv) => sum + roundMoney(inv.balanceDue ?? 0),
            0
          );
        }

        try {
          await integrationSnapshot.saveZohoBillingSnapshot(customer.id, {
            contact,
            invoices: rawInvoices || [],
            payments: rawPayments || [],
            recurring: rawRecurring || [],
          });
        } catch (e) {
          console.warn("[reconciliation] snapshot save skipped:", e.message);
        }
      }
    } catch (e) {
      zohoError = e.message || "Zoho sync failed";
    }
  }

    let subscriptionStatus = customer.subscriptionStatus || "Not on TISP";
  let tispDueDate = null;

  if (storedSnapshot?.tisp?.subscriptionStatus && options.refreshTisp !== true) {
    subscriptionStatus = normalizeSubscriptionStatus(storedSnapshot.tisp.subscriptionStatus);
    tispDueDate = storedSnapshot.tisp.dueDate ?? null;
  }

  const shouldFetchTisp =
    options.refreshTisp === true ||
    options.fetchTisp === true ||
    (normalizeSubscriptionStatus(subscriptionStatus) === "Suspended" &&
      !storedSnapshot?.tisp?.fresh);

  if (shouldFetchTisp) {
    try {
      const tisp = await getTISPCustomer(customer.customerNumber);
      const status = tisp?.status ?? tisp?.Status ?? tisp?.subscriptionStatus ?? null;
      if (status) subscriptionStatus = normalizeSubscriptionStatus(String(status));
      tispDueDate = integrationSnapshot.extractTispDueDate(tisp) || tispDueDate;
      try {
        await integrationSnapshot.upsertTispSnapshot(customer.id, tisp);
      } catch (e) {
        console.warn("[reconciliation] TISP snapshot save skipped:", e.message);
      }
    } catch (e) {
      tispError = e.message || "TISP sync failed";
    }
  } else if (!tispDueDate && storedSnapshot?.tisp?.dueDate) {
    tispDueDate = storedSnapshot.tisp.dueDate;
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const mpesaPaymentsThisMonth = mpesaPayments.filter((p) => {
    const d = new Date(p.paidAt || 0);
    return d >= monthStart;
  });

  const reconciliation = computeCustomerReconciliation({
    customer: {
      ...customer,
      subscriptionStatus,
    },
    invoices,
    mpesaPayments,
    zohoPayments,
    recurringInvoices,
    monthlyPrice: customer.monthlyPrice,
    outstandingBalance,
    creditBalance,
    zohoError,
    tispError,
    billedViaAgency: isB2BCustomer(customer),
    agencyName: customer.agencyName || null,
    zohoLinked: Boolean(zohoContactId) && !zohoError,
    accountStatus: customer.status || null,
    tispSyncStatus: customer.tispSyncStatus || null,
    tispDueDate,
  });

  const b2bMeta = isB2BCustomer(customer)
    ? b2bBillingMeta(customer, customer.agencyId ? { id: customer.agencyId, name: customer.agencyName } : null)
    : {};

  return {
    customerId: customer.id,
    customerNumber: customer.customerNumber,
    customerName: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.customerNumber,
    buildingId: customer.buildingId || null,
    buildingName: customer.buildingName || null,
    productName: customer.productName || null,
    customerType: customer.customerType || "C2B",
    customerStatus: customer.status || null,
    zohoContactId,
    zohoError,
    tispError,
    ...b2bMeta,
    ...reconciliation,
    invoices,
    mpesaPayments,
    zohoPayments,
    recurringInvoices,
    mpesaPaymentsThisMonth,
    syncedAt: new Date().toISOString(),
  };
}

async function loadAllCustomersForReconciliation() {
  /** Dashboard customers are the source of truth — each is looked up on Zoho Books, never imported from Zoho. */
  const batchSize = 500;
  let page = 1;
  const all = [];
  for (;;) {
    const result = await customerStore.listCustomers({
      page,
      limit: batchSize,
    });
    all.push(...result.data);
    if (page >= result.pagination.pages) break;
    page += 1;
  }
  return all;
}

async function loadQuickRecords() {
  const customers = await loadAllCustomersForReconciliation();
  return mapWithConcurrency(customers, 8, async (customer) =>
    buildCustomerRecord(customer, { skipZoho: true })
  );
}

async function enrichWithZoho(records) {
  const customers = records.map((r) => r.customerId);
  const customerMap = new Map();
  for (const id of customers) {
    const c = await customerStore.getCustomerById(id);
    if (c) customerMap.set(id, c);
  }

  return mapWithConcurrency(Array.from(customerMap.values()), ZOHO_CONCURRENCY, async (customer) =>
    buildCustomerRecord(customer, { skipZoho: true, allowZohoApi: true, fetchTisp: true })
  );
}

async function loadUnmatchedMpesa() {
  const rows = await query(
    `SELECT pt.id, pt.amount, pt.mpesa_receipt, pt.phone, pt.account_reference,
            pt.channel, pt.status, pt.created_at, pt.transaction_date
     FROM payment_transactions pt
     WHERE pt.status = 'SUCCESS'
       AND NOT EXISTS (
         SELECT 1 FROM integration_events ie
         WHERE ie.source = 'zoho' AND ie.status = 'paid'
           AND (
             ie.reference_id = pt.mpesa_receipt
             OR JSON_UNQUOTE(JSON_EXTRACT(ie.raw_payload, '$.meta.transactionId')) = pt.mpesa_receipt
           )
       )
     ORDER BY COALESCE(pt.transaction_date, pt.created_at) DESC
     LIMIT 200`
  );

  const mapped = [];
  for (const row of rows) {
    const accountRef = row.account_reference || null;
    let customer = null;
    if (accountRef) {
      try {
        customer = await customerStore.findCustomerByNumber(accountRef);
      } catch {
        customer = null;
      }
    }
    mapped.push({
      id: row.id,
      amount: row.amount != null ? Number(row.amount) : null,
      referenceId: row.mpesa_receipt || null,
      phone: row.phone || null,
      accountReference: accountRef,
      channel: row.channel || null,
      paidAt: row.transaction_date || row.created_at,
      suggestedCustomerNumber: accountRef,
      customerId: customer?.id ?? null,
      customerName: customer
        ? [customer.firstName, customer.lastName].filter(Boolean).join(" ") || customer.customerNumber
        : null,
    });
  }
  return mapped;
}

async function loadMpesaPaymentRow(paymentId) {
  const rows = await query(
    `SELECT * FROM payment_transactions WHERE id = ? AND status = 'SUCCESS' LIMIT 1`,
    [paymentId]
  );
  return rows[0] || null;
}

async function isMpesaPaymentAllocated(receipt) {
  if (!receipt) return false;
  const rows = await query(
    `SELECT 1 FROM integration_events
     WHERE source = 'zoho' AND status = 'paid'
       AND (
         reference_id = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.meta.transactionId')) = ?
       )
     LIMIT 1`,
    [receipt, receipt]
  );
  return rows.length > 0;
}

async function getUnmatchedMpesaDetail(paymentId) {
  const row = await loadMpesaPaymentRow(paymentId);
  if (!row) return null;

  const payment = {
    id: row.id,
    amount: row.amount != null ? Number(row.amount) : null,
    referenceId: row.mpesa_receipt || null,
    phone: row.phone || null,
    accountReference: row.account_reference || null,
    channel: row.channel || null,
    paidAt: row.transaction_date || row.created_at,
  };

  const accountRef = row.account_reference || null;
  let customer = null;
  let openInvoices = [];
  let zohoLinked = false;
  let plannedAction = "Unable to determine — missing account reference";
  let canAllocate = false;

  if (accountRef) {
    customer = await customerStore.findCustomerByNumber(accountRef);
    if (!customer) {
      plannedAction = "Customer not found in dashboard — verify account reference";
    } else {
      const contact = await findZohoContact(customer);
      if (!contact?.contact_id) {
        plannedAction = "Link customer to Zoho Books before allocating payment";
      } else {
        zohoLinked = true;
        const rawInvoices = await getInvoices_JS({
          customer_id: contact.contact_id,
          per_page: 30,
        });
        openInvoices = (rawInvoices || []).map(mapInvoice).filter((inv) => roundMoney(inv.balanceDue ?? 0) > 0);

        if (isB2BCustomer(customer)) {
          openInvoices = filterAgencyInvoicesForCustomer(openInvoices, customer.customerNumber);
        }

        if (openInvoices.length) {
          const target = openInvoices.find(
            (inv) =>
              String(inv.invoiceNumber || "").toUpperCase().includes(String(accountRef).toUpperCase()) ||
              roundMoney(inv.balanceDue) === roundMoney(row.amount)
          );
          const pick = target || openInvoices[0];
          plannedAction = target
            ? `Mark invoice ${pick.invoiceNumber || pick.id} as paid (${formatKes(pick.balanceDue)} due)`
            : `Review ${openInvoices.length} open invoice(s) — best match: ${pick.invoiceNumber || pick.id}`;
        } else if (isB2BCustomer(customer)) {
          plannedAction =
            "No agency invoice open — create agency invoice for payment amount and mark paid in Zoho";
        } else {
          plannedAction = "No open invoice — create invoice for payment amount and mark paid in Zoho";
        }
        canAllocate = true;
      }
    }
  }

  const alreadyAllocated = await isMpesaPaymentAllocated(row.mpesa_receipt);
  if (alreadyAllocated) {
    canAllocate = false;
    plannedAction = "Already allocated in Zoho";
  }

  return {
    payment,
    customer: customer
      ? {
          id: customer.id,
          customerNumber: customer.customerNumber,
          customerName:
            [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
            customer.customerNumber,
          customerType: customer.customerType || "C2B",
          subscriptionStatus: customer.subscriptionStatus || null,
        }
      : null,
    openInvoices,
    zohoLinked,
    plannedAction,
    canAllocate,
    alreadyAllocated,
  };
}

function formatKes(amount) {
  const n = roundMoney(amount);
  return `KES ${n.toLocaleString("en-KE")}`;
}

async function allocateUnmatchedMpesa(paymentId, user) {
  const row = await loadMpesaPaymentRow(paymentId);
  if (!row) {
    const err = new Error("M-Pesa payment not found");
    err.status = 404;
    throw err;
  }

  if (await isMpesaPaymentAllocated(row.mpesa_receipt)) {
    throw new Error("Payment is already allocated in Zoho");
  }

  const result = await processUnallocatedMpesaPayment(row, {
    source: "reconciliation",
    userId: user?.id,
  });

  if (!result.ok) {
    throw new Error(result.message || "Allocation failed");
  }

  snapshot.unmatchedMpesa = await loadUnmatchedMpesa();

  if (result.customerId) {
    const customer = await customerStore.getCustomerById(result.customerId);
    if (customer) {
      const updated = await buildCustomerRecord(customer, {
        skipZoho: true,
        refreshZoho: true,
        fetchTisp: true,
      });
      snapshot.records.set(customer.id, updated);
    }
  }

  await logReconciliationAction({
    customerId: result.customerId,
    customerNumber: result.customerNumber,
    actionType: "allocate_unmatched_mpesa",
    previousValue: "unallocated",
    newValue: result.message,
    reason: null,
    user,
    metadata: {
      paymentId,
      mpesaReceipt: row.mpesa_receipt,
      zoho: result.zoho,
      tispPosted: result.tispPosted,
      tispError: result.tispError,
    },
  });

  await logActivity({
    eventType: "payment_allocated",
    title: "Unallocated M-Pesa applied",
    message: result.message,
    source: "reconciliation",
    status: result.tispPosted ? "success" : "partial",
    customerRef: result.customerNumber,
    amount: row.amount,
    referenceId: row.mpesa_receipt,
    metadata: { paymentId, zoho: result.zoho, tispPosted: result.tispPosted },
  });

  return result;
}

async function recordSyncRun({ status, triggeredBy, userId, customersScanned, issuesFound, errorMessage, metadata }) {
  try {
    const result = await query(
      `INSERT INTO reconciliation_sync_runs
        (status, triggered_by, user_id, customers_scanned, issues_found, error_message, metadata, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, IF(? IN ('completed', 'failed'), NOW(), NULL))`,
      [
        status,
        triggeredBy || "manual",
        userId || null,
        customersScanned || 0,
        issuesFound || 0,
        errorMessage || null,
        metadata ? JSON.stringify(metadata) : null,
        status,
      ]
    );
    return result.insertId;
  } catch (e) {
    console.warn("[reconciliation] sync run log skipped:", e.message);
    return null;
  }
}

async function completeSyncRun(runId, { status, customersScanned, issuesFound, errorMessage }) {
  if (!runId) return;
  try {
    await query(
      `UPDATE reconciliation_sync_runs
       SET status = ?, customers_scanned = ?, issues_found = ?, error_message = ?, completed_at = NOW()
       WHERE id = ?`,
      [status, customersScanned, issuesFound, errorMessage || null, runId]
    );
  } catch (e) {
    console.warn("[reconciliation] sync run update skipped:", e.message);
  }
}

async function runSync({
  triggeredBy = "manual",
  userId = null,
  fullZoho = true,
  browseOnly = false,
  inline = false,
} = {}) {
  const { loadEnv } = require("../config/env");
  const env = loadEnv();

  if (env.SYNC_ENABLED && !inline) {
    try {
      const { enqueueSync } = require("../queue/manager");
      const { INTEGRATIONS } = require("../queue/definitions");
      return enqueueSync(INTEGRATIONS.RECONCILIATION, {
        triggeredBy,
        userId,
        fullZoho,
        browseOnly,
      });
    } catch (e) {
      console.warn("[reconciliation] queue enqueue failed, falling back to inline:", e.message);
    }
  }

  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = doRunSync({ triggeredBy, userId, fullZoho, browseOnly }).finally(() => {
    activeSyncPromise = null;
    syncInProgress = false;
  });

  return activeSyncPromise;
}

async function runBrowseSync() {
  return runSync({
    triggeredBy: "browse",
    fullZoho: false,
    browseOnly: true,
    inline: true,
  });
}

async function doRunSync({
  triggeredBy = "manual",
  userId = null,
  fullZoho = true,
  browseOnly = false,
  onProgress,
} = {}) {
  await ensureReconciliationSchema();

  syncInProgress = true;
  snapshot.sync.status = "running";
  const runId = await recordSyncRun({
    status: "running",
    triggeredBy,
    userId,
  });
  snapshot.sync.runId = runId;

  try {
    const customers = await loadAllCustomersForReconciliation();
    const records = await syncCustomersIncremental(customers, {
      fullZoho: browseOnly ? false : fullZoho,
      onProgress,
      maxCustomers: browseOnly ? BROWSE_BATCH : undefined,
      replaceCache: !browseOnly,
    });

    let issuesFound = 0;
    for (const record of records) {
      if (record.primaryStatus !== "current" && record.primaryStatus !== "paid") {
        issuesFound += 1;
      }
    }

    snapshot.unmatchedMpesa = await loadUnmatchedMpesa();
    snapshot.at = Date.now();
    if (fullZoho && !browseOnly) {
      snapshot.lastFullZohoAt = snapshot.at;
    }
    snapshot.sync.status = "completed";
    snapshot.sync.lastCompletedAt = new Date().toISOString();
    snapshot.sync.lastError = null;
    snapshot.sync.progress = {
      phase: "complete",
      processed: records.length,
      total: customers.length,
      issuesFound,
      partialReady: true,
    };

    await persistInsightsCache({ partial: false });

    await completeSyncRun(runId, {
      status: "completed",
      customersScanned: records.length,
      issuesFound,
    });

    await logActivity({
      eventType: "reconciliation_sync",
      title: "Billing reconciliation sync completed",
      message: `Scanned ${records.length} customers, ${issuesFound} issues found`,
      source: "reconciliation",
      status: "success",
      metadata: { runId, issuesFound, customersScanned: records.length, fullZoho },
    });

    return {
      ok: true,
      customersScanned: records.length,
      issuesFound,
      unmatchedMpesa: snapshot.unmatchedMpesa.length,
      syncedAt: snapshot.sync.lastCompletedAt,
      fullZoho,
    };
  } catch (e) {
    snapshot.sync.status = "failed";
    snapshot.sync.lastError = e.message || "Sync failed";
    snapshot.sync.progress = {
      phase: "idle",
      processed: snapshot.sync.progress?.processed ?? snapshot.records.size,
      total: snapshot.sync.progress?.total ?? snapshot.records.size,
      issuesFound: snapshot.sync.progress?.issuesFound ?? 0,
      partialReady: snapshot.sync.progress?.partialReady ?? false,
    };
    if (snapshot.records.size > 0) {
      await persistInsightsCache({ partial: true });
    }
    await completeSyncRun(runId, {
      status: "failed",
      customersScanned: snapshot.records.size,
      issuesFound: 0,
      errorMessage: snapshot.sync.lastError,
    });

    await logActivity({
      eventType: "reconciliation_sync_failed",
      title: "Billing reconciliation sync failed",
      message: snapshot.sync.lastError,
      source: "reconciliation",
      status: "failed",
    });

    return { ok: false, error: snapshot.sync.lastError };
  }
}

function ensureSnapshotFresh() {
  const stale = !snapshot.at || Date.now() - snapshot.at > SYNC_INTERVAL_MS;
  return stale;
}

function isFullZohoStale() {
  if (!snapshot.lastFullZohoAt) return true;
  return Date.now() - snapshot.lastFullZohoAt > SYNC_INTERVAL_MS;
}

function buildSummaryPayload() {
  const records = Array.from(snapshot.records.values());
  const summary = aggregateSummary(records);
  summary.unmatchedMpesaPayments = Math.max(
    summary.unmatchedMpesaPayments,
    snapshot.unmatchedMpesa.length
  );

  const issueTiles = buildIssueTiles(records, snapshot.unmatchedMpesa);

  return {
    ...summary,
    issueTiles,
    sync: buildSyncMeta(),
  };
}

function getCachedSummary() {
  return getCachedSummaryAsync();
}

async function getCachedSummaryAsync() {
  const cached = await loadInsightsFromDb();
  if (cached) {
    scheduleBackgroundSyncIfNeeded();
    return cached;
  }

  await ensureDbHydrated();
  const built = buildSummaryPayload();
  if (built.sync.customerCount > 0) {
    built.fromCache = true;
    return mergeLiveSyncStatus(built);
  }

  scheduleBackgroundSyncIfNeeded();
  return mergeLiveSyncStatus(built);
}

function scheduleBackgroundSyncIfNeeded() {
  if (activeSyncPromise || snapshot.sync.status === "running") return;
  if (snapshot.records.size > 0) return;

  runBrowseSync().catch(() => {});
}

function setUnmatchedMpesaCache(rows) {
  snapshot.unmatchedMpesa = Array.isArray(rows) ? rows : [];
  snapshot.at = Date.now();
}

function startScheduledSync() {
  const { loadEnv } = require("../config/env");
  const env = loadEnv();
  if (env.SYNC_ENABLED) {
    return;
  }
  if (scheduledTimer) return;
  setImmediate(() => {
    ensureDbHydrated()
      .then(() =>
        runSync({ triggeredBy: "scheduled", fullZoho: false, browseOnly: true, inline: true })
      )
      .catch((e) => {
        console.error("[reconciliation] initial sync error:", e.message);
      });
  });
  scheduledTimer = setInterval(async () => {
    if (syncInProgress) return;
    try {
      await runSync({
        triggeredBy: "scheduled",
        fullZoho: false,
        browseOnly: true,
        inline: true,
      });
    } catch (e) {
      console.error("[reconciliation] scheduled sync error:", e.message);
    }
  }, SYNC_INTERVAL_MS);
}

async function getSummary() {
  await waitForSyncInProgress();
  scheduleBackgroundSyncIfNeeded();
  return buildSummaryPayload();
}

function formatCustomerListRow(r) {
  const preview = recordToIssuePreview(r);
  return {
    customerId: r.customerId,
    customerNumber: r.customerNumber,
    customerName: r.customerName,
    buildingName: r.buildingName,
    productName: r.productName,
    customerType: r.customerType || "C2B",
    primaryStatus: r.primaryStatus,
    statuses: r.statuses,
    metrics: r.metrics,
    recommendations: r.recommendations,
    issueBasis: preview.issueBasis,
    actionLabel: preview.actionLabel,
    syncedAt: r.syncedAt,
  };
}

function applyRecordFilters(records, filters = {}) {
  let filtered = records;

  if (filters.status) {
    const statuses = String(filters.status)
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    filtered = filtered.filter((r) =>
      statuses.some(
        (status) =>
          r.primaryStatus === status || (r.statuses || []).includes(status)
      )
    );
  }

  if (filters.buildingId) {
    filtered = filtered.filter((r) => String(r.buildingId) === String(filters.buildingId));
  }

  if (filters.issuesOnly === true || filters.issuesOnly === "true") {
    filtered = filtered.filter(
      (r) => r.primaryStatus !== "current" && r.primaryStatus !== "paid"
    );
  }

  return filtered;
}

function sortRecords(records, filters = {}) {
  const sortBy = filters.sortBy || "priority";
  const sortDir = filters.sortDir === "asc" ? 1 : -1;
  const { STATUS_PRIORITY } = require("../utils/reconciliationEngine");
  const sorted = [...records];
  sorted.sort((a, b) => {
    let cmp = 0;
    if (sortBy === "priority") {
      cmp = (STATUS_PRIORITY[b.primaryStatus] || 0) - (STATUS_PRIORITY[a.primaryStatus] || 0);
    } else if (sortBy === "customerNumber") {
      cmp = String(a.customerNumber).localeCompare(String(b.customerNumber));
    } else if (sortBy === "outstandingBalance") {
      cmp = (b.metrics?.outstandingBalance || 0) - (a.metrics?.outstandingBalance || 0);
    } else if (sortBy === "customerName") {
      cmp = String(a.customerName).localeCompare(String(b.customerName));
    }
    return cmp * sortDir;
  });
  return sorted;
}

async function listCustomersBrowse(filters = {}) {
  await ensureDbHydrated();
  await waitForSyncInProgress();

  if (snapshot.records.size === 0 && snapshot.sync.status !== "running") {
    await runBrowseSync();
    await waitForSyncInProgress();
  }

  const limit = Math.min(BROWSE_BATCH, Math.max(1, Number(filters.limit) || BROWSE_BATCH));
  const records = sortRecords(
    applyRecordFilters(Array.from(snapshot.records.values()), filters),
    filters
  ).slice(0, limit);

  return {
    data: records.map(formatCustomerListRow),
    pagination: {
      page: 1,
      limit,
      total: records.length,
      pages: 1,
    },
    sync: buildSyncMeta(),
    browseMode: true,
  };
}

async function listCustomersBySearch(filters = {}) {
  const search = String(filters.search || "").trim();
  const page = Math.max(1, Number(filters.page) || 1);
  // Keep search pages small — each hit does live Zoho + TISP.
  const limit = Math.min(25, Math.max(1, Number(filters.limit) || 25));
  const zohoConcurrency = Math.max(
    1,
    Math.min(3, Number(process.env.RECONCILIATION_ZOHO_CONCURRENCY) || 2)
  );

  const result = await customerStore.listCustomers({
    page,
    limit,
    search,
    searchMode: "exact",
    accountStatus: "active",
    buildingId: filters.buildingId,
  });

  const enriched = await mapWithConcurrency(
    result.data,
    zohoConcurrency,
    async (customer) => {
      // Live Zoho invoices/payments/recurring + live TISP for searched customers.
      const record = await buildCustomerRecord(customer, {
        refreshZoho: true,
        refreshTisp: true,
        fetchTisp: true,
      });
      snapshot.records.set(record.customerId, record);
      try {
        await upsertCustomerCacheRecord(record);
      } catch (e) {
        console.warn("[reconciliation] search cache upsert skipped:", e.message);
      }
      return record;
    }
  );

  const records = sortRecords(
    applyRecordFilters(enriched, filters),
    filters
  );

  return {
    data: records.map(formatCustomerListRow),
    pagination: {
      page,
      limit,
      total: filters.status ? records.length : result.pagination.total,
      pages: filters.status
        ? Math.max(1, Math.ceil(records.length / limit) || 1)
        : result.pagination.pages,
    },
    sync: buildSyncMeta(),
    searchMode: true,
  };
}

async function listCustomers(filters = {}) {
  if (filters.forExport) {
    await ensureDbHydrated();
    const records = sortRecords(
      applyRecordFilters(Array.from(snapshot.records.values()), filters),
      filters
    );
    return {
      data: records.map(formatCustomerListRow),
      pagination: {
        page: 1,
        limit: records.length,
        total: records.length,
        pages: 1,
      },
      sync: buildSyncMeta(),
    };
  }

  const search = String(filters.search || "").trim();
  if (search) {
    return listCustomersBySearch(filters);
  }
  return listCustomersBrowse(filters);
}

async function getCustomerDetail(customerId, options = {}) {
  const id = Number(customerId);
  const customer = await customerStore.getCustomerById(id);
  if (!customer) return null;

  const refreshTisp = options.refreshTisp === true;
  const refreshZoho = options.refreshZoho === true;
  let record = snapshot.records.get(id);

  // Reuse sync snapshot for fast expand; rebuild with live Zoho/TISP on explicit refresh.
  if (!record || refreshTisp || refreshZoho) {
    record = await buildCustomerRecord(customer, {
      refreshZoho,
      refreshTisp,
      fetchTisp: refreshTisp || refreshZoho,
    });
    snapshot.records.set(id, record);
  }

  const auditRows = await query(
    `SELECT id, action_type, previous_value, new_value, reason, user_email, created_at, metadata
     FROM reconciliation_actions
     WHERE customer_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [customer.id]
  ).catch(() => []);

  const activityRows = await query(
    `SELECT id, event_type, title, message, source, status, amount, reference_id, created_at
     FROM activity_logs
     WHERE customer_ref = ?
     ORDER BY created_at DESC
     LIMIT 30`,
    [customer.customerNumber]
  );

  return {
    ...record,
    customer,
    auditTrail: auditRows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      previousValue: row.previous_value,
      newValue: row.new_value,
      reason: row.reason,
      userEmail: row.user_email,
      createdAt: row.created_at,
      metadata: row.metadata,
    })),
    activityTrail: activityRows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      title: row.title,
      message: row.message,
      source: row.source,
      status: row.status,
      amount: row.amount != null ? Number(row.amount) : null,
      referenceId: row.reference_id,
      createdAt: row.created_at,
    })),
  };
}

async function logReconciliationAction({
  customerId,
  customerNumber,
  actionType,
  previousValue,
  newValue,
  reason,
  user,
  metadata = {},
}) {
  await ensureReconciliationSchema();
  try {
    await query(
      `INSERT INTO reconciliation_actions
        (customer_id, customer_number, action_type, previous_value, new_value, reason, user_id, user_email, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId || null,
        customerNumber || null,
        actionType,
        previousValue || null,
        newValue || null,
        reason || null,
        user?.id || null,
        user?.email || null,
        JSON.stringify(metadata),
      ]
    );
  } catch (e) {
    console.warn("[reconciliation] action log skipped:", e.message);
  }
}

async function executeAction(customerId, action, payload, user) {
  const customer = await customerStore.getCustomerById(Number(customerId));
  if (!customer) {
    const err = new Error("Customer not found");
    err.status = 404;
    throw err;
  }

  const detail = await getCustomerDetail(customerId, { refreshTisp: true });
  let result = { ok: true, message: "Action recorded" };

  switch (action) {
    case "notify_payment_reminder":
    case "notify_overdue":
    case "notify_reconnection":
    case "notify_disconnection":
    case "notify_payment_allocation":
    case "notify_ops_reconnect":
    case "notify_ops_disconnect": {
      const templateByAction = {
        notify_payment_reminder: "payment_overdue",
        notify_overdue: "payment_overdue",
        notify_reconnection: "reconnection",
        notify_disconnection: "disconnected_billing",
        notify_payment_allocation: "payment_allocation",
      };

      const billingCommunicationStore = require("./billingCommunicationStore");
      if (
        billingCommunicationStore.isZohoMailConfigured() &&
        templateByAction[action]
      ) {
        const sent = await billingCommunicationStore.sendCommunication(customer.id, {
          templateKey: templateByAction[action],
          user,
        });
        result.message = sent.message;
        break;
      }

      const titles = {
        notify_payment_reminder: "Payment reminder logged",
        notify_overdue: "Overdue notice logged",
        notify_reconnection: "Reconnection notice logged",
        notify_disconnection: "Disconnection notice logged",
        notify_payment_allocation: "Payment allocation notice logged",
        notify_ops_reconnect: "Operations notified to reconnect",
        notify_ops_disconnect: "Operations notified to disconnect",
      };
      await logActivity({
        eventType: action,
        title: titles[action] || action,
        message:
          payload?.message ||
          `Reconciliation action for ${customer.customerNumber} (Zoho Mail not configured)`,
        source: "reconciliation",
        status: "success",
        customerRef: customer.customerNumber,
        metadata: { action, ...payload },
      });
      result.message = titles[action] || "Notification logged";
      break;
    }

    case "resume_recurring_invoice": {
      const recurringId = payload?.recurringInvoiceId || detail.recurringInvoices?.[0]?.id;
      if (!recurringId) throw new Error("No recurring invoice to resume");
      await resumeRecurringInvoice_JS(recurringId);
      result.message = "Recurring invoice resumed";
      break;
    }

    case "allocate_payment": {
      const { mpesaPaymentId, invoiceId } = payload || {};
      if (mpesaPaymentId && !invoiceId) {
        const alloc = await allocateUnmatchedMpesa(Number(mpesaPaymentId), user);
        result.message = alloc.message;
        break;
      }
      if (!mpesaPaymentId || !invoiceId) {
        throw new Error("mpesaPaymentId and invoiceId are required");
      }
      const mpesaRows = await query(
        `SELECT * FROM payment_transactions WHERE id = ? AND status = 'SUCCESS' LIMIT 1`,
        [mpesaPaymentId]
      );
      const mpesa = mpesaRows[0];
      if (!mpesa) throw new Error("M-Pesa payment not found");

      if (await isMpesaPaymentAllocated(mpesa.mpesa_receipt)) {
        throw new Error("Payment is already allocated in Zoho");
      }

      const accountRef = String(mpesa.account_reference || customer.customerNumber || "").trim();
      const zohoResult = await applyZohoPaymentForMpesa({
        customerNumber: accountRef,
        amount: Number(mpesa.amount),
        transactionId: mpesa.mpesa_receipt,
        source: "reconciliation",
        forceInvoiceId: invoiceId,
      });
      await logZohoMpesaPaymentResult(zohoResult, {
        channel: "reconciliation",
        accountRef,
        amount: Number(mpesa.amount),
        transactionId: mpesa.mpesa_receipt,
      });

      if (!zohoResult.paid) {
        throw new Error(
          zohoResult.message ||
            `Could not apply payment in Zoho (${zohoResult.reason || "unknown"})`
        );
      }

      await logActivity({
        eventType: "payment_allocated",
        title: "Payment manually allocated",
        message: `Allocated M-Pesa ${mpesa.mpesa_receipt} to invoice ${invoiceId}`,
        source: "reconciliation",
        status: "success",
        customerRef: customer.customerNumber,
        amount: mpesa.amount,
        referenceId: mpesa.mpesa_receipt,
      });
      result.message = "Payment allocated to invoice";
      break;
    }

    case "refresh_status": {
      result.message = "Customer status refreshed";
      break;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }

  await logReconciliationAction({
    customerId: customer.id,
    customerNumber: customer.customerNumber,
    actionType: action,
    previousValue: payload?.previousValue || null,
    newValue: payload?.newValue || result.message,
    reason: payload?.reason || null,
    user,
    metadata: payload || {},
  });

  const updated = await buildCustomerRecord(customer, {
    skipZoho: true,
    refreshZoho: true,
    refreshTisp: true,
  });
  snapshot.records.set(customer.id, updated);

  return { ...result, customer: updated };
}

function getSyncStatus() {
  return {
    status: snapshot.sync.status,
    lastSyncAt: snapshot.sync.lastCompletedAt,
    lastError: snapshot.sync.lastError,
    runId: snapshot.sync.runId,
    intervalMs: SYNC_INTERVAL_MS,
    customerCount: snapshot.records.size,
    unmatchedMpesaCount: snapshot.unmatchedMpesa.length,
    progress: snapshot.sync.progress,
  };
}

function getUnmatchedMpesa() {
  return snapshot.unmatchedMpesa;
}

function getRecords() {
  return Array.from(snapshot.records.values());
}

module.exports = {
  runSync,
  doRunSync,
  getSummary,
  getCachedSummary,
  scheduleBackgroundSyncIfNeeded,
  listCustomers,
  getCustomerDetail,
  executeAction,
  startScheduledSync,
  getSyncStatus,
  getUnmatchedMpesa,
  setUnmatchedMpesaCache,
  getUnmatchedMpesaDetail,
  allocateUnmatchedMpesa,
  getRecords,
  buildCustomerRecord,
};
