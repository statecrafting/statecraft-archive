---
id: "005-governance-native"
title: "The governance spine as a napi-rs native addon"
status: approved
created: "2026-07-20"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "001-packages-thesis"
establishes:
  - { kind: directory, path: "addon/governance-native/" }
summary: >
  The fourth package: `@statecrafting/governance-native`, the control
  plane's governance spine. Canonical JSON, the attest-ledger record
  chain with Ed25519 anchors, the deterministic action gate over an
  ordered check registry, and the rolling-window trust scorer, behind a
  JSON-in / JSON-out napi surface. It arrives by edge transfer from
  statecraft `addon/governance-native/`, unchanged in behavior and
  unchanged in license: AGPL-3.0, because no stamped customer app loads
  it. statecraft spec 008 keeps `backend/governance/` and its whole
  service design; only this one path moves.
---

# 005: The governance spine as a napi-rs native addon

## 1. Purpose

governance-native is the first of the two AGPL packages, and the first
package in this repository that is not permissive. It exists here for the
reason spec 001 section 1 gives: the npm scope had stopped describing
ownership. `@statecraft/governance-native` was the one case where the old
scope was honest (statecraft built it, statecraft is its only consumer),
so this move is not a correction of a misnamed package. It is
consolidation: the five packages the product family consumes are governed
by one spine, and a package governed in its consumer's corpus makes the
other consumers' governance a fiction (spec 000).

Nothing about the package changes but its address. The Rust is the Rust
statecraft spec 008 landed and proved: 22 pure-core tests covering
canonicalize vectors, append/verify tamper detection, gate determinism
with a pinned config hash, trust level transitions, and the section 4
gate to append to verify flow. This spec transfers it; it does not
redesign it.

## 2. Territory

A single napi-rs package, `addon/governance-native/`, plus the
per-platform binary packages napi generates from it:

| Package | Contents |
|---|---|
| `@statecrafting/governance-native` | the napi loader (`index.js` + `index.d.ts`, built); no binary |
| `@statecrafting/governance-native-darwin-arm64` | the `.node` for macOS arm64 |
| `@statecrafting/governance-native-linux-x64-gnu` | the `.node` for linux x64 |
| `@statecrafting/governance-native-linux-arm64-gnu` | the `.node` for linux arm64 |

The crate is self-contained: six crates.io dependencies exact-pinned at
`=0.1.0` (`canonical-keysort-json`, `attest-ledger-types`,
`attest-ledger-core`, `action-gate-types`, `action-gate-core`,
`trust-window`) plus ed25519-dalek, sha2, hex, base64 and serde. No
workspace dependency, no path dependency, and in particular no dependency
on `kernel-native`, `hiqlite-native`, or `toolchain`.

Module map: `canon` (canonical JSON + content hash), `ledger` (the
append-only record chain over a stateDir, plus Ed25519 anchoring), `gate`
(the v1 gate config schema and the four checks), `trust` (the
rolling-window scorer), `napi_api` (feature-gated delegators).

The crate keeps the two-build discipline it arrived with: `crate-type` is
`["cdylib", "rlib"]`, the `#[napi]` layer sits behind a default `node`
feature, and `cargo test --no-default-features` exercises the whole pure
core without linking the Node C API.

### 2.1 The gate config comes with the crate

The transfer had one genuine coupling to break. In statecraft the crate
reached out of its own directory with
`include_str!("../../../backend/governance/config/gate.v1.json")`, in
`gate.rs` and again in the `lib.rs` flow test. That path does not exist
here, and a package that reads its consumer's tree is not a package.

The v1 roster is vendored as `addon/governance-native/config/gate.v1.json`
and both includes point at it. This is not a fork of the config. The
addon already owned the gate config schema and the four checks (statecraft
spec 008 section 2: `action-gate` ships the machinery, not the domain
policy), so the roster belongs with the crate that implements it. The
consuming service keeps its own deployed copy at
`backend/governance/config/gate.v1.json`, which spec 008 still owns and
still reads at runtime from the app root.

