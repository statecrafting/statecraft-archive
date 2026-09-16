---
id: "142-factory-id-columns-text-cutover"
slug: factory-id-columns-text-cutover
title: "Align factory adapter/process ID column types with substrate-projected synthetic IDs"
status: approved
implementation: complete
owner: bart
created: "2026-05-06"
approved: "2026-05-06"
kind: amendment
domain: platform
risk: low
amends: ["139-factory-artifact-substrate"]
depends_on:
  - "139-factory-artifact-substrate"  # factory artifact substrate (introduces synthetic adapter/process IDs)
code_aliases: ["FACTORY_ID_COLUMNS_TEXT_CUTOVER"]
establishes:
extends:
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
summary: >
  Spec 139 Phase 4 cut over to substrate-projected adapter/process records
  whose runtime IDs are deterministic synthetic strings of the form
  `synthetic-adapter-<orgId8>-<name>` and
  `synthetic-process-<orgId8>-<name>-<version>`. Migration 34 dropped the
  legacy FK constraints on `projects.factory_adapter_id`,
  `scaffold_jobs.factory_adapter_id`, `factory_runs.adapter_id`, and
  `factory_runs.process_id`, but left the columns typed as `uuid`. Every
  Create attempt against the live cluster therefore fails the
  `scaffold_jobs` insert with `invalid input syntax for type uuid:
  "synthetic-adapter-…"`, surfaced to the UI as Encore's generic
  "an internal error occurred" 500. This spec ships migration 38 to
  ALTER the four columns to `text` and switches the Drizzle schema to
  match, completing the substrate cutover.
---

# 142 — Factory ID columns: `uuid` → `text` cutover

## 1. Background

Spec 139 (factory artifact substrate) replaced the spec 108
`factory_adapters` / `factory_processes` lookup tables with a single
content-addressed substrate (`factory_artifact_substrate`). The runtime
identity for adapters and processes shifted from server-issued UUIDs in
the dropped tables to deterministic synthetic strings derived from the
org id and the substrate-projected name/version, so consumers can reach
the same row without round-tripping a UUID PK that no longer exists.

Spec 139 migration 34 (`drop_legacy_factory_tables.up.sql`) dropped the
FK constraints from four dependent columns:

```sql
ALTER TABLE projects        DROP CONSTRAINT IF EXISTS projects_factory_adapter_id_fkey;
ALTER TABLE scaffold_jobs   DROP CONSTRAINT IF EXISTS scaffold_jobs_factory_adapter_id_fkey;
ALTER TABLE factory_runs    DROP CONSTRAINT IF EXISTS factory_runs_adapter_id_fkey;
ALTER TABLE factory_runs    DROP CONSTRAINT IF EXISTS factory_runs_process_id_fkey;
```

But it left the column **types** as `uuid` while the runtime began
writing synthetic strings into them. The column-type mismatch was
latent until a real Create request hit the path —

```
2026-05-06T19:32:45.808Z  level=error  endpoint=createFactoryProject
  Failed query: insert into "scaffold_jobs" (...)
  params: …, synthetic-adapter-2fb9af44-acme-vue-node, …
  invalid input syntax for type uuid: "synthetic-adapter-2fb9af44-acme-vue-node"
```

— surfaced to the user as `an internal error occurred` (Encore's
generic 500 wrapper, with the underlying APIError.internal message
stripped in production).

The same time-bomb exists for `factory_runs` (the desktop's run
reservation path writes both `synthesiseAdapterId(...)` and
`synthesiseProcessId(...)` into `uuid` columns) and for
`projects.factory_adapter_id` (set on every successful Create or
Import). All three variants of the Create form (`single-public`,
`single-internal`, `dual`) fail identically because the failing insert
runs **before** any variant-specific code path.

## 2. Resolution

### 2.1 Migration 38 — ALTER COLUMN TYPE

Single-statement ALTER per column, wrapped in a transaction. Postgres
casts existing UUID values to text losslessly via `USING <col>::text`.

