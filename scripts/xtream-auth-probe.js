#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live bouquet_get probe using billing-doc auth (developer_username/password).
 * Run on the droplet: yarn xtream:auth-probe
 */
require("dotenv").config();

const {
  getBaseUrl,
  getApiUrl,
  readDeveloperPair,
  buildDocQuery,
  buildRequestUrl,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const dev = readDeveloperPair();

  console.log("=== Xtream API probe (billing doc) ===");
  console.log("baseUrl:", getBaseUrl());
  console.log("apiUrl:", getApiUrl());
  console.log("developer_username:", dev.developer_username || "(not set)");
  console.log(
    "developer_password:",
    dev.developer_password ? `[set, length ${dev.developer_password.length}]` : "(not set)"
  );

  if (!dev.developer_username || !dev.developer_password) {
    console.error("\nSet XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD in .env");
    process.exit(1);
  }

  const sampleQuery = buildDocQuery("bouquet", "get", {}, dev);
  const sampleUrl = buildRequestUrl(getApiUrl(), sampleQuery);
  console.log("\nRequest format (password redacted in logs only):");
  console.log(
    sampleUrl.replace(
      encodeURIComponent(dev.developer_password),
      "[password]"
    )
  );

  const res = await getBouquets();
  const len = res.diagnostics?.responseBodyLength ?? 0;

  console.log(`\nhttp=${res.httpStatus} bodyLength=${len} ok=${res.ok}`);
  console.log(`detail: ${describeApiResult(res)}`);
  if (len > 0) console.log(`response: ${JSON.stringify(res.data).slice(0, 500)}`);

  if (res.ok) {
    console.log("\n✅ bouquet_get succeeded with developer_username/password");
    process.exit(0);
  }

  console.log("\n❌ bouquet_get failed. Per API doc troubleshooting:");
  console.log("- Confirm API enabled under Settings > General");
  console.log("- Confirm developer_username/developer_password are gateway credentials");
  console.log("- Whitelist billing server public IP on panel port 25500");
  process.exit(1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
