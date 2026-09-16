---
id: "229-auth-driver-mock-rauthy-model"
title: "Auth-driver model correction: mock|rauthy app axis, upstream IdPs federate inside Rauthy"
feature_branch: "229-auth-driver-mock-rauthy-model"
status: approved
implementation: pending  # Amendment spec. No code lands in this PR beyond the featuregraph golden node (extends 034), matching the 214/222/223/224/225/226 new-spec precedent. The amendment edits to 148/149/150 spec.md land in this PR; the mechanical schema/Rust/statecraft doc touch-ups defer to their owning-spec PRs (198, 227) and to factory-encore 008 to avoid coupling-gate co-amendment. Flips to complete on merge.
kind: amendment
domain: platform
created: "2026-07-08"
approved: "2026-07-08"
authors: ["open-agentic-platform"]
language: en
category: ["auth", "identity"]
amends: ["148-auth-driver-registry", "149-saml-auth-driver", "150-example-tenant-profile"]
amends_sections: []
extends:
  # A new spec adds a node to the featuregraph golden (same precedent as
  # specs 214, 222, 223, 224, 225, 226); claimed additively against spec 034
  # so the golden diff carries a 229 authority. This is the only code path
  # this amendment PR changes.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  Corrects the auth-driver mental model without changing the registry
  pattern. The app-level AUTH_DRIVER axis has exactly two values, `mock`
  (zero-dependency dev/test identity) and `rauthy` (the single production
  driver). Every real identity provider (GitHub, Google, Auth0, Entra ID,
  and SAML-requiring tenants) federates INSIDE Rauthy as an upstream
  provider, one layer below the app, not as a peer AUTH_DRIVER member
  capability. SAML needs no OAP SAML driver and no Rauthy SAML code: SAML
  tenants enter Rauthy as a Custom/Google OIDC upstream via Google Workspace
  SSO with custom OpenID Connect profiles (Google, Dec 2024 open beta). This
  amends 148 (default `rauthy-oidc` to `rauthy`; membership clarified), and
  relabels 149/150 as spec-kind-grammar fixtures rather than a real SAML
  driver, so spec 147's proving-ground stays intact.
---

# 229: Auth-driver model correction

## §1 What this amends and why

The auth-driver registry (148) and its proving-ground members (149 the SAML
capability, 150 the example tenant profile) modeled enterprise IdP
integration as *peer `AUTH_DRIVER` member capabilities*: SAML as a separate
driver crate, with OIDC/OAuth2/Kerberos drivers named as future peers. A
2026-07-08 design decision corrects that mental model without changing the
registry *pattern*. The app-level `AUTH_DRIVER` axis has exactly two values,
`mock` and `rauthy`, and every real identity provider federates *inside*
Rauthy as an upstream provider, one layer below the app.

This is an amend-and-relabel, not a supersession, precisely because 149 and
150 do double duty: they assert an architecture (now corrected) and they are
spec 147's live grammar fixtures for V-013/V-014/V-015/V-017. The fixtures
must survive; only the architectural claim is corrected.

## §2 The corrected model

- **App-level `AUTH_DRIVER` = {`mock`, `rauthy`}.** `mock` is a
  zero-dependency dev/test identity and stays deliberately dumb (one
  synthetic identity, never expanded to imitate real IdP flows). `rauthy` is
  the single production driver.
- **Upstream IdPs are Rauthy's concern, not the app's.** GitHub, Google,
  Auth0, Entra ID, and SAML-requiring tenants are configured as Rauthy
  upstream providers (`AuthProviderType = Custom | GitHub | Google`),
  invisible to the generated app and to the create form. They are not
  additional `AUTH_DRIVER` members.
- **SAML needs no separate driver and no Rauthy SAML code.** Rauthy is a pure
  OIDC/OAuth2 broker (`git grep -i saml` over the Rauthy tree returns zero
  hits). SAML-requiring tenants federate via **Google Workspace SSO with
  custom OpenID Connect profiles** (Google, Dec 2024 open beta), entering
  Rauthy as a `Custom`/`Google` OIDC upstream.

### Evidence base (verified 2026-07-08)

- Encore's `authHandler` is driver-agnostic: it verifies the JWT in the
  `access_token` cookie; the driver differs only at login
  (`template-encore/apps/api/auth/handler.ts`).
- The generated app ships both drivers as static files selected by env, not
  modules (`apps/api/auth/{mock,rauthy}.ts`, `drivers.ts`). Accepted values
  are `mock`/`rauthy` (route segments: `login` redirects to
  `/api/v1/auth/${AUTH_DRIVER}/login`, so `rauthy-oidc` would 404).
