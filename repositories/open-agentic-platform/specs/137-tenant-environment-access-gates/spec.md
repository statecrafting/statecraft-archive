---
id: "137-tenant-environment-access-gates"
title: "Tenant environment access gates — passwordless OIDC via Rauthy"
status: approved
implementation: in-progress  # Phase 0 closed 2026-05-15 (5/6 clarifications locked + T003 Rauthy admin smoke). Phase 1 (schema migration: tables environmentAccessGates + environmentAccessGateAllowlistEmails with 3 CHECK constraints and FIPS-safe lower(value) uniqueness), Phase 2 (CRUD endpoints + audit hooks + assertNoPasswordFields guard), Phase 3 (Rauthy admin client wrapper + provisionTenantGateClient + idempotent deprovision; flows_enabled mechanism replaces non-existent password_login_enabled scalar) all landed 2026-05-15. Phase 4 (deployd-api Helm overlay) landed 2026-05-17 — new oauth2-proxy-gate chart embedded via include_str! per spec 136 Phase 2.b pattern; AccessGateDescriptor wire shape on DeploymentRequest; install_with_gate / uninstall_with_gate orchestration with FR-003 atomicity (tenant rolls back if gate install fails); tenant chart Ingress renders nginx auth-url/auth-signin annotations conditionally on gate.enabled; reconcile-on-off-transition cleans up stale gate releases. Phase 5 (statecraft UI) landed 2026-05-17 — new per-env detail route hosts the gate card + allowlist editor + login-method picker + end-user preview + empty-state CTA, wired to Phase 2's PUT/POST/DELETE endpoints via new server-side fetch helpers. Phase 4↔5 integration landed 2026-05-17 (T070–T076) — migration 41 adds deploy-descriptor secret columns (rauthy_client_secret + cookie_secret + tls_secret_name) with CHECK enabled_requires_secrets; provisionTenantGateClient now captures the Rauthy client secret (corrected 2026-06-30: read back via POST /auth/v1/clients/{id}/secret, since the Rauthy 0.35 create response carries no secret field; see the "Rauthy secret retrieval" empirical correction below); putAccessGate generates cookie_secret on first enable + persists secrets; new accessGatesDeploy.ts assembles the deployd-api wire shape from descriptor row + sibling allowlist; deploy.ts caller forwards access_gate on POST /v1/deployments; kubernetes-reflector installed via setup.sh (chart 9.1.6) replicates the wildcard cert Secret into tenant namespaces via reflector annotations on the Certificate's secretTemplate. Phase 6 (E1–E6 evidence + lifecycle flip) remains.
approved: "2026-05-15"
amended: "2026-06-16"
amendment_record: |
  Amended 2026-06-16 by 214-tenant-app-chart-supersession (Stage 2): the two
  access-gate co_authority units that pointed at the retired tenant-hello
  chart files are relocated to the acme-vue-encore chart equivalents
  (values.yaml + templates/ingress.yaml, anchor access-gate), co-authored with
  214 (the new chart owner) instead of 136. The gate seam semantics are
  unchanged (FR-011 render parity was proven before the retirement). 214 also
  locks the tenant hostname convention (FR-007), resolving this spec's
  Clarification 4 sketch: a single DNS label {org}--{project}--{env} under
  tenants.{base}, the single-level wildcard cert being the binding constraint.
owner: bart
created: "2026-05-04"
kind: platform
domain: platform
risk: medium
depends_on:
  - "136-tenant-hello-demo-service"  # tenant-hello as reference; gates are added per-environment
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (environments are statecraft entities)
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/environments/accessGates.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/environments/accessGatesHelpers.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/environments/accessGates.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/environments/encore.service.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/auth/rauthyAdminClients.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/auth/rauthyAdminClientsHelpers.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/auth/rauthyAdminClients.test.ts }
  - unit: { kind: directory, path: platform/charts/oauth2-proxy-gate }
  - unit: { kind: file, path: platform/services/statecraft/api/environments/accessGatesDeploy.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.deploys.$envId.tsx }
extends:
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.deploys.tsx }
  - spec: "136-tenant-hello-demo-service"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
