---
id: "002-encore-generator-core"
title: "Encore generator core: copy-base + select-driver + merge-config"
status: approved
created: "2026-06-10"
owner: bart
kind: architecture
domain: generator
risk: medium
implementation: complete
# The `encore-app-architecture`, `multi-driver-auth-service`, and
# `spa-static-serving` invariants describe the base app this generator clones;
# they live in template-encore and are pinned here via the lockstep
# (006-factory-schema-lockstep). Only the in-corpus dependency is kept.
depends_on: ["001-module-manifest-schema"]
code_aliases: ["ENCORE_GENERATOR_CORE"]
summary: >
  The app generator: setup-app.ts scaffolds a new application by copying
  the base Encore app, selecting an auth driver by configuration, composing
  selected service modules (directory copy + declarative merge via
  encore-composer.ts, including a JSONC-aware CORS merge), merging env
  templates, and regenerating the typed client. add-module.ts /
  remove-module.ts apply the same composition incrementally. Three profiles:
  minimal, public, internal.
establishes:
  - "adapters/acme-vue-encore/scripts/setup-app.ts"
  - "adapters/acme-vue-encore/scripts/add-module.ts"
  - "adapters/acme-vue-encore/scripts/remove-module.ts"
  - "adapters/acme-vue-encore/scripts/validate-modules.ts"
  - "adapters/acme-vue-encore/scripts/lib/env-merger.ts"
  - "adapters/acme-vue-encore/scripts/lib/encore-composer.ts"
  - "adapters/acme-vue-encore/scripts/lib/born-with.ts"
  - "adapters/acme-vue-encore/scripts/lib/template-json.ts"
  - "adapters/acme-vue-encore/scripts/lib/install-module.ts"
  - "adapters/acme-vue-encore/scripts/lib/adapter-manifest.ts"
---

# 002. Encore generator core: copy-base + select-driver + merge-config

## 1. Purpose

The application generator scaffolds new Encore applications from the
template. Its design principle is **compile-time composition**: Encore
discovers services from the filesystem at build time, so the generator's
job is to produce a correctly-shaped directory tree, not to emit a runtime
loader. Composition happens when the application is generated — not when it
runs — because the Encore service model has no concept of a runtime plugin
registry. There is no `registerAllModules(app)` call to generate; the
copied service directories are the composition.

`setup-app.ts` is the primary entry point. `add-module.ts` and
`remove-module.ts` apply the same composition steps incrementally against
an already-generated application. `encore-composer.ts` is the shared
engine for all three.

## 2. Territory

This spec owns the ten generator files listed in `establishes`: the `setup-app`,
`add-module`, `remove-module`, and `validate-modules` CLIs, plus the
generator-core libraries under `scripts/lib/` (`encore-composer`, `env-merger`,
`born-with`, `template-json` for the `template.json` state, `install-module` for
the install engine, and `adapter-manifest` for the profile-to-module authority).
The module manifests consumed by the generator are owned by spec 001. The base
Encore app being copied is owned by the `encore-app-architecture` spec. Auth
drivers
are owned by the `multi-driver-auth-service` spec. The dual-app generator that
runs `setup-app` twice is owned by spec 004.

## 3. Behavior

### 3.1 `setup-app` pipeline

#### FR-001 — Copy the base Encore app

`setup-app.ts` MUST copy the template's Encore application tree into
`--dest`, excluding template-governance machinery that does not belong in a
generated application:

**Included** (carried into the produced app):
- the runnable app: `apps/api/`, `apps/web/`, `apps/web-internal/`,
  `packages/`, root config (`package.json`, `tsconfig*.json`,
  `eslint.config.mjs`, `.env.example`, `.gitignore`, `pnpm-workspace.yaml`);
- the born-with governance kernel: `standards/`, `spec-spine.toml`,
  `.claude/`, `CODEMAP.md`, `AGENTS.md`, `Makefile`, `tools/`;
- the app-invariant specs under `specs/` (the generator meta-specs are
  dropped), and `docs/` minus the template-dev docs.

