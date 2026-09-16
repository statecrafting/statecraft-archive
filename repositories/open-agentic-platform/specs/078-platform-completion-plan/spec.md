---
id: "078-platform-completion-plan"
title: "Platform Completion Plan — Factory Ingestion + Draft Spec Closure"
feature_branch: "feat/078-platform-completion"
status: approved
implementation: n/a
kind: platform
domain: platform
created: "2026-04-04"
authors: ["open-agentic-platform"]
language: en
summary: >
  Master implementation plan that sequences Factory ingestion (specs 074-077),
  existing draft spec completion (042, 049, 051, 052, 057, 072), and infrastructure
  hardening into a phased roadmap that delivers a complete, functioning AI software
  factory platform.
code_aliases: ["PLATFORM_COMPLETION", "MASTER_PLAN"]
constrains:
  - kind: delivery-sequencing
    target_specs:
      - "074-factory-ingestion"
      - "075-factory-workflow-engine"
      - "076-factory-desktop-panel"
      - "077-statecraft-factory-api"
      - "042-multi-provider-agent-registry"
      - "049-permission-system"
      - "051-worktree-agents"
      - "052-state-persistence"
      - "057-notification-system"
      - "072-multi-cloud-k8s-portability"
---

# Platform Completion Plan

## Executive Summary

OAP today is a governed orchestration engine with a mature spec system, policy kernel, desktop app, and platform services — but it lacks a delivery methodology and has 19 draft specs with incomplete implementations. Ingesting Factory fills the delivery gap and, critically, **forces completion** of the most important draft specs because Factory's pipeline is the most demanding consumer of those subsystems.

This plan sequences all work into 6 phases over ~12 weeks. Each phase delivers independently testable value. No phase requires all prior phases to be 100% complete — work items within a phase can overlap.

## Current State Assessment

### What Works (No Changes Needed)

| Layer | Component | Status |
|-------|-----------|--------|
| Specs | spec-compiler, registry, lifecycle model | Production |
| Policy | policy-kernel evaluation, 5-tier settings, proof chain | Production |
| Permission | Permission runtime (068), denial tracking, audit | Production |
| Desktop | 66 React components, Tauri commands, inspect/governance tabs | Production |
| Tools | spec-compiler, registry-consumer, spec-lint | Production |
| Identity | Rauthy OIDC provider with hiqlite HA | Production |
| Orchestrator | WorkflowManifest, dispatch, gate evaluation, artifact manager | Production |
| Skill Factory | Command/skill auto-discovery (071) | Production |
| Tool Registry | Schema-driven ToolDef + registry (067) | Production |

### What Needs Completion (Existing Draft Specs)

| Spec | Gap | Blocks |
|------|-----|--------|
| **052 State Persistence** | Phases 3-6: checkpoint gate execution, SQLite backend, SSE event stream, resume-from-state | Factory pipeline resume, real-time desktop updates |
| **042 Provider Registry** | Multi-provider adapters (Anthropic, OpenAI, Gemini, Bedrock) | Model flexibility for scaffold agents |
| **049 Permission System** | Runtime enforcement end-to-end: settings → axiomregent → tool gating | Factory tier 1/2 agent enforcement |
| **051 Worktree Agents** | Lifecycle events, merge workflow, concurrency limiting | Parallel scaffold fan-out isolation |
| **057 Notification System** | Slack + web-push channels | Pipeline status notifications |
| **072 Multi-Cloud K8s** | AWS EKS, GCP GKE Terraform templates | Deploy Factory-generated apps to non-Azure |

### What's New (Factory Integration)

| Spec | Deliverable |
|------|------------|
| **074 Factory Ingestion** | Rust contract types, adapter registry, agent loader, native verification harness |
| **075 Factory Workflow Engine** | Two-phase execution, fan-out, verification hooks, policy shards |
| **076 Factory Desktop Panel** | Pipeline DAG, artifact inspector, gate dialogs, scaffold monitor |
| **077 Statecraft Factory API** | Project init, stage confirm/reject, audit trail, deployment handoff |

---

## Phase 1: Foundation (Weeks 1-2)

