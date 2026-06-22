#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live bouquet_get probe — run on the billing server (droplet):
 *   yarn xtream:auth-probe
 */
require("dotenv").config();

const http = require("http");
const https = require("https");
const axios = require("axios");
const {
  getBaseUrl,
  getApiUrl,
  readDeveloperPair,
  buildDocQuery,
  buildFullEndpoint,
  buildRequestUrl,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function fetchOutboundPublicIp() {
  try {
    const { data } = await axios.get("https://api.ipify.org?format=json", { timeout: 8000 });
    return data?.ip || null;
  } catch {
    return null;
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: 20000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("native http timeout"));
    });
  });
}

async function main() {
  const dev = readDeveloperPair();
  const publicIp = await fetchOutboundPublicIp();

  console.log("=== Xtream API probe (billing doc) ===");
  console.log("baseUrl:", getBaseUrl());
  console.log("apiUrl:", getApiUrl());
  console.log("developer_username:", dev.developer_username || "(not set)");
  console.log(
    "developer_password:",
    dev.developer_password ? `[set, length ${dev.developer_password.length}]` : "(not set)"
  );
  if (publicIp) {
    console.log("\n>>> Whitelist this IP in Xtream Settings > API IP's:", publicIp);
  } else {
    console.log("\n>>> Could not detect public IP — run: curl -s https://api.ipify.org");
  }

  if (!dev.developer_username || !dev.developer_password) {
    console.error("\nSet XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD in .env");
    process.exit(1);
  }

  if (dev.developer_username === dev.developer_password) {
    console.log(
      "\n⚠️  username and password are identical — confirm .env password is your panel admin password, not duplicated username."
    );
  }

  const sampleQuery = buildDocQuery("bouquet", "get", {}, dev);
  const liveUrl = buildRequestUrl(getApiUrl(), sampleQuery);
  const logUrl = buildFullEndpoint(getApiUrl(), sampleQuery);

  console.log("\nLive query params:");
  console.log("  action=bouquet sub=get");
  console.log(`  developer_username=${dev.developer_username}`);
  console.log(`  developer_password=[length ${dev.developer_password.length}]`);
  console.log("\nLog URL (password redacted):");
  console.log(logUrl);
  console.log("\nManual curl (replace YOUR_PASS):");
  console.log(
    `curl -sS "${getApiUrl()}?action=bouquet&sub=get&developer_username=${encodeURIComponent(dev.developer_username)}&developer_password=YOUR_PASS" | head -c 400`
  );

  const res = await getBouquets();
  const len = res.diagnostics?.responseBodyLength ?? 0;

  console.log(`\n[axios] http=${res.httpStatus} bodyLength=${len} ok=${res.ok}`);
  console.log(`[axios] content-type: ${res.diagnostics?.contentType || "(none)"}`);
  console.log(`[axios] detail: ${describeApiResult(res)}`);

  if (len === 0) {
    try {
      const raw = await httpGet(liveUrl);
      console.log(`\n[node http] http=${raw.status} bodyLength=${raw.body.length}`);
      console.log(`[node http] content-type: ${raw.headers["content-type"] || "(none)"}`);
      console.log(`[node http] content-length: ${raw.headers["content-length"] || "(none)"}`);
      if (raw.body.length > 0) {
        console.log(`[node http] body preview: ${raw.body.slice(0, 400)}`);
      }
    } catch (e) {
      console.log(`\n[node http] failed: ${e.message}`);
    }
  } else {
    console.log(`response: ${JSON.stringify(res.data).slice(0, 500)}`);
  }

  if (res.ok) {
    console.log("\n✅ bouquet_get succeeded");
    process.exit(0);
  }

  console.log("\n❌ bouquet_get failed — panel returned HTTP 200 with empty body usually means:");
  console.log("  1. Billing server IP is NOT in Settings > API IP's (most common)");
  if (publicIp) console.log(`     → Add: ${publicIp}`);
  console.log("  2. Wrong admin password in .env (web login password for user 'admin')");
  console.log("  3. Port 25500 blocked by firewall on the panel host");
  process.exit(1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
