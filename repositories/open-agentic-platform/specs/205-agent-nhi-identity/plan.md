# Implementation Plan: Per-Agent Non-Human Identity and Task-Scoped Credentials

**Branch**: `feat/205-agent-nhi-identity` | **Date**: 2026-06-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/205-agent-nhi-identity/spec.md`,
plus the 2026-06-11 Rauthy capability analysis against the local fork clone
(`bartekus/rauthy` @ `ff81b94d`, version `0.36.0-20260603`, verified
byte-identical to `sebadob/rauthy:main` — both OAP patches were merged
upstream as PRs #1597 and #1598).

## Summary

Spec 205 gives every interactive agent session a non-human identity (NHI)
distinct from the launching human: an `on_behalf_of` delegation chain,
intersection-scoped credentials, short TTLs, and bidirectional revocation.
The spec deferred one decision to this plan — **client-credentials vs
token-exchange**. This plan records that decision (client_credentials over
per-session RFC 7591 dynamic clients; RFC 8693 rejected) and the
architecture it implies: a **two-token model** composing Rauthy-issued
identity with platform-signed capability grants generalized from the
spec 198 FR-005 run-grant fabric.

## Flow decision (the question spec.md delegates here)

**Decision.** NHIs are per-agent-session **dynamic clients** (RFC 7591)
registered by statecraft against Rauthy, authenticating via
**client_credentials**, with `CLIENT_CREDENTIALS_MAP_SUB=true` so the access
token's `sub` is the distinct NHI subject (`dyn$<id>`). RFC 8693 token
exchange is **rejected**.

Evidence (verified 2026-06-11):

- Rauthy `main` (0.36.0-20260603) contains **no RFC 8693 implementation**
  (no token-exchange grant anywhere under `src/`); choosing it would mean
  implementing the grant upstream first — the heaviest possible path.
- Spec 106 §11 already rejected RFC 8693 for the human flow; nothing in the
  agent flow changes that calculus.
- Dynamic clients ship today with the lifecycle levers FR-001 needs:
  registration gated by `DYN_CLIENT_REG_TOKEN`, Rauthy-side scope
  ceiling via `DYN_CLIENT_ALLOWED_SCOPES`, short token TTL via
  `DYN_CLIENT_DEFAULT_TOKEN_LIFETIME` (`VarsDynamicClients`, rauthy
  `src/data/src/rauthy_config.rs:3483`). Three levers verified
  (2026-06-12) to behave differently than their names suggest in OAP's
  reg-token mode: the **inactive-client cleanup scheduler exits when
  `DYN_CLIENT_REG_TOKEN` is set** (`src/schedulers/src/dyn_clients.rs:24-27`
  — orphan cleanup is therefore statecraft's job, tasks.md T010);
  registration **rate limiting only guards the token-less mode**
  (`src/api/src/clients.rs:179-193`); and
  `DYN_CLIENT_SECRET_AUTO_ROTATE` rotates the **RFC 7592 registration
  token**, not the `client_secret` — the `client_secret` regenerates on
  every `PUT /clients_dyn/{id}` update, which is how rotation-on-renewal
  is actually achieved.

## Two-token model

| Leg | Issuer | Carries | Answers |
|---|---|---|---|
| **Identity** (NHI access token) | Rauthy — dyn client, client_credentials | `sub = dyn$<id>`, scopes = intersection(human scopes, profile ceiling), short `exp`, DPoP-bindable | *who is acting* |
| **Capability** (session grant) | Platform — statecraft JWS, generalizing spec 198 FR-005 run-grants | `on_behalf_of` chain, `agent_profile`, purpose / intent-capsule binding, audience, stage-renewal cadence | *what for, on whose behalf* |

Constitutional coherence: spec 106's "Rauthy is the sole **session**
signer" is preserved — grants are not sessions, and spec 198 phase 4
already established the platform signing domain for grants. This plan
records that explicitly so the two-token model never reads as drift.

**Run-grant relationship** (spec.md Out-of-scope asks this plan to decide):
**remain parallel.** Factory run-grants stay exactly as landed under
spec 198; session grants reuse the signing machinery without migrating
run-grants. Convergence is a candidate post-205 refactor, not part of this
unit.

## FR mapping

| FR | Mechanism |
|---|---|
| FR-001 issuance/lifecycle | Dyn client registered at session start (statecraft holds `DYN_CLIENT_REG_TOKEN`), `client_secret` regenerated via RFC 7592 `PUT` update at renewal cadence, client deleted at session end / on demand (admin path — see Known gaps) |
| FR-002 delegation, intersection | Statecraft computes intersection(human scopes, profile ceiling) at mint, assigns exactly those scopes to the dyn client; `DYN_CLIENT_ALLOWED_SCOPES` is the Rauthy-side defense-in-depth ceiling; `on_behalf_of` carried in the session grant |
| FR-003 task-scoped short-TTL | `DYN_CLIENT_DEFAULT_TOKEN_LIFETIME` at grant-renewal cadence; purpose + intent-capsule binding and audience carried in the session grant (Rauthy-side audience binding strengthens when RFC 8707 lands upstream — see upstream track) |
| FR-004 bidirectional revocation | Agent kill = delete dyn client (TTL bounds residual tokens, per AC-5); human logout = walk the delegation index, delete all chained clients; index lives in statecraft DB and is what spec 208 consumes |
| FR-005 audit attribution | Two-principal audit rows (`nhi_sub` + `on_behalf_of`) in statecraft; lands first — no Rauthy dependency |

## Technical Context

**Language/Version**: TypeScript (Encore.ts statecraft, npm); Rust only on the upstream-patch track
**Primary Dependencies**: Rauthy ≥ 0.36 (unreleased as of 2026-06-11 — see prerequisites), existing statecraft JWS signing machinery (spec 198 phase 4), Rauthy admin API via `API-Key` auth
**Storage**: statecraft Postgres — delegation/revocation index table + audit columns (new migration)
**Testing**: statecraft service tests; AC-1..AC-5 as integration tests against a live Rauthy (encore test)
**Target Platform**: platform services (K8s); OPC consumes a display surface only (keyless posture unchanged)
**Project Type**: web-service (platform control plane)
**Performance Goals**: NHI mint path sub-second; NHI token validation adds exactly one indexed liveness lookup (delegation index, revocation check) per call — signature verification itself adds no round trip (JWKS already cached)
**Constraints**: no long-lived secrets in OPC; revocation TOCTOU bounded by token TTL (AC-5); `DYN_CLIENT_REG_TOKEN` custody is statecraft-only
**Scale/Scope**: one NHI per live agent session; O(10–100) concurrent per org

### Deployment prerequisites (hard blockers, recorded 2026-06-11)

1. **Chart pin.** `platform/charts/rauthy/values.yaml` pins
   `ghcr.io/sebadob/rauthy:0.35.0`. Everything this plan relies on beyond
   the basics — PAM API, `claims_at_root` (#1597), `AuthProviders` API-key
   auth (#1598) — exists only on unreleased `main` (latest upstream tag
   v0.35.2, 2026-05-19). Options: wait for the 0.36 release, or publish an
   image from `bartekus/rauthy` main (currently identical to upstream
   main); the fork doubles as a release-cadence hedge.
2. **`ENABLE_DYN_CLIENT_REG`** must be enabled with `DYN_CLIENT_REG_TOKEN`
   held exclusively by statecraft — never OPC, never agents.
3. **`CLIENT_CREDENTIALS_MAP_SUB=true`** so NHI tokens carry `sub`.

### Known gaps and their carriers

- **No custom claims on client_credentials tokens** — Rauthy's
  attribute→claim pipeline is user-bound (`UserAttrValueEntity`), so the
  NHI's Rauthy token cannot natively carry `agent_profile`/`on_behalf_of`.
  Carrier: the session grant. Upstream candidate patch (below) removes the
  gap later without changing this plan's shape.
- **No RFC 8707 resource indicators** — Rauthy-side audience binding is
  coarse (`aud` = client). Carrier: the session grant's audience claim.
  Maintainer pre-blessed RFC 8707 in sebadob/rauthy#1562.
- **No `DELETE /auth/v1/clients_dyn/{id}`** — Rauthy exposes only
  POST/GET/PUT on the dyn-client surface (`src/api/src/server.rs:553-555`);
  deletion goes through the admin `DELETE /clients/{id}` (`API-Key`
  auth). The "registration token only" custody rule is therefore scoped
  to register/rotate; revocation-by-deletion necessarily uses the admin
  path. Upstream candidate patch (below) restores the symmetry later.
- **Purpose binding stops at statecraft** — deployd-api-rs validates
  signature, expiry, audience, and scope only (`src/auth.rs`); it never
  sees session grants, so FR-003's intent binding is enforced at
  statecraft PEPs while deployd-api holds the coarser scope+TTL line.
  Extending grant verification to deployd-api is post-205 candidate
  work, not part of this unit.
- **OS-attribution leg** (rauthy-pam-nss; per-agent POSIX uid via
  PamUser + NSS `getent` on sandbox hosts) — explicitly out of this plan.
  It requires per-profile service-account Users (PamUser links to a Rauthy
  User by email; dyn clients are not Users) and belongs to a future
  extension of specs 162/185/186.

## Constitution Check

- **Principle I/II** — this plan is markdown; no compiler-owned JSON is
  touched (`plan.md` is not a codebase-indexer input).
- **Principle III** — implementation is justified by spec 205 (draft,
  filed 2026-06-11); the relationship graph is already declared in the
  spec frontmatter (`refines:` sessionMint.ts / rauthy.ts, `extends:` the
  featuregraph golden).
- **CONST-005** — no spec edit is required to make any gate pass; this
  plan resolves a decision spec.md explicitly delegated to it.

**Gate: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/205-agent-nhi-identity/
├── spec.md              # Feature specification (draft)
├── plan.md              # This file
└── tasks.md             # Task breakdown (created 2026-06-12)
```

