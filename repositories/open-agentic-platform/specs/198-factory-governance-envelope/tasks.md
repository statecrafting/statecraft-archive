# Tasks: Factory Governance Envelope — Phases 4–5

**Input**: [plan.md](plan.md) (PD-1..PD-8), [spec.md](spec.md) FR-005/013/014
**Format**: `[ID] [P?] Description` — [P] = parallelizable (different files,
no dependency). Phases A–C = PR-A (`feat/198-seal-grants`); D–F = PR-B
(`feat/198-override-gate`).

> **PR-A status (2026-06-09): phases A–C COMPLETE** (T001–T016). Recorded
> deviations from the original task sketches:
> - **T006**: one `factory.run.grant` server variant with `granted: bool` +
>   `refusedReason`, instead of a separate `grant_refused` kind (smaller
>   wire union, same attributability).
> - **T010 (PD-8 verification outcome)**: a separate engine-side
>   per-invocation agent-allowlist check was NOT added. Verified posture:
>   factory content reaches the engine only through the admission-gated
>   bundle (non-admitted content never ships), agent-key revocations
>   propagate at every grant renewal (FR-010 sweep), and the runtime PEP
>   remains specs 067/068/036 per FR-007's declared posture. OPC is keyless
>   (AC-5's custody leg holds mechanically).
> - **T013/T014**: the countersign's `run_id` claim is the PLATFORM run
>   identity (factory_runs.id), distinct from the engine-minted
>   `pipeline_run_id`. The certificate hash is the authoritative binding;
>   the engine enforces run-id equality when patching (it knows both), the
>   offline verifier surfaces it informationally.
> - **Scope addition**: the desktop run path previously emitted NO
>   governance certificate (only the headless `factory-run` binary did);
>   it now emits + seals one per run (`generate_certificate_bound`).
> - **Tooling fix**: statecraft `vite.config.ts` DB-bound test exclusions
>   were unconditional, making those suites unrunnable even under
>   `encore test`; now conditional on `ENCORE_RUNTIME_LIB` (CI unchanged).
> - **Renewal Build-Spec presentation**: the gate reads the live
>   `pipeline_state.build_spec_hash` (primary path); resume seeds from the
>   fresh engine state — the platform chain holds any earlier one-way
>   binding regardless.

## Phase A — Signing authority (FR-014, platform side)

- [x] T001 `signing.ts`: load Ed25519 key from Encore secrets
      (`FACTORY_SIGNING_PRIVATE_KEY` PKCS#8 PEM, `FACTORY_SIGNING_KID`);
      `signCompactJws()`, `verifyCompactJws()`, `exportPublicJwk()`; unit
      tests with throwaway keypairs (never fixture-committed private keys).
- [x] T002 [P] `jwks.ts`: `GET /api/factory/.well-known/jwks.json` — public,
      unauthenticated, current (+ optional previous) key, cache headers; test.
- [x] T003 Admission seal: in `admission.ts`, sign the canonical composed
      record at admission write; persist `{kid, signature, sealed_at}` on
      `factory_admissions` (extend migration 44); serve the seal in the
      admission block of `opcBundle.ts`; tests (sealed row round-trips,
      tampered record fails verify).
- [x] T004 [P] Secret provisioning: generation command documented
      (`openssl genpkey -algorithm ed25519`), local-dev secret wiring per
      `.claude/rules/platform-services.md` conventions; surface setup.sh
      canonical path + side effects if touched.

## Phase B — Run-grants over duplex (FR-005)

- [x] T005 Migration 44 `factory_run_grants` (`id, org_id, project_id,
      run_id, goal_id, capsule_hash, envelope_hash, build_spec_hash, seq,
      kid, issued_at, expires_at, refused_reason NULL`) + drizzle table +
      admission-seal columns from T003.
- [x] T006 Wire types: `ClientEnvelope` += `factory.run.grant_request` /
      `factory.run.grant_renew`; `ServerEnvelope` +=
      `factory.run.grant` (grant JWT, exp, kid, seq) /
      `factory.run.grant_refused` (reason: goal-shift | revoked |
      not-admitted | expired-admission | malformed); flat wire fields in
      `ClientEnvelopeWire`/`ServerEnvelopeWire`; honour spec 189 envelope
      version parity (bump/extend the constant + parity fixtures); schema-
      parity walker (125/191) green.
- [x] T007 `grantDuplexHandlers.ts` — issuance: resolve latest admission for
      (org, origin), require status=admitted + envelope_hash match; check
      `hasActiveRevocation` across all four keys (factory, adapter, agent,
      content-hash) fail-closed; validate capsule against the admitted
      envelope (the PDP decision); sign grant (PD-3), persist row, reply
      targeted via `sendTargetedServerEvent`.
- [x] T008 Renewal: re-present `goal_id` + `capsule_hash`; goal shift ⇒
      refuse `goal-shift` + record (ASI01 m4/m7); revocation since issuance
      ⇒ refuse `revoked` (AC-8 final leg); `seq` must increment
      monotonically; refusals persisted with `refused_reason`; handler tests
      (`runDuplexHandlers.test.ts` pattern) covering all refusal reasons.
- [x] T009 OPC/engine side: `sync_client.rs` outbound frames + `SERVER_KINDS`
      + send helpers; `statecraft_client.rs` grant request/renew methods;
      engine run loop acquires a grant before s0 and renews at every stage
      boundary; refusal or unrenewable grant ⇒ pause run + surface reason
      (fail-closed, never proceed unsigned).
- [x] T010 PD-8 verification: confirm whether engine-side off-list-agent
      refusal (AC-5) exists post-#313; if not, enforce during grant-gated
      stage entry (stage agents ⊆ admitted constituent set); engine tests.

## Phase C — Emission countersign (FR-014) + verify-certificate (AC-4)

- [x] T011 Rust certificate types: `platform_countersign: Option<…>` +
      `admitted_envelope_hash: Option<String>`, excluded from self-hash;
      `CERTIFICATE_VERSION` 1.3.0 → 1.4.0; regenerate any ts-rs bindings
      (regen after doc-comment edits too — known trap).
- [x] T012 Sync-back: `factory.run.completed` wire gains
      `certificate_sha256` + final `seq`; `handleRunCompleted` verifies the
      issued grant chain (rows match count + hashes), countersigns, persists
      `{certificate_hash, countersigned_at}` on `factory_runs`, sends
      `factory.run.certificate_countersign`; tests incl. chain-mismatch
      refusal (no countersign on a chain statecraft didn't issue).
- [x] T013 OPC receipt: dispatch countersign to the engine; patch the
      persisted `governance-certificate.json` in place (seal write must not
      alter the self-hash inputs); Rust test: emit → seal → verify.
- [x] T014 `verify_certificate`: new verification step for the countersign;
      `--platform-jwks <file>` (offline) / `--jwks-url` (online) /
      `--require-sealed`; unsealed cert ⇒ "verifiable-but-unsealed", exit 0
      unless `--require-sealed`; Makefile target passthrough; tests for
      sealed-valid, sealed-tampered, unsealed, require-sealed.
- [x] T015 [P] Add `ed25519-dalek` to factory-engine; `cargo deny check`
      green (spec 116).

### PR-A gate tasks

- [x] T016 `npm run gen` (client regen for JWKS endpoint), codebase index
      regen, featuregraph golden if needed, spec 198 `establishes:` gains
      the new files (signing.ts, jwks.ts, grantDuplexHandlers.ts, migration
      44) in the same PR; `make ci` (Rust legs need clippy); `make pr-prep`
      after the LAST commit.

> **PR-B status (2026-06-10): phases D–F COMPLETE** (T017–T026, branch
> `feat/198-override-gate`). Recorded deviations from the task sketches:
> - **T018 scope**: the gate is wired into ALL `user_body` write doors,
>   not only `applyOverrideCore` — `conflicts.ts::edit_and_accept` (an
>   override revision by another door) and the user-authored agent writes
>   in `api/agents/catalog.ts` (create + patch). Agent FORK is exempt:
>   it copies content already in the substrate, and gating it would
>   block the fork-then-fix remediation path for pre-gate legacy rows.
>   `createAgent` refusals carry no audit row (the audit table requires
>   an artifact id that does not exist pre-insert); the attributable 400
>   is the record.
> - **T018 provenance**: existing `userModifiedBy/At` + recomputed
>   `contentHash` cover FR-013(b) verbatim; nothing was added.
> - **T020 enforcement point**: the predicate is enforced at OPC-bundle
>   assembly (`opcBundle.ts::loadAdmissionBlock` →
>   `admission.ts::collectConsumedOverrides`) — the run's content source.
>   A violating bundle request FAILS (failedPrecondition naming artifact
>   + predicate) rather than silently serving upstream content, which
>   would swap what the org configured. Display surfaces (artifacts API,
>   web) keep serving with provenance attached — that IS the trust-class
>   segregation. Scope boundary: the predicate governs overrides of the
>   admitted factory's content; user-authored agents remain governed by
>   their own publication gate (spec 111).
> - **T021 premise correction**: tasks.md claimed the certificate field
>   "landed with 1.4.0 in T011" — it had NOT. The field lands here:
>   `consumedOverrides` (inside hash + signature), CERTIFICATE_VERSION
>   1.4.0 → **1.5.0**, empty list skipped in serialization so
>   override-free certs stay byte-identical to 1.4.0 payloads. Wire leg:
>   `OpcBundleAdmission.consumedOverrides` (statecraft + desktop twin),
>   threaded `run_governance.rs::establish` → `CapsuleBinding` →
>   `generate_certificate_bound`.
> - **Row-shape ripple**: migration 45's columns are a substrate
>   row-shape change → `SUBSTRATE_VERSION` bumped 1 → 2 in lockstep
>   (TS const + Rust mirror, same commit, per the version-discipline
>   note in both files).

## Phase D — Override gate + provenance (FR-013 a+b)

- [x] T017 `overrideGate.ts`: deterministic rules per PD-6, each with a rule
      id; fixture-driven tests (zero-width, bidi, HTML comment, data-URI,
      oversized base64, ANSI, PEM/token/JWT secrets, size ceiling, kind
      stability, clean-pass).
- [x] T018 Wire into `applyOverrideCore` (`artifacts.ts`) before any write;
      attributable 400 with rule id; audit `artifact.override_gate_rejected`;
      provenance stamp formalized (author = auth identity, timestamp,
      content hash on every revision — confirm existing
      `userModifiedBy/At` + hash cover FR-013(b), add only what's missing).

## Phase E — Verified-flag trust class (FR-013 c, AC-11)

- [x] T019 Migration 45: `user_body_verified` (default false) +
      `verified_by`/`verified_at`; new override revision resets the flag;
      `POST /api/factory/artifacts/:id/verify-override` (org-admin gated);
      audit `artifact.override_verified`.
- [x] T020 Enforcement: serve/bundle path refuses unverified override
      content fail-closed when the admitted envelope declares
      `overrides.require_verified: true` (error names artifact + predicate);
      overrides always served with provenance attached (trust-class
      segregation); tests for predicate true/false × verified/unverified.
- [x] T021 Certificate binding: consumed overrides (artifact id, content
      hash, author, verified state) ride the OPC bundle; engine binds them
      into the certificate (field landed with 1.4.0 in T011).
- [x] T022 [P] Web: verified badge + verify action on the artifacts route;
      admission-verdict tab untouched.

## Phase F — Closure (AC-6, AC-7)

- [x] T023 Spec 198 frontmatter: `compliance:` block
      (framework owasp-asi-2026, controls = union of the envelope schema's
      inline ASI tags); verify `oap-registry-enrich compliance-report`
      agrees with the inline tags (AC-6); refresh the spec's ASI table rows
      that change status (ASI06 → "designed, phased — scanner filed as spec
      200"; ASI09 names spec 201).
- [x] T024 [P] Draft spec stub `200-substrate-override-async-scanner`
      (ASI06 / FR-013 d: async, quarantine-only via FR-010 machinery; a
      model may detect, only rules block).
- [x] T025 [P] Draft spec stub `201-anti-blind-approval-ui` (ASI09:
      plain-language risk summaries with provenance, preview ≠ effect,
      never model-generated rationale as approval basis).
- [x] T026 Gate tasks for PR-B: registry recompile (new specs), codebase
      index regen, featuregraph golden `UPDATE_GOLDEN=1` (spec adds always
      bump it), `npm run gen` if endpoints changed, `make ci`,
      `make pr-prep` after the LAST commit.

## Dependencies

- T001 → {T002, T003, T007}; T005 → {T007, T008}; T006 → {T007, T009};
  T011 → {T012, T013, T021}; T007/T008 → T012 (chain to reconcile).
- Phase D/E independent of A–C except T021 (needs T011's field).
- T023–T025 independent [P] once D/E shapes are fixed.

## Out of scope (recorded, not lost)

- ASI06 scanner implementation (spec 200 stub only — FR-013 d).
- ASI09 UI implementation (spec 201 stub only).
- `implementation: complete` flip for 198 — gated on runtime AC verification
  after the Statecraft-side envelope merge + org re-sync (first real ADMIT).
  **DONE 2026-06-12**: gate discharged by the first sealed admission
  `7cf82fae…` (2026-06-11, 0 violations, JWS verified against the
  published JWKS) following the Statecraft-side envelope merge; flip
  executed — see the spec's implementation log entry of 2026-06-12 for
  the recorded AC-5 (bundle-boundary posture per T010) and AC-4
  (live-run evidence is follow-on) caveats.
