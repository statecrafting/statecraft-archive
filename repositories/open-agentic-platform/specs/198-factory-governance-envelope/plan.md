# Implementation Plan: Factory Governance Envelope — Phases 4–5 (Seal, Grants, Override Gate)

**Branch**: `feat/198-seal-grants` (PR-A), then `feat/198-override-gate` (PR-B)
**Date**: 2026-06-09 | **Spec**: [spec.md](spec.md)
**Input**: spec 198 FR-005 / FR-013 / FR-014; design record
`docs/analysis/governance-envelope-unification.md` (D-2 override tiers, D-4
signing model); seam map from the 2026-06-09 phase-4 exploration.

## Summary

Phases 1–3 landed in PR #313 (envelope schema + Rust twin, two-sided
fail-closed admission gate, revocations with serve/bind checks,
adapter-scopes derivation) and PR #314 (client regen). This plan covers the
remainder the spec requires before 198 may be declared complete:

- **FR-014** signing authority: platform-held Ed25519 keys, JWKS endpoint,
  admission seal over the composed envelope record.
- **FR-005** run-grants (the signed intent capsule) issued and renewed over
  the authenticated duplex channel at every stage boundary, revocation-checked
  at issuance and renewal (closes the grant-renewal leg of AC-8).
- **Emission countersign** + `verify-certificate` seal verification (AC-4):
  certificate proves the offline artifact chain AND the platform seal;
  never-reconnected certificates verify as visibly unsealed.
- **FR-013 a–c**: `user_body` deterministic write gate, provenance stamping,
  verified-flag trust class + `overrides.require_verified` enforcement (AC-11).
- **Closure**: AC-6 compliance wiring (inline ASI tags ↔ `compliance-report`),
  AC-7 follow-on spec stubs (ASI06 async scanner, ASI09 anti-blind-approval).

## Technical context

**Languages**: TypeScript (Encore.ts statecraft, npm not pnpm), Rust
(`crates/factory-engine`, OPC `src-tauri`).
**Wire**: statecraft duplex (`api/sync/types.ts` flat wire union ↔
`product/apps/opc/src-tauri/src/commands/sync_client.rs`), governed by the
schema-parity walker (specs 125/191) and duplex envelope version parity
(spec 189).
**Storage**: statecraft Postgres via drizzle (next migrations: 44+).
**Crypto**: `node:crypto` platform-side (precedent: `api/github/appJwt.ts`
RS256 — no `jose` dependency today, keep it that way); `ed25519-dalek`
engine-side (must stay `cargo-deny` green, spec 116).

### Plan decisions

- **PD-1 Signature scheme.** Ed25519 (EdDSA) for all three signature classes
  (admission seal, run-grant, countersign). Grants and countersigns are
  compact JWS (`{alg: "EdDSA", kid}` header); JWKS publishes
  `{kty: "OKP", crv: "Ed25519"}` keys.
- **PD-2 Key custody.** Encore secrets `FACTORY_SIGNING_PRIVATE_KEY` (PKCS#8
  PEM) + `FACTORY_SIGNING_KID`. Public keys served at
  `GET /api/factory/.well-known/jwks.json` — public, unauthenticated,
  cache-friendly; the keyset may carry the previous key during `kid`
  rotation. HSM/KMS custody is the deployment-profile obligation FR-014
  documents with the schema, not a contract field.
- **PD-3 Grant shape.** Claims
  `{iss, aud: "oap-opc-run", org, project, run_id, goal_id, capsule_hash,
  envelope_hash, build_spec_hash, seq, iat, exp}`; TTL default 30 min
  (config). Every issued/renewed grant is persisted in `factory_run_grants`
  (migration 44) — the issued sequence is what the countersign later
  reconciles against, and the audit trail for ASI01 m7 goal-shift surfacing.
- **PD-4 Countersign flow.** The engine emits the certificate locally,
  unsealed (certificate version 1.3.0 → 1.4.0: optional
  `platform_countersign` + `admitted_envelope_hash` fields, both excluded
  from the certificate's self-hash so sealing never invalidates the offline
  chain). `factory.run.completed` is augmented with `certificate_sha256` +
  final grant `seq`; statecraft verifies the grant chain it issued
  (`factory_run_grants` rows for the run match count + capsule/envelope
  hashes), countersigns `{certificate_sha256, run_id, grant_chain_hash,
  kid}`, persists on `factory_runs`, replies with a new targeted
  `factory.run.certificate_countersign` server envelope; the OPC engine
  patches the persisted `governance-certificate.json`. `verify-certificate`
  verifies the seal offline (`--platform-jwks <file>`) or online
  (`--jwks-url`); a missing countersign prints *verifiable-but-unsealed*
  and stays exit 0 unless `--require-sealed`.
- **PD-5 Admission seal.** At admission write, statecraft signs the canonical
  composed record; `{kid, signature, sealed_at}` is stored on
  `factory_admissions` and served with the OPC bundle's admission block. The
  engine verifies the seal against JWKS before trusting factory content
  (ASI04 m1), fail-closed. Pre-phase-4 admission rows are unsealed and
  therefore refused engine-side once this lands — acceptable: a re-sync
  re-admits with a seal (no backward compat, per operator decision).