co_authority:
  - with_specs:
      - "214-tenant-app-chart-supersession"
    unit: { kind: section, file: platform/charts/acme-vue-encore/values.yaml, anchor: access-gate }
  - with_specs:
      - "214-tenant-app-chart-supersession"
    unit: { kind: section, file: platform/charts/acme-vue-encore/templates/ingress.yaml, anchor: access-gate }
  - with_specs:
      - "073-axiomregent-unification"
      - "136-tenant-hello-demo-service"
    unit: { kind: section, file: platform/services/deployd-api-rs/src/helm.rs, anchor: gate-overlay }
  - with_specs:
      - "073-axiomregent-unification"
      - "136-tenant-hello-demo-service"
    unit: { kind: section, file: platform/services/deployd-api-rs/src/routes.rs, anchor: gate-overlay }
  - with_specs:
      - "077-statecraft-factory-api"
    unit: { kind: section, file: platform/services/statecraft/api/deploy/deploy.ts, anchor: access-gate-wire }
  - with_specs:
      - "072-multi-cloud-k8s-portability"
      - "106-rauthy-native-oidc-and-membership"
      - "143-presigned-upload-public-endpoint"
    unit: { kind: section, file: platform/infra/hetzner/setup.sh, anchor: reflector-install }
  - with_specs:
      - "106-rauthy-native-oidc-and-membership"
    unit: { kind: section, file: platform/infra/hetzner/manifests/tenants-wildcard-certificate.yaml, anchor: reflector-annotations }
summary: >
  Per-environment access gating for projects deployed via deployd-api,
  applied above the tenant app so tenant codebases carry no auth logic.
  Passwordless OIDC via our existing Rauthy instance is the only mode —
  users authenticate by magic link or federated upstream IdP (Google,
  Microsoft Entra, GitHub, generic OIDC). Statecraft and Rauthy clients
  for tenant gates are configured to refuse password login outright;
  the platform never sees, stores, or relays a password.
---

# Feature Specification: Tenant environment access gates

**Feature Branch**: `137-tenant-environment-access-gates`
**Created**: 2026-05-04
**Status**: Draft
**Input**: Tenant projects deployed through deployd-api need optional access
gating that lives in the platform layer (ingress + auth proxy), not in the
tenant codebase. Passwordless only, OIDC via Rauthy only — magic link
and/or federated upstream IdP. No basic auth, no shared passwords, no
password-handling code anywhere in the platform.

## Purpose and charter

Tenant deployments today are exposed as-is on the cluster ingress. There is
no platform-level gate, so every tenant either ships its own auth
implementation (which doubles work for low-stakes pre-launch environments)
or runs unprotected (which leaks pre-launch URLs to anyone with the
hostname). This spec adds an **opt-in, passwordless OIDC gate** the
platform owns:

- `oauth2-proxy` (or equivalent auth-request handler) sits in front of
  each gated tenant Ingress.
- The proxy authenticates against our existing **Rauthy** instance
  (`platform/charts/rauthy/`) using a per-environment OIDC client.
- The Rauthy client has `password_login_enabled: false`. Users reach the
  tenant by completing one of:
  - **Magic link** — Rauthy's built-in passwordless email login. The
    user enters their email, Rauthy mails a one-time link, the click
    completes the OIDC flow.
  - **Federated upstream IdP** — Rauthy's "Auth Providers" feature
    delegates to an upstream OIDC: Google, Microsoft Entra, GitHub, or
    any generic OIDC provider. Rauthy mints its own tokens after
    upstream validation; oauth2-proxy sees only Rauthy.
- Allowlist enforcement is two-layered: Rauthy completes login only for
  users in its directory (or whose upstream-IdP identity matches the
  configured Auth Provider rules), and oauth2-proxy validates the
  returned email against `allowed_emails` / `allowed_domains` on the
  post-auth callback.

Statecraft and the tenant app **never** see passwords or upstream IdP
tokens. The only identity material that crosses into statecraft's data
plane is the post-authentication subject (email + sub), and only if the
tenant app explicitly reads it from forwarded headers.

**Explicitly in scope:**

- A schema field on `environments` describing the gate (on/off + Rauthy
  client reference + allowlist).
