/* eslint-disable no-console */
/**
 * Xtream UI R22 customer sync + API endpoint test job.
 *
 * Usage:
 *   node jobs/xtreamSyncJob.js                 # sync customers from config
 *   node jobs/xtreamSyncJob.js --test-endpoints # exercise all documented endpoints
 *   node jobs/xtreamSyncJob.js --sync --test-endpoints
 *
 * Customer source (for now): config/xtream-test-customers.json
 * Future: Zoho Books + TISP (see loadCustomers stub below).
 */
require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const {
  getBouquets,
  createUser,
  editUser,
  disableUser,
  enableUser,
  isUsernameExistsError,
  getXtreamConfig,
} = require("../api/services/xtream/xtreamClient");
const { logXtreamSyncEvent } = require("../api/utils/xtreamSyncLogger");

const ROOT = path.resolve(__dirname, "..");
const TEST_CUSTOMERS_FILE = path.join(ROOT, "config", "xtream-test-customers.json");
const SYNC_SETTINGS_FILE = path.join(ROOT, "config", "xtream-sync.json");

const args = new Set(process.argv.slice(2));
const runSync = args.has("--sync") || (!args.has("--test-endpoints") && args.size === 0);
const runEndpointTests = args.has("--test-endpoints");

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeCustomerNumber(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-");
}

