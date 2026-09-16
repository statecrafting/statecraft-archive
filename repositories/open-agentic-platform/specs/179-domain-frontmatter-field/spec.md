---
id: "179-domain-frontmatter-field"
slug: domain-frontmatter-field
title: "Domain frontmatter field — tract authority lens over the unified spec spine"
status: approved
implementation: complete
owner: bart
created: "2026-05-24"
approved: "2026-05-24"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler and registry-consumer that implemented the domain-field parse (V-030) and the --domain filter were deleted; those moved to spec-spine-core. The spec-compiler and registry-consumer test units are stripped (paths deleted); the surviving spec-lint V-031 presence test is retained.
kind: amendment
shape: mechanism-add
risk: low
domain: substrate
amends: ["000-bootstrap-spec-system"]
amends_sections: []
depends_on:
  - "000-bootstrap-spec-system"  # frontmatter contract being amended
  - "001-spec-compiler-mvp"  # spec-compiler (parser + V-030 emission)
  - "002-registry-consumer-mvp"  # registry-consumer (--domain filter)
  - "006-conformance-lint-mvp"  # spec-lint (V-031 emission)
  - "147-spec-kind-grammar"  # precedent — sibling amendment of 000's frontmatter grammar
code_aliases: ["DOMAIN_FIELD"]
# 217 deleted the in-tree spec-compiler + registry-consumer; the domain-field parse
# (V-030) and the --domain filter moved to spec-spine-core / `spec-spine registry list
# --domain`. The spec-compiler + registry-consumer test units are stripped (paths
# deleted); the surviving spec-lint V-031 presence test is retained. Amended by 217.
establishes:
  - unit: { kind: file, path: tools/spec-spine/spec-lint/tests/spec179_domain_presence.rs }
extends:
  - spec: "147-spec-kind-grammar"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/src/lib.rs }
  - spec: "132-constitutional-invariant-freeze"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
references:
  - role: precedent
    unit: { kind: file, path: specs/147-spec-kind-grammar/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/156-references-edge-provenance-grammar/spec.md }
summary: >
  Adds a `domain:` frontmatter field to the universal spec grammar. The field
  is a single closed-enum string (`opc | platform | substrate | tooling`)
  declaring which tract owns a spec's authority. Strictly a *lens*, not a
  partition — the corpus stays one unified spine; `domain:` enables scoped
  enforcement rules and scoped consumer queries (e.g. "specs with
  `domain: opc` and `kind: invariant-freeze` declaring a perf budget must
  reference a bench file") that the unified-but-unindexed corpus cannot
  express. Required on new specs (V-031, warning until backfill is
  promoted); backfilled across the 179-spec corpus in the same PR. The
  spec-compiler parses `domain:` and emits V-030 on invalid enum values;
  registry-consumer exposes a `--domain <value>` filter on `list` /
  `status-report` and surfaces `domain:` in `show`; spec-lint emits V-031
  at warning severity when the field is absent. Composes with spec 147 as
  the sibling field-grammar amendment of spec 000; future amendments may
  widen the enum.
---

# 179 — Domain frontmatter field

## 1. Concern

The unified spec spine carries 179 specs spanning four tracts: the OPC
desktop cockpit, the platform control plane, the substrate (the spec
spine itself plus governance), and tooling (CLIs and lints). Every spec
is queryable through `registry-consumer`, but "give me the OPC tract"
or "give me the platform tract" is not a question the consumer can
answer today. Cross-cutting enforcement rules of the form *"specs with
`kind: invariant-freeze` and `domain: opc` declaring a perf budget must
reference a bench file"* cannot be written because the predicate
`domain: opc` does not exist.

This amendment closes that gap. It adds one universal frontmatter
field — `domain:` — drawn from a closed enum at this version. The
field is a **lens** over the unified corpus, not a partition: every
spec remains in `registry.json`, every spec remains discoverable by
every existing query; the new field gates new queries and unlocks
scoped enforcement composition.

## 2. Constitutional positioning

Amendment of spec 000's frontmatter grammar, sibling to spec 147 (kind
grammar). Option-(a) eligibility per spec 000 §238–243 holds:

- **Frozen anchor list unchanged.** None of the V-001..V-010,
  markdown-truth-boundary, json-truth-boundary, determinism-requirement,
  or directory-name-equals-id anchors is modified. `amends_sections:
  []`.
- **Required-keys set unchanged.** `domain:` is OPTIONAL at the
  frontmatter-grammar layer (V-002 required-keys set is not enlarged).
  Spec-lint emits V-031 at warning severity when absent, mirroring
  spec 147's Phase-1 posture for V-012; promotion to error severity
  is deferred to a follow-on amendment after the corpus-wide backfill
  has stabilised.
- **V-code allocation.** Two new V-codes (V-030 + V-031) occupy the
  next free slots after spec 156's V-029. The reserved range
  V-006..V-010 is untouched.
- **`extraFrontmatter` cap preserved.** `domain` enters `KNOWN_KEYS`
  in `tools/shared/spec-types/src/lib.rs` as an explicitly-documented
  extension per spec 000 spec.md:85, identical to spec 147's pattern.
  The 8-key cap on `extraFrontmatter` is unchanged.

## 3. Grammar

### 3.1 Shape

```yaml
domain: opc
```

A single string drawn from a closed enum. Mutually exclusive with
list-shaped values (no `domain: [opc, platform]`); multi-valued
classification is explicitly deferred (see §7 Out of scope).

### 3.2 Initial enum values

| Value       | Tract |
|-------------|-------|
| `opc`       | OPC desktop cockpit: `product/apps/opc/`, `product/packages/` (the cockpit's npm packages), and Tauri-side IPC commands. |
| `platform`  | Platform services tract: `platform/services/statecraft/`, `platform/services/deployd-api-rs/`, `platform/services/tenant-hello/`, identity (Rauthy chart), `platform/infra/`, `platform/charts/`, `platform/k8s/`. |
| `substrate` | Spec spine itself: the bootstrap (spec 000), the relationship-graph mechanisms (130, 132, 133, 147, 152, 153, 154, 155, 156, 179), the constitutional invariants (131), the init protocol (103), and governance specs. |
| `tooling`   | CLIs and lints under `tools/`: spec-compiler, registry-consumer, codebase-indexer, spec-lint, the OAP overlay binaries (`tools/oap/`), and shell lints (`tools/lint/`). |

The enum is closed at this version. Future amendments may widen it;
adding a value requires an explicit amendment of this spec (the
companion amendment also widens V-030's accepted set).

### 3.3 Required vs optional

- **Required on new specs** — V-031 fires at warning severity when a
  spec's frontmatter omits `domain:`. This matches spec 147's Phase-1
  stance on V-012 prior to its Phase-2 promotion to error.
- **Backfilled across the existing corpus** — every spec present at
  spec 179's authorship time receives a `domain:` value via the
  classification pass described in §6.
- **Promotion to error severity** is OUT OF SCOPE here (§7). After
  the backfill ships and the warning-tier corpus is empirically
  clean, a follow-on amendment promotes V-031 to error.

## 4. Semantics

`domain:` declares which tract owns a spec's authority. It is a
classification edge, not an ownership edge:

- **It does NOT partition the registry.** Every spec stays in
  `registry.json`; every existing consumer query still scans the
  whole corpus. `--domain <value>` narrows; it does not federate.
- **It enables scoped enforcement.** Cross-cutting rules of the form
  "for specs with `domain: <value>` and `<predicate>`, require
  `<additional-condition>`" become expressible. This composability
  is the primary motivating use case.
- **It enables scoped queries.** `registry-consumer list --domain opc`
  enumerates the OPC tract; `status-report --domain platform`
  surfaces lifecycle counts for the platform tract; `show` surfaces
  the field on individual specs.

The field is **single-valued by design**. Specs that span tracts
(canonical example: spec 124 `opc-factory-run-platform-integration`,
which touches both OPC and platform) pick the **primary** tract —
usually the side that *initiates* the cross-tract interaction or
that owns the dominant surface. Multi-valued classification opens a
boundary-policing can of worms that this amendment explicitly defers.

## 5. Tooling expectations

Each becomes a separately tested FR. The relevant files are claimed
in this spec's `extends:` block.

- **FR-001 — spec-compiler parses and validates `domain:`.**
  `tools/spec-spine/spec-compiler/src/lib.rs` parses `domain:` from
  frontmatter, validates the value against the closed enum, and
  emits **V-030** when the value is not in the enum. Severity:
  error. `domain` is added to `KNOWN_KEYS` in
  `tools/shared/spec-types/src/lib.rs`.

- **FR-002 — spec-compiler emits `domain:` in `registry.json`.** The
  `FeatureRecord` carries `domain: <string>` (omitted when absent so
  the field tolerates the slow corpus migration). The
  `registry.schema.json` declaration is added per §6 schema bump.

- **FR-003 — registry-consumer surfaces `--domain` filter.**
  `tools/spec-spine/registry-consumer/src/lib.rs` /
  `tools/spec-spine/registry-consumer/src/main.rs` add `--domain
  <value>` to `list`, `list --ids-only`, `list --json`, and
  `status-report --json --nonzero-only`. The flag accepts any of
  the four enum values; invalid values exit non-zero with a clear
  error mentioning the closed enum.

- **FR-004 — registry-consumer `show` surfaces `domain:`.** The
  human-readable `show` output and the `show --json` form include
  `domain:` when present. Maintains contract guarantees from specs
  013/014.

- **FR-005 — spec-lint emits V-031 when `domain:` is absent.**
  `tools/spec-spine/spec-lint/src/lib.rs` emits V-031 at warning
  severity when a spec's frontmatter does not declare `domain:`.
  Composes with spec 128's `--fail-on-warn` posture (which is
  default). Promotion to error severity is deferred per §3.3.

- **FR-006 — V-030 also fires from spec-lint at error severity** so
  the lint pass catches invalid enum values when the spec-compiler
  is not the gating tool (e.g. when a contributor runs `spec-lint`
  in isolation). This mirrors V-020's dual-emission pattern (spec
  130).

