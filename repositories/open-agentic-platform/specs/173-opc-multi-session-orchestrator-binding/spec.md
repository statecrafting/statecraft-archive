---
id: "173-opc-multi-session-orchestrator-binding"
slug: opc-multi-session-orchestrator-binding
title: "OPC multi-session-by-project-path — orchestrator binding (formalisation)"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
approved: "2026-05-23"
kind: governance
domain: opc
risk: low
depends_on:
  - "052-state-persistence"  # state-persistence (the spec this spec refines)
  - "095-checkpoint-branch-of-thought"  # checkpoint-branch-of-thought
  - "157-opc-session-model"  # opc-session-model (the existing closure spec)
code_aliases: ["MULTI_SESSION_ORCHESTRATOR_BINDING"]
refines:
  - aspect: "orchestrator-session-binding"
    unit: { kind: directory, path: crates/orchestrator }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: predecessor-spec
    unit: { kind: file, path: specs/157-opc-session-model/spec.md }
  - role: companion-mechanism
    unit: { kind: file, path: specs/095-checkpoint-branch-of-thought/spec.md }
summary: >
  Spec 157 formalises OPC's multi-session-per-project-
  path discipline at the *session model* layer
  (filesystem layout, JSONL authority, non-
  disambiguating across developers by design). Intent
  doc §9.14 named a single concern and carried two
  hints — "session model (formalised)" and "refines
  spec 052". Spec 157 took the session-model half;
  this spec takes the orchestrator binding the
  052-refinement hint pointed at.

  Spec 157 covers what OPC reads from JSONL; spec 173
  covers what the orchestrator persists in response.
  The two compose at the project-path key: a
  developer's many OPC sessions for one project path
  may each initiate orchestrator workflows, and the
  orchestrator's persistence keys workflows by the
  same path identity OPC uses, inheriting spec 157's
  non-disambiguating posture.

  Spec 173 is a thin refinement of spec 052: it adds
  one identity field on persisted workflows
  (`project_path`) and one trace field
  (`originating_session`), exposes a new consumer
  surface `workflows by-project-path`, and binds the
  orchestrator to honour spec 157's discipline rather
  than reasserting it.
---

# 173 — OPC multi-session-by-project-path: orchestrator binding

## 1. Problem

Spec 157 closes the spec-authority gap on OPC's
session model. The Tauri commands in
`product/apps/opc/src-tauri/src/commands/claude.rs`
read Claude Code's JSONL session history and surface a
multi-session-per-project-path discipline. Spec 157
makes that discipline normative.

Separately, spec 052 (state-persistence) governs the
orchestrator's persistence of workflow state. Workflows
today are persisted *per task* — the orchestrator
dispatches a task, persists its progress, and the task
completes (or fails) as a unit.

Two model gaps follow:

1. **No mapping between OPC sessions and orchestrator
   workflows.** A developer running multiple OPC
   sessions for the same project may invoke the
   orchestrator from each; the orchestrator does not
   associate the resulting workflows with the
   sessions that initiated them. Per-session
   continuity at the orchestrator layer doesn't exist.
2. **No project-path-keyed workflow accumulation.**
   The orchestrator keys workflows by task identity,
   not by project-path identity. A developer
   accumulating institutional memory across many
   sessions on one project sees that memory at the
   OPC session list level (spec 157) but not at the
   orchestrator workflow level.

The intent doc §9.14 names *one* concern with two
hints inside it:

> *"OPC multi-session-by-project-path session model
> (formalised). Per §4.2. Captures the discipline
> that's already implicit in OPC and binds it to the
> spec spine. Kind: governance; refines spec 052."*

The first hint — *"session model (formalised)"* — is
the OPC read-surface concern. Spec 157 took that and
landed during the 2026-05-22 session-model work
(authored after the intent doc was tightened in the
spec 156 PR thread but before the §9 decomposition
pass). Spec 157 is therefore the §9.14 mention's
literal subject.

The second hint — *"refines spec 052"* — points at
the orchestrator persistence layer. Spec 052
establishes per-task workflow state; aligning that
state with spec 157's project-path-keyed discipline
is what this spec covers. §4.2 of the intent doc
says explicitly:

> *"OPC's session model is *multi-session per project
> path*. Each session is independently persisted;
> logged-in user identity disambiguates sessions
> across developers; checkpoint hooks (spec 095)
> capture branch-of-thought without forcing a single
> linear session per project."*

Spec 157 grounds this in OPC's JSONL read surface.
Spec 173 binds the orchestrator's persistence to the
same discipline. Spec 157 stands alone; spec 173 is
the orchestrator-side binding the §9.14
052-refinement hint implied.

## 2. Decision

Refine spec 052 with project-path identity as a
first-class key on persisted workflows. Workflows
gain a `project_path:` field; the orchestrator's
persistence surface accumulates workflows keyed by
this identity in addition to the existing per-task
keying. A second field, `originating_session:`, is
added as a *trace-only* breadcrumb for the live
introspection consumer named in §2.5.