```sql
ALTER TABLE projects
  ALTER COLUMN factory_adapter_id TYPE text USING factory_adapter_id::text;
ALTER TABLE scaffold_jobs
  ALTER COLUMN factory_adapter_id TYPE text USING factory_adapter_id::text;
ALTER TABLE factory_runs
  ALTER COLUMN adapter_id TYPE text USING adapter_id::text;
ALTER TABLE factory_runs
  ALTER COLUMN process_id TYPE text USING process_id::text;
```

NOT NULL is preserved by ALTER COLUMN TYPE. Indexes are rebuilt
in-place. No data is dropped: pre-spec-139 UUID values cast cleanly to
their text representation, and the runtime continues to compare them as
opaque strings.

### 2.2 Schema.ts alignment

The four Drizzle column declarations switch from `uuid("…")` to
`text("…")`:

| File / line | Before | After |
|---|---|---|
| `schema.ts:185`  | `factoryAdapterId: uuid("factory_adapter_id")` | `factoryAdapterId: text("factory_adapter_id")` |
| `schema.ts:984`  | `adapterId: uuid("adapter_id").notNull()` | `adapterId: text("adapter_id").notNull()` |
| `schema.ts:985`  | `processId: uuid("process_id").notNull()` | `processId: text("process_id").notNull()` |
| `schema.ts:1026` | `factoryAdapterId: uuid("factory_adapter_id").notNull()` | `factoryAdapterId: text("factory_adapter_id").notNull()` |

No `.references()` are reintroduced — these columns are bare runtime
identifiers per spec 139's substrate model, not foreign keys.

### 2.3 Down-migration (best-effort, dev only)

`38_factory_id_columns_to_text.down.sql` reverts the column types to
`uuid`. The cast filters out values that are not 36-char canonical
UUIDs (any synthetic string is replaced with NULL on the nullable
column and rejected on the NOT NULL columns), so down-migration MUST
NOT be run on a production database that has any rows referencing
synthetic IDs. The header documents the limitation.

### 2.4 Migration test

`38_factory_id_columns_to_text.test.ts` asserts:

1. Pre-migration, an INSERT of a synthetic string into
   `scaffold_jobs.factory_adapter_id` raises Postgres error code
   `22P02` (`invalid input syntax`).
2. After applying migration 38, the same INSERT succeeds and the row
   round-trips through SELECT with the synthetic string intact.
3. Pre-existing UUID-shaped values cast cleanly to their text
   representation under the migration's `USING <col>::text` clause.

## 3. Acceptance criteria

- Live cluster: POST `/api/projects/factory-create` succeeds end-to-end
  for all three variants (`single-public`, `single-internal`, `dual`)
  on `acme-vue-node @ e1de48c5e37a`.
- `make ci` (warm) is green.
- `npm test` in `platform/services/statecraft/` passes, including the
  new migration 38 test.
- The spec/code coupling gate accepts the change against this spec's
  `implements:` list (no spec 139 edit needed thanks to the spec 133
  amends-aware coupling gate).

## 4. Out of scope

- Re-introducing FK constraints. The substrate model treats these IDs
  as opaque runtime identifiers; there is no surviving table to point
  at, and the synthetic-id format is the contract.
- Renaming columns or restructuring the synthetic-id format. The
  `synthetic-adapter-<orgId8>-<name>` and
  `synthetic-process-<orgId8>-<name>-<version>` shapes are stable and
  consumed by the desktop and the platform sync path; this spec only
  aligns column types to the values already being written.

## 5. Provenance

- Live error captured 2026-05-06T19:32:45Z from
  `kubectl logs -n statecraft-system statecraft-api-677fb8665f-zv2s9`.
- User report 2026-05-06: Create form returns `an internal error
  occurred` for all three variants on statecraft.ing.
- Spec 139 §Phase 4 (T091) — substrate cutover that introduced the
  synthetic-id runtime convention.
- Migration 34 — `drop_legacy_factory_tables.up.sql:38-48` — comment
  declares the columns are "bare UUIDs whose values point into
  factory_artifact_substrate(id)" but the runtime never wrote
  substrate UUIDs; this spec rectifies the declared intent against
  the runtime contract.
