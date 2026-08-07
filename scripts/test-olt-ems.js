#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * OLT EMS integration tester — no dashboard required.
 *
 * Prerequisites:
 *   1. yarn db:migrate  (044_customer_olt_onu)
 *   2. .env with OLT_EMS_* vars (see .env.dist)
 *   3. yarn dev running for --via=admin tests
 *
 * Usage:
 *   yarn test:olt                          # read-only EMS + admin API
 *   yarn test:olt --via=ems                # direct EMS only
 *   yarn test:olt --via=admin              # admin API only (needs JWT)
 *   yarn test:olt --ability --onu=2        # ONU ability for index 0-0-1-1-2
 *   yarn test:olt --link --customer=42 --onu=2 --sn=VSOL00abe454
 *   yarn test:olt --disconnect --customer=42   # TISP + OLT disconnect (LIVE)
 *   yarn test:olt --activate --customer=42     # OLT activate only (LIVE)
 *
 * Env for admin login (defaults from seed):
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD  or ADMIN_EMAIL / ADMIN_PASSWORD
 */
require("dotenv").config();

const axios = require("axios");

const OLT_MAC = process.env.OLT_EMS_DEFAULT_MAC || "6c:68:a4:ee:93:74";
const API_BASE = (process.env.TEST_API_BASE || "http://localhost:4000/api").replace(
  /\/$/,
  ""
);

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return fallback;
}

function indexStrForOnu(n) {
  return `0-0-1-1-${Number(n)}`;
}

function printSection(title) {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function summarizeOnus(onus) {
  if (!Array.isArray(onus)) return;
  console.log(`Found ${onus.length} ONU(s):`);
  for (const o of onus.slice(0, 20)) {
    const idx =
      o.indexStr ||
      `0-${o.authSlot ?? 0}-${o.authPonType ?? 1}-${o.authPon ?? 1}-${o.authOnu}`;
    console.log(
      `  #${o.authOnu ?? "?"}  ${o.phaseStatus ?? "?"}  ${o.adminStatus ?? "?"}  ${o.authInfo ?? ""}  ${o.description ?? ""}  → ${idx}`
    );
  }
  if (onus.length > 20) console.log(`  ... and ${onus.length - 20} more`);
}

async function testEmsDirect() {
  const olt = require("../api/services/oltEmsService");
  if (!olt.isOltEmsConfigured()) {
    console.error(
      "OLT EMS not configured. Set OLT_EMS_BASE_URL, OLT_EMS_USERNAME, OLT_EMS_PASSWORD in .env"
    );
    return false;
  }

  printSection("EMS direct — login + ONU list");
  const onus = await olt.getOnuList({
    oltMac: OLT_MAC,
    portIndex: 1,
    indexStr: "0-0-1-1-0",
  });
  summarizeOnus(
    onus.map((o) => ({
      ...o,
      indexStr: olt.buildIndexStrFromOnu(o),
    }))
  );

  const onuNum = arg("onu", null);
  if (arg("ability", false) || onuNum) {
    const n = Number(onuNum || 2);
    const indexStr = arg("indexStr", indexStrForOnu(n));
    printSection(`EMS direct — ONU ability (onu=${n}, ${indexStr})`);
    const ability = await olt.getOnuAbility({
      oltMac: OLT_MAC,
      indexStr,
      onuIndex: n,
      portIndex: 1,
      slotIndex: 0,
    });
    console.log(JSON.stringify(ability, null, 2));
  }

  const customerId = arg("customer", null);
  if (arg("activate", false) && customerId) {
    printSection(`EMS direct — ACTIVATE ONU for customer ${customerId} (LIVE)`);
    const store = require("../api/services/customerModuleStore");
    const ctx = await store.getCustomerContext(Number(customerId));
    if (!ctx) throw new Error("Customer not found");
    const result = await olt.activateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
    });
    console.log(result);
  }

  return true;
}

