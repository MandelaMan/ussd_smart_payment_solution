#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Billing-doc API probe + fallbacks to diagnose R22F on same droplet (Tailscale).
 *   yarn xtream:auth-probe
 */
require("dotenv").config();

const axios = require("axios");
const {
  getBaseUrl,
  getApiUrl,
  readDeveloperPair,
  buildDocQuery,
  buildRequestUrl,
  buildFullEndpoint,
  getBouquets,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function rawGet(label, url) {
  try {
    const res = await axios({
      method: "GET",
      url,
      timeout: 20000,
      validateStatus: () => true,
      transformResponse: [(r) => r],
    });
    const body = res.data == null ? "" : String(res.data);
    console.log(`\n[${label}] http=${res.status} bodyLength=${body.length}`);
    console.log(`  content-type: ${res.headers["content-type"] || "(none)"}`);
    if (body.length > 0) console.log(`  body: ${body.slice(0, 400)}`);
    return { ok: body.length > 0, len: body.length, body };
  } catch (e) {
    console.log(`\n[${label}] ERROR: ${e.message}`);
    return { ok: false, len: 0, error: e.message };
  }
}

async function main() {
  const dev = readDeveloperPair();
  const apiUrl = getApiUrl();

  console.log("=== Xtream API probe ===");
  console.log("baseUrl:", getBaseUrl());
  console.log("apiUrl:", apiUrl);
  console.log("developer_username:", dev.developer_username || "(not set)");
  console.log(
    "developer_password:",
    dev.developer_password ? `[set, length ${dev.developer_password.length}]` : "(not set)"
  );

  if (dev.developer_username === dev.developer_password) {
    console.log("\n⚠️  username and password in .env are identical — confirm real panel admin password.");
  }

  if (!dev.developer_username || !dev.developer_password) {
    console.error("\nSet XTREAM_DEVELOPER_USERNAME and XTREAM_DEVELOPER_PASSWORD in .env");
    process.exit(1);
  }

  const liveQuery = buildDocQuery("bouquet", "get", {}, dev);
  const liveUrl = buildRequestUrl(apiUrl, liveQuery);
  const logUrl = buildFullEndpoint(apiUrl, liveQuery);

  console.log("\nLog URL (redacted — for logs only):");
  console.log(logUrl);
  console.log("\nLive request sends real password:", liveUrl.includes("[redacted]") ? "NO ❌ BUG" : "yes ✓");

  console.log("\n--- Compare response modes ---");

  await rawGet(
    "A) billing doc GET + developer_*",
    liveUrl
  );

  await rawGet(
    "B) plain GET bouquet (no developer_* — some R22F builds)",
    buildRequestUrl(apiUrl, { action: "bouquet", sub: "get" })
  );

  const res = await getBouquets();
  console.log(`\n[client getBouquets] ok=${res.ok} detail: ${describeApiResult(res)}`);

  if (res.ok) {
    console.log("\n✅ bouquet_get succeeded");
    process.exit(0);
  }

  console.log("\n❌ billing-doc bouquet_get failed (HTTP 200 + empty body is common when:");
  console.log("   • developer_username/password are wrong in .env, OR");
  console.log("   • Settings > API IP's blocks this source IP, OR");
  console.log("   • R22F build does not implement billing-doc GET auth on api.php)");
  console.log("\nNext steps on this droplet:");
  console.log("  1. curl -sS \"" + liveUrl.replace(dev.developer_password, "YOUR_PASS") + "\"");
  console.log("  2. Panel → Settings → API IP's → add 100.121.223.62 and/or 127.0.0.1 → Save");
  console.log("  3. If test B returns JSON but A is empty → panel uses IP-only auth, not developer_*");
  console.log("  4. ss -tlnp | grep 25500");
  process.exit(1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
