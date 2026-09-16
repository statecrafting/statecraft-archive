# How to Use Factory

Factory turns business documents into working applications through a structured, verifiable pipeline. You provide business requirements; Factory produces a technology-free specification; an adapter generates code for your chosen stack.

> **Adapter naming note (spec 199):** adapters are manifest-declared; the
> owned factory currently ships `acme-vue-encore`. The multi-adapter tables
> below (`acme-vue-node`, `encore-react`, `next-prisma`, `rust-axum`)
> predate the factory consolidation and are retained as historical
> context for the adapter contract's breadth.

This guide walks you through the entire process, starting from your business artifacts.

---

## Prerequisites

- Rust (for `factory-run` CLI and the native verification harness)
- An AI agent runtime (Claude CLI) for executing agent prompts
- A target adapter installed (e.g., `acme-vue-encore`)
- Your business documents (PDFs, Word docs, spreadsheets, meeting notes, etc.)

---

## Step 1: Prepare Your Business Artifacts

Gather every document that describes what your application should do. These are your raw inputs:

- Business requirement documents
- Stakeholder meeting notes
- Process flow diagrams
- Data dictionaries
- User role descriptions
- Regulatory or compliance documents
- Existing system documentation

Place them in a directory accessible to the pipeline:

```
my-project/
  business-docs/
    requirements.pdf
    stakeholder-notes.md
    data-dictionary.xlsx
    process-flows.pdf
```

**Important:** The documents do not need to be in any special format. Plain text, PDF, Word, Markdown, and spreadsheets are all acceptable. The Business Requirements Analyst agent reads and interprets them.

---

## Step 2: Choose an Adapter

Each adapter implements one technology stack. Pick the one that matches your deployment target:

| Adapter | Backend | Frontend | Database | Best For |
|---------|---------|----------|----------|----------|
| `acme-vue-node` | Express 5 | Vue 3 + Enterprise Design System | PostgreSQL (direct SQL) | Enterprise apps |
| `encore-react` | Encore.ts microservices | React Router 7 + Tailwind | PostgreSQL (Drizzle ORM) | SaaS apps with built-in infra |
| `next-prisma` | Next.js 15 App Router | React Server Components + Tailwind | PostgreSQL (Prisma ORM) | Full-stack React apps |
| `rust-axum` | Axum + SQLx | Askama templates + HTMX | PostgreSQL (compile-time SQL) | High-performance, Rust-native apps |

Your adapter choice does **not** affect stages 1-5. The process layer is completely technology-agnostic.

---

## Step 3: Run Pre-Flight Checks (Stage 0)

Initialize the pipeline by telling the orchestrator your adapter and pointing it at your documents:

```
Adapter: next-prisma
Business artifacts: ./business-docs/
```

Pre-flight validates:

1. The adapter manifest exists and conforms to schema
2. At least one readable business document exists
3. The pipeline state is initialized at `.factory/pipeline-state.json`
4. The adapter manifest is copied to `.factory/adapter-manifest.yaml`

If pre-flight fails, it reports exactly what is wrong. Fix the issue and re-run.

---

## Step 4: Business Requirements Analysis (Stage 1)

The **Business Requirements Analyst** agent reads all your documents and extracts:

- **Entities** — every data object the system must track (e.g., User, Organization, FundingRequest)
- **Use Cases** — every action users or the system perform (UC-001, UC-002, ...)
- **Business Rules** — constraints, validations, state machines, authorization rules (BR-001, BR-002, ...)
- **Integrations** — external systems (file storage, email, identity providers)

### Outputs

Written to `requirements/`:

| File | What It Contains |
|------|-----------------|
| `brd.md` | Narrative requirements document (for human review) |
| `entity-model.json` | Entities, fields, types, relationships |
| `use-cases.json` | Use case inventory with actors and flows |
| `business-rules.json` | Named rules with types and entity mappings |
| `integration-register.json` | External system dependencies |

### Verification Gate

The harness checks S1-001 through S1-004 automatically:
- BRD exists and is non-empty
- Entities extracted with fields
- Use cases defined with IDs
- Business rules extracted with types

