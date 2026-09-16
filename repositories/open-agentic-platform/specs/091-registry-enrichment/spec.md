---
id: "091-registry-enrichment"
title: "Spec Registry Enrichment"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that parsed and emitted the enriched fields (depends_on, owner, risk) was deleted; that logic is now in spec-spine-core. The spec-compiler edge is stripped (path deleted); the featuregraph reader edges survive.
kind: tooling
domain: tooling
risk: low
depends_on:
  - "039-feature-id-reconciliation"
summary: >
  Promote depends_on, owner, and risk from extra frontmatter to first-class spec
  compiler fields. Validate risk enum values. Update featuregraph to read enriched
  fields from the compiled registry, enabling downstream spec-driven gating.
code_aliases: ["REGISTRY_ENRICHMENT"]
# 217 deleted the in-tree spec-compiler; the enriched-field parse/emit (depends_on,
# owner, risk) is now in spec-spine-core. The spec-compiler/src/lib.rs edge is
# stripped (path deleted); the featuregraph reader edges survive. Amended by 217.
extends:
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/src/registry_source.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/src/scanner.rs }
---

# 091 — Spec Registry Enrichment

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

## Problem

The spec registry is the compiled truth, but it only carries `id`, `title`, `status`,
`created`, `summary`, `authors`, `kind`, `feature_branch`, and `code_aliases` as
first-class fields. Fields like `depends_on`, `owner`, and `risk` are either lost or
buried in `extraFrontmatter` where no consumer reads them.

Without enriched registry data, downstream consumers (featuregraph, policy-kernel,
preflight) cannot derive execution boundaries from specs.

## Implementation Slices

### 1. Promote depends_on to first-class compiler field (1 day)
- Add `depends_on` to `KNOWN_KEYS` in spec compiler
- Emit as `dependsOn: Vec<String>` in registry JSON features array
- Files: `tools/spec-spine/spec-compiler/src/lib.rs`

### 2. Promote owner to first-class compiler field (0.5 day)
- Add `owner` to `KNOWN_KEYS`
- Emit as `owner: Option<String>` in registry JSON
- Files: `tools/spec-spine/spec-compiler/src/lib.rs`

### 3. Add risk as a new frontmatter field (0.5 day)
- Define risk levels: `low`, `medium`, `high`, `critical`
- Add to `KNOWN_KEYS`, validate enum values, emit in registry
- Files: `tools/spec-spine/spec-compiler/src/lib.rs`

### 4. Featuregraph reads enriched fields (1 day)
- Update `RegistryFeatureRecord` to deserialize `dependsOn`, `owner`, `risk`
- Populate `FeatureNode.depends_on`, `.owner`, `.governance` from registry
- Files: `crates/featuregraph/src/registry_source.rs`, `crates/featuregraph/src/scanner.rs`

### 5. Recompile registry and validate (0.5 day)
- Run `spec-compiler compile` to regenerate `.derived/spec-registry/registry.json`
- Verify enriched fields appear for specs that use them (087, 089, etc.)
- Add `risk` frontmatter to 5+ specs as initial population

## Acceptance Criteria

- SC-091-1: `registry.json` features carry `dependsOn`, `owner`, `risk` when present in frontmatter
- SC-091-2: `featuregraph` loads dependency graph from registry (non-empty `depends_on` on 087)
- SC-091-3: Spec compiler rejects invalid `risk` values (not in `[low, medium, high, critical]`)

## Maintenance Notes

- _2026-05-05:_ `crates/featuregraph/tests/golden/features_graph.json` regenerated to reflect spec 119 lifecycle promotion (draft → approved/complete) and spec 087 NF-007 maintenance entry. The golden's `status` / `implementation` fields per feature are mechanical projections of the registry; refreshes that follow lifecycle flips on amender specs (here: spec 119 amends 087/092/094/099/000) are routine and do not require a content change to this spec — recording the maintenance event here is sufficient.
- _2026-05-07:_ `crates/featuregraph/tests/golden/features_graph.json` regenerated again, this time absorbing accumulated drift from prior PRs (specs 117 and 118 status `draft → approved` + `implementation pending → complete`; spec 136 status `draft → approved`; specs 141 and 142 added). Triggered by the pre-disclosure hardening pass that added `compliance:` frontmatter to specs 047/067/068/069/116/121 — that pass surfaced the stale golden because it was the first `make ci` run on this branch since the upstream PRs landed. Same routine-maintenance disposition as the 2026-05-05 entry: `FeatureEntry` does not carry a `compliance` field, so the compliance edits themselves do not change the graph; the diff is solely the pre-existing lifecycle/membership drift.
- _2026-05-26:_ `crates/featuregraph/tests/golden/features_graph.json` regenerated to reflect spec 182 lifecycle promotion (`draft → approved` + `implementation pending → complete`) in the spec-182 claude-skills-migration PR. Specs 071 and 101 are also amended in the same PR (reciprocal `amended:` + `amendment_record:` entries for spec 182's `amends:` claim); their frontmatter changes don't enter `FeatureEntry` directly, so the graph diff is solely the spec 182 status flip. Same routine-maintenance disposition as the prior entries — the golden is a mechanical projection of the registry's lifecycle fields and refreshes following amender lifecycle flips do not require content changes to the named authority specs (034, 154, 156, 161, 167, 168, 169). PR carries `Spec-Drift-Waiver:` for the coupling gate.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 000-spec-system | Spec compiler foundation |
| 001-spec-frontmatter | Frontmatter schema |
| 034-featuregraph-registry-scanner-fix | Feature graph scanning |
| 039-spec-compiler-known-keys | KNOWN_KEYS system |
