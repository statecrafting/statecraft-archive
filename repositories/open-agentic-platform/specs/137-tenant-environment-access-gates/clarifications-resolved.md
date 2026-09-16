# Phase 0 — Clarifications resolved

> Companion to [`spec.md`](./spec.md) and [`plan.md`](./plan.md). Locks
> the 6 §Clarifications open decisions into concrete commitments that
> downstream phases inherit. Per `plan.md` §"Constitution check"
> Principle III, no code under FR-001..FR-010 lands before this
> document closes.

**Status:** Closed (2026-05-15). All six clarifications resolved.
Decision 3 (Rauthy admin API contract) closed by the T003 empirical
smoke; Decision 5 collision-handling clause amended in light of
the smoke's reference-schema readback (no `password_login_enabled`
field exists in Rauthy 0.35). Spec.md §"Access-gate contract" +
FR-004 amended pre-implementation. Spec lifecycle:
`status: draft → approved`, `approved: "2026-05-15"`. Phases 1–6
unblocked.

---

## Decision 1 — oauth2-proxy topology: **per-environment Deployment**

**Locked.** One `oauth2-proxy` Deployment per gated environment,
isolated config, single replica.

**Rationale.**

- Cookie-domain + redirect-URI multiplexing in a shared proxy is a
  real complexity surface; per-env keeps the proxy's mental model
  one-tenant-one-config.
- Blast radius: a misconfigured allowlist on one tenant cannot bleed
  to another.
- Pod count scales linearly with gated-env count, not tenant count.
  At an estimated 10 gated environments in the first year, that is
  ~10 proxy pods at 50–100Mi each — well under the cluster's per-node
  allocatable on any of the supported targets.

**Revisit criterion.** When gated-env count crosses 50 (≈5GB
aggregate proxy footprint at 100Mi/pod ceiling), file a follow-up
spec to evaluate a multi-tenant proxy with per-host config
multiplexing. Until then, per-env stands.

