---
id: "110-corpus-merge"
title: "The corpus merge: claude-observatory moves into statecraft-cli"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "042-member-contract"
  - "043-driver-seam"
  - "108-member-dispatch"
establishes:
  - "spec-spine.toml"
  - ".github/workflows/spec-spine.yml"
  - ".github/workflows/members.yml"
  - ".gitignore"
  - { kind: directory, path: "docs/design/" }
extends:
  # 109 owns the harness prose and the composite gate; both learn the second
  # package (the bun steps, the members/ layout).
  - { spec: "109-governed-harness", unit: "AGENTS.md", nature: additive }
  - { spec: "109-governed-harness", unit: "CLAUDE.md", nature: additive }
  - { spec: "109-governed-harness", unit: "Makefile", nature: additive }
  # 102 owns the crate manifest, whose spec-spine binding renumbers.
  - { spec: "102-crate-scaffold", unit: "Cargo.toml", nature: additive }
  # 024 owns the observatory's package.json; its layout binding moves.
  - { spec: "024-web-ui", unit: "members/package.json", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
summary: >
  Design doc 02 D24 makes statecraft-cli the monorepo for the family's
  tooling, daemons and CLI packages, and D28 decides how the two governed
  corpora become one without their ids colliding. This spec is that move,
  executed as one change with one gate over the result: the
  claude-observatory tree lands under members/ with its bun project intact,
  its 44 specs (000-043) import unchanged, its design docs and evidence
  bundle land under docs/, and statecraft-cli's own ten specs renumber into
  the 100 band (000-009 become 100-109) with a reference sweep through
  every file that named them. The old bootstrap is superseded by the
  observatory's, which becomes the single bootstrap of the merged corpus.
  Every claim in every imported spec resolves against the new layout, the
  coupling gate holds both packages, and both test suites run in CI. The
  claude-observatory repository is left pointing here and retires; the
  word observatory retires with it (D27).
---

# 110: The corpus merge

## 1. Purpose

After 042, 108 and 043, the family's local loop runs across two
repositories: the umbrella dispatches to members built from the other repo,
and a change to the member contract is a PR in each. Doc 02 §2 gives the
reason to end that: in one workspace the contract becomes a crate both
sides depend on and a divergence becomes a compile error, which is the
payment for the merge and the precondition of the Rust sequence (D29,
D30). This spec pays it.

The direction of the renumber is D28's: the observatory's ids are written
into the work journal, the decision ledger and the exported evidence bundle
(1038 work and 52 decision records at export), so they import unchanged.
statecraft-cli's ids appear only in its own specs, code comments and prose,
where a rename is a sweep, and that sweep is this change.

## 2. Territory

Owned: `spec-spine.toml` (one config over two packages, D-2), the
governance workflow `.github/workflows/spec-spine.yml` (from 100, through
109), `.github/workflows/members.yml` (the bun stack gate, D-3),
`.gitignore` (the union of the two), and `docs/design/` (the family's
design record, D-5). `docs/evidence/` keeps its observatory owner (031,
039): the bundle's path did not change.

Extended: the harness prose and composite gate (109), the crate manifest's
spec binding (102) and the members' package binding (024).

Not claimed: anything under `members/`, every file of which keeps the
observatory spec that claimed it before the move, at its new path.

## 3. Behavior

- **B-1 (the layout).** The umbrella crate stays at the root (`Cargo.toml`,
  `src/`, `tests/`). The observatory's bun project moves whole to
  `members/` (`package.json`, `bun.lock`, `tsconfig.json`, `src/`, `web/`,
  `scripts/`, `start.sh`, `stop.sh`, `FINDINGS.md`, its README). Its
  `docs/design` and `docs/evidence` move to the root `docs/`. Its specs
  move to `specs/` unchanged in id and body; only frontmatter paths gain
  the `members/` prefix. Its harness (`.claude/`, `AGENTS.md`,
  `CLAUDE.md`) is dropped in favor of 109's, with its standing rules folded
  into `CLAUDE.md` (D-6).
- **B-2 (the renumber).** `000-bootstrap` through `009-governed-harness`
  become `100-bootstrap` through `109-governed-harness`. Every reference in
  this repository's own files (specs, Rust sources and tests, `Cargo.toml`,
  workflows, `README.md`, `CLAUDE.md`, `AGENTS.md`, `Makefile`,
  `install.sh`, the agents) moves with them; references to other corpora
  (the control plane's `statecraft spec 004`, `enrahitu spec 018`,
  `statecrafting spec 002`) do not. The observatory specs' citations of
  `statecraft-cli 008` become `spec 108`; this repository's citations of
  `claude-observatory spec 042` become `spec 042`.
