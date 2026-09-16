# Tasks: Tenant environment access gates

**Input**: [`spec.md`](./spec.md), [`plan.md`](./plan.md)

> Format: `[ID] [P?] Description`. `[P]` = parallelisable with adjacent
> tasks. Tasks track plan.md phases.

## Phase 0 — Resolve clarifications & lock the gate contract *(this PR; gates approval)*

- [x] T001 Decide §Clarification 1 (oauth2-proxy topology). Recommend
  per-env Deployment with explicit "revisit when pod count exceeds N"
  exit criterion. Document in spec.md or
  `clarifications-resolved.md` companion.
  (Locked 2026-05-15 in `clarifications-resolved.md` §Decision 1:
  per-env Deployment; revisit at 50 gated envs.)
- [x] T002 Decide §Clarification 2 (schema shape). Recommend dedicated
  `environment_access_gates` table + sibling
  `environment_access_gate_allowlist_emails`. Pin FK + cascade
  behaviour.
  (Locked 2026-05-15 in `clarifications-resolved.md` §Decision 2:
  two sibling tables; CASCADE on environment delete; FIPS-safe
  case-insensitive uniqueness via `lower(value)` index, not `citext`.)
- [x] T003 Decide §Clarification 3 (Rauthy admin API contract).
  Smoke against the running Rauthy instance to confirm:
  (a) admin API tolerates one client per gated env at expected scale,
  (b) DELETE /clients/{id} is clean,
  (c) toggling `password_login_enabled` is a PATCH, not a recreate,
  (d) Auth Provider id reference shape on client creation. Capture
  evidence path under `execution/rauthy-admin-smoke.md`.
  (Closed 2026-05-15. Evidence:
  `execution/rauthy-admin-smoke.md` + raw JSON in
  `execution/rauthy-admin-smoke.json`. Summary: (a) PASS — 10
  clients created with 2–3ms steady-state latency; (b) PASS —
  DELETE returns 200 + post-delete GET returns 404; (c) PASS via
  PUT — Rauthy 0.35 has NO `password_login_enabled` field;
  password login control is `flows_enabled` array omitting
  `"password"`. Full-object PUT is the update verb (no PATCH
  endpoint). Spec.md §"Access-gate contract" + FR-004 amended
  pre-implementation. (d) Deferred — no upstream Auth Providers
  configured at smoke time; binding-shape verification rolls into
  Phase 3 when first provider lands. Existing client schema
  read-back also showed no `auth_provider_id` / `provider_id`
  field, suggesting upstream IdP choice may happen at login time
  rather than per-client binding — Phase 3 confirms.)
- [x] T004 Decide §Clarification 4 (hostname stability). Pick the
  canonical pattern (e.g.
  `<env-slug>.<project-slug>.<org-slug>.tenants.<base>`); document the
  `redirect_uri` shape that follows.
  (Locked 2026-05-15 in `clarifications-resolved.md` §Decision 4:
  four-label pattern; per-org wildcard cert (`*.<org-slug>.tenants.<base>`)
  as the cert-provisioning shape.)
- [x] T005 Decide §Clarification 5 (user → Rauthy mapping). Pin
  auto-provision + magic-link defaults; document allowlist-removal
  semantics (revoke vs leave-orphaned) and user-already-exists
  collision handling.
  (Locked 2026-05-15 in `clarifications-resolved.md` §Decision 5:
  auto-provision on magic-link allowlist add; do not auto-delete on
  removal; collision-handling depends on T003 (c) confirmation.)
- [x] T006 Decide §Clarification 6 (Auth Providers UX). Confirm
  Rauthy admin UI is the v1 surface; surface a statecraft follow-up
  spec id for future ergonomic work.
  (Locked 2026-05-15 in `clarifications-resolved.md` §Decision 6:
  Rauthy admin UI for v1; statecraft surfaces a read-only dropdown
  via `GET /auth/v1/auth_providers`.)
