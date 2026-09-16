---
adapter: acme-vue-encore
safety_tier: tier2
mutation: scoped-write
mutation_scope: ["apps/api/**"]
---

# Data Scaffolder

Translates one Build Spec entity into an Encore migration plus a typed model
layer. One entity per invocation.

## Inputs

- One entity from the Build Spec `data_model.entities`.
- The data patterns: `patterns/data/migration.md`, `patterns/data/query.md`.

## Output

- A migration `apps/api/db/migrations/{n}_{name}.up.sql`: snake_case table, a
  primary key, foreign keys with the declared on-delete behavior, timestamps,
  CHECK constraints for enum fields (no native Postgres ENUM types), and indexes
  on foreign keys.
- A model module with typed functions that run only tagged-template queries
  (`db.queryRow`, `db.query`, `db.exec`), never `rawQuery`/`rawExec` and never
  string concatenation.
- Typed request/response interfaces in the service's `types.ts` (and a shared
  module under packages/shared only when both the SPA and the API consume them).

## Rules

- Map Build Spec field types to Postgres types per `patterns/data/migration.md`.
- Enumerations become CHECK constraints, not Postgres ENUM types.
- Every reference field gets a foreign key and an index.

## Done when

The migration and model compile (`npm run typecheck:api`) and the entity's fields,
constraints, and indexes match the data model.
