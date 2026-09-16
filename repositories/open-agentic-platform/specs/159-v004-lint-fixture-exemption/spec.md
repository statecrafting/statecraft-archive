---
id: "159-v004-lint-fixture-exemption"
slug: v004-lint-fixture-exemption
title: V-004 carve-out for lint test fixtures (amends 000)
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
approved: "2026-05-22"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that enforced V-004 was deleted; that enforcement is now in spec-spine-core. The implementation code-unit is stripped (path deleted); this spec's authority is its amends-000 refinement of the V-004 scan-path policy, which persists in the library.
closed: "2026-05-22"
kind: governance
domain: substrate
risk: low
amends: ["000-bootstrap-spec-system"]
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (V-004 scan-policy is defined here)
  - "001-spec-compiler-mvp"  # spec-compiler-mvp (where V-004 is implemented)
  - "158-workflow-ref-sha-pinning-lint"  # workflow-ref-sha-pinning-lint (the motivating case)
code_aliases: ["V004_FIXTURE_EXEMPTION"]
# 217 deleted the in-tree spec-compiler; V-004 enforcement is now in spec-spine-core.
# The implementation code-unit is stripped (path deleted); this spec's authority is
# its amends-000 refinement of the V-004 scan-path policy (the aspect persists in the
# library). Amended by 217.
refines:
  - aspect: "v004-scan-path-policy"
    refines_specs: ["000-bootstrap-spec-system"]
