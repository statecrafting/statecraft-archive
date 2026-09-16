---
id: "201-anti-blind-approval-ui"
title: "Anti-Blind-Approval UI (ASI09 human-agent trust surfaces)"
feature_branch: "feat/201-anti-blind-approval-ui"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-06-10"
authors: ["open-agentic-platform"]
language: en
summary: >
  Close the declared ASI09 gap in the spec 198 all-ten analysis: the
  approval surfaces where a human ratifies agent work (HITL gates declared
  in the governance envelope, factory run approvals, override verification)
  must present plain-language risk summaries grounded in provenance — what
  changes, with what blast radius, traceable to which content hashes — and
  must never present model-generated rationale as the basis for approval.
  Preview is never effect: every approval surface renders from recorded
  facts (diffs, scopes, hashes, gate predicates), and the act of previewing
  cannot mutate state. This spec owns the presentation contract; the gates
  themselves are declared by the envelope (spec 198 FR-008) and enforced by
  the existing HITL machinery (spec 166).
code_aliases: ["ANTI_BLIND_APPROVAL_UI"]
depends_on:
  - "198-factory-governance-envelope"
  - "166-opc-stop-hook-gate-chain"
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummary.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummary-pure.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummary.test.ts }
  # Phase 2 — override-verify surface:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummaryEndpoint.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/approval-basis-helpers.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/approval-basis-helpers.test.ts }
extends:
  # Status flips move this spec's featuregraph golden entry; carry the edge so
  # the golden change is coupling-clean (same precedent as 198/207/214/215).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "hitl-approval-presentation"
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.factory.runs.$runId.tsx }
  - aspect: "hitl-approval-presentation"
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.factory.artifacts.tsx }
  - aspect: "hitl-approval-presentation"
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/factory-api.server.ts }
  - aspect: "encore-test-gating"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  - aspect: "hitl-approval-policy-read"
    unit: { kind: file, path: platform/services/statecraft/api/factory/factory.ts }
  - aspect: "hitl-approval-audit"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
  - aspect: "hitl-approval-audit"
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.ts }
references:
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
  - role: gate-declaration
    unit: { kind: file, path: standards/schemas/factory/governance-envelope.schema.yaml }
  - role: override-trust-class
    unit: { kind: file, path: platform/services/statecraft/api/factory/overrideGate.ts }
  - role: run-schema
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
---

# Feature Specification: Anti-Blind-Approval UI

**Feature Branch**: `201-anti-blind-approval-ui`
**Created**: 2026-06-10
**Status**: Draft (follow-on stub filed by spec 198 phase 5, AC-7; refined to
implementable 2026-06-10; implementation-contact amendments 2026-06-11 — see
§Amendment log)

## Purpose

An approval is governance evidence only if the approver had a real basis.
Three properties make a basis real, and each is a presentation-layer
contract this spec owns:

1. **Plain-language, fact-grounded summaries.** What is being approved,
   stated from recorded facts: files/scopes touched, commands to run,
   content hashes consumed (including the spec 198 FR-013 consumed
   overrides and their verified state), gate predicate being satisfied.
2. **Provenance attached, rationale excluded.** Every claim links to its
   source (artifact id, hash, audit row). Model-generated rationale —
   "this change is safe because…" — is never rendered as the approval
   basis (ASI09 cross-cutting principle: the persuasion channel is the
   attack channel). Where model output must be shown, it is visibly
   labelled untrusted content, segregated from the facts.
3. **Preview ≠ effect.** Rendering an approval surface performs no
   mutation; the approve action is a distinct, audited, idempotent step
   (composing with spec 198 FR-008's `preview-no-side-effects` gate
   predicate).

## Problem statement

The current approval surfaces do not satisfy any of the three properties
above.

