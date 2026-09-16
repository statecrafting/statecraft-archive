---
id: "166-opc-stop-hook-gate-chain"
slug: opc-stop-hook-gate-chain
title: "OPC Stop-hook gate chain — conversation-time drift gates"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: opc
risk: medium
depends_on:
  - "101-codebase-index-mvp"  # codebase-index-mvp (codebase-indexer check)
  - "103-init-protocol-governed-reads"  # init-protocol-governed-reads (consumer binaries)
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate (the gate this spec extends)
  - "128-spec-lint-default-fail-on-warn"  # spec-lint-default-fail-on-warn
  - "131-adversarial-prompt-refusal-policy"  # adversarial-prompt-refusal-policy (Stop-time is the refusal seam)
  - "133-amends-aware-coupling-gate"  # amends-aware coupling gate
  - "134-fast-local-ci-mode"  # fast-local-ci-mode
  - "135-fast-ci-as-default"  # fast-ci-as-default
code_aliases: ["OPC_STOP_GATES", "CONVERSATION_TIME_GATES"]
establishes:
  - unit: { kind: file, path: product/apps/opc/src-tauri/resources/claude-hooks.json }
  - unit: { kind: directory, path: product/apps/opc/src-tauri/resources/claude-hooks }
extends:
  # The OPC desktop crate is co-authored under spec 032 (OPC inspect +
  # governance wiring MVP). Spec 166 additively adds:
  #   - a platform tier + platform-mandatory floor to the existing
  #     hooks merge surface (hooksManager.ts, types/hooks.ts), and
  #   - a new bundle.resources entry pointing at the bundled hook
  #     configuration (tauri.conf.json).
  # No behavioural change to spec 032's existing claims.
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/lib/hooksManager.ts }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/lib/hooksManager.spec166.test.ts }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/types/hooks.ts }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/tauri.conf.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: aide-analogue
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-HARNESS-blueprint-spec.md }
  - role: existing-gate-binaries
    unit: { kind: file, path: Makefile }
  - role: governed-read-discipline
    unit: { kind: file, path: specs/103-init-protocol-governed-reads/spec.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI01", "ASI06"]
summary: >
  OAP runs governance gates at PR time today
  (`make pr-prep`, `make ci`, the spec-code coupling
  gate, spec-lint default-fail-on-warn). AIDE-VELOCITY-
  HARNESS's structural leverage is that gates fire at
  *conversation end*, inside the Claude Code session,
  before any commit is made. The harness's six
  mandatory Stop hooks (docs-sync, step-output
  validation, step-gates, security-gate, harness-sync,
  finding-codified) catch drift before it reaches a
  PR.

  OPC should adopt the same pattern. This spec wires
  `make pr-prep`-class checks as PostToolUse (cheap,
  staleness signal) and Stop (blocking, full
  validation) hooks in OPC's Claude Code surface. The
  binaries already exist; the wiring is new. Hooks
  read through the governed-artifact-reads discipline
  (spec 103) — they invoke `codebase-indexer check`,
  `spec-code-coupling-check`, `spec-lint`, and the
  V004 lint binary, never ad-hoc `python`/`jq`/`awk`
  over `.derived/**/*.json`.

  Spec 166 refines spec 127 by adding a second
  firing seam (Stop-time) without removing the
  existing PR-time seam. Both fire; the user gets
  drift signal at the earliest available moment.
---

# 166 — OPC Stop-hook gate chain

## 1. Problem

OAP's governance gates fire at PR time:

- `make ci` (the daily dev loop, per spec 135) runs the gate
  suite locally before a developer pushes.
- `make pr-prep` (per spec 127 implementation) regenerates the
  codebase index and runs the coupling gate against `origin/main`.
- `.github/workflows/ci-spec-code-coupling.yml` enforces the
  coupling gate at PR merge time.

This is correct discipline. The remaining leverage is the
*seam*. A developer using Claude Code via OPC can make a series
of edits in one session, then close the session, then push — and
discover gate failures only at `make pr-prep` or in CI. The
gates fire after the session, not during.

AIDE-VELOCITY-HARNESS demonstrates the alternative seam: the six
Stop hooks fire when the agent closes the conversation, *before
any commit*. The gates' diagnostic surface in the conversation
window. A failure stops the conversation from being marked
complete and surfaces the failure to the developer who is still
oriented to the work.

The intent doc §8.7 names this:

> *"OPC should adopt the harness's leverage point — gates fire at
> conversation end, inside the Claude Code session, before any
> commit. The mechanics already exist (`make pr-prep` runs the
> same gates); the wiring is new."*

The gap is the wiring. The gate binaries exist. The Claude Code
hook mechanism exists. No spec authority wires them together for
OPC's session surface.

## 2. Decision

Wire the existing gate binaries as PostToolUse and Stop hooks in
OPC's Claude Code surface. The hooks read through the
governed-artifact-reads discipline (spec 103); they invoke the
binaries, not ad-hoc parsers.

### 2.1 Hook chain

**PostToolUse (`Edit|Write`)** — runs cheap staleness signals
after every file edit. Fires asynchronously so it does not block
the next tool call; emissions surface as session-visible
diagnostics. Default invocations:

1. `codebase-indexer check` — staleness gate. If any input file
   changed and the index is stale, the diagnostic surfaces.
2. `spec-lint --quiet` on the project's spec spine if any
   `specs/**/spec.md` was edited.

**Stop (blocking)** — fires when the agent attempts to close
the conversation. Each entry blocks closure on non-zero exit;
the agent sees the diagnostic and the user is presented with
the option to address it before closing. Default invocations,
in order:

1. `codebase-indexer check` — re-runs the staleness gate.
2. `spec-lint` — full lint with default-fail-on-warn (spec 128).
3. `spec-code-coupling-check` against the working tree
   (lighter than `make pr-prep`'s `origin/main` comparison;
   tuned for conversation-end speed).
4. `tools/lint/workflow-ref-sha-pinning-lint` — the spec 158
   surface, if any `.github/workflows/*.yml` was edited.

Each hook entry has a documented exit-code contract; a
non-zero exit blocks the close. The user can override (close
anyway) with a logged decision that the next session sees as
known-drift.

### 2.2 Governed-read discipline

Every hook invokes the consumer binary, never raw JSON. The
hook chain is itself an orchestrated workflow per spec 103, so
the constraint applies absolutely: a hook script invoking
`python3 -c "import json; ..." .derived/...` is a spec-166
violation, surfaced as a follow-up V-rule emission.

### 2.3 Wiring location

OPC ships hook configuration as part of its desktop app
distribution. The chain is configured in OPC's bundled
Claude Code surface configuration (likely
`product/apps/opc/src-tauri/resources/claude-hooks.json` or
similar; the exact path is implementation-time detail). The
configuration is layered: OPC ships a default chain, the
project's own `<project>/.claude/settings.json` can override or
extend.

### 2.4 Conversation-time vs PR-time

Both seams fire. Spec 166 does not remove the PR-time gates
(spec 127, 130, 133, 135). It adds a second seam. Failures at
either seam halt the workflow at that seam; both seams produce
the same diagnostic so the developer can act once.

## 3. Functional Requirements

- **FR-001** OPC's bundled Claude Code surface includes a hook
  configuration registering a PostToolUse hook chain on
  `Edit|Write` and a Stop hook chain.
- **FR-002** The PostToolUse chain invokes `codebase-indexer
  check` and, conditionally on `specs/**/spec.md` edits,
  `spec-lint --quiet`.
- **FR-003** The Stop chain invokes (in order) `codebase-indexer
  check`, `spec-lint`, `spec-code-coupling-check`, and the
  workflow-ref-sha-pinning lint (conditional on workflow edits).
  Each blocks closure on non-zero exit.
- **FR-004** Hook scripts invoke consumer binaries only; no
  ad-hoc `.derived/**/*.json` parsing. Violations are
  surfaced as their own spec-lint emission category.
- **FR-005** When a Stop hook blocks, the agent receives a
  structured diagnostic naming the failing binary, its exit
  code, and its stderr summary. The user can choose to
  override (close anyway) or address; the override is logged
  to the conversation's checkpoint state (per spec 095) so
  the next session sees it.
- **FR-006** The hook configuration is project-overridable:
  `<project>/.claude/settings.json` can add hook entries
  (appended) or disable specific entries (with a per-disable
  reason field that surfaces in audit). It cannot bypass the
  OPC-bundled `codebase-indexer check` and
  `spec-code-coupling-check` (these are platform-mandatory).
- **FR-007** Hook execution timing is bounded:
  PostToolUse hooks complete within 5 seconds (otherwise the
  hook is async-only and emits a deferred diagnostic); Stop
  hooks complete within 60 seconds (the user can extend with
  an explicit "wait for full gate" action).
- **FR-008** The hook chain is a no-op when not in a project
  (e.g., the developer is using OPC outside any project
  workspace). Project-detection uses the same logic as
  factory-project-detect.

## 4. Success Criteria

- **SC-001** A developer making a spec edit in an OPC Claude
  Code session sees a Stop-time diagnostic if the codebase
  index is stale, before pushing.
- **SC-002** A developer making a code edit that breaks
  spec/code coupling sees a Stop-time diagnostic from
  `spec-code-coupling-check`.
- **SC-003** The Stop hook chain blocks conversation closure
  on any non-override failure; closure proceeds when all
  hooks pass.
- **SC-004** The user can override a blocked closure with an
  explicit action; the override is recorded in the
  conversation's checkpoint state and surfaces in the next
  session.
- **SC-005** PostToolUse hooks complete within 5 seconds for
  the median project; Stop hooks within 60 seconds.

## 5. Scope

### In scope

- The OPC-bundled hook configuration.
- The PostToolUse and Stop hook chains.
- The project-overridability surface with platform-mandatory
  floor.
- The governed-read enforcement on hook scripts.

### Out of scope (deferred)

- **Codification gate** (spec 174) is a separate Stop hook;
  spec 166 establishes the chain, spec 174 adds an entry.
- **Stop-hook UX in OPC for non-Claude-Code agents.** The
  hook chain assumes a Claude Code session. Other agent
  surfaces in OPC may need their own Stop-equivalent; that's
  separate spec work.
- **Per-tool fine-grained hooks.** The chain is
  Edit|Write|Stop. Per-tool hooks (e.g., a hook firing only
  after `cargo` invocations) are out of scope.
- **Cross-session memory of override decisions.** Spec 095's
  checkpoint records per-session overrides; aggregating
  override patterns across sessions (e.g., "this developer
  always overrides the workflow-ref lint — investigate") is
  a separate concern.

## 6. Relationship to existing OAP gates

This spec adds a *seam*, not new gate logic. The binaries
invoked by hooks are the same binaries `make pr-prep` and `make
ci` invoke. A failing hook is a failing gate; the failure is
the same gate failure the PR-time seam would catch later. The
value is *earlier* surfacing.

Spec 127 (the original coupling gate) retains its PR-time
authority. Spec 166 refines spec 127 by adding the
conversation-time firing seam without altering the gate's
semantics.

## 7. Compliance

This spec strengthens **ASI01 (Goal Hijack)** by moving the
drift-detection seam earlier — closer to the agent decision
that would introduce drift. It also strengthens **ASI06
(Memory & Context Poisoning)**: a poisoned context that pushes
the agent toward a spec-diverging edit gets caught at
conversation end, before any commit, breaking the poisoning
loop's persistence.

The adversarial-prompt-refusal posture (spec 131, CONST-005)
fires at agent-decision time; spec 166 is the mechanical
backstop that fires at conversation-end time if the
decision-time refusal was bypassed.

## 8. Cross-references

- **INTENT doc** §4.3, §8.7.
- **Spec 127** — original coupling gate; spec 166 refines.
- **Spec 130** — primary-owner sharpening.
- **Spec 133** — amends-aware coupling gate.
- **Spec 101** — codebase-indexer; one of the hook binaries.
- **Spec 128** — spec-lint default-fail-on-warn.
- **Spec 135** — fast CI as default; complementary discipline.
- **AIDE-VELOCITY-HARNESS-blueprint-spec.md** §10 — the Stop
  hook chain that demonstrates the leverage.
- **Spec 158** — workflow-ref SHA-pinning lint; one of the
  hook entries.
- **Spec 174** — codification gate; future entry on the
  chain.
