#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Xtream API spec alignment tests (offline — no panel call).
 */
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

process.env.XTREAM_BASE_URL = "http://100.121.223.62:25500/";
assert(getApiUrl() === "http://100.121.223.62:25500/api.php", "panel root + /api.php");
process.env.XTREAM_BASE_URL = "http://100.121.223.62:25500/api.php";
assert(getApiUrl() === "http://100.121.223.62:25500/api.php", "strip /api.php from base then re-append");

assert(formatBouquetParam([1, 2]) === "[1,2]", "bouquet JSON array [1,2]");
assert(formatBouquetParam([1]) === "[1]", "bouquet JSON array [1]");

const qs = buildQueryString({
  action: "bouquet",
  sub: "get",
  developer_username: "admin",
  developer_password: "secret",
});
assert(qs.startsWith("action=bouquet&sub=get"), "doc order: action then sub");
assert(qs.includes("developer_username=admin"), "query has developer_username");

const docQuery = buildDocQuery(
  "bouquet",
  "get",
  {},
  { developer_username: "admin", developer_password: "secret" }
);
assert(docQuery.action === "bouquet" && docQuery.sub === "get", "buildDocQuery action/sub");
const docUrl = buildRequestUrl("http://100.121.223.62:25500/api.php", docQuery);
assert(docUrl.includes("action=bouquet&sub=get&developer_username="), "doc URL param order");

const url = buildFullEndpoint("http://100.121.223.62:25500/api.php", {
  action: "user",
  sub: "create",
  developer_username: "admin",
  developer_password: "secret",
  username: "APT-101",
  password: "linepass",
  max_connections: 1,
  exp_date: 1735689600,
  bouquet: "[1,2]",
});
assert(url.startsWith("http://100.121.223.62:25500/api.php?"), "full endpoint base");
assert(url.includes("action=user&sub=create"), "create action/sub in doc order");
assert(url.includes("bouquet=%5B1%2C2%5D"), "bouquet URL-encoded");
assert(url.includes("developer_password=%5Bredacted%5D"), "log URL redacts password");

const liveUrl = buildRequestUrl("http://100.121.223.62:25500/api.php", docQuery);
assert(liveUrl.includes("developer_password=secret"), "live request URL keeps real password");
assert(!liveUrl.includes("redacted"), "live request URL never contains redacted");

const bouquetList = parseResponseData('[{"id":"1","bouquet_name":"APARTONET"}]');
assert(Array.isArray(bouquetList) && bouquetList[0].id === "1", "parse bouquet array");

const success = parseResponseData('{"status":"success","message":"User has been created successfully."}');
assert(success.status === "success", "parse create success");

const denied = parseResponseData('{"status":"error","message":"Access denied"}');
assert(denied.status === "error", "parse access denied");

const xuiOk = parseResponseData('{"result":true,"created_id":14838,"username":"test"}');
assert(xuiOk.result === true, "parse XUI result:true");

const userProfile = parseResponseData(
  '{"id":"4521","username":"testuser99","password":"p1","exp_date":"1781128800","max_connections":"1","active_connections":"0","is_enabled":"1","bouquet":"[1,4,12]"}'
);
assert(userProfile.username === "testuser99" && userProfile.id === "4521", "parse user profile get");

const getUrl = buildFullEndpoint("http://100.121.223.62:25500/api.php", {
  action: "user",
  sub: "get",
  developer_username: "admin",
  developer_password: "secret",
  username: "testuser99",
});
assert(getUrl.includes("action=user&sub=get&developer_username="), "user get URL order");

const bouquetEditUrl = buildFullEndpoint("http://100.121.223.62:25500/api.php", {
  action: "user",
  sub: "edit",
  developer_username: "admin",
  developer_password: "secret",
  username: "testuser99",
  bouquet: "[1,4]",
});
assert(bouquetEditUrl.includes("bouquet=%5B1%2C4%5D"), "edit bouquet-only URL");
assert(!bouquetEditUrl.includes("exp_date"), "edit bouquet-only has no exp_date");

console.log(failed ? `\n${failed} failed` : "\nAll spec alignment checks passed");
process.exit(failed ? 1 : 0);
