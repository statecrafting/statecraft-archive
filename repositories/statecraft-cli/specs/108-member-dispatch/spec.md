---
id: "108-member-dispatch"
title: "Member dispatch: the umbrella grows a local, account-less face"
status: approved
created: "2026-09-07"
implementation: complete
depends_on:
  - "102-crate-scaffold"
establishes:
  - { kind: symbol, id: "statecraft_cli::members" }
extends:
  # 102 owns the crate scaffold; dispatch is wired into its command tree
  # (`External` and `Members` arms), its dispatcher, its module list and its
  # manifest (libc, unix-only, for signal forwarding). The acceptance tests
  # live beside 102's under tests/. All additive; 102 remains the owner.
  - { spec: "102-crate-scaffold", unit: "Cargo.toml", nature: additive }
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  - { spec: "102-crate-scaffold", unit: { kind: symbol, id: "statecraft_cli::cli::Command" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: { kind: symbol, id: "statecraft_cli::commands::dispatch" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: "src/main.rs", nature: additive }
  - { spec: "102-crate-scaffold", unit: { kind: directory, path: "tests/" }, nature: additive }
summary: >
  Every verb this binary has is a client of a hosted control plane
  through `api.rs` and `auth.rs`. There is no local-execution verb and
  no notion of a member, and that gap is the whole of the transition
  design doc 01 describes in the claude-observatory repository: the
  orchestrator, its sensor and its Claude driver become member
  binaries that this CLI dispatches to. This spec gives the umbrella
  its second face. It discovers `statecraft-*` binaries on PATH and in
  a managed member directory, reads each one's manifest before
  trusting it, dispatches an unknown top-level verb to the member
  whose name matches, passes the member's exit code back verbatim, and
  does all of it without requiring a login. The local loop has to work
  for someone who has never authenticated, because that is the product
  the Encore-model split gives away; coupling dispatch to the
  control-plane session would make the free half depend on the paid
  one. The member side of this contract is spec
  042; the two were authored as one decision.
---

# 108: Member dispatch

## 1. Cross-repo dependency

The member contract is defined by spec 042 and restated
below as this CLI's expectation. Unlike specs 103 and 104, where the control
plane's spec wins because the plane is the authority, 042 and this spec are
two halves of one decision authored together: neither is the authority, and a
divergence between them is a defect in both. If the contract has to change,
both are amended in the same breath, and the `contract` field in the manifest
(§3) is what makes a mismatch detectable at runtime rather than at a
support call.

A member that does not exist yet must not be a crash. Until the
claude-observatory members are built and installed, `statecraft members list`
reports an empty set and any dispatch attempt reports the member as not
found, with the reserved exit code from §7, matching how §1 of spec 104
requires a missing service to surface.

## 2. Discovery

- `statecraft <name> <args...>` where `<name>` is not in the clap command
  tree resolves to a member binary called `statecraft-<name>`.
- Two locations are searched, in this fixed order: the managed member
  directory (§4), then `PATH`. The managed directory wins so that a member
  the user installed through `statecraft` is not shadowed by an unrelated
  binary that happens to sit earlier on `PATH`.
- The resolution order is fixed, documented, and reported. `members list`
  names the location each member was found in, so a shadowed member is
  visible rather than silently ignored.
- Discovery reads the manifest (§3) of every candidate before any of them is
  dispatched to. A candidate whose manifest does not parse is listed as
  refused with the parse error, and is never executed for any other purpose.

## 3. The manifest, and what the umbrella does with it

Every member answers `--member-manifest` by writing one JSON object to
stdout and exiting 0 (spec 042 B-3):

```
{
  "schemaVersion": "1",
  "name": "statecraft-engine",
  "version": "<member version>",
  "contract": "042",
  "verbs": ["orchestrator", ...],
  "capabilityTier": "reference" | "basic",
  "exitCodes": {"0": "ok", "1": "operational", "2": "unreachable", "3": "usage"},
  "envelope": "ok-data"
}
```

- `name` is the dispatch key. `statecraft-engine` is reached as
  `statecraft engine ...`; the umbrella strips its own `statecraft-` prefix
  and nothing else. Two members may both offer a `status` subverb without
  either shadowing the other or an umbrella built-in, which is why the name
  and not a verb is the key.
- `verbs` lets the umbrella refuse an unknown subverb before spawning a
  process, and lets `members list` say what a member offers without running
  it.
- `contract` is the member-contract version. The umbrella declares the range
  it supports and refuses outside it (§6).
- `exitCodes` and `envelope` are declarations the umbrella reports and never
  acts on by remapping (§7, §8).

## 4. The managed member directory

- Members installed through the umbrella live in one directory the umbrella
  owns, resolved as `$XDG_DATA_HOME/statecraft/members` when set, else
  `~/.local/share/statecraft/members` on Linux and
  `~/Library/Application Support/statecraft/members` on macOS, and
  overridable by `STATECRAFT_MEMBER_DIR` for tests and for operators who
  keep tools elsewhere.
- The umbrella creates the directory on demand and never writes anywhere
  else. This spec does not install members into it: installation is a later
  spec's verb, and until then the directory is populated by hand or by a
  member's own build. Discovery must work either way.

## 5. `statecraft members`

- `statecraft members list` prints one row per discovered member: name,
  version, contract, tier, and the location it was found in. `--output json`
  emits the spec 104 §5.2 envelope with the manifests under `data`.
- `statecraft members list --verbose` additionally prints each member's
  declared `verbs` and its `exitCodes` table, which is how a script author
  learns that `2` means an unreachable daemon from the engine and usage from
  a built-in verb (§7).
- `statecraft members show <name>` prints one member's manifest.
- Refused candidates appear in `list` with the reason, not omitted. A member
  the umbrella cannot parse is a thing the operator needs to see.

## 6. Dispatch

- The member is spawned with argv, never through a shell, and no
  caller-supplied value is interpolated into a command line. This mirrors
  spec 042 B-7 and the invariant its `session.ts` already
  holds for the agent process.
- The member inherits stdin, stdout and stderr. The umbrella does not buffer,
  filter or re-encode the member's output: a member that streams stays
  streaming, which matters because the engine's watch verbs do.
- Version skew is stated, never absorbed. If the member's `contract` is
  outside the range this umbrella supports, the dispatch is refused with a
  message naming both the member's contract version and the umbrella's
  supported range. The umbrella does not degrade silently and does not
  upgrade a member mid-run.
- Signals reaching the umbrella during a dispatch are forwarded to the member
  and the umbrella waits for it, so Ctrl-C stops an orchestrator run the way
  it would if the member had been invoked directly.

## 7. Exit codes

- A dispatched member's exit code is returned unchanged (design doc 01 D18).
  A caller scripting against `statecraft engine ...` sees exactly what it
  would see calling `statecraft-engine` directly, which is the property that
  makes the umbrella optional rather than a lock-in.
- The umbrella's own built-in verbs keep the spec 102 contract: 0 ok, 1
  operational, 2 usage. Clap terminates the process itself on a usage error
  with 2 and this spec does not fight it.
- Dispatch-layer failures use a reserved range no member emits: **64** member
  not found, **65** manifest refused (unparseable, or missing a required
  field), **66** contract version skew, **67** subverb not in the member's
  declared `verbs`. spec 042 B-6 binds its members to codes
  below 64 so the two ranges cannot collide.
- The consequence is stated rather than hidden: `2` means usage from a
  built-in verb and an unreachable daemon from the engine member. The
  alternative, remapping at the boundary, was rejected because it makes
  `statecraft engine status` and `statecraft-engine status` disagree. The
  `exitCodes` table in `members list --verbose` is what makes the difference
  discoverable.

## 8. The account-less local face

- No dispatch path reads a stored credential, calls `auth.rs`, or requires a
  configured base URL. A user who has never run `statecraft login` runs the
  entire local loop.
- `members list` and every dispatch work with no config file present.
- The umbrella must not import the member family into the authenticated verb
  set by accident: a test asserts that dispatch succeeds with the credential
  store and the base URL both absent from the environment.
- This is a product boundary, not a convenience. The local half is the free
  half; making it depend on the paid half would invert the model the split
  exists to serve.

## 9. Acceptance

- Discovery tests, driven by `STATECRAFT_MEMBER_DIR` pointed at a fixture
  directory of stub member binaries: a member in the managed directory, one
  only on `PATH`, the same name in both (managed wins, `list` names both
  locations), a candidate whose manifest does not parse (listed as refused,
  never executed a second time), and an empty set.
- A dispatch test asserts argv is passed through verbatim, stdout and stderr
  are not reordered or re-encoded, and the member's exit code is returned
  unchanged for each of 0, 1, 2 and 3.
- Reserved-range tests: an unknown member exits 64, a member with an
  unparseable manifest exits 65, a member declaring an out-of-range
  `contract` exits 66, and a subverb absent from `verbs` exits 67 without
  spawning the member.
- An account-less test runs `members list` and one dispatch with no
  credential store and no base URL configured, and asserts both succeed.
- `statecraft members list --output json` emits the spec 104 §5.2 envelope.
- `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` are green.

## 10. Out of scope

Installing, updating or removing members, which needs its own verb and its
own release-channel reasoning on top of spec 107's pipeline. Exposing
dispatched members through the MCP face, which is spec 109. Flattening a
member's own verb tree, so the engine path stays
`statecraft engine orchestrator status` for now: spec 042 D-7
records why renaming verbs in the same change that first packages them would
forfeit that spec's only evidence it moved nothing. Any change to the
existing control-plane verbs, their auth, or their output. Running a member
under a resource ceiling or a sandbox.

## 11. Status (2026-09-09)

Implemented in `src/members.rs` against spec 042 as merged
(PR #77 there). Verified end to end with the three compiled members from
that repository in `STATECRAFT_MEMBER_DIR`: `members list` names all three,
`statecraft engine orchestrator status --json` returns the engine's
envelope and its exit 2 unchanged, `statecraft driver-claude models` runs
the driver's one verb. `tests/members.rs` carries the §9 acceptance against
stub members. Decisions taken while building:

- D-7. The supported contract range is the closed interval `042..=042`
  (`CONTRACT_MIN`, `CONTRACT_MAX`); a second contract version widens it.
- D-8. Dispatch resolves only the named member rather than identifying
  every candidate on every dispatch: the same search order, the same
  identification, scoped to one name. `members list` still identifies all
  of them (D-3), and a shadowed candidate is never executed at all.
- D-9. A leading flag on the member's argv (`statecraft engine --help`) is
  not a subverb and passes through to the member's own parser; §7's 67
  applies to a positional first token only.
- D-10. Signal forwarding (§6) is unix-only and installed after the spawn,
  so the member inherits default dispositions rather than the umbrella's.
  On Windows the umbrella simply waits.
- 2026-09-09, spec 111: the manifest type, the reserved codes and the two
  constants moved to the `statecraft-contract` crate; `src/members.rs`
  re-exports them and keeps discovery, dispatch and rendering. Behavior
  and `tests/members.rs` unchanged.

## 12. Resolved decisions

D-1. The dispatch key is the member's name, not one of its verbs. Doc 01 D15
reads `statecraft-<verb>` in the git-plugin idiom, and taken literally that
makes every member's verbs compete for one flat namespace with each other and
with the umbrella's built-ins. Keying on the name keeps git's discovery
mechanism (an unknown token resolves to a `statecraft-` prefixed binary)
while making collisions structurally impossible.

D-2. The managed directory is searched before `PATH`. The opposite order is
more conventional for plugin systems, but it means an unrelated
`statecraft-engine` earlier on `PATH` silently replaces the one the user
installed through the umbrella, and the failure would surface as wrong
behavior rather than as a missing member. `list` naming both locations is
what keeps the choice auditable.

D-3. Manifests are read for every candidate during discovery, before any
dispatch. It costs one process spawn per member on a `members list`, which is
a handful, and it buys the guarantee that the umbrella never dispatches to a
binary it has not first identified.

D-4. Reserved codes start at 64 rather than continuing from 3. It leaves room
for the member taxonomy to grow (spec 023 D-4 already uses 0
through 3) and it follows the sysexits convention that a value at or above 64
is the framework speaking rather than the program.

D-5. The umbrella does not buffer member output. Buffering would let the
umbrella render every member's envelope uniformly, which is tempting, but the
engine's watch verbs stream and a buffered watch is a broken watch. Rendering
uniformly is worth less than staying transparent.

D-6. Authored `status: draft`. This spec and spec 042 resolve a
collision between two shipped contracts (that repo's 023 D-4 taxonomy against
this one's spec 102 taxonomy), and that class of call belongs to a human.
Ratification is a separate commit in each repository, and both should be
ratified together or neither.
