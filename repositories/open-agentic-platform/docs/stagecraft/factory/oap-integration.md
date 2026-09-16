# Factory + Open Agentic Platform: Integration Architecture

## The Match

Factory and OAP solve complementary problems and share structural DNA:

| Concern | Factory | OAP | Integration |
|---------|--------|-----|-------------|
| Workflow sequencing | Pipeline Orchestrator (stages 0-6) | `crates/orchestrator` (DAG manifest) | Factory pipeline **becomes** an OAP workflow manifest |
| Artifact passing | `.factory/` directory (build-spec, pipeline-state) | `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/` | Factory artifacts map 1:1 to OAP step artifacts |
| Agent invocation | Per-feature agent with ~1-3K token context | `dispatch_via_governed_claude()` — Claude CLI spawn | Each Factory agent invocation = one OAP governed dispatch |
| Verification | Harness checks (schema validation, grep, commands) | Policy gates (checkpoint, approval, tier enforcement) | Factory gates become OAP checkpoint gates |
| Human review | Stage handoff reports with confirm/reject | `GateHandler::await_checkpoint()` → UI dialog | Factory confirmations surface in OPC desktop |
| Crash recovery | `.factory/pipeline-state.json` | `WorkflowState` in `state.json` (FR-001) | OAP state subsumes Factory state — single source of truth |
| Governance | Invariants (grep-absent, command-succeeds) | axiomregent (tier enforcement, permission flags) | Adapter invariants become axiomregent policy rules |

---

## Architecture: Three-Level Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 1: PLATFORM (Statecraft — organizational control plane)      │
│                                                                       │
│  Project creation → adapter selection → business doc upload           │
│  Policy assignment → audit trail → deployment trigger                 │
│                                                                       │
│  Statecraft knows: which org, which project, which adapter,           │
│  which policy bundle, who approved what stage                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP/WS (project config + policy bundle)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 2: OPC DESKTOP (Tauri — local orchestration cockpit)         │
│                                                                       │
│  Orchestrator loads Factory workflow manifest (DAG of stages)          │
│  Each stage = WorkflowStep with agent, inputs, outputs, gate          │
│  Scaffolding fan-out = dynamic sub-steps (one per feature)            │
│                                                                       │
│  OPC knows: current step, artifact paths, gate decisions,             │
│  token budget, retry count, live agent output                         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Claude CLI spawn (governed via axiomregent)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  LEVEL 3: CLAUDE CLI (localhost — per-feature agent execution)      │
│                                                                       │
│  Fresh context per invocation: agent prompt + artifacts (paths)       │
│  axiomregent enforces: file_read ✓, file_write (gated), commands     │
│  Output written to artifact directory, not context                    │
│                                                                       │
│  Claude knows: ONE stage prompt + ONE feature spec + patterns         │
│  (~1-3K tokens input, not 100K+)                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Level 1: Platform Orchestration (Statecraft)

### What Statecraft Manages

Statecraft is the organizational control plane. For Factory integration it handles:

1. **Project registration** — user creates a project, selects "Factory pipeline" as delivery method
2. **Adapter assignment** — org admin or user selects adapter (next-prisma, rust-axum, etc.)
3. **Business document ingestion** — upload raw business docs; store references in project metadata
4. **Policy bundle assignment** — attach org-level policy (which adapters allowed, max token budget, required approvers)
5. **Audit trail** — every stage confirmation, every gate decision, every retry logged to `audit_log` table

### New Statecraft API Surface

```
POST /api/projects/:id/factory/init
  Body: { adapter: "next-prisma", business_docs: ["s3://..."] }
  → Creates .factory/ scaffold, assigns policy bundle

GET  /api/projects/:id/factory/status
  → Returns pipeline state (current stage, completed features, failures)

POST /api/projects/:id/factory/stage/:n/confirm
  → Platform-level stage confirmation (triggers OPC to proceed)

POST /api/projects/:id/factory/stage/:n/reject
  Body: { feedback: "..." }
  → Reject with feedback, stage re-runs

GET  /api/projects/:id/factory/audit
  → Full audit trail: who confirmed what, token spend, error history
```

