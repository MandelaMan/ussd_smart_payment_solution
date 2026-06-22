#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Xtream API spec alignment tests (offline — no panel call).
 */
const {
  formatBouquetParam,
  buildQueryString,
  buildBillingQuery,
  buildV2PostBody,
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

assert(formatBouquetParam([1, 2]) === "[1,2]", "bouquet JSON array [1,2]");

const r22fBouquetUrl = buildRequestUrl(getApiUrl(), { action: "bouquet", sub: "get" });
assert(r22fBouquetUrl.includes("action=bouquet&sub=get"), "R22F bouquet URL has no developer_*");
assert(!r22fBouquetUrl.includes("developer_username"), "R22F bouquet URL omits developer_username");

const createBody = buildQueryString(
  buildV2PostBody("user", "create", {
    user_data: {
      username: "APT101",
      password: "linepass",
      max_connections: 1,
      exp_date: 1735689600,
      bouquet: "[1]",
    },
  })
);
assert(createBody.includes("user_data%5Busername%5D=APT101"), "R22F create POST user_data username");
assert(createBody.includes("user_data%5Bbouquet%5D=%5B1%5D"), "R22F create POST user_data bouquet");

const billingQuery = buildBillingQuery(
  "bouquet",
  "get",
  {},
  { developer_username: "admin", developer_password: "secret" }
);
const billingUrl = buildRequestUrl("http://100.121.223.62:25500/api.php", billingQuery);
assert(billingUrl.includes("developer_username=admin"), "billing mode keeps developer_username");

const success = parseResponseData('{"result":true,"created_id":14838,"username":"test"}');
assert(success.result === true, "parse v2 create success");

const bouquetList = parseResponseData('[{"id":"1","bouquet_name":"APARTONET"}]');
assert(Array.isArray(bouquetList), "parse bouquet array");

const info = parseResponseData('{"result":true,"user_info":{"username":"u1","exp_date":"1735689600"}}');
assert(info.user_info?.username === "u1", "parse user info");

console.log(failed ? `\n${failed} failed` : "\nAll spec alignment checks passed");
process.exit(failed ? 1 : 0);
