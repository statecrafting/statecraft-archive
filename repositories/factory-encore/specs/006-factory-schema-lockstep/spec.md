---
id: "006-factory-schema-lockstep"
title: "Generator/baseline lockstep: pin the generator to template-encore's frozen invariants"
status: approved
created: "2026-06-23"
owner: bart
kind: governance
domain: ci-cd
risk: medium
implementation: complete
depends_on: ["002-encore-generator-core"]
code_aliases: ["FACTORY_SCHEMA_LOCKSTEP"]
summary: >
  The generator clones the template-encore lean baseline, so it must not drift
  from the app invariants frozen there (`encore-app-architecture`,
  `security-data-invariants`) nor from the baseline's core-service and
  module-catalog shape. This spec stands up a cross-repo lockstep: a committed
  lockfile pins the upstream ref, the baseline core services, and the module
  catalog membership; a fail-visible CI gate fetches the baseline at the pinned
  ref and refuses any drift. The invariant-hash pin was DEFERRED through Phase 1
  and Phase 2 (`encore-app-architecture` absorbed the static-serving wiring from
  spec 004 in Phase 2) and is now ACTIVE: the Phase 3 handshake flipped the pin
  to "pinned", filled the invariant spec.md hashes, and bumped pinnedRef to the
  finalized template-encore main, so a re-hash mismatch on either invariant now
  fails the gate. Mirrors the OAP `factory-schema-lockstep` pattern.
establishes:
  - "adapters/acme-vue-encore/scripts/lockstep/check.ts"
  - "adapters/acme-vue-encore/scripts/lockstep/check.test.ts"
  - "adapters/acme-vue-encore/scripts/lockstep/baseline.lock.json"
  - ".github/workflows/ci-lockstep.yml"
---

# 006. Generator/baseline lockstep: pin the generator to template-encore's frozen invariants

## 1. Purpose

factory-encore does not author the runnable application: it clones the
template-encore lean baseline and composes modules into it (spec 002). Two
classes of upstream change would silently break a generated app:

1. A change to the app's frozen invariants (the `encore-app-architecture` and
   `security-data-invariants` invariants), which the generator assumes but does
   not own.
2. A reshape of the baseline (a renamed or removed core service) that the
   "lean baseline + compose" generator depends on structurally.

Neither lives in this repository, so neither is reachable by the in-repo
coupling gate. This spec binds them across the repository boundary, mirroring
the OAP `factory-schema-lockstep` pattern.

## 2. Territory

This spec owns the lockstep checker, its committed lockfile, and the CI gate
that runs it. The app invariants it pins (`encore-app-architecture`,
`security-data-invariants`) are authored in template-encore; this spec pins
their content, it does not redefine them. The generator that consumes the
baseline is owned by spec 002.

## 3. Behavior

#### FR-001: The committed lockfile is the single source of truth

