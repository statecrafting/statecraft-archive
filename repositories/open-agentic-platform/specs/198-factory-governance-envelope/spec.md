---
id: "198-factory-governance-envelope"
title: "Factory Governance Envelope (ASI Admission Contract)"
feature_branch: "feat/198-factory-governance-envelope"
status: approved
implementation: complete
amended: "2026-07-01"
amendment_record: |
  amended 2026-07-01 by spec 204 (session-memory write contract): the
  FR-013(a) override gate's carrier-class, secret, and UTF-8 rules were
  extracted into the shared @opc/carrier-gate package so the factory substrate
  gate and the session-memory write gate share one canonical rule set (spec
  204 FR-001, "shared with, not copied from"). overrideGate.ts now imports
  those predicates; its verdicts, rule ids, and the two substrate-specific
  rules it keeps (size ceiling, kind stability) are unchanged.
kind: platform
domain: platform
created: "2026-06-09"
authors: ["open-agentic-platform"]
language: en
summary: >
  Define the governance envelope: the machine-checkable contract a factory
  must file for OAP to admit it, and the fail-closed admission gate that
  enforces it. The envelope is OAP's encoding of OWASP ASI 2026 obligations —
  a synthesis of the source's own ASI01 "intent capsule" (signed goal +
  constraints + context per run) and ASI10 "signed behavioral manifest"
  (declared capabilities, tools, goals, tiers — validated before each action),
  composed from a process envelope (the run) and per-adapter sub-envelopes
  (the scaffold boundary). OAP validates it two-sidedly — conformant to the
  schema AND reconciled against the factory's own atomic declarations
  (recompute-and-reconcile) — and refuses to admit a factory whose brief is
  absent, non-conformant, over-ceiling, or internally inconsistent. The
  envelope is the admission-time counterpart to the emission-time governance
  certificate (spec 102/168): the contract going in, the receipt coming out.
  OAP is the enforcer (judge/bouncer), not the rule-maker — ASI 2026 is the
  law, the factory interprets it for the org, OAP arbitrates, and OPC is an
  untrusted executor permitted only within the admitted envelope.
code_aliases: ["FACTORY_GOVERNANCE_ENVELOPE"]
compliance:
  - framework: "owasp-asi-2026"
    # AC-6: the control list is the union of the inline ASI tags carried
    # by `standards/schemas/factory/governance-envelope.schema.yaml`
    # (intent capsule ASI01; ceilings ASI02/03/05; emits ASI04/07; gates
    # ASI09; constituents ASI10; overrides ASI06). ASI08 is deliberately
    # absent — the schema declares circuit-breaker gates but the envelope
    # does not claim cascading-failure coverage (see the all-ten table:
    # partial, residual stated).
    controls:
      [
        "ASI01",
        "ASI02",
        "ASI03",
        "ASI04",
        "ASI05",
        "ASI06",
        "ASI07",
        "ASI09",
        "ASI10",
      ]
depends_on:
  - "102-governed-excellence"
  - "139-factory-artifact-substrate"
  - "074-factory-ingestion"
establishes:
  - unit: { kind: file, path: standards/schemas/factory/governance-envelope.schema.yaml }
  - unit: { kind: file, path: crates/factory-contracts/src/governance_envelope.rs }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/admission.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/revocations.ts }
  # Phase 4 (FR-005/FR-014) — signing authority, run-grants, countersign:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/signing-pure.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/signing.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/jwks.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/grantDuplexHandlers.ts }
  - unit: { kind: file, path: crates/factory-engine/src/platform_jws.rs }
  - unit: { kind: file, path: crates/factory-engine/src/intent_capsule.rs }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/run_governance.rs }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/signing.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/grantDuplexHandlers.test.ts }
  # Phase 5 (FR-013 a–c) — override gate + trust class:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideGate.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideGate.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideTrustClass.test.ts }
  # FR-013 audit-action correction (discovered during spec 201 phase 1):
extends:
  - spec: "074-factory-ingestion"
    nature: additive
    unit: { kind: crate, id: factory-contracts }
  - spec: "054-agent-frontmatter-schema"
    nature: additive
    unit: { kind: crate, id: agent-frontmatter }
  # Spec adds/flips always bump the featuregraph golden (corpus
  # convention — specs 190/194/195/200 carry the same edge).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "admission-time-governance"
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncPipeline.ts }
  # FR-012 enforcement (2026-06-11) — a snapshot-absent adapter refuses
  # pipeline init fail-closed; the DEFAULT_SCOPE invented-allowlist
  # fallback is retired:
  - aspect: "adapter-scopes-fail-closed"
    unit: { kind: file, path: platform/services/statecraft/api/factory/factory.ts }
  - aspect: "governance-sub-envelope-section"
    unit: { kind: file, path: standards/schemas/factory/adapter-manifest.schema.yaml }
  # Phase 4 — the run-grant trust fabric tightens these existing surfaces:
  - aspect: "run-grant-envelope-family"
    unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  - aspect: "run-grant-envelope-family"
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - aspect: "certificate-countersign-on-completion"
    unit: { kind: file, path: platform/services/statecraft/api/factory/runDuplexHandlers.ts }
  - aspect: "admission-seal-in-bundle"
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.ts }
  - aspect: "admission-seal-in-bundle"
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundleHelpers.ts }
  - aspect: "platform-countersign-binding"
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - aspect: "platform-countersign-binding"
    unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
  - aspect: "stage-boundary-grant-renewal"
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  - aspect: "stage-boundary-grant-renewal"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory.rs }
  - aspect: "run-grant-envelope-family"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
  - aspect: "run-grant-envelope-family"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory_platform.rs }
  - aspect: "admission-seal-in-bundle"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/statecraft_client.rs }
  - aspect: "run-grant-records"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - aspect: "run-grant-records"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
  # Phase 5 (FR-013) — the override gate tightens every user_body write
  # path and the trust-class columns ride the substrate row shape:
  - aspect: "override-write-gate"
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.ts }
  - aspect: "override-write-gate"
    unit: { kind: file, path: platform/services/statecraft/api/factory/conflicts.ts }
  - aspect: "override-write-gate"
    unit: { kind: file, path: platform/services/statecraft/api/agents/catalog.ts }
  - aspect: "override-trust-class"
    unit: { kind: file, path: platform/services/statecraft/api/factory/substrate.ts }
  - aspect: "override-trust-class"
    unit: { kind: file, path: crates/factory-engine/src/substrate_version.rs }
  - aspect: "override-verify-ui"
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.factory.artifacts.tsx }
  - aspect: "override-verify-ui"
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/factory-api.server.ts }
references:
  - role: enforcer
    unit: { kind: crate, id: factory-engine }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
  - role: design-record
    unit: { kind: file, path: docs/analysis/governance-envelope-unification.md }
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/factory/substrateBrowser.ts }
---

