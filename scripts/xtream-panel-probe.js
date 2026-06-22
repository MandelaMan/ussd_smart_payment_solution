#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const {
  getBaseUrl,
  getApiUrl,
  getDeveloperCredentials,
  getBouquets,
  createSubscriptionLine,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const base = getBaseUrl();
  const creds = getDeveloperCredentials();

  console.log("=== Xtream panel probe ===");
  console.log("baseUrl:", base);
  console.log("apiUrl:", getApiUrl());
  console.log("developer_username:", creds.developer_username);
  console.log(
    "developer_password:",
    creds.developer_password ? `[set, length ${creds.developer_password.length}]` : "[MISSING]"
  );

  console.log("\n--- bouquet_get (GET) ---");
  const bouquetRes = await getBouquets();
  console.log("ok:", bouquetRes.ok, "http:", bouquetRes.httpStatus);
  console.log("bodyLength:", bouquetRes.diagnostics?.responseBodyLength);
  console.log("detail:", describeApiResult(bouquetRes));
  console.log("response:", JSON.stringify(bouquetRes.data).slice(0, 400));

  if (!bouquetRes.ok) {
    console.log("\nFix bouquet_get before create can work.");
    process.exit(1);
  }

  console.log("\n--- user_create (GET per billing doc) ---");
  const sampleUser = `probe_${Date.now().toString(36)}`;
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  const createRes = await createSubscriptionLine({
    username: sampleUser,
    password: `T${Math.random().toString(36).slice(2, 10)}`,
    max_connections: 1,
    exp_date: exp,
    bouquet: [1],
  });
  console.log("ok:", createRes.ok, "http:", createRes.httpStatus);
  console.log("method:", createRes.diagnostics?.method);
  console.log("bodyLength:", createRes.diagnostics?.responseBodyLength);
  console.log("detail:", describeApiResult(createRes));
  console.log("endpoint (log):", createRes.endpoint);
  console.log("response:", JSON.stringify(createRes.data).slice(0, 400));

  process.exit(createRes.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
