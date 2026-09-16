# 081 — Factory Test Data Hydration: Implementation Plan

## Overview

4 phases, 14 steps. Each step lists exact files to create/modify with the changes required. Steps within a phase can be parallelized where noted; phases are sequential.

---

## Phase 1: Contract & Schema Extensions

**Goal:** Extend the factory contract schemas so the pipeline and adapters know about hydration.

### Step 1.1 — Extend Build Spec schema with hydration block

**File:** `factory/contract/schemas/build-spec.schema.yaml`

**Change:** Add `hydration` as an optional block inside `data_model.entities[]`, after `business_rules`:

```yaml
      # Hydration hints for seed/fixture generation
      hydration:
        type:
          enum: [reference, transactional, junction]
        seed_count: integer           # Rows for reference seed (0 = derive from enum_values)
        fixture_count: integer        # Dev fixture rows (default: 3)
        fixture_profiles:
          - name: string              # e.g., "draft-request"
            description: string
            field_overrides:
              <field_name>: any       # e.g., status: "draft"
```

**Why:** This is the Build Spec's tech-agnostic declaration of what data each entity needs. The `seed_generator` agent reads these hints. When omitted, the agent infers `type` from entity shape (FR-002).

---

### Step 1.2 — Extend Adapter Manifest schema

**File:** `factory/contract/schemas/adapter-manifest.schema.yaml`

**Changes (3 locations):**

1. **`commands` section** — add `seed` key:
   ```yaml
   commands:
     # ... existing ...
     seed: string                    # e.g., "node scripts/run-seeds.js"
   ```

2. **`agents` section** — add `seed_generator` as optional agent:
   ```yaml
   agents:
     # ... existing required ...
     seed_generator: string          # Generates seed SQL, fixture SQL, fixture factory module
   ```

3. **`directory_conventions` section** — add `fixture_module`:
   ```yaml
   directory_conventions:
     # ... existing ...
     fixture_module: string          # e.g., "packages/shared/src/fixtures/index.ts"
   ```

---

### Step 1.3 — Extend Pipeline State schema

**File:** `factory/contract/schemas/pipeline-state.schema.yaml`

**Change:** Add `seed` block inside `scaffolding`, between `data` and `api`:

```yaml
scaffolding:
  data:
    # ... existing ...

  seed:
    status:
      enum: [pending, in_progress, completed, failed, skipped]
    files_created: [string]         # Paths of generated seed/fixture/module files
    reference_entities_seeded: [string]
    fixture_entities_generated: [string]
    fixture_profiles_generated:
      - entity: string
        profiles: [string]          # Profile names
    verified_at: datetime

  api:
    # ... existing ...
```

---

### Step 1.4 — Extend Verification Contract

**File:** `factory/contract/schemas/verification.schema.yaml`

**Changes (2 locations):**

1. **New `scaffolding_gates` section** — add `per_data_seed` after the existing `per_api_feature` and `per_ui_feature`:

   ```yaml
   # After seed generation (6b-seed)
   per_data_seed:
     - id: "SF-SEED-001"
       name: "Seed file exists"
       type: file-check
       description: "Reference data seed file exists per adapter conventions"
       files:
         - "adapter.directory_conventions.seed (resolved for 'reference-data')"

     - id: "SF-SEED-002"
       name: "Fixture file exists"
       type: file-check
       description: "Development fixture file exists"
       files:
         - "adapter.directory_conventions.seed (resolved for 'dev-fixtures')"

     - id: "SF-SEED-003"
       name: "Fixture module exists"
       type: file-check
       description: "Shared test fixture factory module exists"
       files:
         - "adapter.directory_conventions.fixture_module"

     - id: "SF-SEED-004"
       name: "Seed SQL is valid"
       type: command
       command: "adapter.commands.seed"
       description: "Seed SQL executes without errors against the migrated schema"
   ```

