# Implementation Plan: Tenant environment access gates

**Branch**: `137-tenant-environment-access-gates` | **Date**: 2026-05-06 | **Spec**: [`spec.md`](./spec.md)

## Summary

Stand up a per-environment, passwordless OIDC access gate via the
existing Rauthy instance, layered above tenant deployments by
deployd-api. Tenant codebases stay zero-auth. Spec 137 §Clarifications
flags six load-bearing open decisions; this plan structures the work
so each decision lands in its own phase before the dependent
implementation begins, rather than trying to resolve all six up front
and then build everything at once.

## Technical context

- **Language/Stack:** Encore.ts (statecraft API + UI), Drizzle ORM,
  PostgreSQL (env-gate schema), Rust/axum (`deployd-api-rs`), kube-rs
  (current K8s renderer; spec 136's Phase 2.b Helm migration is a
  separate dependency this plan tracks but does not block on).
- **Identity primitive:** [Rauthy](https://github.com/sebadob/rauthy)
  self-hosted OIDC, deployed via `platform/charts/rauthy/`. Hiqlite
  storage; admin API drives client provisioning.
- **Proxy primitive:** `oauth2-proxy` (or pomerium / vouch) — the
  authenticator that ingress-nginx chains to via `auth-url` /
  `auth-signin` annotations. Decision in Phase 0.
- **Out-of-band dependencies:**
  - `platform/charts/rauthy/` — already deployed; this plan adds
    Auth Provider configuration (Google / Microsoft / GitHub upstreams)
    at the rauthy level, not per-tenant.
  - `platform/charts/tenant-hello/` (spec 136) — the reference tenant
    chart whose Ingress this plan will gate. Spec 136's chart already
    leaves `ingress.annotations` open for this overlay.

## Constitution check

- **Principle I (markdown-only authored truth):** `spec.md`,
  `plan.md`, `tasks.md` are markdown. Schema migrations + chart values
  are tooling outputs, not authored OAP truth.
- **Principle II (compiler-owned JSON machine truth):** No JSON
  authoring. Spec compiler emits machine truth; `index.json` reflects
  the new schema migration + new code paths automatically.
- **Principle III (spec-first):** Each phase's code-change tasks are
  blocked until §Clarifications decisions for that phase land in
  `spec.md` (or the dedicated `clarifications-resolved.md` companion
  this plan introduces).
- **CONST-005 (adversarial-prompt refusal):** This plan deliberately
  does NOT collapse the 6 open decisions into "do whatever the
  implementation wants." Each decision is a real authoring step and
  the spec text drives the implementation, not the other way around.
  The `password_login_enabled: false` invariant in particular is
  load-bearing: any phase that would soften it (e.g. a follow-up that
  enables passkey auth as a "convenient" addition) must land as an
  explicit amend, not as drift.

## Phased delivery

### Phase 0 — Resolve clarifications & lock the gate contract *(this PR; gates approval)*

The 6 §Clarifications items in `spec.md` are the gate to approval.
Phase 0 produces a `clarifications-resolved.md` companion (or amends
`spec.md` directly) capturing each decision with its rationale:

1. **oauth2-proxy topology.** Recommend per-env Deployment per
   spec.md (one proxy per gated environment, isolated config). Decision
   text confirms this with a "revisit when pod count exceeds N" exit
   criterion.
2. **Schema shape.** Recommend dedicated `environment_access_gates`
   table + `environment_access_gate_allowlist_emails` sibling for
   row-level allowlist entries. Decision text pins the FK shape and
   cascade behaviour.
3. **Rauthy admin API contract.** Confirm via Rauthy admin API smoke:
   (a) volume of clients tolerated, (b) client deletion is clean,
   (c) toggling `password_login_enabled` on an existing client (vs
   recreate), (d) Auth Provider id reference shape. Document the
   confirmed contract here.
4. **Hostname stability.** Decide the canonical pattern (e.g.
   `<env-slug>.<project-slug>.<org-slug>.tenants.<base>`). Locks
   `redirect_uri` shape on Rauthy clients.
5. **User → Rauthy user mapping.** Recommend auto-provision Rauthy
   user with `password_login_enabled: false` + magic-link enabled when
   `login_methods.magic_link == true`; silent linking of upstream
   identity on first federated login. Edge cases (allowlist removal,
   user-already-exists collision) documented.
6. **Auth Providers UX.** Confirm that Auth Provider configuration
   stays in Rauthy admin UI for v1; surface as future statecraft work
   if useful.

**Phase 0 deliverables:** clarifications resolved in spec.md (or
companion file), spec status flipped `draft → approved`. No code
changes under FR-001..FR-010 land before this phase closes (spec.md
§FR-007's "statecraft never stores a password" invariant is the
load-bearing constraint that gates everything downstream).

### Phase 1 — Schema migration

- `platform/services/statecraft/api/db/migrations/3X_environment_access_gates.up.sql`
  — `environment_access_gates` table:
  `(environment_id PK FK→environments.id, enabled bool NOT NULL DEFAULT
  false, rauthy_client_ref text NULL, login_method_magic_link bool
  NOT NULL DEFAULT true, login_method_federated_provider text NULL,
  login_method_federated_provider_client_ref text NULL, created_at,
  updated_at)`. NULLs allowed when `enabled = false`; CHECK constraint
  enforces non-null Rauthy fields when `enabled = true`.
- Sibling allowlist table:
  `(environment_id FK, kind ENUM('email','domain'), value text NOT
  NULL, created_at)` with `(environment_id, kind, value)` unique
  index. Case-insensitive matching is enforced at the API layer
  (citext is FIPS-incompatible per `platform/CLAUDE.md`).
- Down migration drops both tables.
- Drizzle schema additions in `api/db/schema.ts`.

### Phase 2 — Statecraft API CRUD

- `api/environments/accessGates.ts`:
  - `GET /api/environments/:id/access-gate` — read current descriptor.
  - `PUT /api/environments/:id/access-gate` — create-or-update
    descriptor; toggling `enabled` triggers a deployd-api reconcile.
  - `POST /api/environments/:id/access-gate/allowlist` — append email
    or domain entry.
  - `DELETE /api/environments/:id/access-gate/allowlist/:entryId`
    — remove entry.
- Audit-log write per change (governance per spec 119 §6).
- Validation: refuse setting `enabled=true` without a backing project
  membership grant scope; refuse password-bearing fields outright
  (defense in depth; the schema has no such field, but the API rejects
  shapes that look like passwords to catch upstream bugs early).

### Phase 3 — Rauthy admin client + provisioning

- `api/integrations/rauthy/adminClient.ts` — typed wrapper around
  Rauthy admin API (`/auth/v1/clients` etc.). Configuration: Rauthy
  base URL + admin token via the existing OIDC M2M secret path used
  by deployd.
- `provisionTenantGateClient({environmentId, descriptor})` — idempotent
  create-or-update; returns `client_id` written to
  `environment_access_gates.rauthy_client_ref`.
- `deprovisionTenantGateClient({environmentId})` — DELETE the Rauthy
  client; the descriptor row is reset to `enabled=false`.
- Vitest coverage with a stub Rauthy admin server. Integration test
  against a local Rauthy in CI is a stretch; default is unit-level.

### Phase 4 — deployd-api K8s renderer additions

- `deployd-api-rs/src/routes.rs` — `DeploymentRequest` gains an
  optional `access_gate: Option<AccessGateDescriptor>` field.
  Statecraft populates it from the environment's descriptor.
- `deployd-api-rs/src/k8s.rs` — when descriptor is `Some(g)` with
  `g.enabled == true`:
  1. Render an `oauth2-proxy` Deployment + ClusterIP Service in the
     deployment's namespace (image pinned, single replica per env,
     resource limits matching tenant tier).
  2. Wire `auth-url` / `auth-signin` annotations on the tenant
     Ingress, pointing at the per-env oauth2-proxy Service.
  3. Render a Secret carrying the proxy's cookie secret + Rauthy
     client secret. Secret data is sourced from a statecraft-managed
     secret; deployd-api does NOT generate cookie secrets itself.
