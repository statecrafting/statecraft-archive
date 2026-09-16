---
id: "204-session-memory-write-contract"
title: "Session-Memory Write Contract (ASI06 cockpit surface)"
feature_branch: "feat/204-session-memory-write-contract"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Extend the substrate override-write discipline (spec 198 FR-013) to
  OAP's second persistent-memory surface: the OPC session-memory MCP
  (spec 056). Today memory writes are ungoverned — no validation-on-write,
  no provenance stamp, no trust class, no decay of unverified entries, and
  harvested agent output can be promoted toward permanent retention
  without any human in the loop (ASI06 bootstrap-poisoning shape). This
  spec mirrors the FR-013 architecture onto session memory: a
  deterministic carrier-class gate on every write, provenance (actor,
  origin session, content hash) on every revision, trust classes with
  human-gated promotion, trust-weighted decay, and a no-self-ingestion
  rule. The cross-cutting principle carries verbatim: a model may DETECT,
  only rules may BLOCK.
code_aliases: ["SESSION_MEMORY_WRITE_CONTRACT"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI06"]
depends_on:
  - "056-session-memory"
  - "198-factory-governance-envelope"
# Spec 204 amends spec 198: the repoint of overrideGate.ts onto the shared
# @opc/carrier-gate package is a genuine refinement of 198's FR-013(a) gate
# implementation, recorded in 198 in-body (Decision 1, plan.md).
amends: ["198-factory-governance-envelope"]
establishes:
  # The canonical carrier-class rule set (FR-001) and its shared AC-1 fixture.
  # Authored as plain ESM JS (+ hand-written index.d.ts) so the leaf loads
  # unchanged across the Encore service boundary; see plan.md Decision 1.
  - unit: { kind: file, path: product/packages/carrier-gate/src/rules.js }
  - unit: { kind: file, path: product/packages/carrier-gate/src/fixture.js }
  - unit: { kind: file, path: product/packages/carrier-gate/src/index.js }
  - unit: { kind: file, path: product/packages/carrier-gate/src/index.d.ts }
  - unit: { kind: file, path: product/packages/carrier-gate/src/rules.test.ts }
  - unit: { kind: file, path: product/packages/carrier-gate/package.json }
  - unit: { kind: file, path: product/packages/carrier-gate/tsconfig.json }
  # FR-001 memory-surface write gate + its AC-1 shared-fixture parity test.
  - unit: { kind: file, path: product/packages/session-memory/src/gate.ts }
  - unit: { kind: file, path: product/packages/session-memory/src/gate.test.ts }
  # FR-002/003 provenance + trust-class schema test.
  - unit: { kind: file, path: product/packages/session-memory/src/provenance.test.ts }
  # FR-004 trust-weighted decay engine + the retention boundary / decay test.
  - unit: { kind: file, path: product/packages/session-memory/src/expiry/decay.ts }
  - unit: { kind: file, path: product/packages/session-memory/src/expiry/retention.test.ts }
  # FR-005/006 no-self-ingestion + segmentation / quarantine test.
  - unit: { kind: file, path: product/packages/session-memory/src/quarantine.test.ts }
extends:
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # FR-001: overrideGate.ts now imports the shared carrier rules rather than
  # carrying its own copies (promoted from an analog reference).
  - aspect: "shared-carrier-rules"
    unit: { kind: file, path: platform/services/statecraft/api/factory/overrideGate.ts }
  - aspect: "memory-write-gate"
    unit: { kind: file, path: product/packages/session-memory/src/server.ts }
  - aspect: "provenance-trust-columns"
    unit: { kind: file, path: product/packages/session-memory/src/storage/sqlite.ts }
  # FR-002/003: migration v2 (provenance + trust columns) and the memory_store
  # tool passthrough for actor kind / source attribution.
  - aspect: "provenance-trust-columns"
    unit: { kind: file, path: product/packages/session-memory/src/storage/migrations.ts }
  - aspect: "provenance-trust-columns"
    unit: { kind: file, path: product/packages/session-memory/src/tools/store.ts }
  # FR-002: the harvester stamps its own actor kind + source attribution.
  - aspect: "provenance-trust-columns"
    unit: { kind: file, path: product/packages/session-memory/src/harvesting/engine.ts }
  # FR-003 AC-3 retention boundary: promotion respects the human-gated tiers.
  - aspect: "retention-boundary"
    unit: { kind: file, path: product/packages/session-memory/src/expiry/promotion.ts }
  # The write-time clamp (machine-harvested cannot reach a human-gated tier)
  # updates the spec 056 storage/integration tests that stored high-importance
  # entries under the default agent actor: they now pass actorKind: human.
  - aspect: "retention-boundary"
    unit: { kind: file, path: product/packages/session-memory/src/storage/sqlite.test.ts }
  - aspect: "retention-boundary"
    unit: { kind: file, path: product/packages/session-memory/src/integration.test.ts }
  - aspect: "trust-class-types"
    unit: { kind: file, path: product/packages/session-memory/src/types.ts }
  # FR-001 wiring: session-memory depends on @opc/carrier-gate and re-exports
  # the write gate from its public surface.
  - aspect: "memory-write-gate"
    unit: { kind: file, path: product/packages/session-memory/src/index.ts }
  - aspect: "memory-write-gate"
    unit: { kind: file, path: product/packages/session-memory/package.json }
references:
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Session-Memory Write Contract

**Feature Branch**: `204-session-memory-write-contract`
**Created**: 2026-06-11
**Status**: Draft (follow-on filed by the ASI gap-closure pass)
**Input**: Spec 198 FR-013 specified the `user_body` write path as ASI06's
control point for the factory substrate, with the architectural rule "a
model may detect, only rules may block." The ASI 2026 gap analysis
(2026-06-10) identified the second persistent-memory surface — spec 056's
session-memory MCP — as carrying none of that contract.

## Purpose

ASI06 is distinctly about *persistence*: corruption that propagates across
sessions and alters reasoning long after the injection event. The factory
substrate got its write contract in spec 198. Session memory is the
remaining store that future sessions read as background truth, and it is
currently open: any content an agent harvests in a session — including
content originating from untrusted inputs the agent merely read — can be
stored, promoted by access-count alone, and surfaced to later sessions as
established context. That is the textbook bootstrap-poisoning loop (ASI06
m6) plus unbounded poison persistence (m8).

The contract mirrors FR-013's shape because the threat is the same and the
architecture is proven there; divergence between the two write contracts
would itself be a defect (one fact, one home — the gate logic's carrier
classes have one canonical definition).

## Functional requirements

> Implemented and approved. The refined, implementable form of each FR (the
> packaging decision, the trusted-boundary trust model, the decay refinement)
> lives in `plan.md`; the requirements below are the authoritative contract.

- **FR-001 — Deterministic write gate.** Every memory write (store and
  revise; harvested or explicit) passes a rule-only gate refusing the
  carrier classes the substrate gate names: zero-width/bidi characters,
  hidden-comment carriers, data URIs and encoded blobs, ANSI escapes, and
  secret shapes. Fail-closed with an attributable error. The carrier-class
  definitions are shared with, not copied from, `overrideGate.ts`
  (single canonical rule set; packaging decided in plan.md).
- **FR-002 — Provenance stamp.** Every entry revision records actor kind
  (human | agent | harvester), origin session id, source attribution when
  harvested, timestamp, and content hash — the spec 198 FR-013(b) stamp
  shape applied to memory rows.
- **FR-003 — Trust classes with human-gated promotion.** Entries carry a
  trust class: `machine-harvested` (default for anything an agent or the
  harvesting engine wrote), `human-curated` (written or edited by the
  human), `verified` (explicitly human-verified). Promotion to long-term
  or permanent retention requires `human-curated` or `verified`;
  access-count promotion (spec 056's 3+-access rule) may raise importance
  within machine-harvested tiers but can never cross into permanent. This
  is ASI06 m9's two-factor surfacing applied at the retention boundary.
- **FR-004 — Trust-weighted decay.** Unverified entries decay: low-trust
  entries that are not re-accessed are demoted and eventually expired on a
  schedule the org can tighten (m8 — expire unverified memory to bound
  poison persistence). Verified entries are exempt from decay but not from
  deletion.
- **FR-005 — No self-ingestion across trust boundaries.** Agent-generated
  output is always written `machine-harvested`; no automated path may
  re-classify it. An agent reading its own (or another agent's) harvested
  memory and re-storing a paraphrase cannot launder it to a higher trust
  class (m6).
- **FR-006 — Segmentation as contract.** Project-scoping (already the
  spec 056 posture) becomes normative: cross-project reads are refused at
  the storage layer, and origin-session segmentation is recorded so a
  poisoned session's writes are enumerable and bulk-revocable (quarantine
  support, m7).

## Acceptance criteria

- **AC-1.** A write containing a zero-width-character carrier is refused
  with an attributable error; the same fixture is refused by the substrate
  gate (shared rule set proven by a shared fixture).
- **AC-2.** Every stored entry exposes provenance fields and trust class
  via the MCP query surface.
- **AC-3.** A machine-harvested entry cannot reach permanent retention by
  any sequence of automated accesses; promotion past the boundary requires
  a human actor id.
- **AC-4.** An unaccessed machine-harvested entry is demoted/expired by
  the decay sweep within the configured horizon; a verified entry is not.
- **AC-5.** Entries from a named session can be enumerated and bulk
  quarantined; quarantined entries are excluded from reads pending human
  review.

## Out of scope

- Async model-assisted scanning of memory content — the spec 200 analog
  for this surface is future work once the scanner exists for the
  substrate; this spec is the deterministic leg only.
- The factory substrate write path (spec 198 FR-013 owns it; spec 200 owns
  its async scanner).
- RAG/embedding stores beyond session memory (the decomposition embedding
  cache is content-addressed and regenerable — spec 192; a poisoning
  contract for retrieval stores, if OAP grows one, is its own spec).
- Memory UI/presentation (consumes spec 201's presentation discipline
  where memory drives approvals).

## Sequencing

Independent of spec 198's runtime closure except for the shared
carrier-class rule set, which exists today in `overrideGate.ts`.
Implementable now; the shared-rules packaging question (npm/crate home)
is the first plan.md decision.

## Implementation

Delivered as a serialized PR sequence (see `plan.md` for the decomposition and
the packaging decision), all merged before this spec was approved:

- **FR-001** (AC-1): the shared `@opc/carrier-gate` package (the single
  canonical carrier / secret / UTF-8 rule set) with `overrideGate.ts` repointed
  onto it, and the session-memory write gate proven against the shared fixture.
- **FR-002 / FR-003** (AC-2): provenance columns (actor kind, origin session,
  source attribution, content hash) and trust classes stamped at the trusted
  storage boundary; the untrusted MCP tool sets none of them.
- **FR-003 boundary / FR-004** (AC-3, AC-4): machine-harvested writes are
  clamped below the human-gated tiers at both the write path and promotion, and
  trust-weighted decay demotes and expires the un-accessed machine-harvested
  tail; human-curated and verified entries are exempt.
- **FR-005 / FR-006** (AC-5): the trusted-boundary model gives no-self-ingestion;
  segmentation refuses cross-project reads, and a poisoned session's writes are
  enumerable and freeze under quarantine (excluded from reads and all lifecycle
  housekeeping) pending human review.

The cross-cutting principle held throughout: a model may detect, only rules may
block. The operator surface that drives quarantine (a cockpit review UI) is
future work; this spec delivers the storage-layer contract.