- Rauthy has first-class upstream federation
  (`src/service/src/oidc/auth_providers/`) covering Custom OIDC (Auth0,
  Entra, Google Workspace SSO), GitHub, and Google, and no SAML.

## §3 Amendment to 148 (auth-driver registry)

- `default: rauthy-oidc` becomes `default: rauthy`. `rauthy-oidc` was never
  an accepted app-level driver token and would 404 the login route; `rauthy`
  is the canonical token on both the platform and generated-app surfaces.
- The registry's real app-level members are `mock` (dev) and `rauthy` (prod).
  Upstream IdP federation is internal to the `rauthy` driver via Rauthy
  upstream providers, not additional `AUTH_DRIVER` member capabilities.
- The registry *pattern* is unchanged: a typed set of legal choices with
  V-015 (capability/registry link integrity) and V-017 (profile
  selects-target validity) intact. 149 remains the capability member that
  keeps 148 AC-002 satisfied, now as a fixture (see §4).

## §4 Amendment to 149 (SAML capability): relabel as synthetic fixture

149 stays structurally intact: its frontmatter (`implements:`,
`selectable_by:`, `provides:`, `composition:`) is unchanged so spec 147's
V-013/V-014/V-015 proving-ground stays green. Its architectural claim is
corrected. OAP ships no standalone SAML driver and reserves
`crates/auth-driver-saml/` only as a hypothetical grammar-fixture target.
SAML-requiring tenants are served by the `rauthy` driver via a Rauthy
custom-OIDC upstream (Google Workspace SSO). 149 is a spec-kind-grammar
fixture, not a roadmap item.

## §5 Amendment to 150 (example tenant profile): selection unchanged

150's `selects: {148 -> 149}` and `composition.requires: [149]` are
unchanged, keeping V-017 green. Its status as a synthetic proving-ground
profile is reaffirmed. The SAML capability it selects is now explicitly a
fixture (per §4), not a claim that this tenant runs a separate SAML driver.

## §6 What does NOT change

- The registry pattern and every V-013/V-014/V-015/V-017 validator.
- Spec 147's proving-ground triplet remains live: this is why the correction
  is amend-relabel, not supersession.
- Spec 106 (Rauthy) remains the identity foundation. This amendment makes
  Rauthy the sole federation point rather than one peer among app-level
  drivers.

## §7 Downstream reconciliation (tracked elsewhere, not in this PR)

The mechanical touch-ups implied by this model each edit an authoritative
code path owned by another spec, so they ride with that owning spec's PR to
avoid coupling-gate co-amendment here:

- **factory-encore `acme-vue-encore` manifest + its schema copy** (another
  repo): normalize `scaffold.profiles[].auth_driver` `rauthy-oidc` to
  `rauthy` (public/internal/dual; minimal stays `mock`), add the profiles
  `auth_driver` enum `[mock, rauthy]`, and fix the `dual_stack.variants.*`
  examples. Rides with **factory-encore 008** (data-redis), which already
  touches this manifest.
- **OAP `standards/schemas/factory/adapter-manifest.schema.yaml`
  (`dual_stack` examples/comment + profiles enum) and
  `crates/factory-contracts/src/adapter_manifest.rs`
  (`VariantEndpoint.auth_driver` doc)**: authority is **spec 198**; ride
  with a 198-scoped touch.
- **statecraft `api/projects/scaffold/moduleCatalog.ts` display comment, and
  the create form's `{public, private, both} x {mock, rauthy}` unbundling**
  via an `AUTH_DRIVER` patch into the scaffold's `apps/api/.env.example`
  (reusing the Stage 2 `envExample.ts` mechanism, one toggle applied
  uniformly to both dual variants): authority is **spec 227**; ride with its
  next stage.

## §8 Acceptance criteria

- **AC-001:** 148's `default` reads `rauthy`, and 148's body states the
  `mock|rauthy` membership and Rauthy-upstream federation.
- **AC-002:** 149 and 150 remain structurally valid; V-013/V-014/V-015/V-017
  do not fire (verified by `spec-spine compile` + spec-lint on regen).
- **AC-003:** each of 148/149/150 carries `amended: "2026-07-08"` and an
  `amendment_record:` naming spec 229, plus an in-body amendment callout.
- **AC-004:** no code-path relationship changes in this PR; the only in-PR
  code delta is the featuregraph golden node (extends 034).