### Source Code (repository root)

```text
platform/services/statecraft/api/auth/
├── sessionMint.ts          # extend: mintAgentNhi() — refines: agent-nhi-minting
├── rauthy.ts               # extend: dyn-client admin calls (register/rotate/delete) — refines: nhi-lifecycle
├── m2mAuth.ts              # precedent: client_credentials validation; add validateNhiJwt alongside
└── rauthyAdminClients.ts   # precedent only (spec 137 programmatic client provisioning) — no edits expected

platform/services/statecraft/api/factory/grantDuplexHandlers.ts
                            # run-grant machinery remains parallel (no run-grant
                            # changes); Phase 0 threads the two-principal audit
                            # fields through its audit write sites only

platform/services/statecraft/migrations/
                            # new: delegation/revocation index table + audit columns

product/apps/opc/src-tauri/src/commands/live_sessions.rs
                            # display NHI subject in session introspection (spec 172 surface)

crates/featuregraph/tests/golden/features_graph.json
                            # +1 row (extends: 034)
```

**Structure Decision**: all behavior lands in statecraft (the platform
control plane). deployd-api-rs is unchanged — its scope gate consumes
intersection-scoped tokens transparently. OPC changes are display-only,
preserving the keyless posture.

## Phases

- **Phase 0 — audit attribution (FR-005).** Two-principal audit rows.
  Lands first; only adds fields; no Rauthy version dependency.
