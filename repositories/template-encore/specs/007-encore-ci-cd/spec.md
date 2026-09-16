---
id: "007-encore-ci-cd"
title: "Encore CI/CD: composite actions, CI workflow, CD example, typed-client staleness gate"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: medium
implementation: complete
depends_on:
  - "001-encore-app-architecture"
  - "005-spa-static-serving"
  - "009-repo-ci-orchestrator"
code_aliases: ["ENCORE_CI", "ENCORE_CD"]
summary: >
  Encore delivery plumbing: encore-install and encore-build composite
  actions, the reusable encore-ci.yml workflow (web type-check/build,
  encore check, typed-client staleness diff with volatile-prefix
  normalisation), and the inert encore-cd.yml.example deployment recipe.
  Encore CI is dispatched from ci.yml's encore route and required by
  ci-gate.
establishes:
  - ".github/actions/encore-install/action.yml"
  - ".github/actions/encore-build/action.yml"
  - ".github/workflows/encore-ci.yml"
  - ".github/workflows/encore-cd.yml.example"
---

# 007 — Encore CI/CD: composite actions, CI workflow, CD example, typed-client staleness gate

## 1. Purpose

This spec governs the Encore-specific CI/CD layer of the template: two
composite actions that install and build the Encore CLI, a reusable CI
workflow that validates the app on every pull request touching the app
surface, a typed-client staleness gate, and an inert deployment recipe. Encore
CI is a required check: it is dispatched from `ci.yml`'s `encore` route
(spec 009) and its result is aggregated by the terminal `ci-gate` job.

## 2. Territory

This spec owns the four files listed under `establishes`. It holds
section-level co-authority on `ci.yml`'s `jobs.changes` and `jobs.ci-gate`
with spec 009: the `encore` route in `jobs.changes` and the `encore` entry in
`ci-gate.needs` are governed jointly.

`encore-cd.yml.example` is inert (it is not a `.yml` file and the workflow-pins
lint does not scan it). Activating it requires renaming to `.yml` and
SHA-pinning every `uses:` (spec 011).

## 3. Behavior

### FR-001 — `encore-install` composite action

`encore-install/action.yml` MUST:

- Download and install the Encore CLI.
- Disable telemetry.
- Verify the installed version.
- Default the version pin to the template's `encore.dev` runtime version
  (currently `1.57.9`), not `latest`, so the typed client the scaffold generates
  is structurally identical to the one this CI regenerates and checks (the
  FR-005 typed-client staleness gate / OAP spec 220 AC-2). Keep the pin in
  lockstep when bumping `encore.dev`.
- Expose the CLI's absolute path (`/home/runner/.encore/bin/encore`) via a
  `cli-path` output. A composite action cannot mutate the calling job's `$PATH`,
  so the absolute path is the documented contract.
- Use only `run:` steps — no `uses:` of its own.

### FR-002 — `encore-build` composite action

`encore-build/action.yml` MUST:

- Build the base Docker image: `docker build -f Dockerfile.base`.
- Build the Encore container image: `encore build docker --config
  infra.config.json --base <base>`.
- Tag and push to the configured registry.

This action is consumed by the CD path (`encore-cd.yml.example`).

### FR-003 — `encore-ci.yml` workflow structure

`encore-ci.yml` runs as a reusable workflow (`on: workflow_call`) dispatched
exclusively by `ci.yml`'s `encore` route. It MUST NOT carry a standalone
`pull_request` or `push` trigger. It also accepts `workflow_dispatch` for
manual runs.

The workflow contains three jobs:

**`web`**
- `npm ci` (workspace root)
- `build:packages` (shared packages)
- Type-check `apps/web` and `apps/web-internal`
- `build:web` (build the external SPA into `apps/api/web/build` per spec 005)

**`api`**
- Install the Encore CLI via `./github/actions/encore-install`
- `npm ci` in `apps/api` (standalone, not a workspace member)
- `encore check` (parse + topology + type-check + boot + schema application against an
  ephemeral Postgres)
