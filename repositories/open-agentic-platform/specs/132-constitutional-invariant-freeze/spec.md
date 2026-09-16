---
id: "132-constitutional-invariant-freeze"
slug: constitutional-invariant-freeze
title: "Constitutional invariant freeze — `unamendable` anchors and V-011"
status: approved
implementation: complete
amends: ["000-bootstrap-spec-system"]
amended: "2026-06-18"
amendment_record: |
  amended 2026-05-13 by spec 147 (spec-kind-grammar): bumped the registry schema 1.4.0 -> 1.5.0 with kind-grammar field declarations; spec 132's unamendable list is unchanged.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that enforced V-011 (unamendable-anchor enforcement) was deleted; that check is now in spec-spine-core. The spec_compiler crate-unit is stripped (path deleted); the frozen-schema invariant (constrains edge) survives unchanged.
owner: bart
created: "2026-05-02"
approved: "2026-05-02"
kind: governance
domain: substrate
risk: medium
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (the constitutional baseline being frozen)
  - "001-spec-compiler-mvp"  # spec-compiler-mvp (where V-011 lives)
code_aliases: ["CONSTITUTIONAL_FREEZE"]
# 217 deleted the in-tree spec-compiler; V-011 (unamendable-anchor enforcement) is
# now in spec-spine-core. The spec_compiler crate-unit is stripped (deleted); this
# spec's frozen-schema invariant (constrains, below) survives unchanged. Amended by 217.
constrains:
  - flavor: invariant-freeze
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
summary: >
  Spec 000 is itself amendable, including the amendment protocol. This
  spec adds a frontmatter convention — `unamendable: [<anchor>, ...]`
  on the amended spec, and `amends_sections: [<anchor>, ...]` on the
  amender — and a new spec-compiler violation (V-011) that rejects any
  amendment whose `amends_sections` overlaps the amended spec's
  `unamendable` list. Tooling-only in this commit: the schema field is
  declared, V-011 fires on synthetic fixtures, the registry SPEC_VERSION
  bumps 1.3.0 → 1.4.0. Spec 000 itself is **not** edited here; the
  proposed amendment is staged in
  `/tmp/spec_000_proposed_amendment.diff` for human review and
  application.
  Amended by spec 147 (2026-05-13) to bump the registry schema 1.4.0 → 1.5.0
  with the kind-grammar field declarations. Spec 132's `unamendable` list
  remains untouched (V-006..V-010 reserved range is not populated by 147 per
  Commitment 2; V-012..V-019 occupy the next free slots).
---

# 132 — Constitutional invariant freeze

## 1. Problem Statement

