---
id: "002-toolchain"
title: "The Encore build toolchain: vendored core, per-platform binaries"
status: approved
created: "2026-07-17"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "001-packages-thesis"
establishes:
  - { kind: directory, path: "vendor/encore/" }
  - { kind: directory, path: "packages/toolchain/" }
  - { kind: directory, path: "packages/toolchain-darwin-arm64/" }
  - { kind: directory, path: "packages/toolchain-linux-x64/" }
  - { kind: directory, path: "packages/toolchain-linux-arm64/" }
  - { kind: file, path: ".github/workflows/publish.yml" }
  - { kind: file, path: "package.json" }
summary: >
  The first package lands: the Encore build toolchain moves from enrahitu
  to `@statecrafting/toolchain`, bringing the vendored Encore tree
  (`vendor/encore/`, MPL-2.0, pinning upstream v1.57.9) and the three
  per-platform binary packages that carry `encore-runtime.node` and
  `tsparser-encore`. It is the deepest dependency in the family: both
  enrahitu and statecraft build with it. Retires
  enrahitu/008-vendored-encore-toolchain (whose only edge is
  `vendor/encore/`) and drops `packages/` from enrahitu/018-packaged-chassis.
---

# 002: The Encore build toolchain

## 1. Purpose

The toolchain is the deepest dependency in the product family: enrahitu
builds with it, statecraft builds with it, and every stamped app builds
with it. It is named `@enrahitu/toolchain` today, which is the clearest
case of the scope lying about ownership (spec 001 section 1): statecraft
is not enrahitu, and pulls this package from npm on every install.

It moves first because everything else builds on it. Publishing
`@statecrafting/toolchain` before the other packages move means each later
migration lands against an already-published toolchain rather than a
moving target.

## 2. Territory

Four npm packages, not one. The meta package carries the drivers and
resolves a per-platform binary package at runtime:

| Package | Contents |
|---|---|
| `@statecrafting/toolchain` | the dev/build/bundle drivers; no binary |
| `@statecrafting/toolchain-darwin-arm64` | `encore-runtime.node` + `tsparser-encore` |
| `@statecrafting/toolchain-linux-x64` | same, linux x64 |
| `@statecrafting/toolchain-linux-arm64` | same, linux arm64 |

The three platform packages are `optionalDependencies` of the meta
package; npm installs only the one matching the host.

`vendor/encore/` is the upstream Encore source the binaries are built from,
pinned at `v1.57.9`. It is build-time only: the meta package's `files` list
is `bin`, `lib`, `scripts`, `README.md`, and vendored Encore appears in
none of them. It is 6.6 MB tracked; the multi-gigabyte working tree is
`target/` build output and is gitignored.

**`git archive` cannot move this tree.** enrahitu's `.gitattributes` marks
the entire Encore build tree `export-ignore`: `Cargo.toml`, `Cargo.lock`,
`proto/`, `tsparser/`, `miniredis/`, `runtimes/core/`, and
`runtimes/js/src/`. That is correct and deliberate there, because the
factory exports a stamp with `git archive` (enrahitu spec 005) and a
stamped app must not carry Encore's build tree; it consumes the published
platform packages instead. The consequence for this migration is a trap:
`git archive` silently yields 197 of 625 files, dropping every Rust source
and the workspace manifest, and the omission does not surface until
`cargo` reports a missing manifest path. The tree must be copied from the
git index by path list (`git ls-files` piped to `rsync --files-from`), not
exported.

`package.json` at the root is a build harness, not a shipped artifact: it
carries `build:runtime`, which cargo-builds `encore-js-runtime` and
`encore-tsparser` out of `vendor/encore/` and links the results into the
platform package. It is `private` and never published.

## 3. Behavior

### The MPL boundary

`vendor/encore/` is MPL-2.0 and stays MPL-2.0 (spec 001 section 3). This is
the one directory in this repository under that license. The rules that
follow from MPL-2.0 being file-level copyleft:

- Modifications to files under `vendor/encore/` are published under
  MPL-2.0. The vendored tree is not a dumping ground for our own code; a
  change there is a change to Encore, and it carries Encore's license.
- The Apache-2.0 root does not reach into it and does not need to. MPL
  files sit lawfully under a differently-licensed larger work
  (MPL-2.0 section 3.3).
