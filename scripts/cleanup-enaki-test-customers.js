#!/usr/bin/env node
/**
 * Remove Enaki test customers whose IP is not on the real-customer allowlist.
 *
 * Usage:
 *   node scripts/cleanup-enaki-test-customers.js           # dry-run
 *   node scripts/cleanup-enaki-test-customers.js --execute # delete
 */
require("dotenv").config();
const { query } = require("../api/config/db");
const store = require("../api/services/customerModuleStore");

/** Real Enaki customer IPs (from ops list). Duplicates ignored. */
const ENAKI_REAL_IPS = [
  "10.10.10.11",
  "10.10.10.12",
  "10.10.10.13",
  "10.10.10.14",
  "10.10.10.16",
  "10.10.10.17",
  "10.10.10.18",
  "10.10.10.20",
  "10.10.10.21",
  "10.10.10.23",
  "10.10.10.24",
  "10.10.10.25",
  "10.10.10.26",
  "10.10.10.28",
  "10.10.10.30",
  "10.10.10.32",
  "10.10.10.34",
  "10.10.10.36",
  "10.10.10.37",
  "10.10.10.38",
  "10.10.10.39",
  "10.10.10.40",
  "10.10.10.41",
  "10.10.10.42",
  "10.10.10.43",
  "10.10.10.46",
  "10.10.10.48",
  "10.10.10.49",
  "10.10.10.51",
  "10.10.10.53",
  "10.10.10.56",
  "10.10.10.58",
  "10.10.10.59",
  "10.10.10.60",
  "10.10.10.62",
  "10.10.10.63",
  "10.10.10.64",
  "10.10.10.65",
  "10.10.10.69",
  "10.10.10.70",
  "10.10.10.71",
  "10.10.10.72",
  "10.10.10.73",
  "10.10.10.74",
  "10.10.10.75",
  "10.10.10.76",
  "10.10.10.78",
  "10.10.10.88",
  "10.10.10.89",
  "10.10.10.90",
  "10.10.10.91",
  "10.10.10.92",
  "10.10.10.93",
  "10.10.10.94",
  "10.10.10.96",
  "10.10.10.97",
  "10.10.10.99",
  "10.10.10.102",
  "10.10.10.104",
  "10.10.10.105",
  "10.10.10.106",
  "10.10.10.110",
  "10.10.10.111",
  "10.10.10.113",
  "10.10.10.115",
  "10.10.10.116",
  "10.10.10.117",
  "10.10.10.118",
  "10.10.10.120",
  "10.10.10.122",
  "10.10.10.124",
  "10.10.10.131",
  "10.10.10.132",
  "10.10.10.135",
  "10.10.10.136",
  "10.10.10.137",
  "10.10.10.139",
  "10.10.10.141",
  "10.10.10.144",
  "10.10.10.145",
  "10.10.10.150",
  "10.10.10.152",
  "10.10.10.154",
  "10.10.10.156",
  "10.10.10.157",
  "10.10.10.158",
  "10.10.10.162",
  "10.10.10.163",
  "10.10.10.165",
  "10.10.10.166",
  "10.10.10.167",
  "10.10.10.175",
  "10.10.10.176",
  "10.10.10.180",
  "10.10.10.188",
  "10.10.10.190",
  "10.10.10.197",
  "10.10.10.202",
  "10.10.10.204",
  "10.10.10.205",
  "10.10.10.206",
  "10.10.10.207",
  "10.10.10.209",
  "10.10.10.214",
  "10.10.10.216",
  "10.10.10.217",
  "10.10.10.218",
  "10.10.10.219",
  "10.10.10.220",
  "10.10.10.222",
  "10.10.10.223",
  "10.10.10.224",
  "10.10.10.225",
  "10.10.10.227",
  "10.10.10.228",
  "10.10.10.229",
  "10.10.10.230",
  "10.10.10.233",
  "10.10.10.235",
  "10.10.10.236",
  "10.10.10.237",
  "10.10.10.238",
  "10.10.10.239",
  "10.10.10.240",
  "10.10.10.241",
  "10.10.10.242",
  "10.10.10.243",
  "10.10.10.244",
  "10.10.10.246",
  "10.10.10.247",
  "10.10.10.248",
  "10.10.10.253",
  "10.10.10.254",
  "10.11.11.10",
  "10.11.11.12",
  "10.11.11.13",
  "10.11.11.14",
  "10.11.11.16",
  "10.11.11.18",
  "10.11.11.19",
  "10.11.11.21",
  "10.11.11.22",
  "10.11.11.23",
  "10.11.11.24",
  "10.11.11.37",
  "10.12.10.3",
  "10.12.10.4",
  "10.12.10.5",
  "10.12.10.6",
  "10.12.10.8",
  "10.12.10.10",
  "10.12.10.11",
  "10.12.10.18",
  "10.12.10.20",
  "10.12.10.21",
  "10.12.10.25",
  "10.12.10.27",
  "10.12.10.28",
  "10.12.10.30",
  "10.12.10.31",
  "10.12.10.32",
  "10.12.10.33",
  "10.12.10.34",
  "10.20.10.11",
  "10.20.10.13",
  "10.20.10.14",
  "10.20.10.16",
  "10.20.10.17",
  "10.20.10.18",
];

