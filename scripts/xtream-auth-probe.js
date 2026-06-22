#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const {
  getXtreamConfig,
  getApiUrl,
  readDeveloperPair,
  buildFullEndpoint,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const cfg = getXtreamConfig();
  const dev = readDeveloperPair();

  console.log("=== Xtream API probe ===");
  console.log("baseUrl:", cfg.baseUrl);
  console.log("apiUrl:", getApiUrl(cfg));
  console.log("developer_username:", dev.developer_username || "(not set)");

  if (!dev.developer_username || !dev.developer_password) {
    console.error("\nSet XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD in .env");
    process.exit(1);
  }

  const query = {
    developer_username: dev.developer_username,
    developer_password: dev.developer_password,
    action: "bouquet",
    sub: "get",
  };
  console.log("\nLog URL:");
  console.log(buildFullEndpoint(cfg, query));

  const res = await getBouquets(cfg);
  console.log(`\nhttp=${res.httpStatus} ok=${res.ok} durationMs=${res.durationMs}`);
  console.log("detail:", describeApiResult(res));
  if (res.diagnostics?.responseBodyLength > 0) {
    console.log("response:", JSON.stringify(res.body).slice(0, 500));
  }

  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
