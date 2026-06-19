#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const {
  getBaseUrl,
  getBouquets,
  createSubscriptionLine,
  editSubscriptionLine,
  disableSubscriptionLine,
  enableSubscriptionLine,
  getDeveloperCredentials,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");
const { logXtreamSyncEvent } = require("../api/utils/xtreamSyncLogger");

const ROOT = path.resolve(__dirname, "..");
const SYNC_CONFIG_FILE = path.join(ROOT, "config", "xtream-sync.json");
const TEST_CUSTOMERS_FILE =
  process.env.XTREAM_TEST_CUSTOMERS_FILE ||
  path.join(ROOT, "config", "xtream-test-customers.json");
const CUSTOMER_MAP_FILE = path.join(ROOT, "logs", "xtream-customer-map.json");

function syncEnabled() {
  return String(process.env.XTREAM_SYNC_ENABLED || "true").toLowerCase() !== "false";
}

/** Flatten API result into log fields; always includes full `endpoint` URL. */
function apiLogPayload(res, extra = {}) {
  return {
    ...extra,
    endpoint: res.endpoint || res.request?.endpoint,
    ok: res.ok,
    httpStatus: res.httpStatus,
    diagnostics: res.diagnostics,
    response: res.data,
    request: res.request,
  };
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function loadSyncConfig() {
  return readJsonFile(SYNC_CONFIG_FILE, {
    defaultMaxConnections: 1,
    activeExpiryDays: 30,
    bouquets: { default: [1] },
    username: { normalizeUppercase: true, includeApartmentSuffix: false },
    endpointTest: { enabled: true, sampleUsernamePrefix: "xtream_api_test_" },
  });
}

async function loadTestCustomers() {
  const parsed = await readJsonFile(TEST_CUSTOMERS_FILE, null);
  if (parsed && Array.isArray(parsed.customers)) return parsed.customers;
  throw new Error(
    `Missing or invalid test customers config at ${TEST_CUSTOMERS_FILE}. Copy config/xtream-test-customers.json.dist and edit apartment_number + password.`
  );
}

function buildUsername(customer, syncConfig) {
  const base = String(customer.apartment_number || customer.customer_number || "")
    .trim()
    .replace(/\s+/g, "");
  if (!base) throw new Error("customer missing apartment_number and customer_number");
  let username = base;
  if (syncConfig.username?.normalizeUppercase) username = username.toUpperCase();
  return username;
}

function resolveBouquetIds(customer, syncConfig) {
  const key = String(customer.bouquet || "default").trim();
  const ids = syncConfig.bouquets?.[key] || syncConfig.bouquets?.default || [1];
  return Array.isArray(ids) ? ids : [ids];
}

function computeExpDate(syncConfig) {
  const days = Number(syncConfig.activeExpiryDays || 30);
  return Math.floor(Date.now() / 1000) + days * 86400;
}

async function syncOneCustomer(customer, syncConfig, map) {
  const customerNumber = String(customer.customer_number || "").trim();
  const active = customer.active !== false;
  const username = buildUsername(customer, syncConfig);
  const password = String(customer.password || "").trim();
  const maxConnections = Number(customer.max_connections || syncConfig.defaultMaxConnections || 1);
  const bouquet = resolveBouquetIds(customer, syncConfig);
  const expDate = computeExpDate(syncConfig);
  const mapped = map[customerNumber];

  if (!active) {
    if (!mapped?.username) {
      await logXtreamSyncEvent({
        event: "sync_skip",
        customer_number: customerNumber,
        reason: "inactive_no_xtream_account",
      });
      return { customer_number: customerNumber, action: "skip", success: true };
    }
    const res = await disableSubscriptionLine(mapped.username);
    await logXtreamSyncEvent(
      apiLogPayload(res, {
        event: "customer.disable",
        customer_number: customerNumber,
        username: mapped.username,
      })
    );
    if (res.ok) {
      map[customerNumber] = { ...mapped, disabledAt: new Date().toISOString() };
    }
    return {
      customer_number: customerNumber,
      action: "disable",
      success: res.ok,
      error: res.ok ? undefined : JSON.stringify(res.data),
    };
  }

  if (!password) {
    const err = "password is required for active test customers (subscription line password)";
    await logXtreamSyncEvent({
      event: "customer.error",
      customer_number: customerNumber,
      error: err,
    });
    return { customer_number: customerNumber, action: "error", success: false, error: err };
  }

  if (!mapped?.username) {
    const res = await createSubscriptionLine({
      username,
      password,
      max_connections: maxConnections,
      exp_date: expDate,
      bouquet,
    });
    await logXtreamSyncEvent(
      apiLogPayload(res, {
        event: "customer.create",
        customer_number: customerNumber,
        apartment_number: customer.apartment_number,
        username,
      })
    );
    if (res.ok) {
      map[customerNumber] = {
        username,
        apartment_number: customer.apartment_number,
        createdAt: new Date().toISOString(),
        exp_date: expDate,
        bouquet,
      };
      return { customer_number: customerNumber, action: "create", success: true };
    }
    return {
      customer_number: customerNumber,
      action: "create",
      success: false,
      error: JSON.stringify(res.data),
    };
  }

  if (mapped.disabledAt) {
    const enableRes = await enableSubscriptionLine(mapped.username);
    await logXtreamSyncEvent(
      apiLogPayload(enableRes, {
        event: "customer.enable",
        customer_number: customerNumber,
        username: mapped.username,
      })
    );
    if (!enableRes.ok) {
      return {
        customer_number: customerNumber,
        action: "enable",
        success: false,
        error: JSON.stringify(enableRes.data),
      };
    }
    delete map[customerNumber].disabledAt;
  }

  const res = await editSubscriptionLine({
    username: mapped.username,
    exp_date: expDate,
    bouquet,
  });
  await logXtreamSyncEvent(
    apiLogPayload(res, {
      event: "customer.renew",
      customer_number: customerNumber,
      username: mapped.username,
    })
  );
  if (res.ok) {
    map[customerNumber] = {
      ...mapped,
      exp_date: expDate,
      bouquet,
      renewedAt: new Date().toISOString(),
    };
    return { customer_number: customerNumber, action: "renew", success: true };
  }
  return {
    customer_number: customerNumber,
    action: "renew",
    success: false,
    error: JSON.stringify(res.data),
  };
}

async function runSync() {
  if (!syncEnabled()) {
    console.log("[xtream] sync disabled via XTREAM_SYNC_ENABLED");
    await logXtreamSyncEvent({ event: "sync.skipped", reason: "XTREAM_SYNC_ENABLED=false" });
    return { ok: true, skipped: true };
  }

  const syncConfig = await loadSyncConfig();
  const customers = await loadTestCustomers();
  const map = await readJsonFile(CUSTOMER_MAP_FILE, {});

  await logXtreamSyncEvent({
    event: "sync.start",
    customerCount: customers.length,
    source: "test-config",
    baseUrl: getBaseUrl(),
  });

  const results = [];
  for (const customer of customers) {
    try {
      const result = await syncOneCustomer(customer, syncConfig, map);
      results.push(result);
    } catch (e) {
      await logXtreamSyncEvent({
        event: "customer.error",
        customer_number: customer.customer_number,
        error: e.message,
      });
      results.push({
        customer_number: customer.customer_number,
        action: "error",
        success: false,
        error: e.message,
      });
    }
  }

  await writeJsonFile(CUSTOMER_MAP_FILE, map);

  const summary = {
    event: "sync.complete",
    total: results.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
  await logXtreamSyncEvent(summary);
  console.log("[xtream] sync complete", summary);
  return { ok: summary.failed === 0, summary };
}

async function testAllEndpoints() {
  try {
    getDeveloperCredentials();
  } catch (e) {
    console.error(
      "[xtream] Missing credentials. Add to .env:\n" +
        "  XTREAM_DEVELOPER_USERNAME=your_panel_admin_user\n" +
        "  XTREAM_DEVELOPER_PASSWORD=your_panel_admin_password\n" +
        "  XTREAM_BASE_URL=http://PANEL_IP:25500"
    );
    throw e;
  }

  const syncConfig = await loadSyncConfig();
  await logXtreamSyncEvent({ event: "endpoint_test.start", baseUrl: getBaseUrl() });

  const bouquetRes = await getBouquets();
  const bouquetDetail = describeApiResult(bouquetRes);
  await logXtreamSyncEvent(
    apiLogPayload(bouquetRes, {
      event: "endpoint_test.bouquet_get",
      detail: bouquetDetail,
    })
  );

  const tests = [
    {
      name: "bouquet_get",
      ok: bouquetRes.ok,
      detail: bouquetDetail,
      endpoint: bouquetRes.endpoint,
    },
  ];
  let allOk = bouquetRes.ok;

  if (!bouquetRes.ok) {
    const diag = bouquetRes.diagnostics || {};
    console.error(`[xtream] bouquet_get FAILED: ${bouquetDetail}`);
    console.error(
      `[xtream] HTTP ${bouquetRes.httpStatus}, body length ${diag.responseBodyLength ?? "?"}, content-type ${diag.contentType ?? "?"}`
    );
    console.error(
      "[xtream] Fix panel access first (credentials, API enabled, billing server IP whitelisted on port 25500)."
    );
    console.error(
      "[xtream] Note: endpoint in logs shows developer_password=[redacted] by design; live request uses .env password."
    );
  }

  if (syncConfig.endpointTest?.enabled && bouquetRes.ok) {
    const prefix = syncConfig.endpointTest.sampleUsernamePrefix || "xtream_api_test_";
    const sampleUser = `${prefix}${Date.now().toString(36)}`;
    const samplePass = `T${Math.random().toString(36).slice(2, 10)}`;
    const expDate = computeExpDate(syncConfig);
    const bouquet = resolveBouquetIds({ bouquet: "default" }, syncConfig);

    const createRes = await createSubscriptionLine({
      username: sampleUser,
      password: samplePass,
      max_connections: 1,
      exp_date: expDate,
      bouquet,
    });
    const createDetail = describeApiResult(createRes);
    await logXtreamSyncEvent(
      apiLogPayload(createRes, {
        event: "endpoint_test.user_create",
        username: sampleUser,
        detail: createDetail,
      })
    );
    tests.push({
      name: "user_create",
      ok: createRes.ok,
      detail: createDetail,
      endpoint: createRes.endpoint,
    });
    allOk = allOk && createRes.ok;
    if (!createRes.ok) {
      console.error(`[xtream] user_create FAILED: ${createDetail}`);
    }

    if (createRes.ok) {
      const editRes = await editSubscriptionLine({
        username: sampleUser,
        exp_date: expDate + 86400,
        bouquet,
      });
      await logXtreamSyncEvent(
        apiLogPayload(editRes, {
          event: "endpoint_test.user_edit",
          username: sampleUser,
        })
      );
      tests.push({
        name: "user_edit",
        ok: editRes.ok,
        endpoint: editRes.endpoint,
      });
      allOk = allOk && editRes.ok;

      const disableRes = await disableSubscriptionLine(sampleUser);
      await logXtreamSyncEvent(
        apiLogPayload(disableRes, {
          event: "endpoint_test.user_disable",
          username: sampleUser,
        })
      );
      tests.push({
        name: "user_disable",
        ok: disableRes.ok,
        endpoint: disableRes.endpoint,
      });
      allOk = allOk && disableRes.ok;

      const enableRes = await enableSubscriptionLine(sampleUser);
      await logXtreamSyncEvent(
        apiLogPayload(enableRes, {
          event: "endpoint_test.user_enable",
          username: sampleUser,
        })
      );
      tests.push({
        name: "user_enable",
        ok: enableRes.ok,
        endpoint: enableRes.endpoint,
      });
      allOk = allOk && enableRes.ok;
    }
  } else if (syncConfig.endpointTest?.enabled && !bouquetRes.ok) {
    tests.push({
      name: "user_create",
      ok: false,
      detail: "skipped — bouquet_get must succeed first",
    });
    allOk = false;
  }

  await logXtreamSyncEvent({ event: "endpoint_test.complete", ok: allOk, tests });
  console.log("[xtream] endpoint test complete", { ok: allOk, tests });
  if (!allOk) {
    console.error("[xtream] See logs/xtream-sync.jsonl for full request/response payloads.");
  }
  return { ok: allOk, tests };
}

async function main() {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--test-endpoints")) {
      const result = await testAllEndpoints();
      process.exit(result.ok ? 0 : 1);
    }
    if (args.includes("--sync")) {
      const result = await runSync();
      process.exit(result.ok ? 0 : 1);
    }
    console.log("Usage: node jobs/xtreamSyncJob.js --sync | --test-endpoints");
    process.exit(1);
  } catch (e) {
    await logXtreamSyncEvent({
      type: "job_error",
      error: e.message,
      stack: e.stack,
    });
    console.error("[xtream] job failed:", e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSync, testAllEndpoints };
