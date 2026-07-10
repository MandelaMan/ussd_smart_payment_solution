#!/usr/bin/env node
/**
 * Seed test users for each role (development only).
 * Usage: yarn db:seed
 * Env: see .env.dist — ADMIN_*, SUPPORT_*, CFO_*, PARTNER_*
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const { query } = require("../api/config/db");

const TEST_USERS = [
  {
    role: "admin",
    name: process.env.ADMIN_NAME || "Admin",
    email: process.env.ADMIN_EMAIL || "admin@sulsolutions.biz",
    password: process.env.ADMIN_PASSWORD || "Admin@12345",
  },
  {
    role: "support",
    name: process.env.SUPPORT_NAME || "Support User",
    email: process.env.SUPPORT_EMAIL || "support@sulsolutions.biz",
    password: process.env.SUPPORT_PASSWORD || "Support@12345",
  },
  {
    role: "cfo",
    name: process.env.CFO_NAME || "CFO User",
    email: process.env.CFO_EMAIL || "cfo@sulsolutions.biz",
    password: process.env.CFO_PASSWORD || "Cfo@12345",
  },
  {
    role: "partner",
    name: process.env.PARTNER_NAME || "Partner User",
    email: process.env.PARTNER_EMAIL || "partner@sulsolutions.biz",
    password: process.env.PARTNER_PASSWORD || "Partner@12345",
  },
];

async function seedUser({ role, name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await query(
    `SELECT id, role FROM admin_users WHERE email = ? LIMIT 1`,
    [normalizedEmail]
  );
  if (existing.length) {
    console.log(`  ↷ ${role}: ${normalizedEmail} (already exists)`);
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO admin_users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
    [String(name).trim(), normalizedEmail, hash, role]
  );
  console.log(`  ✔ ${role}: ${normalizedEmail}`);
}

async function main() {
  console.log("Seeding test users (yarn db:seed)...\n");
  for (const user of TEST_USERS) {
    await seedUser(user);
  }
  console.log("\nCredentials are defined in .env / .env.dist");
  console.log("Change passwords before production use.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
