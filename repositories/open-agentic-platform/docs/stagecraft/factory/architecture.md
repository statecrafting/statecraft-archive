# Factory Architecture

> **Historical layout note (spec 199):** the repository trees sketched in
> this document describe the legacy `legacy-factory` layout. The
> owned `factory` repository follows the 3-layer layout and
> self-declares its adapter identity (`acme-vue-encore`) in its manifest
> (specs 197/199); legacy adapter names below are historical context.

## Problem Statement

Agentic software factories today suffer from three structural flaws:

1. **Process and implementation are welded together.** The pipeline that decides *what* to build is tangled with the code that decides *how* to build it. Changing the tech stack means rewriting the pipeline.

2. **Single-agent context overload.** One agent plays requirements analyst, DBA, API developer, frontend developer, test writer, and validator simultaneously. The combined instruction payload (often 100K+ tokens) exceeds practical working context, causing critical instructions to be compressed away and quality to degrade.

3. **Self-validation.** The same agent that generates code also validates it. This is inherently unreliable — it can't objectively assess its own output.

## Solution: Three-Layer Separation

Factory solves these by separating concerns into three layers with formal contracts between them.

### Layer 1: Process (Universal)

**Location:** `process/`

The process layer is a sequential pipeline that transforms business documents into structured specifications. It is completely technology-agnostic — it never references any framework, language, or component.

**Stages:**
1. **Business Requirements** — Extract entities, use cases, business rules from raw documents
2. **Service Requirements** — Identify audiences, journeys, sitemap, determine variant
3. **Data Model** — Normalize entities, define fields/types/constraints/relationships
4. **API Specification** — Design resource/operation model with auth and traceability
5. **UI Specification** — Define pages with data sources, navigation, and page types

Each stage:
- Has a dedicated agent with a focused prompt (~50 lines, not 1670)
- Produces structured JSON/YAML artifacts (not prose)
- Is followed by an automated verification gate
- Updates durable pipeline state for resumability
- Requires human confirmation before proceeding

**Output:** A complete Build Specification — a tech-free description of what the application does.

### Layer 2: Contract (Interface)

**Location:** `contract/`

Four schemas define the interface between process and implementation:

| Schema | Purpose | Who writes | Who reads |
|--------|---------|-----------|-----------|
| **Build Specification** | What to build (entities, operations, pages, rules) | Process layer (stages 1-5) | Adapter layer (scaffolding agents) |
| **Adapter Manifest** | What an adapter provides (stack, capabilities, commands) | Adapter author (once) | Process layer (pre-flight, scaffolding) |
| **Verification Contract** | What must pass (gates, checks, retry policy) | Framework (shared) | Verification harness (automated) |
| **Pipeline State** | Execution progress (stages, features, errors) | Pipeline orchestrator | Resume logic, human monitoring |

The contract layer makes the separation formal and enforceable. An adapter that satisfies the manifest schema can be plugged in without modifying the process layer.

### Layer 3: Adapter (Pluggable)

**Location:** `adapters/{name}/`

Each adapter implements one technology stack. It contains:

| Component | Purpose | Size |
|-----------|---------|------|
| `manifest.yaml` | Declare capabilities, commands, conventions | ~200 lines |
| `scaffold/` | Base project template to copy | Varies (project skeleton) |
| `agents/` | Focused agent prompts for scaffolding | ~50 lines each, 5-7 agents |
| `patterns/` | Code generation patterns with examples | ~50-100 lines each |
| `validation/invariants.yaml` | Architecture rules (machine-checkable) | ~50 lines |

**Adding a new tech stack = creating a new adapter directory.** The process layer and contract schemas never change.

## Execution Model

### Per-Feature Agent Invocation

The current system invokes one agent for the entire application. Factory invokes a **fresh agent per feature**:

```
For each API operation in Build Spec:
  1. Start fresh agent context
  2. Load: operation spec (200 tokens) + pattern file (500 tokens) + conventions (200 tokens)
  3. Agent generates: service + controller + route + test
  4. Verification harness runs: compile + test
  5. If fail: feed error to agent, retry (max 3)
  6. If pass: commit to pipeline state, next operation
```

**Each agent invocation uses ~1-3K tokens of input context** — not 100K+. Quality is consistent across the first and fiftieth feature because context never accumulates.

### Build-Test-Fix Loop

Every scaffolded feature goes through a mandatory verification cycle:

```
generate → compile → test → [pass: next] or [fail: retry with error]
```

This replaces the current one-shot model where all code is generated, then you hope it works.

### Durable State

Pipeline state is written to `.factory/pipeline-state.json` after every successful step:

- **Stage completion** — which stages have passed their gates
- **Feature completion** — which operations/pages have been scaffolded and verified
- **Error log** — what failed, how many retries, error messages

