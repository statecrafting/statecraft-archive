/**
 * Standalone migration runner for self-hosted deploys.
 *
 * Encore applies db/migrations/*.up.sql automatically on `encore run` and on
 * deploy. This script is for environments that provision Postgres outside
 * Encore: it applies the same migrations in lexical order against DATABASE_URL,
 * tracking applied files in a schema_migration table so reruns are idempotent.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migration (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".up.sql"))
    .sort();

  for (const file of files) {
    const { rowCount } = await client.query("SELECT 1 FROM schema_migration WHERE filename = $1", [file]);
    if (rowCount) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migration (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`apply  ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