- **PD-6 Override gate rules (FR-013 a).** Deterministic, synchronous,
  fail-closed, in a new `overrideGate.ts`: UTF-8 validity; size ceiling
  (256 KB default); kind stability (an override may not change the row's
  classification); carrier refusal for zero-width/bidi control characters,
  HTML comments, data-URIs, encoded blobs (base64 runs > 2 KB), ANSI
  escapes (ASI01 m6); secrets scan (CONST-002 class: PEM blocks, cloud/VCS
  token shapes, JWT-like strings). Refusal is an attributable 400 naming the
  rule id; audited as `artifact.override_gate_rejected`.
- **PD-7 Verified flag (FR-013 c).** `user_body_verified` +
  `verified_by`/`verified_at` on the substrate row; any new override revision
  resets to unverified; privileged
  `POST /api/factory/artifacts/:id/verify-override`. Serve path refuses
  unverified override content fail-closed when the org's admitted envelope
  declares `overrides.require_verified: true`. Consumed overrides (artifact
  id, content hash, author, verified state) ride the bundle and are bound
  into the run's certificate (the 1.4.0 bump in PD-4 carries the field).
- **PD-8 Behavioral-manifest run-time refusal (AC-5).** Verify current state
  first: PR #313 enforced admission at serve/bind, but the engine-side
  refusal of an off-list agent may not exist yet. If absent, the grant
  acquisition path adds it — the engine refuses any stage agent not present
  in the admitted envelope's constituent set.

## Constitution check

- **Principle I** — no new standalone authored YAML; grants, seals, and
  countersigns are runtime machine JSON.
- **Principle II** — `adapter-scopes.json` stays a derived projection; no
  hand-edited JSON in compiler/admission output paths.
- **Principle III** — this plan implements FRs as written. If implementation
  reveals spec imprecision, amend the spec first, then implement (never
  backfill the spec to match code).
- **CONST-002** — private keys enter only via Encore secrets; tests generate
  throwaway keypairs.

## Project structure (files touched)

```text
PR-A (seal + grants + countersign)
platform/services/statecraft/api/factory/
├── signing.ts                      # NEW — key load, sign/verify, JWK export
├── jwks.ts                         # NEW — /api/factory/.well-known/jwks.json
├── grantDuplexHandlers.ts          # NEW — grant_request / grant_renew
├── admission.ts                    # MOD — seal at admission write
├── runDuplexHandlers.ts            # MOD — countersign on run.completed
├── revocations.ts                  # MOD — consult at grant issue/renew
platform/services/statecraft/api/sync/
├── types.ts                        # MOD — new client/server envelope kinds
├── service.ts                      # MOD — dispatch new kinds
platform/services/statecraft/api/db/
├── migrations/44_factory_run_grants.{up,down}.sql   # NEW
├── schema.ts                       # MOD — factoryRunGrants table
product/apps/opc/src-tauri/src/commands/sync_client.rs  # MOD — frames + kinds
crates/factory-engine/src/
├── statecraft_client.rs            # MOD — grant request/renew, countersign rx
├── governance_certificate.rs       # MOD — 1.4.0 fields + verify step
├── bin/verify_certificate.rs       # MOD — --platform-jwks / --jwks-url /
│                                   #       --require-sealed
Makefile                            # MOD — verify-certificate target args

PR-B (override gate + closure)
platform/services/statecraft/api/factory/
├── overrideGate.ts                 # NEW — FR-013(a) deterministic rules
├── artifacts.ts                    # MOD — gate + provenance + verify endpoint
platform/services/statecraft/api/db/migrations/45_user_body_verified.*  # NEW
specs/198-factory-governance-envelope/spec.md   # MOD — compliance: block,
│                                   # establishes: for new files, ASI table refresh
specs/200-substrate-override-async-scanner/     # NEW — draft stub (ASI06, FR-013 d)
specs/201-anti-blind-approval-ui/               # NEW — draft stub (ASI09)
```

Both PRs: regenerate encore client (`npm run gen`), codebase index,
featuregraph golden (`UPDATE_GOLDEN=1`); `make pr-prep` after the LAST
commit; `make ci` for the Rust legs (pr-prep alone misses clippy).

## PR sequencing

- **PR-A** is one coherent trust-fabric change (signing → grants →
  countersign); splitting it across the wire boundary would leave
  non-functional intermediate states.
- **PR-B** is independently shippable behind PR-A (migration numbering and
  the certificate-binding field land in A).

## Verification (done-when)

| AC | Where satisfied |
|---|---|
| AC-4 (capsule + envelope bound into cert; countersign verified; unsealed visible) | PR-A phases B–C |
| AC-5 (allowlist refusal; OPC keyless) | PR-A phase B + PD-8 |
| AC-6 (inline tags ↔ compliance-report agree) | PR-B phase F |
| AC-7 (follow-ons recorded with owners) | PR-B phase F |
| AC-8 (revocation at grant renewal — final leg) | PR-A phase B |
| AC-11 (gate + provenance + require_verified refusal) | PR-B phases D–E |

End-to-end runtime verification (first real ADMIT → sealed grant chain →
countersigned certificate) additionally requires the Statecraft-side
`chore/envelope-schema-1.0.0-v2` merge + org re-sync — user-side
preconditions tracked outside this plan. Until then the admission gate
correctly REFUSES, and all new paths are covered by handler/engine tests.