**Run-detail surface** (`app.factory.runs.$runId.tsx`). Today the run
detail page (`FactoryRunDetailRoute`) renders a `RunHeader` (adapter id,
process id, project id, triggered-by, started-at, duration), a
`StageProgressList` (per-stage `stage_id`, status pill, duration,
`shortContentHash(agent_ref.contentHash)`), a `TokenSpendCard`, and a
`SourceShasFooter` (adapter/process/contract/agent content hashes). There
is no approval control; approval is out-of-band. Crucially: none of the
existing fields constitute a risk summary. The `require_stage_approval:
[1, 2, 3]` policy recorded in `factory.ts` implies stages s1, s2, s3
require human sign-off, but the run-detail page carries no HITL gate
surface and no mechanism for collecting or recording that approval.

**Override-verify surface** (`app.factory.artifacts.tsx`). The `ArtifactDrawer`
renders the upstream body (`selected.upstreamBody`), a freeform `textarea`
for `userBody`, and — when `selected.userBody !== null && !selected.overrideVerified`
— a "Verify override" button (`intent="verify_override"`). The button calls
`POST /api/factory/artifacts/:id/verify-override` (`artifacts.ts`), which
calls `verifyOverrideCore` and records `artifact.override_verified` in
`factoryArtifactSubstrateAudit`. The audit row today records
`{ userBodyVerified: false → true, contentHash }` but carries no summary of
what is being verified: no blast-radius statement, no gate-predicate link, no
consumed-hash record. The verify button renders adjacent to the textarea body
— inside a form that also contains `save_override` and `clear_override`
controls — with only `title` tooltip text as context. There is no labelled
region separating any model-produced content from the control.

**Gap.** Spec 198 FR-008 declares the obligation:

> "The contract requires the human be shown **plain-language risk
> summaries with provenance — never model-generated rationales** — and
> that **preview be separated from effect**."

The envelope schema (`governance-envelope.schema.yaml`) exposes
`gates[].predicate: "plain-language-summaries"` and
`gates[].predicate: "preview-no-side-effects"` as declared predicates.
Spec 166 enforces that a HITL gate *exists*. Neither enforces what the
approving human actually *sees* or what the audit row actually *records*.
The spec 198 ASI09 table entry is explicit: "**partial — declared gap**
(anti-blind-approval UI filed as spec 201)". This spec closes that gap.

## Requirements

### FR-001 — Approval summary contract (server-side assembly, typed shape)

A typed `ApprovalSummary` shape MUST be defined in
`platform/services/statecraft/api/factory/approvalSummary.ts` (new file)
and assembled server-side from recorded facts, **never from model output**.
The shape MUST carry:

```typescript
type ApprovalSummary = {
  /** Stable id for this summary revision — sha256 over the canonical
   *  JSON serialisation of the hashed field set: every field below except
   *  `summaryHash` itself and `assembledAt` (see assembly rule 3 for why
   *  the timestamp is excluded). Recorded in the audit row (FR-004) so the
   *  certificate chain can reproduce the exact basis. */
  summaryHash: string;

  /** The gate predicate being satisfied, as declared in the admitted
   *  governance envelope (spec 198 FR-008 / governance-envelope.schema.yaml
   *  gates[].predicate). Examples: "approval-before-build-spec-freeze",
   *  "plain-language-summaries". Never a model-generated label. Validated
   *  against the admitted envelope: the value MUST be one of the envelope's
   *  gates[].predicate ids, or the reserved id "overrides.require_verified"
   *  used by the override-verify surface — the obligation that surface
   *  ratifies is declared by the envelope's overrides: section rather than
   *  gates[] (amendment 2026-06-11). */
  gatePredicate: string;

  /** Human-readable statement of scope: which files or artifact kinds
   *  will be affected by ratifying this gate. Derived from the admitted
   *  envelope's adapter sub-envelope file_write_scope and emits[].kind
   *  (spec 198 FR-012). Plain language; no model inference. */
  blastRadiusStatement: string;

  /** Content-addressed provenance links — the set of substrate artifact
   *  ids + contentHash values that were consumed in assembling this
   *  summary. Includes the admitted envelope's own content hash. Allows
   *  the audit record to be independently re-verified. */
  provenanceLinks: Array<{
    artifactId: string;
    contentHash: string;
    kind: string;
    path: string;
  }>;

  /** Consumed overrides in this run's scope (spec 198 FR-013 c) — the
   *  org's substrate rows that carry a non-null userBody. Each entry
   *  records the override's contentHash, its verifiedBy actor if any,
   *  and whether the admitted envelope's overrides.require_verified
   *  predicate is satisfied. An unverified override under a
   *  require_verified envelope MUST surface as a blocking condition
   *  (AC-1 fail-closed). */
  consumedOverrides: Array<{
    artifactId: string;
    contentHash: string;
    path: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
    requireVerifiedSatisfied: boolean;
  }>;

  /** ISO-8601 timestamp at which this summary was assembled. */
  assembledAt: string;

  /** The actor who will perform the approval (Rauthy subject id). Bound
   *  at assembly time and checked again at approve time; mismatch refuses
   *  the approve (TOCTOU guard). */
  actorId: string;
};
```