Two copies, one asserted hash. `GATE_V1_CONFIG_HASH`
(`sha256:a0356df3a1d2ca95a030e1d9329a7ceb20a54fc1ed1834dd0b158047c306f107`)
is pinned by a test here and by a test there, over the same four ordered
check ids. Drift in either copy fails a test in its own repository, which
is the property statecraft spec 008 section 2 asked for ("config drift is
visible in review") and the reason two copies are safe rather than
sloppy. The hash is byte-unchanged by this move: the vendored file
produces exactly the hash statecraft pinned, verified by
`committed_config_hash_is_pinned` passing here on the first run.

## 3. Behavior

### 3.1 License: AGPL-3.0, and why the shield holds

AGPL-3.0, with its own LICENSE file, which the package did not carry in
statecraft (the license was declared in both manifests but no LICENSE
text shipped beside them). It has one now.

The license is not a property of where the code sits. It follows the one
question spec 001 section 3 asks: does a stamped customer app touch this
package? It does not. governance-native's only consumer is statecraft's
own `backend/governance/`, so it is exactly what statecraft spec 001
section 5's SaaS shield is for. Moving it into an Apache-2.0-rooted
repository does not relicense it, and the root license is a default, not
a claim (spec 001 section 3).

Two consequences are load-bearing:

1. **The dependency-direction invariant** (spec 001 section 3.2).
   `toolchain`, `hiqlite-native`, and `kernel-native` must never depend on
   this package: the copyleft would reach through the dependency and
   contradict the permissive promise made to stamped apps. The reverse is
   fine. Nothing in npm enforces this and the packages now sit adjacent
   in one tree, which is precisely why it is enforced mechanically here
   rather than asserted in prose (section 3.3).
2. **The Apache-2.0 argument that does not apply.** Any future proposal
   to relicense this package must be argued from customer reach. An
   argument from the root license, or from vendored Encore's MPL-2.0, is
   invalid on its face (spec 001 section 3.1).

### 3.2 The napi surface

Seven JSON-in / JSON-out functions, unchanged from what statecraft spec
008 section 2 specified and landed:

| Function | Contract |
|---|---|
| `canonicalize(json)` | `{canonical, sha256}` |
| `ledgerAppend(stateDir, record)` | `{seq, recordHash, chainHash}` |
| `ledgerVerify(stateDir)` | `{ok, seq, error?}` |
| `ledgerAnchor(stateDir, keyRef)` | the signed anchor (keyRef: base64 32-byte Ed25519 seed) |
| `gateEvaluate(configJson, ctxJson)` | `{outcome, reason, checkIds, blocking, configHash}` |
| `trustSample(snapshotJson, sample)` | the next snapshot (snapshotJson may be null) |
| `trustLevel(snapshotJson)` | `{level, score}` |

The ledger file store is the addon's (`<stateDir>/records.jsonl` as the
authority plus `<stateDir>/anchor.json`, genesis root
`sha256("statecraft.governance.ledger/v1")`), because `attest-ledger` is
storage-agnostic by design. That genesis seed string is a wire constant:
it is hashed into every existing chain, so renaming it would invalidate
the control plane's live ledger. It stays exactly as it is.

### 3.3 The license tier is enforced, not asserted

Spec 001 section 3.2 names the dependency-direction invariant as "the
invariant most likely to be violated by accident". Until this spec it
lived only in prose. It is now machine-checked.

The root `package.json` carries a `statecrafting.licenseTiers` map: every
governed package path to its declared license. `scripts/check-licenses.mjs`
reads that map and refuses when any of four things is false:

1. a package's `package.json` `license` field differs from its declared tier;
2. its `Cargo.toml` `license` field differs (where the package is a crate);
3. its LICENSE file is missing, or its text is not the license it declares;
4. any Apache-2.0-tier package names an AGPL-3.0-tier package in any
   dependency field (npm `dependencies` / `devDependencies` /
   `optionalDependencies` / `peerDependencies`, or Cargo `[dependencies]`
   and friends).

