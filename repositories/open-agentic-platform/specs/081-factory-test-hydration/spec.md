---
id: "081-factory-test-hydration"
title: "Factory Test Data Hydration"
feature_branch: "feat/081-factory-test-hydration"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-04-07"
authors: ["open-agentic-platform"]
language: en
summary: >
  Adds a test data hydration layer to the Factory pipeline, enabling adapters to
  generate seed SQL for reference/lookup tables, realistic development fixtures
  for all domain entities, and a shared test fixture module consumed by both
  unit and integration tests. Closes the gap between schema-only DDL output and
  a runnable application with meaningful data.
code_aliases: ["FACTORY_HYDRATION", "TEST_SEED"]
# implements: cleared by spec 108 §8. The seed-pattern work landed inside the
# upstream factory repo (`statecrafting/legacy-factory`); the
# in-tree `factory/adapters/*` directories no longer exist after spec 108
# moved factory state into `factory_adapters` / `factory_contracts` /
# `factory_processes` and removed the in-tree mirror.
references:
  - role: historical
    unit: { kind: directory, path: factory }
---

# 081 — Factory Test Data Hydration

## Purpose

The Factory pipeline currently produces schema-only DDL migrations. No seed data, no development fixtures, and no shared test fixture module are generated. This creates three concrete problems:

1. **Lookup tables are empty.** Entities of enum/lookup nature (e.g., `LocalGeographicArea` with 96 service regions) have no INSERT statements, so the application starts with empty dropdowns and broken filters.
2. **Integration tests have no data.** `docs/TESTING.md` recommends integration tests against a real PostgreSQL instance, but no fixture mechanism exists to populate the test database.
3. **Unit test data is scattered.** Each `*.service.test.ts` file defines its own inline `const sample*` objects. There is no shared fixture module, leading to duplication and drift between test files.

The `acme-vue-node` adapter manifest already declares `seed: "database/seeds/{name}.sql"` and `patterns.data.seed: "patterns/data/seed.md"`, but neither the pattern file nor the seed output is produced. The `next-prisma` adapter has a complete seed pattern (`prisma/seed.ts`) but no fixture module. This spec fills both gaps across all adapters.

## Scope

### In Scope

- **FR-001–003**: Seed data generation for reference/lookup entities
- **FR-004–007**: Development fixture generation for all domain entities
- **FR-008–010**: Shared test fixture module generation
- **FR-011–013**: Pipeline integration (new sub-step 6b-seed, verification gates)
- **FR-014–015**: Build Spec extension with hydration hints
- Adapter implementations for `acme-vue-node` and `next-prisma`

### Out of Scope

- Production data migration or ETL (handled by data-ingestion integrations)
- Performance/load test data generation (bulk synthetic data)
- `encore-react` and `rust-axum` adapter implementations (future specs)
- External data source stubs (e.g., Infomart API mock server)


## Requirements

### Functional Requirements

#### Build Spec Extension

**FR-001: Entity hydration hints**
Each entity in `data_model.entities` MAY declare a `hydration` block:

```yaml
hydration:
  type: enum [reference, transactional, junction]
  seed_count: integer        # Number of seed rows (default: 0 for transactional, all values for reference)
  fixture_count: integer     # Number of dev fixture rows (default: 3)
  fixture_profiles:          # Named fixture profiles for state machine coverage
    - name: string           # e.g., "draft-request", "approved-request"
      description: string    # e.g., "A funding request in draft status"
      field_overrides:       # Fields to set for this profile
        <field_name>: any    # e.g., status: "draft"
```

**FR-002: Hydration type inference**
When `hydration.type` is not explicitly set, the data-scaffolder agent MUST infer it:
- `reference` — entity has no state machine, all fields are descriptive (name, code, description), or entity name matches common lookup patterns (contains "type", "category", "status", "region", "area")
- `junction` — entity exists solely to implement a many-to-many relationship (two FK fields, minimal other fields)
- `transactional` — default; entities with state machines, user-created data, or complex business rules