**Goal**: Factory code in the repo, contract types compiling, adapters discoverable.

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 1.1 | Factory integrated as first-class OAP code in `factory/` | 074 | — | None |
| 1.2 | Create `crates/factory-contracts/` with Build Spec types | 074 | 2d | 1.1 |
| 1.3 | Add Adapter Manifest types to contracts crate | 074 | 1d | 1.2 |
| 1.4 | Add Pipeline State types to contracts crate | 074 | 1d | 1.2 |
| 1.5 | Add Verification Contract types to contracts crate | 074 | 0.5d | 1.2 |
| 1.6 | Implement AdapterRegistry::discover() | 074 | 1d | 1.3 |
| 1.7 | Implement ProcessAgentLoader + PatternResolver | 074 | 1d | 1.3 |
| 1.8 | Round-trip tests against all Factory examples | 074 | 1d | 1.2-1.5 |
| 1.9 | Update CLAUDE.md with factory/ directory documentation | — | 0.5d | 1.1 |

### Deliverable

- `cargo build --release -p factory-contracts` succeeds
- All 4 adapters discovered and validated
- `community-grant-portal.build-spec.yaml` parses into `BuildSpec` and round-trips

### Checkpoint

Demonstrate: parse a real Build Spec, discover adapters, validate capabilities match.

---

## Phase 2: Orchestrator Integration (Weeks 3-5)

**Goal**: Factory pipeline can execute end-to-end with mock agents (noop dispatch).

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 2.1 | Add `post_verify` field to `WorkflowStep` | 075 | 1d | Phase 1 |
| 2.2 | Implement post-step verification execution | 075 | 2d | 2.1 |
| 2.3 | Implement build-test-fix retry loop | 075 | 2d | 2.2 |
| 2.4 | Implement `generate_process_manifest()` | 075 | 2d | Phase 1 |
| 2.5 | Implement `generate_scaffold_manifest()` with entity dependency ordering | 075 | 3d | Phase 1 |
| 2.6 | Implement two-phase execution (auto Phase 2 after stage 5 approval) | 075 | 2d | 2.4, 2.5 |
| 2.7 | Implement `FactoryAgentBridge` (agent registry adapter) | 075 | 1d | 1.7 |
| 2.8 | Implement `generate_factory_policy_shard()` | 075 | 1d | 1.3, 1.6 |
| 2.9 | **Complete spec 052 phases 3-4**: checkpoint gate execution + SQLite WorkflowStore | 052 | 4d | None |
| 2.10 | **Complete spec 052 phase 5**: SSE event stream server | 052 | 3d | 2.9 |
| 2.11 | **Complete spec 052 phase 6**: resume-from-state for Factory | 052 | 2d | 2.9, 2.6 |
| 2.12 | Integrate Python verification harness as subprocess | 075 | 1d | Phase 1 |
| 2.13 | Noop end-to-end test: full pipeline with mock agents | 075 | 2d | 2.1-2.12 |

### Deliverable

- `dispatch_manifest_noop()` runs a full Factory pipeline (process + scaffold fan-out)
- State persists to SQLite; resume works after simulated crash
- Events stream via SSE
- Post-step verification hooks execute and retry on failure

### Checkpoint

Demonstrate: noop pipeline generates correct Phase 1 manifest from `community-grant-portal` example, transitions to Phase 2 after mock stage 5 approval, fans out into ~50+ scaffold steps, persists state, resumes.

---

## Phase 3: Agent Dispatch & Permission Wiring (Weeks 4-6)

**Goal**: Real agent execution with governed permissions. Factory agents dispatch via Claude CLI.

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 3.1 | **Complete spec 042**: Anthropic provider adapter (Claude CLI dispatch) | 042 | 3d | None |
| 3.2 | **Complete spec 042**: Provider selection logic (model → provider routing) | 042 | 2d | 3.1 |
| 3.3 | Replace agent registry stub with real registry rows from FactoryAgentBridge | 042, 075 | 2d | 2.7 |
| 3.4 | **Complete spec 049**: Wire permission runtime → axiomregent → tool gating | 049 | 3d | None |
| 3.5 | Apply Factory policy shard to axiomregent at pipeline start | 075, 049 | 1d | 2.8, 3.4 |
| 3.6 | Implement Tier 1 enforcement: process agents are read-only | 049, 075 | 1d | 3.4, 3.5 |
| 3.7 | Implement Tier 2 enforcement: scaffold agents write only to allowed paths | 049, 075 | 1d | 3.4, 3.5 |
| 3.8 | Token budget enforcement (halt on budget exceeded) | 075 | 1d | 3.1 |
| 3.9 | Real dispatch test: single process stage with Claude Opus | 075, 042 | 2d | 3.1-3.5 |
| 3.10 | Real dispatch test: single scaffold step with Claude Sonnet + verification | 075, 042 | 2d | 3.9 |

