#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live probe for Xtream UI R22F (classic v2 api.php).
 * Run on billing server: yarn xtream:auth-probe
 */
require("dotenv").config();

const http = require("http");
const https = require("https");
const axios = require("axios");
const {
  getBaseUrl,
  getApiUrl,
  getApiMode,
  readDeveloperPair,
  buildFullEndpoint,
  probeBouquetR22f,
  probeBouquetBilling,
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

async function tryMode(label, fn) {
  const res = await fn();
  const len = res.diagnostics?.responseBodyLength ?? 0;
  console.log(`\n[${label}] http=${res.httpStatus} bodyLength=${len} ok=${res.ok}`);
  console.log(`  detail: ${describeApiResult(res)}`);
  if (len > 0) console.log(`  response: ${JSON.stringify(res.data).slice(0, 300)}`);
  return { label, ok: res.ok, len, res };
}

async function main() {
  const dev = readDeveloperPair();
  const publicIp = await fetchOutboundPublicIp();
  const mode = getApiMode();

  console.log("=== Xtream API probe ===");
  console.log("panel:", "Xtream UI R22F — classic v2 api.php (POST + IP whitelist)");
  console.log("XTREAM_API_MODE:", mode);
  console.log("baseUrl:", getBaseUrl());
  console.log("apiUrl:", getApiUrl());
  if (publicIp) {
    console.log("\n>>> Add this IP to Xtream Settings > API IP's:", publicIp);
  }

  const r22fUrl = buildFullEndpoint(getApiUrl(), { action: "bouquet", sub: "get" });
  console.log("\nR22F bouquet_get (no developer_username — IP auth only):");
  console.log(r22fUrl);

  console.log("\nManual curl (R22F — correct for your panel):");
  console.log(`curl -sS "${getApiUrl()}?action=bouquet&sub=get" | head -c 400`);

  if (dev.developer_username) {
    const billingUrl = buildFullEndpoint(getApiUrl(), {
      action: "bouquet",
      sub: "get",
      developer_username: dev.developer_username,
      developer_password: "[redacted]",
    });
    console.log("\nBilling-doc style (NOT used by R22F — for comparison only):");
    console.log(billingUrl);
  }

  const results = [];
  results.push(await tryMode("r22f GET bouquet (default)", probeBouquetR22f));

  if (dev.developer_username && dev.developer_password) {
    results.push(await tryMode("billing GET + developer_*", probeBouquetBilling));
  }

  const winner = results.find((r) => r.ok);
  if (winner) {
    console.log(`\n✅ Working mode: ${winner.label}`);
    if (winner.label.startsWith("r22f")) {
      console.log("Set in .env: XTREAM_API_MODE=r22f");
    } else {
      console.log("Set in .env: XTREAM_API_MODE=billing");
    }
    process.exit(0);
  }

  const r22f = results[0]?.res;
  if (r22f && (r22f.diagnostics?.responseBodyLength ?? 0) === 0) {
    try {
      const raw = await httpGet(`${getApiUrl()}?action=bouquet&sub=get`);
      console.log(`\n[node http] http=${raw.status} bodyLength=${raw.body.length}`);
      if (raw.body) console.log(`  body: ${raw.body.slice(0, 300)}`);
    } catch (e) {
      console.log(`\n[node http] ${e.message}`);
    }
  }

  console.log("\n❌ All modes failed.");
  console.log("R22F checklist:");
  console.log("  1. Settings > API IP's — add droplet public IP" + (publicIp ? ` (${publicIp})` : ""));
  console.log("  2. XTREAM_API_MODE=r22f (default) — do NOT use developer_username curl");
  console.log("  3. user create uses POST with user_data[], not GET");
  process.exit(1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
