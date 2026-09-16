---
id: "076-factory-desktop-panel"
title: "Factory Desktop Panel — Pipeline Visualization, Artifact Inspection, and Gate Dialogs"
feature_branch: "feat/076-factory-desktop-panel"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-04-04"
authors: ["open-agentic-platform"]
language: en
summary: >
  Adds an Factory Pipeline panel to the OPC desktop app with DAG stage visualization,
  real-time progress tracking, artifact inspection, gate confirm/reject dialogs,
  token spend dashboard, and scaffolding fan-out monitoring.
code_aliases: ["FACTORY_DESKTOP", "FACTORY_PANEL"]
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/components/FactoryPipelinePanel.tsx }
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: crate, id: "@opc/desktop" }
---

# Feature Specification: Factory Desktop Panel

## Purpose

OPC desktop is the local cockpit for OAP. Factory pipeline execution is orchestrator-driven but human-supervised — every process stage ends with a gate that requires user review and approval. The desktop must provide:

1. A visual pipeline DAG showing stage progression
2. Artifact inspection for reviewing intermediate outputs (BRD, entity models, Build Spec)
3. Gate dialogs for confirm/reject with feedback
4. Scaffolding fan-out monitoring with per-feature progress, retry counts, and error details
5. Token spend tracking across the pipeline

This spec defines the React components, Tauri command bindings, and state management for the Factory Pipeline panel in OPC desktop.

## Scope

### In scope

- `FactoryPipelinePanel` — top-level tab in OPC desktop
- `PipelineDAG` — visual stage/step graph with status indicators
- `ArtifactInspector` — structured display of stage output artifacts (JSON, YAML, Markdown)
- `GateDialog` — modal for stage confirmation/rejection with feedback input
- `ScaffoldMonitor` — fan-out progress view (entities, operations, pages with status bars)
- `TokenDashboard` — per-stage and cumulative token spend visualization
- `PipelineHistory` — list of past pipeline runs with status and audit trail
- Real-time updates via SSE subscription to orchestrator events (spec 052)

### Out of scope

- Orchestrator logic (spec 075)
- Platform API (spec 077)
- Adapter development UI

## Requirements

### Functional Requirements

**FR-001: Pipeline Panel Tab**
OPC desktop SHALL add an "Factory" tab to the main navigation. The tab is visible when:
- The current project has an `factory/` directory, OR
- The project has a `.factory/` working directory with pipeline state

The panel layout:
```
┌──────────────────────────────────────────────────────────┐
│  [Pipeline DAG]              │  [Artifact Inspector]      │
│                              │                            │
│  ○ Pre-flight       ✓       │  ┌─ brd.md ──────────────┐│
│  ○ Business Reqs    ✓       │  │ # Business Requirements││
│  ○ Service Reqs     ◉ ←     │  │ ...                    ││
│  ○ Data Model       ○       │  │                        ││
│  ○ API Spec         ○       │  └────────────────────────┘│
│  ○ UI Spec          ○       │                            │
│  ──────────────────         │  [Gate Actions]            │
│  ○ Scaffolding      ○       │  [ Confirm ]  [ Reject ]  │
│                              │                            │
│  [Token Dashboard]           │                            │
│  Stage 1: 12,340 tokens     │                            │
│  Stage 2: 8,200 tokens      │                            │
│  Total: 20,540 / 2,000,000  │                            │
└──────────────────────────────────────────────────────────┘
```

**FR-002: Pipeline DAG Visualization**
The `PipelineDAG` component SHALL display:
- Process stages (s0-s5) as a vertical sequence with status icons:
  - `○` pending, `◉` in-progress (animated), `✓` completed, `✗` failed, `⏸` awaiting gate
- Scaffolding (s6) as an expandable group showing fan-out sub-steps:
  - Grouped by category: Data, API, UI, Configure, Trim, Validate
  - Per-group progress bar (e.g., "API: 8/15 operations, 2 failed")
  - Individual steps expandable with retry count and last error
- Currently active stage highlighted with visual emphasis
- Click on any stage/step to load its artifacts in the Inspector

