#!/usr/bin/env node
/**
 * Tiny MySQL migration runner for local/dev.
 * - Applies db/schema.sql once (recorded as "000_base_schema.sql")
 * - Applies all db/migrations/*.sql in sorted order, once each
 * - Records applied migrations in table "_migrations"
 * Usage:
 *   node api/config/migrate.js         # apply pending migrations
 *   node api/config/migrate.js --status
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getPool, query } = require("./db");

const MIGRATIONS_TABLE = "_migrations";
const ROOT = path.join(__dirname, "../../");
const SCHEMA_FILE = path.join(ROOT, "db", "schema.sql");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

const log = (...args) => console.log("[migrate]", ...args);
const error = (...args) => console.error("[migrate]", ...args);

process.on("unhandledRejection", (e) => {
  error("UnhandledRejection:", e?.stack || e);
  process.exit(1);
});

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE}(
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getAppliedSet() {
  await ensureMigrationsTable();
  const rows = await query(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC;`
  );
  return new Set(rows.map((r) => r.name));
}

async function applySql(name, sql) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // multipleStatements=true should be enabled in db.js pool config
    await conn.query(sql);
    await conn.query(`INSERT INTO ${MIGRATIONS_TABLE}(name) VALUES (?);`, [
      name,
    ]);
    await conn.commit();
    log(`✔ Applied ${name}`);
    return true;
  } catch (e) {
    await conn.rollback();
    error(`✖ Failed ${name}: ${e.message}`);
    throw e;
  } finally {
    conn.release();
  }
}

async function applyBaseSchema(appliedSet) {
  if (!fs.existsSync(SCHEMA_FILE)) {
    log("No db/schema.sql found; skipping base schema.");
    return false;
  }
  const baseName = "000_base_schema.sql";
  if (appliedSet.has(baseName)) {
    log(`↷ Skipping ${baseName} (already applied)`);
    return false;
  }
  const sql = fs.readFileSync(SCHEMA_FILE, "utf8");
  log(`Applying base schema from: ${SCHEMA_FILE}`);
  return applySql(baseName, sql);
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".sql"))
    .map((d) => d.name)
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
}

async function applyMigrations(appliedSet) {
  const files = listMigrationFiles();
  if (files.length === 0) {
    log("No db/migrations/*.sql found.");
    return false;
  }

  let appliedAny = false;
  for (const fname of files) {
    if (appliedSet.has(fname)) {
      log(`↷ Skipping ${fname} (already applied)`);
      continue;
    }
    const full = path.join(MIGRATIONS_DIR, fname);
    const sql = fs.readFileSync(full, "utf8");
    log(`Applying ${fname} ...`);
    // If one migration fails, stop and exit non-zero
    await applySql(fname, sql);
    appliedAny = true;
  }
  return appliedAny;
}

async function status() {
  log("Using DB:", process.env.MYSQL_DATABASE || "(none set)");
  const applied = await getAppliedSet();
  const listed = listMigrationFiles();
  const baseApplied = applied.has("000_base_schema.sql");

  console.log("\nStatus:");
  console.log("- Base schema:", baseApplied ? "APPLIED" : "PENDING");
  console.log(
    "- Applied migrations:",
    JSON.stringify(
      [...applied].filter((n) => n !== "000_base_schema.sql"),
      null,
      2
    )
  );
  console.log("- Files on disk:", JSON.stringify(listed, null, 2));
}

async function main() {
  log("Starting...");
  log("Using DB:", process.env.MYSQL_DATABASE || "(none set)");

  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    await status();
    return;
  }

  // Basic connectivity check
  try {
    const rows = await query("SELECT 1 AS ok;");
    if (!rows || rows[0]?.ok !== 1) {
      throw new Error("DB ping returned unexpected result.");
    }
  } catch (e) {
    error("Cannot connect to database. Verify .env and that the DB exists.");
    throw e;
  }

  const appliedSet = await getAppliedSet();
  let anyApplied = false;

  // Base schema
  const baseApplied = await applyBaseSchema(appliedSet);
  anyApplied = anyApplied || baseApplied;

  // Migrations dir
  const migApplied = await applyMigrations(await getAppliedSet());
  anyApplied = anyApplied || migApplied;

  if (!anyApplied) {
    log("Nothing to apply.");
  } else {
    log("Done.");
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
