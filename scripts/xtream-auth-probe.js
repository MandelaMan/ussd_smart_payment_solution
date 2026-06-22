#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Billing-doc API probe — run on the PANEL SERVER (api.php is internal only).
 *   yarn xtream:auth-probe
 */
require("dotenv").config();

const {
  getBaseUrl,
  getApiUrl,
  readDeveloperPair,
  buildDocQuery,
  buildFullEndpoint,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const dev = readDeveloperPair();

  console.log("=== Xtream API probe (billing documentation) ===");
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

  const logUrl = buildFullEndpoint(getApiUrl(), buildDocQuery("bouquet", "get", {}, dev));
  console.log("\nRequest URL (password redacted in logs):");
  console.log(logUrl);

  console.log("\nRun on panel server (localhost):");
  console.log(
    `curl -sS "${getApiUrl()}?action=bouquet&sub=get&developer_username=${encodeURIComponent(dev.developer_username)}&developer_password=YOUR_PASS"`
  );

  const res = await getBouquets();
  const len = res.diagnostics?.responseBodyLength ?? 0;

  console.log(`\nhttp=${res.httpStatus} bodyLength=${len} ok=${res.ok}`);
  console.log(`detail: ${describeApiResult(res)}`);
  if (len > 0) console.log(`response: ${JSON.stringify(res.data).slice(0, 500)}`);

  if (res.ok) {
    console.log("\n✅ bouquet_get succeeded");
    process.exit(0);
  }

  console.log("\n❌ Failed.");
  console.log("  • Same droplet + Tailscale: use panel Tailscale IP, not 127.0.0.1");
  console.log("    XTREAM_BASE_URL=http://100.121.223.62:25500/");
  console.log("  • Check listener: ss -tlnp | grep 25500");
  console.log("  • Quote URLs in shell: curl -sS \"http://...\"");
  console.log("  • Confirm developer_username / developer_password");
  process.exit(1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