**FR-003: Artifact Inspector**
The `ArtifactInspector` panel SHALL render artifacts from the selected stage:
- **Markdown** (`.md`): Rendered as formatted text (BRD, agent prompts)
- **JSON** (`.json`): Syntax-highlighted with collapsible sections (entity-model, use-cases, data-model)
- **YAML** (`.yaml`): Syntax-highlighted (Build Spec, adapter manifest)
- Artifact list: sidebar showing all output files for the selected stage with file size
- Diff view: for stages that re-run after rejection, show diff against previous attempt

Artifacts are loaded from `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/`.

**FR-004: Gate Dialog**
When a stage reaches a gate (checkpoint or approval), the `GateDialog` SHALL appear:

- **Checkpoint gate**: "Stage N Complete — Review [Stage Name]"
  - Summary statistics (entity count, operation count, etc. — parsed from artifacts)
  - "Confirm" button → releases gate, proceeds to next stage
  - "Reject" button → opens feedback text area → re-runs stage with feedback prepended

- **Approval gate** (stage 5 — Build Spec freeze):
  - Full Build Spec rendered in a structured view (not raw YAML)
  - Sections: Project, Auth, Data Model, API, UI — each expandable
  - Entity/operation/page counts displayed prominently
  - Countdown timer showing remaining approval window
  - "Approve & Freeze" button → records hash, triggers Phase 2
  - "Reject & Revise" button → feedback → re-runs stage 5

**FR-005: Build Spec Structured View**
For the stage 5 approval gate, the inspector SHALL render the Build Spec as structured UI:

- **Project section**: name, variant, description displayed as header
- **Auth section**: audience table (name, method, provider, roles)
- **Data Model section**: entity cards with field tables (name, type, constraints)
- **API section**: resource/operation tree (method badges, path, audience tags)
- **UI section**: page cards (title, page_type badge, data sources, navigation)
- **Business Rules section**: rule cards grouped by type (state-machine rendered as diagrams)
- **Traceability section**: cross-reference matrix (UC → operations → pages)

**FR-006: Scaffold Fan-Out Monitor**
The `ScaffoldMonitor` component SHALL display during Phase 2:

```
┌─ Scaffolding Progress ──────────────────────────────┐
│                                                       │
│  Data Entities    ████████░░  8/10  (1 failed)       │
│  API Operations   ██████░░░░  12/20 (0 failed)      │
│  UI Pages         ░░░░░░░░░░  0/8   (pending)       │
│  Configure        ░           pending                │
│  Trim             ░           pending                │
│  Final Validation ░           pending                │
│                                                       │
│  ▼ Failed: s6b-data-Assessment                       │
│    Retry 3/3 — Error: type 'Assessment' not found    │
│    [View Error] [Manual Fix] [Skip]                  │
│                                                       │
│  Live Agent Output:                                   │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Generating route handler for GET /api/sites...  │ │
│  │ Writing: src/app/api/sites/route.ts            │ │
│  │ Writing: src/services/sites.service.ts         │ │
│  └─────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

Features:
- Per-category progress bars with completed/failed/remaining counts
- Expandable failed steps showing error output and retry history
- Live streaming of current agent's output (via SSE from orchestrator events)
- "Skip" action for permanently failed features (marks as skipped, continues pipeline)

**FR-007: Token Dashboard**
The `TokenDashboard` SHALL display:
- Per-stage token spend (prompt + completion)
- Per-scaffolding-category token spend (data, API, UI totals)
- Cumulative total vs. policy budget limit
- Visual warning at 80% budget; block at 100%
- Token spend per retry (to identify expensive re-runs)

**FR-008: Pipeline History**
The `PipelineHistory` view SHALL list past pipeline runs:
- Run ID, adapter name, start time, duration, final status
- Click to load completed pipeline's DAG and artifacts (read-only)
- Audit trail: stage confirmations, rejections, retries, token spend

**FR-009: Real-Time Event Subscription**
The panel SHALL subscribe to orchestrator `EventNotifier` (spec 052) events:
- `workflow_started` → initialize DAG display
- `step_started` → animate step indicator
- `step_completed` → update step status + load artifacts
- `step_failed` → show error indicator
- `gate_reached` → show GateDialog
- `scaffold_progress` → update ScaffoldMonitor progress bars
- `token_update` → update TokenDashboard

Events are received via Tauri event system (Rust backend → React frontend).

### Non-Functional Requirements

**NF-001: Responsive Artifact Loading**
Artifacts up to 1MB SHALL load and render within 500ms. Larger artifacts show a loading indicator.

**NF-002: Streaming Agent Output**
Live agent output SHALL appear within 200ms of generation (SSE latency).

**NF-003: Offline-Capable History**
Pipeline history and artifacts are local files. The panel SHALL work fully offline (no platform dependency for viewing past runs).

## Architecture

### Component Tree

```
FactoryPipelinePanel
├── PipelineSelector          (choose run or start new)
├── PipelineDAG
│   ├── ProcessStageNode      (×6, s0-s5)
│   └── ScaffoldGroupNode
│       ├── ScaffoldCategoryBar  (data, api, ui, config, trim, validate)
│       └── ScaffoldStepRow      (×N, per-feature)
├── ArtifactInspector
│   ├── ArtifactSidebar       (file list)
│   ├── MarkdownRenderer
│   ├── JsonViewer
│   ├── YamlViewer
│   └── BuildSpecStructuredView
│       ├── ProjectHeader
│       ├── AuthTable
│       ├── EntityCards
│       ├── ApiOperationTree
│       ├── PageCards
│       └── TraceabilityMatrix
├── GateDialog
│   ├── CheckpointDialog
│   └── ApprovalDialog
├── ScaffoldMonitor
│   ├── CategoryProgressBars
│   ├── FailedStepExpander
│   └── LiveAgentOutput
├── TokenDashboard
│   ├── StageTokenBars
│   └── BudgetGauge
└── PipelineHistory
    ├── RunList
    └── AuditTrail