### Policy Bundle for Factory

Statecraft compiles a policy bundle that travels down to OPC and axiomregent:

```yaml
# Factory-specific policy shard
factory:
  allowed_adapters: ["next-prisma", "rust-axum", "encore-react"]
  max_retry_per_feature: 3
  require_stage_approval: [1, 2, 4, 5]  # which stages need human sign-off
  auto_approve_stages: [0, 3]            # pre-flight and data model can auto-proceed
  token_budget:
    per_stage_agent: 50000
    per_feature_agent: 5000
    total_pipeline: 2000000
  file_write_scope: "src/,prisma/,migrations/,templates/"  # restrict where agents can write
  blocked_patterns: ["rm -rf", "DROP TABLE", "force push"]
```

---

## Level 2: OPC Desktop (Workflow Manifest)

### Factory Pipeline as OAP Workflow

The Factory pipeline translates directly to an OAP `WorkflowManifest`. The key insight: stages 1-5 are a fixed DAG, but stage 6 (scaffolding) fans out into dynamic sub-steps based on the Build Spec content.

#### Phase 1 Manifest: Process Stages (Fixed DAG)

```yaml
# .factory/workflow-manifest.yaml — generated at pre-flight
steps:
  - id: "s0-preflight"
    agent: "factory-preflight"
    effort: quick
    inputs:
      - "/business-docs/"         # external path (no step prefix → pre-existing)
      - "/adapters/next-prisma/manifest.yaml"
    outputs:
      - "pipeline-state.json"
      - "adapter-manifest.yaml"
    instruction: "Validate adapter manifest and business artifacts. Initialize pipeline state."

  - id: "s1-business-requirements"
    agent: "factory-business-analyst"
    effort: deep
    inputs:
      - "/business-docs/"
    outputs:
      - "brd.md"
      - "entity-model.json"
      - "use-cases.json"
      - "business-rules.json"
      - "integration-register.json"
    instruction: "Extract entities, use cases, and business rules from business documents."
    gate:
      type: checkpoint
      label: "Review business requirements before proceeding"

  - id: "s2-service-requirements"
    agent: "factory-service-designer"
    effort: investigate
    inputs:
      - "s1-business-requirements/entity-model.json"
      - "s1-business-requirements/use-cases.json"
      - "s1-business-requirements/brd.md"
    outputs:
      - "audiences.json"
      - "sitemap.json"
      - "variant.json"
    instruction: "Derive audiences, sitemap, and deployment variant."
    gate:
      type: checkpoint
      label: "Review service requirements and variant"

  - id: "s3-data-model"
    agent: "factory-data-architect"
    effort: investigate
    inputs:
      - "s1-business-requirements/entity-model.json"
      - "s1-business-requirements/business-rules.json"
      - "s2-service-requirements/audiences.json"
    outputs:
      - "data-model.json"
    instruction: "Normalize entities, define constraints, indexes, and relationships."
    gate:
      type: checkpoint
      label: "Review data model"

  - id: "s4-api-specification"
    agent: "factory-api-architect"
    effort: deep
    inputs:
      - "s3-data-model/data-model.json"
      - "s1-business-requirements/use-cases.json"
      - "s1-business-requirements/business-rules.json"
      - "s2-service-requirements/audiences.json"
      - "s2-service-requirements/sitemap.json"
      - "s2-service-requirements/variant.json"
    outputs:
      - "build-spec-partial.yaml"
    instruction: "Design API resources and operations. Produce partial Build Spec (api, auth, project sections)."
    gate:
      type: checkpoint
      label: "Review API specification"

  - id: "s5-ui-specification"
    agent: "factory-ui-architect"
    effort: investigate
    inputs:
      - "s4-api-specification/build-spec-partial.yaml"
      - "s2-service-requirements/sitemap.json"
      - "s2-service-requirements/audiences.json"
    outputs:
      - "build-spec.yaml"
    instruction: "Define pages, navigation, data sources. Complete the Build Specification."
    gate:
      type: approval
      timeoutMs: 3600000  # 1 hour — this is the final spec freeze
      escalation: fail
```

