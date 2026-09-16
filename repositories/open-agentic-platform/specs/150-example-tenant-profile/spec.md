---
id: "150-example-tenant-profile"
title: "Example tenant profile — proving-ground tenant for spec-kind grammar"
status: approved
created: "2026-05-17"
approved: "2026-05-22"
amended: "2026-07-08"
amendment_record: |
  amended 2026-07-08 by spec 229 (auth-driver model correction): reaffirmed
  as a synthetic proving-ground profile. Its selected SAML capability (149)
  is now explicitly a grammar fixture, not a separate SAML driver. selects:
  and composition.requires: unchanged, keeping V-017 green.
authors: ["open-agentic-platform"]
kind: profile
domain: platform
risk: low
owner: "open-agentic-platform"
implementation: complete
category: ["identity", "policy"]
identity:
  name: "Example Tenant"
  jurisdiction: "XX"
  citizen_term: user
  contacts:
    - role: maintainer
      email: "maintainer@example.invalid"
  urls:
    public: "https://example.invalid/"
selects:
  "148-auth-driver-registry": "149-saml-auth-driver"
depends_on:
  - "147-spec-kind-grammar"
composition:
  requires:
    - "149-saml-auth-driver"
summary: >
  Proving-ground tenant profile. Selects the SAML auth driver
  capability (149) as the auth-driver registry (148) member for this
  tenant. No jurisdictional commitments — the `XX` jurisdiction and
  `example.invalid` domains are placeholders. This spec exists to
  exercise the spec-kind grammar V-013 and V-017 validators
  end-to-end against the `profile` kind. Real tenant profiles (GoA,
  partner orgs) will be authored as separate specs once the contract
  is exercised in production.

  Authored as part of spec 147 §Migration Phase 3 — the proving-ground
  spec triplet exercising V-013/V-014/V-015/V-017 against the new
  `profile` kind.
---

# 150 — Example tenant profile

> **Amended 2026-07-08 by spec 229 (auth-driver model correction).** This
> profile is a synthetic spec-kind-grammar fixture. The SAML capability it
> selects (149) is a fixture, not a shipped driver; real SAML tenants
> federate through Rauthy (see spec 229 §5). `selects:` is unchanged.

## §1 Motivation

Spec 147 §Migration Phase 3 requires at least one profile spec to
exercise V-013 (per-kind required fields) and V-017 (profile
selects-target validity) against the new `kind: profile` contract.
This spec satisfies that requirement with a generic, jurisdiction-free
profile that selects the proving-ground SAML capability.

A real tenant profile would carry concrete jurisdictional data, for
example, a concrete ISO 3166 region code for the tenant's jurisdiction,
and the profile would be the binding document declaring which capabilities
the tenant relies on. The example profile uses ISO 3166 sentinel
value `XX` (officially "user-assigned, reserved for testing") to
make the placeholder nature explicit.

## §2 Constraint resolution

```yaml
selects:
  148-auth-driver-registry: 149-saml-auth-driver
```

For this tenant, when `AUTH_DRIVER` is evaluated at runtime, the
profile resolves to capability 149 (SAML). V-017 validates the
following invariants at compile time:

- `148-auth-driver-registry` resolves to a `kind: registry` spec ✓
- `149-saml-auth-driver` resolves to a `kind: capability` spec ✓
- spec 149's `implements:` equals `148-auth-driver-registry` ✓

If a future amendment renumbers either spec, V-017 fires until the
profile's `selects:` map is updated. The map is the profile's binding
record of its capability choices.

## §3 Foundational requirements

`composition.requires: [149-saml-auth-driver]` declares the SAML
capability as foundational for this tenant — the profile assumes
SAML availability at runtime even before the `selects:` resolution
fires. Future profiles may declare different foundational
capabilities (OIDC-only for partner orgs, Kerberos+SAML for legacy
deployments).

## §4 Why no `policy:` block

Real tenant profiles carry a `composition.policy:` block expressing
free-form policy values (allowed-scope-prefixes, max-session-duration,
attribute-mapping rules, etc.). Validation against selected
capabilities' declarations is performed by the policy-kernel at
runtime, not at compile time — spec 147 §"When `kind: profile`"
documents the boundary.

This example profile omits `policy:` because (a) it has no real
jurisdictional commitments to encode and (b) the proving-ground
purpose of this spec is to exercise V-013/V-017, not policy-kernel
integration.

## §5 Acceptance criteria

- AC-001: V-013 (per-kind required fields for profile) does not fire —
  `identity:`, `selects:`, and `composition.requires:` are all
  declared.
- AC-002: V-017 (profile selects-target validity) does not fire for
  the `148 → 149` mapping.
- AC-003: V-014 (implements shape) does not apply — this profile
  declares no `implements:`.

## §6 Out of scope

- Real-tenant profiles for production use (GoA, partner orgs).
- Per-tenant `composition.policy:` (deferred — see §4).
- The profile-resolution runtime that consumes `selects:` at request
  time (separate spec).
- Tenant-environment-access integration with spec 137 — that wiring
  is the subject of a follow-on spec that bridges profile→scope
  selection.
