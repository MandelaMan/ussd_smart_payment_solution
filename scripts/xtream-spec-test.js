#!/usr/bin/env node
/* eslint-disable no-console */
const {
  formatBouquetParam,
  buildBillingQuery,
  buildV2PostBody,
  buildQueryString,
  buildRequestUrl,
  getApiUrl,
  parseResponseData,
} = require("../api/services/xtream/xtreamClient");

let failed = 0;
function assert(c, m) {
  if (!c) {
    console.error("FAIL", m);
    failed++;
  } else console.log("PASS", m);
}

process.env.XTREAM_BASE_URL = "http://100.121.223.62:25500/";
assert(formatBouquetParam([1]) === "[1]", "bouquet [1]");

const billing = buildBillingQuery("bouquet", "get", {}, { developer_username: "a", developer_password: "b" });
assert(buildRequestUrl(getApiUrl(), billing).includes("developer_username=a"), "billing query");

const v2body = buildQueryString(buildV2PostBody({ user_data: { username: "u1", bouquet: "[1]" } }));
assert(v2body.includes("user_data%5Busername%5D=u1"), "v2 post body");

assert(Array.isArray(parseResponseData('[{"id":"1"}]')), "parse array");
assert(parseResponseData('{"result":true}').result === true, "parse v2 ok");

console.log(failed ? `${failed} failed` : "All spec checks passed");
process.exit(failed ? 1 : 0);