#### Phase 2 Manifest: Scaffolding (Dynamic Fan-Out)

After the Build Spec is frozen (stage 5 approved), OPC generates a second manifest from the spec content. This is the key orchestration innovation — the scaffolding manifest is **derived from the Build Spec**, not hardcoded.

```yaml
# Generated dynamically from build-spec.yaml
steps:
  - id: "s6a-scaffold-init"
    agent: "factory-scaffold-init"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      - "/adapters/next-prisma/manifest.yaml"
    outputs:
      - "scaffold-ready.json"
    instruction: "Copy adapter scaffold, install dependencies, verify base project compiles."

  - id: "s6b-data-User"
    agent: "factory-data-scaffolder-next-prisma"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      - "/adapters/next-prisma/patterns/data/schema.md"
      - "/adapters/next-prisma/patterns/data/migration.md"
    outputs:
      - "data-User-done.json"
    instruction: "Generate Prisma model and migration for entity: User"

  - id: "s6b-data-Site"
    agent: "factory-data-scaffolder-next-prisma"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      - "s6b-data-User/data-User-done.json"  # dependency: User before Site
      - "/adapters/next-prisma/patterns/data/schema.md"
    outputs:
      - "data-Site-done.json"
    instruction: "Generate Prisma model and migration for entity: Site"

  # ... one step per entity (dependency-ordered)

  - id: "s6c-api-list-sites"
    agent: "factory-api-scaffolder-next-prisma"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      - "s6b-data-Site/data-Site-done.json"
      - "/adapters/next-prisma/patterns/api/route-handler.md"
      - "/adapters/next-prisma/patterns/api/service.md"
    outputs:
      - "api-list-sites-done.json"
    instruction: "Generate Route Handler + service for operation: list-sites (GET /api/sites)"

  # ... one step per API operation

  - id: "s6d-ui-dashboard"
    agent: "factory-ui-scaffolder-next-prisma"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      - "s6c-api-list-sites/api-list-sites-done.json"
      - "/adapters/next-prisma/patterns/page-types/dashboard.md"
      - "/adapters/next-prisma/patterns/ui/page.md"
    outputs:
      - "ui-dashboard-done.json"
    instruction: "Generate Server Component page for: dashboard (page_type=dashboard)"

  # ... one step per UI page

  - id: "s6e-configure"
    agent: "factory-configurer-next-prisma"
    effort: quick
    inputs:
      - "s5-ui-specification/build-spec.yaml"
      # depends on ALL scaffolding steps (dynamic)
    outputs:
      - "configure-done.json"
    instruction: "Apply project identity, auth config, environment variables."

  - id: "s6f-trim"
    agent: "factory-trimmer-next-prisma"
    effort: quick
    inputs:
      - "s6e-configure/configure-done.json"
    outputs:
      - "trim-done.json"
    instruction: "Remove unused scaffold artifacts."

  - id: "s6g-review"
    agent: "factory-reviewer"
    effort: deep
    inputs:
      - "s6f-trim/trim-done.json"
    outputs:
      - "review-report.yaml"
    instruction: "Run full build, tests, lint, type check. Fix ALL failures."

  - id: "s6h-final-validation"
    agent: "factory-validator"
    effort: investigate
    inputs:
      - "s6g-review/review-report.yaml"
    outputs:
      - "validation-report.json"
    instruction: "Run full build, all tests, lint, type check. Read-only — do NOT fix."
    gate:
      type: checkpoint
      label: "Review final validation results"
```

### Manifest Generation Logic

OPC adds a new command to generate the scaffolding manifest:

```rust
// In apps/opc/src-tauri/src/commands/orchestrator.rs

#[tauri::command]
pub async fn generate_factory_scaffold_manifest(
    build_spec_path: String,
    adapter_name: String,
) -> Result<WorkflowManifest, String> {
    let spec: BuildSpec = load_build_spec(&build_spec_path)?;
    let adapter: AdapterManifest = load_adapter_manifest(&adapter_name)?;

    let mut steps = vec![];

    // Phase 6a: scaffold init
    steps.push(scaffold_init_step(&spec, &adapter));

    // Phase 6b: data scaffolding (dependency-ordered entities)
    for entity in dependency_order(&spec.data_model.entities) {
        steps.push(data_step(&entity, &adapter));
    }

    // Phase 6c: API scaffolding (per operation)
    for resource in &spec.api.resources {
        for op in &resource.operations {
            steps.push(api_step(&op, &resource, &adapter));
        }
    }

    // Phase 6d: UI scaffolding (per page)
    for page in &spec.ui.pages {
        steps.push(ui_step(&page, &adapter));
    }

    // Phase 6e-g: configure, trim, validate
    steps.push(configure_step(&spec, &adapter));
    steps.push(trim_step(&spec, &adapter));
    steps.push(validation_step(&adapter));

    Ok(WorkflowManifest { steps })
}
```

### Build-Test-Fix Loop

OAP's `dispatch_step` already handles success/failure. For the build-test-fix loop:

1. After each scaffolding step completes, OPC runs the adapter's `feature_verify` commands
2. If verify fails, OPC re-dispatches the same step with the error output prepended to the instruction
3. After 3 failures, the step is marked `Failed` and the manifest continues (next feature)

This maps directly to OAP's existing retry logic — just need to wire the verify commands as post-step checks.

---

## Level 3: Claude CLI Execution (Governed)

### Agent Registration in OPC

Each Factory agent registers in OPC's `AgentDb` with appropriate permissions:

| Factory Agent | OPC Agent Name | Permissions | Max Tier |
|-------------|---------------|-------------|----------|
| Business Requirements Analyst | `factory-business-analyst` | file_read | Tier 1 |
| Service Designer | `factory-service-designer` | file_read | Tier 1 |
| Data Architect | `factory-data-architect` | file_read | Tier 1 |
| API Architect | `factory-api-architect` | file_read | Tier 1 |
| UI Architect | `factory-ui-architect` | file_read | Tier 1 |
| Data Scaffolder (per adapter) | `factory-data-scaffolder-{adapter}` | file_read, file_write | Tier 2 |
| API Scaffolder (per adapter) | `factory-api-scaffolder-{adapter}` | file_read, file_write | Tier 2 |
| UI Scaffolder (per adapter) | `factory-ui-scaffolder-{adapter}` | file_read, file_write | Tier 2 |
| Configurer (per adapter) | `factory-configurer-{adapter}` | file_read, file_write | Tier 2 |
| Trimmer (per adapter) | `factory-trimmer-{adapter}` | file_read, file_write | Tier 2 |
| Validator | `factory-validator` | file_read, network (for builds) | Tier 2 |

**Key governance rule:** Process agents (stages 1-5) are **read-only** — they produce artifacts but never touch the codebase. Only scaffolding agents (stage 6) get `file_write`. This is a natural fit for axiomregent's tier system.

### System Prompt Assembly

When OPC dispatches an Factory agent, it builds the prompt from:

```
┌─────────────────────────────────────────────┐
│ 1. Factory agent prompt (~50 lines)          │  ← from adapters/{name}/agents/{role}.md
│ 2. Relevant pattern files (~100 lines each) │  ← from adapters/{name}/patterns/...
│ 3. Artifact paths (not content)             │  ← from OAP artifact manager
│ 4. One feature spec (from Build Spec)       │  ← extracted by OPC, ~200 tokens
└─────────────────────────────────────────────┘
  Total: ~1-3K tokens input per invocation
```

For scaffolding agents, the `instruction` field in the manifest carries the feature-specific context:

```
Generate Route Handler + service for operation: list-sites (GET /api/sites).

Read the operation spec from: $ARTIFACT_DIR/<run_id>/s5-ui-specification/build-spec.yaml
Read the pattern from: /adapters/next-prisma/patterns/api/route-handler.md
Write output to the project directory.
```