# Feature Specification: Factory Governance Envelope (ASI Admission Contract)

**Feature Branch**: `198-factory-governance-envelope`
**Created**: 2026-06-09
**Status**: Draft
**Input**: Establishing the owned factory sources (factory +
template) as an OAP-controlled open standard forced a foundational
question: when statecraft consumes a factory, what must it *understand and
enforce* versus merely *store*? The answer is a governance envelope — a
contract the factory files and OAP validates fail-closed before admitting any
of its agent content. This spec is the **prior** that the thin-consumer cutover
([spec 199](../199-factory-thin-consumer-sync/spec.md)) depends on: 199 stops
translating owned content and serves it verbatim; **198 defines what makes a
factory admissible at all.**

## Purpose and charter

Define, as an open standard, the **governance envelope**: the
machine-checkable brief a factory must file, and OAP's fail-closed admission
gate over it. The envelope is OAP's encoding of OWASP ASI 2026 obligations into
a contract — so that admitting a factory is a *judgement against named law*,
not a trust decision.

The branches-of-authority model this spec operationalises:

- **OWASP ASI 2026 is the legislature.** It writes the law
  (`docs/owasp-agentic-top-10-2026.md`). OAP does not invent agentic-security
  rules; it enforces these.
- **The factory is the advocate.** It interprets the law into this org's
  context and *files a brief* — the envelope instance — declaring how its
  pipeline satisfies the obligations.
- **OAP is the judge and bouncer.** It admits or refuses (fail-closed), then
  arbitrates enforcement across run and emission. It owns the envelope
  **schema** (the law as OAP enforces it); it does **not** author the instance.
- **OPC is the executor on conditions.** Operating outside the platform, it is
  presumed untrustworthy; it may act only within the admitted envelope and
  cannot define the contract. Obligations flow *down* from OAP; for that to
  happen a valid factory must exist that specifies them.

**Validity is having filed a conformant, reconciled brief.** That is the whole
definition of "a factory OAP will admit" — and it is the open standard's teeth:
the same brief, read the same way, for OAP's own factory and any third party's.

## Grounding in OWASP ASI 2026 (the envelope is named in the source)

The envelope is not an OAP invention bolted onto the framework — the source
*specifies it*:

- **ASI01 mitigation 5** — "Evaluate **intent capsules**: bind declared goal,
  constraints, and context into a **signed envelope per execution cycle**."
- **ASI10 mitigation 5** — "**signed behavioral manifests** declaring expected
  capabilities, tools, and goals, validated by orchestration **before each
  action**; continuous verification against the manifest."
- **ASI10 mitigation 6** — keys live in HSM/KMS; "**agents never hold signing
  keys directly** — the orchestrator mediates signing."
- **Cross-cutting principle 4** — "**Planner output is untrusted too** —
  separate planning from execution with an independent policy-enforcement point
  (PEP/PDP) that validates intent, arguments, and schemas before any tool
  runs."
- **Cross-cutting principle 5** — HITL with **plain-language risk summaries,
  never model-generated rationales as the approval basis**.
- **Cross-cutting principles 8 & 9** — provenance everywhere (sign, pin by
  content hash + version, attest); zero-trust, fail-closed composition.