- The binaries built from it (`encore-runtime.node`, `tsparser-encore`) are
  MPL-2.0 object code and ship inside the platform packages. Those packages
  therefore declare MPL-2.0 in their manifests, not Apache-2.0: a package
  whose entire payload is built from MPL sources does not get to call
  itself permissive. This is a correction to what enrahitu published, where
  the platform packages inherited `Apache-2.0` from the meta package by
  copy-paste.

### Versioning

The `@statecrafting/*` packages track their own semver, independent of any
consumer's release tags. Publishing is idempotent: a tag that does not bump
a package must not fail the publish job, so each leg checks npm for the
exact version and skips if present. This is inherited from
enrahitu/018-packaged-chassis and is load-bearing, not incidental.

### Publishing

`.github/workflows/publish.yml` runs a three-leg matrix on version tags:
`darwin-arm64` on `macos-14`, `linux-x64` on `ubuntu-24.04`, `linux-arm64`
on `ubuntu-24.04-arm`. Each leg builds its own binaries natively; there is
no cross-compilation. One designated leg (`darwin-arm64`) additionally
publishes the meta package.

The binaries cannot be built locally for all three platforms from one
machine, so publishing is CI-only by construction. It requires the
`NPM_TOKEN` repository secret and the claimed `@statecrafting` npm scope,
both of which exist as of 2026-07-17.

### The old names

`@enrahitu/toolchain@0.1.0` and its platform packages are live on npm
(published 2026-07-15). They are deprecated with a message pointing at
`@statecrafting/toolchain`, not unpublished: unpublishing breaks anyone who
already resolved them, and npm's 72-hour window makes it unreliable anyway.

Deprecation needs a token with `@enrahitu` scope access. The operator
token in use is granular and scoped to `@statecrafting` alone, so the
deprecation is an operator step recorded in Acceptance, not something this
spec's CI can perform.

## 4. Ownership transfer

Per spec 001 section 4, this move transfers edges rather than deleting
specs. Neither exporting spec retires:

- **enrahitu/008-vendored-encore-toolchain drops `vendor/encore/`** and
  keeps `infra.config.dev.json` and `docker/Dockerfile.base`, which stay in
  enrahitu. The spec itself stays `approved` and `complete`: it remains the
  design record of why Encore is vendored at all (rust core + js runtime via
  napi-rs, no CLI), which is the reason this package exists, and it still
  owns two live files.
- **enrahitu/018-packaged-chassis drops `packages/`** and keeps
  `.github/workflows/publish.yml`, which continues to publish enrahitu's
  own artifacts until spec 003 moves hiqlite-native too.

## 5. Acceptance

1. `@statecrafting/toolchain` and the three platform packages are published
   at `0.1.0` with provenance.
2. The platform packages declare MPL-2.0; the meta package declares
   Apache-2.0.
