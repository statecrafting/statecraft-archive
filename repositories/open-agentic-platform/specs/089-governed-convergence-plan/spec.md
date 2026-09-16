---
id: "089-governed-convergence-plan"
title: "Governed Convergence Plan — Binding Primitives into Default Product Truth"
status: approved
implementation: n/a
owner: bart
created: "2026-04-11"
summary: >
  Master sequencing plan that converges seven architectural primitives — governance
  enforcement, workspace envelope, spec-driven execution, artifact memory, checkpoint
  branching, portfolio intelligence, and promotion-grade continuity — into the
  non-optional default path of the system across six implementation phases.
depends_on:
  - "082-artifact-integrity-platform-hardening"  # artifact-integrity-platform-hardening
  - "087-unified-workspace-architecture"  # unified-workspace-architecture
  - "080-github-identity-onboarding"  # github-identity-onboarding
code_aliases: ["GOVERNED_CONVERGENCE"]
kind: process
domain: substrate
risk: critical
constrains:
  - kind: sequencing-plan
    target_specs:
      - "090-governance-non-optionality"
      - "091-registry-enrichment"
      - "092-workspace-runtime-threading"
      - "093-spec-driven-preflight"
      - "094-unified-artifact-store"
      - "095-checkpoint-branch-of-thought"
      - "096-portfolio-intelligence"
      - "097-promotion-grade-mirror"
---

# 089 — Governed Convergence Plan

## 1. Problem Statement

OAP's architectural thesis is a governed operating system for software change. The repo
already contains advanced primitives: compiled spec truth, governed tool dispatch,
artifact-backed orchestration, checkpoint DAGs, repo intelligence, skill registration,
and platform dual-write. But these primitives operate in **separate silos** and
governance remains **operationally optional**.

The system needs a convergence plan that makes the governed, workspace-scoped,
spec-derived execution path the **default truth** — not one path among several.

This spec defines that plan as six sequenced phases, each producing a concrete
deliverable that tightens the binding between primitives.

## 2. Validated Gap Analysis

Seven gaps were identified through systematic codebase analysis. Each was validated
against actual implementation state.

### Gap 1: Governance is Architecturally Central but Operationally Optional

**Claim**: The governed launch plan exists but falls back to `--dangerously-skip-permissions`.

**Validation**: **Confirmed.** Four bypass surfaces exist:

| Location | Mechanism | Visibility |
|----------|-----------|------------|
| `governed_claude.rs:plan_governed()` | `GovernedPlan::Bypass` when axiomregent port/binary unavailable | Amber badge in UI |
| `orchestrator.rs:dispatch_via_governed_claude()` L241,244 | Inline `--dangerously-skip-permissions` (code duplication) | **Silent — no event** |
| `cli-adapter.ts:buildCliArgs()` L96 | `permissionMode: "bypassPermissions"` | No UI indicator |
| `policy-kernel/settings.rs:DefaultMode::Bypass` | `OAP_PERMISSION_MODE=bypass` env or settings.json | No UI indicator |

Additional risks:
- `LeaseStore::new()` defaults to `test_permissive()` (max_tier: 3) — footgun for non-test code
- axiomregent ships only for macOS aarch64 (spec 037) — all other platforms always bypass
- `web_server.rs` reads `OPC_AXIOMREGENT_PORT` from env (not SidecarState) — race condition

### Gap 2: Specs Do Not Drive Live Execution Boundaries

**Claim**: Spec status, risk, dependencies could gate runtime behavior but don't.

**Validation**: **Confirmed.** Five crates operate in complete silos:

```
spec-compiler → registry.json → featuregraph (display only)
                                               ↕ NO CONNECTION ↕
agent::safety → hardcoded tool tiers (26 entries, static pattern match)
                                               ↕ NO CONNECTION ↕
policy-kernel → ToolCallContext (no feature_id, no spec_status)
                                               ↕ NO CONNECTION ↕
xray → structural metrics (no feature attribution)
```

Specific gaps:
- `FeatureNode.status` is read but **never gated on** in PreflightChecker
- `depends_on` is **lost** — compiler doesn't emit it, featuregraph gets empty vec
- `extraFrontmatter` is a **dead end** — compiled into registry, no consumer reads it
- `governance_preflight` exists as library code but **is not wired** as a Tauri command
- `ToolCallContext` has **no spec fields** — no `feature_id`, `spec_status`, or `risk`
- Tool tiers are **fully hardcoded** in `agent::safety` (26 entries)
- `registry.json` is currently **zero bytes** (needs recompilation)

### Gap 3: Orchestrator + Artifacts Are Not a Memory Model

**Claim**: The orchestrator and artifact system could become change memory but don't persist or integrate.

**Validation**: **Confirmed.** Two separate, non-integrated artifact stores:

| Store | Location | Purpose | Platform Integration |
|-------|----------|---------|---------------------|
| Orchestrator `ArtifactManager` | `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/` | Ephemeral per-run | None |
| Factory `LocalArtifactStore` | `~/.oap/artifact-store/<hash[0:2]>/<hash>/` | Persistent CAS | None |

