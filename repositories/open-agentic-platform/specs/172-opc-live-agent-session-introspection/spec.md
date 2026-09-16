---
id: "172-opc-live-agent-session-introspection"
slug: opc-live-agent-session-introspection
title: "Live agent-session introspection in OPC — connected-agent visibility and force-disconnect (ASI10)"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: opc
risk: medium
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp
  - "043-agent-organizer"  # agent-organizer
  - "052-state-persistence"  # state-persistence
  - "057-notification-system"  # notification-system
  - "067-tool-definition-registry"  # tool-definition-registry
  - "157-opc-session-model"  # opc-session-model
code_aliases: ["OPC_AGENT_SESSION_PANEL", "FORCE_DISCONNECT"]
establishes:
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/process/activity.rs }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/live_sessions.rs }
  - unit: { kind: file, path: product/apps/opc/src/components/LiveSessionsPanel.tsx }
  - unit: { kind: directory, path: product/apps/opc/src/features/live-sessions }
extends:
  # The OPC desktop crate + frontend are co-authored under spec 032
  # (OPC inspect + governance wiring MVP). Spec 172 additively adds:
  #   - a new `activity` module + ActivityTracker fields to the existing
  #     process registry,
  #   - new Tauri command surfaces (list_live_sessions,
  #     get_live_session_thresholds, force_disconnect_session) wired
  #     through commands/mod.rs and lib.rs,
  #   - a new tab type / tab factory / TabContent case / ToolsPopover
  #     entry on the frontend (Issue 4, 2026-05-26: the toolbar was
  #     superseded by a wrench-anchored popover in the composer; the
  #     Live Sessions tile lives in ToolsPopover.tsx).
  # No behavioural change to spec 032's own claims.
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/process/mod.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/process/registry.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/mod.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/lib.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/Cargo.toml }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/TabContent.tsx }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/ToolsPopover.tsx }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/contexts/TabContext.tsx }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/hooks/useTabState.ts }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/lib/api.ts }
  # Spec 052 (state-persistence) owns the orchestrator's workflow store.
  # Spec 172 additively adds SqliteWorkflowStore::list_active_workflows,
  # the consumer surface per FR-008, plus optional live-state fields on
  # WorkflowStateSummary. No behavioural change to spec 052's claims.
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/sqlite_state.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/state.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/hiqlite_store.rs }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: aide-analogue
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-blueprint-spec.md }
  - role: opc-session-substrate
    unit: { kind: file, path: specs/157-opc-session-model/spec.md }
  - role: orchestrator-substrate
    unit: { kind: file, path: specs/052-state-persistence/spec.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI10", "ASI08"]
summary: >
  OWASP ASI10 (Rogue Agents) requires operator-visible
  agent activity and the ability to terminate misbehaving
  agents. AIDE-VELOCITY's `GET /admin/sse-sessions`
  endpoint surfaces a live snapshot of all connected
  SSE clients, grouped by API key / user / IP — the
  operational primitive that lets an admin identify and
  force-disconnect a runaway agent. OPC has no
  equivalent surface today.

  This spec adds a Live Sessions panel to OPC's
  governance / inspect surface, showing every connected
  agent session (per spec 157 multi-session-per-project-
  path discipline, extended with the orchestrator's
  active workflows per spec 052) with per-session
  scope, event-rate, recent tool calls, and a force-
  disconnect control. The panel is the operator's
  defence against a runaway agent that consumes
  resources, makes excessive tool calls, or holds onto
  scopes beyond its intended lifetime.

  Force-disconnect is graceful — the agent's session
  is closed, its in-flight tool calls are cancelled,
  and the session checkpoint (per spec 095) preserves
  the conversational state for forensics. Force-
  disconnect is logged to the governance certificate
  chain for audit.
---

# 172 — Live agent-session introspection in OPC

## 1. Problem

OPC today displays the user's Claude Code session
history (per spec 157) — a list of past and present
sessions per project path. It does *not* display:

- **Live agent activity.** Tool calls in flight, event
  rate per session, current scope claim.
- **Orchestrator-level workflows.** Per spec 052, the
  orchestrator persists active workflow state; no UI
  surfaces this as live activity.
- **Force-disconnect capability.** No operator action
  terminates a runaway session.

OWASP ASI10 (Rogue Agents) treats this gap as
structural:

> *"Centralized lifecycle orchestrators + cryptographic
> per-run certificate = a rogue agent cannot self-
> replicate and erase its trail."*

The intent doc §7.2 names the cockpit-side gap
explicitly:

> *"Gap on live-session introspection panel in OPC and
> parent-child control tree with resource quotas."*

AIDE-VELOCITY's `GET /admin/sse-sessions` endpoint is
the AIDE-side precedent — *"a **live snapshot of all
connected SSE clients**, grouped by API key / user /
IP — operationally invaluable for identifying runaway
agents."* OPC needs an equivalent at the cockpit's
trust boundary.

## 2. Decision

Add a Live Sessions panel to OPC. The panel surfaces
real-time per-session state and exposes the
force-disconnect action.

### 2.1 Panel content

The panel displays:

- **Per-session row:**
  - Session id (per spec 157 — JSONL session UUID).
  - Project path (per spec 157 §3.1).
  - Connected-since timestamp.
  - Current scope claim (the Rauthy-issued JWT subject
    + tenant scope per spec 106 / 137 if applicable;
    "local-only" for sessions without platform identity).
  - Live event rate (tool calls per minute, token
    consumption per minute).
  - Recent tool calls (last N invocations with timing
    and exit status).
  - Status indicator (idle / active / warning /
    critical based on rate thresholds).
- **Per-workflow row** (from the orchestrator per spec
  052):
  - Workflow id.
  - Originating agent / session.
  - Stage in progress.
  - Time in current stage.
  - Resource consumption (cumulative for the workflow).

### 2.2 Force-disconnect action

For any displayed session, the operator can invoke
force-disconnect. The action:

1. Cancels in-flight tool calls (sends termination
   signals to tool-registry-managed processes).
2. Closes the agent's session connection.
3. Records the session's final state as a checkpoint
   (per spec 095) so the conversational history is
   preserved for forensics.
4. Emits a `force-disconnect` event to the
   governance certificate's audit chain
   (per spec 102 FR-007 — the operator is the signer).
5. Notifies the affected session's owner (via spec
   057 notification surface) — including the
   developer who owns the session if they are
   currently active.

