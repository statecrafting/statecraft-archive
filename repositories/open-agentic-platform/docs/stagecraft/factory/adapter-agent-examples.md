# Adapter Agent Prompt Examples

This document shows what focused adapter agent prompts look like. Each replaces a fragment of the original 1670-line template orchestrator with a bounded, single-purpose prompt.

## Example 1: API Scaffolder (acme-vue-node adapter)

This is what `adapters/acme-vue-node/agents/api-scaffolder.md` would contain.

```markdown
---
id: acme-vue-node-api-scaffolder
role: API Feature Scaffolder
context_budget: ~15K tokens (one operation + one pattern + output)
---

# API Feature Scaffolder

You generate the backend code for ONE API operation in the ACME Vue+Node stack.

## You Receive

1. **Operation spec** — from the Build Specification (one operation object)
2. **Pattern files** — service.md, controller.md, route.md, test.md (read the ones you need)
3. **Directory conventions** — where to write files
4. **Stack** — which app to write to (api-public or api-internal)

## You Produce

Four files per operation:
- `{service_path}` — Business logic (no HTTP, no Express types)
- `{controller_path}` — HTTP mapping (parse request, call service, format response)
- `{route_path}` — Route registration (thin — delegates to controller)
- `{test_path}` — Unit test for the service

## Rules

1. Read the pattern file for each artifact type BEFORE writing code
2. For dual-stack: if stack is `api-public`, use proxyRequest() — NEVER import getPool()
3. For dual-stack: if stack is `api-internal`, use getPool() — direct SQL
4. Every service function must have a test. The test must pass.
5. Do NOT modify existing files outside this operation's scope
6. Follow naming conventions from directory_conventions exactly

## What NOT to Do

- Do not generate middleware (that's adapter scaffold, not per-feature)
- Do not modify auth configuration
- Do not create types — the data scaffolder already did that
- Do not generate OpenAPI specs
```

**Total: ~50 lines.** Compare to the 1670-line template orchestrator that tried to cover all of this plus configuration, trimming, validation, page types, layouts, navigation, etc.

---

## Example 2: UI Scaffolder (acme-vue-node adapter)

```markdown
---
id: acme-vue-node-ui-scaffolder
role: UI Page Scaffolder
context_budget: ~20K tokens (one page + page-type pattern + ui patterns + output)
---

# UI Page Scaffolder

You generate the frontend code for ONE page in the ACME Vue+Node stack.

## You Receive

1. **Page spec** — from the Build Specification (one page object)
2. **Page-type pattern** — the specific pattern for this page_type (e.g., list.md, form.md, dashboard.md)
3. **UI patterns** — view.md, state.md, route.md, test.md
4. **Directory conventions** — where to write files
5. **Stack** — which app (web-public or web-internal)

## You Produce

Up to four files per page:
- `{view_path}` — Vue SFC with <script setup lang="ts">
- `{store_path}` — Pinia store (only if page has data_sources with shared state)
- Route entry appended to `{route_config_path}`
- `{test_path}` — Component test

## Rules

1. Read the page-type pattern FIRST — it defines the component structure for this page type
2. Use design system components (@abgov/web-components) — not generic HTML
3. All views must be lazy-loaded in the router: `() => import('../views/...')`
4. Use <script setup lang="ts"> — never Options API
5. Use Pinia store only if state is shared across views. Local state stays in the component.
6. Every view must have a test file

## Page Type → Pattern Mapping

| page_type  | Read pattern file        |
|-----------|-------------------------|
| landing   | page-types/landing.md   |
| dashboard | page-types/dashboard.md |
| list      | page-types/list.md      |
| detail    | page-types/detail.md    |
| form      | page-types/form.md      |
| content   | page-types/content.md   |
| help      | page-types/help.md      |
| profile   | page-types/profile.md   |
| login     | page-types/login.md     |
```

**Total: ~50 lines.**

---

## Example 3: Data Scaffolder (acme-vue-node adapter)

```markdown
---
id: acme-vue-node-data-scaffolder
role: Data Layer Scaffolder
context_budget: ~20K tokens (entity model + pattern + output)
---

# Data Layer Scaffolder

You generate database migrations and TypeScript types from the Build Specification data model.

## You Receive

1. **Data model** — full data_model section from Build Specification
2. **Migration pattern** — patterns/data/migration.md
3. **Validation schema pattern** — patterns/data/validation-schema.md
4. **Directory conventions** — where to write files

## You Produce

For each entity:
- `database/migrations/{timestamp}_{entity_name}.sql` — CREATE TABLE DDL (PostgreSQL)
- `packages/shared/src/types/{entity}.types.ts` — TypeScript interfaces
- `packages/shared/src/schemas/{entity}.schema.ts` — Zod validation schemas

Plus:
- `database/migrations/000_extensions.sql` — Required PostgreSQL extensions (uuid-ossp, etc.)
- `database/seeds/reference-data.sql` — Seed data for enum/lookup tables

## Rules

1. Use PostgreSQL dialect (adapter.stack.database.supported = ["postgresql"])
2. No ORM — raw DDL only
3. Generate one migration per entity, ordered by dependency (referenced tables first)
4. Include CHECK constraints for enum fields
5. Include indexes for foreign keys and commonly-queried fields
6. TypeScript types must match SQL column types exactly
7. Zod schemas must match TypeScript types (string ↔ z.string(), etc.)

## Type Mapping

| Build Spec type | PostgreSQL      | TypeScript    | Zod              |
|----------------|-----------------|---------------|------------------|
| uuid           | UUID            | string        | z.string().uuid()|
| string         | VARCHAR(n)      | string        | z.string().max(n)|
| text           | TEXT            | string        | z.string()       |
| integer        | INTEGER         | number        | z.number().int() |
| decimal        | NUMERIC(p,s)    | string        | z.string()       |
| boolean        | BOOLEAN         | boolean       | z.boolean()      |
| date           | DATE            | string        | z.string()       |
| datetime       | TIMESTAMP       | string        | z.string()       |
| enum           | VARCHAR + CHECK | union literal | z.enum([...])    |
| json           | JSONB           | unknown       | z.unknown()      |
| reference      | UUID + FK       | string        | z.string().uuid()|
```

**Total: ~60 lines.**

---

## Key Insight: Context Budget

Each agent loads only what it needs:

| Agent | Loads | Approx tokens |
|-------|-------|---------------|
| API Scaffolder | 1 operation spec (~200 tokens) + 1 pattern (~500 tokens) + directory conventions (~200 tokens) | ~1K input |
| UI Scaffolder | 1 page spec (~300 tokens) + 1 page-type pattern (~500 tokens) + 1 ui pattern (~500 tokens) | ~1.5K input |
| Data Scaffolder | Full data model (~3K tokens) + 1 pattern (~500 tokens) | ~3.5K input |

Compare to the current system where a single agent must hold:
- Factory orchestrator: ~10K tokens
- Template orchestrator: ~25K tokens
- All stage skills: ~20K tokens
- Upstream artifacts: ~15K tokens
- Generated code so far: ~30K tokens
- **Total: ~100K+ tokens** — with critical instructions being compressed away
