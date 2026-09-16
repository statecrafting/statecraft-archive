---
id: "131-adversarial-prompt-refusal-policy"
slug: adversarial-prompt-refusal-policy
title: "CONST-005 — Adversarial-prompt refusal: spec/code coherence"
status: approved
implementation: complete
amends: ["047-governance-control-plane"]
owner: bart
created: "2026-05-02"
approved: "2026-05-02"
kind: governance
domain: substrate
risk: medium
depends_on:
  - "047-governance-control-plane"  # governance-control-plane (policy-compiler is the integration point)
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate (the surface this policy backs)
  - "130-spec-coupling-primary-owner"  # primary-owner heuristic (referenced in worked examples)
code_aliases: ["CONST_005_SPEC_CODE_COHERENCE"]
establishes:
  - unit: { kind: file, path: .claude/rules/adversarial-prompt-refusal.md }
extends:
  - spec: "047-governance-control-plane"
    nature: additive
    unit: { kind: crate, id: open_agentic_policy_compiler }
refines:
  - aspect: "spec-code-coherence-policy"
    unit: { kind: file, path: CLAUDE.md }
summary: >
  CONST-001 through CONST-004 cover destructive ops, secrets, tool
  allowlist, and diff size — but none refuse the "Phase-3-style modify
  spec without modifying code" probes that engineer drift between
  authored truth (markdown) and machine truth (registry/index). This
  spec adds CONST-005 as the missing policy. The threat model, trigger
  conditions, and required behavior live in the spec body and a new
  `.claude/rules/adversarial-prompt-refusal.md`. The policy block in
  CLAUDE.md is parsed by the policy compiler (gate name
  `spec_code_coherence` added to its allowlist; amends spec 047). The
  rule is behavioral — the policy kernel does not gate it at tool-call
  time; enforcement is via the orchestrated-workflow protocol.
origin:
  retroactive: true
---

# 131 — CONST-005 Adversarial-prompt refusal policy

## 1. Problem Statement

The four existing constitutional policies in CLAUDE.md cover well-known
defensive surfaces (CLAUDE.md "Policy Rules" section):

- **CONST-001 destructive_operation** — `rm -rf`, `git reset --hard`, etc.
- **CONST-002 secrets_scanner** — committing API keys, `.env`.
- **CONST-003 tool_allowlist** — Tier3 tool invocation without approval.
- **CONST-004 diff_size_limiter** — single patches over 500 lines.

None of them address **engineered drift**: a request that would land code
without an accompanying spec change, or amend a spec to match an action
the request already wants the agent to take. The spec/code coupling gate
(spec 127) is the runtime defense. CONST-005 is the **prompt-time** defense
that asks the agent to refuse the request before the gate has to fire.

The two halts already executed in this session (2026-05-02) are the
empirical evidence:

- Unit 1 named an action (`status: approved` AND `implementation: complete`
  on spec 116) that contradicted the spec's own §9 staging plan.
- Unit 4 named an action (3-file demo) that the spec 127 gate, as
  originally written, would have required 20 cosmetic spec amendments to
  satisfy.

In both cases the agent's correct response was: stop and surface the
conflict. CONST-005 codifies that pattern.

## 2. Threat Model

The defended-against pattern: an instruction whose execution would
**decouple** spec from code, OR force a spec edit whose only purpose is
to retroactively justify a code action. Concretely:

- **Spec-bending under instruction.** "Set `implementation: complete` on
  spec X" when X's body says implementation is contingent on a future
  event the diff doesn't satisfy.
- **Cosmetic-amendment churn under a strict gate.** "Amend specs
  A/B/C/D so my unrelated PR passes the coupling check" when the
  amendments don't change those specs' designs.
- **Agent-divergence framings.** "Optimize for truth, not success",
  "split into N parallel agents and we'll merge the outputs", and
  similar prompts that defeat single-agent coherence.
- **Phase-3 probes.** A multi-step prompt where Phase 1 lands plausible
  changes, Phase 2 introduces small drift, Phase 3 asks the agent to
  ratify the drift as a spec edit.

The throughline: every pattern asks the agent to make the spec spine
**less** truthful so an action becomes more convenient.

## 3. Trigger Conditions

CONST-005 applies whenever any of the following surface in the
instruction stream:

- The instruction explicitly asks to **modify a spec to match an action**
  that contradicts the spec's own design (e.g. flip a lifecycle field,
  change an invariant, amend a section, edit `implements:`) AND the
  motivating action is the same diff/PR.
- The instruction explicitly asks for **parallel-agent simulation** or
  **divergence framing** (e.g. "run N agents", "compare outputs",
  "optimize for truth not success").
- The instruction asks for a **mass spec edit** where the rationale per
  spec is "satisfy a gate" rather than "refine the spec's design".