**Excluded** (create-time generator machinery):
`scripts/`, `modules/`, `orchestration/`, `.derived/`, the generator
meta-specs, `docs/encore-ts/`, `docs/migration/`, `node_modules/`, `.git/`,
`bin/`.

`Makefile` and `tools/` are governance substrate, not generator machinery:
the carried spec corpus and CI depend on them in the produced app. Spec
000-bootstrap `establishes: Makefile`, and the carried `ci-supply-chain.yml`
runs `tools/lint/workflow-pins.sh`; stripping them made every produced app
fail its own born-with CI (a missing `Makefile` unit raises spec-lint I-004
so `index check` fails; the missing lint script exits 127). `.derived/` is
excluded because it is regenerated per produced app at scaffold time over
the produced tree, not carried verbatim (the template's copy would be
stale). The canonical carry classifier is
`adapters/acme-vue-encore/scripts/lib/born-with.ts`
(`BORN_WITH_KERNEL_TOP_LEVEL` / `GENERATOR_ARTIFACT_TOP_LEVEL`).

#### FR-002 — Auth-driver selection by configuration

Auth-driver selection MUST be configuration only. A profile sets
`AUTH_DRIVER` in the destination `apps/api/.env.example` and ensures the
matching `secret()` bindings are present in `apps/api/infra.config.json`.
Both drivers (`mock`, `rauthy`) ship in-app (the `multi-driver-auth-service`
spec) and coexist; the
active driver is determined by the `AUTH_DRIVER` environment variable at
runtime, not by which files are present. No driver files are copied or
deleted during generation.

#### FR-003 — Three profiles

| Profile | `AUTH_DRIVER` | Secrets bound | Intended use |
|---------|---------------|---------------|--------------|
| `minimal` | `mock` | none | Local development; mock login only |
| `public` | `rauthy` | `RAUTHY_*` | External-facing application |
| `internal` | `rauthy` | `RAUTHY_*` (+ `GATEWAY_OAUTH_*` when BFF is included) | Staff-facing application |

`SQLDatabase("app")` (the `db` service, the `encore-app-architecture` spec) is always present in
every profile. Redis is optional, rate-limit backing only (`REDIS_URL`).
There is no session-store axis.

#### FR-004 — Compose service modules

For each module selected for the destination, `encore-composer.ts` MUST
apply the steps in §3.2. Composition replaces any runtime plugin-registration
step; the copied service directory is the entire act of adding a service to
the application.

#### FR-005 — Regenerate the typed client

After composition, `setup-app` MUST invoke `encore gen client` (and
optionally `--lang=openapi`) against the destination app when the Encore
CLI is available in the environment. It MUST target the canonical committed
client path the born-with CI checks, `apps/web/src/lib/encore-client.ts`, by
running the destination app's own `gen:client` script
(`npm --prefix apps/api run gen:client`) rather than a hand-rolled `--output`
(an earlier direct invocation wrote to `apps/web/src/client.ts`, a stray file
nothing reads). When the CLI is not present, the committed typed-client
reference (born-with template-encore) is left in place with a log note.

### 3.2 `encore-composer.ts` — the composition engine

`encore-composer.ts` implements `composeModule` (install) and
`decomposeModule` (remove) as the shared composition primitives.

#### FR-006 — Service directory copy

For each name in `services[]` (spec 001 schema), `composeModule` MUST copy
`modules/<module>/files/<service>/` to `apps/api/<service>/` in the
destination. Encore discovers the service at compile time; no loader is
generated or updated.

#### FR-007 — Migration merge with renumbering

`composeModule` MUST merge each file in `migrations[]` into
`apps/api/db/migrations/` using a deterministic renumbering rule: the next
free numeric prefix (`<n>_`) is assigned based on the highest existing
migration number in the destination. File names are otherwise preserved.
`decomposeModule` reverses the merge using a recorded `composedMigrations`
map.

#### FR-008 — `infra.config.json` secret binding

`composeModule` MUST add each name in `secrets[]` as a `secret()` binding
in `apps/api/infra.config.json`. No secret values are ever written to the
filesystem; only the binding declaration is added. `decomposeModule`
removes the bindings.

The `infra.config.json` secret-binding merge is owned **exclusively** by
the composer (`composeModule` / `decomposeModule`). `env-merger.ts` MUST
NOT duplicate this I/O.