**FR-003: Seed data derivation for reference entities**
For `reference` type entities, the agent MUST derive seed values from:
1. `enum_values` on enum-typed fields (e.g., `lga_type: enum [urban, rural, mixed]` → 3 seed rows)
2. Business document context when `enum_values` alone are insufficient (e.g., 96 regional LGA names are domain knowledge, not derivable from field constraints alone)
3. A minimum of 3 representative rows when neither source provides values

#### Seed Data Generation

**FR-004: acme-vue-node seed file**
Produce `database/seeds/reference-data.sql` containing:
- `INSERT ... ON CONFLICT DO NOTHING` statements for idempotency
- Dependency-ordered inserts (parent tables before children)
- One transaction block wrapping all inserts
- Comments separating each entity's seed block

```sql
-- Seed: LocalGeographicArea
BEGIN;
INSERT INTO app.local_geographic_area (lga_code, lga_name, lga_region, lga_type)
VALUES
  ('EDM-001', 'Edmonton Central', 'Edmonton', 'urban'),
  ('CGY-001', 'Calgary Central', 'Calgary', 'urban'),
  ('NW-001', 'Peace River', 'Northwest', 'rural')
ON CONFLICT (lga_code) DO NOTHING;
COMMIT;
```

**FR-005: next-prisma seed file**
Extend `prisma/seed.ts` generation to include reference data `upsert` calls derived from the same hydration hints, following the existing seed pattern.

**FR-006: Seed run command**
Each adapter manifest MUST declare a `seed` command in the `commands` section:
- `acme-vue-node`: `"psql $DATABASE_URL -f database/seeds/reference-data.sql"`
- `next-prisma`: `"npx prisma db seed"` (already configured via `package.json`)

**FR-007: Docker Compose seed integration**
For `acme-vue-node`, add a `db-seed` service to the generated `docker-compose.yml` that runs the seed command after the `db` service is healthy:

```yaml
db-seed:
  image: postgres:17-alpine
  depends_on:
    db:
      condition: service_healthy
  volumes:
    - ./database/seeds:/seeds
    - ./database/migrations:/migrations
  entrypoint: >
    sh -c "for f in /migrations/*.sql; do psql $$DATABASE_URL -f $$f; done &&
           for f in /seeds/*.sql; do psql $$DATABASE_URL -f $$f; done"
  environment:
    DATABASE_URL: postgresql://...
```

#### Development Fixture Generation

**FR-008: Fixture SQL file**
Produce `database/seeds/dev-fixtures.sql` (acme-vue-node) or extend `prisma/seed.ts` dev block (next-prisma) containing:
- Realistic sample data for every transactional entity
- `fixture_count` rows per entity (default 3)
- State machine coverage: at least one fixture per terminal state and one per non-terminal state
- Referential integrity: fixture FKs reference seed data or other fixtures
- Guarded by environment: `acme-vue-node` uses a wrapper script that checks `NODE_ENV`; `next-prisma` uses inline `if (process.env.NODE_ENV !== "production")` guard

**FR-009: Fixture profile generation**
When `fixture_profiles` are declared, generate named fixtures that match the profile's `field_overrides`. When not declared, the agent MUST auto-generate profiles from state machine business rules:
- One fixture per state in the state machine
- Realistic field values appropriate to each state (e.g., a `submitted` request has a `submission_date`, an `approved` request has an `approved_amount`)

**FR-010: Mock auth user alignment**
Development fixtures for user-like entities MUST align with the mock auth driver's hardcoded users. For example, if `MockAuthDriver` defines `mock-analyst-1`, fixtures that need an analyst `user_id` MUST reference `mock-analyst-1`.

#### Shared Test Fixture Module

**FR-011: Fixture factory module**
Generate `packages/shared/src/fixtures/index.ts` (acme-vue-node) or `src/lib/fixtures/index.ts` (next-prisma) exporting:
- One factory function per entity: `createSample{Entity}(overrides?: Partial<{Entity}Row>): {Entity}Row`
- Default values that produce a valid, internally-consistent entity instance
- Override support for test-specific variations
- No database dependency — pure in-memory object construction

