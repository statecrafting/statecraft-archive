#!/usr/bin/env node
// Statecraft schema migration runner.
//
// Applies SQL files from MIGRATIONS_DIR to the database referenced by
// STATECRAFT_DB_URL in filename order. Tracks applied versions in the
// schema_migrations table and skips versions that are already present.
//
// Intended to run as a pre-install/pre-upgrade Helm hook.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.statecraft_DB_URL;
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve("./api/db/migrations");

if (!DATABASE_URL) {
  console.error("STATECRAFT_DB_URL is required");
  process.exit(1);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  process.exit(1);
}

// Parse "<version>_<slug>.up.sql" → { version, name, file }
function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => {
      const match = f.match(/^(\d+)_(.+)\.up\.sql$/);
      if (!match) throw new Error(`Bad migration filename: ${f}`);
      return {
        version: Number(match[1]),
        name: match[2],
        file: path.join(MIGRATIONS_DIR, f),
      };
    })
    .sort((a, b) => a.version - b.version);
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`Connected to database, migrations dir: ${MIGRATIONS_DIR}`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version BIGINT PRIMARY KEY,
      name    TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await client.query(
    "SELECT version FROM schema_migrations"
  );
  const appliedSet = new Set(applied.map((r) => Number(r.version)));

  // Backfill: the schema is now a single consolidated baseline (version 1,
  // see api/db/migrations/1_baseline.up.sql). If schema_migrations is empty
  // but the schema already exists (a DB provisioned before the baseline was
  // introduced), mark the baseline applied so we never re-run its CREATEs. On
  // a genuinely fresh DB no tables exist, so the baseline runs normally.
  if (appliedSet.size === 0) {
    const { rows } = await client.query(
      "SELECT to_regclass('public.users') IS NOT NULL AS has_schema"
    );
    if (rows[0].has_schema) {
      for (const m of listMigrations()) {
        if (m.version !== 1) continue;
        await client.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [m.version, m.name]
        );
        appliedSet.add(m.version);
        console.log(`  backfilled schema_migrations for ${m.version}_${m.name}`);
      }
    }
  }

  const pending = listMigrations().filter((m) => !appliedSet.has(m.version));

  if (pending.length === 0) {
    console.log("No pending migrations.");
    await client.end();
    return;
  }

  console.log(
    `Applying ${pending.length} pending migration(s): ${pending
      .map((m) => m.version)
      .join(", ")}`
  );

  for (const m of pending) {
    const sql = fs.readFileSync(m.file, "utf8");
    console.log(`-- Applying ${m.version}_${m.name}`);
    try {
      // Some migrations (ALTER TYPE ... ADD VALUE) cannot run in a transaction,
      // so we do not wrap the file contents ourselves.
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
        [m.version, m.name]
      );
      console.log(`   ok (${m.version})`);
    } catch (err) {
      console.error(`   FAILED ${m.version}_${m.name}: ${err.message}`);
      if (err.detail) console.error(`   detail: ${err.detail}`);
      if (err.hint) console.error(`   hint: ${err.hint}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration runner crashed:", err);
  process.exit(1);
});