2. **New `final_validation.process_checks`** — append:

   ```yaml
   - id: "FV-P-006"
     name: "Reference entities have seed data"
     description: "Every entity with hydration.type=reference has INSERT entries in seed file"
     type: cross-reference

   - id: "FV-P-007"
     name: "State machine fixture coverage"
     description: "Every entity with a state-machine business rule has fixtures covering all states"
     type: cross-reference
   ```

**Parallelization:** Steps 1.1–1.4 can all be done in parallel (independent schema files).

---

## Phase 2: Adapter Implementation (acme-vue-node)

**Goal:** Create the missing pattern file and new agent, update the manifest.

### Step 2.1 — Create seed pattern file

**New file:** `factory/adapters/acme-vue-node/patterns/data/seed.md`

This is the missing file that `PF-006` would fail on. Content:

```markdown
# Seed Pattern

Database seeding populates reference/lookup tables and development fixtures.
Two separate files, run in order after migrations.

## Convention

- Reference data: `database/seeds/reference-data.sql`
- Dev fixtures: `database/seeds/dev-fixtures.sql`
- Runner script: `scripts/run-seeds.js` (checks NODE_ENV)
- Idempotent — use `INSERT ... ON CONFLICT DO NOTHING`
- Wrap each entity block in a transaction

## Template — Reference Data

```sql
-- Seed: {EntityName}
-- Source: Build Spec data_model.entities["{EntityName}"].hydration
BEGIN;

INSERT INTO app.{table_name} ({columns})
VALUES
  ({row_1_values}),
  ({row_2_values}),
  ({row_N_values})
ON CONFLICT ({unique_column}) DO NOTHING;

COMMIT;
```

## Template — Dev Fixtures

```sql
-- Fixture: {EntityName} — {profile_name}
-- Profile: {profile_description}
BEGIN;

INSERT INTO app.{table_name} ({columns})
VALUES
  ('{deterministic_uuid}', {field_values})
ON CONFLICT ({pk_column}) DO NOTHING;

