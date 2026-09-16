---
id: "157-opc-session-model"
slug: opc-session-model
title: "OPC session model — multi-session-per-project-path, JSONL-authoritative"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
approved: "2026-05-22"
kind: governance
domain: opc
risk: low
depends_on:
  - "045-claude-code-sdk-bridge"
code_aliases: ["OPC_SESSION_MODEL"]
establishes:
  - unit: { kind: symbol, id: opc::commands::claude::list_projects }
  - unit: { kind: symbol, id: opc::commands::claude::get_project_sessions }
  - unit: { kind: symbol, id: opc::commands::claude::decode_project_path }
  - unit: { kind: symbol, id: opc::commands::claude::get_project_path_from_sessions }
references:
  - role: implementation-witness
    unit: { kind: file, path: product/apps/opc/src/stores/sessionStore.ts }
  - role: analogous-pattern
    unit: { kind: file, path: specs/099-workspace-scoped-persistence/spec.md }
  - role: complementary-mechanism
    unit: { kind: file, path: specs/095-checkpoint-branch-of-thought/spec.md }
summary: >
  OPC's session model has been operating since the desktop app shipped:
  Claude Code's own filesystem-backed JSONL session history is the
  source of truth, surfaced to the desktop UI via four Tauri commands
  in `product/apps/opc/src-tauri/src/commands/claude.rs`
  (`list_projects`, `get_project_sessions`, `decode_project_path`,
  `get_project_path_from_sessions`). The discipline that emerges from
  this surface — many sessions per project path, project identity by
  *filesystem path* rather than statecraft project UUID, JSONL content
  authoritative over the encoded directory name, non-disambiguating
  across developers by design — has had no spec authority until now.

  This spec formalises the discipline. No code changes ride on the
  spec landing; the four named symbols already exist and exhibit the
  documented behaviour. What lands is symbol-level spec authority
  over the session-model protocol, alongside spec 045's pre-existing
  file-level claim on `claude.rs` for the broader Claude Code SDK
  bridge surface — spec 154 §6's authority function resolves the
  layered ownership cleanly. The design choice that the layout is
  *non-disambiguating across developers* is stated affirmatively, not
  apologetically: OPC inherits Claude Code's own session model and
  any disambiguation surface is a separable concern owned by a
  later spec.
---

# 157 — OPC session model

## 1. Problem

OPC's desktop cockpit displays the user's Claude Code session
history. The implementation has shipped since the desktop's first
release: four Tauri commands in
[`product/apps/opc/src-tauri/src/commands/claude.rs`](../../product/apps/opc/src-tauri/src/commands/claude.rs)
read `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl`, return
typed `Project` and `Session` rows, and the desktop's Zustand store
([`product/apps/opc/src/stores/sessionStore.ts`](../../product/apps/opc/src/stores/sessionStore.ts))
materialises the result keyed by `projectId`.

The *discipline* this surface enforces — what counts as a project,
what counts as a session, how many sessions can live under one
project, what disambiguation guarantees exist across developers,
which artefact is the source of truth when two views of the project
path disagree — has not been governed at the spec layer. INTENT
§4.2 ("Sessions — multi by project path") names a discipline; that
discipline matches what the code does today; no spec records it.

The gap is concrete:

- **A future refactor of `decode_project_path` could silently widen
  or narrow the encoding scheme** with no spec edit to compare
  against. The encoding is the load-bearing detail that lets two
  developers' sessions for `oap` show up together
  in the OPC project list.
- **A future contributor reading `claude.rs::list_projects`** has no
  documented reason for the JSONL-content-over-directory-name
  resolution order in `get_project_path_from_sessions`. Without
  spec context that ordering reads as defensive coding rather than
  as the normative "JSONL is truth" stance.
- **Anyone reasoning about identity in statecraft↔OPC integration**
  (per the future statecraft-side ingestion path INTENT §4.2 hints
  at) needs an authoritative answer to "what is the project, and
  what is the session, in OPC terms?" The current answer is
  "whatever `claude.rs` returns" — fine operationally, fragile as a
  contract.

This spec converts the operational fact into a documented
discipline. The closure is essentially retroactive: implementation
is complete, four symbols exist, the behaviour is what the spec
says.

