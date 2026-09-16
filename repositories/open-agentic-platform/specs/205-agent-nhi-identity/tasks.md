# Tasks: Per-Agent Non-Human Identity and Task-Scoped Credentials

**Input**: [plan.md](plan.md) (dyn-client client_credentials decision,
two-token model), [spec.md](spec.md) FR-001..FR-005
**Format**: `[ID] [P?] Description` — [P] = parallelizable (different
files, no dependency). Phase 0 = PR-0 (`feat/205-audit-attribution`);
Phase 1 = PR-1 (`feat/205-identity-leg`); Phase 2 = PR-2
(`feat/205-session-grants`); Phase 3 = PR-3 (`feat/205-revocation`).

**Sequencing gates** (from spec.md §Sequencing + plan.md prerequisites):

- **Phase 0 is landable now** — adds fields only, no Rauthy version
  dependency, explicitly exempted by spec.md.
- **Phases 1–3 are blocked on two external events**: (a) spec 198
  flips `implementation: complete` (currently in-progress, gated on the
  first real ADMIT per 198 tasks.md §Out of scope); (b) a Rauthy image
  ≥ 0.36 is deployable (latest upstream tag is v0.35.2 as of
  2026-06-12; everything beyond basics — `claims_at_root`,
  `CLIENT_CREDENTIALS_MAP_SUB` posture verified against main — is
  main-only). T005 owns the image decision.
- Migration numbers below (47/48/49) are next-free as of 2026-06-12
  (highest landed: `46_widen_substrate_audit_actions`); renumber to
  next-free at landing time.

## Pre-implementation decisions (2026-06-12 codebase survey)

The pre-task survey of the statecraft auth/audit/sync surfaces and the
Rauthy source found five points where the plan's sketch meets different
ground truth. Resolutions recorded here so no task silently re-decides
them:

- **PD-A — audit principals are new columns, not a new actor.**
  `audit_log.actor_user_id` is `UUID NOT NULL` FK→`users.id`
  (`schema.ts:331`, migration 1); a dyn-client NHI is not a `users`
  row, so the NHI subject can never ride `actor_user_id`. Two-principal
  rows are achieved by adding nullable `nhi_sub TEXT` and
  `on_behalf_of TEXT` columns; `actor_user_id` keeps pointing at the
  human. Non-breaking: every pre-NHI write stays valid with both NULL.
- **PD-B — the delegation index IS the session→NHI store.** The sync
  registry (`api/sync/registry.ts`) is process-local memory
  (`orgs: Map`); there is no sessions DB table. `nhi_delegation_index`
  (migration 48) is the authoritative mapping and the revocation index
  spec 208 consumes — not a join against any session store. Keyed by
  `(org_id, session_client_id)`; the in-memory `SessionMeta` is not
  extended.
- **PD-C — OPC display gets a dedicated field.** `LiveSessionRow.scope`
  (`live_sessions.rs:52`) is a placeholder hardcoded `"local-only"`.
  Add `nhi_subject: Option<String>` as a distinct field rather than
  overloading `scope`; `scope` remains the scope-string carrier for
  when binding lands.
