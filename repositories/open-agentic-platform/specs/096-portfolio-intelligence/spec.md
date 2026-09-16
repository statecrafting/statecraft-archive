---
id: "096-portfolio-intelligence"
title: "Portfolio Intelligence — xray-featuregraph Bridge"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
kind: platform
domain: tooling
risk: medium
depends_on:
  - "091-registry-enrichment"
  - "093-spec-driven-preflight"
summary: >
  Bridge xray structural metrics and featuregraph feature attribution into a
  unified portfolio intelligence layer. Enables blast radius analysis, governance
  drift detection from desktop, and enriched feature views with complexity and
  test coverage data.
code_aliases: ["PORTFOLIO_INTELLIGENCE"]
establishes:
  - unit: { kind: file, path: crates/featuregraph/src/enrichment.rs }
extends:
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/src/preflight.rs }
  - spec: "083-xray-ui-upgrade"
    nature: additive
    unit: { kind: crate, id: xray }
---

# 096 — Portfolio Intelligence

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

## Problem

Two powerful analysis systems exist in isolation:

| System | Location | Produces | Feature Awareness |
|--------|----------|----------|-------------------|
| xray | `crates/xray/` | `XrayIndex` with `FileNode { path, size, loc, complexity, functions, max_depth }` | None |
| featuregraph | `crates/featuregraph/` | `FeatureGraph` with `FeatureNode { feature_id, impl_files, test_files, depends_on }` | Full |

Specific gaps:

- `xray` produces per-file structural metrics but has **no feature attribution** — it cannot
  answer "how complex is feature X?"
- `featuregraph` produces feature-to-file mapping but carries **no structural metrics** — it
  cannot answer "what is the LOC at risk for this change?"
- `governance_drift()` exists as a library method on `FeatureGraphTools` but is **not wired**
  as a Tauri command — desktop cannot surface drift without CLI
- Desktop exposes `xray_scan_project` and `featuregraph_overview` as independent endpoints
  with no cross-reference
- `PreflightChecker` classifies change tiers but does not compute blast radius (downstream
  dependency fan-out or aggregate complexity)
- No portfolio-level view exists that combines feature health (status, risk, dependencies)
  with structural metrics (LOC, complexity, test ratio)

## Solution

Create an enrichment module in featuregraph that joins xray file metrics with feature
attribution. Add blast radius analysis that leverages both the dependency graph and xray
metrics. Wire `governance_drift` to the desktop. The result is a portfolio intelligence
layer that turns two silos into unified engineering visibility.

## Implementation Slices

### Slice 1: xray-featuregraph bridge (`enrichment.rs`)

New module `crates/featuregraph/src/enrichment.rs` with:

```rust
pub struct EnrichedFeature {
    pub feature_id: String,
    pub title: String,
    pub status: String,
    pub risk: String,
    pub owner: String,
    pub spec_path: String,
    pub depends_on: Vec<String>,
    pub impl_file_count: usize,
    pub test_file_count: usize,
    pub total_loc: u64,
    pub max_complexity: u64,
    pub avg_complexity: f64,
    pub total_functions: u32,
    pub test_loc: u64,
    pub test_coverage_ratio: f64,  // test_loc / (impl_loc + test_loc)
}
```

Function: `enrich_features_with_metrics(graph: &FeatureGraph, index: &XrayIndex) -> Vec<EnrichedFeature>`

Build a `HashMap<&str, &FileNode>` from the xray index keyed by path. For each
`FeatureNode`, walk its `impl_files` and `test_files`, accumulating LOC, complexity,
and function counts from matching `FileNode` entries.

Add `xray` as a dependency to `featuregraph/Cargo.toml`.

**Files**: `crates/featuregraph/Cargo.toml`, new `crates/featuregraph/src/enrichment.rs`,
`crates/featuregraph/src/lib.rs`

### Slice 2: Blast radius analysis

Extend `crates/featuregraph/src/preflight.rs` with:

```rust
pub struct BlastRadius {
    pub affected_features: Vec<String>,
    pub downstream_features: Vec<String>,
    pub total_loc_at_risk: u64,
    pub max_complexity_at_risk: u64,
    pub affected_file_count: usize,
    pub dependency_depth: usize,
}
```

Function: `compute_blast_radius(graph: &FeatureGraph, index: &XrayIndex, changed_paths: &[String]) -> BlastRadius`

Algorithm:
1. Map changed paths to affected features (existing logic in `check_dependency_satisfaction`)
2. Walk `depends_on` graph in reverse (find all features that transitively depend on affected ones)
3. Accumulate LOC and complexity from xray index for all files owned by affected + downstream features
4. Track maximum dependency depth reached

**Files**: `crates/featuregraph/src/preflight.rs`

### Slice 3: Wire `governance_drift` as Tauri command

Add `governance_drift` to `product/apps/opc/src-tauri/src/commands/analysis.rs`:

```rust
#[command]
pub async fn governance_drift(repo_root: String) -> Result<serde_json::Value, String> {
    let root = resolve_repo_root(&repo_root);
    let fg_tools = FeatureGraphTools::new();
    fg_tools.governance_drift(&root).map_err(|e| e.to_string())
}
```

Register in `lib.rs` invoke_handler alongside existing analysis commands.

**Files**: `product/apps/opc/src-tauri/src/commands/analysis.rs`,
`product/apps/opc/src-tauri/src/lib.rs`

### Slice 4: Enriched preflight with blast radius

Extend the existing `governance_preflight` Tauri command to include blast radius data
when xray index is available. After computing the preflight response, run
`compute_blast_radius` and merge the result.

**Files**: `product/apps/opc/src-tauri/src/commands/analysis.rs`

## Acceptance Criteria

- **SC-096-1**: `EnrichedFeature` records carry xray metrics (LOC, complexity, functions) alongside feature attribution
- **SC-096-2**: Blast radius analysis returns affected features + downstream dependency fan-out with aggregate complexity
- **SC-096-3**: `governance_drift` is callable from desktop as a Tauri command
- **SC-096-4**: `governance_preflight` returns blast radius data when xray scan is available