Specific gaps:
- Hash-chain input verification (`completed_hashes`) **only works in non-persisted dispatch** — the persisted path accumulates no hashes
- No artifact metadata beyond `filename → SHA-256` (no tags, provenance, content-type)
- `StepSummaryEntry.output_hashes` written only to local `summary.json` — **no platform recording**
- No Statecraft API integration for artifacts (confirmed via grep: zero HTTP calls)
- `cleanup_run()` deletes everything; no cross-run reuse

### Gap 4: Checkpoints Are Safety/Rewind, Not Branch-of-Thought

**Claim**: The checkpoint system has DAG primitives but doesn't capture git state or support reasoning branches.

**Validation**: **Confirmed.** The checkpoint system is substantial (10 MCP tools, Merkle verification, CAS blob store) but:

- `CheckpointInfo.head_sha` is **always `None`** — the field exists but `do_create` never populates it
- `CheckpointInfo.fingerprint` stores `"{}"` — never populated
- The DAG is a **tree** (parent_id chain), not a true DAG — no merge operation exists
- "Current" checkpoint is **time-based** (most recent `created_at`), not pointer-based — no branch name concept
- `checkpoint.restore` writes files to disk but **does not interact with git** (no branch switch, no index update)
- No scoping by `conversation_id`, `agent_run_id`, or `workspace_id`

### Gap 5: Portfolio Reasoning Primitives Are Unlinked

**Claim**: xray + featuregraph + registry imply portfolio reasoning but don't connect.

**Validation**: **Confirmed.**
- xray produces `FileNode` (path, size, complexity, LOC) — **no feature attribution**
- featuregraph produces `FeatureNode` (feature_id, impl_files) — **no complexity metrics**
- No bridge exists between the two
- `governance_drift` and `governance_preflight` are library-only (no Tauri commands wired)
- Desktop exposes `xray_scan_project` and `featuregraph_overview` as **independent endpoints** with no cross-reference

### Gap 6: Capability Supply Chain Is Infrastructure, Not Marketplace

**Claim**: skill-factory + tool-registry could become a governed capability marketplace.

**Validation**: **Partially confirmed.** The infrastructure exists:
- `ToolDef` trait with `can_use()` permission gate
- `SkillRegistry` with auto-discovery from `.claude/commands/`
- Safety tiers (Tier1/Tier2/Tier3) per tool

But:
- No spec-driven tier ceilings (tiers are hardcoded)
- No workspace-scoped skill approval
- No capability provenance or audit per skill execution
- Spec 042 (multi-provider agent registry) is still draft

### Gap 7: Platform Mirror Is Best-Effort, Not Promotion-Grade

**Claim**: Statecraft sync is fire-and-forget; no distinction between exploration and promotion runs.

**Validation**: **Confirmed.**
- `StatecraftClient` comment: "all remote calls are best-effort and never block local execution"
- No artifact recording to platform (zero HTTP calls from artifact paths)
- `workspace_id` in factory requests is **optional** — omitting skips the guard
- Seams A and C have **no authentication** (public endpoints)
- Specs 080 (GitHub identity) and 082 (artifact integrity) are both **draft** — prerequisites for trusted cross-plane promotion

## 3. Spec Dependency Map

```
                    ┌─────────────────────────────────────┐
                    │  Phase 0: Foundation Hardening       │
                    │  ┌─────────────┐  ┌───────────────┐ │
                    │  │ 090         │  │ 091           │ │
                    │  │ Governance  │  │ Registry      │ │
                    │  │ Non-Option  │  │ Enrichment    │ │
                    │  └──────┬──────┘  └───────┬───────┘ │
                    └─────────┼─────────────────┼─────────┘
                              │                 │
                    ┌─────────┼─────────────────┼─────────┐
                    │  Phase 1: Workspace Envelope         │
                    │  ┌──────┴──────────────────┴───────┐ │
                    │  │ 092                             │ │
                    │  │ Workspace Runtime Threading     │ │
                    │  │ (extends 087)                   │ │
                    │  └──────────────┬──────────────────┘ │
                    └─────────────────┼────────────────────┘
                              ┌───────┴───────┐
                    ┌─────────┼───────┐       │
                    │  Phase 2        │       │
                    │  ┌──────┴─────┐ │  ┌────┴──────────┐
                    │  │ 093        │ │  │  Phase 3      │
                    │  │ Spec-Driven│ │  │  ┌────────┐   │
                    │  │ Preflight  │ │  │  │ 094    │   │
                    │  └──────┬─────┘ │  │  │ Unified│   │
                    └─────────┼───────┘  │  │ Artifact   │
                              │          │  │ Store  │   │
                              │          │  └───┬────┘   │
                              │          │  ┌───┴────┐   │
                              │          │  │ 095    │   │
                              │          │  │ Branch │   │
                              │          │  │ of     │   │
                              │          │  │ Thought│   │
                              │          │  └───┬────┘   │
                              │          └──────┼────────┘
                              │                 │
                    ┌─────────┼─────────────────┼─────────┐
                    │  Phase 4: Intelligence + Promotion   │
                    │  ┌──────┴──────┐  ┌───────┴───────┐ │
                    │  │ 096         │  │ 097           │ │
                    │  │ Portfolio   │  │ Promotion     │ │
                    │  │ Intelligence│  │ Grade Mirror  │ │
                    │  └─────────────┘  └───────────────┘ │
                    └─────────────────────────────────────┘
```