The assembly function (`assembleApprovalSummary`) MUST:

1. Read admitted-envelope facts from the substrate (gate predicates,
   adapter sub-envelope `file_write_scope`, `emits[].kind`,
   `overrides.require_verified`) — all from `factoryArtifactSubstrate`
   rows with `kind = "governance-envelope"` or `kind = "adapter-manifest"`.
2. Enumerate consumed overrides: substrate rows in the org for the
   admitted origin with `status = 'active'` and `userBody IS NOT NULL`,
   ordered by path — the same enumeration spec 198's
   `collectConsumedOverrides` performs (FR-013 c parity). *(Amendment
   2026-06-11: the earlier draft filtered by the adapter's
   `file_write_scope`; that filter is wrong at the substrate layer —
   `file_write_scope` globs address scaffold-output paths, not substrate
   content paths, and would enumerate nothing.)*
3. Compute `summaryHash` as `sha256Hex(JSON.stringify(hashedFields))`
   over the serialised field set excluding `summaryHash` itself **and
   `assembledAt`** — matching the `sha256Hex` helper already in
   `platform/services/statecraft/api/factory/substrate.ts`. *(Amendment
   2026-06-11: `assembledAt` must be outside the hash — the FR-003 (b)
   replay guard compares a freshly-assembled hash against the
   client-presented one across page-load boundaries, and AC-4 requires
   recomputing the hash from DB state alone; a clock-dependent field in
   the hashed set would defeat both.)*
4. Return `{ ok: false, reason: string }` if any required field cannot be
   assembled from recorded facts (admitted envelope not present, revoked,
   or substrate row unresolvable). The caller MUST refuse to render an
   approve control on `ok: false` (FR-002 fail-closed).

No model call, no I/O other than DB reads, no clock-dependent value other
than `assembledAt`.

### FR-002 — Fail-closed approve-control rendering

Every approval surface that calls `assembleApprovalSummary` MUST:

- Render the `ApprovalSummary` fields as labelled, read-only fact
  sections before the approve control.
- Refuse to render the approve control when `assembleApprovalSummary`
  returns `ok: false`. In that case render an attributable error
  (quoting the `reason`) with no approval affordance — the surface is
  inert until the underlying data condition is resolved.
- Refuse to render the approve control when any `consumedOverrides` entry
  has `requireVerifiedSatisfied: false`. Surface the unverified override
  paths as a blocking list; the user resolves it by navigating to the
  override-verify surface for each unverified artifact.

This contract applies to both identified approval surfaces:

- The run-level HITL gate surface within
  `platform/services/statecraft/web/app/routes/app.factory.runs.$runId.tsx`
  (FR-003 defines the approve endpoint this wires to).
- The override-verify surface within
  `platform/services/statecraft/web/app/routes/app.factory.artifacts.tsx`
  (the "Verify override" button in `ArtifactDrawer`).

### FR-003 — Preview purity (GET semantics; separate POST for approve)

Loading any approval view MUST be side-effect free. Concretely:

- The run-detail route's `loader` (`app.factory.runs.$runId.tsx`) is a
  GET-based React Router loader and MUST remain so. It MUST NOT
  trigger any state transition, approval record write, or audit row on
  the factory run.