### Deliverable

- Claude CLI dispatches Factory agents with correct system prompts and artifact paths
- axiomregent enforces file_write scope per adapter
- Token budget tracked and enforced
- Process agent (Tier 1) blocked from file_write; scaffold agent (Tier 2) allowed

### Checkpoint

Demonstrate: dispatch `factory-business-analyst` with a real business document, get structured JSON output. Dispatch `factory-api-scaffolder-next-prisma` with a Build Spec operation, get code files written to correct paths. Verify axiomregent blocks write outside allowed paths.

---

## Phase 4: Desktop Integration (Weeks 5-8)

**Goal**: OPC desktop has full Factory Pipeline panel with real-time updates.

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 4.1 | Create `FactoryPipelinePanel` tab with pipeline selector | 076 | 2d | None |
| 4.2 | Implement `PipelineDAG` process stage visualization | 076 | 2d | 4.1 |
| 4.3 | Implement `ArtifactInspector` (JSON/YAML/Markdown renderers) | 076 | 3d | 4.1 |
| 4.4 | Implement `BuildSpecStructuredView` (entity cards, API tree, page cards) | 076 | 3d | 4.3 |
| 4.5 | Implement `GateDialog` (checkpoint + approval variants) | 076 | 2d | 4.2 |
| 4.6 | Wire Tauri event listeners for real-time stage updates | 076 | 2d | 2.10 |
| 4.7 | Implement `ScaffoldMonitor` with category progress bars | 076 | 2d | 4.2 |
| 4.8 | Implement `LiveAgentOutput` streaming panel | 076 | 2d | 4.6 |
| 4.9 | Implement `TokenDashboard` with budget gauge | 076 | 1d | 4.6 |
| 4.10 | Implement `PipelineHistory` with audit trail | 076 | 2d | 4.1 |
| 4.11 | Add Tauri commands: `start_factory_pipeline`, `confirm/reject_stage` | 075, 076 | 2d | Phase 2 |
| 4.12 | **Complete spec 051**: Worktree agent lifecycle for scaffold fan-out | 051 | 3d | Phase 2 |
| 4.13 | Integration test: full pipeline via desktop UI with gate interactions | 076 | 2d | 4.1-4.11 |

### Deliverable

- User can start an Factory pipeline from OPC desktop
- DAG updates in real-time as stages progress
- Artifacts viewable after each stage
- Build Spec rendered as structured UI for approval
- Gate dialogs appear and confirm/reject propagate
- Scaffold fan-out progress visible with per-category bars

### Checkpoint

Demonstrate: start pipeline in OPC, review stage 1 artifacts in inspector, confirm gate, watch DAG progress. At stage 5, review Build Spec in structured view, approve. Watch scaffold fan-out in monitor with live agent output streaming.

---

## Phase 5: Platform Integration (Weeks 6-9)

**Goal**: Statecraft tracks Factory pipeline lifecycle with audit trail. Deployment handoff works.

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 5.1 | Create Drizzle schema + migration for Factory tables | 077 | 1d | None |
| 5.2 | Implement `POST /factory/init` endpoint | 077 | 2d | 5.1 |
| 5.3 | Implement `GET /factory/status` endpoint | 077 | 1d | 5.1 |
| 5.4 | Implement policy bundle compilation logic | 077 | 2d | 5.2 |
| 5.5 | Implement `POST /stage/:id/confirm` and `/reject` endpoints | 077 | 2d | 5.1 |
| 5.6 | Implement `GET /factory/audit` endpoint | 077 | 1d | 5.1 |
| 5.7 | Implement `POST /factory/token-spend` reporting endpoint | 077 | 1d | 5.1 |
| 5.8 | Wire OPC → Statecraft sync: stage confirmations + token reporting | 076, 077 | 2d | 5.2-5.7, Phase 4 |
| 5.9 | Implement `POST /factory/deploy` → deployd-api-rs handoff | 077 | 2d | 5.1 |
| 5.10 | **Complete deployd-api-rs**: Accept deployment requests from Statecraft | — | 3d | None |
| 5.11 | Wire audit trail: axiomregent proof chain → Statecraft audit_log | 077 | 2d | 5.6 |
| 5.12 | **Complete spec 057**: Slack notification channel for pipeline events | 057 | 2d | 5.6 |
| 5.13 | Integration test: OPC → Statecraft → deployd round-trip | 077 | 2d | 5.8-5.10 |