### Relationship to Existing Specs

| New Spec | Extends/Activates | Depends On |
|----------|-------------------|------------|
| 090 Governance Non-Optionality | Extends 035, 036, 037 | 033, 068 |
| 091 Registry Enrichment | Extends 000, 001, 034 | 039 |
| 092 Workspace Runtime Threading | Implements 087 runtime layer | 087, 090 |
| 093 Spec-Driven Preflight | Extends 004, 034, 047, 068 | 091 |
| 094 Unified Artifact Store | Activates 082 Phase 1+3 | 082, 092 |
| 095 Checkpoint Branch-of-Thought | Extends 041, 052 | 092, 094 |
| 096 Portfolio Intelligence | Extends 032, 034, 083 | 091, 093 |
| 097 Promotion-Grade Mirror | Activates 080, 082 Phase 2 | 080, 082, 092, 094 |

### Draft Spec Activation Schedule

| Spec | Current Status | Activation Phase | Role |
|------|---------------|-----------------|------|
| 044 multi-agent-orchestration | draft | Phase 3 (094) | Base types for unified artifact store |
| 080 github-identity-onboarding | draft | Phase 4 (097) | Identity prerequisite for promotion |
| 082 artifact-integrity-platform-hardening | draft | Phase 3 (094) | Phases 1+3 activated; Phase 2 in 097 |
| 042 multi-provider-agent-registry | draft | Phase 4+ | Capability marketplace foundation |

## 4. Implementation Phases

---

### Phase 0: Foundation Hardening

**Goal**: Make governance non-optional and make the spec registry carry enough metadata to drive runtime decisions.

**Duration**: First. Prerequisite for all subsequent phases.

#### Spec 090 — Governance Non-Optionality

**Why it matters**: The bypass path undermines the entire product thesis. Every subsequent phase assumes governance is the default.

**Enabling code already present**:
- `GovernedPlan` enum with Governed/Bypass variants (`governed_claude.rs`)
- axiomregent router with `check_grants()`, `check_tool_permission()` hard enforcement
- `governance-mode` event emission (4 of 7 call sites)
- `ToolDef::can_use()` defaults to `Ask` when no policy kernel attached

**Smallest implementation slices**:

1. **Eliminate silent orchestrator bypass** (1 day)
   - Refactor `dispatch_via_governed_claude()` in `commands/orchestrator.rs` to call shared `plan_governed()` instead of inline duplication
   - Emit `governance-mode` event from orchestrator path
   - Files: `product/apps/opc/src-tauri/src/commands/orchestrator.rs`

2. **Fix web_server port detection race** (0.5 day)
   - Replace `std::env::var("OPC_AXIOMREGENT_PORT")` in `web_server.rs` with shared `SidecarState` or watch pattern
   - Files: `product/apps/opc/src-tauri/src/web_server.rs`, `product/apps/opc/src-tauri/src/sidecars.rs`

3. **Fix LeaseStore default** (0.5 day)
   - Change `LeaseStore::new()` default from `test_permissive()` to `claude_default()` (max_tier: 2)
   - Move `test_permissive()` to a `#[cfg(test)]` helper
   - Files: `crates/axiomregent/src/lease.rs`

4. **Add governance degradation logging** (1 day)
   - When `GovernedPlan::Bypass` is selected, log structured warning with reason (port unavailable, binary missing, etc.)
   - Add `governance_bypass_reason` field to the `governance-mode` event payload
   - Desktop UI: amber badge shows reason tooltip on hover
   - Files: `governed_claude.rs`, `AgentExecution.tsx`, `ClaudeCodeSession.tsx`

5. **Cross-platform axiomregent binary** (3 days, extends spec 037)
   - Add CI build targets for `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` _(Intel Mac `x86_64-apple-darwin` dropped 2026-04-15)_
   - Bundle all targets in Tauri sidecar config
   - Reduces bypass surface from "all non-aarch64-mac" to "binary genuinely missing"
   - Files: `.github/workflows/`, `product/apps/opc/src-tauri/tauri.conf.json`

6. **Guard `DefaultMode::Bypass` at policy tier** (1 day)
   - `PermissionRuntime::evaluate()`: if `DefaultMode::Bypass` is set at non-Policy tier, log warning and fall through to `Ask` instead
   - Only the Policy tier (Tier 1) may enable bypass mode
   - Files: `crates/policy-kernel/src/permission.rs`, `crates/policy-kernel/src/merge.rs`