- **B-3 (one bootstrap).** `100-bootstrap` is `status: superseded`,
  `superseded_by: "000-bootstrap"`, and claims no territory;
  `000-bootstrap` declares `supersedes: ["100-bootstrap"]`. The two units
  100 established, `spec-spine.toml` and the governance workflow, are
  owned here; 109's `extends` edges on them name this spec.
- **B-4 (one gate over two packages).** `make gate` is unchanged in shape
  and now holds 53 specs over 143 source files at 100% specific ownership
  (`index coverage`), with `require_ownership` still on. The bun stack
  gate runs in `members.yml`: install, typecheck, web build, the three
  member builds with their manifests, and `bun test`, all with
  `working-directory: members`, against the same spec-spine the
  governance job installs. `ci.yml` (102) keeps the cargo gate.
- **B-5 (nothing behaves differently).** No verb, envelope, journal shape,
  test or binary name changes. 042 AC-4 and 043 FR-005 hold at the new
  paths; the member binaries are still `dist/statecraft-*` relative to
  `members/`, which the umbrella discovers through `STATECRAFT_MEMBER_DIR`
  exactly as before.

## 4. Acceptance

- `spec-spine check` exits 0 on the merged tree; `registry list` shows 54
  specs, `100-bootstrap` superseded.
- `spec-spine lint --fail-on-warn` exits 0; `index coverage
  --fail-on-untraced` reports 100% for both packages.
- `spec-spine couple --base <pre-merge main> --head HEAD` exits 0 with no
  waiver: every moved path is owned at its new location.
- `cargo test` is green at the root; `bun test` and `bun run typecheck`
  are green under `members/`; both workflows pass on the PR.
- `grep -rn 'statecraft-cli 00[0-9]' specs/0*/spec.md` and
  `grep -rn 'claude-observatory spec 0' specs/1*/spec.md src` are empty.
- The claude-observatory repository's README points here.

## Status (2026-09-09)

Landed as #16. The same day, doc 02 §11 was added under this spec's
`docs/design/` claim to record where the Rust sequence stands after
specs 111 to 114, so the design record carries the state rather than the
pull request log. Doc 03 §8 followed on the same day, under the same
claim, for the Codex sequence (specs 115 to 118), and doc 04 §10 for the
governed-substrate sequence (specs 119 to 124).

## 5. Out of scope

Turning the root into a Cargo workspace with `crates/` (the first Rust
member port does that when it has a second crate to hold). Renaming the
repository (doc 02 §4 defers it until the cross-references settle).
Archiving the claude-observatory repository (a human act on GitHub; this
spec leaves it pointing here). Any change to what the members do.

## 6. Resolved decisions

D-1. Squash, not subtree. `main` requires signed commits and merges by
squash, so the observatory's history cannot ride into this repository's
graph; it stays in the retired repository, and every observatory spec's
`created` date and status notes carry the record. The file move is a move.

D-2. One `spec-spine.toml`, with the members declared as a standalone npm
package at `members`. The observatory's `bypass_prefixes` (`FINDINGS.md`,
`bun.lock`) carry over at their new paths; its hashed inputs are already
this repository's; the version pin and ownership ratchet 109 set apply to
both packages from the first commit.

D-3. The bun gate is its own workflow rather than a job in `ci.yml`,
because 102 owns `ci.yml` as the Rust CI and its acceptance names cargo
steps. `members.yml` mirrors the observatory's `govern.yml` minus the
governance steps, which `spec-spine.yml` runs once for the whole tree.

D-4. The observatory corpus claims its source by file, and under 0.18.0's
`L-008` every one of those 125 claims is "in no content hash". Folding
`members/src/**` into the global scalar would restamp all 54 shards on
every source edit; reclaiming 125 files as symbol units is a sweep no one
has run and the Rust ports will make moot file by file. The gap is
recorded as deliberate in `[lint] unwitnessed_allowed`, which `index
check` still counts, so it is explicit rather than invisible.

D-5. `docs/design/` is claimed here because the three design documents
are the family's decision record and were never claimed in the
observatory corpus; `docs/evidence/` is not, because 031 and 039 claim
the bundle and their paths did not move.

D-6. The observatory's standing rules survive the harness drop as lines
in `CLAUDE.md`: `~/.claude` is observed and never written; `members/data/`
is never committed; specs 001-008 describe shipped behavior, defects
included.

D-7. Renumbered into 100-109, not 101-108 as doc 02 D28 wrote, because
the harness spec (009) and this one exist now; the band is the same idea
with two more occupants, and 043-099 stays free for the merged corpus.
