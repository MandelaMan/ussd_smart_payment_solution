#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone Xtream test sync — does not touch M-Pesa / Zoho / TISP.
 * Config: config/xtream-test-customers.json (or XTREAM_CUSTOMERS_CONFIG)
 */
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const {
  getBaseUrl,
  getBouquets,
  createUser,
  editUser,
  disableUser,
  enableUser,
  getDeveloperCredentials,
  describeApiResult,
  sanitizeUsername,
  randomPassword,
  futureExpDate,
  isUsernameExistsError,
} = require("../api/services/xtream/xtreamClient");
const { logXtreamSyncEvent } = require("../api/utils/xtreamSyncLogger");

const ROOT = path.resolve(__dirname, "..");
const SYNC_CONFIG_FILE = path.join(ROOT, "config", "xtream-sync.json");
const TEST_CUSTOMERS_FILE =
  process.env.XTREAM_CUSTOMERS_CONFIG ||
  process.env.XTREAM_TEST_CUSTOMERS_FILE ||
  path.join(ROOT, "config", "xtream-test-customers.json");
const CUSTOMER_MAP_FILE = path.join(ROOT, "logs", "xtream-customer-map.json");

function syncEnabled() {
  return String(process.env.XTREAM_SYNC_ENABLED || "true").toLowerCase() !== "false";
}

function apiLogPayload(res, extra = {}) {
  return {
    ...extra,
    endpoint: res.endpoint || res.request?.endpoint,
    ok: res.ok,
    httpStatus: res.httpStatus,
    diagnostics: res.diagnostics,
    response: res.body || res.data,
    request: res.request,
    durationMs: res.durationMs,
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
    endpointTest: { enabled: true, sampleUsernamePrefix: "xtream_api_test_" },
  });
}

async function loadTestConfig() {
  const parsed = await readJsonFile(TEST_CUSTOMERS_FILE, null);
  if (!parsed || !Array.isArray(parsed.customers)) {
    throw new Error(
      `Missing or invalid config at ${TEST_CUSTOMERS_FILE}. See config/xtream-test-customers.json.dist`
    );
  }
  return {
    defaults: parsed.defaults || {
      max_connections: 1,
      subscription_days: 30,
      bouquet_iptv: [1],
      bouquet_dstv: [4],
    },
    customers: parsed.customers,
  };
}

/** Resolve customer row — supports original format (isActive/isDstvCustomer) and legacy (active/bouquet key). */
function resolveCustomerRow(customer, defaults, syncConfig) {
  const customerNumber = String(customer.customer_number || "").trim();
  const active =
    customer.isActive != null ? Boolean(customer.isActive) : customer.active !== false;

  let bouquet;
  if (customer.bouquet && syncConfig.bouquets) {
    const key = String(customer.bouquet).trim();
    bouquet = syncConfig.bouquets[key] || syncConfig.bouquets.default || defaults.bouquet_iptv || [1];
  } else if (customer.isDstvCustomer) {
    bouquet = defaults.bouquet_dstv || [4];
  } else {
    bouquet = defaults.bouquet_iptv || [1];
  }

  const username =
    customer.xtream_username ||
    (customer.apartment_number
      ? String(customer.apartment_number).trim().replace(/\s+/g, "").toUpperCase()
      : sanitizeUsername(customerNumber));

  const maxConnections = Number(
    customer.max_connections || defaults.max_connections || 1
  );
  const subscriptionDays = Number(
    customer.subscription_days || defaults.subscription_days || 30
  );

  return {
    customerNumber,
    active,
    bouquet: Array.isArray(bouquet) ? bouquet : [bouquet],
    username,
    maxConnections,
    expDate: futureExpDate(subscriptionDays),
    apartment: customer.apartment || customer.apartment_number || null,
    password: customer.password ? String(customer.password) : null,
  };
}