**Acceptance criteria**:
- SC-090-1: No Claude Code session starts with `--dangerously-skip-permissions` when axiomregent is running
- SC-090-2: Orchestrator dispatch emits `governance-mode` event
- SC-090-3: web_server correctly detects axiomregent port even when set after process start
- SC-090-4: `LeaseStore::new()` in non-test code uses `claude_default()` grants
- SC-090-5: `OAP_PERMISSION_MODE=bypass` at env/user/project tier is overridden to `ask`

#### Spec 091 — Spec Registry Enrichment

**Why it matters**: The registry is the compiled truth. If it doesn't carry `depends_on`, `risk`, `owner`, and normalized `extraFrontmatter`, downstream consumers can't derive execution boundaries from specs.

**Enabling code already present**:
- Spec compiler reads all frontmatter and stores extras in `extraFrontmatter`
- `featuregraph::FeatureNode` has `depends_on`, `governance`, `owner`, `group` fields (always empty from registry)
- `code_aliases` validation already normalizes uppercase tokens

**Smallest implementation slices**:

1. **Promote `depends_on` to first-class compiler field** (1 day)
   - Add `depends_on` to `KNOWN_KEYS` in spec compiler
   - Emit as `dependsOn: Vec<String>` in registry JSON features array
   - Files: `tools/spec-spine/spec-compiler/src/lib.rs`

2. **Promote `owner` to first-class compiler field** (0.5 day)
   - Add `owner` to `KNOWN_KEYS`
   - Emit as `owner: Option<String>` in registry JSON
   - Files: `tools/spec-spine/spec-compiler/src/lib.rs`

3. **Add `risk` as a new frontmatter field** (0.5 day)
   - Define risk levels: `low`, `medium`, `high`, `critical`
   - Add to `KNOWN_KEYS`, validate enum values, emit in registry
   - Files: `tools/spec-spine/spec-compiler/src/lib.rs`

4. **Featuregraph reads enriched fields** (1 day)
   - Update `RegistryFeatureRecord` to deserialize `dependsOn`, `owner`, `risk`
   - Populate `FeatureNode.depends_on`, `.owner`, `.governance` from registry
   - Files: `crates/featuregraph/src/registry_source.rs`, `crates/featuregraph/src/scanner.rs`

5. **Recompile registry and validate** (0.5 day)
   - Run `spec-compiler compile` to regenerate `.derived/spec-registry/registry.json`
   - Verify enriched fields appear for specs that use them (087, 082, etc.)
   - Add `risk` frontmatter to 5+ specs as initial population

**Acceptance criteria**:
- SC-091-1: `registry.json` features carry `dependsOn`, `owner`, `risk` when present in frontmatter
- SC-091-2: `featuregraph` loads dependency graph from registry (non-empty `depends_on` on 087)
- SC-091-3: Spec compiler rejects invalid `risk` values (not in `[low, medium, high, critical]`)

---

### Phase 1: Workspace Envelope

**Goal**: Make workspace the atomic execution container across all layers — not just a platform data model.

**Duration**: After Phase 0. The central convergence move.

#### Spec 092 — Workspace Runtime Threading

**Why it matters**: Currently workspace_id exists only in Statecraft (DB + JWT) and flows into exactly two places: grants fetch (env var) and factory API bodies (optional). The orchestrator, checkpoints, factory contracts, and claude execution all ignore it.

**Enabling code already present**:
- `StatecraftClient.workspace_id: RwLock<String>` with `set_workspace_id()`/`workspace_id()`
- `OPC_WORKSPACE_ID` env var read in `governed_claude.rs`
- `workspace_grants` table in Statecraft with per-user, per-workspace permission matrix
- `WorkflowState.metadata: HashMap<String, Value>` (natural slot for workspace_id)
- `CheckpointInfo` struct with extensible fields
- Spec 087 defines the full entity hierarchy

**Smallest implementation slices**:

1. **Programmatic workspace selection in desktop** (2 days)
   - Add Tauri command `set_active_workspace(workspace_id)` that:
     - Sets `StatecraftClient.workspace_id`
     - Sets `OPC_WORKSPACE_ID` process env var
     - Fetches grants from platform and updates `SidecarState.grants_json`
     - Emits `workspace-changed` event
   - Add workspace selector in desktop header (dropdown, fetches from `StatecraftClient.list_workspaces()`)
   - Files: `commands/statecraft_client.rs`, `web_server.rs`, `App.tsx` or layout component

2. **Thread workspace_id into ClaudeExecutionRequest** (1 day)
   - Add `workspace_id: Option<String>` to `ClaudeExecutionRequest`
   - Pass through to governed_claude args as `OPC_WORKSPACE_ID` env on spawned process
   - Files: `web_server.rs`, `commands/claude.rs`

3. **Thread workspace_id into orchestrator** (1 day)
   - Add `workspace_id: Option<String>` to `WorkflowManifest`
   - Persist in `WorkflowState.metadata["workspace_id"]`
   - Pass to `DispatchRequest` → inject as env var on spawned claude processes
   - Files: `crates/orchestrator/src/manifest.rs`, `crates/orchestrator/src/state.rs`, `crates/orchestrator/src/lib.rs`

