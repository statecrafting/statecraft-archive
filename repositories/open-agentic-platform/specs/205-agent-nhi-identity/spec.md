---
id: "205-agent-nhi-identity"
title: "Per-Agent Non-Human Identity and Task-Scoped Credentials (ASI03)"
feature_branch: "feat/205-agent-nhi-identity"
status: draft
implementation: pending
kind: platform
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Give agents a governed identity distinct from the human who launched
  them. Today every agent session rides the user's Rauthy JWT: agent
  actions audit to the human, agent access cannot be revoked without
  killing the human's session, and least privilege per agent is
  structurally impossible — the exact "attribution gap" ASI03 names as
  the root cause of identity and privilege abuse. Factory runs already
  have the right fabric in miniature: spec 198 FR-005 run-grants are
  short-lived, audience-bound, stage-renewed credentials. This spec
  extends that fabric to interactive agent sessions: a per-agent-session
  non-human identity (NHI) minted through the platform, a recorded
  on-behalf-of delegation chain whose effective scope is the
  intersection of the human's scopes and the agent's admitted profile
  (never inheritance, ASI03 m7), task-scoped short-TTL tokens, and
  revocation that is independent in both directions.
code_aliases: ["AGENT_NHI_IDENTITY"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI03", "ASI10"]
depends_on:
  - "106-rauthy-native-oidc-and-membership"
  - "137-tenant-environment-access-gates"
  - "198-factory-governance-envelope"
establishes:
  # Phase 0 (FR-005): the two-principal audit migration and its forensic
  # query test are brought into existence by this spec.
  - unit: { kind: file, path: platform/services/statecraft/api/audit/auditTwoPrincipal.test.ts }
extends:
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "agent-nhi-minting"
    unit: { kind: file, path: platform/services/statecraft/api/auth/sessionMint.ts }
  - aspect: "nhi-lifecycle"
    unit: { kind: file, path: platform/services/statecraft/api/auth/rauthy.ts }
  # Phase 0 (FR-005) audit-attribution: the two-principal columns on
  # audit_log and the agent-context write sites threaded to carry them.
  # grantDuplexHandlers.ts graduates from analog reference to a refined
  # path now that Phase 0 edits its audit write sites.
  - aspect: "audit-attribution"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - aspect: "audit-attribution"
    unit: { kind: file, path: platform/services/statecraft/api/audit/audit.ts }
  - aspect: "audit-attribution"
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - aspect: "audit-attribution"
    unit: { kind: file, path: platform/services/statecraft/api/factory/grantDuplexHandlers.ts }
  - aspect: "audit-attribution"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
references:
  - role: context
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/live_sessions.rs }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Per-Agent Non-Human Identity and Task-Scoped Credentials

**Feature Branch**: `205-agent-nhi-identity`
**Created**: 2026-06-11
**Status**: Draft (follow-on filed by the ASI gap-closure pass)
**Input**: The ASI 2026 gap analysis (2026-06-10) found: "interactive
agent sessions operate entirely under the human's Rauthy JWT, so agent
actions are attributable only to the user and can't be revoked
independently." Spec 198's all-ten table marks ASI03 solid *at admission*
(scope ceilings, run-grants) while noting token/PAT handling "stays a
watched surface" — this spec is the watched surface's owner.

## Purpose

ASI03's stated root cause is architectural: user-centric identity systems
mismatched to agentic design leave the agent in an attribution gap where
true least privilege is impossible. OAP exhibits the mismatch precisely:

- **Attribution.** Audit rows say *who was logged in*, not *which agent
  acted*. Forensics on a misbehaving agent reconstructs identity from
  side channels (session ids in logs) rather than reading it.
- **Revocation.** Disabling one agent means revoking the human's session
  — the user-level kill is the only kill (the spec 208 org switch needs
  per-agent credentials to be precise).
- **Least privilege.** An agent profile cannot be granted *less* than its
  human because there is no principal to attach the lesser grant to.

The run-grant fabric (spec 198 FR-005: audience-bound, short-lived,
renewed at stage boundaries, platform-minted with OPC keyless) is the
proven shape. This spec generalizes it from "a factory run" to "an agent
session" as the credentialed unit.

## Functional requirements (sketch — refine before implementation)

- **FR-001 — NHI issuance per agent session.** Starting an agent session
  mints a non-human identity through the platform (Rauthy-anchored;
  client-credentials or token-exchange flow decided in plan.md) with a
  distinct subject, an `agent_profile` claim, and a governed lifecycle:
  created at session start, rotated on renewal, revoked at session end or
  on demand (ASI03 m6 — agents as governed NHIs in the IAM platform).
- **FR-002 — Delegation chain, not inheritance.** The NHI token carries
  an `on_behalf_of` chain naming the human principal. Effective scope is
  computed as the intersection of the human's scopes and the agent
  profile's admitted ceiling — never the union, never the human's scopes
  by default (m1 permission boundaries; m7 no privilege inheritance
  without re-validation). Statecraft authorizes against the effective
  scope, and the certificate/audit layer records both principals.
- **FR-003 — Task-scoped, short-TTL tokens.** NHI tokens are
  audience-bound and purpose-bound per task with TTLs at the
  grant-renewal cadence (m1, m5 intent-bound tokens); composition with
  the intent capsule (198 FR-005) binds token purpose to the declared
  goal, so a token presented outside its bound intent is refused.
- **FR-004 — Independent, bidirectional revocation.** Revoking an agent
  NHI invalidates that agent's calls at next request without touching
  the human session; ending the human session revokes all NHIs minted
  under it (the delegation chain is the revocation index). This is the
  per-agent key the org kill switch (spec 208) turns.
- **FR-005 — Audit attribution.** Every audit row generated from an
  agent context carries the NHI subject and the on-behalf-of human;
  introspection surfaces (172) display the NHI identity, replacing
  inferred attribution.

## Acceptance criteria (sketch)

- **AC-1.** An agent session's platform calls present a subject distinct
  from the human's; the human's parallel calls are unaffected.
- **AC-2.** Granting an agent profile a narrower ceiling than its human
  results in refusals for the agent on the out-of-ceiling scope while the
  human retains access (intersection proven both ways).
- **AC-3.** Revoking the NHI mid-session: the agent's next platform call
  is refused with an attributable error; the human session survives; the
  reverse direction (human logout) revokes the NHI.
- **AC-4.** Audit rows for agent actions carry both principals; a
  forensic query "everything agent X did" needs no log archaeology.
- **AC-5.** No code path mints an NHI whose effective scope exceeds the
  delegating human's scopes at mint time; scope re-validation occurs at
  renewal (TOCTOU window bounded by TTL).

## Out of scope

- The org-wide kill switch (spec 208 consumes FR-004's revocation index).
- Run-grants for factory runs (spec 198 FR-005 owns them; this spec
  aligns with, and must not fork, that fabric — plan.md decides whether
  run-grants become a special case of session NHIs or remain parallel).
- Cross-org agent federation and A2A identity (no such surface exists in
  OAP today).
- Human identity, membership resolution, and tenant gates (specs 106/137).

## Sequencing

Requires spec 198 phase 4's signing/grant machinery (landed) as the
analog and spec 137's access-gate phases for the scope vocabulary.
Implementable after spec 198 reaches `implementation: complete`; the
audit-attribution leg (FR-005) can land first since it only adds fields.
