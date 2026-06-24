#!/usr/bin/env node
/* eslint-disable no-console */
const {
  formatBouquetParam,
  buildFullEndpoint,
  buildRequestUrl,
  getApiUrl,
  parseResponseData,
  isSuccessResponse,
} = require("../api/services/xtream/xtreamClient");

let failed = 0;
function assert(c, m) {
  if (!c) {
    console.error("FAIL", m);
    failed++;
  } else console.log("PASS", m);
}

process.env.XTREAM_BASE_URL = "http://100.121.223.62:25461/";

assert(formatBouquetParam([1, 2]) === "[1,2]", "bouquet JSON array");

const apiUrl = getApiUrl();
const pingEndpoint = buildFullEndpoint(apiUrl, { action: "server", sub: "list" });
assert(pingEndpoint.includes("action=server"), "server list action in URL");
assert(pingEndpoint.includes("sub=list"), "server list sub in URL");

const createUrl = buildRequestUrl(apiUrl, { action: "user", sub: "create" });
assert(createUrl.includes("sub=create"), "user create query URL");

assert(Array.isArray(parseResponseData('[{"id":1,"server_name":"Main"}]')), "parse server array");
assert(isSuccessResponse({ result: true, created_id: 1 }), "result true");
assert(isSuccessResponse({ status: "success" }), "success status");
assert(!isSuccessResponse({ result: false, error: "EXISTS" }), "result false");
assert(!isSuccessResponse({ status: "error", message: "Access denied" }), "error status");

console.log(failed ? `${failed} failed` : "All spec checks passed");
process.exit(failed ? 1 : 0);