4. **Thread workspace_id into checkpoints** (1 day)
   - Add `workspace_id: Option<String>` to `CheckpointInfo`
   - Populate from `OPC_WORKSPACE_ID` env in `do_create`
   - Add workspace_id filter to `list` and `timeline` queries
   - Files: `crates/axiomregent/src/checkpoint/types.rs`, `crates/axiomregent/src/checkpoint/provider.rs`

5. **Make factory workspace_id mandatory** (1 day)
   - Change `workspaceId` from optional to required in Statecraft factory API handlers
   - `verifyProjectInWorkspace()` runs unconditionally (no skip when omitted)
   - Add `workspace_id` to factory contract `build-spec.schema.yaml`
   - Files: `platform/services/statecraft/api/factory/factory.ts`, `factory/contract/schemas/build-spec.schema.yaml`

6. **Rename axiomregent WorkspaceTools** (0.5 day)
   - Rename `WorkspaceTools` to `RepoMutationTools` to eliminate name collision
   - Update MCP tool names from `workspace.*` to `repo.*` (with backward-compat aliases)
   - Files: `crates/axiomregent/src/workspace/mod.rs`, `crates/axiomregent/src/router/mod.rs`

**Acceptance criteria**:
- SC-092-1: Changing workspace in desktop UI updates grants, env var, and emits event
- SC-092-2: `WorkflowState` persists `workspace_id` in metadata
- SC-092-3: Checkpoints list filters by workspace_id when provided
- SC-092-4: Factory API rejects requests without `workspaceId`
- SC-092-5: `workspace.*` tool calls still work (backward compat alias)

---

### Phase 2: Spec-Driven Preflight and Gating

**Goal**: Connect the spec registry to the policy-kernel and tool-registry so that spec status, risk, and dependencies influence execution boundaries before work starts.

**Duration**: After Phase 1. Depends on enriched registry (091) and workspace threading (092).

#### Spec 093 — Spec-Driven Preflight and Gating

**Why it matters**: The registry, featuregraph, policy-kernel, tool-registry, and xray currently operate in five unconnected silos. This spec bridges them.

**Enabling code already present**:
- `PreflightChecker` with `ChangeTier` classification (library code, not wired)
- `FeatureGraphTools::governance_preflight()` method (not exposed as Tauri command)
- `ToolCallContext` struct (extensible with new fields)
- `PolicyBundle` with gate evaluation chain
- `FeatureNode.status` field (present but unused in gating)
- Registry now carries `dependsOn`, `risk`, `owner` (from Phase 0)

**Smallest implementation slices**:

1. **Wire governance_preflight as Tauri command** (1 day)
   - Register `governance_preflight` in `commands/analysis.rs`
   - Accept `changed_files: Vec<String>`, return `PreflightResult` with `ChangeTier`, affected features, violations
   - Wire into desktop pre-commit or pre-dispatch hook
   - Files: `product/apps/opc/src-tauri/src/commands/analysis.rs`, desktop UI

2. **Extend ToolCallContext with spec fields** (1 day)
   - Add `feature_ids: Vec<String>`, `max_spec_risk: Option<String>`, `spec_statuses: Vec<String>` to `ToolCallContext`
   - Populate from featuregraph lookup of `affected_files` before policy evaluation
   - Files: `crates/policy-kernel/src/lib.rs`

3. **Add spec-status gate to policy-kernel** (1 day)
   - New gate `gate_spec_status`: if any affected feature has status `draft`, degrade tool ceiling to Tier1 (read-only)
   - Configurable via policy bundle: `spec_status_gate: { draft: tier1, active: tier2, deprecated: deny }`
   - Files: `crates/policy-kernel/src/lib.rs`

4. **Add spec-risk gate to policy-kernel** (1 day)
   - New gate `gate_spec_risk`: if max risk of affected features is `critical`, require Tier3 approval (manual confirm)
   - `high` → Tier2 max; `medium` → Tier2; `low` → no restriction
   - Files: `crates/policy-kernel/src/lib.rs`

5. **Add dependency gate to preflight** (1 day)
   - Before dispatching work on a feature, check that all `dependsOn` features have status `active`
   - If a dependency is `draft`, emit warning: "Feature {id} depends on {dep_id} which is still draft"
   - Files: `crates/featuregraph/src/preflight.rs`

6. **Replace hardcoded tool tiers with registry-driven tiers** (2 days)
   - Move `agent::safety::TOOL_TIER_TABLE` to a TOML/JSON config file at `.oap/tool-tiers.toml`
   - Load at startup, allow workspace-scoped override via policy bundle
   - Spec `risk` field can impose ceiling: `critical` spec → max Tier1 tools
   - Files: `crates/agent/src/safety.rs`, new config file

