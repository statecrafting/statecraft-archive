---
id: "176-amends-aware-section-satisfaction-parity"
slug: amends-aware-section-satisfaction-parity
title: "Amends-aware satisfaction parity between whole-file and section-scoped authority checks"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
owner: bart
created: "2026-05-24"
approved: "2026-05-24"
kind: amendment
domain: substrate
shape: bug-fix
risk: low
amends: ["133-amends-aware-coupling-gate", "152-path-co-authority"]
depends_on:
  - "133-amends-aware-coupling-gate"
  - "152-path-co-authority"
code_aliases: ["SECTION_AMENDER_PARITY"]
# 217 deleted the in-tree spec-code-coupling-check crate; the section-satisfaction
# parity this spec fixed is now in spec-spine-core. Both extends-133 section units
# are removed (path deleted) and collapsed to a single 133 lineage edge.
# Superseded by 217.
extends:
  - spec: "133-amends-aware-coupling-gate"
    nature: additive
summary: >
  Closes the implementation gap between spec 133 §4's satisfaction contract
  and the section-scoped code path in tools/spec-spine/spec-code-coupling-check/src/lib.rs.
  Spec 133 §4 computes the satisfaction predicate against `A` — the
  authority set, whether derived from `authorities(P)` (whole-file) or
  `authorities(P, S)` (section-scoped) — and admits direct edit, amender
  substitute, or amendment-record substitute uniformly. The whole-file
  branch honors all three classes via `OwnerSet::any_owner_in_diff`; the
  section-aware branch in `check_coupling_section_aware` consults only the
  bare `section_spec_ids` set and ignores the `amends:` and
  `amendmentRecord:` edges. This amendment reaches that branch through the
  same composition the whole-file branch uses, so an amender of a section
  authority — or the amendment-record target of a section authority —
  clears section coupling identically to whole-file coupling. No new
  contract; the §4 prose already commits to the property.
---

# 176 — Amends-aware section satisfaction parity

## 1. Concern

Spec 133 §4 specifies satisfaction in two passes:

```
for each H ∈ hunks(P):
  if P has co_authority claims:
    S = section_containing(H)
    A = authorities(P, S)
  else:
    A = authorities(P)

  ...
  if ∃ spec ∈ A : spec.spec_md is edited in diff
     ∨ ∃ spec ∈ A : ∃ amender X : X.amends entry references spec
                     ∧ X.spec_md is edited in diff:
    satisfied
```

The amender clause is below the branch on `co_authority`, so the
quantifier `∃ spec ∈ A` ranges over whichever `A` was selected. Spec
133's intent has always been that amender substitution applies
uniformly. The runtime implementation diverges for the section-scoped
case.

This amendment closes the divergence. It does not extend spec 133's
contract; it brings the section-aware code path to parity with the
whole-file code path that already honours that contract.

## 2. Substrate gap

`tools/spec-spine/spec-code-coupling-check/src/lib.rs` carries two
satisfaction predicates.

**Whole-file path** (`check_coupling_with_bypass`):
`legitimate_owners(path, claim_index, index)` composes three source
classes into an `OwnerSet { implements, amends, amendment_record }`.
The check then runs `owners.any_owner_in_diff(diff_paths)`, which
disjuncts across all three classes. Spec 133 FR-001/FR-002 ride this
composition.

**Section-scoped path** (`check_coupling_section_aware`, lib.rs:517
region `section-matching`): for each `(path, section)` with a section
claim, the predicate is

```rust
let satisfied = section_spec_ids
    .iter()
    .any(|id| diff_paths.contains(&format!("specs/{id}/spec.md")));
```

There is no consultation of `amends:` or `amendmentRecord:`. The
constructed `OwnerSet` on the violation path also seeds only
`implements`, so the renderer cannot label amender or amendment-record
provenance even when those classes would have cleared the section.

The asymmetry is observable any time a path that has `co_authority`
section claims is governed by a spec which is itself the subject of an
amendment in the same diff: the whole-file branch accepts the
amender's spec.md edit, the section branch does not.

## 3. Decision: bug-fix-only, not a new contract

Two readings of the section gap were considered:

- (A) Spec 133's intent has always covered section-scoped authority;
  the implementation diverged. Spec 176 corrects the divergence with
  `shape: bug-fix`.
- (B) Spec 133 predates spec 152's section-aware mechanism and the §4
  prose was forward-looking; the section-aware mechanism needs
  amender semantics newly added. Spec 176 would carry
  `shape: mechanism-add`.

Reading (A) is preferred because spec 133 §4's pseudocode is explicit
that `A` ranges uniformly over both branches, and the prose immediately
following the algorithm — "editing an amending spec satisfies coupling
for the amended spec" — does not condition on whole-file authority.
Spec 152 §5 cites spec 133 §3 / §4 as the consumer of its section
mechanism without re-specifying satisfaction. The contract was always
joint; the implementation simply diverged.

This decision matters for amender-list construction: spec 176 amends
both spec 133 (whose §4 contract is the load-bearing prose) and spec
152 (whose section mechanism is the surface that the fix touches).
`shape: bug-fix` is the precise (kind, shape) classification per spec
147's table.

