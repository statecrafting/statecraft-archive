---
id: "008-data-redis-promotion-dual-composition"
title: "Honest module surfaces: data-redis promotion, dual module composition, and the CORS knob"
status: draft
created: "2026-07-06"
owner: bart
kind: feature
domain: generator
risk: medium
implementation: pending  # FR-001 (data-redis promotion) is implemented: the manifest gains an infraResources.redis field, the composer emits/removes a topology-only infra.config redis block reached over the typed REDIS_HOST/REDIS_USER/REDIS_PASSWORD triple, data-redis is a real resource (honest description), and the cron large-scale lock migrates onto that contract (refines 001/002/009). The template-encore baseline client + pinnedRef bump land via lockstep 006. Stays pending because FR-002 (CORS wire-or-drop) and FR-003 (dual module composition) remain a follow-on slice (still under references). Flips to complete when those land.
depends_on:
  - "001-module-manifest-schema"      # owns the modules/ directories (data-redis/, security-core/) this spec promotes and corrects
  - "002-encore-generator-core"       # owns setup-app.ts + the generated apps/api/infra.config.json this spec adds a redis block to
  - "003-user-management-module"      # the real feature module the dual composition must be able to compose into the internal clone
  - "004-dual-app-generator"          # owns setup-dual-app.ts; the dual module-composition gap this spec closes lives here
  - "006-factory-schema-lockstep"     # the template-encore baseline changes (redis block, CORS wiring) coordinate through the lockstep pin
code_aliases: ["data-redis", "CORS_ORIGIN", "setup-dual-app"]
summary: >
  The create-project reframe (OAP spec 227) projects the factory adapter's
  module surface into a derived catalog and an Encore infra.config projection.
  Three adapter-side surfaces must become honest for that projection to be
  truthful. (1) data-redis is an inert marker (files:{}, status:stable) whose
  description falsely claims a Redis rate-limit backend that does not exist (the
  baseline limiter is a Postgres UNLOGGED counter). This spec promotes it to a
  real Encore infra.config `redis` resource: a `redis` block in the generated
  apps/api/infra.config.json plus REDIS_* env bindings, coordinated with the
  template-encore baseline via lockstep (spec 006). This reverses the abandoned
  chore/data-redis-retirement direction (retire becomes promote). (2)
  security-core's CORS_ORIGIN env knob is inert: the baseline global_cors is
  hardcoded static in encore.app and no baseline code reads CORS_ORIGIN. This
  spec decides wire-or-drop (recommended: wire it, env-aware, so deployed
  public/internal apps at real domains are correct). (3) the dual topology
  composes no feature modules (manifest.yaml:217-218), so a dual app cannot
  compose user-management into its internal clone. This spec closes that gap so
  dual can compose modules into the internal clone, unblocking the dual
  community-board fixture and the "public cannot see triage / staff-only
  mutations" trust-zone test. Companion to OAP spec 227, which owns the
  stagecraft create-project surface and the deployd previewRedis dev-only
  provisioning that pairs with the promoted resource.
extends:
  # Meta-spec self-registration: this spec adds its own id to
  # GENERATOR_META_SPEC_IDS in born-with.ts (a 002-established path) so produced
  # apps drop it as create-time machinery. Additive change, and the only in-PR
  # code change, mirroring how OAP design specs add their featuregraph golden
  # node via extends. It satisfies the ownership-edge requirement without
  # over-firing the coupling gate, because born-with.ts genuinely changes here.
  - spec: "002-encore-generator-core"
    nature: additive
    unit: { kind: file, path: adapters/acme-vue-encore/scripts/lib/born-with.ts }
refines:
  # FR-001 (data-redis promotion) landed here. The design references below are
  # promoted to authoritative refines edges for exactly the paths this PR
  # changes; FR-002 (CORS) and FR-003 (dual composition) stay under references
  # (a follow-on slice), so implementation: stays pending.
  - aspect: "optional infra.config redis resource: manifest schema field plus data-redis promoted from inert marker to a real resource"
    refines_specs: ["001-module-manifest-schema"]
    paths:
      - adapters/acme-vue-encore/scripts/lib/manifest.schema.ts
      - adapters/acme-vue-encore/modules/data-redis/manifest.json
  - aspect: "composer emits and removes the infra.config redis block (topology-only); the generate-path install fires it for an infra-resource-only module"
    refines_specs: ["002-encore-generator-core"]
    paths:
      - adapters/acme-vue-encore/scripts/lib/encore-composer.ts
      - adapters/acme-vue-encore/scripts/lib/install-module.ts
  - aspect: "cron large-scale lock migrated onto the typed REDIS_HOST/REDIS_USER/REDIS_PASSWORD contract (no REDIS_URL)"
    refines_specs: ["009-tenant-cron-scheduler-module"]
    paths:
      - adapters/acme-vue-encore/modules/cron/files/scheduler/lock.ts
      - adapters/acme-vue-encore/modules/cron/manifest.json
      - adapters/acme-vue-encore/modules/cron/files/scheduler/worker.ts