### Deliverable

- Statecraft tracks all Factory pipelines with full audit trail
- Policy bundles compiled and served to OPC
- Stage confirmations recorded with approver identity
- Token spend tracked centrally
- Pipeline completion triggers deployment to deployd-api-rs
- Slack notifications on key pipeline events

### Checkpoint

Demonstrate: create project in Statecraft, start pipeline in OPC, confirm stages in OPC (reflected in Statecraft audit log), complete pipeline, trigger deployment. Verify full audit trail in Statecraft with all events, token spend, and approver identities.

---

## Phase 6: Hardening & Multi-Cloud (Weeks 9-12)

**Goal**: Production hardening, multi-cloud deployment, end-to-end validation.

### Work Items

| ID | Task | Spec | Effort | Dependencies |
|----|------|------|--------|-------------|
| 6.1 | **Complete spec 072**: AWS EKS Terraform template | 072 | 3d | None |
| 6.2 | **Complete spec 072**: GCP GKE Terraform template | 072 | 3d | None |
| 6.3 | **Complete spec 072**: Local K3s template for dev | 072 | 1d | None |
| 6.4 | End-to-end test: business docs → deployed app on Azure AKS | All | 3d | Phases 1-5 |
| 6.5 | End-to-end test: same pipeline on AWS EKS | All, 072 | 2d | 6.1, 6.4 |
| 6.6 | End-to-end test: same pipeline on local K3s | All, 072 | 1d | 6.3, 6.4 |
| 6.7 | Performance tuning: fan-out concurrency, token budget optimization | 075 | 2d | Phase 3 |
| 6.8 | Fix diff generation in claude.rs (line 2227 TODO) | — | 1d | None |
| 6.9 | Complete spec-compiler Factory registry integration | 074 | 1d | Phase 1 |
| 6.10 | Adapter development guide (how to create a new adapter for OAP+Factory) | — | 2d | Phases 1-5 |
| 6.11 | Spec-lint rules for Factory contract schemas | — | 1d | Phase 1 |
| 6.12 | Security audit: review all Factory policy shards, file write scopes, command allowlists | — | 2d | Phase 3 |
| 6.13 | Update all spec statuses: draft → active for completed specs | — | 0.5d | All |

### Deliverable

- Multi-cloud deployment verified (Azure, AWS, local)
- End-to-end pipeline: business docs → requirements → spec → code → tests → deploy
- Performance validated for large Build Specs (50+ scaffold steps)
- Security audit complete
- Documentation for adapter developers

### Checkpoint

Demonstrate: Upload 3 business documents. Factory pipeline extracts requirements, designs data model, specifies API + UI, freezes Build Spec. Scaffold fan-out generates ~50 features with build-test-fix loops. Final validation passes. Deploy to staging. Full audit trail shows every decision, every token, every approver.

---

## Critical Path

The longest dependency chain determines the minimum timeline:

```
Phase 1 (1.1-1.8)
  └→ Phase 2 (2.4-2.6, 2.9-2.11)
      └→ Phase 3 (3.1-3.7)
          └→ Phase 4 (4.11, 4.6-4.8)
              └→ Phase 5 (5.8)
                  └→ Phase 6 (6.4)
```

**Critical path**: 074 contract types → 075 manifest generation → 052 state persistence → 042 provider dispatch → 076 desktop wiring → 077 platform sync → end-to-end test.

