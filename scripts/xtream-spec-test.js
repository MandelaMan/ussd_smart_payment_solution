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

process.env.XTREAM_BASE_URL = "http://100.121.223.62:25500/";
process.env.XTREAM_DEVELOPER_USERNAME = "admin";
process.env.XTREAM_DEVELOPER_PASSWORD = "secret";

assert(formatBouquetParam([1, 2]) === "[1,2]", "bouquet JSON array");

const apiUrl = getApiUrl();
const endpoint = buildFullEndpoint(apiUrl, {
  action: "bouquet",
  sub: "get",
  developer_username: "admin",
  developer_password: "secret",
});
assert(endpoint.includes("developer_password=%5Bredacted%5D"), "password redacted in log URL");
assert(endpoint.includes("action=bouquet"), "bouquet action in URL");

const createUrl = buildRequestUrl(apiUrl, {
  action: "user",
  sub: "create",
  developer_username: "admin",
  developer_password: "secret",
  username: "APT101",
  password: "linepass",
  max_connections: 1,
  exp_date: 1893456000,
  bouquet: "[1]",
});
assert(createUrl.includes("sub=create"), "user create URL");
assert(createUrl.includes("bouquet=%5B1%5D"), "bouquet param encoded");

assert(Array.isArray(parseResponseData('[{"id":"1","bouquet_name":"Test"}]')), "parse bouquet array");
assert(isSuccessResponse({ status: "success" }), "success status");
assert(!isSuccessResponse({ status: "error", message: "Access denied" }), "error status");

console.log(failed ? `${failed} failed` : "All spec checks passed");
process.exit(failed ? 1 : 0);
