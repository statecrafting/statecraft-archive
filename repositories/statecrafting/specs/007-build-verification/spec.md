---
id: "007-build-verification"
title: "Build verification: compile the addons before a tag can spend a version"
status: approved
created: "2026-07-29"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "002-toolchain"
  - "003-hiqlite-native"
  - "004-kernel-native"
  - "005-governance-native"
  - "006-fleet-native"
establishes:
  - { kind: file, path: ".github/workflows/build.yml" }
summary: >
  Publishing here is CI-only and tag-triggered, and until this spec the
  only workflow that compiled a napi-rs addon was the one that published
  it. A Rust change could reach `main` reviewed but never built, and the
  first compile on a Linux leg happened after the tag was pushed, when the
  version number had already been spent. This adds a pull-request gate that
  builds all four addons on all three publish platforms with the same
  release profile publish uses, and runs hiqlite-native's two behavioral
  sanity suites on each leg. It deliberately does not gate the vendored
  Encore runtime build; section 4 records why that is a decision and not an
  oversight.
---

# 007: Build verification

## 1. Purpose

The publish matrix (spec 002, `.github/workflows/publish.yml`) is the only
place the native code in this repository was ever compiled by CI. That is
a consequence of the same constraint that makes publishing CI-only: napi
binaries cannot be cross-compiled from one host, so each platform package
is built on its own runner. The workflow that does the building is the
workflow that does the publishing.

The gap this leaves is narrow and expensive. A pull request that changes
`addon/hiqlite-native/src/lib.rs` runs `spec-spine.yml` (compile, index
staleness, lint, licenses, coupling) and nothing else. Governance passes,
review passes, the change merges, and the first machine to attempt
`cargo build` for `x86_64-unknown-linux-gnu` is the publish leg, running
against a tag. By then the version in `package.json` is the version the
world will see: publish.yml is idempotent by version, so recovering from a
failed leg means bumping to a version nobody asked for, and until that
bump the meta package may already be on npm advertising
`optionalDependencies` on platform packages that were never produced.

The exposure grew with spec 003's 0.2.0. The state-layer feature set turns
on `sqlite`, which compiles SQLite-C into the `.node`, plus `s3` and `cron`
by way of `backup`. That is a materially larger and more
platform-sensitive build than the pure-Rust cache addon it replaced, and it
was verified on darwin-arm64 only, by hand, before its tag.

This spec closes that: a pull-request gate that compiles what publish
compiles, where publish compiles it.

## 2. Territory

One file, `.github/workflows/build.yml`. It owns no source and changes no
package; it is evidence infrastructure.

The gate is path-filtered to `addon/**` and to itself. A PR touching only
specs, standards, or the toolchain packages does not pay for it. This
matters because the build is `--release` and `hiqlite-native` sets
`lto = true`, so a cold leg is minutes, not seconds.

## 3. Behavior

The matrix is the spec 002 platform set, unchanged and in the same order:
darwin-arm64 on `macos-14`, linux-x64 on `ubuntu-24.04`, linux-arm64 on
`ubuntu-24.04-arm`. `fail-fast: false`, so one platform's failure does not
hide another's. Each leg:

1. Installs the same toolchain prerequisites publish installs (protoc,
   cmake) through the same OS-conditional steps.
2. Restores a cargo cache keyed on every addon lockfile. The four addons
   are separate cargo workspaces that share a registry and most of a
   dependency graph, so they share one cache entry; any dependency bump
   invalidates it.
3. Builds each of the four addons with the package's own `npm run build`,
   which is `napi build --platform --release`. The release profile is not
   an optimization here but a correctness requirement: `lto = true` links
   differently from a debug build, and a gate on the debug profile would
   not be evidence about the artifact that ships.
4. Runs hiqlite-native's `sanity.mjs` (cache and counters, spec 003) and
   `sanity-state.mjs` (the state-layer surface, enrahitu spec 032) on every
   leg. Both are self-contained: they boot a single-voter node against a
   `mkdtemp` directory on loopback ports and exit nonzero on the first
   failed check, so no external service, fixture, or secret is involved.
5. Asserts that each addon produced a binary named for this leg's napi
   triple, which is the exact filename publish.yml's assembly step copies.

Step 4 is the part that makes this a verification gate rather than a
compile check. Two of the defects spec 003's 0.2.0 work found were
invisible to the compiler and visible immediately to a running node:
`ValueOwned::Null` is a unit variant, so serde emitted the string `"Null"`
where JSON `null` was intended, and a lock handle dropped Rust-side turned
a lease into a silent no-op. A gate that only proved the crate compiles
would have passed both.

Step 5 is cheap and catches a specific, plausible failure: `napi.targets`
in a package manifest and the `cp` in publish.yml name the triple twice, in
two files, and a rename in one is a publish-time `cp: No such file`.

## 4. Out of scope

**The vendored Encore runtime build.** `npm run build:runtime` compiles
`vendor/encore` (upstream Encore, MPL-2.0) and produces the binaries the
three `toolchain-<platform>` packages carry. It is not gated here, for
three reasons that hold together and would need re-examining if any one
stopped being true:

- The tree is upstream and pinned (`ENCORE_VERSION=v1.57.9`). No pull
  request in this repository authors Rust inside it; it moves only when the
  pin moves, which is a deliberate, reviewed act.
- It is the most expensive build in the repository by a wide margin, and
  charging every `addon/**` pull request for it would make the gate
  something contributors route around.
- Its failure mode is cheaper. A toolchain leg that fails at publish costs
  a tag, not a version: the addon packages publish from the same leg and
  are skipped on the retag by the idempotence check, so the recovery is to
  fix and retag rather than to bump past a spent version.

**Cross-consumer verification.** That a published addon satisfies its
consumer (enrahitu booting the real Encore process against it) is proven in
the consumer's own suite, on the consumer's spine. This gate answers "does
it build and does it behave," not "does it still fit."

**Publishing.** Unchanged, spec 002's territory. This gate makes a green
tag likelier; it does not gate the tag, because tags are pushed to `main`
after these checks have already run on the pull request that produced it.

## 5. Acceptance

1. A pull request touching `addon/**` runs three `addons (<platform>)` jobs
   and no others beyond the governance gate.
2. All three legs build all four addons and pass both sanity suites.
3. A pull request touching only `specs/**` does not trigger the workflow.
4. `workflow_dispatch` runs the full matrix on demand, which is how a
   release is pre-flighted before its tag.

## 6. Implementation record

Landed 2026-07-29, on the pull request that introduced it: the gate's
first run is its own acceptance evidence, since the workflow file is inside
the path filter that triggers it.

It was authored to de-risk the 0.2.0 publish of `@statecrafting/hiqlite-native`
(spec 003), whose Linux legs had never been compiled by any machine at the
time the version was cut.