**Acceptance criteria**:
- SC-093-1: `governance_preflight` Tauri command returns affected features and ChangeTier for a file set
- SC-093-2: Tool dispatch on `draft` spec code is restricted to Tier1 (read-only) by default
- SC-093-3: Tool dispatch on `critical` risk spec code requires manual confirmation
- SC-093-4: Dependency warnings appear when working on features with draft dependencies
- SC-093-5: Tool tier assignments are configurable via `.oap/tool-tiers.toml`

---

### Phase 3: Artifact Memory and Checkpoint Branching

**Goal**: Unify the artifact stores, fix hash-chain verification, and elevate checkpoints from safety snapshots into a navigable branch-of-thought system.

**Duration**: After Phase 1. Can run in parallel with Phase 2.

#### Spec 094 — Unified Artifact Store with Provenance

**Why it matters**: Two disconnected artifact stores (orchestrator ephemeral + factory CAS) with no platform integration means execution evidence is fragile, non-searchable, and disposable.

**Enabling code already present**:
- `ArtifactManager` with `hash_artifact()`, `verify_artifact()`, `run_dir()`/`step_dir()` layout
- `LocalArtifactStore` with CAS layout (`<hash[0:2]>/<hash>/<filename>`)
- `StepSummaryEntry.output_hashes` populated in `summary.json`
- `StatecraftClient` with `report_pipeline_status()`, `report_event_batch()` methods
- Spec 082 Phase 1 (artifact integrity) and Phase 3 (cross-run persistence) — both draft

**Smallest implementation slices**:

1. **Fix hash-chain in persisted dispatch path** (1 day)
   - Add `completed_hashes: HashMap<String, HashMap<String, String>>` accumulator to `dispatch_manifest_persisted`
   - Populate after each step completes, verify before each step starts
   - This closes the gap identified in spec 082 FR-004
   - Files: `crates/orchestrator/src/lib.rs` (persisted dispatch function)

2. **Consolidate artifact stores** (2 days)
   - Make `ArtifactManager` delegate to `LocalArtifactStore` for permanent storage after step completion
   - Workflow: agent writes to ephemeral `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/` → step completes → orchestrator copies to CAS via `LocalArtifactStore::store()`
   - Ephemeral dir can be cleaned up; CAS retains content-addressed copy
   - Files: `crates/orchestrator/src/artifact.rs`, `crates/orchestrator/src/lib.rs`

3. **Add artifact metadata** (1 day)
   - New struct `ArtifactRecord { content_hash, filename, step_id, workflow_id, workspace_id, created_at, size_bytes, content_type, producer_agent }`
   - Store metadata in SQLite alongside CAS blobs (new `artifact_records` table)
   - Files: `crates/factory-engine/src/artifact_store.rs`, new SQLite migration

4. **Add provenance lineage** (1 day)
   - Track `consumed_by: Vec<(workflow_id, step_id)>` when a step reads an artifact
   - Track `produced_by: (workflow_id, step_id, agent_id)` at creation
   - Enables "which steps consumed this artifact?" and "what produced this?"
   - Files: `crates/factory-engine/src/artifact_store.rs`

5. **Platform artifact recording** (2 days)
   - After step completion + CAS storage, POST artifact metadata to Statecraft
   - New Statecraft endpoint: `POST /api/workspaces/:id/artifacts` (workspace-scoped)
   - `GET /api/workspaces/:id/artifacts?content_hash=X` for cache-hit detection
   - Activates spec 082 Phase 3 (cross-run persistence)
   - Files: `platform/services/statecraft/api/factory/factory.ts`, `crates/orchestrator/src/lib.rs`

**Acceptance criteria**:
- SC-094-1: Hash-chain verification works in both persisted and non-persisted dispatch paths
- SC-094-2: Completed step artifacts are stored in CAS with content-hash deduplication
- SC-094-3: `ArtifactRecord` carries provenance (producer step, consumer steps)
- SC-094-4: Statecraft stores artifact metadata and supports cache-hit lookup
- SC-094-5: Re-running a pipeline detects prior identical artifacts via content hash

#### Spec 095 — Checkpoint Branch-of-Thought

**Why it matters**: Checkpoints are currently safety snapshots. With git integration and branch semantics, they become a navigable DAG of alternative engineering realities.

**Enabling code already present**:
- `CheckpointProvider` with all 10 MCP tools
- `CheckpointInfo` with `head_sha: Option<String>` field (always None)
- `CheckpointInfo` with `fingerprint` field (always "{}")
- Parent/child tree via `parent_id`
- `checkpoint.fork` creates diverging branches
- `MerkleTree` with full verify capability
- `checkpoint.diff` with detailed line-level comparison

**Smallest implementation slices**:

1. **Populate head_sha on checkpoint create** (0.5 day)
   - In `do_create`, run `git rev-parse HEAD` and store result in `head_sha`
   - Files: `crates/axiomregent/src/checkpoint/provider.rs`

2. **Populate fingerprint on checkpoint create** (0.5 day)
   - Call `xray::quick_fingerprint(repo_root)` or compute `{file_count, total_size, languages}` summary
   - Store as JSON in `fingerprint` field
   - Files: `crates/axiomregent/src/checkpoint/provider.rs`