## 6. Implementation map

The same PR carries:

- **Spec authoring + backfill.** This spec.md plus `domain:`
  additions to all 179 existing spec.md files (the 179th being this
  spec itself, self-applied as `domain: substrate`).
- **Tooling extensions.** `tools/shared/spec-types/src/lib.rs`
  (KNOWN_KEYS + `Domain` enum + V-030 / V-031 constants);
  `tools/spec-spine/spec-compiler/src/lib.rs` (parser + V-030
  emission + registry serialization); `tools/spec-spine/registry-consumer/src/{lib,main}.rs`
  (`--domain` filter + `show` surface); `tools/spec-spine/spec-lint/src/lib.rs`
  (V-031 emission).
- **Registry schema bump.** `standards/schemas/spec-spine/registry.schema.json`
  gains `domain: { type: string, enum: [opc, platform, substrate, tooling] }`
  on `FeatureRecord`. Strictly additive evolution per spec 153 on
  spec 132's invariant-frozen schema; no existing field changes.
- **CI integration.** Spec 177 collapsed the PR-gate workflow fleet
  behind a single `ci-gate`. V-030 and V-031 emission flows through
  the existing `spec-conformance` and `ci-spec-code-coupling` jobs
  (compile-time emission and lint-pass emission respectively); no
  new top-level workflow file is introduced. Composition with
  spec 177's orchestrator architecture is the explicit constraint
  — a parallel gate would be the wrong shape.
- **Derived artifact refresh.** `.derived/codebase-index/index.json`
  regenerates via `make pr-prep` after the spec.md edits land.
  `.derived/spec-registry/registry.json` regenerates via
  `make registry`. Both are committed in the same PR.

The eight registered classification heuristics from the
authorship brief — `opc` (cockpit + cockpit packages + Tauri IPC),
`platform` (services + identity + infra), `substrate` (spec spine
itself), `tooling` (CLIs + lints) — drive the corpus-wide backfill.

## 7. Out of scope

- **Promotion of V-031 to error severity.** Phase 1 (this spec) ships
  V-031 at warning severity. A separate follow-on amendment promotes
  after the backfilled corpus is empirically clean. Distinct from
  V-030, which ships at error severity immediately because the
  invariant is empty at landing (no specs declare invalid enum
  values).
