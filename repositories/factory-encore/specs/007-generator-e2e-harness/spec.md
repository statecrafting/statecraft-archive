---
id: "007-generator-e2e-harness"
title: "Generator e2e harness: structural PR gate + build-matrix nightly + against-main drift sweep"
status: approved
created: "2026-06-28"
owner: bart
kind: governance
domain: ci-cd
risk: medium
implementation: complete
depends_on: ["002-encore-generator-core", "006-factory-schema-lockstep"]
code_aliases: ["GENERATOR_E2E_HARNESS"]
summary: >
  The lockstep gate (spec 006) pins the baseline's invariant hashes but never
  compiles the composed module payloads against the live template-encore
  baseline, so module-vs-baseline drift (an audit-API rename, a renamed
  `user_account` column) passes lockstep and only breaks at `encore check`. This
  spec stands up an end-to-end harness that drives the generator (spec 002)
  directly against a template-encore checkout across the full profile x module
  matrix (22 produced apps) and verifies each, replicating stagecraft's scaffold
  contract with no stagecraft and no OAP in the loop. It runs on three lanes,
  mirroring OAP's expensive-e2e posture: a cheap structural matrix gated per-PR
  on the generator surface and folded into the terminal ci-gate; a full
  build-matrix nightly against the pinned ref (non-gating, issue-on-failure); and
  a weekly against-main drift sweep that opens a deduplicated tracking issue on
  divergence.
establishes:
  - "adapters/acme-vue-encore/e2e/run-e2e.sh"
  - "adapters/acme-vue-encore/e2e/lib/common.sh"
  - ".github/workflows/generator-e2e.yml"
  - ".github/workflows/generator-e2e-nightly.yml"
  - ".github/workflows/generator-e2e-drift.yml"
---

# 007. Generator e2e harness: structural PR gate + build-matrix nightly + against-main drift sweep

## 1. Purpose

factory-encore does not author the runnable application: it clones the
template-encore lean baseline and composes modules into it (spec 002). Two gates
already guard this seam, and both have a blind spot the same shape:

- The in-repo **coupling gate** (spec 000) refuses code that drifts from its
  owning spec, but it cannot reach across the repository boundary into
  template-encore.
- The cross-repo **lockstep gate** (spec 006) pins the baseline's invariant
  hashes and structural shape, but it does not *compile* the composed module
  payloads against the live baseline.

So a module written against an older baseline (an `audit.ts` actor field renamed
`userId` -> `actorId`; a `user_account` primary key changed from
`pk_user_account` TEXT to `id` UUID) passes both gates and only fails when a
generated app actually runs `encore check`. This spec closes that gap with an
end-to-end harness that produces real apps and builds them, the way the
consuming platform (stagecraft) would.

The harness is also the parity artifact for the thin-consumer thesis: it proves
the generator plus the baseline can enact everything stagecraft's create-project
flow needs, with no stagecraft and no open-agentic-platform in the loop.

## 2. Territory

This spec owns the harness scripts (`adapters/acme-vue-encore/e2e/run-e2e.sh`
and its `lib/common.sh`) and the three CI lanes that run them. It does NOT own:

- the generator scripts the harness drives (spec 002),
- the module catalog the harness composes (spec 001 / 003),
- the lockfile or lockstep checker (spec 006),
- the app invariants compiled by `encore check` (authored in template-encore).

The harness is a *consumer* of all of the above; it asserts their composition,
it does not redefine them.

## 3. Behavior

### 3.1 The matrix

#### FR-001: Stagecraft-faithful production

For each single-app profile (`minimal`, `public`, `internal`) the harness MUST
produce: the base app (no extra modules), each of the five catalog modules
composed on its own, and all five composed together; for the `dual` topology, the
two-app output with no extras. That is `3 * (1 + 5 + 1) + 1 = 22` produced apps.
Profiles are materialised with `setup-app.ts --profile <name> --source
<template-encore>` (and `setup-dual-app.ts` for dual) under `NO_INSTALL=true`;
extra modules are composed with `add-module.ts <mod> --no-install` in the
catalog `INSTALL_ORDER`, skipping any module the profile already ships by default
(read from the prebuilt `template.json`). This mirrors stagecraft's
`ensurePrebuilts` + `scaffoldFromPrebuilt` + `moduleCatalog` exactly.

### 3.2 Two verification layers

#### FR-002: Structural verification (always, Node-only)

For every produced app the harness MUST assert, without compiling: the backend
(`apps/api` + `encore.app`) carried forward; the correct `AUTH_DRIVER` for the
profile (`mock` for minimal, `rauthy` otherwise); no generator artifacts
(`scripts/`, `modules/`, `orchestration/`) leaked into the produced tree; each
requested module recorded in `template.json` with its payload present; and
dependency auto-resolution (`api-gateway` pulls in `security-core`). Structural
verification MUST require only Node + tsx (no Encore CLI, no Docker), because the
generator skips `npm install` and `encore gen client` under `--no-install`.

#### FR-003: Build verification (default; the real compile gate)