The envelope is the synthesis of the intent capsule (the run's goal) and the
behavioral manifest (the run's agents/tools/tiers), filed by the factory and
adjudicated by OAP.

## Design principles (normative)

- **P-1 Conform-by-standard; enforce, don't compensate.** OAP transforms owned
  content only to *enforce* the standard (validate, content-address,
  reconcile) — never to *compensate* for a missing standard. (Companion to
  spec 199's thin-consumer principle.)
- **P-2 Predicate-shaped, never structure-shaped.** The envelope declares
  *obligations that hold* ("∃ a HITL gate before any stage that mutates main"),
  never *topology* ("stage 6 has gate G"). OAP checks predicates; the binding
  of a predicate to a concrete stage is resolved at run time by the engine,
  which OAP never models. This is the line between adjudicating the law
  (legitimate) and rewriting the factory's pleadings (imposition).
- **P-3 Trustworthy by design, explicit by nature.** OAP independently verifies
  the brief against the evidence; it never takes a declaration on faith.
- **P-4 One home per fact, composed not duplicated.** Each governance fact
  lives in exactly one place; the envelope references and reconciles, it does
  not copy.
- **P-5 Fail-closed.** Absent / non-conformant / over-ceiling / inconsistent ⇒
  refuse to admit. No silent default, no advisory pass.

## The envelope, structurally

A composite the factory files, OAP adjudicates:

- **Process envelope** (the run) — `process/governance-envelope.yaml` at the
  factory's process-layer root (FR-012): the declared objective class (the
  intent-capsule template, FR-005), the aggregate tier + mutation ceilings,
  the HITL gates as predicates, the emitted-artifact manifest (by kind), and
  *pointers* to the per-agent declarations it composes. Stage ids are open —
  numbered `00`…`06` today plus the optional `cd` stage — the envelope never
  enumerates topology (P-2).
- **Adapter sub-envelope(s)** (the scaffold boundary) — a `governance:`
  section inside each adapter's `manifest.yaml` (adapter-manifest schema
  1.1.0, FR-012): per-adapter `file_write_scope`/`file_write_denied`, the
  command allowlist (by reference to the manifest's own `commands:` map),
  declared scaffold-execution surface, tier ceiling, and constituent pointers
  to the adapter's agents. Each bound adapter contributes its own
  sub-envelope; multi-adapter composes naturally (no new mechanism — spec 199
  FR-009).
- **Atomic constituents** (not re-authored) — per-agent `safety_tier` /
  `mutation` / tool allowlist live in agent frontmatter, on **both** layers:
  already present on process agents (e.g.
  `process/agents/pipeline-orchestrator.md: safety_tier: tier1, mutation:
  read-only`) and required on adapter agents (authored upstream per the
  cross-repo worklist — the file-writing agents declare nothing today, which
  alone makes the factory inadmissible until fixed). The envelope *references
  and reconciles against* these, under the FR-003 mutation grammar.

OAP composes process + adapter sub-envelopes at bind time; it never flattens
them into one undifferentiated brief (preserves the run ↔ handoff domain line).

## Requirements

### FR-001 — The envelope is the admission contract; it defines factory validity (normative)

A factory is **admissible** iff it files a governance-envelope instance that
(a) conforms to the envelope schema and (b) reconciles with its own atomic
constituents (FR-003). An inadmissible factory MUST NOT be bound to a project;
no project bind ⇒ OPC receives nothing to execute. This is the universal
admission contract: it applies identically to OAP's own factory and to any
third-party factory.

### FR-002 — The envelope schema is OAP-owned, open, predicate-shaped, ASI-tagged

The schema lives under `standards/schemas/factory/governance-envelope.schema.yaml`
(canonical) with a Rust twin in `crates/factory-contracts` and a pinned
`GOVERNANCE_ENVELOPE_SCHEMA_VERSION`. It MUST be **open** (a factory declares
its own stages/gates; no fixed stage count or names — consistent with
`pipeline-state.schema.yaml`'s open stage keys), **predicate-shaped** (P-2),
and **ASI-tagged**: every field carries the ASI control id(s) it satisfies,
inline (the brief cites its statutes), in addition to the external
`compliance-report` aggregation (FR-011). Org-/stack-specific concepts MUST NOT
enter it (spec 197 open-standard principle).

### FR-003 — Two-sided, fail-closed admission validation (recompute-and-reconcile)

At admission (sync/bind time) OAP MUST validate the envelope two ways and fail
closed on either:

1. **⊨ schema** — the instance conforms to the envelope schema (cites the law
   correctly).
2. **⊨ constituents** — OAP **independently recomputes** the atomic aggregate
   from the factory's own agent frontmatter (tiers, mutation, tool allowlists)
   and the adapter sub-envelopes, and the declared envelope MUST equal or
   bound it. A declared "max tier ≤ T" that any constituent agent exceeds, or a
   declared scope narrower than an adapter's actual scope, is an admission
   failure. (Reading frontmatter is reading declared facts, not interpreting
   topology — the P-2 line holds.)

Ambiguity (missing field, unresolved reference, schema mismatch) fails closed
(principle 9 / ASI04). This is the spec-127 coupling-gate pattern lifted to
governance — the brief cannot lie about its parts.

**Mutation grammar (normative).** The grammar extends the spec 054 unified
frontmatter vocabulary (`read-only | read-write | full`) with one new value
rather than inventing a parallel one:
`mutation: read-only | scoped-write | read-write | full`, ordered
`read-only < scoped-write < read-write < full`. `mutation_scope: [<glob>…]`
is required iff `scoped-write` (scoped-write covers create, modify, **and
delete** within scope). Reconciliation rules: every agent's `safety_tier` ≤
the owning envelope's `max_tier`; every declared `mutation` ≤ the owning
envelope's `max_mutation`; every `mutation_scope` ⊆ the owning
sub-envelope's `file_write_scope` (process agents reconcile against the
process envelope's ceilings); `read-write` reconciles as scoped-write over
the owning envelope's **entire** `file_write_scope`; `full` is admissible
only under a declared `max_mutation: full` (which the standard posture never
files); a free-form mutation value is non-conformant and fails closed.
`optional: true` marks an admitted-but-optional agent — allowlist membership
is what matters (FR-006); optionality and stage ids are run topology, which
OAP does not model (P-2).

### FR-004 — Composition: process envelope + adapter sub-envelope(s), never flattened

OAP composes the process envelope with each bound adapter's sub-envelope at
bind time into the effective admitted envelope. The composition MUST preserve
the run ↔ scaffold-boundary separation (no flattening). Binding a second
adapter composes its sub-envelope without re-authoring the process envelope.

### FR-005 — Intent capsule as run-grant, renewed per stage boundary (ASI01 m5)

The process envelope declares the **intent-capsule template** (objective
class, constraint set, goal-identifier scheme); each run files a concrete
capsule instantiating it. The capsule is realised as a **run-grant**
(FR-014): the OPC engine submits the capsule content — goal + stable goal
id, constraints, admitted-envelope hash, frozen Build-Spec hash, project,
run id — over the authenticated duplex channel; OAP validates it against the
admitted envelope and current revocations (FR-010) and returns a short-lived,
audience-bound signed grant (ASI03 m5 intent-bound tokens; ASI02 m4/m6 JIT
short-lived credentials; ASI10 m6 one-time audience binding). The grant is
**renewed at every stage boundary** — this is "signed per execution cycle":
renewal re-presents the current goal id, so an unexpected goal shift refuses
renewal, pauses the run, and is surfaced + recorded (ASI01 m4/m7); a
revocation since issuance refuses renewal (FR-010 propagation); expiry caps
unattended run authority (ASI08 m3). OPC already requires platform
connectivity (spec 183 boot gate + duplex), so per-stage renewal adds no new
availability coupling. The capsule and grant chain are bound into the
governance certificate at emission (FR-009, FR-014).

### FR-006 — Behavioral manifest (ASI10 m5/m6)

The envelope MUST express, per agent, the **expected capabilities, tools,
goals, tier, and mutation mode** (sourced from agent frontmatter,
FR-003-reconciled). The admitted set IS the allowlist of legitimate agents —
anything off-list at run time is rogue by definition and refused (ASI10).
**Agents never hold signing keys**; the orchestrator/OAP mediates signing
(ASI10 m6) — OPC, as the untrusted executor, cannot self-attest.

### FR-007 — PEP/PDP separation: OAP is the policy engine, OPC the executor (principle 4; ASI02 m4; ASI08 m4)

The envelope declares the obligations; **enforcement at run time is an
independent policy-enforcement point** that treats planner/LLM output as
untrusted and validates intent + arguments + schemas before any tool runs.
OAP/axiomregent is that PEP/PDP; OPC is the executor it gates. This spec does
NOT re-implement the runtime gate — it declares the contract the existing
enforcement (tool registry 067, permission runtime 068, safety tiers 036)
honours, and requires that those gates read the admitted envelope as their
source of truth.

### FR-008 — HITL declaration (ASI09; principle 5)

The envelope MUST declare which gates are human-in-the-loop and which require
out-of-band cryptographic approval (irreversible / goal-changing /
privilege-escalating / deploy steps). The contract requires the human be shown
**plain-language risk summaries with provenance — never model-generated
rationales** — and that **preview be separated from effect** (no state-changing
/ network side effects in a preview). Enforcement is by the orchestrator
checkpoint rules (`.claude/rules/orchestrator-rules.md` rule 3) + the stop-hook
gate chain (spec 166); this FR fixes the *declaration* the human approval
surface consumes.

### FR-009 — Provenance + pinning, bound into the certificate (principle 8; ASI04)

The envelope MUST reference its constituents by **content hash + version**
(the substrate is already content-addressed, spec 139), and the admitted
envelope MUST be **bound into the governance certificate** at emission (spec
102/168) — making the certificate reconcilable to the admission contract, not
just the artifacts. The envelope is the admission-time bookend to the
emission-time certificate. A continuous-revalidation hook (re-check hashes at
run/emit; ASI04 m6) is required at least as a declared obligation.

### FR-010 — Containment: revocation keyed on the admission graph (principle 10; ASI04 m8; ASI10 m4/m7)

Revocation operates on the **nodes of the admitted composition graph** — one
mechanism, four keys: **factory** (the whole admission), **adapter** (one
sub-envelope), **agent** (one behavioral-manifest entry; the PEP refuses the
invocation per FR-006), and **content hash** (any pinned artifact — prompt,
manifest, scaffold tree — the supply-chain-correct primitive: a CVE names a
version, we name a hash; fixed upstream bytes re-enter via normal admission,
so no un-revoke path exists for content). Two modes: `revoked` and
`quarantined` — quarantine preserves the admission record for forensics, and
reintegration from quarantine requires fresh two-sided validation (FR-003)
plus human approval (ASI10 m7), never an automatic flip. Checks are enforced
fail-closed at three times: **serve** (the statecraft read path, spec 199
FR-006), **bind**, and **run-grant issuance/renewal** (FR-005 — which is what
propagates revocation to in-flight runs within one stage boundary; ASI04 m6
continuous revalidation). Implementation may phase, but the contract MUST
reserve the hook (an admitted envelope is revocable, not permanent).

### FR-011 — All ten ASI controls are explicitly mapped and defensible

This spec MUST deliver the gap analysis the OWASP engineering reference
explicitly defers "to a future spec" (`docs/owasp-agentic-top-10-2026.md`
§"OAP control-surface pointers"). For each of ASI01–ASI10: name the envelope
field and/or existing spec that addresses it, the enforcement level + time, and
an **honest status** (solid / partial / declared-gap). Inline ASI tags (FR-002)
+ the external `compliance-report` MUST agree. Partial/gap stances (notably
ASI09 below) MUST be stated, not implied as covered.

### FR-012 — Envelope homes: process file + in-manifest sub-envelope (resolves OQ-1)

The process envelope lives at **`process/governance-envelope.yaml`** in the
factory source (there is no process-level manifest to extend, and standalone
YAML is the factory contract layer's established machine idiom; it enters OAP
as schema-validated, content-addressed substrate bytes — machine layer, not
authored OAP truth, so constitution Principle I is not in play). The adapter
sub-envelope lives as a **`governance:` section inside the adapter's
`manifest.yaml`** (adapter-manifest schema **1.1.0**): the manifest is the
adapter's self-declaration — one file = one content hash = one substrate row
= one revocation key (FR-010) — and the reconcile evidence (`commands:`,
`directory_conventions:`, `scaffold.emits:`) lives in the same
content-addressed unit, which removes a split-brain class for third-party
authors. The sub-envelope declares `max_tier`,
`file_write_scope`/`file_write_denied`, the command allowlist **by reference
to the manifest's own `commands:` map** (one home per fact, P-4), the
scaffold-execution surface (entry points + setup commands;
`isolation: sandbox-required` — ASI05), and constituent pointers to the
adapter's agents. **`adapter-scopes.json` becomes a derived projection** of
the admitted sub-envelope(s), regenerated at admission — OAP materializes the
enforcement snapshot; it no longer authors the facts. Spec 160's
indexer-hashing of the snapshot is unchanged.

### FR-013 — Override-write contract: rules block, models quarantine (resolves OQ-2; ASI06)

> **Amended 2026-07-01 by spec 204 (session-memory write contract).** The
> carrier-class, secret, and UTF-8 rules of gate (a) now live in the shared
> `@opc/carrier-gate` package and are imported by `overrideGate.ts` rather
> than defined inline, so this gate and the session-memory write gate share
> one canonical rule set (spec 204 FR-001). Rule ids, verdicts, and the two
> substrate-specific rules (size ceiling, kind stability) are unchanged by
> the extraction.

The substrate `user_body` write path MUST enforce, in order: **(a) a
deterministic synchronous gate** — shape/size validation, CDR-class carrier
stripping (zero-width/bidi Unicode, hidden-comment payloads, oversized
encoded blobs, data-URIs; ASI01 m6), secrets scanning; fail-closed on any
hit. **(b) Provenance stamping** — author identity (Rauthy subject),
timestamp, content hash on every revision (ASI06 m5). **(c) Trust-class
segregation** — overrides are a distinct trust class, served with provenance
attached, `unverified` until a privileged human verifies them; the process
envelope declares the consumption predicate (`overrides.require_verified`),
so depth is *filed org policy*, not an OAP hardcode (ASI06 m3/m9); every
override a run consumes is bound into that run's certificate (traceable and
revocable via FR-010). **(d) Model-assisted scanning is asynchronous and
quarantine-only** — a flag quarantines pending human review via FR-010
machinery; a model may detect, **only rules may block** (cross-cutting
principle 4 — this is how "rules + AI" from ASI06 m2 composes with
untrusted-model-output). Phasing: (a)+(b) land with the admission gate,
(c) with the envelope schema, (d) as the named follow-on spec.

> **Correction (2026-06-11, discovered during spec 201 phase 1).** The
> phase 5 implementation of (a) and (c) emitted the audit actions
> `artifact.override_gate_rejected` and `artifact.override_verified`, but
> the migration-32 check constraint
> `factory_artifact_substrate_audit_action_chk` was never widened to admit
> them — every gate-refusal and verify-override audit INSERT violated it
> on a real database. The covering tests (`overrideTrustClass.test.ts`)
> are encore-test-gated and outside the CI vitest run, so the violation
> shipped invisibly. Migration 46 widens the constraint to the full
> `ArtifactAuditAction` vocabulary. The encore-test CI gap is a separate
> process finding, filed as [spec 211](../211-encore-test-ci-job/spec.md).

### FR-014 — Signing authority: statecraft seals, OPC is keyless (resolves OQ-4; ASI10 m6)

Statecraft is the signing authority — the judge owns the seal. Private keys
live platform-side (Encore secrets; K8s Secret / KeyVault by deployment
profile — HSM/KMS custody is a deployment obligation documented with the
schema, not a contract field); public keys are published JWKS-style at a
well-known statecraft endpoint with `kid` rotation. Three signature classes,
one custody model: the **admission seal** over the composed envelope record
(verified by the OPC engine before trusting any factory content — ASI04 m1);
the **run-grant** (FR-005); and the **emission countersign** — on sync-back,
statecraft verifies the engine's locally-maintained tamper-evident hash chain
against the grant sequence it issued and countersigns the governance
certificate, so `verify-certificate` proves two independent things: the
artifact hash chain (fully offline, producer-untrusted, unchanged from spec
102) and the platform seal binding the run to its admission contract. A
certificate that never reconnected is verifiable-but-unsealed — visibly so,
never silently equivalent. **OPC and every agent are keyless, categorically**
(ASI10 m6: the orchestrator mediates signing): a fully compromised OPC holds
a revocable Rauthy session and grants valid only for declared intents inside
an admitted envelope — it cannot mint authority, cannot ratify its own work,
and loses all standing one stage boundary after revocation.

## All-ten ASI coverage (the deferred gap analysis, delivered)

| ASI 2026 | Envelope lever + enforcement (level @ time) | Status |
|---|---|---|
| **01 Goal Hijack** | Intent capsule (FR-005) + declared-vs-actual reconcile (FR-003); spec-spine coupling (127/130/133) + adversarial-refusal (131) @ agent-decision | **Solid** |
| **02 Tool Misuse** | Per-agent tool allowlist + tier in behavioral manifest (FR-006); PEP/PDP (FR-007) via registry 067 / permission-runtime 068 / tiers 036 @ run | **Solid** |
| **03 Identity & Privilege Abuse** | Adapter sub-envelope scopes + tier ceiling, bounded @ admission (FR-003/004); Rauthy short-lived OIDC, deployd scope-gate, tenant gates 137 @ run; OPC = executor-on-conditions | **Solid** (token/PAT handling stays a watched surface) |
| **04 Agentic Supply Chain** | The envelope *is* the live-supply-chain admission gate (FR-001); content-hash pinning (FR-009, substrate 139); kill-switch (FR-010); SHA-pinning 158, attestations 117 | **Closed by this spec** (was: hashes without admission) |
| **05 Unexpected RCE** | Envelope declares which stages execute code + isolation tier; sandbox 162 / local-container 185 / k8s 186 @ run; preview≠effect (FR-008) | **Solid** |
| **06 Memory & Context Poisoning** | Factory run is *architecturally low-surface* — stateless stages, content-addressed artifact passing, no self-ingestion. Control-point = substrate **`user_body` write path**, contract-specified by FR-013 and live for (a)–(c): deterministic gate + provenance on every write, verified-flag trust class, envelope predicate enforced at bundle assembly, consumed overrides certificate-bound + knowledge provenance 115/161/121 | **Designed (FR-013), a–c implemented** — async scanner (d) filed as [spec 200](../200-substrate-override-async-scanner/spec.md) |
| **07 Insecure Inter-Agent Comms** | Emit-manifest (FR-005/009) + signed inter-stage manifests 170 + duplex version parity 189 + schema parity 125/191; typed contracts, reject downgrades @ run | **Solid** |
| **08 Cascading Failures** | HITL/gate predicates as circuit-breakers (FR-008); PEP between planner/executor (FR-007); per-stage verification fail-closed; stop-hook 166; introspection 172. Residual: fan-out can outpace oversight — must be evaluated vs org risk budget | **Partial — residual stated** (blast-radius caps are follow-on, filed as [spec 202](../202-run-blast-radius-governor/spec.md)) |
| **09 Human-Agent Trust** | HITL declaration requiring plain-language + provenance, never model rationale; preview≠effect (FR-008); certificate's independent `verify-certificate` (does not trust the producer) gives the human a verifiable basis | **Solid** ([spec 201](../201-anti-blind-approval-ui/spec.md) phases 1–4: fact-grounded `ApprovalSummary`, fail-closed verify + run-gate surfaces, replay-guarded approve, `summaryHash` audit evidence). The "Solid" precondition — spec 201 AC-1–AC-5 verified **in CI** — discharged 2026-06-12: [spec 211](../211-encore-test-ci-job/spec.md)'s enforcing encore-test lane merged in `a58755be` (PR #347) and runs the DB-bound AC suites on every PR and in `merge_group` (live runs 27419049946 / 27419855931, lane-coverage guard confirming execution) |
| **10 Rogue Agents** | Admitted behavioral manifest = the legitimate-agent allowlist (FR-006), off-list = rogue; agents never hold keys (FR-006); kill-switch/quarantine (FR-010); sandbox prevents hidden spawn; introspection 172 detects | **Solid-ish** (admission-prevention strong; runtime detection leans on 172/sandbox) |

Shape of the defense: the envelope makes **01/03/04/10 explicit and
fail-closed at the door**, **declares the runtime levers for 02/05/07/08** that
existing specs enforce, **specifies 06's control-point as contract** (FR-013;
(a)–(c) implemented, (d) filed as spec 200), and is **honest that 09 remains
partial** (spec 201's presentation contract is implemented; the "solid"
flip is gated on its AC suites running in CI, not just locally).

## Acceptance criteria

- **AC-1.** `governance-envelope.schema.yaml` is committed under
  `standards/schemas/factory/` with a Rust twin and pinned SCHEMA_VERSION;
  schema-parity (125/191) is green. (FR-002)
- **AC-2.** Admission validation is two-sided and fail-closed: a factory whose
  declared envelope under-states a constituent agent's tier/mutation, or omits
  the envelope, or fails schema, is **refused** (not warned), with an
  attributable error. (FR-001, FR-003)
- **AC-3.** Process envelope and adapter sub-envelope(s) compose at bind without
  flattening; binding a second adapter composes its sub-envelope. (FR-004)
- **AC-4.** The intent capsule and the admitted envelope are bound into the
  governance certificate at emission; `verify-certificate` reconciles the
  certificate to the admission contract AND verifies the platform countersign
  (FR-014); a never-reconnected certificate verifies as visibly unsealed.
  (FR-005, FR-009, FR-014)
- **AC-5.** The behavioral manifest is the run-time agent allowlist; an agent
  invocation outside the admitted set is refused; OPC holds no signing keys.
  (FR-006)
- **AC-6.** Every envelope schema field carries inline ASI control id(s), and
  the `compliance-report` aggregation agrees with the inline tags. (FR-002,
  FR-011)
- **AC-7.** All ten ASI controls have a stated status (solid/partial/gap) with a
  named lever; the ASI06 async scanner (FR-013 d) and ASI09
  (anti-blind-approval) are recorded as declared follow-ons with owners.
  (FR-011, FR-013)
- **AC-8.** Revocation by each of the four keys (factory, adapter, agent,
  content hash) takes effect fail-closed at serve, bind, and grant renewal;
  a revoked admission cannot bind; reintegration from quarantine requires
  fresh two-sided validation plus human approval. (FR-010)
- **AC-9.** `make ci` / schema-parity / coupling gate pass; codebase index +
  featuregraph golden regenerated for the spec add.
- **AC-10.** The envelope homes are live: `process/governance-envelope.yaml`
  is read from the factory source, the `governance:` manifest section parses
  at adapter-manifest schema 1.1.0, and `adapter-scopes.json` regenerates as
  a projection of the admitted sub-envelope(s). (FR-012)
- **AC-11.** `user_body` writes pass the deterministic gate and carry a
  provenance stamp; an unverified override is refused for runs whose admitted
  envelope declares `overrides.require_verified: true`. (FR-013 a–c)

## Out of scope

- The **mechanical thin-consumer cutover** (stop translating, serve verbatim,
  manifest identity, origin-from-source) — that is [spec 199](../199-factory-thin-consumer-sync/spec.md),
  which depends on this spec.
- The **produced app's own ASI posture** — documented by its Build Spec +
  governance certificate, not by the factory-run envelope. The envelope governs
  the run that builds the app, not the app.
- The OPC factory **engine's** internal stage execution (spec 075 retains stage
  semantics).
- Build Spec contract field changes (spec 197 / future contract specs).
- Full implementation of every runtime enforcement point — this spec defines
  the *contract* and *admission gate*; it declares (not re-implements) the
  runtime PEP (036/067/068), HITL (166), sandbox (162/185/186), and signed
  handoffs (170).

## Phasing (proposed; refine in plan.md)

1. **Schema + Rust twin.** `governance-envelope.schema.yaml`, the contract
   type, SCHEMA_VERSION, inline ASI tags; **adapter-manifest schema 1.1.0**
   with the `governance:` section (FR-012) and `factory-contracts` acceptance
   of 1.1.0 manifests — this is the merge unblock for the factory
   authoring branch. Schema-parity green.
2. **Admission gate.** Two-sided fail-closed validation in the sync/bind path
   (`syncPipeline.ts` / bind); recompute-and-reconcile from agent frontmatter
   (both layers, FR-003 grammar) + adapter sub-envelopes; scaffold-source
   resolution-at-admission recorded on the admission record (shared mechanism
   with spec 199 FR-003/FR-009); admission record persisted.
3. **Containment + scopes.** Revocations on the admission graph (FR-010,
   four keys, serve/bind checks); `adapter-scopes.json` derivation (FR-012);
   `user_body` deterministic gate + provenance (FR-013 a+b).
4. **Seal + grants.** Signing authority + JWKS (FR-014); run-grant
   issue/renew over duplex (FR-005); grant-renewal revocation check;
   certificate countersign + `verify-certificate` extension. Admission is
   enforceable before it is sealable — this phase may follow phase 2/3 but
   MUST land before the spec is declared complete.
5. **All-10 closure.** Wire inline ASI tags ↔ `compliance-report`; verified
   override flag + envelope predicate (FR-013 c); file the ASI06 async-scanner
   (FR-013 d) and ASI09 anti-blind-approval follow-on specs.

## Cross-repo coordination

- **factory** must file a conformant envelope. The authoring work is
  **dispatched** (2026-06-09, branch `feat/governance-envelope` upstream):
  `process/governance-envelope.yaml`, the manifest `governance:` section at
  schema 1.1.0, frontmatter for all six adapter agents, and the cd
  orchestrator's mutation normalized to the FR-003 grammar. Its merge is
  **gated on phase 1 here** (factory-contracts accepting adapter-manifest
  1.1.0), since statecraft syncs the upstream `main`. This is the "valid
  factory must exist" precondition for spec 199's admission gate.
- **docs/owasp-agentic-top-10-2026.md** is the law of record; this spec is the
  encoding. The stale `docs/owasp/factory/AIDE-*` blueprints (older ASI
  numbering) were removed in the 2026-06-09 docs cleanup; the non-owning
  `references:` edges some specs retain to them dangle by design (spec 154/156
  semantics) and need no action.

## Resolved questions

Resolutions are recorded in
`docs/analysis/governance-envelope-unification.md` (D-1..D-4) and encoded in
the FRs:

- **OQ-1 — envelope homes** → resolved by **FR-012**: dedicated
  `process/governance-envelope.yaml`; adapter sub-envelope as a `governance:`
  section *inside* `manifest.yaml` (one content-addressed unit, one
  revocation key, reconcile evidence co-located).
- **OQ-2 — `user_body` write-validation depth** → resolved by **FR-013**:
  deterministic rules block synchronously; provenance + verified-flag
  segregation; model-assisted scanning is asynchronous and quarantine-only —
  a model may detect, only rules may block.
- **OQ-3 — kill-switch granularity** → resolved by **FR-010**: not a choice —
  all four nodes of the admission graph (factory / adapter / agent /
  content-hash), two modes, checked at serve / bind / grant-renewal.
- **OQ-4 — signing keys** → resolved by **FR-014 + FR-005**: statecraft is
  the signing authority (JWKS + `kid` rotation, platform-side custody); the
  capsule is realised as a short-lived run-grant renewed per stage boundary;
  OPC and agents are keyless, categorically.

## Implementation log

- **2026-06-11 — FR-014 signing authority live; first SEALED admission.**
  The deployed Hetzner statecraft gained `FACTORY_SIGNING_PRIVATE_KEY` /
  `FACTORY_SIGNING_KID` (`fk-2026-06`, Ed25519) under the documented
  K8s-Secret custody profile; the keyset serves at
  `/api/factory/.well-known/jwks.json`. The next org re-sync produced the
  first sealed admission for `statecrafting/factory`
  (record `7cf82fae…`, factory sha `cc1139f…`, envelope hash `549c1350…`,
  14 agent digests, 0 violations). The seal's compact JWS
  (`typ: oap-admission-seal+jws`) was verified independently against the
  published JWKS — signature valid, claims bind the envelope hash, the
  `acme-vue-encore` manifest hash (`57f43e1a…`), every agent digest, and the
  scaffold resolution to `statecrafting/template @ main`. Three
  earlier admissions (2026-06-10/11) were admitted-but-UNSEALED — exactly
  the fail-closed posture this FR prescribes for the engine side.
- **2026-06-11 — FR-012 enforcement: snapshot-absent adapters fail closed.**
  `factory.ts::compileDefaultRules` retires the `DEFAULT_SCOPE` fallback
  (`npm/npx/node` + `src/`): an adapter with no entry in the materialised
  enforcement snapshot now refuses pipeline init with an actionable
  `failedPrecondition` instead of inheriting a broader invented allowlist —
  the PR-#338 review finding, fixed at its truthful home (this spec's
  FR-012, via the `adapter-scopes-fail-closed` refines edge added to the
  frontmatter).
