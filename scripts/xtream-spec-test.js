#!/usr/bin/env node
/* eslint-disable no-console */
const {
  encodeBouquet,
  getApiUrl,
  getXtreamConfig,
  parseXtreamBody,
  isSuccessResponse,
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

process.env.XTREAM_BASE_URL = "http://100.121.223.62:25500";
assert(getApiUrl() === "http://100.121.223.62:25500/api.php", "api URL");
assert(encodeBouquet([1, 4]) === "[1,4]", "encodeBouquet");
assert(isSuccessResponse([{ id: "1" }]), "bouquet array is success");
assert(isSuccessResponse({ status: "success" }), "status success");
assert(parseXtreamBody('{"status":"success"}').status === "success", "parse JSON");

const cfg = getXtreamConfig();
assert(cfg.apiPath === "/api.php", "default api path");

console.log(failed ? `\n${failed} failed` : "\nAll spec alignment checks passed");
process.exit(failed ? 1 : 0);