3. enrahitu builds against `@statecrafting/toolchain` from npm, with
   `vendor/encore/` and `packages/` removed from its tree, and its gates
   pass. **Satisfied 2026-07-22** against `0.2.0` (statecrafting/enrahitu PR
   #25): the three vendored trees are deleted, `encore.dev` resolves from the
   registry, and `npm ci` + `build:app` + `check:model` + `typecheck` + the
   full test suite pass in CI (`verify` green).
4. statecraft builds against `@statecrafting/toolchain` and its gates
   pass. **Satisfied 2026-07-22** against `0.2.0` (statecrafting/statecraft
   PR #54): the control plane builds and tests green on the repointed scope.
5. enrahitu/008 no longer claims `vendor/encore/` and still owns
   `infra.config.dev.json` and `docker/Dockerfile.base`; enrahitu/018 no
   longer claims `packages/`. Neither spec is retired or deleted.
   **Satisfied** (enrahitu PR #25): 008 drops `vendor/encore/` and keeps the
   two files; 018 drops `packages/` and `.github/workflows/publish.yml` (which
   was removed with the packages) and becomes an edgeless design record; 002
   drops `addon/`. No spec retired.
6. **Operator step:** `@enrahitu/toolchain` and its platform packages are
   deprecated on npm with a message naming the new package. Requires an
   `@enrahitu`-scoped token; not performable by this repo's CI.

## 6. Out of scope

- `hiqlite-native`, which moves next (spec 003) and shares this publish
  workflow's matrix.
- Bumping the pinned Encore version. This move preserves `v1.57.9`
  exactly; an upgrade is its own change.

## Amendment (2026-07-21): the app-model extract surface catches up (0.2.0)

When the toolchain was first copied here (0.1.0, 2026-07-17), its only
surface was the dev/build/bundle drivers. enrahitu then kept improving its
*local* `packages/toolchain` after the copy was taken: enrahitu spec 020
(the app-model contract) and spec 021 (kernel consumption) added a TS-tier
app-model extractor to it. That surface reached npm under neither scope,
because enrahitu consumes its toolchain through a `file:` link and never
needed to publish it. The published `@statecrafting/toolchain@0.1.0` was
therefore stale relative to what enrahitu now depends on, and enrahitu
could not drop its local copy (Acceptance items 3 to 5) without regressing:
its `verify.yml` and `check:model` run `enrahitu-extract`, which 0.1.0 does
not ship.

This amendment lands that catch-up so the published package matches enrahitu's
source of truth, bumping all four packages to **0.2.0**. It is a pure copy of
enrahitu's extract surface with one functional adaptation; every shared driver
file was already byte-identical modulo scope identity.

- **New surface**, added to the meta package: the `enrahitu-extract` bin
  (`bin/extract.mjs`), the `lib/extract/` subsystem (meta decode, lowering,
  canonical serialization/hashing, verify, the usage ban-list), and `proto/`.
  The bin joins the existing `enrahitu-*` set (the historical bin names are
  kept, spec 002 continuity).
- **The `proto/` tree** (`encore/parser/{meta,schema}/v1/*.proto`) is copied
  verbatim from `vendor/encore/proto` at the pinned `v1.57.9` and loaded at
  runtime by `lib/extract/meta.mjs` to decode `.encore/build/meta`. It is
  MPL-2.0 file-level content and extends the §3 MPL boundary: MPL schema files
  sit lawfully inside the Apache-2.0 meta package (MPL-2.0 section 3.3), the
  same standing as the MPL binaries in the platform packages. The meta's
  `files` list gains `proto`.
- **New runtime dependencies** of the meta package: `protobufjs` (meta
  decode), `ajv` (schema validation in verify), `typescript` (the usage
  extractor parses the TS tier), and `@statecrafting/kernel-native` (^0.1.0).
  The extractor closes the cross-language loop through the kernel: it computes
  `gate.configHash` and the genesis payload via the kernel and refuses to emit
  a model when the kernel's independently-computed model hash disagrees with
  the toolchain's. The kernel is Apache-2.0, so the meta stays customer-reaching
  clean (spec 001 section 3.2); `npm run check:licenses` confirms it.
- **The one functional adaptation:** the usage ban-list targets
  `@statecrafting/hiqlite-native` (the post-repoint addon name, spec 003), not
  enrahitu's `@enrahitu/hiqlite-native`, so a consumer on the new packages is
  linted against the specifier it actually imports.
- The repo root's `package.json` gains a `protobufjs` devDependency so the
  extract subsystem's shipped pure-function tests run under this repo's
  `npm test` alongside `resolve.test.ts`.

This unblocks the consumer repoint: with `@statecrafting/toolchain@0.2.0`
published, enrahitu and statecraft can move their toolchain dependency onto it
(Acceptance items 3 and 4) and enrahitu can delete its local `packages/toolchain`.
Those consumer greens, not this amendment, are what flip `implementation` to
complete.

## Amendment (2026-07-22): observability.otel is observed, not declared (0.3.0)

enrahitu spec 022 (the observability contract) requires the extracted model's
`observability.otel` to flip to `true` "because the extractor observes the
wiring, not because anyone edited JSON". Until now the extract surface lowered
`observability` as a straight pass-through of `app-manifest.json`. This
amendment moves `otel` from the declared side to the observed side, bumping
all four packages to **0.3.0** (lockstep, per the 0.2.0 precedent; the
platform carriers change version only).

- **The wiring anchor.** `lib/extract/usage.mjs` gains `OBS_TRACER =
  "backend/obs/tracer.ts"` alongside the existing governed-facade constants,
  and an exported `otelObserved(repoRoot, serviceRelPaths)` walk: `otel` is
  observed `true` iff at least one service outside `backend/obs/` transitively
  imports the tracer anchor, under the same traversal rules as
  `observeService` (relative imports only, terminal at the governed facades,
  never entering `backend/kernel/` or `backend/core/ledger/`). The obs service
  referencing its own tracer proves nothing; reach from an instrumented
  sibling service is the wiring being observed. The observation is app-level
  by design: it claims the app runs a tracer, not that every service is
  instrumented.
- **Lowering.** `lowerModel` takes the observation as an input and emits
  `observability: { ...manifest.observability, otel: <observed> }`;
  `metricsPath` (and any future member) still joins from the manifest.
- **A new verify rule.** `observabilityViolations`: the manifest's declared
  `observability.otel` must equal the observed value, or extraction fails
  with exit 1 naming the disagreement. The manifest stays an honest
  declaration; the model stays observed truth; a hand-flip of either side
  alone cannot pass.
- **Type-only imports are erased.** `importEdges` now skips whole-clause
  `import type` declarations, type-only named elements, and type-only
  re-exports: they vanish at runtime, so they are neither a faculty touch
  nor a wiring edge. Mixed imports keep their value names, and an import
  whose named list is emptied by the filter keeps its edge (a side-effect
  import survives some emitters). This also keeps a consumer's
  `import type { LedgerDriver }` from `backend/core/ledger/driver` out of
  the db-family observation.
- Determinism holds: the observation is a pure function of the source tree
  (enrahitu spec 020 §3.5), no env or wall-clock input.

The consumer flip rides enrahitu spec 022: enrahitu bumps its toolchain
dependency to `^0.3.0`, wires `backend/obs/`, flips its manifest declaration,
and re-extracts; the committed model then records `otel: true` under the
staleness gate.

## Amendment (2026-07-29): the state layer is a second governed facade (0.4.0)

enrahitu's pivot (its spec 001) makes hiqlite the state layer rather than a
cache, and its spec 032 gives that surface a governed facade of its own,
`backend/state/`. The extract surface had one facade over the addon wired
into it by name, so a second one was a hard error rather than a new
observation: every file in `backend/state/` tripped the `raw-hiq-init-import`
ban, and none of its named exports mapped to a capability kind. All four
packages go to **0.4.0** (lockstep, per the 0.2.0 and 0.3.0 precedent; the
platform carriers change version only).

- **Two facades, one per raft group.** `lib/extract/usage.mjs` gains
  `STATE_FACADE_DIR = "backend/state/"` beside the existing constants, and
  the `raw-hiq-init-import` ban becomes a path-prefix rule admitting
  `backend/kernel/hiq.ts` and anything under `backend/state/`. This is not a
  loosening of the honesty clause but a restatement of it: the addon handle
  is still reachable from exactly two places, and the split follows the raft
  groups, which have genuinely different guarantees. `backend/kernel/hiq.ts`
  governs the CACHE group, which is not durable and does not survive a full
  cluster restart, and `backend/state/` governs the SQLITE group, which is
  the durable store. One module fronting both would put two durability
  contracts behind one import.
- **A directory, not a file.** The other facades are single files; this one
  splits by concern (sql, watch, lease, backup, migrate) and a consumer may
  import from the barrel or from a submodule. The walk terminates on the
  directory prefix so both routes observe the same touch and neither is a
  hole.
- **`STATE_KINDS`.** The facade's named exports map to kinds:
  `query`/`queryConsistent`/`schemaVersion` to `db.read`,
  `execute`/`executeReturning` to `db.write`, `txn` to `db.txn`, `migrate`
  to `db.migrate`, `lock`/`withLease` to `lock.acquire`, `notify` to
  `notify.publish`, `listen` to `notify.listen`, and the three backup calls
  to `bucket.write`/`bucket.list` on `state-backups`.
- **Why backup is a bucket capability.** The kernel's vocabulary is a fixed
  28 kinds (enrahitu spec 020 §3.3) and boot refuses a model declaring one it
  does not know, so a `backup.*` kind would need a kernel-native release and
  a contract amendment before the facade could exist. It is also not needed:
  a backup genuinely is an object-store write of the database, and
  `bucket.write` is classified non-read, so it fails closed at `read-only`
  trust. If a later contract adds backup kinds, this map is the only thing
  that changes.
- **`otelObserved` terminates there too**, on the same prefix, so the tracer
  walk keeps treating governed facades as leaves and the two walks stay
  consistent with each other.

Determinism holds: the mapping is static and the walk is a pure function of
the source tree.

The consumer flip rides enrahitu spec 032: enrahitu bumps its toolchain
dependency to `^0.4.0` and its hiqlite-native dependency to `^0.2.0`, adds
`hiqlite` to its own `contracts/app-model.schema.json` engine enum (that
schema is the consumer's, read from the repo under verification, not shipped
here), and re-extracts.
