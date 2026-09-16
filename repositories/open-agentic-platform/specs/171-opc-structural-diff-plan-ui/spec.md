---
id: "171-opc-structural-diff-plan-ui"
slug: opc-structural-diff-plan-ui
title: "Deterministic structural-diff plan UI in OPC — anti-anthropomorphic-trust rendering (ASI09)"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: opc
risk: medium
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp
  - "076-factory-desktop-panel"  # factory-desktop-panel (spec 171 refines this)
  - "102-governed-excellence"  # governed-excellence (the certificate's structural-diff posture)
  - "126-desktop-agent-picker-ui"  # desktop-agent-picker-ui
code_aliases: ["OPC_STRUCTURAL_DIFF_PLAN", "ANTI_ANTHROPOMORPHIC_PLAN_UI"]
establishes:
  - unit: { kind: file, path: product/apps/opc/src/components/factory/planTypes.ts }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/planAnalysis.ts }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/PlanStructuralDiff.tsx }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/PlanActionGraph.tsx }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/GateImpactSummary.tsx }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/PlanCertificatePrediction.tsx }
  - unit: { kind: file, path: product/apps/opc/src/components/factory/PlanReviewDialog.tsx }
refines:
  - aspect: "agent-plan-rendering"
    unit: { kind: directory, path: product/apps/opc/src/components/factory }
extends:
  - spec: "076-factory-desktop-panel"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/factory/FactoryPipelineContext.tsx }
  - spec: "076-factory-desktop-panel"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/factory/FactoryPipelinePanel.tsx }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
  - role: governance-substrate
    unit: { kind: file, path: specs/102-governed-excellence/spec.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI09"]
summary: >
  OWASP ASI09 (Human-Agent Trust Exploitation)
  prescribes *"Out-of-band verification and rigid UX
  guardrails for critical actions"* — concretely, plans
  rendered as structural diffs / action graphs
  (YAML/JSON), not as natural-language summaries that
  invite anthropomorphic trust.

  OPC's factory panel today renders agent plans
  conversationally — narrative text summarising what
  the agent intends to do. This is exactly the failure
  mode ASI09 warns against: a confident-sounding
  summary invites the human to trust without
  verifying. Spec 171 refines spec 076 (the factory
  desktop panel) with a structural-diff plan UI:
  every agent-proposed plan renders primarily as a
  YAML/JSON action graph + a structural diff against
  the current spec-spine state. Conversational
  summaries are *demoted* to a secondary panel, not
  the primary action surface.

  The cockpit must not let a confident-sounding agent
  talk a human into bypassing a gate. The structural-
  diff rendering is the load-bearing UX commitment
  that makes that impossible by construction — the
  human reviews the proposed graph diff, not the
  agent's prose.
---

# 171 — Deterministic structural-diff plan UI in OPC

## 1. Problem

When an agent in OPC proposes a plan — a sequence of
spec edits, code edits, factory runs, or tenant
deployments — today's surfaces in OPC (the factory
panel, the various inspect panels) tend to render the
agent's plan *conversationally*: paragraphs of
narrative text describing what the agent intends to do
and why.

OWASP ASI09 (Human-Agent Trust Exploitation) names
this exact failure mode:

> *"Out-of-band verification and rigid UX guardrails
> for critical actions"* — concretely, plans rendered
> as structural diffs / action graphs (YAML/JSON), not
> as natural-language summaries that invite
> anthropomorphic trust.

The convergence doc §2.K amplifies:

> *"OPC should render agent plans as deterministic
> structural diffs, not conversational summaries. This
> is a load-bearing UX commitment — the cockpit must
> not let a confident-sounding agent talk a human into
> bypassing a gate."*

The gap is concrete:

1. A confident agent narrative ("I'll fix the spec
   drift by amending spec X with a clarification")
   reads as plausible. The human approves; the
   agent's actual edit may differ from the narrative.
2. The discrepancy between narrative intent and
   structural reality is the seam where adversarial
   prompts succeed — the agent describes one action
   and performs another, betting on the human's
   anthropomorphic trust in the narrative.
3. Spec 131 (adversarial-prompt-refusal-policy)
   establishes the *prompt-time* refusal posture; spec
   171 establishes the *cockpit-time* refusal posture
   by making the discrepancy structurally impossible
   to hide.

## 2. Decision

Refactor OPC's agent-plan rendering to lead with the
structural diff. Conversational summaries are demoted
to a secondary panel.

### 2.1 Primary surface — the action graph

Every agent-proposed plan, before the human can
approve it, renders as:

- **Structural diff against the current spec spine.**
  Show added specs, removed specs (rare; usually
  superseded), modified spec frontmatter (status
  changes, relationship-graph edges added or removed,
  unit grammar changes per spec 154).
- **Action graph (YAML/JSON).** Explicit list of
  actions the plan proposes:
  ```yaml
  actions:
    - kind: edit_spec
      target: specs/137-tenant-environment-access-gates/spec.md
      diff: <structured-diff>
    - kind: edit_code
      target: platform/services/statecraft/api/auth/rauthyAdminClients.ts
      diff: <structured-diff>
    - kind: invoke_tool
      tool: spec-code-coupling-check
      args: { ... }
  ```
- **Gate impact preview.** For each action, the
  predicted effect on the coupling gate, lint, and
  any other configured gate. If an action would
  cause a gate failure, the action renders with a
  warning marker.

### 2.2 Secondary surface — the conversational summary

The agent's narrative remains available as a
secondary panel (e.g., a collapsed pane, a tab next
to the action graph). The human can read it; the
human cannot approve from it. Approval flows
exclusively through the action graph surface.

### 2.3 Approval requires diff acknowledgement

The human's approval action requires acknowledging
each structural change. The UI may scale this — for
single-spec edits, one acknowledgement; for large
plans, an enumerated checklist — but every action
in the graph must be visibly traversed before the
"approve plan" button enables.

For *critical* actions (spec 167-defined kernel
edits, spec 132-frozen invariant touches,
production deploys via spec 137), spec 171
requires *dual* acknowledgement: a second human
acknowledges before the approval completes. Dual
acknowledgement is a separate spec concern
(complementary M-of-N dual-auth UX, named in
intent doc §2.K and convergence doc §2.K) — spec
171 establishes the single-actor structural diff
surface; the M-of-N escalation is a future
refinement.

### 2.4 Composition with spec 102

When the plan's actions include a factory run, the
predicted governance certificate stage list renders
in the action graph. After execution, the actual
certificate is compared against the predicted; any
discrepancy surfaces as a post-action diagnostic.

## 3. Functional Requirements

- **FR-001** OPC's factory panel (per spec 076) and
  any other agent-plan-presenting surface renders the
  plan primarily as a structural diff + action graph
  (§2.1).
- **FR-002** The action graph enumerates each action
  with its kind, target, and structured diff.
- **FR-003** A gate-impact preview accompanies each
  action: the predicted effect on coupling, lint,
  and any other configured gate.
- **FR-004** The conversational narrative is
  available as a secondary panel; it cannot be the
  approval surface.
- **FR-005** Approval requires the human to traverse
  the action graph and acknowledge each action
  before "approve plan" enables.
- **FR-006** When the plan includes a factory run,
  the predicted governance certificate stage list
  renders as part of the action graph. Post-action
  the actual certificate is diffed against the
  prediction; discrepancies surface immediately.
- **FR-007** Critical actions (kernel edits per
  spec 167, frozen-invariant touches per spec 132,
  production deploys) carry a marker requesting
  dual acknowledgement (M-of-N) — the spec does not
  implement M-of-N here, but renders the marker
  prominently so the human knows additional
  approval is required by the future M-of-N spec.
- **FR-008** The rendering is deterministic for the
  same plan input: a given plan → action graph
  mapping is hash-equal across renders.

## 4. Success Criteria

- **SC-001** Every agent-proposed plan in OPC's
  factory panel renders as a structural diff +
  action graph, with the conversational narrative
  available but secondary.
- **SC-002** Approval is gated on action-graph
  traversal; a human cannot approve without
  visibly acknowledging the structural changes.
- **SC-003** A plan that would fail the coupling
  gate carries a warning marker on the affected
  action(s) before approval is requested.
- **SC-004** After plan execution, the actual
  governance certificate matches the predicted
  stage list; any discrepancy surfaces a
  post-action diagnostic the human must
  acknowledge before the next plan can be
  approved.
- **SC-005** The rendering is hash-deterministic
  for a given plan input.

## 5. Scope

### In scope

- Refactor of OPC's plan-presentation surfaces to
  lead with structural diff + action graph.
- The gate-impact preview integration.
- The approval-via-traversal UX.
- The certificate prediction / actual diff.
- The critical-action marker (M-of-N stub).

### Out of scope (deferred)

- **M-of-N dual-auth implementation.** The marker
  is rendered; the multi-actor approval flow is a
  separate spec.
- **Replacing the agent's prose summary.** The
  prose remains available as secondary; it is not
  removed.
- **Cross-session plan history.** A plan rendered
  in one session is not (by this spec) compared
  against plans in prior sessions. Cross-session
  plan analysis is a future portfolio concern.
- **Voice or natural-language plan acceptance.**
  The approval flow requires structural traversal;
  voice / NL approval is explicitly excluded by
  the anti-anthropomorphic posture.
- **Tenant-side OPC equivalent.** Tenants born of
  the substrate may use their own cockpit
  surfaces; OPC-equivalent enforcement at the
  tenant boundary is a future kernel-update
  concern.

## 6. Compliance

Spec 171 is the load-bearing OAP mitigation for the
cockpit-side **ASI09 (Human-Agent Trust
Exploitation)** gap. The intent doc §7.2 records:

> *"Gap on deterministic structural-diff plan UI in
> OPC and M-of-N dual-auth UX for tenant-boundary
> actions."*

Spec 171 closes the first half. The second half
(M-of-N) is named explicitly as out of scope here
and will land as a follow-up spec.

The composition with spec 102 (verifier does not
trust the producer) extends the FR-007 posture
into the cockpit: the human does not trust the
agent's narrative; they verify the structural
diff.

## 7. Cross-references

- **INTENT doc** §2.K, §7.2, §9.12.
- **Spec 076** — factory-desktop-panel; refined by
  this spec.
- **Spec 102** — governed-excellence; the
  verification posture this spec extends into the
  UX layer.
- **Spec 131** — adversarial-prompt-refusal-policy;
  prompt-time twin of this cockpit-time posture.
- **Spec 132** — constitutional-invariant-freeze;
  critical-action category.
- **Spec 167** — born-with kernel; another
  critical-action category.
- **Convergence doc §2.K** — doctrine framing.
- **Follow-up — M-of-N dual-auth UX spec.**