- `assembleApprovalSummary` is a read-only DB query; it MUST NOT write
  any row.
- The approve action for a HITL gate MUST be a distinct POST — either
  via a React Router `action` function or an Encore API endpoint — that:
  (a) re-assembles the summary from current state,
  (b) verifies the `summaryHash` the client presents matches the
      freshly-assembled hash (replay guard; a stale summary from a
      previous page load is refused),
  (c) verifies `actorId` matches the authenticated session,
  (d) writes the approval audit row (FR-004), and
  (e) returns the new approved state.
- For the override-verify surface (`intent="verify_override"`), the
  existing `verifyOverride` POST endpoint (`artifacts.ts`) satisfies
  the POST-separate-from-GET requirement; FR-004 extends its audit payload
  without changing the endpoint shape.

The envelope gate predicate `preview-no-side-effects` from
`governance-envelope.schema.yaml` is satisfied by this FR.

### FR-004 — Approval evidence (summary hash in the audit row)

Every human approval action MUST record the summary hash in the audit row
so the certificate chain can later prove the *basis*, not just the *click*.

**For override verification:** The existing `artifact.override_verified`
audit action written by `verifyOverrideCore` (`artifacts.ts`) records
`{ userBodyVerified: false → true, contentHash }`. This MUST be extended
to include `summaryHash` in the `after` payload:

```typescript
after: {
  userBodyVerified: true,
  contentHash: row.contentHash,
  summaryHash: summary.summaryHash,   // FR-004 — the basis
}
```

`verifyOverrideCore` MUST call `assembleApprovalSummary` before writing
the approval; the result's `summaryHash` is the value recorded. If
`assembleApprovalSummary` returns `ok: false`, `verifyOverrideCore` MUST
throw `APIError.failedPrecondition` with the reason — making the
server-side enforcement match the UI's fail-closed rendering.

This requirement is scoped to rows whose `origin` is an admitted-factory
origin. Rows with `origin = 'user-authored'` carry spec 111's
publication-status trust class and have no admitted envelope (the boundary
`admission.ts` documents for `collectConsumedOverrides`); for that class
`verifyOverrideCore` preserves its existing audit shape, with no
`summaryHash` (amendment 2026-06-11).

Verifying an override is the *resolution path* for an unverified override,
not a gate ratification: `assembleApprovalSummary`'s `consumedOverrides`
will, by construction, contain the artifact being verified with
`requireVerifiedSatisfied: false` under a `require_verified: true`
envelope. That entry does not block the verify action (it would deadlock
the first verification); the FR-002 withhold-on-unverified rule applies to
*approve* controls, not to the verify control. The recorded summary
captures the pre-verify state — exactly the basis the verifier saw.

**For run-level HITL gate approvals:** A new audit action constant
`FACTORY_RUN_GATE_APPROVED = "factory.run.gate_approved"` MUST be added
to `platform/services/statecraft/api/factory/auditActions.ts`. The
approval endpoint MUST write an `audit_log` row with:

```typescript
{
  action: "factory.run.gate_approved",
  actorUserId: actorId,
  targetType: "factory_runs",
  targetId: runId,
  metadata: {
    gatePredicate: summary.gatePredicate,
    summaryHash: summary.summaryHash,
    provenanceLinks: summary.provenanceLinks.map(l => l.contentHash),
    consumedOverrideCount: summary.consumedOverrides.length,
  }
}
```

The `summaryHash` value is what spec 198's certificate chain
(countersign path, `runDuplexHandlers.ts`) will need to resolve the
approval basis from the certificate. This spec reserves the field; binding
it into the governance certificate countersign is a follow-on action
(noted in AC-4 and Sequencing).

### FR-005 — Untrusted-content segregation

Any model-produced text present on an approval surface (for example, an
LLM-generated stage summary, extracted business-requirement text, or agent
rationale) MUST be rendered in a visually distinct, explicitly labelled
region — separate from the `ApprovalSummary` fact sections. The approve
control MUST NOT appear inside or adjacent to the labelled untrusted
region. Concretely:

- The untrusted region carries a visible label: "Model output — not the
  approval basis" (or equivalent; the exact wording is an implementation
  detail, the label requirement is normative).
- The `ApprovalSummary` fact sections and the approve button/form MUST be
  rendered outside that region, in a clearly distinct DOM subtree.
- If no model-produced text is present on a given surface, this FR is
  vacuously satisfied; no empty placeholder region is required.

The `require_stage_approval: [1, 2, 3]` policy means stages s1 (business
requirements), s2 (service requirements), and s3 (data model) gate on
human sign-off. Each of these stages produces LLM-generated content that
will be visible on the run-detail page. That content MUST be segregated
from the approval basis under this FR.

## Acceptance criteria

- **AC-1 (fail-closed approval control).** For each identified approval
  surface: when `assembleApprovalSummary` returns `ok: false` (missing
  admitted envelope, unresolvable override, revoked artifact), no approve
  control is rendered — only an attributable error. When a consumed
  override has `requireVerifiedSatisfied: false`, the approve control is
  withheld and the blocking override paths are listed. Test posture:
  integration test with a seeded org that has an unverified override under
  a `require_verified: true` envelope — assert no approve button in the
  rendered surface and a non-empty blocking list. (FR-001, FR-002)

- **AC-2 (summary content — recorded facts only).** The `ApprovalSummary`
  assembled by `assembleApprovalSummary` contains only values derivable
  from substrate DB rows and admitted-envelope fields. A test asserting
  the function is pure (no model calls, no HTTP, no randomness other than
  `assembledAt`) MUST pass. (FR-001)

- **AC-3 (GET purity — no side effects on load).** Loading the run-detail
  route (`GET /app/factory/runs/:runId`) and the artifacts route
  (`GET /app/factory/artifacts?id=:id`) leaves the database unchanged.
  Test posture: call the loader with a seeded run/artifact, query
  `audit_log` and `factory_runs` counts before and after — assert no new
  rows. (FR-003)

- **AC-4 (summary hash in audit rows).** After a `verify_override` POST
  succeeds, the corresponding `factoryArtifactSubstrateAudit` row carries
  a non-null `after.summaryHash` that equals
  `sha256Hex(JSON.stringify(summary_fields_only))` for the summary
  assembled at the same DB state. After a `factory.run.gate_approved`
  audit row is written, its `metadata.summaryHash` can be recomputed
  deterministically from the same DB state. Test posture: unit test over
  `assembleApprovalSummary` + the audit writer asserting hash stability.
  Note: binding `summaryHash` into the countersigned governance certificate
  is not required for AC-4 — that is a follow-on action for the
  certificate-chain proof. (FR-004)

- **AC-5 (untrusted-content segregation).** No approval surface renders
  an approve control inside or adjacent to the labelled untrusted region.
  Test posture: component test (or review checklist criterion) asserting
  that the DOM element carrying the approve button is not a descendant of
  the untrusted-content container. (FR-005)

- **AC-6 (spec 198 ASI09 gap closure).** The spec 198 all-ten table row
  for ASI09 (`specs/198-factory-governance-envelope/spec.md`) flips from
  "partial — declared gap" to "partial — presentation contract specified
  (spec 201, pending implementation)" when this spec's implementation
  ships, and to "solid" when AC-1 through AC-5 are verified in CI. The
  amendment to spec 198's ASI09 table entry lands in the same PR as AC-4
  (the audit evidence). (FR-001 through FR-005)

- **AC-7 (parity gates).** `make ci` / schema-parity / coupling gate
  pass; codebase index + featuregraph golden regenerated.

## Out of scope

- The gate machinery itself — spec 166 owns stop-hook enforcement; spec
  198 FR-008 owns gate declaration.
- Override verification *semantics* (spec 198 FR-013 c); this spec governs
  only how the verify surface presents its basis, not the gate logic.