**Maps to:** `plan.md` Phase 4 (T041 — render oauth2-proxy
Deployment + ClusterIP Service in the deployment's namespace).

---

## Decision 2 — Schema shape: **dedicated sibling tables**

**Locked.** Two new tables, not a JSONB column on `environments`:

1. `environment_access_gates`
   `(environment_id PK FK→environments.id ON DELETE CASCADE,
   enabled bool NOT NULL DEFAULT false,
   rauthy_client_ref text NULL,
   login_method_magic_link bool NOT NULL DEFAULT true,
   login_method_federated_provider text NULL,
   login_method_federated_provider_client_ref text NULL,
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now())`
   with `CHECK (enabled = false OR rauthy_client_ref IS NOT NULL)`
   enforcing the non-null Rauthy fields when enabled.

2. `environment_access_gate_allowlist_emails`
   `(id bigserial PK,
   environment_id FK→environments.id ON DELETE CASCADE,
   kind text NOT NULL CHECK (kind IN ('email','domain')),
   value text NOT NULL,
   created_at timestamptz NOT NULL DEFAULT now())`
   with `UNIQUE (environment_id, kind, lower(value))` enforcing
   case-insensitive uniqueness without `citext` (the platform is
   FIPS-mode Postgres per `reference_hetzner_postgres_fips`).

**Rationale.**

- Allowlist rows as rows (not JSON array elements) gives row-level
  FKs, individual audit-log rows per allowlist add/remove, and
  efficient indexing for the post-auth callback check.
- JSONB on `environments` would force `jsonb_array_elements` at
  every allowlist check and make audit-log shape per-entry awkward.
- `ON DELETE CASCADE` keeps gate state consistent with environment
  lifecycle without application-layer fan-out.

**Migration target.** Next free numeric prefix in
`platform/services/statecraft/api/db/migrations/` at PR time.

**Maps to:** `plan.md` Phase 1 (T010–T014).

---

## Decision 3 — Rauthy admin API contract: **Locked (empirical, 2026-05-15)**

Smoke evidence: [`execution/rauthy-admin-smoke.md`](./execution/rauthy-admin-smoke.md)
+ raw JSON in [`execution/rauthy-admin-smoke.json`](./execution/rauthy-admin-smoke.json).
Executed inside `statecraft-api` pod against
`http://rauthy.rauthy-system.svc.cluster.local:8080` (external admin
access blocked by `PROXY_MODE=true` + `TRUSTED_PROXIES` — admin
calls must originate from the pod CIDR or trusted Cloudflare CIDRs).

| Assumption | Result | Notes |
|---|---|---|
| (a) Admin API tolerates ≥10 clients | **PASS** | 10 clients created sequentially; 2–3ms steady-state, 59ms first-call (JIT warmup). Per-env topology + 10-env year-one estimate well within tolerance. |
| (b) `DELETE /auth/v1/clients/{id}` is clean | **PASS** | DELETE returns **200** (not 204 as initially assumed); immediate GET returns `404 NotFound "no rows returned"`. |
| (c) Toggling password disable is non-destructive | **PASS via PUT** | But the field doesn't exist as described — see correction below. |
| (d) `auth_provider_id` on client creation | **N/A — deferred to Phase 3** | Zero upstream providers configured in this Rauthy at smoke time. Reference-schema readback on the live `statecraft-server` client also showed **no** `auth_provider_id` / `provider_id` field, suggesting upstream IdP choice may happen at login time (via the providers list at OIDC authorize) rather than per-client binding. Phase 3 confirms or amends when the first provider lands. |

### Empirical correction — Rauthy 0.35 client schema

The 14-field client record (read verbatim from the live
`statecraft-server` client):

```
access_token_alg        access_token_lifetime    auth_code_lifetime
challenges              confidential             default_scopes
enabled                 flows_enabled            force_mfa
id                      id_token_alg             name
redirect_uris           scopes
```

**There is no `password_login_enabled` field.** Password login is
controlled via the `flows_enabled` array — a client with
`flows_enabled: ["authorization_code"]` (omitting `"password"`)
cannot complete a password grant. This propagates to Decision 5
(below) and to spec.md §"Access-gate contract" + FR-004, which
have been amended pre-implementation.

### Update verb

**PUT, not PATCH.** Rauthy 0.35 admin client updates use full-object
PUT (`PUT /auth/v1/clients/{id}` with the complete client object in
the body). There is no PATCH endpoint. Round-tripping `flows_enabled`
through two PUTs (add `"password"`, then remove it) both returned
status 200 with the GET-readback reflecting the change immediately.

**Maps to:** `plan.md` Phase 3 (T030–T034). Phase 3 (d) verification
rolls into the first-provider PR.

---

## Decision 4 — Hostname stability: **`<env-project-org-slug>.tenants.<base>`** *(amended 2026-05-17)*

**Locked (amended).** Tenant environment hostnames follow a **single
flattened label** under `.tenants.<base>`:

```
<env-slug>-<project-slug>-<org-slug>.tenants.<base-domain>
```

Example: `staging-checkout-acme.tenants.platform.example.com`.

**Rationale.**

- Stable input to `redirect_uri` on Rauthy clients — toggling the
  gate on/off does not change the hostname, so the Rauthy client
  does not need re-registration on toggle (FR-009).
- The flattened label still uniquely encodes the (org, project,
  env) triple — useful for ingress-nginx host routing, oauth2-proxy
  cookie-domain scoping (`.<base-domain>` scope works for any
  tenant), and audit-log enrichment.
- `tenants.<base>` segregates tenant hostnames from platform
  hostnames (`statecraft.<base>`, `rauthy.<base>`, etc.), giving a
  cookie-domain boundary and a clear DNS / wildcard-cert zone for
  tenants.

**Wildcard cert path (lands the original Decision 4's intent).** A
single shared `*.tenants.<base>` wildcard cert covers every flattened
tenant hostname — one cert, one cert-manager Certificate resource,
trivial renewal. cert-manager + Let's Encrypt DNS-01 via the
Cloudflare solver issues + renews automatically (`platform/infra/
hetzner/manifests/letsencrypt-prod-dns01-cloudflare-issuer.yaml` +
`tenants-wildcard-certificate.yaml`; spec 106 §12.1 amendment).

**History (why amended 2026-05-17).** The original
Decision 4 picked Option A (per-org wildcard
`*.<org-slug>.tenants.<base>`) with a four-label hostname pattern
`<env-slug>.<project-slug>.<org-slug>.tenants.<base>`. That
combination has a latent depth mismatch — a wildcard cert
`*.<org-slug>.tenants.<base>` covers `<X>.<org-slug>.tenants.<base>`
(one label deep from `*`), but the planned hostname is
`<env>.<project>.<org-slug>.tenants.<base>` (two labels deep). X.509
wildcards do not support multi-label expansion. The wildcard +
hostname pattern would never have been consistent as authored.

The flattened-label amendment lands the original intent (one
cert covers all tenants in a zone, stable redirect-URI shape)
without violating wildcard-cert rules. Per-org cert isolation —
which has a small security argument (limit blast radius if one
cert key is exposed) — is recoverable as a future amendment:
move from the single shared cert to one cert per org by introducing
`*.<org-slug>.tenants.<base>` certs and matching the flattened
label per-org. Out of scope for the spec 137 evidence path.

**Cert replication.** The wildcard cert + its `tenants-wildcard-tls`
Secret live in the `cert-manager` namespace; tenant Ingresses live
in per-app namespaces. The replication mechanism (deployd-api code
that clones the Secret into the tenant ns at deploy time, OR a
reflector-style controller) is a spec 137 Phase 4 follow-up — a
single shared wildcard cert is the unlock here, the consumer-side
path is the next gate.

**Maps to:** `plan.md` Phase 4 (T041, T042 — ingress annotation
shape uses the flattened hostname for cookie-domain + redirect-URI
derivation).

---

## Decision 5 — User → Rauthy user mapping: **auto-provision on allowlist add**

**Locked.** When an admin adds an email to
`environment_access_gate_allowlist_emails`:

1. **If `login_methods.magic_link == true`:** statecraft calls the
   Rauthy admin API to upsert a Rauthy user with
   `password_login_enabled: false`, `magic_link_enabled: true`,
   no password hash, scope = `openid email profile`. The user
   record exists in Rauthy whether or not they have logged in
   yet; the first magic-link request mails the token.
2. **If only `login_methods.federated` is configured** (no magic
   link): statecraft does NOT auto-provision a Rauthy user. The
   user record materialises on first federated login via Rauthy's
   silent-link behaviour (Rauthy creates the user account binding
   the upstream identity at OIDC callback time). The allowlist
   entry is purely an oauth2-proxy post-auth gate.

**Edge cases:**

- **Allowlist removal:** the Rauthy user record is NOT deleted on
  allowlist row removal. Rationale: the user may be on multiple
  tenant allowlists; deleting the Rauthy user would break other
  gates. The deny happens at oauth2-proxy. Statecraft surfaces a
  "purge this user from Rauthy" admin action separately
  (not in scope for this spec — file as follow-up spec).
- **User-already-exists collision:** Rauthy upsert is idempotent
  on email. **Important correction (T003 empirical):** Rauthy
  0.35's user record has no `password_login_enabled` scalar (the
  field exists on neither user nor client records). Password
  control on **clients** is `flows_enabled` array; password control
  on **users** is handled differently (a Rauthy user's
  authentication options are determined by the configured
  password / passkey / magic-link state on the user record, not
  a single boolean). Collision handling: if a Rauthy user already
  exists with a password set, statecraft does NOT modify the
  user's password state — the gate's password-free property is
  enforced at the **client** layer (`flows_enabled` omits
  `"password"` on the gate client), so even a password-bearing
  user account cannot complete a password grant against the gate
  client. Statecraft emits a `rauthy.user.tenant_gate_added`
  audit row recording that the user was added to a gate
  allowlist without touching their identity record. Per-user
  Rauthy migration (e.g., scrub password material from existing
  users) is out of scope; it's a separate spec.
- **Domain allowlist entries:** do NOT auto-provision Rauthy users
  on domain entry creation — the universe is unbounded. Magic-link
  login from a domain-allowlisted email triggers Rauthy's
  on-the-fly user creation at email-entry time.

**Maps to:** `plan.md` Phase 2 (T021 PUT handler) and Phase 3
(T031 `provisionTenantGateClient`).

---

## Decision 6 — Auth Providers configuration UX: **Rauthy admin UI for v1**

**Locked.** Configuring upstream OIDC clients (Google, Microsoft
Entra, GitHub, generic OIDC) in Rauthy happens through Rauthy's
own admin UI, not through statecraft.

**Rationale.**

- Auth Providers are per-Rauthy-deployment, not per-tenant. There
  is typically one Google client, one Microsoft client, etc., across
  the whole platform — same primitives consumed by many tenant
  gate clients.
- Rauthy's admin UI already supports Auth Provider configuration
  natively; reimplementing it in statecraft is duplicate UX work
  for a low-frequency admin task.
- Statecraft's role is to surface the configured Auth Providers in
  the per-environment login-method picker (T052) — read-only, by
  ID. Statecraft calls Rauthy admin API
  `GET /auth/v1/auth_providers` and lists them in the dropdown.

**Follow-up.** A future spec MAY surface Auth Provider
configuration in the statecraft admin panel for operators who
want a single-pane UX. That spec inherits this one's contracts
(read-only via T052 stays correct; the new spec adds write paths
via the statecraft surface). Not scoped here.

**Maps to:** `plan.md` Phase 5 (T052 — federated provider
dropdown shows the Rauthy-configured list).

---

## Status field updates *(closed 2026-05-15)*

`spec.md` frontmatter: `status: draft → approved`, `approved:
"2026-05-15"`. T003 evidence landed under
`execution/rauthy-admin-smoke.md`; Decision 5 collision-handling
clause amended in light of the reference-schema readback
(`flows_enabled` mechanism, no `password_login_enabled` field on
client or user record); spec.md §"Access-gate contract" + FR-004
amended pre-implementation to use the correct mechanism. Phase 1
(schema migration) is now unblocked.

## Cross-spec coherence

This document does not modify any spec outside 137. Cross-spec
references (specs 087, 119, 136) cited above are read-only — no
amend relationships are created by Phase 0. Future phases may
introduce amends if downstream specs need narrative updates
(e.g. statecraft schema spec gains a §"access-gate sibling tables"
entry); those are filed at the time of the amending PR, not now.

## Diff plan from this document to spec.md

`spec.md` §Clarifications currently lists the 6 items with
"Recommend …" language. After T003 lands and Decisions are
re-confirmed, the spec.md §Clarifications section is amended to
replace "Recommend" prose with "Resolved" cross-references
pointing back to this document (no content duplication — single
source of truth lives here, spec.md gains pointers). The amend
ships in the same PR as the status flip.