**You review the output and confirm before the pipeline proceeds.**

---

## Step 5: Service Requirements (Stage 2)

The **Service Designer** agent derives who uses the system and how:

- **Audiences** — distinct user groups with authentication methods and roles
- **Journeys** — per-audience workflow step sequences
- **Sitemap** — every page the application needs, with page types
- **Variant** — deployment topology: `single-public`, `single-internal`, or `dual`

The variant determines whether your application is a single deployment or needs separate public/internal stacks (e.g., citizen-facing + staff-facing).

### Capability Check

After the variant is determined, Factory checks the adapter:
- If `dual` variant but adapter lacks `dual_stack` capability: **STOP** — choose a different adapter or adjust requirements
- If an auth method is needed but adapter doesn't support it: **STOP** — report incompatibility

### Outputs

Written to `requirements/`:

| File | What It Contains |
|------|-----------------|
| `audiences.json` | Audience definitions with roles and permissions |
| `journeys.json` | User journey maps per audience |
| `sitemap.json` | Page inventory with view types |
| `variant.json` | Derived variant with rationale |

Gate: S2-001 through S2-003. Review and confirm.

---

## Step 6: Data Model Design (Stage 3)

The **Data Architect** refines the entity model into a fully normalized, constraint-complete data model:

- Normalize to at least 3NF
- Define every field with precise types and constraints
- Specify all relationships with on-delete behavior
- Map business rules to entities
- Define indexes for query performance
- Express check constraints as named rules

### Output

`requirements/data-model.json` — the authoritative entity model consumed by the API specification and the adapter's data scaffolder.

Gate: S3-001 through S3-003. Review and confirm.

---

## Step 7: API Specification (Stage 4)

The **API Architect** designs the complete API surface:

- **Resources** grouped by entity
- **Operations** for each use case (method, path, audience, auth, request/response shapes)
- **Business rule enforcement** linked to operations
- **Traceability** — every operation maps to use cases (UC-xxx) and test cases (TC-xxx)

### Output

The `api`, `auth`, `project`, and `business_rules` sections of `.factory/build-spec.yaml` are populated.

Gate: S4-001 through S4-005 (Build Spec produced, UC coverage, entity CRUD coverage, auth specified, business rules linked). Review and confirm.

---

## Step 8: UI Specification (Stage 5)

The **UI Architect** defines every page:

- Page type (landing, dashboard, list, detail, form, content, help, profile, login, error)
- Data sources (which API operations each page calls)
- Navigation structure (sections, ordering)
- Auth requirements and role restrictions
- Traceability to use cases and test cases

### Output

The `ui` section and remaining sections (integrations, notifications, audit, traceability) of `.factory/build-spec.yaml` are populated. The **Build Specification is now complete and frozen**.

Gate: S5-001 through S5-003 (pages defined, API reachability, navigation complete). Review and confirm.

---

## Step 9: Adapter Handoff & Scaffolding (Stage 6)

This is where code gets generated. The **Scaffolding Orchestrator** manages the process, but adapter-specific agents do the actual work.

### 9a. Initialize Project

The adapter's scaffold template is copied to your project directory. Dependencies are installed and the base project is verified to compile.

### 9b. Data Scaffolding

For each entity in the Build Spec, the adapter's **data scaffolder** generates:

| Adapter | What Gets Generated |
|---------|-------------------|
| `acme-vue-node` | SQL migrations + TypeScript types + Zod schemas |
| `encore-react` | Drizzle schema + SQL migrations + DB declarations |
| `next-prisma` | Prisma schema models + migrations + seed data |
| `rust-axum` | SQL migrations + Rust model structs with SQLx derives |

### 9c. API Scaffolding

For **each operation** (not all at once), a fresh agent invocation generates the backend code:

| Adapter | What Gets Generated |
|---------|-------------------|
| `acme-vue-node` | Service + Controller + Route + Test |
| `encore-react` | Encore `api()` endpoint + Test |
| `next-prisma` | Route Handler + Service + Test |
| `rust-axum` | Axum handler + Router config + Service + Test |