async function adminLogin() {
  const email =
    process.env.TEST_ADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "admin@sulsolutions.biz";
  const password =
    process.env.TEST_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "Admin@12345";

  const res = await axios.post(
    `${API_BASE}/auth/login`,
    { email, password },
    { validateStatus: () => true }
  );
  if (res.status !== 200) {
    throw new Error(
      `Admin login failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  const setCookie = res.headers["set-cookie"];
  if (setCookie?.length) {
    return { Cookie: setCookie.map((c) => c.split(";")[0]).join("; ") };
  }

  // Fallback: sign JWT when cookie header missing (e.g. proxy stripped Set-Cookie)
  const jwt = require("jsonwebtoken");
  const secret = process.env.JWT_SECRET;
  if (!secret || !res.data?.user?.id) {
    throw new Error("Admin login succeeded but no session cookie or JWT fallback");
  }
  const token = jwt.sign(
    {
      sub: res.data.user.id,
      email: res.data.user.email,
      role: res.data.user.role,
      name: res.data.user.name,
      tv: 0,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d", algorithm: "HS256" }
  );
  return { Cookie: `admin_token=${token}` };
}

async function testAdminApi(authHeaders) {
  const headers = authHeaders;

  printSection("Admin API — GET /admin/olt/onu-list");
  const listRes = await axios.get(`${API_BASE}/admin/olt/onu-list`, {
    headers,
    params: { oltMac: OLT_MAC, portIndex: 1, indexStr: "0-0-1-1-0" },
    validateStatus: () => true,
  });
  console.log("status:", listRes.status);
  if (listRes.data?.onus) summarizeOnus(listRes.data.onus);
  else console.log(JSON.stringify(listRes.data, null, 2));

  const onuNum = arg("onu", null);
  if (arg("ability", false) || onuNum) {
    const n = Number(onuNum || 2);
    const indexStr = arg("indexStr", indexStrForOnu(n));
    printSection(`Admin API — GET /admin/olt/onu-ability`);
    const abRes = await axios.get(`${API_BASE}/admin/olt/onu-ability`, {
      headers,
      params: {
        oltMac: OLT_MAC,
        indexStr,
        onuIndex: n,
        portIndex: 1,
        slotIndex: 0,
      },
      validateStatus: () => true,
    });
    console.log("status:", abRes.status);
    console.log(JSON.stringify(abRes.data, null, 2));
  }

  const customerId = arg("customer", null);
  if (arg("link", false) && customerId) {
    const n = Number(onuNum || 2);
    const indexStr = arg("indexStr", indexStrForOnu(n));
    const sn = arg("sn", "VSOL00abe454");
    printSection(`Admin API — POST /admin/customers/${customerId}/olt-link (LIVE)`);
    const linkRes = await axios.post(
      `${API_BASE}/admin/customers/${customerId}/olt-link`,
      { onuIndexStr: indexStr, onuSn: sn, oltMac: OLT_MAC },
      { headers, validateStatus: () => true }
    );
    console.log("status:", linkRes.status);
    console.log(JSON.stringify(linkRes.data, null, 2));
  }

  if (arg("disconnect", false) && customerId) {
    printSection(
      `Admin API — POST /admin/customers/${customerId}/disconnect (LIVE — TISP + OLT)`
    );
    const dcRes = await axios.post(
      `${API_BASE}/admin/customers/${customerId}/disconnect`,
      { notes: "OLT EMS test script" },
      { headers, validateStatus: () => true }
    );
    console.log("status:", dcRes.status);
    console.log(JSON.stringify(dcRes.data, null, 2));
  }

  if (arg("activate", false) && customerId && !arg("disconnect", false)) {
    printSection(`Admin API — activate via EMS service for customer ${customerId}`);
    const store = require("../api/services/customerModuleStore");
    const olt = require("../api/services/oltEmsService");
    const ctx = await store.getCustomerContext(Number(customerId));
    const result = await olt.activateOnuForCustomer(ctx, {
      customerId: ctx.id,
      customerNumber: ctx.customer_number,
    });
    console.log(result);
  }
}

async function main() {
  const via = arg("via", "all");
  console.log("OLT EMS test script");
  console.log("OLT_MAC:", OLT_MAC);
  console.log("API_BASE:", API_BASE);
  console.log("mode:", via);

  if (arg("help", false)) {
    console.log("\nSee script header in scripts/test-olt-ems.js for full usage.");
    return;
  }

  let ok = true;

  if (via === "all" || via === "ems") {
    try {
      await testEmsDirect();
    } catch (e) {
      console.error("EMS test failed:", e.message);
      ok = false;
    }
  }

  if (via === "all" || via === "admin") {
    try {
      printSection("Admin API — login");
      const authHeaders = await adminLogin();
      console.log("Session obtained");
      await testAdminApi(authHeaders);
    } catch (e) {
      console.error("Admin API test failed:", e.message);
      ok = false;
    }
  }

  printSection(ok ? "DONE — all requested tests completed" : "DONE — some tests failed");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
