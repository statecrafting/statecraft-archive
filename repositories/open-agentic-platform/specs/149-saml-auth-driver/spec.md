---
id: "149-saml-auth-driver"
title: "SAML auth driver capability — IdP integration for SAML 2.0 tenants"
status: approved
created: "2026-05-17"
approved: "2026-05-22"
amended: "2026-07-08"
amendment_record: |
  amended 2026-07-08 by spec 229 (auth-driver model correction): relabeled
  as a spec-kind-grammar fixture. OAP ships no standalone SAML driver;
  crates/auth-driver-saml/ is a hypothetical fixture target. SAML tenants
  federate via a Rauthy custom-OIDC upstream (Google Workspace SSO), served
  by the rauthy driver. Structure unchanged so V-013/V-014/V-015 stay green.
authors: ["open-agentic-platform"]
kind: capability
domain: platform
shape: driver
risk: medium
owner: "open-agentic-platform"
implementation: complete
category: ["auth", "identity", "security"]
implements: "148-auth-driver-registry"
selectable_by: AUTH_DRIVER
references:
  - role: planned
    unit: { kind: directory, path: crates/auth-driver-saml/ }
provides:
  registrations:
    - kind: auth-driver
  files:
    - "crates/auth-driver-saml/**"
  env_vars:
    - key: SAML_IDP_METADATA_URL
      required: true
      description: SAML 2.0 IdP metadata document URL
      sensitive: false
    - key: SAML_SP_PRIVATE_KEY
      required: true
      description: Service-provider private key for assertion signing
      sensitive: true
composition:
  requires:
    - "148-auth-driver-registry"
summary: >
  Capability member of the auth-driver registry (148). Validates SAML
  2.0 assertions issued by an IdP, maps assertion attributes to OAP
  identity scopes, and integrates with Rauthy's session model
  (spec 106). Implementation lives in `crates/auth-driver-saml/` —
  reserved by this spec but not yet authored; Phase 3 of spec 147
  lands the capability spec as proving-ground material.

  Authored as part of spec 147 §Migration Phase 3 — the proving-ground
  spec triplet exercising V-013/V-014/V-015/V-017 against the new
  `capability` kind.
---

# 149 — SAML auth driver

> **Amended 2026-07-08 by spec 229 (auth-driver model correction).** This
> capability is retained as a spec-kind-grammar fixture for spec 147
> (V-013/V-014/V-015), not a shipped driver. OAP ships no standalone SAML
> driver: SAML-requiring tenants federate via a Rauthy custom-OIDC upstream
> (Google Workspace SSO with custom OIDC profiles), served by the `rauthy`
> driver. `crates/auth-driver-saml/` is a hypothetical fixture target. See
> spec 229 §4.

## §1 Motivation

GoC tenants and several enterprise partners require SAML 2.0 for
identity federation. This capability satisfies that requirement
without coupling OAP's core to SAML semantics — the auth-driver
registry (148) is the abstraction boundary, and this spec is the
first concrete member.

The capability also serves as the proving-ground spec for spec 147's
`kind: capability` contract: it carries scalar `implements:`,
`provides:`, `composition.requires:`, and `selectable_by:`, exercising
the V-013, V-014, V-015 validators end-to-end.

## §2 Contract

Implements the auth-driver trait declared by registry 148:

- `validate_token(raw: &str) -> Result<Identity>`: parse SAML
  assertion XML, verify the signature against the IdP metadata
  document (refreshed periodically), extract `NameID` and configured
  attribute claims.
- `project_scope(identity: &Identity) -> Result<Scope>`: map SAML
  attributes (typically `eduPersonAffiliation`, `memberOf`, or custom
  tenant claims) to OAP scope tokens. The mapping is governed by the
  active tenant profile spec, not by this capability.

The Rust trait location (`crates/auth-driver-saml/`) is reserved by
this spec's `provides.files:` glob.

## §3 Required environment

| Env var | Required | Sensitive | Description |
|---------|:--------:|:---------:|-------------|
| `SAML_IDP_METADATA_URL` | yes | no | SAML 2.0 IdP metadata URL |
| `SAML_SP_PRIVATE_KEY`   | yes | yes | Service-provider private key for assertion signing |
| `AUTH_DRIVER`           | yes | no | Must equal `saml` for this capability to be selected at runtime (binds via the registry's `selector`) |

Sensitive values MUST come from the secret store (Kubernetes Secret,
Vault, or Azure Key Vault) — never from a plaintext env file in
production environments.

## §4 Why `shape: driver`

The `(kind, shape)` table in spec 147 lists four shapes for
`kind: capability`: `driver`, `module`, `web-snippet`,
`middleware-stack`. SAML auth fits `driver`: a swappable runtime
behaviour that implements a registered contract, with environment-
variable selection at process boot. This contrasts with `module`
(library-style integration without runtime selection) or
`web-snippet` (DOM-injected client assets).

## §5 Acceptance criteria

- AC-001: V-013 (per-kind required fields for capability) does not
  fire — `implements:`, `provides:`, and `composition.requires:` are
  all declared.
- AC-002: V-014 (implements shape consistency) does not fire — scalar
  form is valid for `kind: capability`.
- AC-003: V-015 (capability/registry link integrity) does not fire —
  `implements: 148-auth-driver-registry` resolves to a `kind: registry`
  spec, and `selectable_by: AUTH_DRIVER` equals the registry's
  `selector: AUTH_DRIVER`.
- AC-004: W-131 (`shape:` value in declared table) does not fire —
  `(capability, driver)` is a declared row.
- AC-005: W-132 (capability declares `selectable_by:` but unreferenced
  by any registry's known members) does not fire — spec 150 (example
  tenant profile) references this capability via `selects:`.

## §6 Out of scope

- The Rust implementation in `crates/auth-driver-saml/` — separate
  spec governs the trait wiring, IdP metadata refresh worker, and
  assertion-signature verification.
- IdP-specific test fixtures (Azure AD, ADFS, Okta, etc.) — deferred.
- Attribute-to-scope mapping policy — covered by tenant profile specs
  via `composition.policy:`.
- OIDC, OAuth2, and Kerberos drivers — separate capability specs
  (not authored in this phase).