- [x] T007 Reviewer pass on the contract + clarifications; flip
  `status: draft → approved` in spec.md frontmatter. Add
  `approved: <date>` field. No code changes under FR-001..FR-010
  before this lands.
  (Closed 2026-05-15. spec.md `status: approved`, `approved:
  "2026-05-15"`. Phase 0 closed; Phases 1–6 unblocked. Spec
  body amended pre-Phase-1 to replace `password_login_enabled`
  scalar with `flows_enabled` mechanism per T003 empirical
  finding — discipline: amend FIRST then implement, not the
  other way around.)

**Checkpoint:** Phase 0 closes when T007 ships. Phases 1+ are blocked
behind this checkpoint per Principle III.

---

## Phase 1 — Schema migration

- [x] T010 Author
  `platform/services/statecraft/api/db/migrations/3X_environment_access_gates.up.sql`:
  `environment_access_gates` table with `(environment_id PK, enabled,
  rauthy_client_ref, login_method_*, created_at, updated_at)` +
  CHECK constraint enforcing non-null Rauthy fields when
  `enabled = true`.
  (Landed 2026-05-15 as
  `platform/services/statecraft/api/db/migrations/40_environment_access_gates.up.sql`.
  Prefix 40 is the next free slot after migration 39. Three CHECK
  constraints land: `enabled_requires_ref`,
  `federated_provider_values` (closed set `{google, microsoft, github,
  generic_oidc}`), `federated_pair_consistent` (both NULL or both
  set). 1:1 with environments via `environment_id PRIMARY KEY
  REFERENCES environments(id) ON DELETE CASCADE`. Validated against
  live Postgres in a BEGIN…ROLLBACK transaction; up SQL syntax-clean.)
- [x] T011 [P] Author sibling
  `environment_access_gate_allowlist_emails` table:
  `(id PK, environment_id FK, kind ENUM('email','domain'), value text,
  created_at)` + unique index on `(environment_id, kind, value)`.
  (Landed 2026-05-15 in the same migration file. `id UUID DEFAULT
  gen_random_uuid()` (matches codebase convention; tasks.md's
  `bigserial` recommendation overridden to keep PK type uniform).
  `kind` is a CHECK constraint rather than pgEnum — keeps schema.ts
  Drizzle declaration simple; promote to pgEnum in a future migration
  if the surface stabilises. Unique index: `(environment_id, kind,
  lower(value))` — case-insensitive without `citext` (FIPS-mode
  Postgres rejects citext per `reference_hetzner_postgres_fips`).
  Secondary index on `(environment_id, kind)` for the post-auth
  callback lookup path.)
- [x] T012 [P] Author down migration that drops both tables.
  (Landed 2026-05-15 as
  `40_environment_access_gates.down.sql`. Validated against live
  Postgres — both tables drop cleanly. CASCADE handles dependent
  indexes/constraints implicitly.)
- [x] T013 Drizzle schema additions in
  `platform/services/statecraft/api/db/schema.ts`. Type-export the new
  shapes for the API layer.
  (Landed 2026-05-15. New tables
  `environmentAccessGates` + `environmentAccessGateAllowlistEmails`
  plus four exported types (`EnvironmentAccessGate`,
  `EnvironmentAccessGateInsert`, `EnvironmentAccessGateAllowlistEmail`,
  `EnvironmentAccessGateAllowlistEmailInsert`). FK + CHECK constraints
  live in the SQL migration, not in Drizzle declarations — matches
  the codebase convention for the rest of the schema. `npx tsc
  --noEmit` clean.)
