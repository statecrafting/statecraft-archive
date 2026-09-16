---
id: "001-packages-thesis"
title: "The statecrafting packages: one scope, three licenses, one spine"
status: approved
created: "2026-07-17"
summary: >
  Five packages consumed across the product family are owned by whichever
  repo built them first, under three npm scopes that no longer describe
  ownership. Consolidate them under `@statecrafting/*` here, governed by
  this repo's spine. Nothing is relicensed: the root is Apache-2.0 as a
  default, vendored Encore stays MPL-2.0, and governance-native and
  fleet-native keep AGPL-3.0 because they are control-plane internals no
  stamped app touches. The split follows customer reach, not Encore's
  license. Ownership transfers one edge at a time; the exporting specs own
  backend/ code that stays and must survive intact.
depends_on:
  - "000-bootstrap"
establishes:
  - { kind: file, path: "README.md" }
---

# 001: The statecrafting packages

This spec is a record, not a work order. It holds the map until each
package lands under its own numbered spec (section 5). It deliberately
carries no `implementation` key: statecraft's thesis spec set
`implementation: pending` on a record and then needed a paragraph in its
`AGENTS.md` warning agents not to pick it up as one. A record has no
implementation state.

## 1. Purpose

Five packages are consumed across the product family but owned by
whichever repository happened to build them first. The npm scope had
stopped describing ownership:

- `@enrahitu/toolchain` and `@enrahitu/hiqlite-native` are named for the
  template, but statecraft (a different repo, a different license) is a
  first-class consumer of both.
- `@chancery/kernel-native` has no governing spec at all: chancery carries
  neither `spec-spine.toml` nor a `specs/` tree, and no LICENSE file,
  despite the package declaring Apache-2.0 in its manifest.
- `@statecraft/governance-native` and `@statecraft/fleet-native` are named
  for the control plane and consumed only by it, which is the one case
  where the scope was honest.

Consolidate all five under `@statecrafting/*` in this repository, governed
by this repository's spine (spec 000).

## 2. What consolidates here

| Package | From | License here |
|---|---|---|
| `@statecrafting/toolchain` | enrahitu `packages/toolchain/` + `vendor/encore/` | Apache-2.0; vendored Encore stays MPL-2.0 |
| `@statecrafting/hiqlite-native` | enrahitu `addon/` | Apache-2.0 |
| `@statecrafting/kernel-native` | chancery `kernel-addon/` | Apache-2.0 |
| `@statecrafting/governance-native` | statecraft `addon/governance-native/` | AGPL-3.0 |
| `@statecrafting/fleet-native` | statecraft `addon/fleet-native/` | AGPL-3.0 |

Nothing is relicensed by this move. Each package keeps the license it has
today. The repository root is Apache-2.0 because that is the right default
for the majority and for new packages, not because it overrides anyone.

## 3. The licensing model

The root license is a default, not a claim. Three licenses coexist here on
purpose, and the split follows one question: **does a stamped customer app
touch this package?**

- **Yes, so it must be permissive.** `toolchain`, `hiqlite-native`, and
  `kernel-native` are copied into or built into apps stamped from the
  enrahitu template. statecraft spec 001 section 5 requires the artifacts
  customers touch be unencumbered, so these are Apache-2.0. They already
  were; this repo preserves that.
- **No, so the shield holds.** `governance-native` (the policy kernel
  wrapper) and `fleet-native` (the deployd orchestration core) are
  control-plane internals. Their only consumers are statecraft's own
  `backend/governance/` and `backend/fleet/`. statecraft spec 001 section 5
  keeps the control plane AGPL-3.0 as a SaaS shield, and these two are
  exactly what that shield is for: `fleet-native` is the fleet engine.
  Moving them to a permissive license would let a competitor host a
  modified control plane, fleet orchestration included, without publishing
  anything. They stay AGPL-3.0.
- **Upstream's choice, preserved.** `vendor/encore/` is upstream Encore at
  MPL-2.0. MPL-2.0 is file-level copyleft: the files stay MPL-2.0 wherever
  they sit, and modifications to them are published under MPL-2.0.

### 3.1 The rationale that does not apply

This consolidation was first proposed on the reasoning that *because
encore.ts is MPL-2.0, the root must be Apache-2.0*. **That premise is
false and must not be repeated as this repo's justification.** Verified
2026-07-17 against the vendored tree:

- MPL-2.0 is file-level copyleft. Section 3.3 permits distributing a
  Larger Work "under terms of Your choice" as long as the Covered Software
  keeps its MPL obligations. MPL files sit fine under an Apache-2.0 root,
  and equally fine under an AGPL-3.0 one.
- MPL-2.0 section 1.12 names the GNU Affero General Public License,
  Version 3.0 as a **Secondary License**, and section 3.3 explicitly
  permits combining Covered Software with it. MPL-2.0 and AGPL-3.0 are
  compatible.
