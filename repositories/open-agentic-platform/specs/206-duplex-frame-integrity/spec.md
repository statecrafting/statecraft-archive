---
id: "206-duplex-frame-integrity"
title: "Duplex Frame Integrity and Anti-Replay (ASI07)"
feature_branch: "feat/206-duplex-frame-integrity"
status: draft
implementation: pending
kind: platform
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Harden the OPC↔statecraft duplex channel from version-parity to message
  integrity. Spec 189 guarantees both ends speak the same envelope schema
  version; transport security is TLS plus bearer auth at handshake.
  Within an authenticated stream nothing binds individual frames: no
  per-frame integrity check, no replay protection, no refusal of
  unauthenticated frames after negotiation (ASI07 m2/m3/m4). This spec
  adds a keyed per-frame MAC over payload plus envelope context, an
  anti-replay window built on the envelope's existing eventId/sequence
  metadata bound to task windows, and fail-closed downgrade refusal —
  riding a schema-version bump so spec 189's strict equality remains the
  single negotiation gate. Session MAC keys are ephemeral and
  platform-minted at handshake, rotated on grant renewal; this preserves
  the spec 198 FR-014 posture (OPC holds no long-lived signing keys —
  an ephemeral channel MAC key is not a signing authority).
code_aliases: ["DUPLEX_FRAME_INTEGRITY"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI07"]
depends_on:
  - "189-duplex-envelope-version-parity"
  - "198-factory-governance-envelope"
  - "191-schema-parity-ci-job"
extends:
  - spec: "189-duplex-envelope-version-parity"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "frame-integrity"
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - aspect: "frame-integrity"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
references:
  - role: machinery
    unit: { kind: file, path: platform/services/statecraft/api/factory/signing.ts }
  - role: gate-declaration
    unit: { kind: file, path: tools/oap/schema-parity-check/envelope-version.mjs }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Duplex Frame Integrity and Anti-Replay

**Feature Branch**: `206-duplex-frame-integrity`
**Created**: 2026-06-11
**Status**: Draft (follow-on filed by the ASI gap-closure pass)
**Input**: The ASI 2026 gap analysis (2026-06-10) found: "OPC↔statecraft
duplex has version parity + bearer auth but no frame integrity or
anti-replay." Spec 198's all-ten table rates ASI07 solid on the strength
of signed inter-stage manifests (170) and version parity (189) — both
true, but the inter-*process* channel between the untrusted executor and
the platform is the surface those two levers do not cover.

## Purpose

ASI07 is compromise of real-time messages in flight. The duplex channel
carries exactly the traffic an attacker would want to tamper with or
replay: run lifecycle events, grant issuance and renewal
(`grantDuplexHandlers`), session registration, factory triggers. The
trust analysis is asymmetric and worth stating:

- **Transport.** TLS protects the pipe between endpoints. It does not
  protect against a compromised intermediary terminating TLS, nor does it
  bind frames to the negotiated session semantics.
- **Authentication.** The bearer token authenticates the *handshake*.
  Frames arriving later on the stream inherit that trust wholesale; a
  frame injected into the stream context is indistinguishable from a
  legitimate one.
- **Replay.** `eventId`/`correlationId` support ordering and dedup as
  bookkeeping, not as enforced anti-replay: nothing *refuses* a replayed
  grant-renewal or a re-emitted lifecycle event (m3 — stale delegation
  honored is the canonical ASI07 replay failure).

## Functional requirements (sketch — refine before implementation)

- **FR-001 — Keyed per-frame MAC.** Every frame carries a MAC computed
  over the payload and the envelope context (schema version, eventId,
  sequence, session id) so a frame cannot be lifted into another context
  even with the key (m2 — hash payload *and* context). Algorithm and
  field shape decided in plan.md; the field rides the envelope meta and
  is covered by the schema-parity walker (125/191) so the Rust and TS
  shapes cannot drift.
- **FR-002 — Anti-replay window.** Receivers enforce sequence
  monotonicity per channel plus an eventId nonce window bound to the task
  window (grant TTL), refusing duplicates and out-of-window frames with
  an attributable error (m3 — nonces, session identifiers, timestamps
  bound to task windows).
- **FR-003 — Negotiated, fail-closed; no downgrade.** Frame integrity
  arrives as an `ENVELOPE_SCHEMA_VERSION` bump. Spec 189's strict
  equality already refuses mixed versions; within the new version,
  an unauthenticated frame after handshake is refused — there is no
  "MAC optional" mode and no silent fallback (m4/m6 — disable legacy
  modes, reject downgrades).
- **FR-004 — Ephemeral key lifecycle.** The session MAC key is minted by
  statecraft at handshake (the signing authority side of spec 198 FR-014
  is the natural home), delivered over the authenticated TLS handshake,
  and rotated at grant renewal. Keys are never persisted on the OPC side
  and never reused across sessions. A key is a channel-integrity secret,
  not a signing authority — OPC remains keyless in the FR-014 sense.
- **FR-005 — Integrity-failure audit.** Refused frames (bad MAC, replay,
  downgrade attempt) are recorded with reason, channel, and counts;
  repeated integrity failures on a channel surface in introspection
  (172) as an anomaly, not just a log line.

## Acceptance criteria (sketch)

- **AC-1.** A frame with a flipped payload byte is refused; a frame with
  a valid MAC but transplanted context (same payload, different session)
  is refused.
- **AC-2.** Re-sending a captured grant-renewal frame is refused as a
  replay; the original renewal is unaffected.
- **AC-3.** Post-handshake, a frame without integrity fields is refused;
  there is no configuration that accepts it (negative grep + test
  posture, the spec 200 AC-3 pattern).
- **AC-4.** Cross-language fixtures prove MAC computation parity (the
  envelope-version tripwire extends to MAC field shapes); `make ci`
  schema-parity stays green.
- **AC-5.** Key rotation at a stage boundary: frames MAC'd with the
  retired key are refused after the rotation grace window.

## Out of scope

- Inter-stage manifest signing within a run (spec 170 owns it).
- Schema version parity mechanics (spec 189 owns the equality gate; this
  spec rides it).
- mTLS / client certificates for the desktop — a deployment-profile
  question (the desktop is end-user software; per-frame MACs are chosen
  precisely because client cert distribution is not assumed).
- Metadata-inference resistance (padding, timing smoothing — ASI07 m5)
  — documented residual; revisit if threat model elevates.

## Sequencing

After spec 198 phase 4 (the handshake already mints grants; key minting
rides the same surface) and coordinated with spec 189's version-bump
discipline. The schema-parity fixture work (AC-4) lands with the field
definition, not after it.