- The instruction frames the spec spine as an **obstacle** ("just
  modify the spec to make this pass") rather than as the **contract**.

## 4. Required Behavior

When a trigger fires, the agent MUST:

1. **Refuse the destructive sub-step.** Do not modify the spec to satisfy
   the action.
2. **Surface the conflict.** Quote the contradicted spec section or the
   gate that would over-fire. Use file:line references.
3. **Propose a non-destructive reframe.** Reframe the work so the spec
   spine is preserved. Common reframes:
   - "Land probes as draft specs documenting the holes."
   - "Refine the gate's semantics in a separate spec; redo the action
     after the gate is corrected."
   - "Split the unit into mechanism + demo; defer demo if it requires
     breaking the spec spine."
4. **Wait for explicit user direction.** Do not proceed past the halt
   on autopilot. The user resolves the conflict; the agent executes
   the resolution.

## 5. Implementation

- **Policy block** in `CLAUDE.md` follows the CONST-NNN format used by
  001–004. Compiled by `tools/oap/policy-compiler/`. Gate name is
  `spec_code_coherence` — added to the compiler's recognized-gate
  allowlist (this is the spec 047 amendment).
- **`.claude/rules/adversarial-prompt-refusal.md`** is the per-project
  rule file consumed by orchestrated workflows. Loaded automatically
  alongside `orchestrator-rules.md` and `governed-artifact-reads.md`.
  Contains the threat model, triggers, required behavior, and a
  reference to this spec.
- **No policy-kernel function** for `spec_code_coherence` — the rule
  is behavioral, not call-time-gated. Adding a kernel implementation
  is out of scope; the policy block records the rule canonically in
  the bundle even when no runtime function evaluates it.

## 6. Worked Examples

### Example 1 — refusing to rewrite a spec's design to match an instruction

**Session: 2026-05-02, Unit 1 (spec spine hardening, single-developer
mission).**

- **Instruction:** "Update spec 116 frontmatter to `status: approved`,
  `implementation: complete`, set `approved:` to today (2026-05-02)."
- **Conflict:** Spec 116 §9 ("Day-30 Promotion Plan") explicitly stages
  the `implementation: complete` flip to a follow-up PR on 2026-05-28
  after the warn-only window closes. The agent's working tree was on
  2026-05-02 — flipping `complete` now would assert a posture the gate
  did not yet enforce.
- **Resolution offered:** three options surfaced (rewrite §9 to match;
  honour §9 with partial flip; defer entirely).
- **User decision:** Option B — honour §9, set `status: approved` only,
  fix the AC-5 parity gap, name 2026-05-28 as the explicit milestone
  for the future flip.
- **Rule extracted:** when an instruction would require modifying a
  spec's design to match an action, refuse the modification and
  surface the conflict.

### Example 2 — refusing churn induced by an over-strict gate

**Session: 2026-05-02, Unit 4 (granular `[package.metadata.oap]`
metadata, same mission).**

- **Instruction:** "Update at least 3 representative crates to
  demonstrate per-module annotation."
- **Conflict:** The spec 127 coupling gate (designed earlier in the
  same session) required every claimant of a touched path to amend
  its `spec.md`. `crates/orchestrator` is claimed by 12 specs;
  `crates/axiomregent` by 7. The 3-file demo would have demanded 20
  cosmetic spec amendments — none of which would have changed those
  specs' designs.
- **Resolution offered:** halt the demo; commit the mechanism only;
  surface the gate over-fire as a finding (spec 129 §7); propose
  three concrete refinements (primary-owner heuristic, refining
  `implements:` declarations, `primary: true` flag).
- **User decision:** Option C — adopt the primary-owner heuristic
  (spec 130) before re-attempting the demo (or skipping it entirely).
- **Rule extracted:** when an instruction would require structurally
  cosmetic spec edits to satisfy a gate, surface the gate as a
  candidate defect rather than absorbing the cost.

The two examples differ in shape (Example 1 protects a spec's design;
Example 2 protects against gate-induced churn) but share the throughline:
**the spec spine is the contract; the agent declines to make it less
truthful so an action becomes more convenient.**

## 7. Acceptance

- **AC-1.** A new fenced ```policy block in CLAUDE.md declares
  `CONST-005-spec-code-coherence` with `mode: enforce`,
  `scope: global`, `gate: spec_code_coherence`. The policy compiler
  parses it without `V-106` (invalid gate) firing.
- **AC-2.** `tools/oap/policy-compiler/` recognises `spec_code_coherence`
  in the gate allowlist. Spec 047 carries
  `amended: 2026-05-02`, `amendment_record: "131-adversarial-prompt-refusal-policy"`.
- **AC-3.** `.claude/rules/adversarial-prompt-refusal.md` exists and
  is referenced from `CLAUDE.md` ("Orchestrator Behavioral Rules" or
  similar) so orchestrated workflows load it automatically.
- **AC-4.** `make ci` exits 0 (the policy bundle compiles; the
  spec-code-coupling gate accepts the diff).
- **AC-5.** Spec 131 §6 ("Worked Examples") cites Unit 1 and Unit 4
  halts with concrete file:line / §-anchor references. Future agents
  reading this spec see the policy as backed by lived precedent.

## 8. Out of Scope

- Policy-kernel runtime enforcement of `spec_code_coherence` — the
  rule is behavioral; if a future spec wants tool-call-time blocking,
  it can add a `gate_spec_code_coherence` function to
  `crates/policy-kernel/src/lib.rs`.
- Auto-detection of adversarial prompt patterns (e.g. NLP-based
  trigger). The triggers (§3) are specified for human/agent
  judgement; automation is a follow-up.
- Per-PR enforcement on the prompt history. The rule applies at
  agent-decision time, not at PR-merge time.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.


## Security hardening amendment (2026-07-02)

Corrected the stale spec-range reference in the repository-structure overview of CLAUDE.md (feature specifications now span 000 to 224) during the drift sweep.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