- The async model-assisted override scanner (spec 200 / spec 198 FR-013 d).
- Notification and paging of approvers (spec 057 territory).
- Binding `summaryHash` into the countersigned governance certificate
  (spec 198 countersign path, `runDuplexHandlers.ts`) — this spec
  reserves the field in the audit row; the certificate binding is a
  follow-on action gated on spec 198 phase 4 countersign being live.

## Phasing

1. **Server summary contract.** Define `ApprovalSummary` type and
   `assembleApprovalSummary` in
   `platform/services/statecraft/api/factory/approvalSummary.ts`; add
   `FACTORY_RUN_GATE_APPROVED` to `auditActions.ts`; extend
   `verifyOverrideCore` to record `summaryHash` in the audit `after`
   payload. Add unit tests for hash stability and fail-closed conditions.
   Verify: AC-2, AC-4 (override path).

2. **Web surfaces — override-verify.** Update `ArtifactDrawer` in
   `app.factory.artifacts.tsx` to call the assembly endpoint (or inline
   the summary data via the loader), render the `ApprovalSummary` fact
   sections, enforce fail-closed rendering, and segregate any model output
   under FR-005. Add the GET-purity integration test. Verify: AC-1
   (override surface), AC-3, AC-5.

3. **Web surfaces — run HITL gate.** Wire the run-detail route
   (`app.factory.runs.$runId.tsx`) to surface the `ApprovalSummary` for
   stages in `require_stage_approval` (s1, s2, s3); add the approve
   action POST; record the `factory.run.gate_approved` audit row. Verify:
   AC-1 (run surface), AC-4 (run path).

4. **Audit evidence binding + spec 198 amendment.** Verify AC-4 end-to-end
   (override + run paths); amend spec 198 ASI09 table entry; regenerate
   codebase index. Verify: AC-6, AC-7.

## Sequencing

Implementable independently of spec 200. Phase 1 requires only the spec 198
FR-013 c substrate columns (`user_body_verified`, `verified_by`,
`verified_at`) and the admitted-envelope substrate rows — both present after
spec 198 phase 5. The consumed-override rows rendered by FR-001 are populated
by spec 198 phase 5 bundles. The run-level HITL gate surface (phase 3) shares
spec 198's run-grant precondition only for the envelope-predicate lookup; the
`assembleApprovalSummary` function reads the `governance-envelope` substrate
row directly and does not depend on grant machinery being live.

## Amendment log

**2026-06-11 (implementation contact, phase 1).** Four precision
amendments made before writing code, none changing the spec's intent:

1. **FR-001 assembly rule 2** — consumed-override enumeration aligned to
   spec 198 FR-013 c semantics (`collectConsumedOverrides` parity:
   origin-scoped, `status='active'`, `userBody IS NOT NULL`). The draft's
   `file_write_scope` filter addressed the wrong path namespace
   (scaffold-output globs, not substrate content paths) and would have
   enumerated nothing.
2. **FR-001 assembly rule 3** — `assembledAt` excluded from the hashed
   field set alongside `summaryHash`. Required for the FR-003 (b) replay
   guard (hash comparison across page loads) and AC-4 recomputability
   from DB state.
3. **FR-001 `gatePredicate`** — validation vocabulary fixed as the
   admitted envelope's `gates[].predicate` ids plus the reserved
   `"overrides.require_verified"` for the override-verify surface.
4. **FR-004** — scoped to admitted-factory origins; `user-authored` rows
   are spec 111's publication-status trust class with no envelope, so
   their verify path keeps its existing audit shape. Also clarified that
   verify-override is the resolution path for unverified overrides, not a
   gate ratification — the FR-002 withhold rule does not apply to it.

5. **File layout** — the contract is split as
   `approvalSummary-pure.ts` (type + assembly over fetched facts + hash
   rules; Encore-runtime-free so unit tests run under bare vitest) and
   `approvalSummary.ts` (DB wrapper; re-exports the contract). Same
   pattern as `signing-pure.ts` / `patCrypto-pure.ts`.

Frontmatter changes in the same edit: `establishes:` claims the new
`approvalSummary.ts` + `approvalSummary-pure.ts`; `implementation:`
flipped to `in-progress` with phase 1 starting.