#### FR-009 — JSONC-aware CORS merge

`composeModule` MUST merge each entry in `corsEntries[]` into
`apps/api/encore.app`'s `global_cors` field using a JSONC-aware parser
(comment-preserving). The real `apps/api/encore.app` contains `//`
comments; a plain-JSON parse would destroy them. When a `global_cors` field
becomes empty on `decomposeModule`, the composer MUST delete the field
entirely rather than leave a stale `"field": []`. An empty key that arises
from `modify(.., undefined)` MUST also be deleted (not written as an empty
entry).

#### FR-010 — Decompose warning

When `decomposeModule` is called on an installation that lacks a
`composedMigrations` record (a legacy install that predates migration
tracking), the composer MUST emit a visible warning and skip migration
deletion rather than silently omitting it. Silent skipping produces
invisible state; a warning makes the operator aware that manual cleanup may
be needed.

#### FR-011 — Middleware and package dependency recording

`composeModule` MUST record `middlewares[]` entries for the composed
service (used to configure `encore.service.ts`'s middleware array). It
MUST apply `packageDeps` entries to `apps/api/package.json` in the
destination. `decomposeModule` reverses both.

### 3.3 `env-merger.ts`

#### FR-012 — Non-secret env management

`env-merger.ts` manages non-secret environment variables in
`apps/api/.env.example`. It MUST support append and comment operations
over `envVars[]` entries from the manifest schema (spec 001). It MUST NOT
read or write `apps/api/infra.config.json` (the secret-binding I/O is
exclusively the composer's, per FR-008).

### 3.4 `add-module.ts` / `remove-module.ts`

#### FR-013 — Incremental composition

`add-module.ts` and `remove-module.ts` apply `composeModule` and
`decomposeModule` against an already-generated application. They MUST track
the installed module set in `template.json` in the destination root, so
`decomposeModule` can reverse the exact composition that was applied.

### 3.5 Git initialization (developer-UX only)

#### FR-014 — `git init` skipped for machine-driven runs

As a final best-effort step, `setup-app` runs `git init` in the destination
so a manually-generated app is immediately a repository. This is developer
convenience only and MUST be skipped whenever the run is machine-driven:
`--no-git` / `NO_GIT=true` suppress it explicitly, dry-run never reaches
it, and `--no-install` / `NO_INSTALL=true` (the consuming platform's
prebuilt materialization) implies `--no-git`. Machine-driven invocations
must not receive VCS state — the consumer owns repository initialization,
and an embedded commit-less repo inside a larger project tree breaks the
consumer's `git add -A` ("does not have a commit checked out"). A
fully-manual run still initializes the destination as a repository.

### 3.6 Why composition happens at generation time

Encore's service model is compile-time and filesystem-based. Services are
discovered from `encore.service.ts` files in the directory tree; there is
no equivalent of a runtime `app.use(...)` chain or a priority-sorted driver
registry to populate. Generating a runtime loader would produce a
non-Encore artifact. Instead, the generator copies service directories and
merges declarative config files; the Encore compiler sees a complete,
static tree and resolves the graph without any generated intermediary. This
also means the generated application has no generator dependency: it is a
plain Encore app that boots and builds on its own.

## 4. Acceptance criteria

**AC-1.** `npx tsx scripts/setup-app.ts --profile <p> --dest <d>` (for
each of `minimal`, `public`, `internal`) produces a destination where
`cd <d>/apps/api && encore check` exits 0. A search for `express` or
`express-session` as a dependency or import in the generated app returns
zero matches.

**AC-2.** Each profile sets the correct `AUTH_DRIVER` in
`apps/api/.env.example` and binds exactly the matching secrets in
`apps/api/infra.config.json`.

**AC-3.** `encore-composer.ts` unit tests cover: migration renumbering,
`infra.config.json` secret add/remove, JSONC-aware CORS merge (with
comment preservation), empty-cors-key deletion, service directory copy and
reversal, and the decompose warning for a legacy (no `composedMigrations`)
install.

**AC-4.** `vitest --config scripts/vitest.config.ts` is green (zero
failures); the active tests cover all `encore-composer.ts` merge functions,
all three `setup-app` profiles, and the incremental `add-module` /
`remove-module` flows.

**AC-5.** `npx spec-spine compile` exits 0; `npx spec-spine lint
--fail-on-warn` exits 0; `npx spec-spine couple --base origin/main` exits
0 for all ten files owned here.

## 5. Out of scope

- **Dual-app generation** (`setup-dual-app.ts`): owned by spec 004, which
  invokes the `setup-app` core twice.
- **`user-management` module contents**: the module's service directory and
  manifest are owned by spec 003; this spec owns the engine that installs
  it.
- **Frontend SPA nav composition** (`generateWebModulesTs`, Vue nav
  registration): unaffected by the backend's compile-time model; the Vue
  runtime nav path is outside this spec's territory.
- **`packages/auth` / `packages/config` disposition**: the generator does
  not emit or depend on these packages; their long-term status is a
  separate decision.
- **Instant-revocation capability** (token-epoch / jti denylist): an
  auth-configuration option for deployments requiring it; not part of the
  base generator pipeline.

## Amendment (2026-07-09): drop the template website/ from produced apps

The born-with carry-forward classifier (`scripts/lib/born-with.ts`) is
whitelist-by-default: any top-level entry not in a skip set is classified
`'app'` by `classifyEntry` and copied into the produced app. The template's own
Docusaurus documentation site (`website/`, `baseUrl: /template-encore/`) matched
no skip set, so it shipped into every generated tenant repo despite documenting
template-encore itself and having no runtime role in a produced app. Added
`'website'` to `GENERATOR_ARTIFACT_TOP_LEVEL` (the same treatment as `scripts` /
`modules` / `orchestration` / `.derived`), with a seeded baseline-fixture entry
and a negative assertion in `setup-app.test.ts` so the drop is exercised.
`requirements/` (factory pipeline output) and the born-with `specs/` corpus are
intentionally still carried.

Couples the born-with policy change to its owning spec per the coupling gate.

## Amendment (2026-07-10): drop the docs-website's spec and deploy workflow too

The 2026-07-09 amendment stripped `website/` but left the `specs/` corpus fully
carried, calling that intentional. It was not complete. Template-encore's spec
`016-docs-website` `establishes: ["website/", ".github/workflows/deploy-docs.yml"]`,
and the born-with `specs/` drop only consulted `GENERATOR_META_SPEC_IDS`
(factory-encore's own create-time slugs, which never match a baseline slug). So
every produced app carried spec 016 while `website/` had just been removed. When
stagecraft's per-request scaffold ran `spec-spine index` over the produced tree
it emitted I-004 (`file unit 'website/' does not exist` for spec 016) and the
fail-closed `index check` correctly rejected the scaffold, orphaning the job:

```
index is STALE ... stale shard(s): by-spec/016-docs-website (blocking diagnostics)
```

This was a genuine spec/code drift introduced by the incomplete 2026-07-09
cleanup, not a stagecraft gate bug: the gate did its job.

Fix, completing the earlier amendment:

- Added `TEMPLATE_DEV_SPEC_IDS` to `born-with.ts` (currently `016-docs-website`)
  and consulted it alongside `GENERATOR_META_SPEC_IDS` in `classifyEntry`'s
  `specs/` branch. A produced app now carries neither the stripped `website/`
  nor the spec that `establishes:` it.
- Dropped the orphaned `.github/workflows/deploy-docs.yml` (spec 016's other
  established artifact) in `setup-app.ts`'s copy walk, alongside the existing
  `docs/encore-ts` / `docs/migration` skips. Every other `.github/workflow`
  (ci-supply-chain, etc.) stays born-with the app.
- Seeded `specs/016-docs-website` plus a kept/dropped `.github/workflows` pair
  in the baseline fixture, with negative assertions in `setup-app.test.ts`.

Invariant for the future: a template-dev spec that `establishes:` an artifact
this generator strips MUST be added to `TEMPLATE_DEV_SPEC_IDS`, or the produced
app's own `index check` will fail closed the same way.

Couples the born-with policy change to its owning spec per the coupling gate.