async function syncOneCustomer(customer, defaults, syncConfig, map) {
  const row = resolveCustomerRow(customer, defaults, syncConfig);
  const mapped = map[row.customerNumber];

  if (!row.active) {
    if (!mapped?.username) {
      await logXtreamSyncEvent({
        event: "sync_skip",
        customer_number: row.customerNumber,
        reason: "inactive_no_xtream_account",
      });
      return { customer_number: row.customerNumber, action: "skip", success: true };
    }
    const res = await disableUser(mapped.username);
    await logXtreamSyncEvent(
      apiLogPayload(res, {
        event: "customer.disable",
        customer_number: row.customerNumber,
        username: mapped.username,
      })
    );
    if (res.ok) {
      map[row.customerNumber] = { ...mapped, disabledAt: new Date().toISOString() };
    }
    return {
      customer_number: row.customerNumber,
      action: "disable",
      success: res.ok,
      error: res.ok ? undefined : JSON.stringify(res.body),
    };
  }

  const password = row.password || mapped?.password || randomPassword();
  let username = mapped?.username || row.username;

  if (!mapped?.username) {
    let res = await createUser({
      username,
      password,
      max_connections: row.maxConnections,
      exp_date: row.expDate,
      bouquet: row.bouquet,
    });

    if (!res.ok && isUsernameExistsError(res.body)) {
      username = `${row.username}_${Date.now().toString(36).slice(-4)}`;
      res = await createUser({
        username,
        password,
        max_connections: row.maxConnections,
        exp_date: row.expDate,
        bouquet: row.bouquet,
      });
    }

    await logXtreamSyncEvent(
      apiLogPayload(res, {
        event: "customer.create",
        customer_number: row.customerNumber,
        username,
      })
    );

    if (res.ok) {
      map[row.customerNumber] = {
        username,
        password,
        apartment: row.apartment,
        createdAt: new Date().toISOString(),
        exp_date: row.expDate,
        bouquet: row.bouquet,
      };
      return { customer_number: row.customerNumber, action: "create", success: true };
    }
    return {
      customer_number: row.customerNumber,
      action: "create",
      success: false,
      error: JSON.stringify(res.body),
    };
  }

  const account = map[row.customerNumber];

  if (account.disabledAt) {
    const enableRes = await enableUser(account.username);
    await logXtreamSyncEvent(
      apiLogPayload(enableRes, {
        event: "customer.enable",
        customer_number: row.customerNumber,
        username: account.username,
      })
    );
    if (!enableRes.ok) {
      return {
        customer_number: row.customerNumber,
        action: "enable",
        success: false,
        error: JSON.stringify(enableRes.body),
      };
    }
    delete map[row.customerNumber].disabledAt;
  }

  const res = await editUser({
    username: account.username,
    exp_date: row.expDate,
    bouquet: row.bouquet,
    max_connections: row.maxConnections,
  });
  await logXtreamSyncEvent(
    apiLogPayload(res, {
      event: "customer.renew",
      customer_number: row.customerNumber,
      username: account.username,
    })
  );
  if (res.ok) {
    map[row.customerNumber] = {
      ...account,
      exp_date: row.expDate,
      bouquet: row.bouquet,
      renewedAt: new Date().toISOString(),
    };
    return { customer_number: row.customerNumber, action: "renew", success: true };
  }
  return {
    customer_number: row.customerNumber,
    action: "renew",
    success: false,
    error: JSON.stringify(res.body),
  };
}

async function runSync() {
  if (!syncEnabled()) {
    console.log("[xtream] sync disabled via XTREAM_SYNC_ENABLED");
    await logXtreamSyncEvent({ event: "sync.skipped", reason: "XTREAM_SYNC_ENABLED=false" });
    return { ok: true, skipped: true };
  }

  const { defaults, customers } = await loadTestConfig();
  const syncConfig = await loadSyncConfig();
  const map = await readJsonFile(CUSTOMER_MAP_FILE, {});

  await logXtreamSyncEvent({
    event: "sync.start",
    customerCount: customers.length,
    source: TEST_CUSTOMERS_FILE,
    baseUrl: getBaseUrl(),
  });

  const results = [];
  for (const customer of customers) {
    try {
      results.push(await syncOneCustomer(customer, defaults, syncConfig, map));
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
  getDeveloperCredentials();
  const syncConfig = await loadSyncConfig();
  const probeUser =
    process.env.XTREAM_TEST_USERNAME ||
    `${syncConfig.endpointTest?.sampleUsernamePrefix || "xtream_api_test_"}${Date.now().toString(36)}`;
  const probePass = randomPassword(10);
  const expDate = futureExpDate(30);
  const bouquet = [1];

  await logXtreamSyncEvent({ event: "endpoint_test.start", baseUrl: getBaseUrl() });

  const bouquetRes = await getBouquets();
  const bouquetDetail = describeApiResult(bouquetRes);
  await logXtreamSyncEvent(
    apiLogPayload(bouquetRes, { event: "endpoint_test.bouquet_get", detail: bouquetDetail })
  );

  const tests = [{ name: "bouquet_get", ok: bouquetRes.ok, detail: bouquetDetail, endpoint: bouquetRes.endpoint }];
  let allOk = bouquetRes.ok;

  if (!bouquetRes.ok) {
    console.error(`[xtream] bouquet_get FAILED: ${bouquetDetail}`);
  } else if (syncConfig.endpointTest?.enabled !== false) {
    const createRes = await createUser({
      username: probeUser,
      password: probePass,
      max_connections: 1,
      exp_date: expDate,
      bouquet,
    });
    tests.push({
      name: "user_create",
      ok: createRes.ok,
      detail: describeApiResult(createRes),
      endpoint: createRes.endpoint,
    });
    allOk = allOk && createRes.ok;

    if (createRes.ok) {
      const steps = [
        ["user_edit", () => editUser({ username: probeUser, exp_date: expDate + 86400, bouquet })],
        ["user_disable", () => disableUser(probeUser)],
        ["user_enable", () => enableUser(probeUser)],
      ];
      for (const [name, run] of steps) {
        const res = await run();
        tests.push({ name, ok: res.ok, endpoint: res.endpoint });
        allOk = allOk && res.ok;
        await logXtreamSyncEvent(
          apiLogPayload(res, { event: `endpoint_test.${name}`, username: probeUser })
        );
      }
    }
  }

  await logXtreamSyncEvent({ event: "endpoint_test.complete", ok: allOk, tests });
  console.log("[xtream] endpoint test complete", { ok: allOk, tests });
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
    await logXtreamSyncEvent({ type: "job_error", error: e.message, stack: e.stack });
    console.error("[xtream] job failed:", e.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runSync, testAllEndpoints };