## 2. Decision

Formalise the OPC session model as it operates today. Bring the
four `claude::*` symbols listed in frontmatter under symbol-level
spec authority. The discipline has four load-bearing claims, each
mapped to spec text below:

1. **Filesystem layout** (`~/.claude/projects/<encoded-path>/`) is the
   substrate. Sessions are JSONL files inside the project directory.
   See §3.1.
2. **Many sessions per project path** is intentional, not a
   side-effect. Developers may produce as many sessions as they
   like under one project; no platform enforcement caps the
   count. See §3.2.
3. **JSONL content is normative for project identity.** The encoded
   directory name is a *lookup index* over the path, not the path
   itself; on disagreement, the JSONL content wins. See §3.3.
4. **The layout is non-disambiguating across developers by design.**
   This is an artefact of Claude Code's own session model, which
   OPC reads directly. Per-developer disambiguation is a separable
   concern owned by a later spec. See §4.

This is a closure spec for shipped code. No code changes ride on
the spec landing. Spec 045 retains its file-level wrapping
extension on `claude.rs` for the broader Claude Code SDK bridge
surface; spec 157 claims four specific symbols inside that file
under spec 154 §6's authority resolution (narrower wins on its
surface, broader retains the rest).

## 3. The session model

### 3.1 Filesystem layout

OPC reads Claude Code's own on-disk session history. The layout:

```
~/.claude/projects/
  -Users-bart-Dev2-open-agentic-platform/      # project directory
    <session-uuid-1>.jsonl                      # one session per file
    <session-uuid-2>.jsonl
    <session-uuid-3>.jsonl
  -Users-bart-other-repo/
    ...
```

Each top-level entry is one *project*; the directory name is the
project's filesystem path encoded by replacing `/` with `-` (and
analogous transformations for cross-platform path components).
Each `.jsonl` file inside is one *session* — a Claude Code
conversation log with a UUID filename.

The Tauri command `opc::commands::claude::list_projects` enumerates project
directories and returns `Project` records carrying the *decoded*
path, a list of session UUIDs, and the most-recent-session
timestamp. `opc::commands::claude::get_project_sessions` returns the `.jsonl`
session records for a given project.

### 3.2 Many sessions per project

OPC imposes no upper bound on the number of sessions under a
project. A developer who wants to explore alternative agent paths
on the same codebase produces multiple sessions; OPC surfaces all
of them in the project's session list. This is the **inverse** of
AIDE-HARNESS's "one stable UUID per project" pattern (per INTENT
§4.2) and intentional — the multi-session shape is the substrate
for the checkpoint-branch-of-thought workflow named in spec 095.

The constraint is the absence of constraint: no Tauri command
caps the session count, no UI prompt asks the user to close prior
sessions, no storage policy prunes old `.jsonl` files. This
non-enforcement is the contract.

### 3.3 JSONL content is normative for project identity

The project's filesystem path appears in two places:

1. **Encoded into the directory name** (`...` →
   `-Users-bart-Dev2-...`).
2. **Recorded inside each session's JSONL content** by Claude Code
   when the session was first written.

The encoding in (1) is **lossy and ambiguous** — multiple original
paths can collide on the same encoded form (a path containing a
literal `-` cannot be distinguished from the encoding artefact);
the encoding scheme has changed historically; cross-platform path
separator handling adds variants. The JSONL content in (2) carries
the path *as the agent saw it* at session-start time.

The contract: **JSONL content is the source of truth for project
path; the directory name is a lookup index, not the identity**. The
resolution order in `opc::commands::claude::get_project_path_from_sessions` reads
the JSONL content first and falls back to `opc::commands::claude::decode_project_path`
only if no session content is available. On disagreement between
the two views, the JSONL wins.

This is the load-bearing detail that distinguishes "OPC reads
Claude Code's session model" from "OPC defines its own session
model on top." OPC reads; it does not redefine. The encoded
directory name is Claude Code's filesystem index, not OPC's
identity assertion.

### 3.4 OPC project identity vs statecraft project identity