- **PD-D — the dyn-client management surface is asymmetric.**
  `rauthyAdminClients.ts` stays untouched (precedent only — its
  injectable-fetch `AdminCallOptions` pattern and POST-time secret
  capture are what's ported). Verified against the Rauthy source
  (2026-06-12): `POST /auth/v1/clients_dyn` (auth: `Bearer
  <DYN_CLIENT_REG_TOKEN>`, new Encore secret
  `RAUTHY_DYN_CLIENT_REG_TOKEN`) returns `client_id`, `client_secret`,
  `client_secret_expires_at` **and a `registration_access_token`**
  (RFC 7592 management credential — must be persisted; it is the auth
  for `PUT /clients_dyn/{id}`, and each PUT update regenerates the
  `client_secret`, which is how rotation is achieved). **There is no
  `DELETE /clients_dyn/{id}`** (`server.rs:553-555` routes only
  POST/GET/PUT): deletion uses the admin `DELETE /clients/{id}`
  (`API-Key` path). The custody rule is therefore: registration token
  for register/rotate, admin key for delete — both statecraft-only,
  never OPC, never agents. An upstream symmetric-DELETE patch is on
  the plan's upstream track.
- **PD-E — OPC keyless means token acquisition is platform-proxied.**
  The dyn-client `client_secret` and `registration_access_token` never
  leave statecraft — persisted on the delegation row encrypted
  AES-256-GCM per the PAT precedent (`patCrypto.ts` /
  `PAT_ENCRYPTION_KEY`; dedicated key `NHI_SECRET_ENCRYPTION_KEY`).
  The agent session receives only short-TTL access tokens and grants,
  delivered over duplex targeted server events — the same custody
  split the run-grant fabric proved (198 AC-5).

## Phase 0 — Audit attribution (FR-005, AC-4 leg) — PR-0, landable now

- [ ] T001 Migration 47 `47_audit_two_principal.up.sql` / `.down.sql`:
      `ALTER TABLE audit_log ADD COLUMN nhi_sub TEXT NULL, ADD COLUMN
      on_behalf_of TEXT NULL`; drizzle `db/schema.ts` columns added in
      the same commit. (FIPS rule: no `md5()` in migration SQL —
      trivially satisfied here.)
- [ ] T002 Thread optional NHI context through the audit write sites:
      `HandlerCtx` (`api/factory/grantDuplexHandlers.ts:70`; its audit
      insert sites are lines 229/274/685), the `audit.candidate`
      inbound write in `api/sync/service.ts:154`, and
      `ingestAuditRecord` (`api/audit/audit.ts:24`) gain optional
      `nhiSub` / `onBehalfOf` fields populated into the new columns
      when present. No behavior change while no NHI exists; the
      contract is "every audit row generated from an agent context
      carries both principals" the moment Phase 1 starts minting.
- [ ] T003 Forensic-query test (AC-4): integration test proving
      `SELECT ... WHERE nhi_sub = $1` returns an agent's complete audit
      trail with the human principal readable off the same rows — no
      log archaeology. DB-bound: add to the `vite.config.ts` exclude
      list so it rides the spec 211 encore-test lane. (Depends on
      T001 + T002 — not parallelizable.)
- [ ] T004 Gate tasks PR-0: spec 205 frontmatter gains a `refines:`
      aspect `audit-attribution` covering the edited files (migration,
      `db/schema.ts`, `audit.ts`, `api/sync/service.ts`,
      `grantDuplexHandlers.ts`) — the coupling gate enforces the
      declared graph, not prose mentions; registry recompile **before**
      `UPDATE_GOLDEN=1` if the featuregraph golden moves (frontmatter
      edits move it; 205 carries the `extends: 034` edge); codebase
      index regen; `make pr-prep` after the LAST commit.

## Phase 1 — Identity leg (FR-001, FR-002, AC-1/AC-2/AC-5 mint leg) — PR-1

- [ ] T005 Deployment prerequisites (hard blocker, do first):
      decide Rauthy image — wait for the 0.36 release vs publish from
      `bartekus/rauthy` main (currently byte-identical to upstream;
      doubles as the release-cadence hedge) — and pin it in
      `platform/charts/rauthy/values.yaml`; enable
      `ENABLE_DYN_CLIENT_REG` + `DYN_CLIENT_REG_TOKEN` (custody:
      statecraft only), `CLIENT_CREDENTIALS_MAP_SUB=true`,
      `DYN_CLIENT_ALLOWED_SCOPES` (defense-in-depth ceiling),
      `DYN_CLIENT_DEFAULT_TOKEN_LIFETIME` (grant-renewal cadence);
      leave `DYN_CLIENT_SECRET_AUTO_ROTATE` unset (it rotates the
      RFC 7592 registration token, not the `client_secret`; statecraft
      manages rotation via PUT updates — plan.md §Flow decision);
      document secret wiring per `.claude/rules/platform-services.md`.
- [ ] T006 `api/auth/rauthy.ts`: dyn-client management per PD-D —
      `DynClientRegistrationRequest` / `DynClientRegistrationResponse`
      types (response includes `registration_access_token`),
      `registerDynClient()` (POST, Bearer reg-token),
      `updateDynClient()` (PUT, Bearer `registration_access_token`;
      regenerates `client_secret` — this IS the rotate),
      `deleteDynClientAdmin()` (admin `DELETE /clients/{id}`,
      `API-Key` path via `buildRauthyAdminAuth`); injectable fetch;
      unit tests with fetch stubs (no live Rauthy in the pure lane).
- [ ] T007 Migration 48 `48_nhi_delegation_index.up.sql` / `.down.sql`:
      table `nhi_delegation_index` (`id UUID PK, org_id, dyn_client_id,
      nhi_sub, human_user_id FK→users, agent_profile,
      session_client_id, effective_scopes JSONB, client_secret_enc,
      registration_token_enc, minted_at, rotated_at, last_seen_at,
      revoked_at NULL, revoke_reason NULL`) + drizzle table; secrets
      encrypted per PD-E; indexes on `(org_id, session_client_id)`,
      `(nhi_sub) WHERE revoked_at IS NULL` (the hot-path liveness
      lookup), and `(human_user_id) WHERE revoked_at IS NULL` (the
      logout cascade walk).
- [ ] T008 `api/auth/sessionMint.ts::mintAgentNhi()` alongside
      `mintSessionForOrg`: compute
      `intersection(human scopes, agent profile ceiling)` at mint,
      register the dyn client with exactly those scopes, persist the
      delegation row (secrets encrypted). Pin two micro-decisions
      during implementation and record them here: (a) the
      profile-ceiling source (org agent catalog row's admitted scopes —
      specs 111/123 — fail-closed if absent); (b) empty intersection ⇒
      refuse mint with an attributable error, never a zero-scope NHI.
- [ ] T009 Duplex lifecycle hooks (`api/sync/duplex.ts`): after
      `registry.register(...)` (line ~140) mint the NHI; in the
      `finally` unregister path (line ~344) revoke it (T006 admin
      delete + stamp `revoked_at`). Mint failure is attributable and
      fail-closed for *agent* calls (no NHI ⇒ agent presents nothing)
      but never kills the human session. Wire delivery: new
      ClientEnvelope/ServerEnvelope frames for NHI token issue/renew,
      sent via `sendTargetedServerEvent` (imported from
      `api/sync/service.ts:287`, per PD-E); honour spec 189 envelope
      version parity; schema-parity walker (125/191) green.
- [ ] T010 Orphan reconciliation sweep: Rauthy's dyn-client
      inactive-cleanup scheduler **exits when a registration token is
      configured** (`rauthy src/schedulers/src/dyn_clients.rs:24-27`) —
      OAP's exact mode — so there is no Rauthy-side reaper, and the
      T009 `finally` path is process-local (a statecraft crash/restart
      orphans live credentials). Add a statecraft sweep (startup + a
      periodic job at grant-TTL cadence): delegation rows with
      `revoked_at IS NULL` whose session is absent from the live
      registry and whose `last_seen_at` exceeds the renewal window ⇒
      revoke (admin delete + stamp `revoke_reason = 'orphan-sweep'`);
      audit each sweep action; test with seeded stale rows.
- [ ] T011 `api/auth/m2mAuth.ts::validateNhiJwt()` alongside
      `validateM2mJwt`, reusing `getJwksAndIssuer()` + the RS256/EdDSA
      verify block: require `sub` prefix `dyn$`, check delegation-index
      liveness (`revoked_at IS NULL`, via T007's partial `nhi_sub`
      index — the one extra indexed lookup the plan's performance goal
      budgets) fail-closed, return `NhiClaims { sub, scope?, exp }`;
      auth-handler path maps NHI calls to an auth context carrying
      `nhiSub` + `onBehalfOf` (feeds the T002 audit threading).
- [ ] T012 [P] OPC display (spec 172 surface, keyless):
      `live_sessions.rs` gains `nhi_subject: Option<String>` per PD-C +
      TS type update + session introspection rendering. Display-only.
- [ ] T013 DB-bound integration tests (encore lane, fixtures namespaced
      per `grantDuplexHandlers.test.ts` conventions): AC-1 distinct
      subjects (agent vs human in parallel), AC-2 intersection proven
      both ways (narrower agent ceiling refused for agent / allowed for
      human, and the reverse), AC-5 mint-time property (no path mints
      effective scope ⊃ human scopes); `vite.config.ts` exclude
      additions.
- [ ] T014 Gate tasks PR-1: spec 205 `establishes:` gains migration 48
      + new files; `refines:` gains `m2mAuth.ts`, `duplex.ts`, chart
      values if edited (expand the graph to the full edit surface);
      `npm run gen` if endpoint surface changed; registry recompile →
      golden → index regen; `make pr-prep` after the LAST commit.

## Phase 2 — Capability leg (FR-003, AC-5 TOCTOU leg) — PR-2

- [ ] T015 Session-grant JWS: extend `FactoryJwsTyp`
      (`api/factory/signing-pure.ts:26`) with
      `"oap-session-grant+jwt"`; new `api/auth/sessionGrants.ts`
      issuance via the existing `signFactoryJws` machinery — claims
      `{ iss, aud, nhi_sub, on_behalf_of, agent_profile, purpose,
      capsule_hash?, seq, iat, exp }`; migration 49 `session_grants`
      table mirroring `factory_run_grants` (issued/refused status,
      `refused_reason`, `kid`, `seq`, TTL columns).
- [ ] T016 Renewal + re-validation: renewal cadence mirrors
      `handleGrantRenew` (monotonic `seq`, TTL at
      `DYN_CLIENT_DEFAULT_TOKEN_LIFETIME` cadence); each renewal
      refreshes the dyn client via T006's PUT update (regenerated
      `client_secret` — rotation-on-renewal per plan.md FR-001 row);
      **scope re-validation at renewal** (AC-5 TOCTOU leg): recompute
      the intersection — shrunk human scopes ⇒ PUT the narrower scope
      set or refuse (`scope-shrunk`); refusal reasons persisted
      (`revoked | scope-shrunk | expired | malformed`).