### axiomregent Policy Rules for Factory

axiomregent receives Factory-specific policy shards:

```yaml
# Factory scaffolding policy shard
tools:
  workspace.write_file:
    tier: 2
    constraints:
      # Scaffolding agents can only write within adapter-defined paths
      allowed_paths:
        - "src/**"
        - "prisma/**"
        - "migrations/**"
        - "templates/**"
        - "tests/**"
      blocked_paths:
        - ".env"
        - "node_modules/**"
        - ".git/**"

  run.execute:
    tier: 2
    constraints:
      # Only allow adapter build/test commands
      allowed_commands:
        - "npx tsc --noEmit"
        - "npx vitest run"
        - "npx next build"
        - "npx prisma generate"
        - "npx prisma migrate dev"
        - "cargo build"
        - "cargo test"
        - "cargo clippy"
      blocked_patterns:
        - "rm -rf"
        - "DROP"
        - "git push"
```

---

## User Flow: End to End

### 1. Project Setup (Platform)

```
User → Statecraft UI:
  "Create new project: Acme Vendor Portal"
  "Delivery method: Factory pipeline"
  "Adapter: next-prisma"
  "Upload: requirements.pdf, data-dictionary.xlsx, process-flows.pdf"

Statecraft:
  → Creates project record
  → Stores document refs
  → Assigns org policy bundle
  → Notifies OPC desktop: "Project ready for pipeline"
```

### 2. Pipeline Launch (OPC Desktop)

```
OPC Desktop:
  User opens project → sees "Factory Pipeline" tab
  Clicks "Start Pipeline"

  OPC:
    → Reads adapter manifest from adapters/next-prisma/manifest.yaml
    → Generates Phase 1 workflow manifest (stages 0-5)
    → Dispatches to orchestrator: dispatch_manifest(manifest)
    → UI shows DAG visualization with 6 stages
```

### 3. Process Stages (OPC → Claude CLI)

```
For each stage (1-5):

  OPC Orchestrator:
    → Check WorkflowState: is this step pending?
    → Resolve agent: "factory-business-analyst"
    → Build system prompt from agent prompt file
    → Build instruction with artifact paths

  OPC → Claude CLI spawn:
    claude -p "{instruction}" \
      --system-prompt "{agent_prompt}" \
      --model opus \
      --output-format stream-json \
      --mcp-config axiomregent.json \
      --permission-mode default

  Claude CLI (governed by axiomregent):
    → Reads business documents (Tier 1: file_read ✓)
    → Produces structured JSON artifacts
    → Writes to $ARTIFACT_DIR/<run_id>/s1-business-requirements/

  OPC Orchestrator:
    → Runs Factory verification checks (schema validation, artifact existence)
    → If checks pass: mark step completed
    → If checks fail: report specific failure

  OPC Gate (checkpoint):
    → UI shows: "Stage 1 Complete — Review Business Requirements"
    → Displays: entity count, UC count, BR count, artifact links
    → User clicks artifacts to inspect in OPC's inspect panel
    → User confirms or rejects with feedback

  If confirmed → next stage
  If rejected → re-dispatch stage with user feedback prepended
```

### 4. Build Spec Freeze (Checkpoint Gate)

```
After Stage 5:

  OPC Gate (approval with timeout):
    → UI shows: "BUILD SPEC READY FOR REVIEW"
    → Full Build Spec rendered in inspect panel
    → Diffable: entities, operations, pages, auth, navigation
    → User has 1 hour to approve (configurable)

  If approved:
    → Build Spec frozen (hash recorded)
    → OPC generates Phase 2 manifest (scaffolding fan-out)
    → Scaffolding begins
```

### 5. Scaffolding (OPC → Claude CLI, Per Feature)