The `Project` record returned by `opc::commands::claude::list_projects` is bound
to a filesystem path, not to a statecraft project UUID. Two
distinct statecraft projects in two different orgs may share the
same filesystem path on a developer's workstation; OPC sees one
project (the path), statecraft sees two (the UUIDs).

This is intentional and documented for downstream consumers:

- **Path-identity is workstation-scoped.** It exists only on the
  developer's local filesystem.
- **UUID-identity is platform-scoped.** It lives in statecraft's
  database and survives across workstations.

Future ingestion of OPC session events into statecraft (INTENT
§4.2 names this as the disambiguable-session-streams aspiration)
will need to carry both identities and join them at the ingestion
layer. That ingestion is **out of scope for this spec**; the
contract this spec establishes is the OPC-local one.

## 4. Non-disambiguating-by-design

The layout in §3.1 carries no developer identity. Two developers
sharing the same workstation account who run Claude Code against
the same project path will produce sessions that intermix in the
same project directory. The Tauri commands cannot tell them
apart; the JSONL content does not carry per-developer fields
(Claude Code itself does not write authorship into the session
log); OPC surfaces them as a single session list.

**This is a design choice, not an oversight.** OPC inherits Claude
Code's session model verbatim. Claude Code's discipline is "the
filesystem path is the session boundary; the workstation user is
the implicit identity"; OPC reads that discipline without
modifying it. Adding a disambiguation surface — a per-developer
session prefix, a JSONL-content-level authorship field, a UI
overlay — would require either:

- A change to Claude Code's own session writer (out of scope; OPC
  is downstream),
- A workstation-level overlay that re-keys sessions before OPC
  reads them (a separable mechanism, not part of the session
  model itself), or
- A statecraft-side ingestion that joins OPC's path-identity to a
  signed-in user identity at the platform layer (the path INTENT
  §4.2 names, deferred to a later spec).

Spec 157 establishes the discipline as it stands. Disambiguation
is a separable concern; deferring it is structural, not an
omission. A future spec authoring per-developer disambiguation
extends this spec rather than refining the four symbols' contract.

## 5. Compliance

*This section is supporting rationale, not motivating. Spec 157's
primary motivation is closing the spec-authority gap in §1; the
ASI09 alignment below is a downstream consequence of the
multi-session-per-path shape, not the reason the shape exists.*

OWASP ASI09 (Human-Agent Trust). INTENT §7.2 records an OAP gap on
*"deterministic structural-diff plan UI in OPC and M-of-N dual-auth
UX for tenant-boundary actions."* The multi-session-per-path
discipline supports the anti-anthropomorphic-trust posture
underlying that gap: a developer can branch alternative agent
paths via new sessions or via spec 095's checkpoint mechanism
without being locked into a single linear conversation per
project. The inverse-of-AIDE-HARNESS framing in §3.2 is exactly
this: AIDE-HARNESS's "one stable UUID per project" pattern is the
lock-in OAP refuses; the many-sessions-per-path shape is what
makes the refusal operational.

The substrate property — many sessions, freely branchable, all
visible — is what lets the developer maintain alternative
hypotheses about an agent's behaviour without committing to a
single conversation tree. That is the spec 102 FR-007 posture
("the auditor's verifier does not trust the producer") applied to
the developer↔agent surface: the developer is not trusted to a
single linear thread of agent reasoning.

Spec 157 does not establish this posture — spec 102 does, at the
governance-certificate layer. Spec 157 inherits it at the session
layer and documents the inheritance.

## 6. Scope

### In scope (this spec)

- Symbol-level spec authority over the four `claude::*` Tauri
  commands listed in frontmatter (§3.1–§3.3).
- The four discipline claims (§3.1, §3.2, §3.3, §4).
- The OPC-project ↔ statecraft-project identity separation (§3.4).
- The ASI09 alignment as supporting rationale (§5).

### Out of scope (and intentionally so)

- **Per-developer disambiguation.** Deferred to a later spec per §4.
  The non-disambiguating shape is a design choice; spec 157 records
  it, does not solve it. A future amendment or new spec authoring
  per-developer disambiguation extends the surface here.
- **Statecraft-side session ingestion.** Deferred to a later spec
  per §3.4. INTENT §4.2's "disambiguable session streams at the
  statecraft level" aspiration is a downstream consumer surface,
  not part of the OPC-local session model.