function buildXtreamUsername(customer, settings) {
  const base = normalizeCustomerNumber(customer.customer_number);
  const normalized = settings?.username?.normalizeUppercase
    ? base.toUpperCase()
    : base;
  if (!settings?.username?.includeApartmentSuffix) return normalized;
  const apt = String(customer.apartment || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return apt ? `${normalized}_${apt}` : normalized;
}

function derivePassword(customerNumber) {
  const secret =
    process.env.XTREAM_PASSWORD_SECRET || "xtream-local-dev-secret";
  return crypto
    .createHash("sha256")
    .update(`${normalizeCustomerNumber(customerNumber)}:${secret}`)
    .digest("hex")
    .slice(0, 10);
}

function computeExpDate(activeExpiryDays) {
  const days = Number(activeExpiryDays) > 0 ? Number(activeExpiryDays) : 30;
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

function bouquetForCustomer(customer, settings) {
  const bouquets = settings?.bouquets || {};
  if (customer.isDstvCustomer) {
    return Array.isArray(bouquets.dstv) ? bouquets.dstv : [1];
  }
  return Array.isArray(bouquets.default) ? bouquets.default : [1];
}

/**
 * Placeholder for future Zoho + TISP integration.
 * Returns [] until enabled in config/xtream-sync.json futureSources.
 */
async function loadCustomersFromZohoAndTisp(_settings) {
  return [];
}

async function loadCustomers(settings) {
  const testConfig = await readJson(TEST_CUSTOMERS_FILE, { customers: [] });
  const testCustomers = Array.isArray(testConfig.customers)
    ? testConfig.customers
    : [];

  const fromIntegrations = await loadCustomersFromZohoAndTisp(settings);
  const merged = [...testCustomers, ...fromIntegrations];

  const seen = new Set();
  return merged.filter((c) => {
    const key = normalizeCustomerNumber(c.customer_number).toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function recordEvent(event, payload = {}) {
  await logXtreamSyncEvent({ event, ...payload });
}

async function provisionCustomer(customer, settings) {
  const username = buildXtreamUsername(customer, settings);
  const password = derivePassword(customer.customer_number);
  const maxConnections = Number(settings.defaultMaxConnections || 1);
  const bouquetIds = bouquetForCustomer(customer, settings);
  const expDate = computeExpDate(settings.activeExpiryDays);

  const baseMeta = {
    customer_number: customer.customer_number,
    apartment: customer.apartment,
    isActive: Boolean(customer.isActive),
    isDstvCustomer: Boolean(customer.isDstvCustomer),
    username,
    bouquetIds,
  };

  if (!customer.isActive) {
    const disabled = await disableUser({ username });
    await recordEvent("customer.disable", {
      ...baseMeta,
      success: disabled.success,
      httpStatus: disabled.httpStatus,
      message: disabled.message,
      response: disabled.data,
    });
    return { username, action: "disable", success: disabled.success, result: disabled };
  }

  const created = await createUser({
    username,
    password,
    maxConnections,
    expDate,
    bouquetIds,
  });

  if (created.success) {
    await recordEvent("customer.create", {
      ...baseMeta,
      success: true,
      httpStatus: created.httpStatus,
      message: created.message,
      expDate,
      response: created.data,
    });
    return { username, action: "create", success: true, result: created };
  }

  if (isUsernameExistsError(created)) {
    const edited = await editUser({ username, expDate, bouquetIds });
    const enabled = await enableUser({ username });
    const success = edited.success || enabled.success;
    await recordEvent("customer.renew", {
      ...baseMeta,
      success,
      httpStatus: edited.httpStatus,
      message: edited.message,
      expDate,
      enableMessage: enabled.message,
      response: edited.data,
    });
    return {
      username,
      action: "renew",
      success,
      result: { create: created, edit: edited, enable: enabled },
    };
  }

  await recordEvent("customer.create_failed", {
    ...baseMeta,
    success: false,
    httpStatus: created.httpStatus,
    message: created.message,
    response: created.data,
  });
  return { username, action: "create_failed", success: false, result: created };
}

async function syncCustomers() {
  const settings = await readJson(SYNC_SETTINGS_FILE, {});
  const customers = await loadCustomers(settings);
  const cfg = getXtreamConfig();

  console.log(`[xtream-sync] base URL: ${cfg.baseUrl}`);
  console.log(`[xtream-sync] customers to process: ${customers.length}`);

  await recordEvent("sync.start", {
    customerCount: customers.length,
    source: "test-config",
    baseUrl: cfg.baseUrl,
  });

  const summary = { total: customers.length, success: 0, failed: 0, results: [] };
  for (const customer of customers) {
    try {
      const outcome = await provisionCustomer(customer, settings);
      if (outcome.success) summary.success += 1;
      else summary.failed += 1;
      summary.results.push(outcome);
      console.log(
        `[xtream-sync] ${customer.customer_number} -> ${outcome.action} (${outcome.success ? "ok" : "fail"})`
      );
    } catch (e) {
      summary.failed += 1;
      summary.results.push({
        customer_number: customer.customer_number,
        action: "error",
        success: false,
        error: e.message,
      });
      await recordEvent("customer.error", {
        customer_number: customer.customer_number,
        error: e.message,
      });
      console.error(`[xtream-sync] ${customer.customer_number} error:`, e.message);
    }
  }

  await recordEvent("sync.complete", summary);
  console.log(
    `[xtream-sync] done: ${summary.success} succeeded, ${summary.failed} failed`
  );
  return summary;
}

async function testAllEndpoints() {
  const settings = await readJson(SYNC_SETTINGS_FILE, {});
  const cfg = getXtreamConfig();
  const prefix = settings?.endpointTest?.sampleUsernamePrefix || "xtream_api_test_";
  const username = `${prefix}${Date.now().toString(36)}`;
  const password = derivePassword(username);
  const bouquetIds = bouquetForCustomer(
    { isDstvCustomer: false },
    settings
  );
  const expDate = computeExpDate(settings.activeExpiryDays);

  console.log(`[xtream-test] base URL: ${cfg.apiUrl}`);
  await recordEvent("endpoint_test.start", { baseUrl: cfg.baseUrl });

  const steps = [];

  const bouquetRes = await getBouquets();
  steps.push({ step: "bouquet.get", success: bouquetRes.success, message: bouquetRes.message });
  console.log(`[xtream-test] bouquet.get -> ${bouquetRes.success ? "ok" : "fail"}: ${bouquetRes.message}`);

  const createRes = await createUser({
    username,
    password,
    maxConnections: 1,
    expDate,
    bouquetIds,
  });
  steps.push({ step: "user.create", success: createRes.success, message: createRes.message, username });
  console.log(`[xtream-test] user.create -> ${createRes.success ? "ok" : "fail"}: ${createRes.message}`);

  const newExp = expDate + 7 * 24 * 60 * 60;
  const editRes = await editUser({ username, expDate: newExp, bouquetIds });
  steps.push({ step: "user.edit", success: editRes.success, message: editRes.message, username });
  console.log(`[xtream-test] user.edit -> ${editRes.success ? "ok" : "fail"}: ${editRes.message}`);

  const disableRes = await disableUser({ username });
  steps.push({ step: "user.disable", success: disableRes.success, message: disableRes.message, username });
  console.log(`[xtream-test] user.disable -> ${disableRes.success ? "ok" : "fail"}: ${disableRes.message}`);

  const enableRes = await enableUser({ username });
  steps.push({ step: "user.enable", success: enableRes.success, message: enableRes.message, username });
  console.log(`[xtream-test] user.enable -> ${enableRes.success ? "ok" : "fail"}: ${enableRes.message}`);

  const passed = steps.filter((s) => s.success).length;
  const summary = {
    totalSteps: steps.length,
    passed,
    failed: steps.length - passed,
    steps,
  };

  await recordEvent("endpoint_test.complete", summary);
  console.log(`[xtream-test] complete: ${passed}/${steps.length} passed`);
  return summary;
}

async function main() {
  if (String(process.env.XTREAM_SYNC_ENABLED || "true").toLowerCase() === "false") {
    console.log("[xtream] job skipped (XTREAM_SYNC_ENABLED=false)");
    return;
  }

  const results = {};
  if (runEndpointTests) {
    results.endpointTests = await testAllEndpoints();
  }
  if (runSync) {
    results.sync = await syncCustomers();
  }

  const failed =
    (results.endpointTests?.failed || 0) + (results.sync?.failed || 0);
  if (failed > 0) process.exitCode = 1;
  return results;
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("[xtream] fatal:", err.message);
    await recordEvent("job.fatal", { error: err.message, code: err.code || null });
    process.exitCode = 1;
  });
}

module.exports = {
  syncCustomers,
  testAllEndpoints,
  loadCustomers,
  provisionCustomer,
};