`invariant-freeze` was not the right kind for this work: that vocabulary
is a *constraint kind* used inside `constrains:` blocks (spec 130), not
a top-level spec kind. The (kind, shape) pair here is `kind: amendment,
shape: bug-fix`.

## 4. FR-005 strict-expansion preserved

Spec 133 FR-005 requires that the amend pathways "strictly expand the
set of accepted couplings; never remove existing ones" and never
"newly enrol a path that today has no `implements:` claimant". The
whole-file implementation enforces this by short-circuiting amender
resolution when `owners.implements.is_empty()`.

The section-scoped fix preserves the same invariant by construction:
the amender and amendment-record pathways fire only inside the branch
that already located `section_spec_ids` for `(path, section)`. A path
without a section claim falls through to the whole-file branch (which
has its own FR-005 guard). A path with an empty section claim cannot
reach this code at all. Therefore no path silent today becomes firing
under §6 below.

## 5. Implementation

Add a helper in the `authority-derivation` region of
`tools/spec-spine/spec-code-coupling-check/src/lib.rs`:

```rust
/// Spec 176: compose the section-scoped owner set for a given
/// (path, section), mirroring `legitimate_owners` for whole-file
/// authority but keyed on the explicit `section_spec_ids` instead of
/// the path's whole-file claim index.
///
/// FR-005 strict-expansion is preserved by construction: this helper
/// is only invoked from `check_coupling_section_aware` inside the
/// branch that already located `section_spec_ids` for the
/// `(path, section)` pair, so empty section claims short-circuit
/// upstream.
pub fn legitimate_owners_for_section(
    section_spec_ids: &BTreeSet<String>,
    index: &CodebaseIndex,
) -> OwnerSet {
    let mut owners = OwnerSet::default();
    owners.implements = section_spec_ids.clone();
    if section_spec_ids.is_empty() {
        return owners;
    }
    // Amenders of any section authority (spec 133 FR-001 generalised).
    for mapping in &index.traceability.mappings {
        if mapping
            .amends
            .iter()
            .any(|id| section_spec_ids.contains(id))
        {
            owners.amends.insert(mapping.spec_id.clone());
        }
    }
    // Amendment record on each section authority (spec 133 FR-002
    // generalised).
    for section_id in section_spec_ids {
        if let Some(mapping) = index
            .traceability
            .mappings
            .iter()
            .find(|m| &m.spec_id == section_id)
        {
            if let Some(record) = &mapping.amendment_record {
                owners.amendment_record.insert(record.clone());
            }
        }
    }
    owners
}
```

Rewire the section satisfaction branch in `check_coupling_section_aware`
(region `section-matching`):

```rust
if let Some(section_spec_ids) = section_claims.get(&key) {
    any_section_handled = true;
    let section_owners =
        legitimate_owners_for_section(section_spec_ids, index);
    if !section_owners.any_owner_in_diff(diff_paths) {
        violations.push(Violation {
            path: path.clone(),
            section: Some(section_name.clone()),
            owners: section_owners,
        });
    }
}
```

The renderer requires no change: `render_violation_block` already
groups owners by class via `push_owner_class`, so amender or
amendment-record provenance surfaces in violation output identically to
whole-file violations.

## 6. Acceptance criteria

- **AC-1.** `check_coupling_section_aware` is satisfied when a section
  authority spec Y is not edited but an amender X with `X.amends ⊇ {Y}`
  has its `spec.md` in the diff. Verified by the new
  `section_aware_amender_clears_section` test.
- **AC-2.** `check_coupling_section_aware` is satisfied when a section
  authority spec Y carries `amendment_record: Z` in its mapping and
  `specs/Z/spec.md` is in the diff. Verified by the new
  `section_aware_amendment_record_clears_section` test.
- **AC-3.** When the section authority spec is edited directly,
  satisfaction is unchanged. Verified by the existing
  `section_aware_spec_code_coupling_section_passes_with_spec127`
  test, which continues to pass under the rewired predicate.
- **AC-4.** A section violation with no amender or amendment-record in
  diff still fails with exit code 1. Verified by the existing
  `section_aware_wrong_spec_fails` test.
- **AC-5.** FR-005 strict-expansion: a section authority set Y with no
  amenders and no amendment_record produces an `OwnerSet` whose
  `amends` and `amendment_record` classes are empty, identical to the
  pre-fix behaviour on those classes. Verified by inspection (helper
  short-circuits when `section_spec_ids` is empty; amender loop reads
  `mapping.amends` for non-emptiness only).
- **AC-6.** Specs 133 and 152 receive `amended:` /
  `amendment_record:` frontmatter pointing to spec 176, plus a body
  callout, per the spec 119 amender convention.

## 7. Cross-references

- Spec 133 — coupling-gate satisfaction contract (the §4 prose this
  amendment realises in the section-scoped branch)
- Spec 152 — path co-authority (the section mechanism that surfaces
  the section-scoped branch in the first place)
- Spec 119 — amendment convention (frontmatter and body callout
  shape)
- Spec 147 — spec-kind grammar (validates `kind: amendment,
  shape: bug-fix`)
- Spec 130 — relationship-graph (typed authority edges)