- [ ] T017 Purpose binding enforcement: statecraft endpoints that
      accept NHI calls verify token + grant together — a token
      presented outside its bound intent/audience is refused
      attributably; pin the enforcement-point list during
      implementation (the PEP is the auth handler from T011 plus
      per-endpoint audience checks). Boundary (recorded in plan.md
      §Known gaps): deployd-api-rs enforces scope+TTL only and never
      sees grants — extending grant verification there is post-205
      candidate work, not a task here.
- [ ] T018 Tests: grant issue/renew/refuse matrix incl. the
      scope-shrink renewal, rotation-on-renewal, and intent-mismatch
      refusal.
- [ ] T019 Gate tasks PR-2: frontmatter expansion (`establishes:`
      sessionGrants.ts + migration 49), registry → golden → index,
      `make pr-prep`.

## Phase 3 — Revocation (FR-004, AC-3, AC-5 residual-TTL bound) — PR-3

- [ ] T020 Agent-side revocation: admin/endpoint action
      `revokeAgentNhi(orgId, dynClientId, reason)` — delete the client
      at Rauthy via T006's admin-path delete, stamp
      `revoked_at`/`revoke_reason`; the next agent call is refused
      attributably via T011's liveness check (residual token validity
      bounded by TTL per AC-5); the human session is untouched.
