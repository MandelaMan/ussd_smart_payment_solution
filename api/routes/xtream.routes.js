const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const { getBaseUrl, getApiUrl } = require("../services/xtream/xtreamClient");

const router = express.Router();

function runJobScript(extraArgs = []) {
  const script = path.resolve(__dirname, "../../jobs/xtreamSyncJob.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...extraArgs], {
      cwd: path.resolve(__dirname, "../.."),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on("error", reject);
  });
}

router.get("/status", (_req, res) => {
  res.json({
    ok: true,
    baseUrl: getBaseUrl(),
    apiUrl: getApiUrl(),
    syncEnabled: String(process.env.XTREAM_SYNC_ENABLED || "true").toLowerCase() !== "false",
    customerSource: "config/xtream-test-customers.json",
    futureSources: ["zoho", "tisp"],
  });
});

router.post("/sync", async (_req, res) => {
  try {
    const result = await runJobScript(["--sync"]);
    res.status(result.code === 0 ? 200 : 500).json({
      ok: result.code === 0,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/test-endpoints", async (_req, res) => {
  try {
    const result = await runJobScript(["--test-endpoints"]);
    res.status(result.code === 0 ? 200 : 500).json({
      ok: result.code === 0,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