- That compatibility only breaks if a file carries the Exhibit B
  "Incompatible With Secondary Licenses" notice. No Encore source file
  does; the phrase appears only inside the stock MPL-2.0 LICENSE
  boilerplate, which prints Exhibit B as a template in every copy.

The standing evidence: statecraft is AGPL-3.0 and already consumes
`@enrahitu/toolchain`, vendored Encore included, lawfully and today.
Encore's license constrains nothing here.

The real reason to consolidate is section 1 (the scope had stopped
describing ownership) and the real reason for the license split is section
3 (customer reach). If a future change to the split is argued from
Encore's license, that argument is invalid on its face; re-derive it from
customer reach or do not make it.

### 3.2 The dependency-direction invariant

An Apache-2.0 package may **never** depend on an AGPL-3.0 package: the
copyleft would reach through the dependency and contradict the permissive
promise made to stamped apps. Concretely, `toolchain`, `hiqlite-native`,
and `kernel-native` must not take a dependency on `governance-native` or
`fleet-native`. The reverse is fine and expected.

This is the invariant most likely to be violated by accident, because
nothing in npm enforces it and the packages now sit adjacent in one tree.
Any spec landing a package states its dependency edges, and a package's
spec is the place this is checked.

## 4. Ownership is transferred, never duplicated

Every package moving here is currently owned by a spec that also owns code
that is **staying put**. The move transfers one edge; it does not delete a
spec.

| Exporting spec | Edge that moves | Edges that stay | Status |
|---|---|---|---|
| statecraft/006-fleet | `addon/fleet-native/` | `backend/fleet/` | complete |
| statecraft/008-governance-attestation | `addon/governance-native/` | `backend/governance/` | complete |
| enrahitu/002-in-process-hiqlite | `addon/` | `backend/hiq/` | complete |
| enrahitu/018-packaged-chassis | `packages/` | `.github/workflows/publish.yml` | complete |
| enrahitu/008-vendored-encore-toolchain | `vendor/encore/` | `infra.config.dev.json`, `docker/Dockerfile.base` | complete |

**No exporting spec retires.** Every one of the five is mixed: it owns a
path that moves and at least one path that stays, so each drops the moving
path and keeps the rest. statecraft 006 and 008 in particular are whole
service designs (deploy/status/update/backup, and the attestation spine the
platform calls its differentiator); they are not addon specs and must
survive this migration intact.

An earlier draft of this spec claimed enrahitu/008 retired outright on the
grounds that `vendor/encore/` was its sole edge. That was false: it also
establishes `infra.config.dev.json` and `docker/Dockerfile.base`, both of
which stay. The error came from reading the corpus with an ad-hoc grep for
lines matching `path:`, which silently skips bare-string `establishes`
entries that carry no `path:` key. It is recorded here because it is the
exact failure `.claude/rules/governed-artifact-reads.md` exists to prevent,
and because "this spec has nothing left to own" is the one conclusion that
would have deleted a design record. Read ownership with
`spec-spine registry show`, never by grepping the markdown.

Chancery exports `kernel-addon/` with no edge to drop, because it has no
spine. Its ungoverned status is why `kernel-native` arrives here with a
spec for the first time.

## 5. The migration ladder

One package per spec, one spec per session. The order runs deepest
dependency first, so each step's consumers are already building against a
published package before the next step moves:

- **002: toolchain.** `packages/toolchain/` plus `vendor/encore/` (MPL).
  Retires enrahitu 008; drops `packages/` from enrahitu 018.
- **003: hiqlite-native.** Drops `addon/` from enrahitu 002.
- **004: kernel-native.** From chancery. Arrives with the LICENSE file
  chancery never had.
- **005: governance-native.** AGPL-3.0 retained. Drops
  `addon/governance-native/` from statecraft 008.
- **006: fleet-native.** AGPL-3.0 retained. Drops `addon/fleet-native/`
  from statecraft 006.

Each spec lands: the code, its LICENSE file, its entry in both
`standalone_rust_workspaces` and `standalone_npm_packages`, the publish
wiring, the exporting spec's edge drop, and the consumers repointed from
`file:./addon/*` to the published `@statecrafting/*` dependency.

A package is not done when it builds here. It is done when its consumers
build against the published package and the exporting spec no longer
claims the path.

## 6. Out of scope

- The consuming services. `backend/fleet/`, `backend/governance/`, and
  `backend/hiq/` stay in their repositories under their existing specs.
- Relicensing anything. This migration preserves every package's current
  license (section 2). A relicense is a separate decision, argued from
  customer reach, amending statecraft spec 001 section 5.
- Chancery's spine. Chancery gets no `spec-spine.toml` here; `kernel-addon/`
  simply leaves. Whether what remains of chancery deserves governance is
  its own question.