```typescript
import type { FundingRequestRow } from '../types/funding-request.types.js';

export function createSampleFundingRequest(
  overrides?: Partial<FundingRequestRow>
): FundingRequestRow {
  return {
    request_id: 'test-req-001',
    organization_id: 'test-org-001',
    submitted_by: 'mock-applicant-1',
    request_type: 'new-operational-funding',
    request_status: 'draft',
    fiscal_year: '2025-2026',
    requested_funding_amount: '50000.00',
    proposed_program_name: 'Test Program',
    proposed_start_date: '2026-04-01',
    justification: 'Test justification for funding request.',
    community_need_evidence: 'Community need evidence text.',
    submission_date: null,
    created_at: '2026-01-15T10:00:00.000Z',
    updated_at: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}
```

**FR-012: Fixture module replaces inline test data**
The generated test files (from `api_scaffolder`) MUST import from the fixture module instead of declaring inline `const sample*` objects. This is an update to the API test pattern, not a separate generation step.

**FR-013: Fixture consistency with seed/fixture SQL**
The default values in factory functions MUST match the first row of the corresponding dev-fixture SQL. This ensures unit tests (using factory functions) and integration tests (using SQL fixtures) operate on identical representative data.

#### Pipeline Integration

**FR-014: Sub-step 6b-seed**
Add a new sub-step after 6b (data scaffolding) in stage 06-adapter-handoff:

```
6b. Data Scaffolding (existing — DDL migrations + types + schemas)
6b-seed. Seed & Fixture Generation (NEW)
    1. Invoke adapter's `seed_generator` agent with:
       - Full data_model from Build Spec (all entities, to resolve FKs)
       - business_rules from Build Spec (for state machine profile generation)
       - auth section from Build Spec (for mock user alignment)
       - Adapter's patterns.data.seed pattern file
       - Adapter's directory conventions
    2. Agent generates: seed SQL, fixture SQL, fixture factory module
    3. Verification harness confirms files exist and seed SQL is valid
```

**FR-015: Verification gates**
Add to `verification.schema.yaml`:

```yaml
# In scaffolding_gates, after data scaffolding
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

  - id: "SF-SEED-004"
    name: "Seed SQL is valid"
    type: command
    command: "psql $DATABASE_URL --set ON_ERROR_STOP=1 -f database/seeds/reference-data.sql"
    description: "Seed SQL executes without errors against an empty schema"

# In final_validation.process_checks
- id: "FV-P-006"
  name: "Reference entities have seed data"
  description: "Every entity with hydration.type=reference has entries in the seed file"
  type: cross-reference

- id: "FV-P-007"
  name: "State machine entities have fixture profiles"
  description: "Every entity with a state-machine business rule has fixtures covering all states"
  type: cross-reference
```

### Non-Functional Requirements

**NF-001: Seed idempotency**
All seed and fixture SQL MUST be idempotent. Running seeds multiple times must produce the same result. Use `ON CONFLICT DO NOTHING` (raw SQL) or `upsert` (Prisma).

**NF-002: Environment safety**
Development fixtures MUST never be loadable in production. The `acme-vue-node` seed runner script MUST check `NODE_ENV !== 'production'` before executing `dev-fixtures.sql`. The `next-prisma` seed MUST use the inline guard.

**NF-003: Deterministic output**
Seed and fixture data MUST be deterministic (no `random()`, no `gen_random_uuid()` in VALUES). UUIDs in fixtures use well-known test constants (e.g., `00000000-0000-0000-0000-000000000001`).

**NF-004: Fixture module is zero-dependency**
The fixture factory module MUST import only from `../types/` (project types). No external libraries (faker, fishery, etc.).


## Architecture

### Data Flow

```
Build Spec (data_model + business_rules + auth)
    │
    ▼
┌──────────────────────────┐
│  seed_generator agent    │  ◀── patterns/data/seed.md
│  (per adapter)           │
└──────┬───────────────────┘
       │
       ├── database/seeds/reference-data.sql     (lookup table INSERTs)
       ├── database/seeds/dev-fixtures.sql        (transactional entity INSERTs)
       └── packages/shared/src/fixtures/index.ts  (factory functions)
                │
                ▼
        ┌───────────────┐
        │  api_scaffolder │  ◀── imports fixtures in generated tests
        └───────────────┘
```