**2026-06-11 (implementation contact, phase 3).** Four further
precision decisions, recorded before the run-surface code:

6. **Approve endpoint contract** — `POST
   /api/factory/runs/:id/gates/:stageId/approve` with `{summaryHash}`;
   the FR-004 audit `metadata` additionally carries `stageId` (the
   FR-004 example shape predates per-stage gating; the addition is
   additive). Approval state IS the audit trail — one
   `factory.run.gate_approved` row per `(runId, stageId)`, no second
   state store; re-approving returns the recorded approval idempotently
   with no new row (Purpose 3: distinct, audited, idempotent).
7. **Predicate selection** — OAP never models predicate→stage binding
   (spec 198 P-2: run topology is the engine's). The run surface records
   a deterministically-selected declared predicate:
   `pickRunGatePredicate` = first `gates[].predicate` containing
   `"approval"`, else the first declared; fail-closed (no approve
   control) when the envelope declares no gates. The selected predicate
   is rendered to the approver and recorded in the audit row.
8. **FR-003 (c) is subsumed by (b)** — `actorId` is inside the hashed
   field set, so the approve-time re-assembly (bound to the session
   actor) can never hash-match a summary rendered for a different actor;
   the replay guard enforces the actor check structurally.
9. **FR-002 withhold asymmetry confirmed in code** — the run-surface
   approve is withheld (server-side `failedPrecondition` + UI blocking
   list) on any envelope-unsatisfied override; the verify surface is
   not (amendment 4: verify is the resolution path). FR-005 is
   vacuously satisfied on the run-detail page today (it renders
   statuses, durations, and hashes — no model-produced text); if stage
   output bodies are ever rendered there, they take the labelled
   untrusted region.

Phase 3 frontmatter changes: `refines` adds `factory.ts`
(`hitl-approval-policy-read` — the exported
`DEFAULT_REQUIRE_STAGE_APPROVAL` policy fact the context endpoint
renders).

**2026-06-11 (phase 4 closeout).**

10. **AC-6 two-tier completion, refined at contact.** AC-6's middle
    state ("presentation contract specified, pending implementation")
    was written before phases 1–3 shipped in the same cycle; the spec
    198 ASI09 row now reads "presentation contract **implemented**".
    The "solid" flip remains gated on AC-1–AC-5 verified **in CI** —
    currently impossible: the DB-bound AC suites
    (`approvalSummaryEndpoint.test.ts`, `overrideTrustClass.test.ts`)
    are encore-test-gated and CI runs bare vitest only. That CI gap
    (discovered during phase 1, recorded in spec 198's FR-013
    correction note, filed as
    [spec 211](../211-encore-test-ci-job/spec.md)) is the named
    trigger: when spec 211's encore-test CI job exists and these
    suites run green in it, the ASI09 row flips to
    "solid" and this spec's `implementation:` flips to `complete`.
    Until then `implementation: in-progress` is the honest state —
    all four phases' code and local verification are done; the
    CI-verified tier is not. AC-6's "same PR as AC-4" sequencing is
    satisfied in spirit: the audit evidence landed in the phase 1 and
    phase 3 PRs (#330, #332), and this flip rides the immediately
    following closeout commit with that evidence cited.

**2026-06-12 (named trigger discharged — `implementation: complete`).**

11. **The CI gate this spec waited on exists and is green.** Spec 211's
    enforcing encore-test lane merged to `main` in `a58755be` (PR
    #347): `approvalSummaryEndpoint.test.ts` (10 tests) and
    `overrideTrustClass.test.ts` (7 tests) now execute on every PR
    touching statecraft and in `merge_group`, gated by ci-gate, with a
    lane-coverage guard that fails CI if either file ever stops
    executing (skip-as-pass forbidden). Live evidence: PR-lane run
    27419049946 and merge-queue run 27419855931, both green. AC-1–AC-5
    are CI-verified; per item 10's staged plan, the spec 198 ASI09 row
    flips to "Solid" and this spec's `implementation:` flips to
    `complete` in the same commit, citing those runs.