### 2.3 Resource-rate thresholds

The panel highlights sessions exceeding configured
thresholds:

- Tool calls per minute above N → warning.
- Token consumption per minute above M → warning.
- Cumulative session resource consumption above Q →
  critical.

Thresholds are configurable per scope tier (spec 036).
The defaults are conservative; tenant-scoped sessions
may have lower defaults than substrate-scoped.

### 2.4 Composition with spec 052 (orchestrator)

The orchestrator persists workflow state per spec 052.
Spec 172 reads that state for the workflow rows; the
orchestrator is the source of truth. The panel does
not introduce a parallel state surface — it renders
the orchestrator's existing state.

### 2.5 Composition with spec 157 (session model)

Spec 157 establishes "many sessions per project path,
non-disambiguating across developers by design." Spec
172 surfaces those sessions as live; the
non-disambiguating posture means the panel may show
two sessions for the same project that belong to
different developers on the same workstation. Spec
172 does not solve disambiguation (per spec 157's
deferred concern); it surfaces what exists.

## 3. Functional Requirements

- **FR-001** OPC includes a "Live Sessions" panel
  reachable from the governance / inspect surface.
- **FR-002** The panel displays per-session and
  per-workflow rows updating in real time
  (subscription-based, not poll-based, where the
  underlying source supports it).
- **FR-003** Each session row shows the fields
  enumerated in §2.1 (id, project path, scope,
  event rate, recent tool calls, status).
- **FR-004** Each workflow row shows the fields
  enumerated in §2.1 (id, originating session,
  stage, time in stage, resource consumption).
- **FR-005** The operator can invoke force-disconnect
  on any displayed session. The action follows the
  five-step semantics of §2.2 (cancel → close →
  checkpoint → audit → notify).
- **FR-006** Sessions exceeding resource-rate
  thresholds are highlighted with warning / critical
  markers. Thresholds are configurable per safety
  tier (spec 036).
- **FR-007** Force-disconnect emissions are recorded
  to the governance certificate's audit chain (per
  spec 102 FR-007). The operator's identity is the
  signer.
- **FR-008** The panel respects spec 103's
  governed-artifact-reads discipline: workflow state
  is read via the orchestrator's consumer surface,
  not via ad-hoc parsing of the orchestrator's
  persistent state files.