- **Claude Code's own session writer.** Out of scope by definition;
  OPC is downstream of Claude Code, not upstream.
- **The Zustand store at `sessionStore.ts`.** Referenced as an
  implementation-witness in frontmatter (`role: implementation-
  witness`), not claimed for ownership. A future frontend rewrite
  (Solid, Svelte, vanilla TS) reimplements the materialisation
  without changing the contract spec 157 governs.

## 7. Acceptance

This is a closure spec for shipped code. Acceptance criteria are
assertions about current reality, not future verifications:

- The four symbols `opc::commands::claude::list_projects`,
  `opc::commands::claude::get_project_sessions`, `opc::commands::claude::decode_project_path`,
  and `opc::commands::claude::get_project_path_from_sessions` exist in
  [`product/apps/opc/src-tauri/src/commands/claude.rs`](../../product/apps/opc/src-tauri/src/commands/claude.rs)
  at the time this spec lands.
- `opc::commands::claude::list_projects` enumerates directories under
  `~/.claude/projects/` and returns one `Project` per directory.
- `opc::commands::claude::get_project_sessions` returns the `.jsonl` files inside
  a project directory.
- `opc::commands::claude::get_project_path_from_sessions` resolves a project's
  path by reading JSONL content first and falls back to
  `decode_project_path` only if no session content is available.
  The JSONL path is authoritative on disagreement.
- The Zustand store at `sessionStore.ts` materialises sessions
  keyed by `projectId` and imposes no client-side session-count
  cap.
- The spec-compiler accepts this spec's frontmatter without
  V-rule emissions on its own grammar (spec-lint info-tier L-005
  on the precedent specs cited in `references:` is acceptable per
  the Tier 2 migration-window posture).
- The codebase-indexer (post spec 154 Segment 3) records the four
  `kind: symbol` resolved units under `establishes:` with
  `ownership: true` and non-empty `locations`.
- The coupling gate, run against the spec 157 landing PR's diff,
  does not fire on the implementation overlap with spec 045's
  file-level claim on `claude.rs` (spec 154 §6 resolves layered
  ownership cleanly; if the gate fires, that is a separate
  sharpening pass spec 154 §6 owns — not a spec 157 defect).

## 8. Cross-references

- **Spec 045** — `claude-code-sdk-bridge`; establishes the Claude
  Code SDK bridge and wraps `claude.rs` at the file level. Spec
  157's symbol-level claims on four functions inside that file
  coexist under spec 154 §6's authority resolution. Spec 157
  `depends_on: ["045"]` for the session-resumption machinery that
  spec 045 FR-003 establishes (`resume: sessionId` semantics).
- **Spec 095** — `checkpoint-branch-of-thought`; cited via
  `references: role: complementary-mechanism`. Provides the
  branch-of-thought mechanism that consumes the many-sessions-per-
  path substrate this spec formalises.
- **Spec 099** — `workspace-scoped-persistence`; cited via
  `references: role: analogous-pattern`. Different layer
  (orchestrator workflow state, not OPC sessions) but the same
  shape: scope-by-project-identifier discipline, retroactive
  amendment when the identifier semantics changed. Style precedent,
  no functional dependency.
- **Spec 102** — `governed-excellence`; FR-007's verifier-does-
  not-trust-producer posture is the meta-design behind the
  ASI09 alignment in §5. Not a direct dependency; cited as the
  meta-source for the posture spec 157 inherits.
- **Spec 154** — `logical-unit-ownership-grammar`; §6 authority
  function is what makes the spec-045 ↔ spec-157 coexistence on
  `claude.rs` work without prose carve-outs. §3.2 (`symbol:`)
  grammar is what makes the four symbol units expressible.
- **INTENT doc** —
  [`docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md`](../../docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md);
  §4.2 names the discipline (its third claim — "disambiguable
  session streams at the statecraft level" — is the one this spec
  defers to a later spec); §4.4 contains the comparison table
  with AIDE-HARNESS's "one stable UUID per project" pattern that
  §3.2 inverts; §7.2 carries the ASI09 posture cited in §5.
