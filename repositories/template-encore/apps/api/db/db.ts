import { SQLDatabase } from "encore.dev/storage/sqldb";

/**
 * The single application database (spec 001 locked decision; spec 002 INV-2).
 *
 * All access goes through Encore's tagged-template API, which auto-parameterizes
 * every `${...}` interpolation: db.query`SELECT ... WHERE id = ${id}`. There is no
 * string-concatenation path to the database (INV-2).
 *
 * Migrations in ./migrations are applied automatically on `encore run` and deploy.
 */
export const db = new SQLDatabase("app", {
  migrations: "./migrations",
});