```

### State Management

Pipeline state is managed via a React context that syncs with Tauri backend:

```typescript
interface FactoryPipelineState {
  runId: string | null;
  phase: 'idle' | 'process' | 'scaffolding' | 'complete' | 'failed';
  stages: StageState[];
  scaffolding: ScaffoldingState | null;
  tokenSpend: TokenSpend;
  selectedStepId: string | null;
  artifacts: Map<string, ArtifactEntry[]>;
  gateAction: GateAction | null;  // non-null when gate dialog should show
}
```

### Tauri Event Bindings

```typescript
// Listen for orchestrator events
listen('factory:step_started', (event) => { ... });
listen('factory:step_completed', (event) => { ... });
listen('factory:step_failed', (event) => { ... });
listen('factory:gate_reached', (event) => { ... });
listen('factory:scaffold_progress', (event) => { ... });
listen('factory:token_update', (event) => { ... });

// Invoke Tauri commands
invoke('start_factory_pipeline', {
  projectPath, adapterName, businessDocPaths,
  statecraftProjectId,  // org/project binding for the platform reservation
  processName,          // see "Process name forwarding" below
});
invoke('confirm_factory_stage', { runId, stageId });
invoke('reject_factory_stage', { runId, stageId, feedback });
invoke('get_factory_pipeline_status', { runId });
```

#### Server-resolved pipeline inputs

The "Start New Pipeline" form resolves its structure from platform data
rather than free-typed or client-baked values. The platform owns adapter,
process, and stage naming (spec 124 §6.2); resolving from platform data
means a rename or addition on the platform needs no desktop rebuild.

- **Adapter** — a dropdown (`@opc/ui/select`) populated from
  `GET /api/factory/adapters` via the `list_factory_adapters` Tauri command,
  not a free-text field. The currently-selected adapter is always kept
  selectable so a bundle-seeded value survives even before the list loads.
- **Process name** — `PipelineSelector` forwards the bundle's current
  process name (`bundle.processes[0].name`, the value the panel renders
  under "Processes") as the `processName` argument. When the bundle carries
  no process, the argument is omitted and the backend resolves the org's
  process from the platform list. The selector never sends a process name
  baked into the client.
- **Pipeline stages (DAG)** — `createInitialPipelineState` seeds the stage
  list from the process definition via
  `stagesFromProcessDefinition(bundle.processes[0].definition)`. Stage ids
  are load-bearing (they must match the duplex stage events); the curated
  `PROCESS_STAGES` constant is retained only as the display-label source and
  the fallback when no definition is available, so the DAG is never empty.

## Implementation Approach

### Phase 1: Core Panel & DAG (4 days)

1. Create `FactoryPipelinePanel` top-level component with tab registration
2. Implement `PipelineDAG` with process stage nodes (static layout)
3. Implement `PipelineSelector` (new pipeline / resume / history)
4. Wire to `start_factory_pipeline` Tauri command
5. Implement event subscription for stage updates

### Phase 2: Artifact Inspector & Gates (4 days)

1. Implement `ArtifactInspector` with JSON/YAML/Markdown renderers
2. Implement `BuildSpecStructuredView` for stage 5 approval
3. Implement `GateDialog` (checkpoint + approval variants)
4. Wire confirm/reject to Tauri commands

### Phase 3: Scaffold Monitor (3 days)

1. Implement `ScaffoldMonitor` with category progress bars
2. Implement `FailedStepExpander` with error display and retry history
3. Implement `LiveAgentOutput` streaming panel
4. Wire to `scaffold_progress` events

### Phase 4: Token Dashboard & History (2 days)

1. Implement `TokenDashboard` with per-stage bars and budget gauge
2. Implement `PipelineHistory` with run list and audit trail
3. Implement `AuditTrail` timeline view

## Success Criteria

- **SC-001**: Pipeline DAG renders all 6 process stages with correct status progression
- **SC-002**: Artifact inspector renders JSON, YAML, and Markdown artifacts from completed stages
- **SC-003**: Build Spec structured view renders all sections (project, auth, data, API, UI, traceability)
- **SC-004**: Gate dialog appears when orchestrator emits `gate_reached` event
- **SC-005**: Confirm/reject actions propagate to orchestrator and pipeline proceeds/re-runs
- **SC-006**: Scaffold monitor shows per-category progress and updates in real-time
- **SC-007**: Token dashboard tracks cumulative spend with budget warning at 80%
- **SC-008**: Pipeline history loads past runs with full artifact access

## Dependencies

| Spec | Relationship |
|------|-------------|
| 074-factory-ingestion | Contract types for Build Spec rendering |
| 075-factory-workflow-engine | Tauri commands and orchestrator events |
| 052-state-persistence | EventNotifier for real-time updates |
| 038-tauri-command-wiring | Existing Tauri command infrastructure |

## Risks

| Risk | Mitigation |
|------|-----------|
| Large Build Specs slow rendering | Virtualized lists for entity/operation/page sections |
| SSE event backpressure during fast fan-out | Client-side event batching (aggregate updates per 200ms frame) |
| Artifact files too large for inline display | Size check; show truncated preview + "Open in editor" for files >1MB |

## Factory desktop wiring hardening amendment (2026-07-09)

Two robustness fixes to the desktop factory panel's duplex wiring:

- **`factory.event` handler registration** (`product/apps/opc/src-tauri/src/lib.rs`). Registered the desktop `factory.event` dispatch handler alongside `factory.run.request`, so a gate approved on the statecraft web surface reaches the local run. The routing and gate-resolution behaviour is owned by spec 124; the registration site (mirroring `register_factory_run_handler`) is here.
- **Governance handshake fail-loud** (`product/apps/opc/src-tauri/src/commands/sync_client.rs`). `send_and_await_reply` bounded only the reply wait, not the outbound send on the bounded duplex channel. A stalled WebSocket writer (a dead-but-undetected connection) could block the send indefinitely, wedging a run before governance completed with no signal which phase blocked (the "Waiting for agent output" silent stall). The outbound send is now bounded (10s), so the run-grant handshake (spec 198) fails closed with an actionable error instead of hanging.

Couples these fixes in the paths this spec authors to their owning spec per the spec 127 coupling gate.