- A contract addition to `POST /v1/deployments` carrying that descriptor
  through to deployd-api.
- deployd-api rendering the K8s objects for an enabled gate
  (oauth2-proxy Deployment + Service, Rauthy client provisioned via
  Rauthy's admin API, Ingress annotated with `auth-url`/`auth-signin`).
- Statecraft UI for managing the gate per environment: toggle on/off,
  edit allowlist, choose which login methods Rauthy surfaces (magic
  link, federated, or both).
- A Rauthy client provisioning path: statecraft creates one OIDC client
  per gated environment via Rauthy's admin API.

**Explicitly out of scope:**

- Basic auth, shared passwords, htpasswd Secrets, or any other
  password-bearing mechanism. Removed by directive.
- Tenant app-level auth (the tenant remains free to layer its own).
- Replacing Rauthy with a different IdP — Rauthy is the chosen primitive.
- Single sign-on across statecraft and gated tenant environments — its
  own design decision and would inherit from this spec, not the other
  way around.
- Email allowlist UX for non-administrators (this spec only covers the
  admin path; self-service invitation flows are separate).
- Passkey / WebAuthn login. Rauthy supports it but this spec scopes to
  the two requested methods (magic link + federated). A follow-up spec
  can enable passkey on existing tenant clients without schema change.

## Current state vs intent

**Current state:**
- `environments` (`platform/services/statecraft/api/db/schema.ts:219-233`)
  has `projectId, name, kind, k8sNamespace, autoDeployBranch,
  requiresApproval`. No access-gate field.
- deployd-api's `POST /v1/deployments` contract
  (`platform/services/deployd-api-rs/src/routes.rs:19-30`) takes
  `tenant_id, app_id, env_id, release_sha, artifact_ref, lane,
  app_slug?, env_slug?, desired_routes?`. No gate descriptor.
- deployd-api's K8s renderer
  (`platform/services/deployd-api-rs/src/k8s.rs:51-82`) creates raw
  `Deployment + Service + Ingress` with no auth annotations.
- Rauthy is deployed (`platform/charts/rauthy/`) and serves statecraft's
  own auth, but no tenant Ingress has ever been configured against it,
  and no Auth Providers (Google/Microsoft/GitHub upstreams) are
  configured today.
- ingress-nginx is the cluster ingress controller (per
  `platform/CLAUDE.md`); `auth-url` / `auth-signin` annotations are
  available natively for chaining to oauth2-proxy.

**Intent:**
- Per-environment gate descriptor with `enabled: bool` + Rauthy client
  reference + allowlist + login-method config.
- Secret material (oauth2-proxy cookie secrets, Rauthy client secrets)
  lives in K8s Secrets, never in statecraft Postgres. No password hashes
  exist anywhere in the platform.
- deployd-api's create-deployment path provisions the gate atomically
  with the tenant Deployment when `enabled: true`; the destroy path
  tears it down.
- Per-environment oauth2-proxy + per-environment Rauthy client gives
  isolation; pod count is bounded by the count of gated environments,
  not tenants.

## Access-gate contract *(normative)*

Stored on `environments` (or in a sibling table — see Clarifications):

```
access_gate:
  enabled: bool

  # Required when enabled == true
  rauthy_client_ref: <client_id allocated in Rauthy>
  allowed_emails: [<email>...]     # explicit allowlist; matched case-insensitively
  allowed_domains: [<domain>...]   # e.g., "example.com"; matched against email suffix
  login_methods:
    magic_link: bool               # default true
    federated:                     # null = federated login disabled
      provider: "google" | "microsoft" | "github" | "generic_oidc"
      provider_client_ref: <Auth Provider id configured in Rauthy>
```

Rauthy clients created per gated environment carry:
- `redirect_uris`: the oauth2-proxy callback for that environment's
  hostname (Rauthy 0.35 field is a plural array, not scalar).
- `allowed_origins`: the tenant hostname(s) (web-origin allowlist).
- `scopes`: `openid email profile` only — no app-specific claims.
- `flows_enabled`: subset of `{authorization_code}` (plus
  `refresh_token` if long-lived sessions are wanted). **`"password"`
  is never present in this array.** This is the load-bearing
  constraint that keeps the platform out of password handling.

  *Empirical correction (T003, 2026-05-15).* Earlier drafts of this
  spec listed a `password_login_enabled: false` scalar field. The
  Rauthy 0.35 admin API probe in
  [`execution/rauthy-admin-smoke.md`](./execution/rauthy-admin-smoke.md)
  confirmed no such field exists on the client record (14-field
  schema captured verbatim). Password login is controlled via
  `flows_enabled`, omitting `"password"`. The load-bearing intent
  (platform never sees passwords) is preserved verbatim; the
  mechanism is the array, not a scalar flag. Pre-implementation
  spec amendment per the
  `feedback_pre_implementation_spec_amendments` discipline:
  amend FIRST, implement against amended spec.

  *Empirical correction (Rauthy secret retrieval, 2026-06-30).* The
  Phase 4↔5 integration claimed `provisionTenantGateClient` "captures the
  Rauthy client secret from the POST response". That was never true on
  Rauthy 0.35: `POST /auth/v1/clients` returns a `ClientResponse` that has
  no secret field at all (verified against rauthy v0.35.0 source). The
  T003 smoke recorded only the create timing and a GET read-back schema,
  so it never actually observed a secret on create. The real contract is
  a second call: `POST /auth/v1/clients/{id}/secret` (a POST on purpose so
  the read carries a CSRF check) returns
  `ClientSecretResponse { id, confidential, secret }`. `createRauthyClient`
  now creates, then reads the secret back from that endpoint; the new
  `fetchRauthyClientSecret` helper is also the non-destructive self-heal
  for an existing client whose secret statecraft never persisted (recover
  it instead of delete + recreate, which would rotate the secret). The
  load-bearing intent (statecraft holds the confidential-client secret so
  the oauth2-proxy gate can authenticate) is preserved; only the wire
  mechanism is corrected.

  *Empirical correction (RAUTHY_ISSUER_URL wiring + form, 2026-07-01).*
  FR-003(b)/(c) require statecraft to forward the Rauthy issuer to the
  tenant's `oauth2-proxy` (`accessGatesDeploy.ts` puts it on the descriptor;
  `deploy.ts` refuses a gate-enabled deploy when `RAUTHY_ISSUER_URL` is
  empty). Two gaps were found live on `statecraft.ing`: (1) `RAUTHY_ISSUER_URL`
  was set nowhere in the deployed statecraft env (absent from the
  `statecraft-api-secrets` bootstrap in `platform/infra/hetzner/setup.sh`),
  so every gate-enabled tenant deploy failed the guard with `RAUTHY_ISSUER_URL
  is required when a tenant access gate is enabled`; and (2) the value form is
  load-bearing. `oauth2-proxy` uses `--oidc-issuer-url` as BOTH the discovery
  base AND the expected issuer, and validates the discovery `issuer` claim
  against it exactly. Rauthy's issuer claim is `<RAUTHY_URL>/auth/v1/` (with
  the `/auth/v1/` path and trailing slash) even though Rauthy also serves
  discovery at the bare root, so the bare host (the previous chart example)
  would pass discovery but fail issuer verification. deployd-api's own M2M
  path is unaffected because `auth.rs` reads the issuer from the discovery
  document rather than trusting the configured endpoint. Fix: `setup.sh`
  derives `RAUTHY_ISSUER_URL="${RAUTHY_URL%/}/auth/v1/"` into
  `statecraft-api-secrets`, and the `oauth2-proxy-gate` chart's `rauthy.issuerUrl`
  example is corrected to the full issuer form.