Spec 000 (bootstrap-spec-system) is the constitutional baseline. The
spec-amendment convention added later allows refining narrative or
invariants without supersession (`standards/spec/contract.md` "Amendment
convention" section). That convention applies recursively: any spec —
including spec 000 — can be refined by an amending spec.

In a single-developer pre-alpha repo, recursive amendability is fine.
But the spec-spine hardening session that authored spec 127 (gate),
130 (relaxation), and 131 (CONST-005) revealed that:

- The constitutional layer is the highest-leverage drift surface. An
  agent (human or AI) editing the V-001..V-010 invariants, or the
  markdown/JSON-truth boundary, fundamentally changes what "the spec
  spine is the contract" means.
- Today the protection is purely social: review by the single
  developer. There is no machine gate that distinguishes "amending the
  V-005 description" from "amending some other paragraph".

This spec adds the missing gate.

## 2. Decision

Introduce a two-field convention:

- The **amended** spec's frontmatter declares
  `unamendable: [<anchor>, ...]` — a list of section anchors that
  future amendments cannot touch.
- The **amending** spec's frontmatter declares
  `amends_sections: [<anchor>, ...]` — the anchors it claims to
  amend. (Optional: an amendment that is purely additive may set
  `amends_sections: []` or omit the field.)
- The spec compiler emits **V-011** when an amending spec's
  `amends_sections` overlaps the amended spec's `unamendable`.
- Amending an unamendable section is a hard error. The only path to
  change such a section is to **retire spec 000 entirely**
  (`status: superseded` on spec 000, plus a successor spec).

The convention is general — it works on any spec, not just 000 — but
the immediate intent is to freeze spec 000's invariants.

## 3. Scope

### In scope (this commit)

- New `KNOWN_KEYS` entries in `tools/spec-spine/spec-compiler/src/lib.rs`:
  `amends`, `amends_sections`, `unamendable`.
- Three new optional fields on `FeatureRecord`, serialized in the
  registry as `amends`, `amendsSections`, `unamendable`.
- New `V-011` check after the existing depends_on validation: for each
  spec X with non-empty `amends` and `amends_sections`, look up each
  amended spec Y and assert
  `amends_sections(X) ∩ unamendable(Y) = ∅`.
- Schema additions in `standards/schemas/spec-spine/registry.schema.json`:
  three optional `array<string>` fields under `featureRecord`.
- `SPEC_VERSION` bump 1.3.0 → 1.4.0.
- Test fixture `tools/spec-spine/spec-compiler/tests/v011_unamendable.rs` — five
  test cases covering: overlap fires, non-overlap silent, short-form
  id resolution, empty unamendable list silent, multi-overlap reports
  each.
- This spec, scaffolded with `amends: ["000"]` (no `amends_sections` —
  this commit does not yet touch spec 000's body).

### Out of scope (deferred to human authorship)

- Editing `specs/000-bootstrap-spec-system/spec.md` to add
  `unamendable: [...]` frontmatter and a "## Frozen invariants"
  section. The proposed diff is in
  `/tmp/spec_000_proposed_amendment.diff`. A human reviewer applies
  it and lands a follow-up commit
  `feat(spec-000): freeze constitutional invariants per spec 132`.
- Migration of any historical amendment specs that touched anchors
  the proposed list would freeze. None today; if any surface, V-011
  catches them on next compile.
- A V-012 or higher for related constitutional protections (e.g.
  rejecting `status: retired` on spec 000 without a successor). Out
  of scope; can be added in a future spec.

## 4. Functional Requirements

- **FR-001 — frontmatter fields.** Spec compiler accepts
  `unamendable: array<string>` on any spec, and
  `amends_sections: array<string>` on any spec carrying a non-empty
  `amends:` list. Both default to `[]` when absent.
- **FR-002 — V-011 semantics.** For every spec X with `amends:
  [Y_1, …, Y_n]` and `amends_sections: [a_1, …, a_m]`, V-011 emits one
  violation per `(Y, a)` pair where `a ∈ unamendable(Y)`. Severity is
  `error`; the registry's `validation.passed` flips to `false`.
- **FR-003 — id resolution.** `amends:` entries may use the short form
  (`"000"`) or the full slug (`"000-bootstrap-spec-system"`); the
  compiler resolves both via the leading-3-digit prefix index.
- **FR-004 — schema 1.4.0.** `registry.schema.json` declares the three
  new fields under `featureRecord` as optional `array<string>`.
  `specVersion` advances to `"1.4.0"` exact match.
- **FR-005 — anchor names are opaque to the compiler.** V-011 is a set
  comparison; the compiler does not validate that an anchor like
  `"V-001"` resolves to a real heading in spec 000's body. Spec 000's
  human reviewer ensures the names are meaningful. (A future spec
  could add anchor-existence validation.)

## 5. Proposed amendment to spec 000 (deferred)

The spec 000 amendment is **not applied** in this commit. The proposed
diff at `/tmp/spec_000_proposed_amendment.diff` adds:

- Frontmatter:
  ```yaml
  amended: "2026-05-02"
  amendment_record: "132-constitutional-invariant-freeze"
  unamendable:
    - "V-001"
    - "V-002"
    - "V-003"
    - "V-004"
    - "V-005"
    - "V-006"
    - "V-007"
    - "V-008"
    - "V-009"
    - "V-010"
    - "markdown-truth-boundary"
    - "json-truth-boundary"
    - "determinism-requirement"
    - "directory-name-equals-id"
  ```
- Body section: `## Frozen invariants` — explicit list of the same
  anchors with one-line descriptions, plus a note explaining that
  amending these requires retiring spec 000 entirely (per FR-002 of
  this spec).

The diff is intentionally narrow: no existing prose is rewritten.
Reviewers can confirm the constitutional surface change before
applying.

## 6. Acceptance

- **AC-1.** `cargo test --manifest-path tools/spec-spine/spec-compiler/Cargo.toml`
  passes. The new test file `tests/v011_unamendable.rs` covers FR-002,
  FR-003, and the silent-cases.
- **AC-2.** `repo_spec_version_is_1_4_0` (renamed from `…1_3_0`)
  passes — the registry reports `specVersion: 1.4.0`.
- **AC-3.** `make ci` exits 0 against the current corpus. No real spec
  has `amends_sections` declared yet, so V-011 cannot fire on the
  current tree.
- **AC-4.** The proposed diff exists at
  `/tmp/spec_000_proposed_amendment.diff` and applies cleanly to the
  current `specs/000-bootstrap-spec-system/spec.md`.
- **AC-5.** Spec 000's frontmatter is **not** modified by this commit
  (verifiable with `git diff HEAD~1 -- specs/000-bootstrap-spec-system/`
  showing only path additions, not modifications).

## 7. Risks and Mitigations

- **Risk:** A future amendment legitimately needs to refine a frozen
  anchor (e.g. clarify wording without changing meaning).
  **Mitigation:** The mitigation is supersession: retire spec 000
  with a successor. The supersession path is heavier than amendment,
  which is the intent — the friction matches the constitutional
  weight of the change.

- **Risk:** Anchor names drift between the frontmatter list and the
  body sections; reviewers think a section is frozen when it isn't.
  **Mitigation:** FR-005 acknowledges anchors are opaque to the
  compiler. A follow-up spec can add anchor-existence validation
  (V-012 or similar) that walks the body for matching headings.
  Out of scope here.

- **Risk:** The proposed unamendable list is too restrictive (locks
  in invariants that should evolve).
  **Mitigation:** The list is reviewed by the human applying the
  proposed diff. If a candidate is wrong, drop it before applying.
  The list is only effective once the diff is applied — this commit
  is purely the mechanism, not the policy.

## 8. Out of scope (next steps)

- A V-012 that validates anchor existence (compiler walks the body
  for matching `## anchor` or `### anchor` headings).
- A V-013 that rejects `unamendable: [...]` on a spec with `status:
  draft` (frozen invariants only make sense on approved/active specs).
- Tooling support for an `unamendable: false` override per anchor in
  an amending spec — explicitly out of scope; the only path past a
  frozen anchor is supersession.