### 2.1 Identity binding

A workflow initiated from an OPC session carries the
session's `project_path` (per spec 157 §3.1's
discipline) as the workflow's identity field. The
orchestrator persists:

```
workflow:
  workflow_id: <uuid>
  task_id: <existing-per-task-identity>
  project_path: <decoded-fs-path>   # NEW — spec 173 identity key
  originating_session: <session-uuid>  # NEW — spec 173 trace field
  ...
```

The orchestrator's existing per-task semantics are
unchanged; spec 173 adds two derived fields without
modifying task semantics. The two fields have
distinct loads — see §2.5.

### 2.2 Project-path-keyed accumulation

A new orchestrator consumer surface — `workflows
by-project-path <path>` — returns all workflows for a
given project path across sessions. This is the
substrate spec 172 (live session introspection) uses
to render workflow rows per project.

### 2.3 Non-disambiguation honoured

Per spec 157 §4 ("non-disambiguating across
developers by design"), the orchestrator does not
disambiguate workflows by developer identity. Two
developers running OPC against the same workstation
filesystem path produce workflows that accumulate in
the same project-path bucket. Disambiguation is
deferred (as spec 157 defers it for sessions).

### 2.4 No per-session orchestrator state

Spec 173 binds workflows to project-paths, not to
sessions individually. The orchestrator does not
maintain per-session state — its unit of
persistence is the workflow, not the session.

This keeps the model honest: sessions are OPC's
unit (spec 157); workflows are the orchestrator's
unit; the project path is the shared key.

### 2.5 The two fields carry different loads

The two fields added by spec 173 are not symmetric:

- **`project_path`** is an *identity field*. It is
  what the new `workflows by-project-path` consumer
  surface keys on (§FR-003), and it is what binds
  the orchestrator to spec 157's discipline. It is
  load-bearing for the binding.
- **`originating_session`** is a *trace field*.
  Spec 172 (live agent-session introspection) needs
  it: §2.1 of spec 172 enumerates workflow rows
  showing *"Originating agent / session"* — that
  rendering reads `originating_session`. Beyond
  spec 172's consumer, the field is breadcrumb for
  debug and forensics. It is *not* an identity key
  and the orchestrator does not key persistence on
  it.

This asymmetry is the answer to the obvious
follow-up — "if the orchestrator doesn't disambiguate
by session, why carry a session identifier at all?"
The field exists for the introspection consumer (spec
172) named explicitly, and is degradable: a workflow
initiated outside OPC carries `originating_session:
null` and the consumer renders the absence as
"non-OPC origin" rather than failing.

## 3. Functional Requirements

- **FR-001** The orchestrator's workflow persistence
  schema (per spec 052) adds two fields:
  `project_path` and `originating_session`. Both are
  required for workflows initiated from OPC sessions;
  optional with documented `null` semantics for
  workflows initiated from other surfaces (CLI,
  scheduled tasks, factory-engine).
- **FR-002** When OPC initiates an orchestrator
  workflow, the workflow's `project_path` is the
  decoded JSONL-authoritative path (per spec 157
  §3.3 — JSONL content wins over directory-name
  encoding on disagreement).
- **FR-003** A new orchestrator consumer surface —
  `workflows by-project-path <path>` — returns all
  workflows for the given project path, sorted by
  recency.
- **FR-004** The orchestrator does not maintain
  per-session state. Sessions are OPC's unit; the
  orchestrator references them via
  `originating_session` but does not key persistence
  on session identity.
- **FR-005** The non-disambiguating posture of spec
  157 is honoured: two developers' workflows for the
  same workstation filesystem path accumulate in the
  same project-path bucket; the orchestrator does
  not disambiguate.
- **FR-006** Backward compatibility is achieved at
  the persistence-layer schema, not by application
  code. Both `project_path` and `originating_session`
  are added as *nullable* columns on the workflow
  persistence tables in
  `crates/orchestrator/src/sqlite_state.rs` and
  `crates/orchestrator/src/hiqlite_store.rs` (the
  two `state.rs`-fronted backends). The Rust
  deserializer reads them as `Option<String>`.
  Pre-spec-173 workflow records load with both
  fields as `None` (the SQL NULL surfaces as
  `Option::None` without explicit handling), no
  migration script is required, and no backfill is
  performed. New workflows carry the populated
  fields per FR-001 / FR-002. Any future spec that
  changes either field from nullable to required
  *must* author an explicit migration step rather
  than reusing this read-time-default posture.
- **FR-007** Spec 172's Live Sessions panel reads
  workflows via the new `workflows by-project-path`
  surface, not via ad-hoc orchestrator state
  parsing.

## 4. Success Criteria

- **SC-001** An OPC-initiated orchestrator workflow
  carries `project_path` matching the spec 157
  JSONL-authoritative path.
- **SC-002** Querying workflows by project path
  returns all workflows for that path across
  sessions and developers, sorted by recency.
- **SC-003** A workflow initiated outside OPC (CLI,
  scheduled task, factory-engine) persists with
  `project_path: null` and surfaces correctly
  through existing consumer surfaces.
- **SC-004** The orchestrator's persistence schema
  is backward-compatible: existing workflows
  remain valid without modification.

## 5. Scope

### In scope

- The two added fields on the orchestrator's
  workflow persistence schema.
- The `workflows by-project-path` consumer surface.
- Integration with OPC's workflow-initiation paths.
- Backward compatibility for pre-spec-173 workflows.

### Out of scope (deferred)

- **Per-session orchestrator state.** Sessions
  remain OPC's unit. The orchestrator does not key
  on session identity.
- **Developer-level disambiguation.** Spec 157
  deferred this; spec 173 honours the deferral.
- **Cross-workstation aggregation.** Like spec 172,
  spec 173 is workstation-local. Cross-workstation
  workflow aggregation is a future statecraft-side
  concern.
- **Workflow migration UI.** Pre-spec-173 workflows
  carry `null` project_path; no UI surfaces this
  gap or offers to backfill. Migration tooling, if
  needed, is a future spec.

### Cross-crate coupling — explicit

Spec 173's added fields (`project_path`,
`originating_session`) live on the orchestrator's
persistence schema in
`crates/orchestrator/src/{state,store,sqlite_state,hiqlite_store}.rs`.
They are *not* spec frontmatter and do not enter
`tools/shared/spec-types/src/lib.rs`'s `KNOWN_KEYS`
or `SHAPE_TABLE` — those govern spec frontmatter
authoring shape, not orchestrator persistence shape.

