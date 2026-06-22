#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const {
  getApiUrl,
  getApiMode,
  readDeveloperPair,
  hasDeveloperCreds,
  buildFullEndpoint,
  buildBillingQuery,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const dev = readDeveloperPair();
  console.log("=== Xtream API probe ===");
  console.log("mode:", getApiMode());
  console.log("apiUrl:", getApiUrl());
  console.log("developer creds:", hasDeveloperCreds() ? "set" : "not set");

  if (hasDeveloperCreds()) {
    console.log("\nBilling URL:", buildFullEndpoint(getApiUrl(), buildBillingQuery("bouquet", "get", {}, dev)));
  }
  console.log("V2 URL:", buildFullEndpoint(getApiUrl(), { action: "bouquet", sub: "get" }));

  const res = await getBouquets();
  console.log(`\nhttp=${res.httpStatus} bodyLength=${res.diagnostics?.responseBodyLength} ok=${res.ok}`);
  console.log("transport:", res.diagnostics?.usedTransport || res.diagnostics?.transport);
  console.log("detail:", describeApiResult(res));
  if (res.diagnostics?.responseBodyLength > 0) {
    console.log("response:", JSON.stringify(res.data).slice(0, 500));
  }

  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
