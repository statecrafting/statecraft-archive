---
id: "216-spec-spine-library-grammar-adoption"
title: "Spec-Spine Library Grammar Adoption (amends bare-id; supersedes-partial reconciliation)"
feature_branch: "feat/216-spec-spine-library-grammar-adoption"
status: approved
implementation: complete  # Phase 1 landed (V-033 bare-id `amends`), Phase 2a (§2.3: typed `supersedes` parse + V-034 + structured emission + additive schema widen), Phase 2b (§2.4: gate full/partial-supersession filtering, index `TraceMapping.supersedes`, registry-consumer `by-authority` parity). Reconciled post spec 217 (#387, issue #404): the engine swap deleted the in-tree spec-compiler that embodied Phase 1/2a/2b, so the two `spec-compiler` units were dropped from this spec's graph; the grammar now lives in the published spec-spine library. The surviving in-repo surfaces (registry.schema.json widen, spec-types known-key comment, featuregraph golden row) remain live. 217 depends on this spec as a completed predecessor, so it is approved, not superseded.
kind: governance
domain: tooling
created: "2026-06-14"
authors: ["open-agentic-platform"]
language: en
summary: >
  Converge OAP's spec-compiler frontmatter grammar onto the standalone
  spec-spine library, which models `amends` and `supersedes` as typed
  fields and rejects malformed entries at deserialization. OAP's compiler
  parses both through `optional_string_list`, which silently drops any
  non-string entry: an object-form `amends`/`supersedes` records nothing
  and confers no authority. That silent drop was the spec 125 defect PR
  #358 corrected. Phase 1 (this spec, implementable now) narrows `amends`
  to bare-id and replaces the silent drop with a loud V-033 compile error,
  a behaviour-preserving convergence for the real corpus (zero live
  object-form `amends` remain after PR #358). Phase 2 (sequenced)
  reconciles `supersedes`, whose silent drop discards the structured
  partial-supersession form the library honours and the relationship graph
  (specs 130/154) documents: that is an authority-transfer change and
  carries the real review weight.
depends_on:
  - "001-spec-compiler-mvp"
  - "130-spec-coupling-primary-owner"
  - "132-constitutional-invariant-freeze"
  - "133-amends-aware-coupling-gate"
  - "153-invariant-freeze-additive-evolution"
  - "154-logical-unit-ownership-grammar"
code_aliases: ["SPEC_SPINE_LIBRARY_GRAMMAR_ADOPTION"]
extends:
  # New spec adds a row to the featuregraph golden (same precedent as
  # specs 212, 202, 196, 194, 193, 187, 183).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # Phase 2a additively widens the registry schema's `supersedes.items` to a
  # string|object oneOf (FR-008). Strictly additive evolution of the
  # spec-132-frozen schema, authorized by spec 153; mirrors spec 154's own
  # `extends:` edge on this same file for the establishes/references grammar.
  - spec: "130-spec-coupling-primary-owner"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
  # NOTE (issue #404, post spec 217): the former `extends: 001` edge over
  # `tools/spec-spine/spec-compiler/tests` was dropped here. Spec 217's engine
  # swap (#387) deleted the in-tree spec-compiler and its test directory, so
  # that unit no longer exists. The fixture tests it referenced
  # (v033_amends_bare_id, v034_supersedes_typed) went with the deleted engine;
  # the equivalent grammar validation now lives in the published spec-spine
  # library. No replacement edge is added: OAP no longer owns an in-tree
  # compiler test surface for this grammar.
refines:
  # The narrowing itself. `amends` (Phase 1) and `supersedes` (Phase 2)
  # parse through the same `optional_string_list` site; this spec tightened
  # that aspect from silent-drop to typed-or-reject.
  #
  # NOTE (issue #404, post spec 217): the compiler parse site + V-033/V-034
  # (`tools/spec-spine/spec-compiler/src/lib.rs`) was deleted by spec 217's
  # engine swap (#387); that unit is dropped from this aspect. The surviving
  # unit is the shared frontmatter known-key comment, which still documents
  # the field grammar and is still consumed by spec-lint and the OAP overlay
  # tools (oap-registry-enrich, oap-code-index-enrich, policy-compiler).
  - aspect: "amends-supersedes-frontmatter-grammar"
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
amends:
  # Phase 1 landed (FR-004): this spec formally amends the 2026-06-14 bare-id
  # `amends` clarification callouts in spec 130 §2.5 and spec 154 §5, folding
  # the PR-#358 clarification notes into a spec-recorded amendment. The amends
  # edge confers co-authority over each predecessor's spec.md (named by id; no
  # unit:/paths: is honoured) and no code authority; the compiler-convergence
  # code authority lives on `refines:` above. (Replaces the draft-time
  # `references: role: context` placeholder these ids previously carried.)
  - "130-spec-coupling-primary-owner"
  - "154-logical-unit-ownership-grammar"
  # Phase 2b (FR-010..FR-014): this spec formally amends the contract owners of
  # the three source surfaces Phase 2b edits, documenting the supersession-aware
  # authority change in each owner's spec.md (the amends edge confers
  # co-authority over the predecessor's spec.md and no code authority; the
  # touched source files are coupling-cleared by their in-diff owner). 133 owns
  # the gate's `authority-derivation` region (legitimate_owners); 181 owns the
  # registry-consumer authority resolver (by-authority). 154 (above) additionally
  # owns the codebase-indexer + index-schema surface FR-010 extends. 188 set the
  # index schema to 3.0.0 (Phase 4a) and owns the `spec188_check_config.rs` test
  # whose version assertion moves with the additive 3.0.0 -> 3.1.0 bump.
  - "133-amends-aware-coupling-gate"
  - "181-registry-consumer-unit-grammar-authority"
  - "188-derived-index-merge-serialization"
---

# Feature Specification: Spec-Spine Library Grammar Adoption

**Feature Branch**: `feat/216-spec-spine-library-grammar-adoption`
**Created**: 2026-06-14
**Status**: Approved (all three phases landed; reconciled post spec 217 engine
swap; see the reconciliation note below)
**Input**: Follow-up to PR #358 (`fix(125): migrate structured amends to
bare-id + refines`) and the 2026-06-14 clarification callouts added to
spec 130 §2.5 and spec 154 §5.

> **Reconciliation note (2026-07-08, issue #404).** Spec 217's engine swap
> (#387, `145b6fc3`, "delete 4 in-tree engine crates, repoint to published
> spec-spine CLI") deleted the in-tree spec-compiler that embodied this spec's
> Phase 1/2a/2b changes: the V-033/V-034 parse sites in
> `tools/spec-spine/spec-compiler/src/lib.rs`, its fixture tests under
> `tools/spec-spine/spec-compiler/tests`, and the Phase 2b supersession
> filtering that lived in the (also-deleted) `spec-code-coupling-check`,
> `codebase-indexer`, and `registry-consumer` crates. OAP now consumes the
> published spec-spine library, which models this grammar natively: the
> ultimate form of the convergence this spec set out to achieve. That deletion
> orphaned two of this spec's claimed units
> (`tools/spec-spine/spec-compiler/src/lib.rs`,
> `tools/spec-spine/spec-compiler/tests`), which are dropped from the
> relationship graph above. This spec's still-live in-repo contribution is the
> additive `standards/schemas/spec-spine/registry.schema.json`
> `supersedeScopedItem` widen (FR-008), the `tools/shared/spec-types/src/lib.rs`
> known-key comment (FR-003/FR-009, still consumed by spec-lint and the OAP
> overlay tools), and the featuregraph golden row. Spec 217 declares this spec
> a *completed* grammar-convergence predecessor it depends on (217 spec.md
> `depends_on: 216`; "Spec 216 implementation complete"), so this spec is
> approved, not superseded. SC-001 is fully realised: OAP no longer has an
> in-tree compiler that can diverge from the library.

## Overview

The standalone spec-spine library (the published grammar OAP is converging
onto under the collapse mission) models the relationship edges as typed
Rust fields: `amends: Vec<String>` and structured `supersedes`, rejecting
malformed entries at deserialization (`spec-spine-types/src/frontmatter.rs`).
OAP's in-tree spec-compiler reaches the same observable contract for the
common case but by a weaker mechanism, and the two diverge precisely where
input is malformed.

OAP parses both `amends` and `supersedes` through one helper,
`optional_string_list` (`tools/spec-spine/spec-compiler/src/lib.rs`, helper
defined at `:1370`):

```rust
fn optional_string_list(m: &serde_yaml::Mapping, key: &str) -> Option<Vec<String>> {
    let v = m.get(key)?;
    let arr = v.as_sequence()?;
    let mut out = Vec::new();
    for x in arr {
        out.push(x.as_str()?.to_string());   // non-string entry -> None for the whole field
    }
    Some(out)
}
```

Because `x.as_str()?` returns `None` for the whole call on any non-string
entry, and the call sites apply `.unwrap_or_default()`, an object-form
entry is **silently discarded**: the field collapses to an empty list, no
relationship is recorded, and no authority is conferred. This is the latent
defect PR #358 corrected in spec 125 (an `amends: [{spec, unit}]` that
cleared no ownership). The frontmatter known-key comment at
`tools/shared/spec-types/src/lib.rs:121` ("rebound to support object form
… when relationship-graph semantics are desired") describes a capability
that was never wired through the compiler and is, today, misleading.

This spec converges OAP's grammar onto the library and makes the silent
drop legible, in two phases. **Phase 1** narrows `amends` (cosmetic: both
systems already mean bare-id; only OAP's failure mode is wrong) and is
implementable now. **Phase 2** reconciles `supersedes`, where the silent
drop discards a structured form the library *honours* (partial
supersession) and the relationship graph documents: that is a change to
authority-transfer semantics, the coupling gate's most load-bearing path,
and is sequenced separately so it gets the review attention it warrants.

---

## Phase 1: `amends` is bare-id only (implementable now)

### 1.1 Current state (the real mechanism, not an object-form arm)

There is **no object-form `amends` parser arm to remove**. OAP already
captures `amends` as a list of ids
(`optional_string_list(fm, "amends").unwrap_or_default()`,
`lib.rs:275`). The library models `amends` as `Vec<String>` and rejects an
object entry with a clean deserialization error
(`spec-spine-types/src/frontmatter.rs:164`). OAP's observable contract is
already the same (bare-id); only the *failure mode* differs (OAP drops
silently, the library rejects loudly).

### 1.2 Decision

Narrow OAP's accepted `amends` grammar to bare-id only, and make the silent
drop a hard, legible compile error. An `amends` edge grants co-authority
over the predecessor's `spec.md` (named by the id; no `unit:`/`paths:` is
needed or honoured) and confers **no** code authority. Section-scoped
amendment intent continues to use the existing `amends_sections:` field
(spec 132), not an object form. Code authority belongs on
`refines:`/`extends:`, which the coupling gate honours.

### 1.3 Functional Requirements (Phase 1)

- **FR-001 (grammar).** `amends` is a list of spec-id strings
  (`Vec<String>`), matching `spec-spine-types::frontmatter.amends`. No
  object/mapping entry is accepted.
- **FR-002 (loud failure replaces silent drop).** When any `amends` entry
  is a non-string, the spec-compiler emits a new error-severity validation
  code **V-033** on the owning spec, instead of the current empty-list
  collapse. (V-033 was confirmed free across the spec-compiler and
  spec-lint crates as of 2026-06-14; re-confirm against the live code table
  at implementation time, since lower gaps are emission-vs-reservation
  ambiguous.) The message names the migration path verbatim:
  > `amends` takes spec ids only (`amends: ["NNN-slug", ...]`); an object
  > entry confers no authority and is dropped. To claim code, use
  > `refines:`/`extends:` units; to scope to sections of the amended spec,
  > use `amends_sections:` (spec 132). See spec 130 §2.5.

  Implementation: replace the `optional_string_list(fm, "amends").unwrap_or_default()`
  site at `lib.rs:275` with a parse that distinguishes "absent" (Ok, empty)
  from "present but contains a non-string" (V-033 error), mirroring the
  library's reject-on-object behaviour.
- **FR-003 (comment truth).** Correct the known-key comment at
  `tools/shared/spec-types/src/lib.rs:121` to state that `amends` is bare-id
  only and that object-form entries are rejected (V-033). Remove the
  "rebound to support object form" claim.
- **FR-004 (docs amendment record).** When Phase 1 lands, this spec becomes
  the formal amender of the 2026-06-14 clarification callouts in spec 130
  §2.5 and spec 154 §5: add `amends: ["130-spec-coupling-primary-owner",
  "154-logical-unit-ownership-grammar"]` to this spec's frontmatter, and
  bump `amended:` / set `amendment_record:` to this spec's id in both
  files, folding the PR-#358 clarification notes into a spec-recorded
  amendment. (Deferred to implementation deliberately: at draft-file time
  the callouts stand on their own as notes recording a landed PR decision,
  per the bookkeeping in the 2026-06-14 clarification commit.)

### 1.4 Non-goals (Phase 1)

- **L-005 is untouched.** L-005 (spec-lint `lib.rs:516`) governs
  bare-string paths inside workspace members (file → crate migration, spec
  154 §3.1), not `amends`. Phase 1 does not modify it. Citing L-005 for
  `amends` would be a false mechanism.
- **`supersedes` is Phase 2, not Phase 1.** It routes through the same
  `optional_string_list` site (`lib.rs:282`) and so silently drops the
  structured partial form. Reconciling it changes authority-transfer
  semantics, not just a failure mode; see Phase 2.
- **No registry schema bump.** `amends` already emits as a string list; the
  registry schema (frozen by spec 130/132 invariant-freeze) is unchanged.
  This is a validation narrowing on the input side only, additive-compatible
  per spec 153: no previously-*valid* document changes meaning, because the
  only documents affected are object-form `amends`, which were silently void
  already.

### 1.5 Acceptance Criteria (Phase 1)

- **AC-001.** A fixture spec with `amends: [{spec: "001", unit: {...}}]`
  fails `spec-compiler compile` with V-033 (error), naming the bare-id +
  `refines`/`amends_sections` remediation. (Previously: compiled, `amends`
  silently empty.)
- **AC-002.** A fixture spec with `amends: ["001-foo", "002-bar"]` compiles
  unchanged and records both ids.
- **AC-003.** Registry output for the *current* corpus is byte-identical
  before and after the change (zero live object-form `amends` remain after
  PR #358), proving the narrowing is behaviour-preserving for the real
  corpus.
- **AC-004.** `registry-consumer validate-graph` returns no problems;
  spec-lint `--fail-on-warn` exits 0.
- **AC-005.** The OAP corpus compiles under the standalone spec-spine
  library with no `amends`-related rejection (the convergence goal PR #358
  began).
- **AC-006.** Spec 130 and spec 154 frontmatter carry this spec's id in
  `amendment_record:` and a bumped `amended:` date (FR-004).

---

## Phase 2: `supersedes` partial-supersession reconciliation (sequenced)

### 2.1 The asymmetry

OAP's compiler also routes `supersedes` through `optional_string_list`
(`lib.rs:282`), silently dropping the structured partial form
(`{spec, scope: partial, paths|units, rationale}`) that spec 130 §2.4 and
spec 154 §5 document and that the standalone library honours (the library's
partial-supersession design). So a spec authored with structured partial
supersession compiles in OAP as `scope: full` for each id (or as nothing,
if the entry is a non-string mapping), discarding the per-unit scope that
makes partial supersession meaningful.

### 2.2 Why this is sequenced, not folded into Phase 1

Unlike `amends` (where both systems already mean bare-id and only the
failure mode differs), `supersedes` is a genuine semantic divergence: the
library computes a different authority set for a partially-superseded path
than OAP does today. Reconciling it changes `authorities(P)` (spec 130 §
"Authority as a derived property", spec 154 §6), which the coupling gate
(spec 133) consumes on its most load-bearing path. That work needs its own
fixture matrix and review pass; landing it under the same FR set as the
cosmetic `amends` change would bury the risk.

Phase 2 splits into **Phase 2a** (the producer side: parse, validate, emit
the structured form, plus the additive schema widen) and **Phase 2b** (the
consumer side: carry the now-emitted partial scope through to
`authorities(P)` and the coupling gate). 2a is implementable now and
behaviour-preserving for *consumers* (the gate ignores `supersedes` today, so
emitting the structured form changes no gating decision); 2b is the
authority-semantics change that carries the review weight and is sequenced
separately.

#### Grammar reconciliation (settled here)

§2.1 above referred to the partial form as `{spec, scope: partial,
paths|units, rationale}`. The canonical partial-scope key is **`unit:`**, not
`paths:`. Spec 154 §6 modernised the relationship-field grammar to logical
units; the standalone library (`spec-spine-types::edges::SupersedeScoped`)
and every live partial-supersession spec (114, 199, 214) use `unit:` (or a
prose `note:`). `paths:` survives only in spec 130 §2.4's pre-154 doc
template and is used by no live spec. Phase 2a converges on `unit:` and FR-009
amends spec 130 §2.4's template to match. The accepted envelope keys are
`{spec, scope, unit, note, rationale}` (mirroring the library's
`deny_unknown_fields`); a partial entry may scope by `unit:` (114, 214) **or**
by a prose `note:` with no unit (199 is the live precedent), so partial does
**not** require `unit:`.

### 2.3 Phase 2a: typed `supersedes` parse + structured emission (implementable now)

#### Functional Requirements (Phase 2a)

- **FR-005 (typed parse).** Replace the `optional_string_list(fm,
  "supersedes")` site at `lib.rs:282` with a typed parse accepting a bare
  spec-id string (full-scope shorthand) or a `{spec, scope: full|partial,
  unit?, note?, rationale?}` object, mirroring
  `spec-spine-types::edges::SupersedeItem` (untagged `Full(String) | Scoped`).
- **FR-006 (loud reject, V-034).** A malformed `supersedes` entry emits a new
  error-severity **V-034** on the owning spec instead of the silent
  empty-list collapse. Malformed = a non-string non-mapping entry; a mapping
  missing `spec`; a `scope` value outside `{full, partial}`; or an unknown
  envelope key (allowed: `spec, scope, unit, note, rationale`), mirroring the
  library's `deny_unknown_fields`. The `unit:` value's internal shape is
  already validated by V-021..V-024 (`validate_relationship_units`); V-034
  covers the envelope only. Partial scope does **not** require `unit:` (a
  prose `note:` suffices; spec 199 is the live precedent). (V-034 confirmed
  free across spec-compiler + spec-lint as of 2026-06-15.)
- **FR-007 (structured emission + full normalisation).** Emit the structured
  form into `registry.json`: a full-scope entry (bare string, `{spec}`, or
  `{spec, scope: full}`) normalises to a bare spec-id string; a partial-scope
  entry emits `{spec, scope: "partial", unit?, note?, rationale?}` with the
  unit re-canonicalised. Mirrors the library's `normalize_supersedes`. The
  `Feature.supersedes` field widens from `Option<Vec<String>>` to
  `Option<Value>` (the `establishes` precedent at `lib.rs:1045`).
- **FR-008 (additive schema extension).** Widen `registry.schema.json`'s
  `supersedes.items` from `{type: string}` to `oneOf: [{type: string},
  {$ref: supersedeScopedItem}]`, adding the `supersedeScopedItem` `$def`
  (`additionalProperties: false`, `required: [spec]`, the `unit` field
  `$ref`-ing `logicalUnit`). Strictly additive per spec 153 (every prior
  array-of-strings stays valid), authorised by this spec's `extends:
  {nature: additive, unit: registry.schema.json}` edge (the spec 154
  precedent on this same file). No `specVersion` bump (additive item-shape
  widening, as 154's establishes extension was).
- **FR-009 (comment + doc truth).** Correct the `supersedes` known-key comment
  at `tools/shared/spec-types/src/lib.rs` to describe the typed grammar
  (bare string = full; object = `{spec, scope, unit?, note?, rationale?}`;
  malformed rejected with V-034). Amend spec 130 §2.4's doc-template `paths:`
  to the canonical `unit:` form per the reconciliation above.

#### Acceptance Criteria (Phase 2a)

- **AC-007.** A fixture with `supersedes: [{spec, scope: partial, unit: {kind:
  file, path: ...}}]` compiles and the registry records the structured
  partial entry verbatim (previously: silently dropped to `null`).
- **AC-008.** Fixtures `supersedes: ["001-x"]`, `[{spec: "001-x"}]`, and
  `[{spec: "001-x", scope: full}]` all compile and emit the byte-identical
  bare-string form `["001-x"]` (full normalisation).
- **AC-009.** A fixture with a malformed entry (missing `spec`, bad `scope`,
  unknown key, or non-string-non-map) fails compile with V-034 naming the
  remediation. A partial entry with only a `note:` (no `unit:`) does **not**
  trip V-034.
- **AC-010.** The real OAP corpus compiles: spec 214's four partial entries
  and spec 199's note-scoped partials appear structured in the registry (no
  longer `null`); specs 073/108/154's full entries appear as bare strings.
  `registry-consumer validate-graph` clean; `spec-lint --fail-on-warn` exit 0.
- **AC-011.** The compiler's embedded-schema self-validation passes on the
  structured registry. The widen is additive: a registry with only
  bare-string `supersedes` still validates.
- **AC-012.** The emitted grammar is structurally equivalent to the library's
  `SupersedeItem` model (`Full(String) | Scoped{spec, scope, unit, note,
  rationale}`), so OAP and the library accept/reject the same `supersedes`
  documents (the SC-001 convergence goal for the parse/emit half).

### 2.4 Phase 2b: coupling-gate supersession filtering (consumer side)

The consumer half, and the load-bearing one. Phase 2a emits the structured
partial form into `registry.json` but changes **no** gating decision: the
coupling gate ignores `supersedes` entirely today and confers authority on a
superseded predecessor exactly as on any live claimant. Phase 2b carries the
supersession through to `authorities(P)` (constitution § "Authority as a
derived property"; spec 130 § "Authority as a derived property"; spec 154 §6),
the gate's most load-bearing path.

#### Where the data lives (a prerequisite the §2.3-era sketch under-specified)

The gate (`spec-code-coupling-check`) reads the **committed codebase index**
(`open_agentic_codebase_indexer::types::CodebaseIndex`), not the gitignored
registry (spec 103 consumer-binary boundary; the registry/index read
divergence is a known crack). Its `build_claim_index` flattens each mapping's
`implementing_paths` to a claimant set with no supersession awareness, and
`legitimate_owners()` composes `implements` + `amends` + `amendment_record`.
The index `TraceMapping` already carries `spec_status` and the resolved
`amends` ids, **but not** the `supersedes` edges. So:

- **Full supersession** is filterable from existing index data: a fully
  superseded predecessor carries `spec_status: superseded` (full supersession
  is exactly what flips the status), and the gate drops it.
- **Partial supersession** needs a new, additive index field: the gate must
  know which `(predecessor, path)` pairs a **live** successor has partially
  superseded. That edge is not derivable from `implementing_paths` (which
  loses the predecessor linkage) and is the prerequisite FR-010 adds.

The successor already *claims* the partially-superseded unit in the index:
the indexer folds `supersedes` units into the successor's `implementing_paths`
(`parse_implements`), so e.g. spec 214 already claims
`platform/services/tenant-hello` and spec 114 already claims
`platform/services/statecraft/api/projects/clone.ts`. Phase 2b's net effect on
such a path is therefore a **tightening**: the predecessor stops satisfying
the path; the live successor becomes the required owner. No path loses all
owners (§ Blast radius below).

#### Functional Requirements (Phase 2b)

- **FR-010 (index carries partial supersession).** Add an additive
  `supersedes` field to the codebase index `TraceMapping`, carrying the
  spec's **partial**-scope supersedes edges as `{spec, scope: "partial",
  paths}` with the predecessor id resolved to a full `NNN-slug` and the
  `unit:` resolved to its physical path(s) by the indexer's existing unit
  resolver. Full-scope entries are **not** emitted here (full supersession is
  represented by the predecessor's `spec_status`, keeping the consumer-shaped
  index minimal). The field is `#[serde(default, skip_serializing_if =
  "Vec::is_empty")]`, so a spec with no partial supersedes (or a 3.0.0
  consumer reading a 3.1.0 index) sees the same shape it always has. Bump the
  index `SCHEMA_VERSION` from `3.0.0` to `3.1.0` (additive minor; the coupling
  gate's compatibility check is major-only, so it is unaffected) and widen
  `codebase-index.schema.json` additively to admit the new optional property.
- **FR-011 (gate: full-supersession filtering).** `legitimate_owners()`
  excludes from a path's owner set any `implements` claimant whose
  `spec_status == "superseded"`. (In the live corpus this removes 044 from the
  `crates/orchestrator/*` paths it established; 038/040/088 claim no code.)
- **FR-012 (gate: partial-supersession filtering).** `legitimate_owners()`
  excludes a claimant `C` from path `P`'s owner set when a **live** successor
  (`spec_status != superseded`) declares a partial supersedes edge over `C`
  whose resolved paths include `P` (FR-010's field). The live successor stays
  an owner of `P` (it already claims `P` via the folded supersedes unit), so
  editing `P` requires the successor, not the superseded predecessor.
  Note-scoped partial entries (no `unit:`, e.g. spec 199's three edges) carry
  no path and are a no-op. The filter applies identically to the section-aware
  owner resolver (`legitimate_owners_for_section`), for symmetry, though no
  corpus partial supersession is section-scoped today.
- **FR-013 (registry-consumer: `by-authority` parity).** `authority_for_path`
  (the `by-authority` engine, spec 181) gains a `supersedes` matcher so a
  partial-supersedes `unit:` confers visible authority on the successor
  (relationship `supersedes`), and removes the partially-superseded
  predecessor over that unit, so `by-authority` reports the same
  `authorities(P)` the gate enforces. Full supersession is already excluded
  there (the existing `status == superseded` skip). The `show-relationships`
  supersedes reader is aligned to read `unit:` (resolved to a path) alongside
  legacy `paths:`. This closes the supersession slice of the
  gate/`by-authority` read divergence; full unification behind one authority
  library remains future work.
- **FR-014 (determinism + regeneration).** The implementing commit
  regenerates the registry, the codebase index (now emitting the
  `TraceMapping.supersedes` field for the partial superseders), and the
  featuregraph golden. The change is intentionally **not** index-byte-identical
  (it adds the new field and tightens authority on superseded predecessors);
  it introduces no nondeterminism (constitution Principle IV).

#### Blast radius (verified 2026-06-15, governed reads + `codebase-indexer render`)

No path loses all live owners:

- **Full:** 038/040/088 claim no code; 044's three `crates/orchestrator/*`
  paths each retain ≥1 live claimant (092/094/097/098/099/100/102/198/202).
- **Partial, unit-scoped:** 114 over 113 (`clone.ts`) and 214 over 136 (the
  four `tenant-hello` service/chart/workflow units) are each re-claimed by the
  live successor in the index, so filtering the predecessor leaves the
  successor as owner.
- **Partial, note-scoped:** 199 over {108,140,141} carry no `unit:`; no path
  authority transfers.

A before/after `authorities(P)` corpus diff is the verification gate
(FR-014); landing halts if any path unexpectedly loses all live owners.

#### Acceptance Criteria (Phase 2b)

- **AC-013.** Gate fixture: spec A establishes path P; spec B
  (`spec_status: superseded`) also claims P. After the change,
  `legitimate_owners(P)` excludes B; the path is satisfied by A's spec.md,
  not B's.
- **AC-014.** Gate fixture: spec A establishes P; **live** spec B declares
  `supersedes: [{spec: A, scope: partial, unit: {kind: file, path: P}}]` and
  claims P via the folded unit. `legitimate_owners(P) == {B}` (A removed);
  editing P is satisfied by B's spec.md, not A's.
- **AC-015.** Gate fixture: live spec B declares `supersedes: [{spec: A,
  scope: partial, note: "..."}]` (no unit). `legitimate_owners` is unchanged
  for every path A claims (note-scoped partial is a no-op).
- **AC-016.** Index: `TraceMapping.supersedes` is emitted for the live partial
  superseders (114, 214) with the predecessor id and resolved paths; full
  superseders emit no entry. A 3.0.0 consumer deserialises a 3.1.0 index
  unchanged (additive). The compiler's embedded-schema self-validation and the
  widened `codebase-index.schema.json` both accept the regenerated index.
- **AC-017.** `registry-consumer by-authority platform/services/tenant-hello`
  reports `214 … via: supersedes` and **not** `136`; `by-authority` on a
  `crates/orchestrator/*` path does not list 044;
  `by-authority platform/services/statecraft/api/projects/clone.ts` reports
  `114`, not `113`.
- **AC-018.** Corpus green: `spec-compiler compile`, `codebase-indexer
  compile` + `check`, `registry-consumer validate-graph`, `spec-lint
  --fail-on-warn`, and the coupling gate against `origin/main` all pass; the
  before/after `authorities(P)` corpus diff shows zero paths losing all live
  owners.
- **AC-019.** SC-001/SC-002/SC-003 hold for `supersedes` end-to-end: the gate
  and `by-authority` agree on the supersession authority set for the corpus,
  and no previously-valid spec changes meaning except the intended authority
  tightening on superseded predecessors.

#### Coupling (Phase 2b)

Phase 2b edits source owned by existing specs, satisfied by amending those
owners' `spec.md` (spec.md paths are themselves uncoupled, with no
`implements` claimant, so the amendments are coupling-free and the source
files are cleared by their owner being in the diff):

- `spec-code-coupling-check/src/lib.rs` (FR-011/FR-012): owned by spec 133,
  whose `authority-derivation` region carries the durable commitment that
  edits to it require a spec 133 edit. **Amend spec 133.**
- `tools/spec-spine/codebase-indexer/src/{types,xref,spec_scanner}.rs` and
  `standards/schemas/spec-spine/codebase-index.schema.json` (FR-010): all
  owned by spec 154 (logical-unit ownership grammar, the index unit surface).
  **Amend spec 154** (extending its existing 216 amendment record).
- `tools/spec-spine/registry-consumer/src/lib.rs` (FR-013): owned by spec 181
  (registry-consumer unit-grammar authority). **Amend spec 181.**

This spec's `amends:` therefore gains 133 and 181 (154 already present from
Phase 1). The featuregraph golden gains/keeps this spec's row under the
existing `extends: 034` edge. No new `extends:`/`refines:` edge is required:
each touched source file is already claimed by an in-diff owner.

---

## Success Criteria

- **SC-001.** OAP's spec-compiler and the standalone spec-spine library
  accept and reject the same `amends` documents (Phase 1) and the same
  `supersedes` documents (Phase 2): the convergence is verifiable by
  compiling the OAP corpus under both and getting no grammar-class
  divergence.
- **SC-002.** Malformed relationship-edge input fails loudly at compile
  with a named V-code and a remediation message, instead of being silently
  dropped. No future spec 125-class defect (authority that was never
  recorded) can pass compilation undetected.
- **SC-003.** No previously-valid spec changes meaning. Phase 1 is
  registry-byte-identical for the real corpus (zero live object-form
  `amends`). Phase 2a is intentionally **not** byte-identical: it is an
  authority-representation change, so specs that already author structured
  partial `supersedes` (214, 199) move from `null` to the structured form
  they always meant. No previously-*valid* `supersedes` document changes
  meaning (the widen is additive; bare strings and full objects still
  normalise to the same bare strings).

## Coupling and migration

Phase 1 touches `tools/spec-spine/spec-compiler/src/lib.rs` (V-033 + the
parse site) and `tools/shared/spec-types/src/lib.rs` (the known-key
comment), both declared under this spec's `refines:`
`amends-supersedes-frontmatter-grammar` aspect; the spec 130/154 frontmatter
bump (FR-004) is coupling-clean as each spec owns its own `spec.md`. The
featuregraph golden gains this spec's row under the `extends: 034` edge.
Regenerate the codebase index and the featuregraph golden in the
implementing commit.

Phase 2a extends the same `refines:` aspect to the `supersedes` parse site
(V-034) in `lib.rs` and the known-key comment in `spec-types`, both already
declared. It additionally edits `standards/schemas/spec-spine/registry.schema.json`
(FR-008), authorised by the new `extends: {nature: additive, unit:
registry.schema.json}` edge (the spec 154 precedent on this file), and amends
spec 130 §2.4's doc-template (FR-009), coupling-clean via this spec's existing
`amends: [130]` co-authority over 130's `spec.md`. Regenerate the codebase
index and the featuregraph golden in the implementing commit (spec 214's and
spec 199's `supersedes` now emit structured). Phase 2b (the coupling-gate
`legitimate_owners()` filtering and the `registry-consumer` reader alignment)
is coupling-gated separately in its own PR.