- **FR-009** The panel is read-shaped except for
  force-disconnect: no other affordance mutates
  session or workflow state.

## 4. Success Criteria

- **SC-001** The Live Sessions panel displays all
  active sessions for the workstation user with
  live-updating event rates.
- **SC-002** Force-disconnect on a runaway test
  session cancels in-flight tool calls within 5
  seconds, closes the session, and emits an audit
  entry.
- **SC-003** A session exceeding configured tool-
  call thresholds renders with a warning marker
  before resource consumption becomes critical.
- **SC-004** The audit entry for a force-disconnect
  appears in the governance certificate chain and
  verifies via `make verify-certificate`.
- **SC-005** The panel reads workflow state through
  the orchestrator's consumer surface; no ad-hoc
  `.derived/**/*.json` parsing exists in the panel
  code.

## 5. Scope

### In scope

- The Live Sessions panel UI.
- Live session and workflow display.
- Force-disconnect action with its five-step
  semantics.
- Resource-rate threshold highlighting.
- Audit emission for force-disconnect.

### Out of scope (deferred)

- **Parent-child control tree with resource quotas.**
  Intent doc §7.2 names this as paired with live
  introspection. Spec 172 surfaces the activity;
  enforcing parent-child quota relationships is a
  separate spec (likely refining spec 052 or 043).
- **Cross-workstation session aggregation.** The
  panel shows the workstation's sessions; aggregating
  across multiple developers' workstations is a
  statecraft-side concern (future spec).
- **Predictive runaway detection.** Threshold-based
  highlighting is reactive. Predictive detection
  (ML-based anomaly detection on session behaviour)
  is a future enhancement.
- **Disambiguation across developers.** Spec 157
  deferred this; spec 172 does not solve it. The
  panel may show sessions belonging to different
  developers without distinguishing them.

## 5.1 Implementation note — audit-chain emission

FR-007 names the governance certificate as the destination for
force-disconnect emissions. Governance certificates are produced at
end-of-run by `factory-engine` per spec 102; they are not append-only
during a session's lifetime. The substrate the certificate seals is
the orchestrator's scoped event store (`scope="audit"`).
Force-disconnect therefore writes via
`SqliteWorkflowStore::append_scoped_event` keyed by a deterministic
UUIDv5 of the session id; the certificate verifier replays these
events at seal time. The implementation is faithful to FR-007: the
audit chain is the substrate, not a separate artifact.

## 6. Compliance

Spec 172 is the load-bearing OAP mitigation for the
cockpit-side **ASI10 (Rogue Agents)** gap. The
operator's live visibility + force-disconnect
capability is the canonical mitigation per OWASP
doctrine.

It also contributes to **ASI08 (Cascading Failures)**:
a misbehaving session can be terminated before its
cascade reaches downstream stages. Per intent doc
§7.2's ASI08 gap ("explicit `max_iterations` ceilings
on agent reasoning loops; circuit breakers at the
orchestrator stage boundary"), spec 172 is the
operator-side circuit breaker; the runtime ceilings
are a separate refinement of the orchestrator (spec
052) and factory-engine (spec 075).

## 7. Cross-references

- **INTENT doc** §7.2, §9.13.
- **AIDE-VELOCITY-blueprint-spec.md** §6 — the
  `GET /admin/sse-sessions` analogue.
- **Spec 157** — OPC session model; the substrate
  the panel renders.
- **Spec 052** — state-persistence; the
  orchestrator's workflow state source.
- **Spec 102** — governed-excellence; the audit
  chain force-disconnect emissions append to.
- **Spec 095** — checkpoint-branch-of-thought; the
  forensic-preservation mechanism on disconnect.
- **Spec 057** — notification-system; the
  disconnect notification surface.
- **Spec 067** — tool-definition-registry; the
  surface in-flight tool calls are cancelled
  through.
- **Spec 036** — safety-tier-governance; the
  threshold configuration substrate.


## Security hardening amendment (2026-07-02)

Acknowledging the 2026-07-02 security-hardening amendment to spec 052 (state-persistence), which this spec refines. The orchestrator verify and claude-executor shell-boundary documentation recorded there does not alter the live agent session introspection surface this spec governs; the note satisfies the spec 127 coupling gate for the co-authored spec.md path.