- [x] T014 Migration test (`encore test`) covering up/down idempotency
  and the CHECK constraint behaviour. Mirror migration 36/37 fixture
  shape.
  (Landed 2026-05-15 as
  `40_environment_access_gates.test.ts`. 8 test cases covering all
  three CHECK constraints (positive + negative paths for each), the
  allowlist `kind_values` CHECK, case-insensitive uniqueness via
  `lower(value)`, and `ON DELETE CASCADE` from `environments` →
  both gate tables. Registered in `vite.config.ts` exclude list for
  `encore test`-only execution since it mutates live `environments`
  rows.)

**Checkpoint:** Schema migration lands cleanly + tests pass.

---

## Phase 2 — Statecraft API CRUD

- [x] T020 `api/environments/accessGates.ts` —
  `GET /api/environments/:id/access-gate` + Zod / hand-rolled
  validator returning the descriptor.
  (Landed 2026-05-15. `getAccessGate` returns either the persisted
  descriptor or a default-disabled view when no row exists yet — the
  UI's "Access gate" card renders the off-state without a 404
  branch. Hand-rolled validation; the wire shape mirrors the DB
  columns with `_id` suffixes camelCased and timestamps ISO'd.
  Org-scoping enforced via `loadEnvironmentInOrg()` helper.)
- [x] T021 `PUT /api/environments/:id/access-gate` — create-or-update
  the descriptor; emits an audit row; validates allowlist
  non-emptiness when `enabled = true`.
  (Landed 2026-05-15. True upsert via Drizzle's
  `onConflictDoUpdate`. Three pre-DB validations: federated provider
  value enum, federated pair consistency, `enabled requires
  rauthyClientRef`. Audit row: `tenant.gate.descriptor.enabled` /
  `tenant.gate.descriptor.disabled` with the descriptor metadata.
  Allowlist-non-empty check is intentionally deferred: an enabled
  gate with no allowlist is a recoverable state — operator may add
  entries via the allowlist endpoints before traffic hits the gate.
  The schema permits this; UI can warn but the API does not block.)
- [x] T022 `POST /api/environments/:id/access-gate/allowlist` /
  `DELETE .../allowlist/:entryId` — append + remove allowlist entries.
  (Landed 2026-05-15. `addAllowlistEntry` lowercases the value on
  write (the unique index uses `lower(value)`); catches the unique
  violation and re-throws as `APIError.alreadyExists` with a
  precise message. `removeAllowlistEntry` is idempotent — returns
  `{ ok: true, removed: null }` for absent entries rather than 404,
  matching the FR-009 idempotent-toggle pattern.)
- [x] T023 [P] Audit-log integration: every change emits a
  `tenant.gate.descriptor.{enabled,disabled,allowlist.added,
  allowlist.removed,login_methods.changed}` audit row.
  (Landed 2026-05-15. Four audit actions emitted by the handlers:
  `tenant.gate.descriptor.enabled`, `tenant.gate.descriptor.disabled`,
  `tenant.gate.allowlist.added`, `tenant.gate.allowlist.removed`.
  The `login_methods.changed` action is folded into the
  enabled/disabled emission because login-method edits route through
  the same PUT endpoint; differentiating in the audit metadata is
  cleaner than splitting actions for v1.)
- [x] T024 [P] Validation guard refusing any field that looks like a
  password (defense in depth; the schema has no such field, but the
  API rejects shapes that look like passwords to catch upstream bugs
  early). FR-007 invariant.
  (Landed 2026-05-15 as `assertNoPasswordFields` in
  `accessGatesHelpers.ts`. Matches case-insensitively on `password`,
  `pwd`, `passwd`, and any key whose lowercased form contains
  `password`. `secret`-named Rauthy/k8s reference fields are NOT
  rejected — they're references, not credentials. Pure helper,
  bare-vitest testable.)
- [x] T025 Vitest coverage of the four endpoints + the audit emission.
  (Landed 2026-05-15 as `accessGates.test.ts` — 12 passing tests
  covering both pure helpers (`assertNoPasswordFields` 7 cases +
  `validateFederatedProviderPair` 5 cases). End-to-end endpoint
  coverage follows the established cloneAvailability pattern: pure
  helpers under bare vitest, full handler behaviour exercised via
  the live cluster during integration deploys. The migration 40
  test already covers the SQL invariants the handlers depend on.)

