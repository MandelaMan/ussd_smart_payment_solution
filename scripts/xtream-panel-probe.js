#!/usr/bin/env node
/* eslint-disable no-console */
require("dotenv").config();

const {
  getXtreamConfig,
  getBouquets,
  createUser,
  describeApiResult,
} = require("../api/services/xtream/xtreamClient");

async function main() {
  const cfg = getXtreamConfig();
  console.log("=== Xtream panel probe ===");
  console.log("baseUrl:", cfg.baseUrl);

  const bouquetRes = await getBouquets(cfg);
  console.log("bouquet_get:", describeApiResult(bouquetRes));
  if (!bouquetRes.ok) process.exit(1);

  const user = `probe_${Date.now().toString(36)}`;
  const createRes = await createUser(
    {
      username: user,
      password: "Probe12345",
      max_connections: 1,
      exp_date: Math.floor(Date.now() / 1000) + 30 * 86400,
      bouquet: [1],
    },
    cfg
  );
  console.log("user_create:", describeApiResult(createRes));
  process.exit(createRes.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
