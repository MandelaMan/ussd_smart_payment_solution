#!/usr/bin/env node
/**
 * Seed test users (development only).
 * Usage: yarn db:seed
 * Env: see .env.dist — ADMIN_*, SUPPORT_* (mapped to User + Support group), etc.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const { query } = require("../api/config/db");
const {
  initializeRbac,
} = require("../api/rbac/permissionService");

const TEST_USERS = [
  {
    role: "admin",
    groupSlugs: [],
    name: process.env.ADMIN_NAME || "Admin",
    email: process.env.ADMIN_EMAIL || "it@sulsolutions.biz",
    password: process.env.ADMIN_PASSWORD || "Admin@2026",
  },
  {
    role: "user",
    groupSlugs: ["support"],
    name: process.env.SUPPORT_NAME || "Support User",
    email: process.env.SUPPORT_EMAIL || "support@sulsolutions.biz",
    password: process.env.SUPPORT_PASSWORD || "Support@12345",
  },
  {
    role: "user",
    groupSlugs: ["finance"],
    name: process.env.CFO_NAME || "CFO User",
    email: process.env.CFO_EMAIL || "cfo@sulsolutions.biz",
    password: process.env.CFO_PASSWORD || "Cfo@12345",
  },
  {
    role: "user",
    groupSlugs: ["management"],
    name: process.env.CEO_NAME || "CEO User",
    email: process.env.CEO_EMAIL || "ceo@sulsolutions.biz",
    password: process.env.CEO_PASSWORD || "Ceo@12345",
  },
  {
    role: "user",
    groupSlugs: ["customer-relations"],
    name: process.env.PARTNER_NAME || "Partner User",
    email: process.env.PARTNER_EMAIL || "partner@sulsolutions.biz",
    password: process.env.PARTNER_PASSWORD || "Partner@12345",
  },
];

const DEFAULT_ADMIN_EMAIL = "it@sulsolutions.biz";
const LEGACY_ADMIN_EMAILS = ["admin@sulsolutions.biz"];

const ADMIN_SEED_EMAIL = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL)
  .trim()
  .toLowerCase();

async function findExistingUser(normalizedEmail, role) {
  const exact = await query(
    `SELECT id, email, role FROM admin_users WHERE email = ? LIMIT 1`,
    [normalizedEmail]
  );
  if (exact[0]) return exact[0];

  if (role !== "admin") return null;
  for (const legacy of LEGACY_ADMIN_EMAILS) {
    if (legacy === normalizedEmail) continue;
    const rows = await query(
      `SELECT id, email, role FROM admin_users WHERE email = ? LIMIT 1`,
      [legacy]
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

async function seedUser({ role, groupSlugs, name, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await findExistingUser(normalizedEmail, role);
  if (existing) {
    if (normalizedEmail === ADMIN_SEED_EMAIL) {
      const hash = await bcrypt.hash(password, 12);
      const taken =
        existing.email !== normalizedEmail
          ? await query(
              `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
              [normalizedEmail, existing.id]
            )
          : [];
      if (taken[0]) {
        console.log(
          `  ! ${role}: cannot rename ${existing.email} → ${normalizedEmail} (already in use)`
        );
      } else {
        await query(
          `UPDATE admin_users
           SET email = ?, password_hash = ?, must_change_password = 0,
               failed_login_count = 0, locked_until = NULL,
               token_version = token_version + 1
           WHERE id = ?`,
          [normalizedEmail, hash, existing.id]
        );
        if (existing.email !== normalizedEmail) {
          console.log(
            `  ✔ ${role}: ${existing.email} → ${normalizedEmail} (email + password enforced)`
          );
        } else {
          console.log(`  ✔ ${role}: ${normalizedEmail} (password enforced)`);
        }
      }
    } else {
      console.log(`  ↷ ${role}: ${normalizedEmail} (already exists)`);
    }
    return existing.id;
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await query(
    `INSERT INTO admin_users (name, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, 0)`,
    [String(name).trim(), normalizedEmail, hash, role]
  );
  const userId = result.insertId;
  console.log(`  ✔ ${role}: ${normalizedEmail}`);

  for (const slug of groupSlugs || []) {
    const groups = await query(
      `SELECT id FROM rbac_groups WHERE slug = ? LIMIT 1`,
      [slug]
    );
    if (!groups[0]) continue;
    await query(
      `INSERT IGNORE INTO rbac_user_groups (user_id, group_id) VALUES (?, ?)`,
      [userId, groups[0].id]
    );
    console.log(`    → group ${slug}`);
  }
  return userId;
}

async function main() {
  console.log("Seeding RBAC catalog & groups...");
  await initializeRbac();
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
