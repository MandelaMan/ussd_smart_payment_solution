#!/usr/bin/env node
/* eslint-disable no-console */
const {
  formatBouquetParam,
  buildQueryString,
  buildDocQuery,
  buildRequestUrl,
  buildFullEndpoint,
  getApiUrl,
  parseResponseData,
} = require("../api/services/xtream/xtreamClient");

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    failed += 1;
  } else {
    console.log("PASS", msg);
  }
}

process.env.XTREAM_BASE_URL = "http://127.0.0.1:25500/";
assert(getApiUrl() === "http://127.0.0.1:25500/api.php", "default localhost api.php");

assert(formatBouquetParam([1, 2]) === "[1,2]", "bouquet JSON array");

const docQuery = buildDocQuery(
  "bouquet",
  "get",
  {},
  { developer_username: "admin", developer_password: "secret" }
);
const docUrl = buildRequestUrl(getApiUrl(), docQuery);
assert(docUrl.includes("action=bouquet&sub=get&developer_username="), "doc query order");

const liveUrl = buildRequestUrl("http://127.0.0.1:25500/api.php", docQuery);
assert(liveUrl.includes("developer_password=secret"), "live URL keeps password");
assert(!liveUrl.includes("redacted"), "live URL not redacted");

const logUrl = buildFullEndpoint("http://127.0.0.1:25500/api.php", {
  action: "user",
  sub: "create",
  developer_username: "admin",
  developer_password: "secret",
  username: "APT101",
  password: "linepass",
  bouquet: "[1]",
});
assert(logUrl.includes("developer_password=%5Bredacted%5D"), "log URL redacts password");

assert(Array.isArray(parseResponseData('[{"id":"1"}]')), "parse bouquet array");
assert(parseResponseData('{"status":"success"}').status === "success", "parse success");

console.log(failed ? `\n${failed} failed` : "\nAll spec alignment checks passed");
process.exit(failed ? 1 : 0);