const BUILDING_NAME = "Enaki";
const execute = process.argv.includes("--execute");

function normalizeIp(value) {
  return String(value || "").trim();
}

async function main() {
  const allow = new Set(ENAKI_REAL_IPS.map(normalizeIp).filter(Boolean));
  console.log(`Enaki real IP allowlist: ${allow.size} addresses`);
  console.log(execute ? "Mode: EXECUTE (will delete)" : "Mode: DRY-RUN (no deletes)");

  const buildings = await query(
    `SELECT b.id, b.name, p.ip_setup
     FROM buildings b
     JOIN pops p ON p.id = b.pop_id
     WHERE LOWER(b.name) = LOWER(?) LIMIT 1`,
    [BUILDING_NAME]
  );
  const building = buildings[0];
  if (!building) {
    throw new Error(`Building not found: ${BUILDING_NAME}`);
  }
  console.log(`Building: ${building.name} (id=${building.id}, ${building.ip_setup})`);

  const customers = await query(
    `SELECT id, customer_number, first_name, middle_name, last_name,
            apartment_number, ip_address, status
     FROM customers
     WHERE building_id = ?
     ORDER BY ip_address IS NULL, ip_address, id`,
    [building.id]
  );

  const keep = [];
  const remove = [];
  for (const row of customers) {
    const ip = normalizeIp(row.ip_address);
    const name = [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" ");
    const entry = {
      id: row.id,
      customerNumber: row.customer_number,
      name,
      apartment: row.apartment_number,
      ip: ip || "(none)",
      status: row.status,
    };
    if (ip && allow.has(ip)) keep.push(entry);
    else remove.push(entry);
  }

  console.log(`\nTotal Enaki customers: ${customers.length}`);
  console.log(`Keep (IP on allowlist): ${keep.length}`);
  console.log(`Remove (test / unknown IP): ${remove.length}`);

  if (remove.length) {
    console.log("\nCustomers to remove:");
    for (const c of remove) {
      console.log(
        `  #${c.id} ${c.customerNumber} | ${c.name} | apt ${c.apartment} | IP ${c.ip} | ${c.status}`
      );
    }
  }

  if (!execute) {
    console.log("\nDry-run only. Re-run with --execute to delete.");
    return;
  }

  if (!remove.length) {
    console.log("\nNothing to delete.");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const c of remove) {
    try {
      await store.deleteCustomerCompletely(c.id);
      ok += 1;
      console.log(`Deleted ${c.customerNumber} (id=${c.id})`);
    } catch (err) {
      failed += 1;
      console.error(
        `FAILED ${c.customerNumber} (id=${c.id}): ${err.message || err}`
      );
    }
  }

  console.log(`\nDone. Deleted ${ok}, failed ${failed}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
