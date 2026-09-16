// schema.ts <-> migrated-SQL drift gate (DB-bound; runs under `encore test`).
//
// schema.ts (the Drizzle query model) and api/db/migrations/1_baseline.up.sql
// (the applied SQL) are maintained independently, so they can silently drift:
// for example the 'cancelled' status that was once missing from the baseline
// enum, or a column typed integer in one and bigint in the other. This suite
// fails when they disagree:
//   * every exported Drizzle table gets a zero-row SELECT of its declared
//     columns; a column absent from the migrated schema makes Postgres reject
//     the query, failing the test by table name.
//   * every exported pgEnum has its declared labels compared to the labels the
//     database actually carries, catching value drift in either direction.
//
// Excluded from bare `npm test`; the live baseline-applied database is provided
// by `encore test` (see vite.config.ts exclude list).

import { describe, expect, it } from "vitest";
import { is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "./drizzle";
import * as schema from "./schema";

// drizzle-orm 0.45 does not export the PgEnum class, so pgEnum instances are
// detected by shape: they carry a string enumName and an array of enumValues.
type EnumLike = { enumName: string; enumValues: readonly string[] };
function isEnumLike(value: unknown): value is EnumLike {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as EnumLike).enumName === "string" &&
    Array.isArray((value as EnumLike).enumValues)
  );
}

// `Object.entries(schema)` is strongly typed to the union of every export, which
// makes the type-predicate filters below non-assignable under tsc. Widen the
// value to `unknown` so the predicates narrow cleanly (the runtime guards are
// what actually select tables vs enums).
const schemaEntries = Object.entries(schema) as Array<[string, unknown]>;
const tables = schemaEntries.filter(
  (entry): entry is [string, PgTable] => is(entry[1], PgTable),
);
const enums = schemaEntries.filter(
  (entry): entry is [string, EnumLike] => isEnumLike(entry[1]),
);

describe("schema.ts <-> database drift", () => {
  // A filter that silently matched nothing would make this gate vacuously
  // green; assert the introspection actually found the schema surface.
  it("discovers tables and enums", () => {
    expect(tables.length).toBeGreaterThan(0);
    expect(enums.length).toBeGreaterThan(0);
  });

  describe("every Drizzle table's columns exist in the migrated schema", () => {
    for (const [name, table] of tables) {
      it(name, async () => {
        await db.select().from(table).limit(0);
      });
    }
  });

  describe("every pgEnum's labels match the database", () => {
    for (const [name, pgEnum] of enums) {
      it(name, async () => {
        const declared = [...pgEnum.enumValues].sort();
        const result = await db.execute(
          sql`SELECT e.enumlabel AS label
              FROM pg_enum e
              JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = ${pgEnum.enumName}
              ORDER BY e.enumlabel`,
        );
        const actual = (result.rows as Array<{ label: string }>)
          .map((row) => row.label)
          .sort();
        expect(actual).toEqual(declared);
      });
    }
  });
});