The check runs in the `spec-spine` workflow beside the governance gates,
so a violation fails the pull request. The map is the enforcement surface:
a new package joins by adding a row, and a package with no row fails the
check rather than passing silently.

`spec-spine.toml` would have been the more natural home, but spec-spine
rejects unknown configuration fields (`unknown field 'licensing', expected
one of manifest, domains, kind, layout, index, branding, coupling,
provenance, frontmatter`), so the workspace manifest carries it instead.

### 3.4 Publishing

Joins the spec 002 publish matrix (`.github/workflows/publish.yml`) with
the same three napi legs as hiqlite-native and kernel-native plus the
meta package, idempotent per version: a tag that does not bump this
package must not fail. Unlike kernel-native, the build script passes no
extra feature flag, because this crate's napi bindings are on by default.

## 4. Ownership: an edge transfer

statecraft spec 008 establishes two directories:
`backend/governance/` and `addon/governance-native/`. The second one
moves here; the first stays, and so does the spec.

| | |
|---|---|
| Edge that moves | `addon/governance-native/` |
| Edges that stay | `backend/governance/` |
| statecraft 008 status after | narrowed, **not retired** |

This is the discipline spec 001 section 4 exists to hold. statecraft 008
is a whole service design: the records/verify/gate/trust endpoints, the
CoreLedger index and trust store, the gate config the platform deploys,
the integration contract specs 005 and 006 call at their privileged
moments, and the attestation spine the platform calls its differentiator.
It is not an addon spec. Deleting it, or letting it lapse because "the
addon left", would delete the design record for code that is still
running. Its `establishes` list drops one entry and keeps the other, in
the same change that repoints its consumer at the published package
(section 5, acceptance item 3).

The same applies to `backend/governance/config/gate.v1.json`: it stays
statecraft's, deployed and read at runtime by the service, and section
2.1 explains why the addon's vendored copy does not contest that
ownership.

## 5. Acceptance

1. The pure core builds and tests green under
   `cargo test --no-default-features` (no napi, no Node C API): the 22
   tests statecraft proved, including the pinned gate config hash against
   the vendored roster and the gate to append to verify flow.
   **Satisfied**: 22 passed on the first run here.
2. `@statecrafting/governance-native` and its three platform packages
   publish at `0.1.0` with provenance, all declaring AGPL-3.0 with a
   LICENSE file.
3. statecraft builds against the published package: its root manifest
   depends on `@statecrafting/governance-native` at a pinned version
   instead of `file:./addon/governance-native`, its in-tree
   `addon/governance-native/` is gone, spec 008 has dropped that edge and
   kept `backend/governance/`, and its suite is green. Per spec 001
   section 5 the package is not done until a consumer builds against it.
   **Satisfied 2026-07-20** (statecrafting/statecraft PR #42): statecraft
   pins `0.1.0`, `addon/` is gone from that tree, spec 008 establishes
   `backend/governance/` alone and records the transfer in a dated status
   note, and its gates are green (typecheck clean, vitest 111 passed / 16
   skipped, `build:app` against the published package, spine compile 11
   specs / lint 0/0/0 / index fresh). The vendored gate roster produced
   the same pinned config hash on both sides.
4. `scripts/check-licenses.mjs` passes, with this package declared
   AGPL-3.0 and no Apache-2.0 package depending on it.
5. Spine gates green: compile, index check, lint `--fail-on-warn`.

## 6. Out of scope

- The `governance/` Encore service and everything it owns: endpoints, the
  CoreLedger index and trust store, the deployed gate config, the
  attestation data model. That is statecraft spec 008 and it stays there.
- Enforcing trust levels on real actions (advisory by statecraft spec 008
  section 5), external anchor publication, and key rotation ceremonies.
- Any change to the addon's behavior, surface, or wire constants. This is
  a transfer. A behavior change is a later version of this package, argued
  on its own.
- `fleet-native`, which is spec 006 and lands beside this one.