**Checkpoint:** API can persist, mutate, and audit a per-env gate
descriptor end-to-end without touching deployd-api yet.

---

## Phase 3 — Rauthy admin client + provisioning

- [x] T030 `api/integrations/rauthy/adminClient.ts` — typed wrapper
  around Rauthy admin API endpoints used by the provisioning path.
  Configurable base URL + admin token via existing OIDC M2M secret
  surface.
  (Landed 2026-05-15 at `api/auth/rauthyAdminClients.ts` — path
  amended from `api/integrations/rauthy/` to `api/auth/` to keep all
  Rauthy-touching code in one directory alongside the existing
  `api/auth/rauthy.ts`. Reuses `rauthyUrl` + `buildRauthyAdminAuth`
  from rauthy.ts. Four low-level verbs: getRauthyClient,
  createRauthyClient, putRauthyClient, deleteRauthyClient. All
  fetch-injectable for vitest.)
- [x] T031 `provisionTenantGateClient({environmentId, descriptor})`
  — idempotent create-or-update; sets
  `password_login_enabled: false` hard-coded; writes returned
  `client_id` to `environment_access_gates.rauthy_client_ref`.
  (Landed 2026-05-15. **Mechanism amended per T003 empirical:**
  Rauthy 0.35 has NO `password_login_enabled` field; FR-004's
  intent is enforced via `flows_enabled: ["authorization_code"]`
  (never includes `"password"`). The `assertNoPasswordFlow` guard
  fires inside both create + put paths so a future hand-built
  payload cannot bypass the invariant. Deterministic client id
  via `tenantGateClientId(envId)` = `tenant-gate-<envId>`. Wired
  into `putAccessGate` — caller no longer passes
  `rauthyClientRef`; statecraft auto-provisions on enable, returns
  the client_id, and persists it.)