- **2026-06-11 — FR-012 first derivation ran (AC-10 closes).**
  `adapter-scopes-compiler` (spec 105, amended same date) now projects the
  manifest `governance:` sub-envelope verbatim; the committed snapshot
  `platform/services/statecraft/api/factory/adapter-scopes.json` was
  regenerated from the admitted manifest (hash-equal to the sealed
  admission's `adapter_manifest_hashes` entry) and re-derivation is
  byte-identical. The interim hand-regenerated snapshot (spec 199 FR-007)
  is retired: OAP materialises the enforcement snapshot; it no longer
  authors the facts.
- **2026-06-12 — adapter-manifest `dual_stack` realigned to the canonical
  variant model.** The `adapter-manifest.schema.yaml` this spec refines
  carried a legacy `dual_stack` section (`audience_to_stack` / `stacks`,
  the pre-factory "in-tree stack" shape) that diverged from the
  owned upstream's canonical schema (`audience_to_variant` / `variants`,
  where a variant is a standalone top-level copy with its own `dir`,
  `auth_driver`, and `env_example`). OPC's live adapter fetch surfaced
  the drift as a hard parse failure — `missing field 'audience_to_stack'`
  at the fetched `acme-vue-encore/manifest.yaml` — because the Rust
  `DualStack` deserializer (`crates/factory-contracts/src/adapter_manifest.rs`)
  shared the stale naming. Realigned all three OAP-side artifacts (Rust
  type, its sole consumer in `factory-engine/manifest_gen.rs`, and this
  refined mirror schema) to the variant model. This is orthogonal to the
  governance sub-envelope (FR-012) but lands on the schema path this spec
  is authoritative over, so it is recorded here. Note: the spec-212
  lockstep gate scopes the adapter-manifest comparison to
  `{schema_version, governance}` only, so `dual_stack` drift was outside
  its coverage; widening that coverage is deferred (a spec-212 decision,
  not taken in this pass).