After each operation, the verification harness runs:
1. **Compile** — does the project still build?
2. **Test** — do all tests pass?

If verification fails, the error output is fed back to the agent for a retry (max 3 attempts). If all retries fail, the operation is flagged for manual review and the pipeline continues.

### 9d. UI Scaffolding

For **each page**, the same per-feature approach:

| Adapter | What Gets Generated |
|---------|-------------------|
| `acme-vue-node` | Vue SFC + Pinia store + Router entry + Test |
| `encore-react` | React Router route + Component + Test |
| `next-prisma` | Server Component page + Client Components + Server Actions + Test |
| `rust-axum` | Askama template + HTMX interactions + Test |

Each page goes through the compile + test verification loop.

### 9e. Configure

The adapter's **configurer** applies project identity:
- Package names and descriptions
- Environment variables
- Auth wiring (providers, session stores)
- Theme and branding

### 9f. Trim

The adapter's **trimmer** removes unused scaffold artifacts:
- Template boilerplate pages
- Unused modules per variant
- Dead imports from removed files

### 9g. Final Validation

The verification harness runs all final checks:

**Process checks:**
- Every use case maps to at least one API operation
- Every test case maps to a test file
- Every entity maps to a migration
- No unfilled `{{PLACEHOLDER}}` patterns in source

**Adapter checks:**
- Full build passes
- All tests pass
- Lint passes
- Type check passes
- Format check passes
- All architecture invariants pass

If everything passes, the pipeline status is set to `completed`.

---

## What You End Up With

A working application with:

- Database migrations for every entity
- Backend endpoints for every API operation
- Frontend pages for every UI specification
- Tests for every feature
- Auth wired and configured
- All scaffold boilerplate removed

Plus a complete audit trail in `.factory/`:

```
.factory/
  pipeline-state.json    # Full execution history
  build-spec.yaml        # The frozen specification
  adapter-manifest.yaml  # Resolved adapter capabilities
```

---

## Pipeline State & Crash Recovery

Factory writes pipeline state after every step. If a session crashes:

1. Start a new session
2. Point it at the same project directory
3. The orchestrator reads `.factory/pipeline-state.json`
4. Completed stages and features are skipped
5. Work resumes from the last pending item

You never lose progress.

---

## Human Checkpoints

The pipeline pauses for human confirmation at six points:

1. After Stage 1 (Business Requirements) — review extracted entities, use cases, rules
2. After Stage 2 (Service Requirements) — review audiences, sitemap, variant
3. After Stage 3 (Data Model) — review normalized entities and constraints
4. After Stage 4 (API Specification) — review operations, auth, traceability
5. After Stage 5 (UI Specification) — review pages, navigation, data sources
6. After Stage 6 (Final Validation) — review completed application

At any checkpoint you can:
- **Confirm** — proceed to the next stage
- **Reject** — provide feedback, the stage agent re-runs with your corrections
- **Abort** — stop the pipeline (state is preserved for later resumption)

---

## Creating a New Adapter

To add support for a new technology stack, create a directory under `adapters/` with:

```
adapters/my-stack/
  manifest.yaml              # Stack declaration and capabilities
  agents/
    api-scaffolder.md        # Generates backend code for one operation
    ui-scaffolder.md         # Generates frontend code for one page
    data-scaffolder.md       # Generates database schema and migrations
    configurer.md            # Applies project identity and auth config
    trimmer.md               # Removes unused scaffold artifacts
  patterns/
    api/                     # Code generation patterns for backend
    ui/                      # Code generation patterns for frontend
    data/                    # Code generation patterns for data layer
    page-types/              # Patterns for each page type
  validation/
    invariants.yaml          # Architecture rules (machine-checkable)
  scaffold/                  # Base project template (optional)
```

### Manifest Requirements

Your `manifest.yaml` must declare:

- **Stack** — language, runtime, backend/frontend frameworks, database
- **Capabilities** — boolean flags for what features the adapter supports
- **Commands** — shell commands to install, compile, test, lint, and dev
- **Directory conventions** — path templates with `{resource}`, `{entity}`, `{stack}` placeholders
- **Patterns** — file paths to code generation patterns
- **Agents** — file paths to agent prompts
- **Invariants** — architecture rules with check types and severity