references:
  # Remaining non-authoritative pointers (FR-002 CORS, FR-003 dual composition),
  # promoted by the follow-on slice: extends 004 (dual generator) and the CORS
  # wiring on security-core / manifest.yaml.
  - role: security-core-module
    unit: { kind: file, path: adapters/acme-vue-encore/modules/security-core/manifest.json }
  - role: dual-generator
    unit: { kind: file, path: adapters/acme-vue-encore/scripts/setup-dual-app.ts }
  - role: profile-topology-manifest
    unit: { kind: file, path: adapters/acme-vue-encore/manifest.yaml }
---

# 008. Honest module surfaces: data-redis promotion, dual module composition, and the CORS knob

> Provenance: adapter-side companion to OAP spec
> `227-create-project-infra-config-projection`, which reframes the stagecraft
> "Create New Project" surface as a projection of the adapter manifest (feature
> modules) and Encore's infra.config vocabulary (infrastructure resources), and
> adds a deployd `previewRedis` dev-only provisioning path. That projection is
> only truthful if the three module surfaces below stop lying. Design record:
> `open-agentic-platform/docs/analysis/create-project-encore-config-reframe.md`.

## 1. Purpose

The create-project surface is being made a projection of vocabulary that already
exists rather than a hand-authored catalog. For that projection to be honest,
three adapter surfaces that currently mislead must be corrected.

### 1.1 data-redis is an inert marker with a false label

`modules/data-redis/manifest.json` is `status: stable` with `files: {}`. It ships
no client, no service, no dependency, only a documented `REDIS_URL` env knob.
Its description claims the baseline rate limiter "uses Redis instead of the
in-memory limiter when REDIS_URL is set." Neither branch exists: the baseline
limiter is a Postgres `UNLOGGED` fixed-window counter (`INSERT ... ON CONFLICT`),
and nothing reads `REDIS_URL`. So the module documents a dead knob and describes
behavior that is not there. A stale retirement branch (`chore/data-redis-retirement`)
exists but was never completed.

### 1.2 security-core's CORS knob is inert

`modules/security-core/manifest.json` contributes one env var, `CORS_ORIGIN`,
that no baseline code reads: the baseline `global_cors` is hardcoded static
(literal localhost origins) in `apps/api/encore.app`. All real security posture
(CSP/HSTS, the Postgres rate limiter, the logger) ships unconditionally in the
baseline. So the module "documents" a knob the app does not consume.

### 1.3 dual composes no feature modules

The dual topology (`setup-dual-app.ts`, spec 004) clones the baseline twice and
wires the second SPA, but composes no `--with` modules (`manifest.yaml:217-218`).
A dual app therefore cannot compose `user-management` into its internal clone,
so it cannot ship staff roles. This blocks the intended dual fixture (a
community board where staff triage requires `requireRole`) and means the dual
topology, which holds the only unique generation logic in the system, cannot be
exercised with the one real feature module.

## 2. Requirements

### Functional Requirements

