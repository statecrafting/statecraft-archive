---
id: "156-references-edge-provenance-grammar"
slug: references-edge-provenance-grammar
title: "References-edge provenance grammar — typed external pointers as a sibling field"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
approved: "2026-05-22"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler and codebase-indexer that parsed and resolved the references-edge provenance grammar were deleted; that logic is now in spec-spine-core. The spec-compiler and codebase-indexer edges are stripped (paths deleted); the surviving edges (spec-types overlay, registry schema, featuregraph golden) carry this spec's authority, and the codebase-index schema edge is dropped with the in-tree codebase-index.schema.json (Workstream D).
kind: governance
domain: substrate
risk: low
depends_on:
  - "154-logical-unit-ownership-grammar"
code_aliases: ["REFERENCES_EDGE_PROVENANCE", "PROVENANCE_GRAMMAR"]
# 217 deleted the in-tree spec-compiler + codebase-indexer; the references-edge
# provenance grammar they parsed/resolved is now in spec-spine-core. The spec-compiler
# (lib + 2 tests) and codebase-indexer (spec_scanner, types, resolver/mod, test) edges
# are stripped (paths deleted). The surviving edges (spec-types overlay, registry
# schema, featuregraph golden) carry this spec's authority; the codebase-index schema
# edge is dropped with the in-tree codebase-index.schema.json (Workstream D). Amended by 217.
extends:
  - spec: "154-logical-unit-ownership-grammar"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
  - spec: "154-logical-unit-ownership-grammar"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
  - spec: "154-logical-unit-ownership-grammar"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: precedent
    unit: { kind: file, path: specs/155-logical-unit-resolution-semantics/spec.md }
  - role: precedent
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
summary: >
  Spec 154 §4 introduces the ninth, non-owning `references:` edge:
  each entry carries a `unit:` pointing at a logical unit in the
  codebase (crate, symbol, module, section, directory, file). That
  shape covers in-tree code but not the two external derivation
  sources the OAP architecture already produces — statecraft
  knowledge objects and xray content-addressed fingerprints. Citing
  those today requires inventing prose hyperlinks the indexer cannot
  see and a structural reverse-lookup cannot answer.

  This spec adds a sibling `provenance:` field on `references:`
  entries, mutually exclusive with `unit:`. Two initial kinds —
  `knowledge` and `code-fingerprint` — carry typed URI references to
  the external systems. The grammar is strictly additive on spec 154:
  every existing `references:` entry remains valid; the new field
  opens a parallel authoring channel for typed external provenance.
  The codebase-indexer threads provenance entries through the same
  `resolved_units` machine as in-tree units, with empty `locations`
  by design (provenance is non-owning by inheritance from spec 154
  §4). Dangling provenance is benign — the certificate-at-derivation
  is the load-bearing artifact, not source liveness.

  The grammar's load-bearing property is **structural reverse
  lookup**: `git grep "statecraft://project/<uuid>/knowledge/<uuid>"`
  across `specs/` answers *"which specs were derived from this
  source?"* deterministically and without an LLM. That property is
  what makes the provenance edge the substrate the OWASP ASI06
  poisoned-source response needs, and the typed link the ASI09
  anti-anthropomorphic-trust posture wants at spec-authoring time.
---

# 156 — References-edge provenance grammar

## 1. Problem

Spec 154 §4 defines `references:` as the ninth relationship — a
non-owning edge whose entries cite a logical unit in the codebase via
the spec 154 unit grammar:

```yaml
references:
  - role: evidence
    unit: { kind: symbol, id: canonical_json::canonicalize_value }
```

The six unit kinds (crate, symbol, module, section, directory, file)
all resolve **inside the workspace** — they are refactor-invariant
identifiers over in-tree code. The OAP architecture already produces
two derivation sources that are not in-tree code and have no place in
that grammar:

- **Knowledge objects** — statecraft's `knowledge_objects` table
  (`platform/services/statecraft/api/db/schema.ts:602`) holds
  canonical normalised documents under a project's storage bucket
  (project lineage from intake → extraction → classification →
  available). When a draft spec is derived from a knowledge item —
  the typical case for the decomposition pipeline staged at INTENT
  §6.2 stage 6 — the derivation is real, structural, and verifiable
  via `knowledge_objects.id` + `content_hash`. The unit grammar has
  no expression for "this spec was derived from knowledge item X."