summary: >
  Refine V-004's scan-path policy (defined in spec 000) to exempt lint
  test fixtures under `tools/*/tests/fixtures/**`. The exemption rests on
  a single principle: these fixtures derive their authority from the
  spec that establishes the consuming lint, not from themselves; they
  are not "standalone authored YAML" in the constitutional sense of
  V-004. The motivating case is spec 158 (workflow-ref SHA-pinning
  lint), whose `tools/lint/tests/fixtures/{passing,failing}/action.yml`
  files act as the lint's own spec. The exemption generalises to
  future spec-established lints whose test corpus is non-markdown by
  necessity (YAML linters need YAML fixtures, JSON-schema validators
  need JSON fixtures, TOML parsers need TOML fixtures). V-004's
  *definition* — the frozen anchor on spec 000 — is unchanged; only
  the scan-path policy explicitly designated as extensible by
  spec 000 line 217 ("explicitly listed third-party vendored paths in
  a later amendment") is extended.
---

# 159 — V-004 carve-out for lint test fixtures

## 1. Problem Statement

V-004 (defined in spec 000, line 217) enforces constitutional
**Principle I** — markdown-only authored truth — by rejecting standalone
`.yaml` / `.yml` files outside an explicit skip list. The skip list
is *policy*: spec 000 designates the V-004 scan boundary as extensible
via amendment, with `node_modules/`, `.git/`, and "explicitly listed
third-party vendored paths" as the initial exemptions. Subsequent
implementation has extended the skip list with monorepo-tree
exemptions (`apps/`, `crates/`, `platform/`, etc.) and small
root-level allowlists (`pnpm-lock.yaml`, `.sops.yaml`).

Spec 158 (workflow-ref SHA-pinning lint, 2026-05-22) introduces a new
class of artifact that V-004 was not designed to refuse: test fixtures
consumed by a spec-established lint. The fixtures at
`tools/lint/tests/fixtures/passing/action.yml` and
`tools/lint/tests/fixtures/failing/action.yml` are the lint's own
proof carrier — they exercise the same code path production input
exercises (file-on-disk YAML), and they fail-closed the regression
test when the lint's classification regex regresses. Embedding them
inside the test runner (heredocs) would test the regex against
strings, not against the on-disk surface the production lint operates
on, and would make the fixtures invisible to spec-spine governance.

Without this amendment, the spec-compiler's V-004 walker fires on the
spec-158 fixtures, validation fails, the registry becomes
non-authoritative, and CI exits 1 on every workflow that calls the
spec-compiler. The choice is between:

1. Heredoc the fixtures (compromise spec 158's design — fixtures are
   no longer on-disk authoritative artifacts).
2. Rename the fixtures to a non-YAML extension and synthesise the
   `.yml` form in a temp dir at test time (compromise spec 158's
   FR-NEW-1 contract that the lint scans `*.yml` / `*.yaml`).
3. Refine V-004's scan-path policy to recognise that lint test
   fixtures *under a spec-established tool's tree* derive authority
   from that spec, not from themselves.

This spec chooses (3). The principle is sharpened, not weakened: V-004
continues to reject genuinely-authored YAML that bypasses the spec
spine; it ceases to misclassify test fixtures whose authority is
already recorded in the establishing spec.

## 2. Decision

Extend the V-004 scan exemption surface (already established in spec
000 line 217 as policy-extensible) to include files under
`tools/*/tests/fixtures/**`. The exemption is path-shaped, not
filename-shaped: any file at any depth under such a directory is
exempt from V-004, regardless of extension. (The generalisation
matters: a JSON-schema fixture, a TOML fixture, an INI fixture, and a
YAML fixture all share the same authority shape — they exist because
a spec establishes the tool that consumes them.)

V-004's frozen anchor on spec 000 (`unamendable: ["V-004", ...]`) is
*unchanged*. The anchor freezes the *definition* of V-004 — what kind
of artifact is forbidden, and that the compiler MUST refuse it. The
scan-path policy — *where* the compiler looks for that artifact — is
explicitly mutable by spec 000's own design (line 217's "later
amendment" clause). This spec exercises that mutability.

## 3. Functional Requirements

- **FR-1.** The spec-compiler's V-004 walker MUST exempt any file
  whose path matches the glob `tools/*/tests/fixtures/**` (relative
  to the repo root). The exemption is by *path*, not by extension;
  any file in such a directory is exempt regardless of its `.yaml`,
  `.yml`, `.json`, `.toml`, or other extension.

- **FR-2.** The exemption MUST be implemented in
  `tools/spec-spine/spec-compiler/src/lib.rs` in the
  `v004_yaml_scan_exempt` function (or its successor), alongside the
  existing `.factory/` ancestor exemption and root-file allowlist
  (`pnpm-lock.yaml`, `.sops.yaml`, `pnpm-workspace.yaml`).

- **FR-3.** The exemption MUST NOT match files outside the
  `tools/<tool-name>/tests/fixtures/` shape. Specifically:
  - `tools/lint/fixtures/action.yml` (no `tests/`) is **not** exempt.
  - `tools/lint/tests/passing.yml` (no `fixtures/`) is **not** exempt.
  - `tools/lint/tests/fixtures/passing/action.yml` is **exempt**.

  This shape is the structural fingerprint of "test fixtures for a
  spec-established tool"; the compiler's pattern match enforces that
  fingerprint without naming any specific tool.

## 4. Invariants

- **I-1.** V-004's `unamendable` anchor on spec 000 is **not** edited.
  This spec amends the scan-path *policy*, not V-004's definition.
  `amends_sections:` is therefore not present on this spec's
  frontmatter (per spec 132 V-011: any spec carrying `amends: ["000"]`
  with an `amends_sections` overlapping the unamendable list is
  rejected).

- **I-2.** The exemption is path-glob-shaped, not enumerated. Adding a
  new spec-established lint (spec 160-N) with its own
  `tools/<name>/tests/fixtures/**` corpus does **not** require a
  further V-004 amendment — the existing exemption applies. This is
  the design intent: the principle ("fixtures derive authority from
  the establishing spec") is encoded once.

## 5. Acceptance criteria

- **AC-1.** With this spec applied:
  - `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
    on a tree containing
    `tools/lint/tests/fixtures/{passing,failing}/action.yml` exits 0
    with `validation.passed: true` in `registry.json`.
  - `registry-consumer status-report --json` succeeds (no
    "registry is not authoritative" error).
  - `featuregraph / golden graph` CI job passes its
    `Emit spec registry (test fixture)` step.

- **AC-2.** A negative-control fixture confirms the exemption shape is
  precise: a file at `tools/lint/fixtures/action.yml` (missing the
  `tests/` segment) or at `tools/lint/tests/action.yml` (missing the
  `fixtures/` segment) is **still** rejected by V-004. (Not added in
  this spec's commit; future spec-compiler tests may exercise this.)

- **AC-3.** No edits to spec 000's V-004 paragraph wording. The
  amendment is recorded as a body callout on spec 000 (referencing
  this spec) and an `amended:` + `amendment_record:` frontmatter
  update on spec 000. The V-004 definition line itself is unchanged.

## 6. Non-goals

- **NG-1.** This spec does **not** retroactively justify the existing
  monorepo-tree skip list (`apps/`, `crates/`, `platform/`, etc.). That
  drift between implementation and spec is a separate concern; a
  future spec may either record those exemptions retroactively or
  remove them.

- **NG-2.** This spec does **not** introduce a configurable allow-list
  or escape hatch for arbitrary YAML files outside the
  `tools/*/tests/fixtures/**` shape. The shape *is* the policy. Files
  elsewhere remain subject to V-004.

- **NG-3.** This spec does **not** fix the spec-compiler's silent
  exit-1 on validation failure (issue #194). That bug means a V-004
  violation prints nothing — only the exit code reveals failure. It
  is orthogonal to this amendment and lands on its own timeline.

## 7. Rationale

**Why a separate sibling spec rather than embedding the carve-out in
spec 158.** Spec 158 is a workflow-ref-pinning lint with constitutional
weight (Megalodon-class supply-chain defence). The V-004 carve-out is a
constitutional refinement to spec 000. Folding the latter into the
former would conflate two governance-layer concerns. The sibling-spec
pattern (matching spec 158 → 116 and spec 132 → 000) preserves the
single-concern shape of each.

**Why path-shaped exemption rather than filename allow-list.** The
`tools/*/tests/fixtures/**` shape is the structural fingerprint of
"test fixtures for a spec-established tool". A filename allow-list
(`action.yml`, `actions.yaml`, ...) would require an amendment for
every new fixture; the path shape encodes the design rule once and
admits future cases without ceremony. The same argument that justifies
`.factory/` as an ancestor-name exemption (any file under any
`.factory/` directory) justifies this shape.

**Why this isn't weakening Principle I.** Constitutional Principle I
says authored truth lives only in markdown. The lint fixtures are
**not** authored truth — their existence and content is mandated by
spec 158, and their authority terminates at that spec. They are
proof-carrier artifacts for a spec-established tool, the same shape
as `.factory/` working-state files or `pnpm-lock.yaml` package-manager
output. V-004 was originally written without anticipating this class
of artifact; this spec sharpens V-004's boundary to match its intent.

## 8. Compiler check sequencing

This spec's lib.rs edit lives in `v004_yaml_scan_exempt`, which is
called *before* the V-004 violation is emitted (see
`tools/spec-spine/spec-compiler/src/lib.rs::yaml_violations`). The
exemption short-circuits the violation push; no violation is created
for an exempt path. The check ordering matters because V-004 is
emitted as a `severity: "error"`, which forces
`validation.passed: false`; an after-the-fact suppression would
require restructuring the violation pipeline. The before-emission
exemption is the right shape both architecturally (exemption is
input filtering, not output filtering) and pragmatically (no
pipeline restructuring needed).

## 9. Open questions

None. The amendment is small, the rationale is recorded, and the
acceptance criteria are mechanically checkable.