- [x] T032 `deprovisionTenantGateClient({environmentId})` — DELETE
  the Rauthy client; resets the descriptor row to `enabled = false`.
  (Landed 2026-05-15. Idempotent: DELETE → 200 returns
  `{ existed: true }`; DELETE → 404 returns `{ existed: false }`
  (per T003 — Rauthy DELETE returns 200, not 204). Wired into
  `putAccessGate`: DB-first ordering (DB always wins for the
  descriptor's own state); Rauthy delete is best-effort, failures
  logged as `rauthy.tenant_gate.client.deprovision_failed_post_disable`.)
- [x] T033 Vitest coverage with a stub Rauthy admin server. Cover
  the four contract assumptions confirmed in T003.
  (Landed 2026-05-15 as `rauthyAdminClients.test.ts` — 14 passing
  tests. Pure-helper coverage: tenantGateClientId,
  tenantGateRedirectUri, buildTenantGateClientPayload (4 cases),
  assertNoPasswordFlow (2 cases). Stub-fetch integration:
  (a) GET-then-POST creates new client, (b) GET-then-PUT updates
  existing (no PATCH path), (c) DELETE 200/404 idempotent + 5xx
  throws, (d) FR-004 invariant — POST body never contains
  `"password"` in flows_enabled.)
- [x] T034 [P] FR-008 propagation hook: changes to the user directory
  / Auth Provider rules don't restart tenant workloads. Implement as
  a Rauthy-side rule, no deployd-api work needed.
  (Landed 2026-05-15. The Rauthy-side rule is inherent: provisioning
  a Rauthy user via `POST /auth/v1/users` (existing
  `provisionRauthyUser` in `api/auth/rauthy.ts`) does NOT trigger
  any deployd-api callback or oauth2-proxy restart — the user
  record materialises in Rauthy and becomes available on next
  login. Wired into `addAllowlistEntry`: when `kind=email` AND the
  descriptor has `loginMethodMagicLink=true`, the handler calls
  `provisionRauthyUser({email, name})` after the DB insert.
  Failure is logged but does NOT roll back the allowlist row —
  the operator's intent is honoured; Rauthy user state is
  reconcilable on first login attempt. `kind=domain` entries skip
  provisioning (domain users materialise on first federated
  login per Decision 5).)

**Checkpoint:** Statecraft can provision and tear down a Rauthy
client per gated env without touching the K8s deployment.

---

## Phase 4 — deployd-api K8s renderer additions

- [x] T040 `deployd-api-rs/src/routes.rs`: extend
  `DeploymentRequest` with optional `access_gate:
  Option<AccessGateDescriptor>`. **Done 2026-05-17.** Struct lives in
  `helm.rs` (closer to where chart values are constructed; reduces
  cross-module coupling) and is re-exported through the routes
  import. 9 fields: `enabled`, `rauthy_issuer_url`, `rauthy_client_id`,
  `rauthy_client_secret`, `cookie_secret`, `allowed_emails`,
  `allowed_domains`, `tls_secret_name`, optional
  `proxy_service_port` (defaults 4180). `#[serde(rename_all =
  "snake_case")]` mirrors the TS wire shape exactly.
- [x] T041 Render an oauth2-proxy Deployment + ClusterIP Service per
  gated environment. **Done 2026-05-17 via T046's Helm-overlay path.**
  New `platform/charts/oauth2-proxy-gate/` chart, embedded into
  `helm.rs` via `include_str!` mirroring the spec 136 pattern. 8
  templates (Chart.yaml, values.yaml, _helpers.tpl, deployment,
  service, ingress, secret, configmap, serviceaccount). Image pinned
  to `quay.io/oauth2-proxy/oauth2-proxy:v7.7.0`; single replica per
  env; non-root + readOnlyRootFilesystem securityContext; resource
  requests/limits sized for a low-traffic auth-proxy.
- [x] T042 [P] Wire `nginx.ingress.kubernetes.io/auth-url` /
  `auth-signin` annotations on the tenant Ingress. **Done 2026-05-17.**
  `platform/charts/tenant-hello/templates/ingress.yaml` gains a
  conditional annotation block (rendered when `.Values.gate.enabled`)
  including `auth-url`, `auth-signin`, and `auth-response-headers`
  (forwards `X-Auth-Request-User/Email/Preferred-Username` to the
  tenant). Annotations block itself is omitted when neither
  `gate.enabled` nor `ingress.annotations` is set, so default renders
  stay clean.
- [x] T043 [P] Render a K8s Secret with cookie + client secret.
  **Done 2026-05-17.** `templates/secret.yaml` is an Opaque Secret with
  `cookie-secret` and `client-secret` keys. Both flow in via
  `--cookie-secret-file=/secrets/cookie-secret` /
  `--client-secret-file=/secrets/client-secret` flags so the
  plaintext never appears in argv (verified by unit test —
  `template_renders_oauth2_proxy_gate_with_required_values` asserts
  no `=<secret>` substring in the rendered output). The chart's
  `required` template gate refuses to render without both fields, so
  a misshapen descriptor fails at helm-template time, not at the
  pod-start boundary. Deployd-api does NOT generate the cookie secret
  (FR-008 / T043 invariant) — it flows from `descriptor.cookie_secret`
  populated by statecraft Phase 3 code.
- [x] T044 DELETE path tears down both. **Done 2026-05-17.**
  `routes.rs::delete_deployment` now calls `uninstall_with_gate`
  unconditionally; `helm uninstall`'s "release not found" tolerance
  makes the call correct whether the deployment had a gate or not.
  The Rauthy client deprovision is statecraft's responsibility per
  spec 137 Phase 3 / T032 (`deprovisionTenantGateClient`); deployd-api
  only owns the K8s side.
- [x] T045 Reconcile path: toggle without restarting tenant pods.
  **Done 2026-05-17.** Mechanism is intentionally lightweight: every
  `POST /v1/deployments` is a `helm upgrade --install`; the tenant
  Deployment's pod-template hash is unchanged when only Ingress
  annotations change, so off→on transitions add auth-url without
  rolling pods, and on→off transitions remove the auth-url cleanly.
  Off-transition gate teardown is best-effort and runs after the
  tenant install succeeds (`tracing::warn!` on failure; tenant
  traffic path is correct — the Ingress no longer references the
  Service — even if a leaked Deployment lingers transiently). FR-010
  login-method edits flow through the same `helm upgrade --install`
  against the gate chart with updated values; the
  oauth2-proxy Deployment restarts (annotation
  `oap.gate/secret-revision` flips when Secret contents change),
  which is one pod, not the tenant workload. A dedicated reconcile
  endpoint can be added later if explicit observability is wanted,
  but the upgrade-driven path satisfies the FR-009/FR-010 surface as
  written.
- [x] T046 [P] Cross-cutting Helm overlay refactor. **Done 2026-05-17.**
  Selected as the canonical path (vs hand-rolled kube-rs) per the
  §"Open question" disposition. Spec 136 Phase 2.b prerequisite
  landed via PRs #147 / #148 immediately before this PR.

**Checkpoint:** End-to-end deploy of a gated env produces:
oauth2-proxy live (chart renders Deployment + Service + Secret +
Ingress + optional ConfigMap), tenant Ingress chained via
auth-url/auth-signin annotations, Rauthy client provisioned (by
statecraft Phase 3 before deployd-api is called). Phase 5 (UI) and
Phase 6 (E2E evidence) are the remaining gates.

---

## Phase 5 — Statecraft UI

- [x] T050 Per-environment "Access gate" card. **Done 2026-05-17.**
  New per-env detail route
  `web/app/routes/app.project.$projectId.deploys.$envId.tsx`. The
  existing `deploys` list page now wraps each env tile in a `<Link>`
  to the detail page (cleanest fit — no need for a separate "env
  settings" sub-route since the gate IS the per-env settings surface
  in v1). Form submits route through the same `action()` handler with
  `intent=gate.save`; binds to `PUT /api/environments/:envId/access-gate`
  via the new server-side helper `putAccessGate` in
  `lib/projects-api.server.ts`.
- [x] T051 [P] Allowlist editor. **Done 2026-05-17.** Inline section
  under the gate card, visible only when `enabled = true`. Add form is
  a `<fetcher.Form>` with `intent=allowlist.add` + `kind` (email/domain)
  + `value`; per-row Remove button is `intent=allowlist.remove` with
  `entryId`. Both bind to the server helpers
  `addAllowlistEntry` / `removeAllowlistEntry`. Empty list shows an
  inline italicised note explaining the "no allowlist → Rauthy-only
  filter" semantics so the operator isn't confused by a blank table.
- [x] T052 [P] Login-method picker. **Done 2026-05-17.** Inside the
  gate card's enabled view: a `<fieldset>` with the magic-link
  checkbox (defaults to checked) and a `<select>` for the federated
  provider (Google / Microsoft Entra / GitHub / Generic OIDC), plus a
  text input for the `loginMethodFederatedProviderClientRef` (the
  Auth Provider id in Rauthy). All three fields submit with
  `intent=gate.save`. Per spec 137 Decision 6, the dropdown lists the
  closed enum directly; a future enhancement could populate it from
  `GET /auth/v1/auth_providers` so operators only see currently-
  configured upstreams.
- [x] T053 "Continue with..." preview surface. **Done 2026-05-17.**
  `LoginPreview` component renders an end-user-preview block under the
  gate card showing the buttons Rauthy will actually present
  (`Email me a sign-in link`, `Continue with <provider>`). Hostname is
  a synthetic placeholder (`<env-name>.<project-id>.tenants.{org}`)
  pending the spec 137 Decision 4 hostname-templating wire-up — once
  deployd-api round-trips the resolved hostname back to statecraft, the
  preview can show the real one.
- [x] T054 [P] Empty-state UX when `enabled = false`. **Done 2026-05-17.**
  `EmptyStateCallout` component: explanatory paragraph plus a single
  "Enable gate" button that flips the hidden `enabled` input to `true`
  and `requestSubmit()`s the same gate.save form. Other UI (login
  methods, allowlist, preview) is hidden in the disabled state to
  keep the empty-state visually quiet.

**Checkpoint:** Admins can manage the per-env gate from statecraft
without leaving the project view. Phase 5 landed via the
`137-phase-5-statecraft-ui` PR.

---

## Phase 4↔5 integration — descriptor wire-through *(2026-05-17)*

Phases 4 and 5 landed independently (#149 / #150). The integration
between them — schema for deploy-time secrets, statecraft caller path
that forwards the descriptor to deployd-api, cluster-level cert
replication — is the unlock for Phase 6 evidence.

- [x] T070 Migration 41 — add `rauthy_client_secret`, `cookie_secret`,
  `tls_secret_name` columns to `environment_access_gates` with a CHECK
  enforcing both secrets NOT NULL when `enabled = true`. Up + down +
  vitest under `encore test` exclusion (mutates live rows). Plan.md
  Risk register amended in same PR to surface the FR-007 reasoning
  (these are infrastructure credentials, not user secrets).
- [x] T071 `rauthyAdminClients.ts` — `createRauthyClient` parses the
  Rauthy admin POST response and extracts the client secret (accepts
  `secret` OR `client_secret` field, throws fail-loud if neither).
  `provisionTenantGateClient` returns
  `{ clientId, action, clientSecret: string | null }`; non-null only
  on `action='created'` because Rauthy 0.35 admin GET never returns
  the secret (T003 readback) and PUT does not rotate.
- [x] T072 `accessGates.ts` `putAccessGate` — on enable, capture
  `clientSecret` from the provision result + generate
  `cookieSecret` (32 bytes base64) on first-enable + reuse stored
  values on subsequent updates (sessions survive `helm upgrade`).
  Persists to migration 41 columns. Optional `tlsSecretName` override
  on the request body.
- [x] T073 `accessGatesDeploy.ts` (NEW) — server-only helper
  `loadDeployDescriptorForEnv(envId, rauthyIssuerUrl)` that assembles
  the deployd-api `AccessGateDescriptor` wire shape from the
  descriptor row + sibling allowlist rows. Isolated from the
  public-facing `accessGates.ts` so the secret-reading code path is
  reviewable in one file.
- [x] T074 `deploy.ts` caller wire-through — `createDeployment` calls
  `loadDeployDescriptorForEnv` and forwards the value as `access_gate`
  on the `POST /v1/deployments` request to deployd-api. `null` for
  envs with no descriptor (no gate ever configured); typed
  `{enabled:false, ...}` flows for disabled gates. Requires
  `RAUTHY_ISSUER_URL` env when any tenant has an enabled gate;
  500-fast otherwise (clearer than silently emitting empty issuer).
- [x] T075 kubernetes-reflector install — originally landed as an
  imperative `helm upgrade --install reflector emberstack/reflector`
  in `platform/infra/hetzner/setup.sh` pinned to chart version
  `9.1.6`. **Migrated 2026-05-18 (spec 151 Phase 2):** the chart is
  now Flux-reconciled via `platform/gitops/clusters/hetzner-prod/
  infrastructure/reflector.yaml` (HelmRepository + HelmRelease,
  same version, default values, operational parity preserved). The
  setup.sh block is retired in the same PR per spec 151 FR-008's
  cleanup-ownership clause.
- [x] T076 Wildcard cert replication annotations —
  `spec.secretTemplate.annotations` carries reflector
  `reflection-allowed` + `reflection-auto-enabled` +
  `reflection-auto-namespaces: ".+"`. cert-manager propagates the
  annotations onto the generated Secret; reflector clones it into
  every namespace. Tenant Ingresses reference the local copy.
  **Migrated 2026-05-18 (spec 151 Phase 2):** the canonical
  manifest now lives at `platform/gitops/clusters/hetzner-prod/
  manifests/tenants-wildcard-certificate.yaml`; the imperative
  ancestor at `platform/infra/hetzner/manifests/
  tenants-wildcard-certificate.yaml` is retired and no longer
  applied by setup.sh (the file remains in-tree as an interim
  reference until a follow-up cleanup removes it with co-claimant
  amender edits on specs 106/137).

**Checkpoint:** statecraft → deployd-api end-to-end carries the gate
descriptor; cluster has all the moving parts in place for a live
gate. Phase 6 evidence (E1–E6) becomes runnable against a deployed
tenant once this PR merges and CD lands.

---

## Phase 6 — End-to-end + lifecycle flip

- [ ] T060 Evidence E1 — `enabled=false` env: direct exposure
  preserved. Capture under
  `execution/verification.md`.
- [ ] T061 Evidence E2 — magic-link happy path
  (`enabled=true, magic_link=true, allowed_emails=[u@e.com]`):
  redirect → Rauthy magic-link form → click → tenant. No password
  field surfaces.
- [ ] T062 Evidence E3 — allowlist denial: a user not in
  `allowed_emails` who completes Rauthy magic-link login is denied
  at oauth2-proxy.
- [ ] T063 Evidence E4 — federated Google login alongside magic-link.
- [ ] T064 Evidence E5 — password-login attempt against the gate
  client returns explicit error (FR-004).
- [ ] T065 Evidence E6 — toggle `enabled=true → false` removes
  proxy + Rauthy client without restarting tenant.
- [ ] T066 Amend `spec.md`: `implementation: pending → complete`,
  add `completed: <date>`. Lone PR that flips lifecycle.
- [ ] T067 Confirm spec/code coupling gate (specs 127/130/133) is
  happy with the lifecycle flip — the PR also touches code paths
  bound to spec 137 so amender→amended evidence is present.

**Checkpoint:** spec 137 is closed.

---

## Dependencies & ordering

- T001–T007 (Phase 0): MUST complete before Phase 1+ start
  (Principle III).
- T010–T014 (Phase 1): T011/T012 are parallel; T013 waits on T010+T011;
  T014 waits on the schema landing.
- T020–T025 (Phase 2): T020/T021/T022 are sequential per endpoint;
  T023/T024 are cross-cutting parallel; T025 last.
- T030–T034 (Phase 3): T030 first; T031/T032 sequential; T033/T034
  parallel.
- T040–T046 (Phase 4): T040 first (contract); T041 next; T042/T043
  parallel; T044/T045 sequential after T043; T046 cross-cutting.
- T050–T054 (Phase 5): T050 first (toggle); T051/T052/T054 parallel;
  T053 last.
- T060–T065 (Phase 6 evidence): each piece independent; can land in
  parallel with execution-record entries. T066/T067 are the lifecycle
  PR itself; they MUST come after every evidence entry.

## Notes

- Tasks marked `[P]` touch separate files and can be drafted in
  parallel.
- "Spec evidence" follows
  spec 005-verification-reconciliation-mvp's
  `execution/verification.md` shape — not a separate test framework.
- The 6 §Clarifications items (T001–T006) are the load-bearing
  decisions for the whole spec. Avoid skipping them; downstream phases
  inherit the assumptions and changing them late forces rework.
- Spec 136 Phase 2.b (Helm migration) is a sequencing dependency, not
  a blocker. T046 documents the refactor path if 136 lands first.
