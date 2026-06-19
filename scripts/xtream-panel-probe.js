#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Panel connectivity probe — run on the billing server (droplet).
 * Usage: yarn xtream:probe
 */
require("dotenv").config();

const {
  getBaseUrl,
  getDeveloperCredentials,
  getBouquets,
  buildRequestUrl,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const base = getBaseUrl();
  const creds = getDeveloperCredentials();
  const bouquetUrl = buildRequestUrl(`${base}/api.php`, {
    ...creds,
    action: "bouquet",
    sub: "get",
  });

  console.log("=== Xtream panel probe ===");
  console.log("baseUrl:", base);
  console.log("developer_username:", creds.developer_username);
  console.log(
    "developer_password:",
    creds.developer_password ? `[set, length ${creds.developer_password.length}]` : "[MISSING]"
  );
  console.log("request path:", `${base}/api.php?action=bouquet&sub=get&...`);
  console.log("password in live URL:", bouquetUrl.includes("[redacted]") ? "BUG redacted in URL" : "ok (real password used)");

  const res = await getBouquets();
  const diag = res.diagnostics || {};

  console.log("\n=== Response ===");
  console.log("ok:", res.ok);
  console.log("httpStatus:", res.httpStatus);
  console.log("bodyLength:", diag.responseBodyLength);
  console.log("contentType:", diag.contentType);
  console.log("parsed:", JSON.stringify(res.data).slice(0, 800));

  if (!res.ok && Number(diag.responseBodyLength) === 0) {
    console.log("\n=== Empty body checklist ===");
    console.log("1. Settings → General → enable API");
    console.log("2. XTREAM_DEVELOPER_USERNAME/PASSWORD match panel API gateway creds");
    console.log("3. Whitelist this droplet public IP on panel port 25500");
    console.log("4. Compare with curl using the same .env values");
  }

  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});
