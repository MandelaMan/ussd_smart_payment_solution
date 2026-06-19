#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone daily scheduler — does not modify the main Express app.
 * Run: node jobs/xtreamDailyScheduler.js
 * Or once: node jobs/xtreamDailyScheduler.js --once
 */
require("dotenv").config();

const { spawnSync } = require("child_process");
const path = require("path");

const INTERVAL_MS = Number(
  process.env.XTREAM_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000
);
const JOB_SCRIPT = path.join(__dirname, "xtreamSyncJob.js");
const ROOT = path.join(__dirname, "..");

function runSyncJob() {
  console.log(`[xtream-daily] running sync at ${new Date().toISOString()}`);
  const result = spawnSync(process.execPath, [JOB_SCRIPT, "--sync"], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  console.log(`[xtream-daily] sync exit code ${result.status}`);
  return result.status === 0;
}

if (require.main === module) {
  if (process.argv.includes("--once")) {
    process.exit(runSyncJob() ? 0 : 1);
  }

  runSyncJob();
  setInterval(runSyncJob, INTERVAL_MS);
  console.log(
    `[xtream-daily] scheduler started; interval ${INTERVAL_MS}ms (${INTERVAL_MS / 3600000}h)`
  );
}

module.exports = { runSyncJob, INTERVAL_MS };