### Agent Responsibilities

| Agent | Current Output | New Output |
|-------|---------------|------------|
| `data_scaffolder` | DDL migrations, TS types, Zod schemas | (unchanged) |
| `seed_generator` (NEW) | — | Seed SQL, fixture SQL, fixture module |
| `api_scaffolder` | Service + controller + route + test | Test files now import from fixture module |

### Adapter Manifest Changes

```yaml
# New in commands:
commands:
  seed: string              # e.g., "node scripts/run-seeds.js"

# New in agents:
agents:
  seed_generator: string    # e.g., "agents/seed-generator.md"

# New in directory_conventions:
directory_conventions:
  fixture_module: string    # e.g., "packages/shared/src/fixtures/index.ts"
```


## Implementation Approach

### Phase 1: Contract & Pattern Foundation (~3 days)

1. Extend `build-spec.schema.yaml` with `hydration` block on entities
2. Extend `adapter-manifest.schema.yaml` with `seed` command and `seed_generator` agent
3. Create `patterns/data/seed.md` for `acme-vue-node` adapter
4. Create `agents/seed-generator.md` for `acme-vue-node` adapter
5. Update `acme-vue-node/manifest.yaml` with new fields

### Phase 2: Pipeline Integration (~2 days)

6. Update `06-adapter-handoff.md` with sub-step 6b-seed
7. Update `verification.schema.yaml` with SF-SEED and FV-P gates
8. Update `pipeline-state.schema.yaml` with seed scaffolding progress tracking

### Phase 3: Fixture Module & Test Pattern (~2 days)

9. Create fixture module pattern: `patterns/data/fixture-factory.md` for `acme-vue-node`
10. Update API test pattern (`patterns/api/test.md`) to import from fixture module
11. Repeat patterns for `next-prisma` adapter

### Phase 4: Validation (~1 day)

12. Run factory pipeline against Community Grant Portal Build Spec
13. Verify seed SQL executes, fixtures load, tests pass with fixture module
14. Verify `PF-006` (pattern file exists) passes for new `seed.md`


## Success Criteria

- **SC-001**: Factory pipeline generates `database/seeds/reference-data.sql` with valid, idempotent INSERT statements for all reference entities
- **SC-002**: Factory pipeline generates `database/seeds/dev-fixtures.sql` with realistic sample data covering all state machine states
- **SC-003**: Factory pipeline generates `packages/shared/src/fixtures/index.ts` with factory functions for every entity
- **SC-004**: Generated unit tests import from fixture module — no inline `const sample*` objects
- **SC-005**: Seed SQL executes successfully against a fresh schema (all migrations applied)
- **SC-006**: Dev fixtures are blocked from running in production (`NODE_ENV` guard)
- **SC-007**: All new verification gates (SF-SEED-001 through SF-SEED-004, FV-P-006, FV-P-007) pass


## Dependencies

| Spec | Relationship |
|------|-------------|
| 074-factory-ingestion | Provides the contract schemas this spec extends |
| 075-factory-workflow-engine | Provides the pipeline execution model this spec adds a sub-step to |
| 076-factory-desktop-panel | Must display seed/fixture generation progress in scaffold monitor |
| 077-statecraft-factory-api | Audit trail must log seed generation events |


## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Seed data requires domain knowledge not in Build Spec | Agent generates generic placeholder data | FR-003 allows business document context; hydration hints provide explicit overrides |
| Fixture SQL breaks on schema changes | Fixtures become stale after migration edits | Fixtures are regenerated with every pipeline run; not maintained manually |
| Production data leak via dev fixtures | Sensitive test data reaches production | NF-002 enforces environment guards at multiple layers |
| Large reference datasets bloat seed files | Seed files become unwieldy (>1000 rows) | FR-001 caps `seed_count`; large datasets should use data-ingestion integration instead |