- DELETE path tears down both the oauth2-proxy resources and the
  Rauthy client (via statecraft callback for the latter).
- Reconcile path: descriptor change without redeploying the tenant
  Deployment (FR-009, FR-010). State machine handles toggle and
  login-method edits without restarting tenant pods.

**Cross-cutting note:** Phase 4 is much smaller if spec 136's Phase
2.b (Helm migration) lands first, because deployd-api would then
overlay tenant-hello + an oauth2-proxy chart instead of hand-rolling
K8s objects. The plan's risk register flags this as a sequencing
choice (do 137 Phase 4 with kube-rs OR wait for spec 136 Phase 2.b
and do it via Helm).

### Phase 5 — Statecraft UI

- Per-environment "Access gate" card on the project's environment
  page. Toggle on/off; allowlist editor (add/remove email + domain);
  login-method picker (magic link toggle + federated provider
  dropdown).
- "Continue with..." preview surface so admins see what the tenant's
  end users will land on.

### Phase 6 — End-to-end + lifecycle flip

- Positive paths from §"Success Criteria":
  1. `enabled=false` env: direct exposure preserved.
  2. `enabled=true, magic_link=true, allowed_emails=[u@e.com]`:
     redirect → Rauthy magic-link form (no password field) → click
     → tenant.
  3. Allowlist denial at oauth2-proxy after Rauthy login.
  4. Federated Google login alongside magic-link.
  5. Password-login attempt against the gate client returns explicit
     error (FR-004).
  6. `enabled=true → false` removes proxy + client without restarting
     tenant.