- **Phase 1 — identity leg (FR-001, FR-002).** Dyn-client mint / rotate /
  delete through the rauthy.ts admin path; delegation index migration;
  intersection computation at mint. Depends on deployment prerequisites
  1–3.
- **Phase 2 — capability leg (FR-003).** Session-grant JWS (generalize the
  spec 198 signing machinery), intent-capsule binding, renewal at stage
  boundaries.
- **Phase 3 — revocation (FR-004) + spec 208 handoff.** Bidirectional
  revocation walking the index; the org kill switch consumes it.

AC coverage: AC-1/AC-4 → Phases 0–1; AC-2 → Phase 1; AC-5 spans phases
(mint-time leg → Phase 1, TOCTOU/renewal leg → Phase 2, residual-TTL
bound → Phase 3 — the closure sweep, not Phase 1, is AC-5's completion
point); AC-3 → Phase 3.

## Upstream coordination track (recorded 2026-06-11; non-blocking)

The fork (`bartekus/rauthy`) carries zero out-of-tree delta — both prior
OAP patches were merged upstream within days (#1597 `claims_at_root`,
#1598 `AuthProviders` API-key auth). That acceptance record makes the
upstream-first path the default for the remaining gaps.

| Item | Where | Status 2026-06-11 | OAP interest |
|---|---|---|---|
| `claims_at_root` per scope | rauthy #1597 | merged on main, unreleased | top-level `oap_*` claims |
| API-key auth for provider endpoints | rauthy #1598 | merged on main, unreleased | headless provider management |
| Bootstrap generated-secret extraction | rauthy #1599 (@caniko) | open, in active review | headless provisioning without long-lived secrets |
| RFC 8707 resource indicators | rauthy #1562 | maintainer-blessed, unimplemented | IdP-side audience binding for FR-003 |
| client_credentials custom claims | to file | candidate patch (symmetric to #1597) | `agent_profile`/`on_behalf_of` in the NHI token itself |
| `DELETE /clients_dyn/{id}` lifecycle parity | to file | candidate patch | dyn-client deletion without crossing into the `API-Key` admin path |
| PAM `home_dir` consumer | rauthy-pam-nss #15 | maintainer draft PR | sandbox-host posture (future OS-attribution leg) |

## Complexity Tracking

No constitution violations to justify — table intentionally empty.