Rauthy Auth Providers (the upstream IdPs) are configured at the Rauthy
deployment level, not per tenant. A tenant gate references an Auth
Provider by id; multiple tenants can share an Auth Provider (e.g., one
Google client for all gates that want Google login) without leaking
identity across tenants because each tenant has its own Rauthy client
binding the upstream identity to a tenant-scoped Rauthy session.

## Functional Requirements *(MVP)*

- **FR-001** Statecraft persists a per-environment access-gate
  descriptor with `enabled: bool` + Rauthy client reference + allowlist
  + login-method config.
- **FR-002** When `enabled: false`, deployd-api renders the tenant
  Deployment + Service + Ingress with no auth annotations (existing
  behavior preserved).
- **FR-003** When `enabled: true`, deployd-api provisions:
  (a) a Rauthy OIDC client with `password_login_enabled: false` and the
      configured login methods,
  (b) an `oauth2-proxy` Deployment + Service for that environment,
      configured with the Rauthy client and `allowed_emails` /
      `allowed_domains`,
  (c) Ingress annotations `auth-url` / `auth-signin` chaining the
      tenant Ingress to the proxy.
  All three are created atomically with the tenant Deployment;
  partial-success states roll back.
- **FR-004** Tenant gate Rauthy clients refuse password authentication.
  Magic link and/or federated upstream IdP are the only completion paths.
  *Mechanism:* `flows_enabled` array on the Rauthy client never
  contains `"password"`. (Earlier drafts referenced a
  `password_login_enabled: false` scalar; T003 empirical smoke
  confirmed Rauthy 0.35 has no such field — see §"Access-gate
  contract" for the corrected mechanism.)
- **FR-005** Allowlist enforcement is two-layered: Rauthy refuses login
  for users not in its directory or not authorized by the Auth Provider
  rules; oauth2-proxy validates `allowed_emails` / `allowed_domains` on
  the post-auth callback as defense in depth.
- **FR-006** `DELETE /v1/deployments/{id}` cleans up gate resources
  (oauth2-proxy Deployment + Service, Rauthy client) along with the
  tenant workload. Auth Providers configured at the Rauthy level remain
  (they're shared across tenants).
- **FR-007** Statecraft never stores a user password, hash, or upstream
  IdP token. Rauthy is the only system that touches user identity
  material; statecraft sees only the post-authentication subject.
- **FR-008** Rotating tenant access updates the Rauthy user directory
  (for magic link) or the Auth Provider's upstream allowlist (for
  federated); changes propagate without tenant workload restart and
  without redeploying the gate.
- **FR-009** Toggling `enabled` true→false or false→true triggers a
  reconcile that adds/removes the gate resources without a tenant
  workload restart.
- **FR-010** Editing `login_methods` (e.g., adding federated Google
  login to an env that had magic-link only) updates the Rauthy client's
  `enabled_login_flows` without recreating the client or the proxy.

## Success Criteria

- A `development` environment created with `access_gate: {enabled: false}`
  is reachable directly (existing behavior preserved).
- Toggling `enabled: true` with `login_methods: {magic_link: true}` and
  `allowed_emails: [user@example.com]` causes the tenant URL to redirect
  to Rauthy, which presents the magic-link form (no password field),
  mails the user a one-time link, and on click drops them onto the
  tenant.
- A user not in `allowed_emails` who completes magic-link login at
  Rauthy is denied at the oauth2-proxy layer and never reaches the
  tenant.
- Adding federated Google login (`login_methods.federated: {provider:
  "google", provider_client_ref: ...}`) gives users a "Continue with
  Google" option at Rauthy in addition to magic link; the email
  allowlist still applies to the Google-issued identity.
- A tenant Rauthy client returns an explicit error if a password login
  is attempted via the API — `flows_enabled` does not include
  `"password"`, so Rauthy refuses the grant type. The platform never
  receives a password.
- Toggling `enabled: false` removes the oauth2-proxy and Rauthy client,
  the tenant Ingress reverts to direct exposure, and the tenant
  workload was not restarted.

## Clarifications

### Outstanding decisions

1. **oauth2-proxy topology — per-env vs shared.** Per-env: one
   `oauth2-proxy` Deployment per gated environment, isolated config.
   Shared: a single multi-tenant proxy routing by hostname. Per-env is
   simpler to reason about; shared is leaner on resources but introduces
   cookie-domain and redirect-URI multiplexing concerns. Recommend
   **per-env** for the first cut; revisit if pod count becomes painful.

2. **Schema shape — column on `environments` vs sibling table.**
   `access_gate JSONB` on `environments` is faster to ship; a dedicated
   `environment_access_gates` table is cleaner for audit history and
   cascading row-level FKs (e.g., the allowed-emails list as rows).
   Recommend **sibling table** so allowlist rows link directly without
   JSON wrangling.

3. **Rauthy admin API contract.** Rauthy supports programmatic client
   registration. Statecraft calls this on gate-config changes. Need to
   confirm: (a) the admin API tolerates volume (one client per gated
   env), (b) revocation is clean, (c) toggling `password_login_enabled`
   on an existing client is supported (vs requiring client recreation),
   (d) Auth Providers can be referenced by id from a client without
   per-tenant duplication.

4. **Hostname stability for OAuth callback URLs.** Rauthy clients have
   fixed `redirect_uri`s. Tenant environments need a stable hostname
   convention (e.g., `<env-slug>.<project-slug>.<org-slug>.tenants.<base>`)
   decided up front so that toggling the gate doesn't require Rauthy
   client edits.

5. **Statecraft user → Rauthy user mapping.** When an admin types an
   email into the allowlist, does that auto-provision a Rauthy user
   (with magic-link enabled) or does it only allow login attempts?
   Auto-provision is more user-friendly; allow-on-demand is safer
   when only the federated path is configured. Recommend
   **auto-provision a Rauthy user with `password_login_enabled: false`
   and magic-link enabled** when `login_methods.magic_link == true`,
   plus silent linking of the upstream identity on first federated
   login.

6. **Auth Providers configuration UX.** Rauthy Auth Providers
   (Google/Microsoft/GitHub upstream OIDC clients) are configured at
   the Rauthy deployment level. This spec provisions tenant gate
   clients but assumes Auth Providers already exist in Rauthy. The
   admin UX for configuring those upstreams (entering Google client
   ID + secret into Rauthy) is out of scope for statecraft; admins do
   it in Rauthy directly. A follow-up spec could surface that in the
   statecraft admin panel if useful.

### What this spec does NOT decide

- The tenant Helm chart shape (covered by spec 136 follow-ups).
- CI / container-build for tenant repos (separate spec).
- Cross-environment SSO (a tenant deployed at multiple environments
  re-authenticating users at each gate is correct default behavior;
  unifying that is its own design problem).
- Audit log shape for gate-protected accesses — request-level audit
  (who viewed what, when) belongs in deployd-api or a sidecar, not
  this spec.
- Passkey / WebAuthn as a third login method. Out of scope by directive;
  enabling it later is an additive change to `login_methods`.

### Open question — dual-renderer for Phase 4? *(filed 2026-05-15)*

Phase 4 (deployd-api K8s renderer) has a fork: hand-rolled kube-rs
vs. Helm overlay. The session of 2026-05-15 selected **Option B —
Helm overlay**, gated on spec 136 Phase 2.b completing first
(`plan.md` §Phase 4 cross-cutting note; tasks.md T046).

**Pondered alongside that decision:** is the hand-rolled kube-rs
path *also* worth shipping as a secondary mode, for cases where
Helm isn't available or appropriate (e.g., air-gapped clusters,
custom-CD paths, debug-without-Helm scenarios)?

**Disposition (deferred to post-Phase-4-landing review).** Ship
Option B first as the canonical renderer. Revisit dual-renderer
support only if a concrete use case surfaces that the Helm overlay
cannot serve. Reasoning:

- Two renderers = two surfaces to keep in sync (config shape, test
  fixtures, error paths). Drift is the default; coherence is the
  exception.
- The current cluster-of-record (Hetzner) runs Helm; no air-gapped
  or Helm-less deployment target is on the roadmap.
- Adding a kube-rs fallback now would code-and-test surface that
  no consumer demands; YAGNI applies.
- If the use case does surface, the kube-rs path becomes a
  follow-up spec amending 137, not a parallel implementation in
  the same PR.

Spec 136 closure unblocks Phase 4 (Option B). The kube-rs question
re-opens only if Phase 4's first concrete consumer encounters a
Helm-incompatible scenario.


## Security hardening amendment (2026-07-02)

The tenant access gate no longer fails open to email-domain wildcard when no allowlist is configured: it now fails closed at template time unless an explicit allowlist is provided or trustRauthyOnly is set.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