- **2026-07-08: adapter-manifest `dual_stack.variants.*.auth_driver`
  examples corrected to the mock|rauthy model (spec 229).** The illustrative
  `# e.g. "saml"/"entra-id"/"auth0"` comments on the schema's variant
  `auth_driver` (and the matching Rust `VariantEndpoint.auth_driver` doc)
  named enterprise IdPs as if they were app-level driver values. Per spec 229
  the app-level `auth_driver` is only `mock` (dev) or `rauthy` (prod); those
  IdPs federate inside Rauthy as upstream providers, not as values of this
  field. Comment/doc-only correction on the schema path and Rust type this
  spec refines; no wire or behavior change.
- **2026-06-12 — `implementation: complete` flip.** The tasks.md
  completion gate ("runtime AC verification after the Statecraft-side
  envelope merge + org re-sync (first real ADMIT)") is discharged: the
  Statecraft-side envelope merge is on `factory` main
  (`process/governance-envelope.yaml`, manifest 1.1.0 `governance:`
  section, all 14 agents carrying `safety_tier`/`mutation` frontmatter),
  and the first real ADMIT is the sealed admission `7cf82fae…` recorded
  above (2026-06-11, 0 violations, JWS independently verified). All 26
  tasks (T001–T026, phases A–F) are checked; every `establishes:` and
  `refines:` path exists on main; CI is green; ASI09 flipped to "Solid"
  via the spec-211 encore-test lane (PR #348). Two postures recorded
  honestly rather than silently absorbed: (1) AC-5's agent-allowlist
  refusal is satisfied at the admission-gated bundle boundary per T010's
  recorded deviation — no per-invocation engine-side check was added;
  factory content reaches the engine only through the admitted bundle,
  and agent-key revocations propagate at every grant renewal. (2) A live
  end-to-end run producing a countersigned certificate verified with
  `verify-certificate --require-sealed` has not yet been recorded here;
  per plan.md's verification table AC-4 maps to code phases (handler +
  engine tests, all landed), so the live observation is follow-on
  auditor evidence, not a completion gate. Status stays `draft`:
  approval is a separate ratification act (corpus precedent: specs 199,
  201, 211 are complete-but-draft).
