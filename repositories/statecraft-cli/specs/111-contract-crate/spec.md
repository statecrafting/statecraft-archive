---
id: "111-contract-crate"
title: "The member contract as a crate: one definition both sides depend on"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "110-corpus-merge"
  - "042-member-contract"
  - "043-driver-seam"
  - "108-member-dispatch"
establishes:
  - { kind: crate, id: "statecraft-contract" }
  - { kind: directory, path: "crates/statecraft-contract/" }
  - "members/src/members/contract-fixtures.test.ts"
extends:
  # The root manifest becomes a workspace whose root package is the umbrella.
  - { spec: "102-crate-scaffold", unit: "Cargo.toml", nature: additive }
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  # The umbrella's dispatch module consumes the crate's manifest and codes
  # instead of carrying its own copies; 108 records that in its own status.
  # The Rust CI builds and tests the workspace, not one crate.
  - { spec: "102-crate-scaffold", unit: ".github/workflows/ci.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
summary: >
  Doc 02 §2 names the concrete payment for the merge: the member contract,
  prose in two corpora until now, becomes a crate both sides depend on,
  and a divergence becomes a compile error. This spec is that crate.
  statecraft-contract holds the manifest a member answers with (042 B-3),
  the reserved dispatch-layer exit range and the members' declared
  taxonomy (108 §7, 023 D-4), the family envelope (104 §5.2, 023 B-3),
  and the driver seam's wire request, event stream and session result
  (043 B-1, B-2), each as a serde type whose wire form is the one the
  TypeScript members already read and write. The umbrella depends on it
  today. The TypeScript members cannot, so the crate ships the JSON
  fixtures its own tests generate and a members test parses every one of
  them through the TypeScript codecs: the compile error the Rust ports
  will get is, until then, a test that fails in both languages when
  either side moves. D30's order starts here because it is new code and
  because every later port is measured against these shapes.
---

# 111: The contract crate

## 1. Purpose

Specs 042 and 108 say in as many words that a divergence between them is a
defect in both, detectable at runtime through the manifest's `contract`
field. That is the best two repositories could do. In one workspace the
contract can be a type, and this spec makes it one: a crate with no
dependencies beyond serde, whose every public type has exactly one wire
form, and whose tests write that form to disk as fixtures that the other
language reads back.

The crate is also the first Rust in the merged repository, which turns
the root manifest into a workspace. The umbrella stays the root package
(110 §5 deferred `crates/` for the umbrella itself); the contract is the
first member of `crates/`, where the Rust members land in D30's order.

## 2. Territory

Owned: the `statecraft-contract` crate under `crates/statecraft-contract/`
(its manifest, `src/`, its fixtures and their generator test), and the
members' fixture test `members/src/members/contract-fixtures.test.ts`.

Extended: the root `Cargo.toml` and lockfile (102), which gain the
workspace table and the umbrella's dependency on the crate; `src/members.rs`
(108), which drops its private manifest type and codes for the crate's;
and `ci.yml` (102), which builds and tests `--workspace`.

Not claimed: any TypeScript codec. `manifest.ts`, `driver.ts` and
`driver-session.ts` keep their shapes; the fixture test proves they agree
with the crate rather than making them depend on it.

## 3. Behavior

- **B-1 (the manifest).** `Manifest` is 042 B-3 field for field
  (`schemaVersion`, `name`, `version`, `contract`, `verbs`,
  `capabilityTier`, `exitCodes`, `envelope`), with `CapabilityTier` an
  enum over `reference` and `basic`, `MANIFEST_FLAG` the reserved flag,
  `MEMBER_PREFIX` the binary prefix, `CONTRACT` the id `042`, and
  `Manifest::parse` the validation 108 §3 applies (a required field
  missing or an empty verb set is refused with the field named).
- **B-2 (the codes).** `exit::MEMBER_NOT_FOUND` 64, `MANIFEST_REFUSED`
  65, `CONTRACT_SKEW` 66, `UNKNOWN_SUBVERB` 67 (108 §7), `exit::FLOOR` 64
  as the line no member crosses (042 B-6), and `MemberExitCodes::D4`,
  the taxonomy the engine and driver declare (0 ok, 1 operational, 2
  unreachable, 3 usage).
- **B-3 (the envelope).** `Envelope<T>` serializes as `{ok: true, data}`
  or `{ok: false, error: {kind, message, status?}}` (104 §5.2, 023 B-3),
  and deserializes either form.
- **B-4 (the driver seam).** `SessionRequest` is 043's wire request
  (`schemaVersion`, `repo`, `prompt`, `tier`, `model`, `maxTurns`,
  `timeoutMs`, `mcpConfigPath`, `profile`, `killGraceMs`, nulls explicit);
  `DriverEvent` is the tagged union over `journal`, `stream` and `result`;
  `SessionResult`, `Classification`, `TerminationKind` and `OverflowInfo`
  are 014's shapes as 043 forwards them. Every field name is the
  TypeScript one, camelCase on the wire.
- **B-5 (the fixtures).** `cargo test -p statecraft-contract` writes one
  JSON file per type under `crates/statecraft-contract/fixtures/` from
  Rust values and asserts the committed file is byte-identical; a changed
  shape fails there first. The members test reads every fixture through
  the TypeScript codecs (`Manifest.parse`-equivalent checks, the driver's
  `parseDriverEvent` and `parseRequest`, the envelope) and asserts a
  round trip. Neither side can move without the other noticing.
- **B-6 (the umbrella depends on it).** `src/members.rs` imports
  `Manifest`, `CapabilityTier`, the codes and the flag from the crate; its
  behavior (108 §9) is unchanged and `tests/members.rs` passes unedited.
- **B-7 (the workspace).** The root `Cargo.toml` declares
  `[workspace] members = ["crates/*"]` with the umbrella as the root
  package; `cargo build --workspace --locked` and
  `cargo test --workspace --locked` are what CI and `make` run. The
  crate is `publish = false` until a release spec says otherwise.

## 4. Acceptance

- `cargo test --workspace` is green and the fixture files under
  `crates/statecraft-contract/fixtures/` are unchanged after it.
- `cd members && bun test src/members/contract-fixtures.test.ts` passes.
- `tests/members.rs` passes without modification; `cargo clippy
  --workspace --all-targets -- -D warnings` and `cargo fmt --check` are
  clean.
- `make gate` is green: the crate and the workspace edit couple to this
  spec, and coverage stays at 100%.

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-contract
```

```verify:cli
cd members && bun test src/members/contract-fixtures.test.ts
```

## Status (2026-09-09)

Implemented. Twelve fixtures under `crates/statecraft-contract/fixtures/`,
written by `cargo test -p statecraft-contract` and read by the members'
fixture test (6 tests). `tests/members.rs` passed unedited after
`src/members.rs` moved onto the crate's `Manifest`, `exit` codes and
constants. The lockfile gained exactly the new package. 2026-09-09, later: the
fixture test's envelope reads are typed `unknown` explicitly; `bun test`
had passed while `bunx tsc` refused the inferred type, and the members
workflow caught it after the merge.

## 5. Out of scope

Making the TypeScript members depend on the crate (they cannot; the Rust
ports will). Publishing the crate. Moving the umbrella under `crates/`.
Any change to the contract itself: every shape here is one that 042, 043
and 108 already specify, and a change to one of them is a change to those
specs first.

## 6. Resolved decisions

D-1. Fixtures over a schema. A JSON Schema would be a third artifact both
sides validate against and neither depends on. Fixtures written by the
Rust types and parsed by the TypeScript codecs test the two real
implementations against each other, which is the property the merge was
for, and they cost nothing to maintain because the Rust test regenerates
them.

D-2. The umbrella keeps its own discovery, dispatch and rendering; only
the contract's data types move. A crate that also knew how to find and
spawn members would be a second umbrella.

D-3. `SessionResult` and its neighbors are defined here rather than in
the future Rust driver crate, because the engine consumes them and the
engine and the driver must not share code beyond the contract (043 D-1).
