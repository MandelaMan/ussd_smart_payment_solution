#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live panel connectivity check (no subscription changes).
 * Run on the same host that will call the Xtream API (e.g. the billing server).
 */
require("dotenv").config();
const { getBaseUrl, pingApi, getDeveloperCredentials } = require("../api/services/xtream/xtreamClient");

async function main() {
  const baseUrl = getBaseUrl();
  let creds;
  try {
    creds = getDeveloperCredentials();
  } catch (e) {
    console.error("[xtream-check] " + e.message);
    process.exit(1);
  }

  console.log("[xtream-check] baseUrl:", baseUrl);
  console.log("[xtream-check] admin_username:", creds.developer_username);
  console.log("[xtream-check] password set:", creds.developer_password.length > 0);

  const res = await pingApi();
  const bodyLength = res.diagnostics?.responseBodyLength ?? 0;
  const preview =
    res.data && Array.isArray(res.data)
      ? JSON.stringify(res.data).slice(0, 120)
      : JSON.stringify(res.data || "").slice(0, 120);

  console.log(
    `[xtream-check] server&sub=list: http=${res.httpStatus} bodyLength=${bodyLength} ok=${res.ok}`
  );
  if (bodyLength > 0) {
    console.log(`[xtream-check] preview: ${preview}`);
  }

  if (res.ok) {
    console.log("[xtream-check] Panel API reachable — run: yarn xtream:test");
    process.exit(0);
  }

  const detail = res.data?.error || res.data?.[0] || res.data?.message || "unknown error";
  console.error("\n[xtream-check] Panel API check failed.");
  console.error("[xtream-check] Detail:", detail);
  console.error("[xtream-check] Fix on Xtream server:");
  console.error("  1. XTREAM_BASE_URL must use streaming port 25461 (not admin 25500)");
  console.error("  2. Settings → API IP's — whitelist this billing server's IP (e.g. 100.120.188.75)");
  console.error("  3. Use a single IP in api_ips on this panel build (no comma-separated list)");
  console.error("  4. Re-test: curl -4 -sS \"http://PANEL:25461/api.php?action=server&sub=list\"");
  process.exit(1);
}

main().catch((e) => {
  console.error("[xtream-check] failed:", e.message);
  process.exit(1);
});
