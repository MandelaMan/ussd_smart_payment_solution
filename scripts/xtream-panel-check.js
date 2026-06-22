#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Live panel connectivity check (no subscription changes).
 * Run on the same host that will call the Xtream API (e.g. the droplet).
 */
require("dotenv").config();
const axios = require("axios");
const { getBaseUrl, getApiUrl, getDeveloperCredentials } = require("../api/services/xtream/xtreamClient");

async function probe(label, url) {
  const res = await axios.get(url, {
    timeout: 15000,
    validateStatus: () => true,
    transformResponse: [(raw) => raw],
  });
  const body = res.data == null ? "" : String(res.data);
  return {
    label,
    httpStatus: res.status,
    bodyLength: body.length,
    contentType: res.headers["content-type"] || null,
    bodyPreview: body.slice(0, 120),
  };
}

async function main() {
  const baseUrl = getBaseUrl();
  const apiUrl = getApiUrl();
  let creds;
  try {
    creds = getDeveloperCredentials();
  } catch (e) {
    console.error("[xtream-check] " + e.message);
    process.exit(1);
  }

  console.log("[xtream-check] baseUrl:", baseUrl);
  console.log("[xtream-check] developer_username:", creds.developer_username);
  console.log("[xtream-check] password set:", creds.developer_password.length > 0);

  const noAuth = `${apiUrl}?action=bouquet&sub=get`;
  const withAuth =
    `${apiUrl}?action=bouquet&sub=get` +
    `&developer_username=${encodeURIComponent(creds.developer_username)}` +
    `&developer_password=${encodeURIComponent(creds.developer_password)}`;

  const results = await Promise.all([
    probe("bouquet (no auth)", noAuth),
    probe("bouquet (developer creds)", withAuth),
  ]);

  for (const r of results) {
    console.log(
      `[xtream-check] ${r.label}: http=${r.httpStatus} bodyLength=${r.bodyLength} content-type=${r.contentType}`
    );
    if (r.bodyLength > 0) {
      console.log(`[xtream-check] preview: ${r.bodyPreview}`);
    }
  }

  const authResult = results[1];
  if (authResult.bodyLength > 0) {
    console.log("[xtream-check] Panel returned data — run: yarn xtream:test");
    process.exit(0);
  }

  console.error("\n[xtream-check] Panel reachable but API returns empty body (not an app URL bug).");
  console.error("[xtream-check] Fix on Xtream UI panel:");
  console.error("  1. Settings → API IP's — add 100.121.223.62, 127.0.0.1, and this server's IP");
  console.error("  2. Settings → General — ensure API access is enabled");
  console.error("  3. Confirm XTREAM_DEVELOPER_PASSWORD matches panel admin login");
  console.error("  4. Re-test: curl -sS -o /tmp/b.txt -w '%{http_code} size=%{size_download}\\n' \\");
  console.error(`     "${withAuth.replace(creds.developer_password, "YOUR_PASS")}"`);
  process.exit(1);
}

main().catch((e) => {
  console.error("[xtream-check] failed:", e.message);
  process.exit(1);
});