`baseline.lock.json` MUST pin: `upstreamSource` (the template-encore remote),
`pinnedRef` (a full 40-hex commit SHA), `baselineStructure` (`coreServices` the
generator clones, and `modules` the generator's own catalog covers), and
`invariantPin` (the
deferred-or-active invariant hash pin: a `status` of `deferred` or `pinned`, the
`specs` list covering at least the `encore-app-architecture` and
`security-data-invariants` invariants, and a `hashes` map filled only when
pinned). Bumping any pin is a coupling-gated edit to this spec.

#### FR-002: Three-dimension verification

The checker MUST verify, against a baseline checkout at the pinned ref:

- **Invariant pin**: every `invariantPin.specs` path is present in the baseline.
  When `status` is `pinned`, the re-hashed spec.md must match the pinned hash; a
  mismatch is reported as `DRIFT` and fails. When `status` is `deferred`, the
  hash is NOT enforced; a visible notice records that the pin is wired but not
  yet active. A missing invariant spec fails in both states.
- **Baseline structure**: every `coreServices` path exists in the baseline.
- **Catalog binding**: every `modules` entry has a `manifest.json` in this repo's
  (factory-encore) catalog. Phase 2 relocated the catalog out of the baseline
  into this repo, so the baseline no longer co-carries it; only the generator's
  own catalog is verified.

#### FR-003: The invariant pin defers until the Phase 3 handshake, then activates

While `encore-app-architecture` was in flux `invariantPin.status` was `deferred`
(Phase 1 and Phase 2): `encore-app-architecture` absorbed the static-serving
wiring relocated out of spec 004 in Phase 2, so pinning its current hash earlier
would have locked a value about to change. The Phase 3 handshake (after the
template session finalized both invariants) flips `status`
to `pinned`, fills `hashes` with the SHA-256 of each invariant spec.md, and bumps
`pinnedRef` to the finalized baseline; this is the committed state. Any deferral
is visible (a notice), never a silent skip, and a later ref or hash bump remains
a deliberate, coupling-gated edit to this spec.

Recorded refreshes: `pinnedRef` advanced from `b37d3d7` to `c7603ee`
(template-encore main) on 2026-06-24 after verifying the intervening main commits
touched no pinned unit: the invariant spec.md hashes re-hash identical and the core
services are unchanged, so the bump moved only the ref, not the enforced content.
It then advanced from `c7603ee` to `89326a5` (template-encore main) on 2026-07-04.
This refresh is different in kind: it deliberately **re-blesses changed invariant
hashes**. Between the two refs template-encore reworked `security-data-invariants`
INV-6 from the Redis `rate-limiter-flexible` middleware to Postgres-native
fixed-window rate limiting (an UNLOGGED `rate_limit_counter` table plus migrations,
with `apiRateLimit` now also mounted on the `gateway` service and a `user_account`
email-column change) and renumbered its corpus to serial `000-016`, which together
rewrote both invariant spec.md files. Adopting that baseline is the coupling-gated
decision recorded here: the intervening main commits were reviewed, the pinned core
services are all present and unchanged at `89326a5`, and the module catalog is
factory-encore's own and unaffected, so only the two invariant hashes and the ref
move. This is not a spec edited to justify code: the generator gains nothing it did
not already do; the pin is advanced, with cause, so the gate re-anchors on the
baseline the generator now clones.

It then advanced from `89326a5` to `ddba5e9` (template-encore main) on 2026-07-08.
Like the `b37d3d7 -> c7603ee` refresh, this is a **hash-identical** advance: both
invariant spec.md hashes re-hash byte-identical at `ddba5e9`. template-encore
spec 018 added an optional baseline Redis client (`apps/api/lib/redis.ts`) plus the
`ioredis` dependency without touching either invariant spec, so the enforced
content is unchanged and only the ref moves. The generator adopts this baseline so
the `data-redis` promotion (spec 008 FR-001) can compose an `infra.config.json`
`redis` block against a baseline that carries the typed `lib/redis` client the
composed app (and the cron large-scale lock) imports.

#### FR-004: Fail-visible, never skipped-green

A missing baseline source, an unreadable pin, a missing invariant spec, or any
verification failure MUST fail the gate with a surfaced error. The gate is never
skipped to a green result (OAP `factory-schema-lockstep` FR-003 / AC-6 posture). In CI the
baseline is fetched by sparse checkout at the pinned ref from the public
template-encore remote; a fetch failure fails the gate.

#### FR-005: Local verifiability

The checker MUST resolve a baseline source from `--source`,
`TEMPLATE_ENCORE_SOURCE`, or a sibling `template-encore` checkout, so the
lockstep is runnable locally (`npm run lockstep`) and in CI with the same code.

## 4. Acceptance criteria

**AC-1.** `npm run lockstep` exits 0 against a template-encore checkout at the
pinned ref with the invariant pin active (the 001/002 spec.md hashes match), and
exits non-zero on any injected drift: an invariant-hash mismatch, a missing core
service, a missing catalog module, or a missing invariant spec.

**AC-2.** `vitest` covers each verification dimension: pinned-hash drift
detection, the deferred pin NOT enforcing hashes (notice only), a missing
invariant spec failing even when deferred, missing core service, and catalog
mismatch. It also asserts the committed lockfile is well-formed with
`invariantPin.status` = `pinned` and a full SHA-256 hash for each invariant spec.

**AC-3.** `ci-lockstep.yml` reads `pinnedRef` from the committed lockfile,
fetches the baseline at that ref, and runs the checker; a fetch or check failure
fails the job.

**AC-4.** Phase 3 handshake (done): flipping `invariantPin.status` to `pinned`
and filling `hashes` activated hash enforcement with no checker code change (only
the committed lockfile, its committed-lockfile test assertion, and this spec's
narrative changed).

## 5. Out of scope

- **Authoring the invariants** (`encore-app-architecture`,
  `security-data-invariants`): owned upstream in template-encore.
- **Schema parity for the OAP contract schemas**: covered by OAP's own
  `factory-schema-lockstep` in the open-agentic-platform repository; this spec
  pins the app baseline, not
  the contract schemas.
- **Automatic ref bumping**: a pin bump is a deliberate, coupling-gated edit.