COMMIT;
```

## Template — Seed Runner Script

```js
// scripts/run-seeds.js
import { execSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production') {
  console.error('ERROR: Seed scripts cannot run in production.');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

// Migrations first, then seeds
execSync(`psql "${dbUrl}" --set ON_ERROR_STOP=1 -f database/seeds/reference-data.sql`, { stdio: 'inherit' });

if (process.env.LOAD_FIXTURES !== 'false') {
  execSync(`psql "${dbUrl}" --set ON_ERROR_STOP=1 -f database/seeds/dev-fixtures.sql`, { stdio: 'inherit' });
}

console.log('Seed complete.');
```

## Rules

1. `ON CONFLICT DO NOTHING` for idempotency.
2. Insert in FK dependency order (parent tables first).
3. One `BEGIN/COMMIT` block per entity.
4. Dev fixtures use deterministic UUIDs (`00000000-0000-0000-0000-00000000NNNN`).
5. Dev fixture user references MUST match mock auth driver user IDs.
6. No `random()`, `gen_random_uuid()`, or `now()` in VALUES — all literal.
7. Comments before each entity block: entity name, source, profile name.
```

---

### Step 2.2 — Create fixture factory pattern file

**New file:** `factory/adapters/acme-vue-node/patterns/data/fixture-factory.md`

Content:

```markdown
# Fixture Factory Pattern

In-memory factory functions for test data. Zero external dependencies.

## Convention

- Single file: `packages/shared/src/fixtures/index.ts`
- One function per entity: `createSample{Entity}(overrides?)`
- Returns a complete `{Entity}Row` with realistic defaults
- Defaults match the first dev-fixture SQL row (consistency)

## Template

```ts
import type { {Entity}Row } from '../types/{entity}.types.js';

export function createSample{Entity}(
  overrides?: Partial<{Entity}Row>
): {Entity}Row {
  return {
    {pk_field}: '{deterministic_test_id}',
    // ... all fields with realistic default values ...
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}
```

## Rules

1. Import only from `../types/` — no external dependencies.
2. Every field present — no optional fields omitted.
3. FK values reference other factory defaults (e.g., `organization_id: 'test-org-001'`).
4. User ID fields reference mock auth driver IDs (e.g., `submitted_by: 'mock-applicant-1'`).
5. Deterministic values only — no `Date.now()`, no `crypto.randomUUID()`.
6. Export all functions from a single barrel `index.ts`.
```

---

### Step 2.3 — Create seed generator agent

**New file:** `factory/adapters/acme-vue-node/agents/seed-generator.md`

```markdown
---
id: acme-vue-node-seed-generator
role: Seed & Fixture Generator
context_budget: "~25K tokens"
---

# Seed & Fixture Generator

You generate database seed data, development fixtures, and a shared test fixture module
from the Build Specification.

## You Receive

1. **Full data model** — `data_model` section (all entities, for FK resolution)
2. **Business rules** — `business_rules` section (for state machine coverage)
3. **Auth config** — `auth` section (for mock user alignment)
4. **Patterns** — read from `patterns/data/`:
   - `seed.md` — SQL seed conventions
   - `fixture-factory.md` — TypeScript fixture factory conventions
5. **Directory conventions** — from adapter manifest
6. **Generated type files** — from prior data scaffolding step (for import paths)

## You Produce

1. **Reference data seed** (`database/seeds/reference-data.sql`)
   - INSERT statements for every entity with `hydration.type = reference`
   - Derive values from `enum_values` fields when available
   - Generate 3+ representative rows when enum values insufficient
   - FK dependency order (parent tables first)
   - `ON CONFLICT DO NOTHING` for idempotency

2. **Development fixtures** (`database/seeds/dev-fixtures.sql`)
   - INSERT statements for every entity with `hydration.type = transactional`
   - Generate `fixture_count` rows per entity (default: 3)
   - For entities with state-machine business rules:
     generate one fixture per state (at minimum: one non-terminal, one terminal)
   - User ID fields reference mock auth driver IDs
   - FK fields reference seed data or other fixtures
   - Guarded by runner script (NODE_ENV check)

3. **Seed runner script** (`scripts/run-seeds.js`)
   - Checks NODE_ENV !== 'production'
   - Runs reference-data.sql then dev-fixtures.sql via psql

4. **Fixture factory module** (`packages/shared/src/fixtures/index.ts`)
   - One `createSample{Entity}()` function per entity
   - Default values match first dev-fixture SQL row
   - Override support via `Partial<{Entity}Row>` parameter
   - Imports types from `../types/{entity}.types.js`

## Hydration Type Inference

When `hydration.type` is not set on an entity, infer:
- **reference**: entity has no state machine, fields are descriptive (name, code, description, type), or entity name contains "type", "category", "status", "region", "area", "role"
- **junction**: entity has exactly 2 reference fields and <=3 total non-system fields
- **transactional**: everything else

## Rules

1. All SQL values are literal — no function calls (`random()`, `now()`, `gen_random_uuid()`)
2. UUIDs use deterministic test format: `00000000-0000-0000-0000-00000000NNNN`
3. Fixture user IDs match mock auth driver IDs (e.g., `mock-applicant-1`, `mock-analyst-1`)
4. Fixture FK values reference existing seed data or earlier fixture rows
5. State machine fixtures cover all states, with fields appropriate to each state
6. TypeScript fixture defaults match the first SQL fixture row exactly
7. No external dependencies in fixture module (no faker, no fishery)
```

---

### Step 2.4 — Update acme-vue-node manifest

**File:** `factory/adapters/acme-vue-node/manifest.yaml`

**Changes:**

1. Add `seed` to `commands`:
   ```yaml
   commands:
     # ... existing ...
     seed: "node scripts/run-seeds.js"
   ```

2. Add `seed_generator` to `agents`:
   ```yaml
   agents:
     # ... existing ...
     seed_generator: "agents/seed-generator.md"
   ```

3. Add `fixture_module` to `directory_conventions`:
   ```yaml
   directory_conventions:
     # ... existing ...
     fixture_module: "packages/shared/src/fixtures/index.ts"
   ```

4. Add `fixture_factory` to `patterns.data`:
   ```yaml
   patterns:
     data:
       # ... existing ...
       fixture_factory: "patterns/data/fixture-factory.md"
   ```

---

### Step 2.5 — Update API test pattern to use fixture imports

**File:** `factory/adapters/acme-vue-node/patterns/api/test.md`

**Change:** Replace the inline `const sample{Entity}` declaration with an import from the fixture module.

**Before (line ~20):**
```ts
const sample{Entity} = { {entity}_id: '{entity}-1', /* fields */ created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
```

**After:**
```ts
import { createSample{Entity} } from '@shared/fixtures/index.js'

const sample{Entity} = createSample{Entity}()
```

Also update Rule 9 from "Shared sample data at module scope" to:
```
9. **Import sample data from fixture module.** Use `createSample{Entity}()` from `@shared/fixtures/index.js`. Override fields per test with `createSample{Entity}({ field: 'value' })`.
```

**Parallelization:** Steps 2.1–2.5 can all be done in parallel (independent files, except 2.4 references 2.1/2.2/2.3 paths — but those paths are known ahead of time).

---

## Phase 3: Pipeline Integration

**Goal:** Wire the new agent into the stage 6 execution sequence.

### Step 3.1 — Update stage 06 adapter handoff

**File:** `factory/process/stages/06-adapter-handoff.md`

**Change:** Insert new sub-section between `### 6b. Data Scaffolding` and `### 6c. API Scaffolding`:

```markdown
### 6b-seed. Seed & Fixture Generation

After all entity DDL and types are scaffolded:

1. Invoke adapter's `seed_generator` agent with:
   - Full `data_model` from Build Spec (all entities — needed for FK resolution)
   - `business_rules` from Build Spec (for state machine profile generation)
   - `auth` section from Build Spec (for mock user alignment)
   - The adapter's `patterns.data.seed` pattern file
   - The adapter's `patterns.data.fixture_factory` pattern file
   - The adapter's directory conventions
   - Generated type file paths (from 6b pipeline state)
2. Agent generates:
   - `database/seeds/reference-data.sql`
   - `database/seeds/dev-fixtures.sql`
   - `scripts/run-seeds.js`
   - `packages/shared/src/fixtures/index.ts`
3. Verification harness runs `per_data_seed` checks:
   - SF-SEED-001: Seed file exists
   - SF-SEED-002: Fixture file exists
   - SF-SEED-003: Fixture module exists
   - SF-SEED-004: Seed SQL executes against migrated schema

If `seed_generator` agent is not declared in the adapter manifest, skip this step
and mark `scaffolding.seed.status = "skipped"` in pipeline state.

Update pipeline state: record files created, entities seeded, profiles generated.
```

---

### Step 3.2 — Update scaffolding orchestrator agent

**File:** `factory/process/agents/scaffolding-orchestrator.md`

**Change:** Add 6b-seed to the orchestration sequence. After the data scaffolding completion check and before API scaffolding begins, add:

```
4. If adapter declares `seed_generator` agent:
   a. Load agent prompt from adapter.agents.seed_generator
   b. Load patterns: adapter.patterns.data.seed, adapter.patterns.data.fixture_factory
   c. Pass: full data_model, business_rules, auth, directory_conventions, data scaffolding file list
   d. Verify: SF-SEED-001 through SF-SEED-004
   e. Update pipeline-state.json scaffolding.seed
```

---

## Phase 4: next-prisma Adapter Parity

**Goal:** Bring the next-prisma adapter to the same level.

### Step 4.1 — Create next-prisma seed generator agent

**New file:** `factory/adapters/next-prisma/agents/seed-generator.md`

Same structure as acme-vue-node but with Prisma-specific output:
- Extends `prisma/seed.ts` (not separate SQL files)
- Uses `prisma.{entity}.upsert()` for reference data
- Uses `if (process.env.NODE_ENV !== "production")` guard for fixtures
- Fixture module at `src/lib/fixtures/index.ts`

### Step 4.2 — Create next-prisma fixture factory pattern

**New file:** `factory/adapters/next-prisma/patterns/data/fixture-factory.md`

Same as acme-vue-node version but with `src/lib/fixtures/` path and Prisma-generated types imports.

### Step 4.3 — Update next-prisma manifest

**File:** `factory/adapters/next-prisma/manifest.yaml`

Add `seed_generator` agent, `fixture_module` directory convention, `fixture_factory` pattern.
`seed` command already covered by `npx prisma db seed`.

### Step 4.4 — Update next-prisma API test pattern

**File:** `factory/adapters/next-prisma/patterns/api/test.md`

Same fixture import change as acme-vue-node Step 2.5.

---

## Execution Order & Dependencies

```
Phase 1 (parallel)          Phase 2 (parallel)          Phase 3 (sequential)     Phase 4 (parallel)
┌─────────────────┐         ┌─────────────────┐         ┌──────────────────┐     ┌─────────────────┐
│ 1.1 build-spec  │         │ 2.1 seed.md     │         │ 3.1 stage-06     │     │ 4.1 np agent    │
│ 1.2 manifest    │────────▶│ 2.2 fixture.md  │────────▶│ 3.2 orchestrator │────▶│ 4.2 np fixture  │
│ 1.3 pipeline    │         │ 2.3 agent.md    │         └──────────────────┘     │ 4.3 np manifest │
│ 1.4 verification│         │ 2.4 manifest    │                                  │ 4.4 np test     │
└─────────────────┘         │ 2.5 test pattern│                                  └─────────────────┘
                            └─────────────────┘
```

## Files Summary

### New Files (9)

| # | File | Phase |
|---|------|-------|
| 1 | `factory/adapters/acme-vue-node/patterns/data/seed.md` | 2.1 |
| 2 | `factory/adapters/acme-vue-node/patterns/data/fixture-factory.md` | 2.2 |
| 3 | `factory/adapters/acme-vue-node/agents/seed-generator.md` | 2.3 |
| 4 | `factory/adapters/next-prisma/agents/seed-generator.md` | 4.1 |
| 5 | `factory/adapters/next-prisma/patterns/data/fixture-factory.md` | 4.2 |

### Modified Files (9)

| # | File | Phase | Changes |
|---|------|-------|---------|
| 1 | `factory/contract/schemas/build-spec.schema.yaml` | 1.1 | Add `hydration` block to entities |
| 2 | `factory/contract/schemas/adapter-manifest.schema.yaml` | 1.2 | Add `seed` command, `seed_generator` agent, `fixture_module` convention |
| 3 | `factory/contract/schemas/pipeline-state.schema.yaml` | 1.3 | Add `scaffolding.seed` progress block |
| 4 | `factory/contract/schemas/verification.schema.yaml` | 1.4 | Add SF-SEED-001–004, FV-P-006–007 |
| 5 | `factory/adapters/acme-vue-node/manifest.yaml` | 2.4 | Add seed command, seed_generator agent, fixture_module, fixture_factory pattern |
| 6 | `factory/adapters/acme-vue-node/patterns/api/test.md` | 2.5 | Replace inline sample data with fixture import |
| 7 | `factory/process/stages/06-adapter-handoff.md` | 3.1 | Add 6b-seed sub-step |
| 8 | `factory/process/agents/scaffolding-orchestrator.md` | 3.2 | Add seed generation to orchestration sequence |
| 9 | `factory/adapters/next-prisma/manifest.yaml` | 4.3 | Add seed_generator, fixture_module, fixture_factory |

### Validation Checklist

After all changes, verify:

- [ ] `PF-006` passes — `patterns/data/seed.md` now exists for acme-vue-node
- [ ] `SF-SEED-001–004` defined in verification contract
- [ ] `FV-P-006–007` defined in verification contract
- [ ] acme-vue-node manifest references all new files at correct paths
- [ ] next-prisma manifest references all new files at correct paths
- [ ] Stage 06 documents 6b-seed in correct position (after 6b, before 6c)
- [ ] Pipeline state schema tracks seed progress
- [ ] API test pattern imports from fixture module instead of inline sample data
