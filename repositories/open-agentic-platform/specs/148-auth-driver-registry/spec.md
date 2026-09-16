---
id: "148-auth-driver-registry"
title: "Auth driver registry — pluggable identity-provider integration contract"
status: approved
created: "2026-05-17"
approved: "2026-05-22"
amended: "2026-07-08"
amendment_record: |
  amended 2026-07-08 by spec 229 (auth-driver model correction): default
  flipped rauthy-oidc to rauthy; app-level members clarified to mock|rauthy;
  upstream IdPs (SAML/Entra/Auth0/Google/GitHub) federate inside Rauthy as
  upstream providers, not AUTH_DRIVER members. Registry pattern and
  V-015/V-017 unchanged. Spec 149 retained as a grammar fixture.
authors: ["open-agentic-platform"]
kind: registry
domain: platform
risk: medium
owner: "open-agentic-platform"
implementation: complete
category: ["auth", "identity"]
selector: AUTH_DRIVER
member_contract: auth-driver
default: rauthy
production_forbidden: ["example-tenant-mock"]
depends_on:
  - "147-spec-kind-grammar"
references:
  - role: planned
    unit: { kind: directory, path: crates/auth-driver/ }
summary: >
  Registry kind: defines the pluggable identity-provider integration
  point. Members are `kind: capability` specs implementing the
  auth-driver contract (token exchange, session validation, scope
  projection). The `AUTH_DRIVER` env var selects one member at runtime;
  the default is `rauthy-oidc` (spec 106). The proving-ground capability
  member is spec 149-saml-auth-driver. Profile specs (e.g. 150) select
  AUTH_DRIVER members per tenant via the `selects:` map.

  Authored as part of spec 147 §Migration Phase 3 — the proving-ground
  spec triplet exercising V-013/V-014/V-015/V-017 against the new
  `registry` / `capability` / `profile` kinds.
---

# 148 — Auth driver registry

> **Amended 2026-07-08 by spec 229 (auth-driver model correction).** The
> registry's app-level members are `mock` (dev) and `rauthy` (prod); the
> `default` is now `rauthy`. Enterprise IdPs (SAML, Entra ID, Auth0, Google,
> GitHub) federate *inside* Rauthy as upstream providers, not as additional
> `AUTH_DRIVER` member capabilities. Spec 149 (SAML) is retained as a
> spec-kind-grammar fixture, not a shipped driver. See spec 229 §3.

## §1 Motivation

OAP today binds identity to Rauthy directly (spec 106). Tenant
environments increasingly demand pluggable identity-provider
integrations: SAML 2.0 for regulated-industry tenants, custom OIDC
for partner orgs, and mock drivers for proving-ground tests. The
auth-driver registry formalises this extension point as typed truth in
the spec spine, so capability membership is enforceable at compile
time (V-015) rather than discoverable only by reading Rust code.

The registry is also the first concrete exercise of spec 147's
`kind: registry` contract: it carries the canonical `selector` and
`member_contract` fields, and is referenced by the SAML capability
(149) and the example tenant profile (150).

## §2 Mechanism

The registry's `selector: AUTH_DRIVER` binds a single member
capability at process start. Members declare:

- `kind: capability`
- `implements: 148-auth-driver-registry` (V-015 link integrity)
- `selectable_by: AUTH_DRIVER` (must equal the registry's `selector`)
- `provides.registrations[].kind: auth-driver`

The capability is invoked through the auth-driver trait (Rust
definition to be authored in a separate spec — out of scope here):

```rust
pub trait AuthDriver: Send + Sync {
    fn validate_token(&self, raw: &str) -> Result<Identity>;
    fn project_scope(&self, identity: &Identity) -> Result<Scope>;
}
```

The trait location (`crates/auth-driver/`) is reserved by this spec
but not yet implemented. Phase 3 of spec 147 lands the registry spec
as proving-ground material; the trait, runtime loader, and the SAML
capability's Rust implementation land in follow-on specs once the
contract is exercised by a real tenant deployment.

## §3 Defaults and forbidden production members

- `default: rauthy` (amended from `rauthy-oidc` by spec 229; `rauthy` is the
  canonical driver token): when `AUTH_DRIVER` is unset, OAP behaves as
  spec 106 specifies (Rauthy-issued JWTs validated by the existing
  `deployd-api` scope gate). The default keeps the registry
  backward-compatible with deployments that have not opted into
  pluggable drivers.
- `production_forbidden: ["example-tenant-mock"]` — any future
  mock-driver capability with id `example-tenant-mock` MUST NOT be
  selected when `OAP_ENV=production`. The deployd-api scope gate
  rejects `AUTH_DRIVER=example-tenant-mock` at startup when production
  is detected. Enforcement lives in the trait runtime (out of scope
  here).

## §4 Why a registry spec, not a configuration table

Configuration tables (env vars, Helm values) describe runtime choice.
Registry specs describe the **set of legal choices**. By making the
auth-driver registry a typed spec rather than free-form configuration,
OAP gains:

- V-015 link integrity at PR time — any capability declaring
  `implements: 148-...` must resolve to this spec, and its
  `selectable_by:` must match `AUTH_DRIVER` exactly.
- V-017 profile selects-target validity — tenant profiles can
  declaratively bind to a member capability, and the binding is
  checked against the registry at compile time.
- Discoverability — `registry-consumer list --kind registry` enumerates
  the platform's extension points.

## §5 Acceptance criteria

- AC-001: This spec compiles with `kind: registry`, `selector:`, and
  `member_contract:` declared. V-013 (per-kind required fields) does
  not fire against this spec.
- AC-002: At least one `kind: capability` spec exists declaring
  `implements: 148-auth-driver-registry` and V-015 (capability/registry
  link integrity) does not fire against it. Spec 149 satisfies this.

## §6 Out of scope

- The Rust trait definition and runtime loader (separate spec).
- Per-tenant `AUTH_DRIVER` routing — covered by tenant profile specs
  via `selects:`.
- Migration of existing Rauthy session validation (separate spec
  amending 106).
- Driver-implementation specs for OIDC, OAuth2, or Kerberos — only the
  SAML driver (149) is authored in this phase, as proving-ground
  material.