- **Multi-valued `domain:` lists.** A future amendment may widen the
  shape from scalar string to list-of-strings if a cross-tract
  classification need surfaces. YAGNI: the current corpus carries
  zero specs that require multi-valued classification, and the
  primary-tract heuristic resolves the boundary cases identified in
  the authorship brief cleanly.
- **Enum extensions beyond the initial four.** Future tracts (e.g.
  `release` for release engineering, `compliance` for compliance-only
  specs) land via amendment of this spec, not via silent enum
  widening.
- **Federating the spine.** The constitutional one-spine principle
  holds. This field is a lens, not a partition.
- **Per-tract enforcement rules.** Composing predicates of the form
  "specs with `domain: opc` and `kind: invariant-freeze` declaring
  a perf budget must reference a bench file" is the *enabled* future
  work, not this spec. Each such rule lands as its own spec.

## 8. Acceptance criteria

- **AC-1.** `domain:` is parsed and validated by the spec-compiler;
  V-030 fires at error severity on a synthetic invalid value;
  V-030 does NOT fire on any of the four closed-enum values.
- **AC-2.** `domain:` appears in `registry.json` under
  `features[].domain` for every spec that declares it.
- **AC-3.** `registry-consumer list --domain opc --ids-only` returns
  exactly the specs the backfill classified into the OPC tract; the
  parallel forms (`platform`, `substrate`, `tooling`) behave
  symmetrically.
- **AC-4.** `registry-consumer show 179-domain-frontmatter-field`
  surfaces `domain: substrate` in its human-readable output and in
  `show --json`.
- **AC-5.** `spec-lint` emits V-031 at warning severity on a
  synthetic spec missing `domain:`; emits no V-031 against the
  backfilled corpus.
- **AC-6.** `make pr-prep` is clean on the consolidating PR.
- **AC-7.** `make ci` (the daily-loop posture per spec 135) is
  green on the consolidating PR.
- **AC-8.** Spec 000 receives `amended: "2026-05-24"` and
  `amendment_record: "179-domain-frontmatter-field"`; a sentence is
  appended to spec 000's `summary:` per the established 119/132/147
  narration pattern.

## 9. Cross-references

- **Spec 000** — `bootstrap-spec-system`; the frontmatter contract
  this amendment extends. Sibling amendment to spec 147 (kind
  grammar) and the chain of grammar-level amendments (119, 132,
  147, 159, 179).
- **Spec 147** — `spec-kind-grammar`; immediate precedent for the
  amendment shape (typed enum frontmatter field with corpus-wide
  backfill, dual emission across spec-compiler + spec-lint,
  staged severity promotion).
- **Spec 132** — `constitutional-invariant-freeze`; the registry
  schema lives under spec 132's invariant freeze; this amendment
  exercises spec 153's strictly-additive evolution clause to add
  the `domain` field declaration.
- **Spec 156** — `references-edge-provenance-grammar`; precedent
  for typed closed-enum frontmatter additions under V-code
  emission discipline.
- **Spec 177** — `ci-orchestrator-pr-gate`; the single-gate
  architecture V-030 and V-031 compose with. No new top-level
  workflow is introduced; emission flows through
  `spec-conformance` and `ci-spec-code-coupling` under
  `ci-gate`.
- **Spec 178** — `opc-directory-rename`; ran in the session prior
  to this one. The OPC tract's on-disk location settled there
  ahead of the OPC-tract classification work this spec enables.

## 10. Migration

Phase 1 (this spec, this PR):

1. Tooling support lands first commit (`feat(spec-spine): add domain
   frontmatter field + compiler/consumer/lint support`).
2. Corpus-wide backfill lands second commit (`chore(specs): backfill
   domain across 179-spec corpus`).
3. Derived artifacts (`.derived/codebase-index/index.json`,
   `.derived/spec-registry/registry.json`) refresh in the third
   commit.

Phase 2 (follow-on amendment, separate PR after soak):

- Promotion of V-031 from warning to error severity, conditional on
  zero warning-tier firings against the backfilled corpus and at
  least one new spec authored under the field's discipline.