```
OPC Orchestrator:
  → Phase 2 manifest has N steps (one per entity + operation + page)
  → DAG allows some parallelism (independent features)

For each feature step:

  OPC → Claude CLI spawn:
    claude -p "Generate Route Handler for operation: list-sites..." \
      --system-prompt "{api-scaffolder prompt + patterns}" \
      --model sonnet \            # scaffolding uses faster model
      --output-format stream-json \
      --mcp-config axiomregent.json

  Claude CLI (governed):
    → Reads Build Spec (Tier 1: file_read ✓)
    → Reads pattern files (Tier 1: file_read ✓)
    → Writes source files (Tier 2: file_write, gated by axiomregent)
    → axiomregent checks: path in allowed_paths? yes → allow

  OPC Post-Step Verify:
    → Runs: npx tsc --noEmit
    → Runs: npx vitest run
    → If both pass: step completed ✓
    → If fail: prepend error to instruction, re-dispatch (max 3 retries)
    → If 3 failures: mark failed, continue to next feature

  OPC UI (live):
    → Progress bar: "API Scaffolding: 8/15 operations (2 failed)"
    → Real-time Claude output streamed to agent panel
    → Token spend tracked per step
```

### 6. Final Validation & Handoff

```
After all scaffolding:

  OPC → Factory Validator:
    → Full build: npx next build ✓
    → All tests: npx vitest run ✓
    → Lint: npx next lint ✓
    → Type check: npx tsc --noEmit ✓
    → Invariants: grep checks per invariants.yaml ✓

  OPC Gate (checkpoint):
    → UI shows: "Pipeline Complete — Review Final Application"
    → Test results, build output, invariant results displayed
    → Link to run the dev server locally

  If approved:
    → Pipeline status: completed
    → Statecraft notified: project ready for deployment
    → deployd-api-rs can deploy to staging

  Audit trail:
    → Every stage confirmation with approver identity
    → Every feature: tokens used, retries, errors
    → Total pipeline: token spend, wall time, success rate
```

---

## What Changes in Each Codebase

### Factory Changes

1. **Manifest generator** — new tool that reads Build Spec and produces OAP `WorkflowManifest` YAML
2. **Agent registration metadata** — each agent gets OAP-compatible metadata (permissions, tier, model)
3. **Verification checks as OAP gates** — stage gates produce structured JSON compatible with OAP state
4. **Adapter pattern loader** — patterns served as artifacts to Claude CLI via artifact paths

No changes to: contract schemas, agent prompts, patterns, or invariants. They work as-is.

### OAP Changes

1. **Factory workflow type** — orchestrator recognizes "factory" manifests and handles fan-out
2. **Dynamic manifest generation** — new command: `generate_factory_scaffold_manifest(build_spec, adapter)`
3. **Post-step verification** — hook after scaffolding steps runs adapter `feature_verify` commands
4. **Factory UI panel** — OPC desktop gets an "Factory Pipeline" view with stage visualization
5. **Policy shard** — axiomregent loads Factory-specific policy (allowed paths, commands)
6. **Statecraft API** — endpoints for Factory project init, stage confirmation, audit

### Shared

1. **Factory adapter manifests ship as OAP skills** — each adapter's agents become `.claude/commands/` skill files
2. **Build Spec as spec-spine artifact** — the frozen Build Spec gets compiled into OAP's registry for governance tracking

---

## Why This Works

1. **No protocol mismatch** — Factory's pipeline is already a DAG with artifacts; OAP's orchestrator expects exactly that
2. **Governance for free** — axiomregent already enforces file_write restrictions and command allowlists; Factory just declares which paths and commands are legal per adapter
3. **Bounded context preserved** — OAP dispatches each step as a fresh Claude CLI session; Factory's ~1-3K token agent prompts are exactly what the dispatch system expects
4. **Human checkpoints native** — OAP's `StepGateConfig::Checkpoint` is Factory's "confirm before proceeding" pattern
5. **Crash recovery unified** — OAP's `WorkflowState` already tracks step completion and supports resume; no need for a separate `.factory/pipeline-state.json`
6. **Audit trail integrated** — Statecraft's `audit_log` captures the full pipeline lifecycle, not just the code generation