- `npm run test:integration` (`encore test`): the `*.itest.ts` suites (refresh-token
  rotation against the database, the BFF proxy handler) against the ephemeral Postgres

**`client-staleness`**
- Put the CLI on `$GITHUB_PATH`
- `npm --prefix apps/api run gen:client` (regenerate the typed client)
- Normalize volatile prefixes in both the committed and freshly generated
  `apps/web/src/lib/encore-client.ts` before diffing
- Fail if the normalized files differ (structural drift: new or changed
  endpoints or types)

### FR-004 — Typed-client staleness gate (determinism contract)

The generated Encore client embeds a per-generation-random app-id prefix in
the `Environment()` URL, the `Client` doc comment, and the `User-Agent`, plus
the CLI version. The template intentionally leaves `encore.app` `id` empty, so
these values vary by environment.

The `client-staleness` job MUST replace the file's own app-id prefix and the
CLI version with placeholders in both the committed and the fresh client before
diffing, so only structural drift (new/changed endpoints or types) fails. A
naive diff sees these volatile lines as changed; the normalized diff MUST see
none when the API is unchanged.

### FR-005 — `encore-cd.yml.example` (inert template)

The CD recipe ships as `.example` so it is not active and not scanned by the
workflow-pins lint. It documents:

- CLI install via `encore-install`
- `npm ci` and `encore gen client`
- `npm run build`
- `encore-build` to GHCR

It also carries a documented generic container deploy step (a
`deploy --image ...` invocation against the target container host) as a
commented template. Activating it requires renaming to `encore-cd.yml`,
provisioning a registry and secrets, and SHA-pinning every `uses:` reference
(spec 011).

### FR-006 — SHA-pinning

Every third-party `uses:` in the active `encore-ci.yml` MUST be pinned to a
full 40-hex commit SHA (spec 011). Path-local refs
(`./.github/actions/encore-install`) are exempt from the pin requirement. The
composite actions themselves carry no `uses:`.

Current pins in `encore-ci.yml`:

- `actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10  # v6.0.3`
- `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6.4.0`

### FR-007 — ci.yml routing (co-authority)

`ci.yml`'s `jobs.changes` MUST contain an `encore` boolean output computed by
inline `git diff` over the app surface:
`apps/**`, `packages/**`, `.github/actions/encore-*`,
`.github/workflows/encore-ci.yml`.

On `merge_group` or `workflow_dispatch` the `encore` output falls back to
`true` so the gate also runs in the merge queue.

`ci.yml`'s `jobs.ci-gate` MUST include `encore` in its `needs:` list so an
Encore CI failure blocks merge and a skip (non-app PR) reads as success.

## 4. Acceptance criteria

**AC-1.** `encore-ci.yml` passes on a PR touching the app surface: the `web`
job type-checks both SPAs and builds `apps/api/web/build`; the `api` job runs
`encore check` and the `encore test` integration suites cleanly; the
`client-staleness` job produces a normalized diff of zero lines.

**AC-2.** `npx spec-spine lint --fail-on-warn` passes over `.github/workflows/encore-ci.yml`
(SHA-pin check via spec 011 gate in the supply-chain workflow).

**AC-3.** `npx spec-spine compile` exits 0; `npx spec-spine index check` reports the
index current (the workflow file is a hashed input); `npx spec-spine couple --base
origin/main` is clean.

**AC-4.** A PR that changes an Encore endpoint causes the `client-staleness` job
to fail when the committed `encore-client.ts` is not regenerated.

**AC-5.** `encore-cd.yml.example` is absent from the workflow-pins lint scan
(the lint scans `*.yml`/`*.yaml` only).

## 5. Out of scope

- CD activation — `encore-cd.yml.example` stays inert until a downstream project
  provisions a registry and secrets, renames the file, and SHA-pins its `uses:`.
- The container-host zip/artifact deployment path: spec 008.
- The spec-spine governance workflow (`.github/workflows/spec-spine.yml`) —
  spec 000.
- Supply-chain gates (`ci-supply-chain.yml`) — spec 010.