By default (skippable with `--no-build`) each produced app MUST be built exactly
as template-encore's own CI does: root `npm install`, `npm --prefix apps/api
install`, `npm run typecheck:api` (`encore check`), `npm run typecheck`, `npm run
build`; for dual, both `public/` and `internal/`. This layer requires the Encore
CLI and Docker (`encore check` provisions a local Postgres and runs the composed
migrations). The harness resets the local DB before each `encore check`
(`encore db reset --all`) because every generated app carries the same empty
`encore.app` id and the matrix runs serially; this is a harness concern, not a
product one.

### 3.3 Three CI lanes

#### FR-004: Structural PR gate (cheap, required)

`generator-e2e.yml` MUST run the structural matrix (`run-e2e.sh matrix
--no-build`) against a template-encore checkout fetched at the lockstep pinned
ref. It is routed on the generator surface from `ci.yml` (the same
changed-path filter that gates `generator-ci`) and folded into the terminal
`ci-gate`, so it is a required per-PR check. Being Node-only, it is cheap enough
to gate every generator-touching PR; it catches composition/wiring drift
(the STRUCT-class defects) before merge.

#### FR-005: Build-matrix nightly against the pinned ref (non-gating)

`generator-e2e-nightly.yml` MUST run the full build matrix against the baseline
at the pinned ref, on a cron schedule plus `workflow_dispatch`. It is
deterministic (same ref as lockstep), non-gating (NOT in `ci-gate`), uploads
`results.tsv` and the per-step build logs, and opens a tracking issue on
failure. It catches regressions that only surface under a real compile of the
composed app, without eroding the per-PR runtime budget. This mirrors OAP's
`opc-e2e-nightly` posture.

#### FR-006: Against-main drift sweep (non-gating, issue-routed)

`generator-e2e-drift.yml` MUST run the full build matrix against
`template-encore@main` (NOT the pin), on a weekly cron plus `workflow_dispatch`.
Its purpose is to surface baseline drift (the module-vs-baseline compile-break
class) before the pin is bumped. On a build failure it MUST open or annotate a
single tracking issue deduplicated by label (so the channel does not become
noise), rather than failing a gate. An operational failure (cannot fetch the
baseline) still fails the job (fail-visible, never skipped-green). This mirrors
OAP's `ci-factory-schema-lockstep-cron` against-main posture.

### 3.4 The gate must be able to go red

#### FR-007: The runner exit code propagates the matrix verdict

A lane is only a gate if it can fail. The runner (`run-e2e.sh`) MUST exit
non-zero when any combo is not green, and when zero combos ran (nothing
verified is a failure, not a pass). The matrix, `all`, and single-`combo`
dispatch paths all terminate in the results report, so the report's exit status
is the runner's exit status: it is zero only when every recorded combo is `PASS`
(or `STRUCT-OK` under `--no-build`) and at least one combo ran. Without this, a
red combo would print in the table but the lane would still exit zero, silently
defeating FR-004 (the required PR gate), FR-005 (issue-on-failure nightly), and
FR-006 (drift issue-routing).

## 4. Acceptance criteria

**AC-1.** `npm run e2e:struct` produces all 22 apps and passes structural
verification (22/22) against a template-encore checkout, requiring only Node +
tsx.

**AC-2.** `npm run e2e:build` additionally builds each produced app
(`encore check` + typecheck + build) and reports a per-combo PASS/FAIL table; a
module-vs-baseline drift (e.g. an injected audit-API or `user_account` rename)
makes the owning combos FAIL at `encore check`.

**AC-3.** `generator-e2e.yml` is routed from `ci.yml` on the generator filter,
runs the structural matrix at the pinned ref, and is one of `ci-gate`'s required
upstreams (failure or cancellation blocks merge; a skip when the generator
surface is untouched passes).

**AC-4.** `generator-e2e-nightly.yml` runs on a cron schedule, is NOT in
`ci-gate`, uploads `results.tsv` + logs, and opens an issue on failure.

**AC-5.** `generator-e2e-drift.yml` runs weekly against `template-encore@main`,
opens/annotates a single label-deduplicated tracking issue on a build
divergence, and fails the job on an operational (fetch) failure.

**AC-6.** The runner exits non-zero when the results table contains any non-green
verdict (or zero combos) and zero only on an all-green matrix, so `npm run
e2e:struct` / `e2e:build` and the three lanes fail visibly on a red combo
(FR-007).

## 5. Out of scope

- **Authoring the generator, the module catalog, or the app invariants**: owned
  by specs 002 / 001 / 003 and upstream template-encore respectively.
- **The lockstep hash pin**: owned by spec 006; this harness complements it (it
  compiles what lockstep only hashes) but does not change it.
- **Per-app infrastructure isolation**: the shared-local-DB reset is a harness
  workaround; a real deployment uses per-app infra and is not this spec's
  concern.
- **A byte-identical stagecraft parity test**: asserting stagecraft's scaffold
  path reproduces these trees is downstream (stagecraft) work, not owned here.
