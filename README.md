# statecrafting

The shared native packages behind the statecraft product family: the
napi-rs addons and the Encore build toolchain that statecraft, enrahitu,
and chancery all consume.

## Status

Born governed. The spec spine landed before the packages
(`specs/000-bootstrap/`); `specs/001-packages-thesis/` records what
migrated here, why, and in what order.

All five packages of that ladder have now arrived: toolchain (002),
hiqlite-native (003), kernel-native (004), governance-native (005), and
fleet-native (006). No exporting spec retired: each dropped the one path
that moved and kept the code it still owns.

Two specs follow the ladder and govern how the repository is worked rather
than what it ships: build verification (007) compiles every addon on every
publish platform before a tag can spend a version, and the session harness
(008) claims the agentic loop itself, so an edit to what an agent may do here
is a governed change like any other.

## Why this repo

These packages were scattered across three repositories under three npm
scopes, and the scope had stopped describing ownership: `@enrahitu/toolchain`
is a build dependency of statecraft, which is not enrahitu, and
`@chancery/kernel-native` had no governing spec at all. One repo, one
`@statecrafting/*` scope, one spine.

| Package | Comes from | License |
|---|---|---|
| `@statecrafting/toolchain` | enrahitu `packages/toolchain/` | Apache-2.0 (vendored Encore stays MPL-2.0) |
| `@statecrafting/hiqlite-native` | enrahitu `addon/` | Apache-2.0 |
| `@statecrafting/kernel-native` | chancery `kernel-addon/` | Apache-2.0 |
| `@statecrafting/governance-native` | statecraft `addon/governance-native/` | AGPL-3.0 |
| `@statecrafting/fleet-native` | statecraft `addon/fleet-native/` | AGPL-3.0 |

## Licensing

**Read `specs/001-packages-thesis/` before adding or relicensing a package.**
The root is Apache-2.0 and that is the default for new packages, but the
root license is a default, not a claim: three licenses coexist here on
purpose. The permissive packages are the ones stamped customer apps
consume, and they must stay unencumbered. `governance-native` and
`fleet-native` are control-plane internals that keep statecraft's AGPL
shield, and no permissive package may depend on them.

Every package declares its own license in its manifest and carries its own
LICENSE file. Never infer a package's license from the root or from a
neighbour: the three `@statecrafting/toolchain-<platform>` packages are
MPL-2.0, sitting between an Apache-2.0 meta package and an Apache-2.0 root,
because they carry the vendored Encore binaries.

This is enforced, not just documented. The root `package.json` declares
every package's license tier under `statecrafting.licenseTiers`, and
`npm run check:licenses` refuses when a manifest, a Cargo.toml, or a
LICENSE file disagrees with its tier, when a package is missing from either
the tier map or `spec-spine.toml`'s inventory, or when a customer-reaching
package takes a dependency on an AGPL-3.0 one. It runs on every pull
request beside the spine gates.

## Governance

Governed by [spec-spine](https://github.com/statecrafting/spec-spine)
(`cargo install spec-spine-cli`, or `npm i -g spec-spine`). `spec-spine.toml`
sets `[meta] required_version = ">=0.18.0"`, so a binary too old for the verbs
below is refused at the call rather than answering with a misleading exit code.

`Makefile` is the single definition of the gate, and
`.github/workflows/govern.yml` runs the same targets, so the local loop and the
CI loop cannot drift:

```bash
make gate        # read-only: check, lint, index coverage, couple
make refresh     # writing: recompute the committed shard trees
make typecheck test licenses    # the stack gate CI runs beside the loop
```

Read `.derived/**` only through `spec-spine` subcommands; the shards are
compiler-owned.

The session harness that drives all of this (`AGENTS.md`, `.claude/`,
`.githooks/`) is the spec-spine kit, governed by
`specs/008-session-harness/spec.md`. `AGENTS.md` is the cross-agent protocol
and the authority for the gate command list; start a session with `/prime`, or
`/setup` on a fresh clone.