### Agent Requirements

Each agent prompt should be:
- **Focused** — one job per agent (~50 lines, not 1000+)
- **Context-bounded** — receives only what it needs (one operation, one page)
- **Pattern-driven** — reads pattern files before generating code
- **Rules-based** — explicit do/don't rules at the bottom

### Pattern Requirements

Each pattern file should contain:
- **Convention** — how the code is organized
- **Template** — skeleton code with placeholders
- **Example** — real working code from a project
- **Rules** — 5-10 critical constraints

### Invariant Requirements

Every invariant must be machine-checkable:

| Check Type | What It Does |
|-----------|-------------|
| `grep-absent` | Pattern must NOT appear in scope |
| `grep-present` | Pattern MUST appear in scope |
| `file-exists` | File must exist |
| `command-succeeds` | Shell command must exit 0 |

Do not use prose or subjective criteria. If a machine can't check it, it's not an invariant.

---

## Example: End-to-End with the Site Monitor

To see a complete Build Specification, look at `contract/examples/site-monitor.build-spec.yaml`. This defines a simple uptime monitoring application with:

- 2 entities (Site, Check)
- 4 API operations (list, add, delete sites; get status)
- 6 UI pages (landing, sign-in, sign-up, dashboard, settings, admin users)
- 1 business rule (automated hourly checks)
- Session-based auth with user and admin roles

Running this through the `encore-react` adapter produces:
- Encore.ts services with typed `api()` endpoints
- React Router pages with TanStack Query
- Drizzle ORM schema and migrations
- Vitest test files for each feature

Running the same Build Specification through `next-prisma` would produce:
- Next.js Route Handlers with Server Actions
- React Server Component pages with Tailwind CSS
- Prisma schema and migrations
- Vitest test files for each feature

The Build Specification is identical. Only the generated code changes.

---

## Quick Reference

### Pipeline Stages

| Stage | Agent | Input | Output |
|-------|-------|-------|--------|
| 0 | Orchestrator | Business docs + adapter name | Pipeline state initialized |
| 1 | Business Requirements Analyst | Business docs | Entities, use cases, business rules |
| 2 | Service Designer | Stage 1 artifacts | Audiences, sitemap, variant |
| 3 | Data Architect | Stages 1-2 artifacts | Normalized data model |
| 4 | API Architect | Stages 1-3 artifacts | API resource/operation model |
| 5 | UI Architect | Stages 1-4 artifacts | Page specifications |
| 6 | Scaffolding Orchestrator | Build Spec + adapter | Working application |

### Key Principle

The factory never generates code. It produces structured specifications. Adapters generate code.

### Key Files

| File | Purpose |
|------|---------|
| `.factory/build-spec.yaml` | Complete, tech-free application specification |
| `.factory/adapter-manifest.yaml` | Resolved adapter capabilities |
| `.factory/pipeline-state.json` | Durable execution state (crash recovery) |
| `contract/schemas/build-spec.schema.yaml` | Schema for Build Specifications |
| `contract/schemas/adapter-manifest.schema.yaml` | Schema for adapter manifests |
| `contract/schemas/verification.schema.yaml` | Schema for verification gates |

---

## Troubleshooting

### Pre-flight fails with "capability mismatch"

Your Build Spec requires a feature the adapter doesn't support (e.g., `dual_stack`, `file_uploads`). Either choose a different adapter or simplify the requirements.

### Feature scaffolding fails after 3 retries

The generated code doesn't compile or pass tests. Check `.factory/pipeline-state.json` for the error details. Common causes:
- Missing dependency in the scaffold template
- Conflicting type definitions between features
- Database migration ordering issue

Fix the issue manually, update pipeline state, and resume.

### Gate check fails with "cross-reference" error

A use case or entity referenced in one artifact doesn't appear in another. Go back to the failing stage and ensure all IDs are consistent across artifacts.

### "No adapter found" at pre-flight

The adapter name doesn't match any directory under `adapters/`. Check spelling and ensure the adapter has a valid `manifest.yaml`.