3. **Add branch_name and run_id scoping** (1 day)
   - Add `branch_name: Option<String>` and `run_id: Option<String>` to `CheckpointInfo`
   - Add columns to hiqlite `checkpoints` table
   - `list` and `timeline` accept optional `branch_name` and `run_id` filters
   - Files: `crates/axiomregent/src/checkpoint/types.rs`, `store.rs`, `provider.rs`

4. **Add checkpoint.compare tool** (1 day)
   - New MCP tool: `checkpoint.compare(checkpoint_a, checkpoint_b)` → structural + semantic diff
   - Returns: files added/removed/modified, LOC delta, Merkle root comparison, git SHA comparison
   - Enables "compare two candidate implementations before promotion"
   - Files: `crates/axiomregent/src/checkpoint/provider.rs`

5. **Bind approvals to checkpoint IDs** (1 day)
   - Orchestrator `StepGateConfig::Approval` gains optional `checkpoint_id: Option<String>`
   - When a gate is reached, auto-create a checkpoint and bind the approval to that checkpoint
   - Approval event in Statecraft includes `checkpoint_id` and `merkle_root`
   - Files: `crates/orchestrator/src/gates.rs`, platform API

6. **Desktop checkpoint timeline with branch visualization** (2 days)
   - Extend checkpoint panel to show branch names and divergence points
   - Show git SHA alongside each checkpoint
   - Allow "compare branches" between two checkpoints
   - Files: `product/apps/opc/src/` checkpoint components

**Acceptance criteria**:
- SC-095-1: Checkpoint creation records actual git HEAD SHA
- SC-095-2: Checkpoints can be filtered by branch_name and run_id
- SC-095-3: `checkpoint.compare` returns structural diff between two checkpoints
- SC-095-4: Gate approvals are bound to checkpoint IDs with Merkle root
- SC-095-5: Desktop shows checkpoint branches with divergence visualization

---

### Phase 4: Portfolio Intelligence and Promotion-Grade Continuity

**Goal**: Bridge xray and featuregraph for portfolio reasoning; make the platform mirror promotion-eligible.

**Duration**: After Phases 2 and 3. These two specs can be developed in parallel.

#### Spec 096 — Portfolio Intelligence

**Why it matters**: xray gives structural metrics, featuregraph gives feature attribution, but they're unlinked. Bridging them enables blast radius analysis, drift detection, and portfolio-level governance.

**Enabling code already present**:
- `xray::XrayIndex` with `FileNode { path, size, complexity, loc, functions_count }`
- `featuregraph::FeatureGraph` with `FeatureNode { feature_id, impl_files, test_files }`
- Desktop `xray_scan_project` and `featuregraph_overview` Tauri commands
- `FeatureGraphTools::governance_drift()` (library only)

**Smallest implementation slices**:

1. **xray-featuregraph bridge** (2 days)
   - New function: `enrich_features_with_metrics(graph: &FeatureGraph, index: &XrayIndex) -> Vec<EnrichedFeature>`
   - `EnrichedFeature` = `FeatureNode` + `{total_loc, max_complexity, avg_complexity, file_count, test_coverage_ratio}`
   - Files: new `crates/featuregraph/src/enrichment.rs`

2. **Blast radius analysis** (1 day)
   - Given a set of changed files, compute: affected features, total LOC at risk, complexity score, dependency fan-out (via `depends_on`)
   - Return as structured `BlastRadius { features, loc_at_risk, complexity_score, downstream_features }`
   - Files: `crates/featuregraph/src/preflight.rs`

3. **Wire governance_drift as Tauri command** (0.5 day)
   - Expose `FeatureGraphTools::governance_drift()` as a desktop command
   - Returns features with `// Feature:` headers that don't match any registry entry
   - Files: `product/apps/opc/src-tauri/src/commands/analysis.rs`

4. **Desktop portfolio dashboard** (2 days)
   - New panel combining enriched feature list with complexity heatmap
   - Feature cards show: status, risk, LOC, complexity, test ratio, dependency count
   - Sortable/filterable by status, risk, complexity
   - Files: `product/apps/opc/src/features/` new component

**Acceptance criteria**:
- SC-096-1: `EnrichedFeature` records carry xray metrics alongside feature attribution
- SC-096-2: Blast radius analysis returns affected features + downstream dependency fan-out
- SC-096-3: Governance drift detectable from desktop
- SC-096-4: Portfolio dashboard shows feature health across the workspace

#### Spec 097 — Promotion-Grade Platform Mirror

**Why it matters**: Statecraft sync is currently fire-and-forget. For the platform to serve as organizational truth, promotion-eligible runs must have complete audit, artifact, and authentication trails.

**Enabling code already present**:
- `StatecraftClient` with `report_pipeline_status()`, `report_event_batch()`, `report_artifact()`
- Spec 082 Phase 2 (OIDC upgrade) — detailed FR-010 through FR-017
- Spec 080 (GitHub identity) — phases 1-4
- `WorkflowState.status` with `Completed | Failed | TimedOut | AwaitingCheckpoint`
- Artifact CAS + platform recording from Phase 3

