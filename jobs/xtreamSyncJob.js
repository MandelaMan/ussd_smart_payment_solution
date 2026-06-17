#!/usr/bin/env node
"use strict";
/**
 * Xtream UI R22 provisioning job.
 *
 * Usage:
 *   node jobs/xtreamSyncJob.js                 # endpoint tests + customer sync (default)
 *   node jobs/xtreamSyncJob.js --test-endpoints  # API endpoint tests only
 *   node jobs/xtreamSyncJob.js --sync            # customer sync only
 *
 * Customer source: config/xtream-test-customers.json (Zoho/TISP hooks reserved for later).
 */
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const {
  getXtreamConfig,
  getBouquets,
  createUser,
  editUser,
  disableUser,
  enableUser,
  randomPassword,
  sanitizeUsername,
  futureExpDate,
  isUsernameExistsError,
  isUserNotFoundError,
} = require("../api/services/xtream/xtreamClient");
const { appendJsonLine } = require("../api/utils/appendJsonLine");

const LOG_FILE = path.join(__dirname, "..", "logs", "xtream-sync.jsonl");
const DEFAULT_CONFIG = path.join(
  __dirname,
  "..",
  "config",
  "xtream-test-customers.json"
);

const args = new Set(process.argv.slice(2));
const onlyTest = args.has("--test-endpoints");
const onlySync = args.has("--sync");
const runAll = args.has("--all") || (!onlyTest && !onlySync);
const runEndpointTests = runAll || onlyTest;
const runCustomerSync = runAll || onlySync;

async function logEvent(entry) {
  await appendJsonLine(LOG_FILE, {
    loggedAt: new Date().toISOString(),
    ...entry,
  });
}

async function loadTestCustomersConfig() {
  const configPath =
    process.env.XTREAM_CUSTOMERS_CONFIG ||
    process.env.XTREAM_TEST_CUSTOMERS_CONFIG ||
    DEFAULT_CONFIG;
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const customers = Array.isArray(parsed?.customers) ? parsed.customers : [];
  const defaults = parsed?.defaults || {};
  return { configPath, customers, defaults };
}

/**
 * Future hook: merge Zoho Books + TISP billing customers.
 * For now returns only test config customers.
 */
async function loadCustomersForSync() {
  const fromConfig = await loadTestCustomersConfig();
  return {
    source: "config",
    ...fromConfig,
  };
}

function pickBouquet(customer, defaults, bouquetCatalog) {
  const configured = customer.isDstvCustomer
    ? defaults.bouquet_dstv
    : defaults.bouquet_iptv;
  if (Array.isArray(configured) && configured.length) return configured;
  const first = bouquetCatalog?.[0]?.id;
  return first != null ? [Number(first)] : [1];
}

function buildXtreamProfile(customer, defaults, bouquetCatalog) {
  const username = sanitizeUsername(customer.customer_number);
  const password = customer.password || randomPassword(10);
  const max_connections = Number(
    customer.max_connections ?? defaults.max_connections ?? 1
  );
  const subscription_days = Number(
    customer.subscription_days ?? defaults.subscription_days ?? 30
  );
  const bouquet = pickBouquet(customer, defaults, bouquetCatalog);
  const exp_date = customer.isActive
    ? futureExpDate(subscription_days)
    : Math.floor(Date.now() / 1000) - 3600;

  return {
    username,
    password,
    max_connections,
    exp_date,
    bouquet,
    apartment: customer.apartment || "",
    customer_number: customer.customer_number,
    isActive: Boolean(customer.isActive),
    isDstvCustomer: Boolean(customer.isDstvCustomer),
  };
}

async function recordEndpointResult(name, result, extra = {}) {
  const row = {
    type: "endpoint_test",
    endpoint: name,
    ok: result.ok,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    contentType: result.contentType,
    emptyBody: result.emptyBody,
    rawBody: result.rawBody,
    response: result.body,
    requestUrl: result.requestUrl,
    httpMethod: result.httpMethod,
    ...extra,
  };
  console.log(
    `[xtream:test] ${name}: ${result.ok ? "OK" : "FAIL"} (${result.httpStatus})`
  );
  await logEvent(row);
  return row;
}

async function testAllEndpoints(cfg, sampleUsername) {
  const summary = [];
  const username =
    sampleUsername ||
    process.env.XTREAM_TEST_USERNAME ||
    "et_sync_probe_user";

  const bouquetsRes = await getBouquets(cfg);
  summary.push(await recordEndpointResult("bouquet.get", bouquetsRes));

  let bouquetIds = [1];
  const list = bouquetsRes.body;
  if (Array.isArray(list) && list[0]?.id != null) {
    bouquetIds = [Number(list[0].id)];
  }

  const probePassword = randomPassword(10);
  const exp = futureExpDate(7);

  const createRes = await createUser(
    {
      username,
      password: probePassword,
      max_connections: 1,
      exp_date: exp,
      bouquet: bouquetIds,
    },
    cfg
  );
  summary.push(
    await recordEndpointResult("user.create", createRes, { username })
  );

  if (!createRes.ok && !isUsernameExistsError(createRes.body)) {
    return { summary, aborted: true };
  }

  const editRes = await editUser(
    {
      username,
      exp_date: futureExpDate(14),
      bouquet: bouquetIds,
      max_connections: 1,
    },
    cfg
  );
  summary.push(await recordEndpointResult("user.edit", editRes, { username }));

  const disableRes = await disableUser(username, cfg);
  summary.push(
    await recordEndpointResult("user.disable", disableRes, { username })
  );

  const enableRes = await enableUser(username, cfg);
  summary.push(
    await recordEndpointResult("user.enable", enableRes, { username })
  );

  return { summary, aborted: false };
}