- **Code fingerprints** — `crates/xray/src/tools.rs::xray_fingerprint`
  computes a content-addressed SHA-256 over a whole imported tree
  (the canonical case is INTENT §6.2 stage 2's preflight of an
  imported repository). When a spec is derived from a structural
  observation of a captured tree, the fingerprint is the stable
  identifier; pointing at a path in the *current* worktree is
  semantically wrong and refactor-fragile.

Today both classes get cited as prose hyperlinks in spec body text.
The indexer cannot see prose. A reverse query — *"which specs were
derived from knowledge item X?"* — has no structural answer; it
requires narrative search, which is exactly the substrate the
poisoned-source response (OWASP ASI06) cannot trust.

> **Orientation pointer (per reconciliation #1 of the design pass).**
> The intent doc at
> [`docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md`](../../docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md)
> §3.4 reads loosely as if the right fix is to widen `unit.kind` with
> `knowledge` and `code-fingerprint` values. That reading is wrong.
> The six unit kinds share refactor-invariance machinery the new
> kinds do not (knowledge UUIDs are external; fingerprints are over
> historical tree states). The grammar in this spec is a **sibling
> field**, not an enum extension — see §3 for the rationale. Per
> CONST-005 the spec wins; this pointer exists so future readers are
> not tripped by the intent doc's loose wording.

## 2. Decision

Add a sibling `provenance:` field on `references:` entries. A single
entry carries either a `unit:` (the spec 154 form, in-tree code) or
a `provenance:` (this spec's addition, typed external pointer),
**never both**. The two initial provenance kinds — `knowledge` and
`code-fingerprint` — carry typed URI references whose schemes are
kind-aligned and structurally reverse-lookup-able with `git grep`.

The grammar is strictly additive on spec 154:

- No existing `references:` entry shape changes. The `unit:` arm is
  untouched.
- The eight relationship fields (`establishes`, `extends`, `refines`,
  `supersedes`, `amends`, `co_authority`, `constrains`, `references`)
  retain their spec 130 / spec 154 semantics. `provenance:` is only
  valid inside `references:`; the seven ownership-bearing
  relationships keep `unit:` as their only value form.
- The codebase-index schema gains two enum values in
  `resolvedUnit.kind` (`knowledge`, `code-fingerprint`) — an additive
  schema bump (see §6 and §7).
- The coupling gate is unaffected: provenance edges inherit spec 154
  §4's non-owning semantic. Dangling provenance is benign (see §4
  and the lax-on-dangler design in §6).

## 3. Grammar

### 3.1 Shape

```yaml
references:
  # Spec 154 form (unchanged) — in-tree logical unit.
  - role: evidence
    unit: { kind: symbol, id: canonical_json::canonicalize_value }

  # Spec 156 form (new) — typed external provenance pointer.
  - role: derivation
    provenance:
      kind: knowledge
      ref: "statecraft://project/8c4f.../knowledge/2a91..."

  - role: derivation
    provenance:
      kind: code-fingerprint
      ref: "xray-fingerprint://5e3b..."
```

`role:` stays open-vocabulary per spec 154 §4. `role: derivation` is
**recommended** for provenance entries (V-029 advisory; see §5) but
not enforced — authors may pick a more precise role label when one
fits.

### 3.2 Why a sibling field, not an enum extension

The six unit kinds in spec 154 §3 share three properties:

1. **In-tree identity.** Every unit resolves to a `(file, span)` pair
   in the current worktree.
2. **Refactor invariance under stable identity.** A `crate:` unit is
   stable under file moves; a `symbol:` unit is stable under module
   moves that preserve the fully-qualified path; etc.
3. **Coupling-gate ownership.** Every kind except `references:`
   confers authority over its resolved locations.

Knowledge URIs and xray fingerprints share none of these. A knowledge
object lives in statecraft's DB, not the worktree. A fingerprint is
over a historical tree state, not the current one. Provenance edges
never confer authority — they are non-owning by inheritance from
spec 154 §4. Modelling them as a seventh unit kind would force the
unit machinery to handle two semantically distinct populations and
would falsely imply that ownership-bearing relationships
(`establishes`, `extends`, …) can carry provenance values. The
sibling-field shape keeps the populations separate at the type level.

### 3.3 Initial kinds

| `kind`             | URI scheme                                            | Resolves against           |
|--------------------|-------------------------------------------------------|----------------------------|
| `knowledge`        | `statecraft://project/<project-uuid>/knowledge/<knowledge-uuid>` | Statecraft DB (`knowledge_objects`) |
| `code-fingerprint` | `xray-fingerprint://<sha256>`                          | xray content-addressed store |

The set is deliberately small. Future kinds (sbom, cve,
decision-record, adr, external-document) land via amendment specs,
not by widening this spec. The §8 stop-condition list flags
unforeseen URI shapes as a halt-and-discuss event rather than an
authoring extension.

### 3.4 Knowledge URI — project-scoped

The knowledge URI carries the project segment inline:
`statecraft://project/<project-uuid>/knowledge/<knowledge-uuid>`.

Rationale (per reconciliation #3a of the design pass): spec 102
FR-007 establishes that the auditor's verifier does not trust the
producer. A self-locating URI saves the verifier a project-context
lookup it may not have when resolving a provenance ref against a
tenant DB whose project shape it does not already know.
`knowledge_objects.id` is globally unique by virtue of being a UUID
(`platform/services/statecraft/api/db/schema.ts:603`), but the
verifier's locator path benefits from the project context being
present in the URI itself.

V-027 (see §5) widens the scheme-alignment check accordingly: the
URI must carry the `/project/<uuid>/knowledge/<uuid>/` segment shape,
not just match the `statecraft://` scheme prefix.

### 3.5 Code-fingerprint URI — flat, scope deferred

The code-fingerprint URI is flat: `xray-fingerprint://<sha256>`.

`crates/xray/src/tools.rs::xray_fingerprint` takes a `repo_root` and
computes the fingerprint over the whole tree at a specific commit.
The decomposition pipeline (INTENT §6.2 stage 2) targets the whole
imported tree, so the flat shape covers every known use case today.

A future amendment may add a scoped flavor (e.g. `?path=<subtree>`
for derivations bound to a structural subtree observation) if a
concrete case surfaces. YAGNI applies; spec 156 ships the flat shape
only.

## 4. Non-owning semantic

Provenance edges inherit spec 154 §4's non-owning stance exactly. The
coupling gate (spec 133) ignores `references:` entries uniformly —
that includes both the `unit:` arm and the `provenance:` arm. A spec
edit to a `provenance:` entry is not a path edit; an edit to the code
referenced by a `unit:` entry under `references:` does not require
this spec to change.

The lax-on-dangler rule (reconciliation #5 of the design pass)
follows directly:

- If a `provenance:` entry's `knowledge` URI references a knowledge
  object that is later deleted from statecraft (e.g. tenant
  retention sweep), spec-lint MUST NOT emit a diagnostic.
- If a `code-fingerprint` URI references a tree state no longer
  reachable from any branch in the project's repos, spec-lint MUST
  NOT emit a diagnostic.

Provenance is a historical record of derivation **at the time of
derivation**. The certificate hash at derivation time (per spec 102)
is the load-bearing artifact, not the live availability of the
source. Going strict here would cascade knowledge deletions into
spec-lint failures across the corpus — the wrong seam by exactly the
analysis spec 154 §4 makes for in-tree `references:` units.

The codebase-indexer's behaviour on dangling provenance is described
in §6 (resolver short-circuits with empty locations; no `I-008` /
`I-108` diagnostic fires).

## 5. Validation rules (V-025..V-029)

The next free slot in
[`tools/shared/spec-types/src/lib.rs`](../../tools/shared/spec-types/src/lib.rs)
is V-025 (post-spec-155's V-024 extension). Spec 156 claims
V-025..V-029 — four errors and one advisory.

| Code  | Severity | Rule                                                                                                                                                                          |
|-------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| V-025 | error    | A `references:` entry MUST carry **exactly one** of `{unit:, provenance:}`. Both present → error; neither present → error (the entry has no target).                          |
| V-026 | error    | `provenance.kind` MUST be one of `{knowledge, code-fingerprint}`. Other values reject at parse time (no silent normalisation).                                                |
| V-027 | error    | `provenance.kind` ↔ `provenance.ref` scheme alignment: `knowledge` requires the `statecraft://project/<uuid>/knowledge/<uuid>` shape; `code-fingerprint` requires `xray-fingerprint://<sha256>`. Scheme mismatch or missing project segment is an error. |
| V-028 | error    | `provenance.ref` MUST be a syntactically well-formed URI matching its kind's scheme; the opaque body (UUID-pair for `knowledge`, hex digest for `code-fingerprint`) MUST be non-empty. |
| V-029 | advisory | `provenance:` entries with `role:` unset emit an info-level lint recommending `role: derivation` for searchability and consistent rendering. Not blocking.                    |

V-026's enum is closed: adding a new kind requires an amendment spec
that widens both the enum and V-027's scheme table. V-027's UUID
syntax check accepts the canonical UUID forms (8-4-4-4-12 hex,
case-insensitive) without requiring a particular canonical case.
V-028's hex check accepts the standard SHA-256 64-hex-character body.

The five codes are wired into spec-compiler's existing emission path
alongside V-021..V-024 (spec 154 Segment 2 / spec 155). A regression
test covering each violation case lands in the same commit, mirroring
the `spec154_unit_grammar_negative.rs` shape.

## 6. Indexer integration

This section is operationally critical (reconciliation #6 of the
design pass). Without it the grammar compiles but the indexer's
`resolved_units` field does not carry provenance through to
consumers, breaking the statecraft Requirements view's *"render the
provenance link"* path (INTENT §3.4 + §6.2 stage 6) and the structural
reverse-lookup substrate this spec exists to provide.

Surface to extend (already in spec 154's `extends.paths` and re-claimed
here):

### 6.1 `spec_scanner.rs::push_flat_units` — second arm

`tools/spec-spine/codebase-indexer/src/spec_scanner.rs::push_flat_units`
currently inspects `references:` entries for a `unit:` key. Spec 156
adds a second arm: when an item is a mapping with a `provenance:`
key, the function emits an entry whose internal shape carries the
provenance kind and ref. Type details (whether to widen `UnitEntry`
or introduce a parallel `ProvenanceEntry`) are an internal indexer
concern — the spec author's call at implementation time. Spec-level
contract:

- An entry with both `unit:` and `provenance:` MUST NOT be emitted
  (V-025 already errors at compile time; the indexer treats this
  case as no-op for defence-in-depth).
- An entry with neither key is dropped by the existing permissive
  parser (matches V-025's parse-time error in spec-compiler;
  spec-indexer stays the permissive layer per existing
  `parse_units` contract).
- The `source_field` discriminator stays `"references"` for both
  arms (the field is `references`; the *shape inside* differs).

### 6.2 `ResolvedUnit.kind` widening

`tools/spec-spine/codebase-indexer/src/types.rs::ResolvedUnit::kind`
currently documents the six spec 154 kinds. Spec 156 widens its
accepted values to:

```
crate | symbol | module | section | directory | file | knowledge | code-fingerprint
```

The widening is strictly additive: existing serialised indices that
emit only the six in-tree kinds remain valid; existing consumers
that switch on `kind` either route the two new values by name or
ignore them (no consumer today depends on the closed-set property of
the kind enum). The doc-comment block on `ResolvedUnit.source_field`
and `ResolvedUnit.ownership` retains its current wording — the
`references` field still carries `ownership: false`.

### 6.3 Resolver short-circuit on provenance kinds

The Segment 3 resolver (landed at PR #187, commit `482ac312`) walks
each `UnitEntry` and produces a `ResolvedUnit` with deterministic
`(file, span)` locations. Provenance kinds short-circuit that walk:

- Emit a `ResolvedUnit` with the declared `kind` (`knowledge` /
  `code-fingerprint`), `source_field: "references"`,
  `ownership: false`, and `locations: []`.
- **Empty `locations` by design, not by failure.** No diagnostic
  fires. The invariant matches the non-owning semantic from §4: the
  resolver records that the spec carries the provenance edge without
  claiming any in-tree location for it.

The dangling-provenance lax rule lives entirely in the resolver
short-circuit: there is no lookup against the statecraft DB or the
xray store, so there is no path by which a deleted knowledge object
or unreachable tree state can produce a diagnostic. (`I-008` /
`I-108` advisory bands governing in-tree file existence do not
apply.)

### 6.4 Codebase-index schema bump

`standards/schemas/spec-spine/codebase-index.schema.json`'s
`resolvedUnit.kind` enum widens to admit `knowledge` and
`code-fingerprint`. Strictly additive — existing 2.0.0 / 2.1.0
consumers see the new kinds, and either route them by name or ignore
them. The schema's invariant-freeze (spec 153) is undisturbed: no
field is added, removed, or retyped; the change is enum-widening
within an additive-evolution clause.

### 6.5 Registry schema additions

`standards/schemas/spec-spine/registry.schema.json` gains the
`provenance:` field shape on `references:` entries, exclusive with
`unit:`. The structural shape:

```jsonc
{
  "references": [
    {
      "role": "<string, open-vocabulary, optional>",
      "provenance": {
        "kind": "knowledge | code-fingerprint",
        "ref": "<URI string matching V-027>"
      }
    }
  ]
}
```

`oneOf` against `unit:` enforces V-025 at schema-validation time as
defence-in-depth alongside spec-compiler's V-025 emission.

## 7. Compliance

This section is non-skippable (reconciliation #4 of the design
pass). Provenance edges are load-bearing for two OWASP Agentic
Security Initiative 2026 controls, not as a passing mention but as
the structural substrate the corresponding postures depend on.

### 7.1 ASI06 — Memory & Context Poisoning

The intent doc §7.2 records the current OAP posture on ASI06 as
*"Strong, with forward gap on pre-write / pre-read sanitization
hooks."* Spec 156 closes the **structural reverse-lookup** half of
that gap.

When a knowledge item is later flagged as poisoned (operator
verdict, external CVE, automated sanitiser hit), the response
requires answering *"which artefacts derived from this poisoned
source?"* deterministically. With typed provenance:

```bash
git grep "statecraft://project/<project-uuid>/knowledge/<knowledge-uuid>" specs/
```

returns every spec carrying that derivation edge. The answer is
exact, LLM-free, and indexable — three properties the narrative-prose
status quo cannot offer.

The substrate property is what makes the URI scheme a contract, not
a convenience. A scheme-aligned reverse lookup is the operational
primitive the ASI06 sanitiser hook plugs into when it lands.

### 7.2 ASI09 — Human-Agent Trust

Intent doc §7.2 records an ASI09 gap on *"deterministic structural-
diff plan UI."* Spec 156 generalises the same anti-anthropomorphic-
trust posture spec 102 takes (verifier does not trust the producer),
applied one layer up: at **spec-authoring** time, not just at
run-time artefact certification.

The statecraft Requirements view (INTENT §3.4) gets a typed
provenance link to render — *"this spec was derived from knowledge
item X"* as a verifiable structural edge with a click-through to the
source, rather than an LLM-narrative summary the user must trust on
faith. The typed link's verifiability is its anti-trust posture: the
viewer can resolve the URI themselves and confirm the relationship.

A `references.provenance:` entry is the spec-authoring analogue of
spec 102's certificate: both are structural, deterministic, and
independently verifiable.

### 7.3 Coupling-gate disposition

Neither ASI06 nor ASI09 needs the coupling gate to fire on
provenance edges. The reverse-lookup property is a `git grep`
operation against authored markdown — entirely independent of the
gate. The non-owning semantic from §4 is therefore not in tension
with the compliance posture; it is the design choice that makes the
posture cheap.

## 8. Scope

### In scope (this spec)

- Grammar definition for the `provenance:` field (§3).
- The two initial kinds and their URI schemes (§3.3–§3.5).
- The five V-rules V-025..V-029 (§5).
- The codebase-indexer integration (§6): second arm in
  `push_flat_units`, `ResolvedUnit.kind` widening, resolver
  short-circuit, codebase-index schema bump, registry schema
  addition.
- The compliance coupling to ASI06 + ASI09 (§7).

### Implementation lands in the same PR (or a follow-up segment)

- Spec-compiler emission of V-025..V-029 in
  [`tools/spec-spine/spec-compiler/src/lib.rs`](../../tools/spec-spine/spec-compiler/src/lib.rs)
  + the V-code constants in
  [`tools/shared/spec-types/src/lib.rs`](../../tools/shared/spec-types/src/lib.rs).
- Indexer surface in
  [`tools/spec-spine/codebase-indexer/src/spec_scanner.rs`](../../tools/spec-spine/codebase-indexer/src/spec_scanner.rs)
  and `types.rs`, plus the resolver short-circuit.
- Schema edits to
  `standards/schemas/spec-spine/codebase-index.schema.json` and
  `standards/schemas/spec-spine/registry.schema.json`.
- Regression test mirroring `spec154_unit_grammar_negative.rs`
  (one assertion per V-rule).
- Codebase index regenerated; staleness gate green.

### Out of scope

- **Future provenance kinds.** sbom, cve, decision-record, adr,
  external-document — each lands as an amendment spec that widens
  V-026's enum and V-027's scheme table.
- **Emission contract.** Producing draft specs that carry these
  edges (the decomposition pipeline at INTENT §6.2 stage 6) is
  INTENT candidate 3, a separate spec. Spec 156 is grammar-only:
  authored specs may carry provenance today; automated emission of
  specs that carry it is a downstream spec.
- **Statecraft / xray reader surfaces.** The Requirements view's
  rendering of provenance links and the xray store's resolution of
  fingerprint URIs are downstream consumer concerns. Spec 156
  guarantees the substrate is queryable; consumers wire their own
  surfaces.
- **Factory-engine relocation.** INTENT §8.1 names an in-flight
  relocation of factory machinery into statecraft. Spec 156 is
  grammar-only and has no factory coupling (reconciliation #7).
- **Scoped `xray-fingerprint://...?path=<subtree>`.** Deferred per
  §3.5; YAGNI until a concrete case surfaces.

## 9. Acceptance

- This spec parses cleanly under the existing spec-compiler (no
  V-rule fires on its own frontmatter; the frontmatter uses only
  the spec 154 grammar plus the spec 155 references precedent).
- V-025..V-029 are emitted by spec-compiler with messages naming the
  precise violation; the regression test covers each case
  (mirroring `spec154_unit_grammar_negative.rs`).
- The codebase-indexer's `resolved_units` field carries provenance
  entries with `kind ∈ {knowledge, code-fingerprint}`,
  `ownership: false`, `locations: []`. A unit test asserts the
  short-circuit shape.
- The codebase-index schema (`codebase-index.schema.json`) validates
  indices that include the two new `resolvedUnit.kind` enum values;
  existing fixtures without provenance entries continue to validate.
- The registry schema (`registry.schema.json`) enforces V-025's
  `oneOf` exclusivity at schema-validation time.
- A worked example added to spec 154's references-edge documentation
  (or to this spec's §3.1) renders end-to-end:
  - The provenance URI is `git grep`-able.
  - The resolved unit is visible in `.derived/codebase-index/index.json`.
  - The coupling gate ignores the entry (unchanged behaviour).
- Codebase index regenerated; staleness gate green.
- INTENT doc §3.4 receives a one-sentence amendment cross-referencing
  this spec, closing the divergence flagged in reconciliation #1.
- The design-handoff doc
  ([`design-handoff.md`](./design-handoff.md)) is deleted in the
  same PR that lands this spec (it is ephemeral working state, not
  governance).
- The auto-memory entry `project_spec_156_design_alignment` is
  deleted in the same PR (the spec body absorbs every load-bearing
  fact).

## 10. Cross-references

- **Spec 102** — `governed-excellence`; FR-007 (auditor's verifier
  does not trust the producer) is the load-bearing argument behind
  the project-scoped knowledge URI in §3.4.
- **Spec 130** — `spec-coupling-primary-owner`; the relationship-
  graph baseline spec 154 extends and spec 156 extends transitively.
- **Spec 154** — `logical-unit-ownership-grammar`; introduces the
  `references:` edge spec 156 extends with a sibling provenance
  field. §4 (non-owning semantic) is inherited verbatim by §4 of
  this spec.
- **Spec 155** — `logical-unit-resolution-semantics`; cited as
  `role: precedent` for the style of typed-kinds-with-resolution-
  rules authoring. No functional dependency (the new kinds resolve
  against external systems, not spec 155's resolver machinery).
- **Spec 153** — `invariant-freeze-additive-evolution`; the schema
  bumps in §6.4 and §6.5 exercise spec 153's strictly-additive
  evolution clause on the invariant-frozen schemas.
- **INTENT doc** —
  [`docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md`](../../docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md);
  §3.4 (knowledge → requirements lineage), §6.2 stage 6 (LLM
  synthesis emission contract — INTENT candidate 3, downstream),
  §7.2 (ASI06 / ASI09 postures), §9 candidate 5 (the spec slot this
  work occupies).
- **Auto-memory:** `project_spec_156_design_alignment` — the
  design-handoff orientation memory; deleted when this spec lands.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical regeneration
of `crates/featuregraph/tests/golden/features_graph.json` reflecting
the `product/apps/desktop/*` → `product/apps/opc/*` path rename in
spec frontmatter. No semantic change to this spec's claims; fixture
content updated 1:1 with the rename per the atomicity contract
encoded by spec 177 (ci-orchestrator-pr-gate) — featuregraph-golden
is a required ci-gate check precisely so renames carry their fixture
refresh inside the rename PR.