**Smallest implementation slices**:

1. **Define run promotion eligibility** (1 day)
   - New enum `PromotionEligibility { Eligible, Ineligible(Vec<String>) }`
   - Check: governance was active (not bypassed), all artifacts recorded to platform, all events synced, workspace_id present, OIDC auth active
   - Files: new `crates/orchestrator/src/promotion.rs`

2. **Implement OIDC seam auth** (3 days, activates spec 082 Phase 2)
   - Implement FR-010 through FR-017 from spec 082:
     - `OidcM2mClient` in axiomregent
     - `AuthProvider` enum (Oidc/Static)
     - Shared `validateM2mRequest()` middleware in Statecraft
     - Apply to all three seams (A: policy, B: audit, C: grants)
   - Files: per spec 082 key files table

3. **Mandatory event sync for promotion** (1 day)
   - Before marking a workflow as `Completed`, verify all events were acknowledged by Statecraft
   - If platform unreachable: mark as `CompletedLocal` (distinct from `Completed`)
   - `CompletedLocal` runs are not promotion-eligible
   - Files: `crates/orchestrator/src/lib.rs`, `crates/orchestrator/src/state.rs`

4. **Promotion API endpoint** (1 day)
   - `POST /api/workspaces/:id/promotions` — accepts `workflow_id`, validates all artifacts/events present
   - Returns `PromotionResult { eligible, missing_records, promotion_id }`
   - Files: `platform/services/statecraft/api/factory/factory.ts`

5. **Desktop promotion indicator** (1 day)
   - Workflow completion panel shows promotion eligibility status
   - Green: all records synced, OIDC active → "Promotion eligible"
   - Amber: local-only completion → "Not eligible — missing platform records"
   - Files: desktop UI components

**Acceptance criteria**:
- SC-097-1: OIDC JWT auth works on all three platform seams
- SC-097-2: Static M2M token still works as fallback
- SC-097-3: `CompletedLocal` status distinguishes local-only from fully-synced completions
- SC-097-4: Promotion endpoint validates artifact + event completeness
- SC-097-5: Desktop shows promotion eligibility after workflow completion

---

## 5. Phase Summary

| Phase | Specs | Key Outcome | Risk |
|-------|-------|-------------|------|
| **0** | 090, 091 | Governance is non-optional; registry carries metadata | Low — mostly config + hardening |
| **1** | 092 | Workspace_id threads through all execution layers | Medium — wide surface area |
| **2** | 093 | Spec status/risk gates tool dispatch | Medium — new policy gates |
| **3** | 094, 095 | Unified artifact memory + checkpoint branching | High — two complex subsystems |
| **4** | 096, 097 | Portfolio intelligence + promotion-grade mirror | High — platform + identity work |

## 6. End State

After all phases, OAP becomes:

> A workspace-governed operating system for software change, where specs define allowable
> intent, agents execute through bounded capability channels, artifacts preserve
> machine-verifiable evidence, checkpoints preserve alternative futures, and platform
> promotion turns local work into organizational truth.

The governed execution path is the **only** path. Workspace is the **envelope**.
Specs drive **preflight boundaries**. Artifacts are **memory**. Checkpoints are
**navigable engineering thought**. Platform sync is **promotion-grade**.

## 7. Dependencies

| Spec | Relationship |
|------|-------------|
| 033-axiomregent-activation | Base sidecar infrastructure |
| 034-featuregraph-registry-scanner-fix | Feature graph scanning |
| 035-agent-governed-execution | Governed dispatch model |
| 036-safety-tier-governance | Tool tier model |
| 037-cross-platform-axiomregent | Cross-platform binary |
| 041-checkpoint-restore-ui | Checkpoint desktop UI |
| 044-multi-agent-orchestration | Orchestrator types (draft → activate) |
| 047-governance-control-plane | Policy compiler |
| 052-state-persistence | Workflow state persistence |
| 067-tool-definition-registry | ToolDef trait |
| 068-permission-runtime | Permission evaluation |
| 080-github-identity-onboarding | Identity (draft → activate in Phase 4) |
| 082-artifact-integrity-platform-hardening | Artifact + OIDC (draft → activate in Phases 3-4) |
| 087-unified-workspace-architecture | Workspace model |

## 8. Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Phase 0 governance hardening breaks existing workflows | High | Feature flag: `OAP_STRICT_GOVERNANCE=true` enables strict mode; default remains current behavior initially |
| Workspace threading touches many files | Medium | Incremental: add `Option<String>` everywhere first, then make mandatory after validation |
| Spec-driven gating false positives | Medium | Start in `warn` mode; promote to `enforce` after tuning |
| Checkpoint git integration performance | Low | `git rev-parse HEAD` is sub-millisecond |
| OIDC requires Rauthy infrastructure | High | Static token fallback preserved; OIDC is additive |
| Artifact store migration from ephemeral to CAS | Medium | CAS storage is additive; ephemeral path unchanged |