If a session crashes, a new session reads the state file, skips completed work, and resumes from the last checkpoint.

## Comparison to Current System

| Dimension | Upstream (legacy-factory + template) | Factory |
|-----------|----------------------------------|--------|
| Process/implementation coupling | Welded — factory references Express, Vue | Separated by contract schema |
| Adding a new tech stack | Rewrite factory + template orchestrators | Create new adapter directory |
| Agent context per invocation | 100K+ tokens (overflows, degrades) | 1-3K tokens (bounded, fresh) |
| Agents per pipeline | 1 monolithic agent | 8+ specialized, focused agents |
| Validation | Self-assessed markdown checklist | Automated harness (compile, test, lint) |
| Iteration | One-shot generation | Build-test-fix loop (max 3 retries) |
| Crash recovery | None — restart entire pipeline | Durable state — resume from checkpoint |
| Instruction payload | 1670-line orchestrator + 593-line factory + 13 skills | ~50-line prompts per agent |
| Audit trail | Missing in output | Preserved in .factory/ directory |

## Directory Layout

```
factory/
├── process/
│   ├── stages/
│   │   ├── 00-pre-flight.md          Validate inputs, check adapter
│   │   ├── 01-business-requirements.md Extract entities, UCs, BRs
│   │   ├── 02-service-requirements.md  Audiences, journeys, sitemap
│   │   ├── 03-data-model.md           Normalize entities, constraints
│   │   ├── 04-api-specification.md    Resource/operation model
│   │   ├── 05-ui-specification.md     Pages, data sources, navigation
│   │   └── 06-adapter-handoff.md      Scaffolding orchestration
│   └── agents/
│       ├── pipeline-orchestrator.md       Sequencing and state management
│       ├── scaffolding-orchestrator.md    Adapter handoff and build-test-fix loops
│       ├── business-requirements-analyst.md  Stage 1 agent
│       ├── service-designer.md            Stage 2 agent
│       ├── data-architect.md              Stage 3 agent
│       ├── api-architect.md               Stage 4 agent
│       └── ui-architect.md                Stage 5 agent
│
├── contract/
│   ├── schemas/
│   │   ├── build-spec.schema.yaml         What to build (tech-free)
│   │   ├── adapter-manifest.schema.yaml   What an adapter provides
│   │   ├── pipeline-state.schema.yaml     Execution state
│   │   ├── verification.schema.yaml       Gates and checks
│   │   └── stage-outputs/                 JSON Schemas for stage artifacts
│   │       ├── entity-model.schema.json
│   │       ├── use-cases.schema.json
│   │       ├── business-rules.schema.json
│   │       ├── audiences.schema.json
│   │       └── sitemap.schema.json
│   └── examples/
│       ├── community-grant-portal.build-spec.yaml  Example Build Spec
│       ├── acme-vue-node.adapter-manifest.yaml  First adapter manifest
│       └── stage-outputs/                 Example intermediate artifacts
│
├── adapters/
│   ├── acme-vue-node/                      Vue 3 + Express 5 + Design System
│   │   ├── manifest.yaml                  Capabilities and conventions
│   │   ├── agents/                        6 focused prompts (<65 lines each)
│   │   ├── patterns/                      11 code generation patterns
│   │   │   ├── api/                       service, controller, route, test
│   │   │   ├── ui/                        view, state, route, test
│   │   │   ├── data/                      migration, query, validation-schema
│   │   │   └── page-types/                8 page-type patterns
│   │   └── validation/                    19 architecture invariants
│   ├── encore-react/                      Encore.ts + React Router + Drizzle ORM
│   ├── next-prisma/                       Next.js 15 + Prisma + Tailwind CSS
│   │   ├── manifest.yaml                  27 files total
│   │   ├── agents/                        5 agents (api, ui, data, configurer, trimmer)
│   │   ├── patterns/                      16 patterns
│   │   │   ├── api/                       route-handler, service, types, test
│   │   │   ├── ui/                        page, client-component, layout, test
│   │   │   ├── data/                      schema, migration, query, seed
│   │   │   └── page-types/                8 page-type patterns
│   │   └── validation/                    12 architecture invariants
│   └── rust-axum/                         Rust Axum + SQLx + Askama + HTMX
│       ├── manifest.yaml                  26 files total
│       ├── agents/                        5 agents (api, ui, data, configurer, trimmer)
│       ├── patterns/                      15 patterns
│       │   ├── api/                       handler, router, service, test
│       │   ├── ui/                        template, partial, layout, test
│       │   ├── data/                      migration, model, query
│       │   └── page-types/                8 page-type patterns
│       └── validation/                    12 architecture invariants
│
└── docs/
    ├── architecture.md                    This document
    └── adapter-agent-examples.md          Sample adapter agent prompts
```