- Capture each as evidence under
  `specs/137-tenant-environment-access-gates/execution/verification.md`.
- Amend `spec.md`: `implementation: pending → complete`,
  `status: approved` (already from Phase 0), add `completed:` date.
  This is the lone PR that flips lifecycle (per amender→amended
  convention).

## Gating order

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6. Phase 1 + 2 can land in one PR
(schema + API). Phase 3 + 4 are tightly coupled (the Rauthy
provisioning shape drives what deployd-api consumes); recommend one
PR. Phase 5 (UI) lands separately so the API shape is locked first.
Phase 6 is the lifecycle PR; nothing else lands with it.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 0 clarifications drift during implementation | medium | Each phase's PR description cites the §Clarifications resolution it depends on; reviewer enforces "if the resolution changes, the PR is blocked, not the spec." |
| Rauthy admin API shape doesn't match assumed contract | medium | Phase 3 starts with a smoke that verifies the four contract assumptions (volume, deletion, password-login toggle, Auth Provider reference) before writing the wrapper. |
| oauth2-proxy + ingress-nginx chain breaks under load | low | Per-env proxy isolates blast radius; document the topology revisit criterion (pod count threshold) in the §Clarifications resolution. |
| Cookie secret leaks via statecraft DB | medium | **Amended 2026-05-17 (Phase 4↔5 integration).** Original mitigation assumed K8s-Secret-only storage. Migration 41 persists `rauthy_client_secret` + `cookie_secret` on `environment_access_gates` because: (a) Rauthy 0.35 admin GET never returns the client secret (T003 smoke) — statecraft must capture it at create time or lose it; (b) rotating cookie secrets per-deploy would invalidate every gate session. FR-007 is preserved: these are infrastructure credentials, NOT user passwords / hashes / upstream-IdP user tokens. v1 path is plaintext at rest in Postgres; KMS-backed encryption-at-rest is a follow-up spec when the secret-corpus footprint warrants it. |
| Spec 136 Phase 2.b Helm migration drift | medium | Phase 4 is renderer-agnostic — kube-rs path works today; if 136 Phase 2.b lands first, refactor Phase 4's renderer onto Helm overlay before merging. |
| `password_login_enabled: false` is bypassed by future Rauthy version | low | Phase 6 evidence includes a regression test that POSTs a password to the gate client and asserts the explicit error; future Rauthy bumps re-run this. |
| Email allowlist user-experience confusion (case sensitivity, domain vs email match precedence) | low | Phase 2 API normalises emails to lowercase; domain matches use case-insensitive suffix match; spec.md §Clarifications captures the precedence rule. |

## Out of scope (this spec)

- Passkey / WebAuthn login (`spec.md` §"Out of scope"; additive in a
  follow-up).
- Single sign-on across statecraft and tenants.
- Cross-environment shared sessions.
- Audit-log shape for gate-protected accesses (request-level audit is
  deployd-api / sidecar territory, not this spec).
- Tenant-side auth (the tenant remains free to layer its own).
- Auth Provider configuration UX in statecraft (admins configure
  upstream IdPs in Rauthy directly for v1).
- Self-service invitation flows for non-administrators.