async function provisionCustomer(profile, cfg) {
  const { username, isActive } = profile;

  if (!isActive) {
    const disableRes = await disableUser(username, cfg);
    if (disableRes.ok || isUserNotFoundError(disableRes.body)) {
    return {
      customer_number: profile.customer_number,
      username,
      action: "disabled",
      ok: true,
      response: disableRes.body,
      httpStatus: disableRes.httpStatus,
      contentType: disableRes.contentType,
      emptyBody: disableRes.emptyBody,
      rawBody: disableRes.rawBody,
    };
    }
    return {
      customer_number: profile.customer_number,
      username,
      action: "disable_failed",
      ok: false,
      response: disableRes.body,
      httpStatus: disableRes.httpStatus,
      contentType: disableRes.contentType,
      emptyBody: disableRes.emptyBody,
      rawBody: disableRes.rawBody,
    };
  }

  const createRes = await createUser(profile, cfg);
  if (createRes.ok) {
    return {
      customer_number: profile.customer_number,
      username,
      action: "created",
      ok: true,
      password: profile.password,
      response: createRes.body,
      httpStatus: createRes.httpStatus,
      contentType: createRes.contentType,
      emptyBody: createRes.emptyBody,
      rawBody: createRes.rawBody,
    };
  }

  if (isUsernameExistsError(createRes.body)) {
    const editRes = await editUser(
      {
        username,
        exp_date: profile.exp_date,
        bouquet: profile.bouquet,
        max_connections: profile.max_connections,
      },
      cfg
    );
    if (!editRes.ok) {
      return {
        customer_number: profile.customer_number,
        username,
        action: "edit_failed",
        ok: false,
        response: editRes.body,
        httpStatus: editRes.httpStatus,
        contentType: editRes.contentType,
        emptyBody: editRes.emptyBody,
        rawBody: editRes.rawBody,
      };
    }
    const enableRes = await enableUser(username, cfg);
    return {
      customer_number: profile.customer_number,
      username,
      action: "updated",
      ok: enableRes.ok || isUserNotFoundError(enableRes.body),
      response: {
        edit: editRes.body,
        enable: enableRes.body,
      },
    };
  }

  return {
    customer_number: profile.customer_number,
    username,
    action: "create_failed",
    ok: false,
    response: createRes.body,
    httpStatus: createRes.httpStatus,
    contentType: createRes.contentType,
    emptyBody: createRes.emptyBody,
    rawBody: createRes.rawBody,
  };
}

async function syncCustomers(cfg) {
  const { configPath, customers, defaults, source } =
    await loadCustomersForSync();
  console.log(
    `[xtream:sync] source=${source} config=${configPath} customers=${customers.length}`
  );

  const bouquetsRes = await getBouquets(cfg);
  const bouquetCatalog = Array.isArray(bouquetsRes.body)
    ? bouquetsRes.body
    : [];

  const results = [];
  for (const customer of customers) {
    if (!customer?.customer_number) {
      results.push({
        ok: false,
        action: "skipped",
        reason: "missing customer_number",
      });
      continue;
    }

    const profile = buildXtreamProfile(customer, defaults, bouquetCatalog);
    let outcome;
    try {
      outcome = await provisionCustomer(profile, cfg);
    } catch (err) {
      outcome = {
        customer_number: customer.customer_number,
        username: profile.username,
        action: "error",
        ok: false,
        error: err.message,
      };
    }

    results.push(outcome);
    await logEvent({
      type: "customer_sync",
      ...outcome,
      apartment: profile.apartment,
      isActive: profile.isActive,
      isDstvCustomer: profile.isDstvCustomer,
      bouquet: profile.bouquet,
      exp_date: profile.exp_date,
      contentType: outcome.contentType,
      emptyBody: outcome.emptyBody,
      rawBody: outcome.rawBody,
    });
    console.log(
      `[xtream:sync] ${customer.customer_number} -> ${outcome.username}: ${outcome.action} (${outcome.ok ? "ok" : "fail"})`
    );
  }

  const okCount = results.filter((r) => r.ok).length;
  return { total: results.length, okCount, failCount: results.length - okCount, results };
}

async function main() {
  const cfg = getXtreamConfig();
  console.log(`[xtream] base URL: ${cfg.baseUrl}${cfg.apiPath}`);

  const report = {
    startedAt: new Date().toISOString(),
    endpointTests: null,
    customerSync: null,
  };

  if (runEndpointTests) {
    report.endpointTests = await testAllEndpoints(cfg);
    const failed = report.endpointTests.summary.filter((s) => !s.ok).length;
    console.log(
      `[xtream:test] completed: ${report.endpointTests.summary.length - failed}/${report.endpointTests.summary.length} passed`
    );
  }

  if (runCustomerSync) {
    report.customerSync = await syncCustomers(cfg);
    console.log(
      `[xtream:sync] completed: ${report.customerSync.okCount}/${report.customerSync.total} succeeded`
    );
  }

  report.finishedAt = new Date().toISOString();
  await logEvent({ type: "job_summary", ...report });

  const hasFailures =
    (report.endpointTests?.summary || []).some((s) => !s.ok) ||
    (report.customerSync?.failCount || 0) > 0;

  if (hasFailures) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("[xtream] job failed:", err.message);
  await logEvent({ type: "job_error", error: err.message, stack: err.stack });
  process.exit(1);
});