- [ ] T021 Human-logout cascade: hook the session-revocation path
      (`rauthy.ts::revokeSession` call sites — `auth.ts`, `admin.ts`,
      `teamSync.ts`) to walk `nhi_delegation_index` by `human_user_id`
      and revoke every live chained NHI — the delegation chain is the
      revocation index. Boundary (AC-3 scopes the criterion to
      *logout*): natural human-session expiry does not call
      `revokeSession`; that window is bounded by token TTL + T016's
      renewal re-validation, and T010's sweep catches the long tail.
- [ ] T022 AC-3 integration test, both directions: mid-session NHI
      revoke (agent refused, human survives) and human logout (all
      chained NHIs dead).
- [ ] T023 [P] Spec 208 handoff: document the revocation-index contract
      (table shape, liveness predicate, cascade entry points, sweep
      semantics) in spec 205's spec.md §FR-004 or a contracts/ note —
      spec 208 consumes it; no 208 implementation here.
- [ ] T024 Gate tasks PR-3 + closure: AC-1..AC-5 evidence sweep (AC-5
      evidence spans Phases 1–3 — see plan.md AC coverage);
      lifecycle flips (`implementation:` per evidence; `status:
      approved` flip is a named-trigger decision, not automatic);
      registry → golden → index; `make pr-prep`.

## Dependencies

- T001 → T002 → T003 (Phase 0 internal chain); T004 last.
- T005 blocks T006–T013 deployment-wise (code can land behind the
  unreleased-image blocker only if tests stub Rauthy; the integration
  lane needs a live ≥0.36 image — decide in PR-1 whether to split
  code-landing from enablement).
- T006 + T007 → T008 → T009 → T010; T011 → {T013, T017}; T002 → T011
  (audit threading consumed by the auth context).
- T015 → T016 → T017; Phase 2 depends on Phase 1's NHI existing.
- T020/T021 depend on T007 (index) + T011 (liveness check); T022 last
  before closure.
- Cross-spec: Phases 1–3 blocked on spec 198 `implementation: complete`
  (spec.md §Sequencing); spec 208 consumes Phase 3's index.

## Out of scope (recorded, not lost)

- Run-grant convergence — run-grants remain parallel per plan.md; a
  post-205 refactor candidate.
- RFC 8707 resource indicators upstream (rauthy #1562,
  maintainer-blessed) — strengthens FR-003's Rauthy-side audience
  binding when it lands; the session grant's audience claim is the
  carrier until then.
- client_credentials custom-claims upstream patch (symmetric to #1597)
  — would let the NHI token natively carry `agent_profile` /
  `on_behalf_of`; the session grant is the carrier until then.
- `DELETE /clients_dyn/{id}` upstream patch (lifecycle parity) — until
  it lands, deletion rides the admin path per PD-D.
- DPoP sender-constraining — Rauthy supports DPoP on
  client_credentials; no spec-205 FR mandates it; future hardening.
- Grant verification at deployd-api-rs — scope+TTL only there for now
  (plan.md §Known gaps).
- OS-attribution leg (rauthy-pam-nss, per-agent POSIX uid) — future
  extension of specs 162/185/186.
- Org-wide kill switch — spec 208 owns it; this spec only hands off the
  revocation index.