The W-01..W-12 typed-reader sequence
(commits `3c2890f9`, `0aa6b5be`, `4fac11b7`,
`7ede4d93`, `7910af41`, `0b6d3f35`, `8c6726a2`)
hoisted *consumer-side* JSON parsing (registry-
consumer, codebase-indexer, featuregraph, apps/
desktop) into shared types. Orchestrator persistence
types have not been hoisted at the time spec 173 is
authored.

Spec 173 lands *before* any future hoist of
orchestrator persistence types into a shared crate.
If such a hoist is later authored as its own spec,
that spec is responsible for absorbing spec 173's
two added fields into the shared type definitions;
spec 173 does not pre-coordinate the absorption and
does not commit to a hoist trajectory. The spec
173 contract is the schema-level field addition;
the *typing* of that schema is owned by whichever
crate (orchestrator-local or shared) carries it at
implementation time.

## 6. Relationship to spec 157 — binding, not duplication

Spec 157 establishes OPC's session model: many
sessions per project path, JSONL-authoritative
identity, non-disambiguating across developers. It is
a standalone session-model spec — complete on its own
read-surface terms.

Spec 173 *binds* the orchestrator to spec 157's
discipline. It does not re-establish the discipline,
re-state the model, or duplicate spec 157's
authority. The binding has three load-bearing
properties:

1. **Inherits identity.** The `project_path` on
   workflows is the spec 157 JSONL-authoritative
   path (§FR-002), not an independent orchestrator
   reading of the filesystem.
2. **Inherits non-disambiguation.** The orchestrator
   does not split workflows by developer identity
   (§FR-005); spec 157 §4 already deferred that
   concern and spec 173 honours the deferral.
3. **Inherits degradation.** Workflows initiated
   outside OPC carry both fields as `null`; the
   orchestrator's existing per-task semantics work
   unchanged. Spec 157's discipline applies where it
   applies; spec 173 does not extend the discipline
   to non-OPC origins.

The two specs cover different layers (OPC read
surface; orchestrator persistence). A future
contributor reading either finds the other in the
cross-references. Folding them would hide
orchestrator-layer governance inside a session-model
spec and break the spec 052 refinement chain — see
§9 of the intent doc, which named both halves under
§9.14 but pointed each at a different refinement
target.

## 7. Cross-references

- **INTENT doc** §4.2 (the discipline), §9.14 (the
  twin-hint mention §1 unpacks).
- **Spec 052** — state-persistence; refined by this
  spec (schema-level field addition).
- **Spec 157** — OPC session model; spec 173 binds
  to its discipline at the orchestrator layer.
- **Spec 095** — checkpoint-branch-of-thought; the
  companion mechanism for multi-session continuity.
- **Spec 172** — live session introspection; the
  named consumer of `originating_session` (renders
  workflow rows with the "Originating agent /
  session" column per spec 172 §2.1) and of the
  `workflows by-project-path` surface
  (FR-008 of spec 172).
- **W-01..W-12 typed-reader sequence** — commits
  `3c2890f9`, `0aa6b5be`, `4fac11b7`, `7ede4d93`,
  `7910af41`, `0b6d3f35`, `8c6726a2`; precedent for
  the consumer-side hoist trajectory the
  "Cross-crate coupling" subsection of §5 references.