**Parallelizable work**:
- Phase 2 orchestrator work (2.1-2.8) runs in parallel with spec 052 completion (2.9-2.11)
- Phase 3 provider work (3.1-3.2) runs in parallel with permission wiring (3.4)
- Phase 4 desktop UI (4.1-4.10) runs in parallel with worktree completion (4.12)
- Phase 5 Statecraft (5.1-5.7) runs in parallel with deployd completion (5.10)
- Phase 6 multi-cloud (6.1-6.3) runs in parallel with performance tuning (6.7)

---

## Existing Draft Specs: Completion Summary

This plan closes **7 of 19 draft specs** — the 7 that are blocking or accelerated by Factory integration:

| Spec | Completion Work | Phase |
|------|----------------|-------|
| **042 Multi-Provider Agent Registry** | Anthropic adapter + provider routing | Phase 3 |
| **049 Permission System** | Runtime → axiomregent → tool gating wiring | Phase 3 |
| **051 Worktree Agents** | Lifecycle events, merge workflow, concurrency | Phase 4 |
| **052 State Persistence** | Phases 3-6 (gates, SQLite, SSE, resume) | Phase 2 |
| **057 Notification System** | Slack channel for pipeline events | Phase 5 |
| **072 Multi-Cloud K8s** | AWS EKS + GCP GKE + local K3s templates | Phase 6 |
| **deployd-api-rs** | Accept deployment requests, K8s orchestration | Phase 5 |

The remaining 12 draft specs (002, 003, 004, 005, 006, 044, 048, 053, 054, 055, 059, 061) are lower priority — they represent incremental improvements, not blocking gaps. They can be addressed post-completion.

---

## Resource Estimates

| Phase | Estimated Effort | Calendar Time |
|-------|-----------------|---------------|
| Phase 1: Foundation | 8.5 person-days | Weeks 1-2 |
| Phase 2: Orchestrator | 23 person-days | Weeks 3-5 |
| Phase 3: Agent & Permissions | 16 person-days | Weeks 4-6 |
| Phase 4: Desktop | 23 person-days | Weeks 5-8 |
| Phase 5: Platform | 18 person-days | Weeks 6-9 |
| Phase 6: Hardening | 19.5 person-days | Weeks 9-12 |
| **Total** | **~108 person-days** | **~12 weeks** |

With parallelization across phases, a 2-person team can deliver in ~12 weeks. A single developer can deliver the critical path in ~16 weeks, deferring multi-cloud (Phase 6) to a later cycle.

---

## Success Criteria (Platform-Wide)

- **SC-001**: Business documents → frozen Build Spec via Factory process stages (s0-s5) with human gates
- **SC-002**: Build Spec → working, tested codebase via Factory scaffolding fan-out (s6) with per-feature verification
- **SC-003**: Full pipeline visible in OPC desktop with real-time DAG, artifacts, gates, and token tracking
- **SC-004**: Statecraft tracks full audit trail: who initiated, who approved, what failed, how many tokens
- **SC-005**: axiomregent enforces read-only for process agents (Tier 1) and scoped write for scaffold agents (Tier 2)
- **SC-006**: Pipeline resumes from last checkpoint after crash (no work lost)
- **SC-007**: Completed application deploys to at least one cloud provider via deployd-api-rs
- **SC-008**: New adapter can be added by creating `factory/adapters/{name}/` with manifest — zero OAP code changes

---

## Risk Register

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|-------------|-----------|
| R1 | Factory contract schemas evolve during integration | High | Medium | Contract crate is sole coupling point; Rust types enforce schema consistency |
| R2 | Claude CLI dispatch latency makes fan-out slow | Medium | Low | Configurable concurrency; Sonnet for scaffold (fast); parallelism |
| R3 | Spec 052 completion harder than estimated | High | Medium | Phase 2 has 2 week buffer; noop dispatch works without SQLite |
| R4 | Adapter patterns produce inconsistent code | Medium | Medium | Verification hooks catch failures; retry loop auto-fixes |
| R5 | Desktop component complexity exceeds timeline | Medium | Medium | Phase 4 can ship incrementally (DAG first, inspector second, monitor third) |
| R6 | Multi-cloud Terraform portability issues | Low | Medium | Phase 6 is optional for initial launch; Azure-only is viable MVP |
| R7 | Token budget too tight for complex pipelines | Medium | Low | Budget is configurable per-project; defaults set from real pipeline runs |
