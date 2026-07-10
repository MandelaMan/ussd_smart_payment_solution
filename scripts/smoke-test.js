#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Smoke test: core modules + append-only logging (no Xtream panel credentials required).
 */
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const failures = [];
const passes = [];

function pass(name, detail) {
  passes.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  const msg = err instanceof Error ? err.message : String(err);
  failures.push({ name, msg });
  console.error(`FAIL  ${name} — ${msg}`);
}

async function testModuleLoads() {
  const modules = [
    "../api/routes/index.js",
    "../api/controllers/mpesa.controller.js",
    "../api/controllers/ussd.controller.js",
    "../api/controllers/tisp.controller.js",
    "../api/controllers/zoho.controller.js",
    "../api/utils/errorLogger.js",
    "../api/utils/appendJsonLine.js",
    "../api/utils/tispSetIspLogger.js",
    "../api/utils/xtreamSyncLogger.js",
    "../api/services/xtream/xtreamClient.js",
    "../api/services/transactionStore.js",
    "../jobs/xtreamSyncJob.js",
    "../jobs/xtreamDailyScheduler.js",
  ];
  for (const rel of modules) {
    try {
      require(path.join(__dirname, rel));
      pass(`load ${path.basename(rel)}`);
    } catch (e) {
      fail(`load ${path.basename(rel)}`, e);
    }
  }
}

async function testAppendJsonLine() {
  const { appendJsonLine, readJsonLineEntries } = require("../api/utils/appendJsonLine");
  const tmp = path.join(os.tmpdir(), `ussd-log-test-${Date.now()}.jsonl`);
  const id = `test-${Date.now()}`;
  await appendJsonLine(tmp, { id, event: "first" });
  await appendJsonLine(tmp, { id, event: "second" });
  const rows = await readJsonLineEntries(tmp);
  if (rows.length !== 2) throw new Error(`expected 2 lines, got ${rows.length}`);
  if (rows[0].event !== "first" || rows[1].event !== "second") {
    throw new Error("append order incorrect");
  }
  await fs.unlink(tmp).catch(() => {});
  pass("appendJsonLine", "2 lines appended in order");
}

async function testXtreamSyncLogger() {
  const { logXtreamSyncEvent, LOG_FILE } = require("../api/utils/xtreamSyncLogger");
  const marker = `smoke-${Date.now()}`;
  await logXtreamSyncEvent({ event: "smoke_test", marker });
  const raw = await fs.readFile(LOG_FILE, "utf8");
  if (!raw.includes(marker)) throw new Error("marker not found in xtream-sync.jsonl");
  pass("xtreamSyncLogger", LOG_FILE);
}

async function testTispLogger() {
  const { logSetIspPaymentAttempt } = require("../api/utils/tispSetIspLogger");
  const marker = `smoke-${Date.now()}`;
  await logSetIspPaymentAttempt({ outcome: "smoke_test", marker });
  pass("tispSetIspLogger", "logged to MySQL");
}

async function testTransactionsTrail() {
  const { appendTransaction, readTransactions } = require("../api/services/transactionStore");
  const marker = `smoke-${Date.now()}`;
  await appendTransaction({
    Status: "SMOKE_TEST",
    CheckoutRequestID: marker,
    Timestamp: new Date().toISOString(),
  });
  const all = await readTransactions();
  if (!all.some((t) => t.CheckoutRequestID === marker)) {
    throw new Error("marker not found in MySQL transactions");
  }
  pass("transactions", "append + read via MySQL");
}

async function testErrorLogger() {
  const { logError, errorLogFilePath } = require("../api/utils/errorLogger");
  const marker = `smoke-${Date.now()}`;
  logError(new Error(`smoke test ${marker}`), { source: "smokeTest" });
  const raw = await fs.readFile(errorLogFilePath(), "utf8");
  if (!raw.includes(marker)) throw new Error("marker not in errors log");
  pass("errorLogger", errorLogFilePath());
}

async function testXtreamJobDryRun() {
  const { runSync } = require("../jobs/xtreamSyncJob");
  process.env.XTREAM_SYNC_ENABLED = "false";
  const result = await runSync();
  if (!result.skipped) throw new Error("expected skipped sync when disabled");
  pass("xtreamSyncJob runSync", "skipped when XTREAM_SYNC_ENABLED=false");
}

async function testXtreamShippedFilesOnly() {
  const { execSync } = require("child_process");
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const blocked = tracked.filter(
    (f) =>
      f.endsWith(".docx") ||
      f.startsWith(".tmp_xtream") ||
      f.includes("xtream_ui_r22_backend_api_document")
  );
  if (blocked.length) {
    throw new Error(`doc/temp still tracked: ${blocked.join(", ")}`);
  }
  const required = [
    "api/services/xtream/xtreamClient.js",
    "jobs/xtreamSyncJob.js",
    "jobs/xtreamDailyScheduler.js",
    "config/xtream-test-customers.json.dist",
    "config/xtream-sync.json",
    "api/utils/xtreamSyncLogger.js",
    "api/routes/xtream.routes.js",
  ];
  for (const f of required) {
    if (!tracked.includes(f)) throw new Error(`missing required xtream file: ${f}`);
  }
  pass("xtream ship list", `${required.length} required files tracked, no doc/temp`);
}

async function testMpesaInvoiceMatching() {
  const {
    findTargetOpenInvoice,
    invoiceMatchesCustomerRef,
  } = require("../api/utils/mpesaInvoiceMatching");

  const invoices = [
    {
      invoice_id: "1",
      status: "sent",
      balance: 1500,
      reference_number: "ET-ABC",
      invoice_number: "BLD-001",
    },
    {
      invoice_id: "2",
      status: "sent",
      balance: 2000,
      reference_number: "OTHER",
    },
  ];

  const byRef = findTargetOpenInvoice(invoices, "ET-ABC", 999);
  if (byRef?.invoice_id !== "1") {
    throw new Error("expected invoice matched by customer reference");
  }

  const byBalance = findTargetOpenInvoice(
    [{ invoice_id: "9", status: "overdue", balance: 500 }],
    "ET-XYZ",
    500
  );
  if (byBalance?.invoice_id !== "9") {
    throw new Error("expected invoice matched by exact balance");
  }

  const single = findTargetOpenInvoice(
    [{ invoice_id: "7", status: "sent", balance: 1200 }],
    "ET-ONE",
    800
  );
  if (single?.invoice_id !== "7") {
    throw new Error("expected single open invoice to be selected");
  }

  if (!invoiceMatchesCustomerRef({ invoice_number: "BLD-ET-99" }, "ET-99")) {
    throw new Error("expected invoice number to match customer ref");
  }

  pass("mpesaInvoiceMatching", "reference, balance, and single-invoice rules");
}

async function main() {
  console.log("=== smoke test ===\n");
  await testModuleLoads();
  await testAppendJsonLine();
  await testErrorLogger();
  await testTispLogger();
  await testXtreamSyncLogger();
  await testTransactionsTrail();
  await testXtreamJobDryRun();
  await testXtreamShippedFilesOnly();
  await testMpesaInvoiceMatching();
  console.log(`\n=== done: ${passes.length} passed, ${failures.length} failed ===`);
  if (failures.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