- **FR-001**: Promote `data-redis` from inert marker to a real Encore
  infra.config resource. The module MUST cause a `redis` block to be added to the
  generated `apps/api/infra.config.json` (the app's topology) and MUST declare the
  corresponding `REDIS_*` env bindings. The baseline changes (the `redis` block
  shape and any minimal typed client) land in template-encore and are pinned via
  lockstep (spec 006). The manifest description MUST stop claiming a Redis
  rate-limit backend; the baseline limiter remains Postgres. This reverses the
  `chore/data-redis-retirement` direction: the module is made real, not removed.
- **FR-002**: Decide the `security-core` `CORS_ORIGIN` knob. RECOMMENDED: wire it,
  making the baseline `global_cors` env-aware (coordinated via lockstep) so
  deployed `public`/`internal` apps at real domains have correct CORS. ALTERNATIVE:
  if same-origin SPA serving makes cross-origin CORS unnecessary in all shipped
  topologies, drop `CORS_ORIGIN` from the module. Either way the module MUST NOT
  ship an inert knob, and the description MUST match the chosen reality.
- **FR-003**: Close the dual module-composition gap. The dual generator MUST
  support composing feature modules into the internal clone (at minimum
  `user-management`), targeting the correct clone and preserving the trust-zone
  split between the public and internal gateways. The composed modules MUST be
  expressible through the same manifest surface a single-app profile uses.

### Key Entities

- **Promoted data-redis**: a real infra.config resource declaration (a `redis`
  block + `REDIS_*` env bindings), not a marker.
- **CORS knob**: `CORS_ORIGIN`, either wired into an env-aware `global_cors` or
  removed.
- **Dual internal-clone composition**: the capability to compose feature modules
  into the internal clone of a dual scaffold.

## 3. Relationship and coupling posture

Design-only. `depends_on` cites the owners of the surfaces this spec corrects:
001 (the `modules/` directories), 002 (the generator and the generated
infra.config), 003 (the feature module dual must compose), 004 (the dual
generator), and 006 (lockstep, through which the template-encore baseline
changes are pinned). The surfaces are listed under `references:`; implementation
PRs promote them to authoritative relationships (`refines: 001` for the module
surfaces, `extends: 004` for the dual generator) and land the template-encore
edits behind the lockstep pin.

## 4. Cross-repo coordination (lockstep, spec 006)

FR-001 and FR-002 require template-encore baseline edits (the `redis`
infra.config block, an env-aware `global_cors`). These are authored in
template-encore and pinned via `baseline.lock.json`. This spec coordinates but
does not author template-encore; the baseline PR and the lockstep pin bump are
separate, reviewable acts.

## 5. Integration notes

- **Meta-spec id registered in this PR.** `008-data-redis-promotion-dual-composition`
  is added to `GENERATOR_META_SPEC_IDS` in `scripts/lib/born-with.ts` (claimed via
  the `extends: 002` edge above), so produced apps drop it as create-time
  machinery rather than carrying this generator spec.
- **Implementation edges land later.** The `refines: 001` (module surfaces) and
  `extends: 004` (dual generator) edges, plus the template-encore baseline edits
  pinned via lockstep (006), are promoted by the follow-on implementation PRs.
- **Manifest auth-driver identifier normalized (orthogonal).** Independent of
  this spec's data-redis surfaces, `manifest.yaml`'s auth-driver identifier was
  renamed `rauthy-oidc` to `rauthy` (across `supported_auth.driver`,
  `scaffold.profiles[].auth_driver`, `dual_stack.*.auth_driver`, the configurer
  agent, and docs) to match the runtime `AUTH_DRIVER=rauthy` and OAP spec 229's
  mock|rauthy model. Cosmetic: `setup-app.ts` already bakes `AUTH_DRIVER=rauthy`,
  so generated output is byte-identical (lockstep verified). Recorded here
  because 008 is the manifest's current design authority; it introduces no
  data-redis change.
- **FR-001 hardening (post-#22 review).** Three low-severity nits from the
  data-redis review are closed as refinements to the FR-001 paths: (1) the
  `composeModule` trigger in `install-module.ts` is generic over `infraResources`
  (`Object.values(...).some(r => r !== undefined)`) rather than checking `redis`
  specifically, so a future resource type added to `infraResourcesSchema` cannot
  parse-but-silently-skip composition; (2) the redis `cluster` name is constrained
  to `/^[a-z][a-z0-9-]*$/` in `manifest.schema.ts`, closing the prototype-pollution
  vector where `mergeRedis` writes the name as an object key reached via `in`;
  (3) the `removeRedis` shared-cluster invariant (merge is idempotent, remove is
  unconditional) is documented in `encore-composer.ts`. No behavior change for the
  shipped data-redis module (`cache` matches the regex; the guard fires
  identically for `redis`).

## 6. Out of scope

- The stagecraft create-project surface (derived catalog, two-axis selector,
  infra.config projection) and the deployd `previewRedis` dev-only provisioning:
  owned by OAP spec 227.
- Per-environment topology divergence (Option B): the app's topology is
  identical across environments; per-environment values are runtime env.
- The additional Encore resource types (`object_storage`, `pubsub`, `metrics`):
  future increments once the `redis` promotion proves the pattern.
