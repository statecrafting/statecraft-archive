# Segment 3 Design: Codebase-Indexer Logical-Unit Resolver

**Governing spec:** [`spec.md`](spec.md) (spec `154-logical-unit-ownership-grammar`)
**Segment boundary:** Segment 2 landed in PR #183 (`2b1fe8a3`). This document designs Segment 3 (resolver) only. Segments 4 (gate refactor), 5 (corpus migration), and 6 (legacy excision) are downstream consumers; this document names their seams but does not design them.
**Status:** Approved — OQ-1..OQ-4 closed by [spec 155](../155-logical-unit-resolution-semantics/spec.md) 2026-05-21; OQ-5 and OQ-6 closed by mechanical verification (see §11); OQ-7 resolved as a design-doc decision (see §4.3).

---

## §1 Scope

### In scope

- A new `resolver` module inside `tools/spec-spine/codebase-indexer/src/` that accepts a `LogicalUnit` (from `tools/shared/spec-types/src/lib.rs:311`) and returns a typed `Vec<ResolvedLocation>`.
- Per-kind resolution logic for all six kinds: `crate:`, `symbol:`, `module:`, `section:`, `directory:`, `file:`.
- An `AnchorParser` trait and four initial dispatch implementations covering the file types mandated by spec 154 §3.4 + spec 152 §2.1.
- Integration of the resolved graph into `tools/spec-spine/codebase-indexer/src/types.rs` as an additive field on `TraceMapping`.
- A symbol/module index built from tree-sitter-parsed source (owned inside the indexer, not via the `xray` crate — see §5 for the decision and justification).
- Determinism hardening to meet spec 101 SC-01 and spec 000 SC-002.
- Unit, integration, and determinism tests; a `cargo bench` criterion target.

### Out of scope

- Segment 4: the gate refactor that consumes `resolved_units` instead of the flat `implementing_paths` list. The resolver's public API must be shaped to make that consumption straightforward (see §10), but the gate code itself is not touched.
- Segment 5: corpus migration from path-strings to unit-typed declarations.
- Segment 6: legacy excision.
- `references:` units in the resolved graph are resolved identically to ownership units; the coupling gate ignores them. The resolver itself makes no distinction.

---

## §2 Resolver Return Type and Span Shape

### Chosen span representation

```rust
/// A single resolved physical location for a logical unit.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLocation {
    /// Workspace-relative file path (POSIX separators).
    pub file: String,
    /// Optional span within the file.  `None` means "whole file".
    pub span: Option<LineSpan>,
}

/// Inclusive 1-indexed line range.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineSpan {
    pub start_line: u32,
    pub end_line: u32,
}
```

The full resolver signature:

```rust
pub fn resolve(
    unit: &LogicalUnit,
    ctx: &ResolverContext,
) -> Result<Vec<ResolvedLocation>, ResolveError>
```

`ResolverContext` carries the repo root, the workspace-member index (for `crate:`), and the symbol/module index (for `symbol:` / `module:`). It is built once per indexer run and passed by reference to all unit resolutions.

### Why 1-indexed inclusive line ranges rather than byte ranges or AST-node refs

**Segment 4 coupling gate (spec 133 §6, spec 154 §6 step 1).** The gate's reverse-resolution step must answer: "a diff hunk touching file F at lines L1–L2, which logical units does it overlap?" Diff hunks from `git diff -U0` are expressed as 1-indexed line ranges (`@@ -a,b +c,d @@`). A line-range `ResolvedLocation` makes the overlap check a simple `max(start, hunk_start) <= min(end, hunk_end)` — no byte-offset conversion required, no tree-sitter dependency in the gate.

**`registry-consumer` unit-resolution query (spec 130 §7, spec 133 §6).** The `registry-consumer` API described in spec 133 §6 (`authorities(path)`, `authorities_in_section`) operates over file paths, not byte offsets. A `(file, line-range)` pair is the natural output to surface to human consumers via `registry-consumer show`.

**`xray` call-graph output.** The `xray` call-graph (`crates/xray/src/analysis/call_graph/mod.rs:71–78`) tracks function locations by key string (`<file>::<function>`), not line numbers; `xray` does not produce spans at all in its public types. There is no existing byte-range API to be compatible with.

**AST-node refs would leak a tree-sitter dependency into the schema** and force the gate to carry a tree-sitter parser to consume resolved output. Symbolic anchors (`section-name`, `target-group`) are not stable across file edits. Byte ranges break whenever any preceding line has different byte widths.

**Whole-file units (`crate:`, `directory:`, `file:` where no span applies)** emit `span: None`, meaning "whole file." The gate's line-range overlap check treats `span: None` as `[1, ∞]`.

---

## §3 Determinism Contract

Spec 000 SC-002 declares that two compiler runs on the same repo state must produce byte-identical `registry.json`. Spec 101 SC-01 extends the same invariant to `index.json`. The resolver is part of `index.json` output and therefore inherits this obligation.

### Sort contract for `Vec<ResolvedLocation>`

For a given `LogicalUnit`, the resolver MUST return locations sorted by the derived `Ord` of `ResolvedLocation`, which is:

1. Primary key: `file` (lexicographic, POSIX path, UTF-8).
2. Secondary key: `span` — `None` sorts before `Some`; within `Some`, sort by `start_line` ascending, then `end_line` ascending.

This is enforced by `#[derive(PartialOrd, Ord)]` on both `ResolvedLocation` and `LineSpan`, followed by a `result.sort()` call before returning. No caller-site sort is required; the sort is invariant at the function boundary.

### Source of nondeterminism to guard against

- `walkdir` traversal: the existing indexer already sorts `entries` before processing (`tools/spec-spine/codebase-indexer/src/spec_scanner.rs:63`). The resolver must apply the same pattern to any directory glob expansion.
- HashMap iteration: the symbol/module index is a `BTreeMap<String, Vec<ResolvedLocation>>` so iteration order is deterministic.
- `BTreeSet` for glob expansion dedup (same pattern as `xref.rs:8`).

### Constitutional anchor

Spec 000 §determinism-requirement states: "The compiler MUST produce byte-identical `registry.json` when run repeatedly." Spec 101 SC-01 repeats this for `index.json`. The resolver's sort contract satisfies both by making `resolved_units` deterministic before it is serialized into the index.

---

## §4 Per-Kind Resolver Design

### 4.1 `crate:`

**Input:** `LogicalUnit::Crate { id }` where `id` is a workspace member name.

**Resolution:** Expand to all files under the workspace member's directory path, applying the §3.7 exclusion set (`target/**`, `node_modules/**`, `.derived/**`, `dist/**`, `build/**`, `.next/**`). The member path is obtained from the workspace-member index (read from the root `Cargo.toml` during `ResolverContext` construction). Each matched file emits `ResolvedLocation { file, span: None }`.

**Unresolvable:** `id` not present in the workspace-member index. This is a **hard error** (`ResolveError::UnknownCrate`). Spec 154 §3.1 states "Missing crate is a hard error" explicitly.

**Context construction cost:** workspace-member index is `O(W)` for `W` members, built once per indexer run.

### 4.2 `symbol:`

**Input:** `LogicalUnit::Symbol { id }` where `id` is a fully-qualified Rust path (e.g. `canonical_json::canonicalize_value`).

**Resolution:** Look up `id` in the symbol index (a `BTreeMap<String, Vec<ResolvedLocation>>` built by the indexer's tree-sitter pass over `*.rs` files). Returns `(file, LineSpan { start_line, end_line })` for each definition site. In Rust, a given fully-qualified path should have exactly one definition; the resolver returns a `Vec` to cover trait-impl sites (e.g. `impl Foo for Bar { fn method() }` where the method's qualified path includes the impl).

**Unresolvable:** `id` not found in the symbol index. **Hard error** per spec 154 §3.2: "Missing symbol is a hard error."

**Generics (OQ-1 closure).** Spec 154 §3.2 (as amended by [spec 155 §2.1](../155-logical-unit-resolution-semantics/spec.md)) clarifies that `id` carries the Rust item path only, not type expressions. The symbol index keys bare paths. `id` values containing `<` or `>` are rejected by V-024 at parse time, eliminating the surface-syntax collision risk.

### 4.3 `module:`

**Input:** `LogicalUnit::Module { id }` where `id` is a Rust module path (e.g. `canonical_json::tests`).

**Resolution:** Look up `id` in the module index (a `BTreeMap<String, ResolvedLocation>` built during the indexer's manifest+source pass). Resolution rules:

- For file-modules (`canonical_json::tests` where `tests.rs` or `tests/mod.rs` exists): the resolved location is `ResolvedLocation { file: "crates/canonical-json/src/tests.rs", span: None }` (whole-file ownership).
- For inline modules (`mod tests { ... }` inside a parent file): the resolved location is `ResolvedLocation { file, span: Some(LineSpan { start_line, end_line }) }` covering the module's `{ }` block.

**Unresolvable:** `id` not found in the module index. **Hard error** per [spec 155 §2.2](../155-logical-unit-resolution-semantics/spec.md) which amended spec 154 §3.3 to close the silence and mirror §3.1 / §3.2.

**Inline-module span boundary (OQ-7 closure).** For inline modules (`mod foo { ... }` inside a parent file), the resolved span includes the `mod foo {` declaration line itself. The `foo` identifier is part of the module's identity; excluding the declaration line would mean renaming `mod foo` to `mod bar` does not trigger the coupling gate, contradicting the symbol/module-identity model. Spec 154 §3.3 is silent on span boundaries because the boundary is a resolver implementation concern, not a grammar concern; spec 155 §2.2 explicitly punts this to the design doc.

### 4.4 `section:`

**Input:** `LogicalUnit::Section { file, anchor }`.

**Resolution:** Dispatch to the per-file-kind anchor parser (§6) keyed on the file's extension. The parser returns `LineSpan { start_line, end_line }` for the named anchor within the file, yielding `ResolvedLocation { file, span: Some(...) }`.

**Unresolvable:** Anchor not found in the file. **Hard error** per spec 154 §3.4 explicitly: "Missing anchor is a hard error."

**Unresolvable variant:** File itself does not exist. **Hard error** (consistent with `file:` kind semantics; see §4.6).

### 4.5 `directory:`

**Input:** `LogicalUnit::Directory { path }`.

**Resolution:** Expand `<path>/**` with the §3.7 exclusion set. Each matched file emits `ResolvedLocation { file, span: None }`.

**Unresolvable:** The directory path does not exist in the worktree. **Hard error** per [spec 155 §2.3](../155-logical-unit-resolution-semantics/spec.md) which amended spec 154 §3.5 to close the silence and mirror §3.1 / §3.6.

### 4.6 `file:`

**Input:** `LogicalUnit::File { path }`.

**Resolution:** Literal worktree path check. Emits `ResolvedLocation { file: path, span: None }`.

**Unresolvable:** File does not exist AND no git rename trace covers it. **Hard error** per spec 154 §3.6 (as amended by [spec 155 §2.4](../155-logical-unit-resolution-semantics/spec.md)): the resolver runs in the compile context with no diff available, so rename-trace evaluation does not apply. Rename-trace following is a property of the Segment 4 gate's diff-walk, which will augment `ResolverContext` with an optional rename map; the resolver itself remains a pure function of worktree state.

---

## §5 xray Integration Boundary

### Decision: option (b) — resolver builds its own in-indexer symbol/module pass

**Option (a): Rust library (intra-process).** `xray`'s `analysis-structure` feature (behind a Cargo feature flag, `crates/xray/Cargo.toml:37`) uses tree-sitter to analyze files, but its public output type (`StructureMetrics` at `crates/xray/src/analysis/structure/mod.rs:15`) extracts `functions: u32` and `max_depth: u32` — aggregate counts, not symbol names, qualified paths, or line numbers. The `call_graph` module (`crates/xray/src/analysis/call_graph/mod.rs:44`) produces `Block.function_name: Option<String>` (local name, not qualified path) and `CallStackNode.file_path: String` with no line span. There is no API in xray today that returns `(qualified_rust_path → (file, line_range))`. Adding that API to xray would require a spec amendment to xray's governing spec (032) and a new xray feature gate. The coupling between the indexer and xray as a library would also tighten the Cargo dependency graph: `codebase-indexer/Cargo.toml` currently has no dependency on `xray` (`tools/spec-spine/codebase-indexer/Cargo.toml:17–27`), and the `xray` crate requires a C build step (`cc` build dependency, `tree-sitter` FFI, `build.rs`).

**Option (c): subprocess.** Fragile, requires a built binary at a known path, adds retry/error-handling complexity, and provides no speed benefit over option (b) since the same tree-sitter pass would happen anyway.

**Option (b): in-indexer pass.** The indexer already depends on `open_agentic_spec_types` and `serde_json`; adding `tree-sitter` as a direct dependency is clean and avoids the `xray` coupling. The symbol extraction required for the resolver is narrower than what xray does: we need qualified Rust path → `(file, line_range)`, not complexity scores. A purpose-built `SymbolIndex` struct can be built cheaply in O(source-files) with a single tree-sitter pass during the `compile` subcommand. The resulting index is cached in `ResolverContext` for the lifetime of one `compile` run.

**Build-order:** `xray` has no dependency on the indexer and the indexer has no dependency on `xray`. Option (b) preserves this independence. The only new Cargo dependency the indexer needs is `tree-sitter` plus the `tree-sitter-rust` grammar (already vendored at `tools/vendor/` per CLAUDE.md).

**Re-resolution cost:** Symbol/module index is built once per `compile` run; all unit resolutions within a run share the same `ResolverContext`. A warm re-run rebuilds from source only for files whose content hash changed (future optimization; MVP does a full pass).

**Verdict:** Option (b). A new `symbol_index` module inside `tools/spec-spine/codebase-indexer/src/` that runs a single tree-sitter pass over `*.rs` files and emits a `BTreeMap<String, Vec<ResolvedLocation>>` keyed by qualified path.

---

## §6 Anchor-Parser Dispatch

### Trait

```rust
/// Extracts a named anchor's line span from a file's content.
/// Each `AnchorParser` implementation handles one file kind.
pub trait AnchorParser: Send + Sync {
    /// Returns `Some(LineSpan)` if `anchor` is found, `None` if not present.
    fn find_anchor(&self, content: &str, anchor: &str) -> Option<LineSpan>;
}
```

### Dispatch table

```rust
/// Built once during `ResolverContext` construction.
pub type AnchorParserRegistry = HashMap<&'static str, Box<dyn AnchorParser>>;

fn default_anchor_parsers() -> AnchorParserRegistry {
    let mut m: AnchorParserRegistry = HashMap::new();
    m.insert("",         Box::new(MakefileAnchorParser));   // no extension → Makefile
    m.insert("yml",      Box::new(WorkflowYamlAnchorParser));
    m.insert("yaml",     Box::new(WorkflowYamlAnchorParser));
    m.insert("rs",       Box::new(RegionMarkerParser));
    m.insert("ts",       Box::new(RegionMarkerParser));
    m.insert("tsx",      Box::new(RegionMarkerParser));
    m.insert("js",       Box::new(RegionMarkerParser));
    m.insert("sh",       Box::new(RegionMarkerParser));
    m.insert("toml",     Box::new(RegionMarkerParser));
    m.insert("md",       Box::new(MarkdownHeadingParser));
    m
}
```

The dispatch key is the file extension (from `Path::extension()`), with the empty string used for `Makefile` (which has no extension). Files whose extension is not in the registry fall through to the `RegionMarkerParser` as a default, per spec 152 §2.1's "Other source files — same `// region:` convention."

### Implementations required in Segment 3

**`MakefileAnchorParser` — spec 152 §2.1 + spec 154 §3.4.**
Anchor syntax: `## tag: <name>` comment. A section starts at the line after the `## tag: <name>` comment and ends at the line before the next `## tag:` comment (or EOF). Returns `LineSpan` inclusive of the tag comment line itself (the tag line is part of the governed section for diff-matching purposes — consistent with spec 152 §2.2: "H falls within section S if H's line numbers are between the `## tag: S` line and the next `## tag:` line").

**`WorkflowYamlAnchorParser` — spec 152 §2.1.**
Anchor syntax: `jobs.<name>`. Parses the YAML to find the `jobs:` mapping, then finds the key `<name>` under it, returning the line span of that job's YAML subtree. Uses `serde_yaml` (already a dependency of the indexer, `Cargo.toml:24`). The span is the line of `<name>:` through the last line of its content before the next sibling key at the same depth.

**`RegionMarkerParser` — spec 152 §2.1 (Rust, TS, Shell, TOML, other).**
Anchor syntax: `// region: <name>` / `// endregion`. Linear scan for the marker line. Returns `LineSpan { start_line: marker_line, end_line: endregion_line }`. Unmatched `// region:` without a closing `// endregion` is a hard error at resolution time (malformed file).

**`MarkdownHeadingParser` — spec 152 §2.1.**
Anchor syntax: GFM heading slug. Slugify the heading text (lowercase, replace spaces with `-`, strip non-alphanumeric except `-`) to match the anchor. A section spans from the heading line to the line before the next heading at the same or higher level (or EOF). This is the standard GFM section-boundary rule cited in spec 152 §2.2.

### Extension mechanism

To add a new file kind in a future spec: implement `AnchorParser` for the new type and call `registry.insert(extension, Box::new(NewParser))` in a future amendment to `default_anchor_parsers`. The `AnchorParser` trait is the stable extension point; no other code changes are required.

---

## §7 Performance Characterization

### Target

The resolver must complete for the full spec corpus (155 specs at the time of writing) within the coupling gate's existing envelope. Spec 133 §9 establishes: "Index load is the dominant cost (~50 ms warm). Authority derivation is sub-millisecond per path." The resolved graph is loaded as part of index load, so it must not materially increase that 50 ms figure.

**Concrete target:** `codebase-indexer compile` (which includes the resolver pass) must complete in under 10 seconds on a warm run against the OAP repo on M1 Pro hardware. This leaves the ~50 ms gate invocation cost (which reads a pre-built index) unchanged and puts the compilation cost on the same order as the existing indexer run.

The symbol/module tree-sitter pass is the new cost driver. The OAP repo has approximately 60 Rust source files of non-trivial size. Benchmarks on the `analysis-structure` module in xray (`crates/xray/src/analysis/structure/mod.rs:26`) show tree-sitter parses a typical Rust file in single-digit milliseconds. 60 files × 5 ms average = ~300 ms, well within the 10 s budget.

### Measurement plan

1. Add `tools/spec-spine/codebase-indexer/benches/resolver.rs` as a `criterion`-based benchmark.
2. Benchmark cases:
   - `bench_compile_full_repo`: time `compile(repo_root)` end-to-end.
   - `bench_symbol_index_build`: time the tree-sitter pass in isolation over the `crates/` directory.
   - `bench_resolve_crate`: single `crate:` resolution against the workspace index.
   - `bench_resolve_symbol`: single `symbol:` resolution against the symbol index.
   - `bench_resolve_section`: single `section:` resolution against a Makefile fixture.
3. CI integration: the `make ci` target (~5 min warm per spec 135 §1) should not be burdened by criterion's multi-sample runs. The bench target is gated behind `cargo bench` only, not added to `make ci`. A threshold check (fail if `bench_compile_full_repo` p50 > 10s) can be added to `make ci-strict` as a follow-up.

**Spec 134 citation:** spec 134's `make ci` fast loop is the envelope we must not push through. Spec 134 §FR-03 defines the fast loop's sentinel mechanism; resolver compilation is part of `codebase-indexer compile`, which already runs in the `make registry` target outside the `make ci` fast loop. No change to CI targets is required in Segment 3.

---

## §8 Module Layout

```
tools/spec-spine/codebase-indexer/src/
  lib.rs                   — existing; no changes to public API
  types.rs                 — add `ResolvedUnit`, `ResolvedLocation`, `LineSpan`
                             as new types; add `resolved_units` field to
                             `TraceMapping` (optional, `#[serde(default)]`)
  spec_scanner.rs          — existing; no changes
  manifest.rs              — existing; no changes
  xref.rs                  — existing; add one call to `resolver::resolve_all`
                             after traceability is built
  resolver/                — NEW module
    mod.rs                 — `ResolverContext`, `resolve()`, `ResolveError`,
                             `ResolvedLocation`, `LineSpan`
    crate_kind.rs          — `resolve_crate()`
    symbol_kind.rs         — `resolve_symbol()`; builds `SymbolIndex`
    module_kind.rs         — `resolve_module()`; builds `ModuleIndex`
    section_kind.rs        — `resolve_section()`; dispatcher into anchor_parsers
    directory_kind.rs      — `resolve_directory()`
    file_kind.rs           — `resolve_file()`
    anchor_parsers/        — NEW sub-module
      mod.rs               — `AnchorParser` trait, `AnchorParserRegistry`,
                             `default_anchor_parsers()`
      makefile.rs          — `MakefileAnchorParser`
      workflow_yaml.rs     — `WorkflowYamlAnchorParser`
      region_marker.rs     — `RegionMarkerParser`
      markdown_heading.rs  — `MarkdownHeadingParser`
    symbol_index.rs        — `SymbolIndex`, tree-sitter extraction pass
    module_index.rs        — `ModuleIndex`, Rust module path discovery
```

### Existing files touched

- `tools/spec-spine/codebase-indexer/src/types.rs`: add `ResolvedUnit`, `ResolvedLocation`, `LineSpan` types; add `resolved_units: Vec<ResolvedUnit>` to `TraceMapping` as `#[serde(default, skip_serializing_if = "Vec::is_empty")]`.
- `tools/spec-spine/codebase-indexer/src/xref.rs`: after `build_traceability` populates `mappings`, iterate over each `TraceMapping`'s logical units and call `resolver::resolve_all` to populate `resolved_units`.
- `tools/spec-spine/codebase-indexer/Cargo.toml`: add `tree-sitter` and `tree-sitter-rust` grammar dependencies.

### Schema version bump

Adding `resolved_units` to `TraceMapping` is strictly additive (new optional field, defaults to empty). Per spec 147's precedent, this is a minor version bump: schema version `2.0.0` → `2.1.0`. Update `types.rs:SCHEMA_VERSION` and `standards/schemas/spec-spine/codebase-index.schema.json`.

---

## §9 Test Plan

Mirror the Segment 2 test discipline (21 tests in PR #183, `tools/spec-spine/spec-compiler/tests/spec154_unit_grammar.rs`). Target: minimum 21 new tests across the following categories.

### Unit tests (per-kind, 6 tests minimum)

Location: `tools/spec-spine/codebase-indexer/src/resolver/mod.rs` (inline `#[cfg(test)]`) and per-kind files.

- `test_resolve_crate_valid` — workspace member exists; returns `Vec<ResolvedLocation>` with `span: None` entries, sorted by file.
- `test_resolve_crate_missing` — workspace member absent; returns `ResolveError::UnknownCrate`.
- `test_resolve_symbol_valid` — symbol present in tree-sitter index; returns correct `(file, LineSpan)`.
- `test_resolve_symbol_missing` — symbol absent; returns `ResolveError::UnknownSymbol`.
- `test_resolve_module_inline` — inline `mod foo { ... }` block; returns correct span.
- `test_resolve_module_file` — file-module `foo.rs`; returns whole-file `span: None`.
- `test_resolve_section_makefile` — Makefile with `## tag: deploy` marker; returns correct span.
- `test_resolve_section_workflow_yaml` — workflow YAML with `jobs.build` key; returns correct span.
- `test_resolve_section_region_marker` — Rust file with `// region: config` block; correct span.
- `test_resolve_section_markdown` — Markdown file with `## Configuration` heading; correct span.
- `test_resolve_section_missing_anchor` — anchor absent; returns `ResolveError::AnchorNotFound`.
- `test_resolve_directory_valid` — directory exists; returns sorted file list.
- `test_resolve_directory_excludes_target` — `target/` subtree absent from results.
- `test_resolve_file_valid` — file exists; returns `span: None`.
- `test_resolve_file_missing` — file absent; returns `ResolveError::MissingFile`.

### Integration test: synthetic spec round-trip

Location: `tools/spec-spine/codebase-indexer/tests/resolver_integration.rs` (new integration test file).

`test_resolver_roundtrip_synthetic` — construct a synthetic worktree with a workspace Cargo.toml, two member crates, a Makefile with `## tag:` markers, and a Rust source file with `// region:` blocks. Run `codebase_indexer::compile` end-to-end. Assert that `traceability.mappings[0].resolved_units` is non-empty and that each `ResolvedLocation.file` exists in the synthetic tree.

### Determinism test

`test_resolver_determinism` — call `compile(repo_root)` twice against the OAP repo root (or a stable fixture). Assert that the two `index.json` byte slices are identical (`assert_eq!(out1.index_json, out2.index_json)`). This is the SC-01 / SC-002 check at the resolver level.

### Failure-mode tests

- `test_resolve_error_crate_hard` — verify `ResolveError::UnknownCrate` propagates to a `Diagnostic` with an error-level code (not warning-only).
- `test_resolve_error_symbol_hard` — same for `ResolveError::UnknownSymbol`.
- `test_resolve_error_anchor_hard` — same for `ResolveError::AnchorNotFound`.
- `test_resolve_directory_missing_hard` — same for missing directory (subject to OQ-3 resolution; test is `#[should_panic]` or checks error variant depending on decision).

### Anchor parser unit tests (4 parsers × 2 tests minimum)

- Each `AnchorParser` implementation gets a positive test (anchor found, correct span) and a negative test (anchor absent, returns `None`).

---

## §10 Public API Seams for Segments 4 and 5

Segment 4 refactors the coupling gate to operate over logical units instead of path lists. Segment 5 migrates the corpus. Both consume the resolver's output; the contract must not require a re-design.

### Public types (stable across Segment 3 → 4 boundary)

```rust
// tools/spec-spine/codebase-indexer/src/resolver/mod.rs

/// A resolved unit: the logical unit as declared, plus its physical locations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedUnit {
    /// The original logical unit declaration (serialized for index consumers).
    pub unit: SerializedLogicalUnit,
    /// Sorted resolved locations. Empty only if unit resolution produced an error
    /// that was downgraded to a diagnostic (see `ResolveError` severity).
    pub locations: Vec<ResolvedLocation>,
}

/// Serialized form of `LogicalUnit` for inclusion in `index.json`.
/// Mirrors the YAML shape from spec 154 §2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SerializedLogicalUnit { ... }
```

### Public functions the gate (Segment 4) will call

The gate reads `index.json` via `codebase-indexer::load` → `CodebaseIndex`. It does not call the resolver at gate-run time — it reads pre-resolved data from the index. The gate's new diff-to-unit reverse lookup will be:

```rust
// tools/spec-spine/spec-code-coupling-check/src/lib.rs (Segment 4 adds this)
pub fn units_touched_by_hunk(
    index: &CodebaseIndex,
    file: &str,
    hunk_start: u32,
    hunk_end: u32,
) -> Vec<(SpecId, &ResolvedUnit)>
```

This function needs `ResolvedUnit.locations` to be line-range addressable — which the `LineSpan` type satisfies directly. The `ResolvedUnit` type must be `Serialize + Deserialize` so it round-trips through `index.json` — covered by the derives above.

### What Segment 5 (corpus migration) needs

Segment 5 walks the spec corpus and rewrites path-string values to typed unit declarations. It does not need the resolver's runtime logic; it reads the compiled registry to discover which specs have legacy `file:` units (flagged by `L-005`). The only seam Segment 5 needs from Segment 3 is that `L-005` fires correctly for path-strings that resolve cleanly to a higher-level unit — which is a spec-compiler concern, already noted at `tools/shared/spec-types/src/lib.rs:295`.

---

## §11 Open Questions — closure record

All seven OQs surfaced during the initial design pass are now closed.

**OQ-1 (symbol path generics).** Closed by [spec 155 §2.1](../155-logical-unit-resolution-semantics/spec.md). Spec 154 §3.2 amended to clarify that `id` is a Rust item path; type-expression syntax (`<`, `>`) is V-024-rejected. See §4.2 above.

**OQ-2 (module: missing is hard error).** Closed by [spec 155 §2.2](../155-logical-unit-resolution-semantics/spec.md). Spec 154 §3.3 amended to make missing-module a hard error mirroring §3.1 / §3.2. See §4.3 above.

**OQ-3 (directory: missing is hard error).** Closed by [spec 155 §2.3](../155-logical-unit-resolution-semantics/spec.md). Spec 154 §3.5 amended to make missing-directory a hard error mirroring §3.1 / §3.6. See §4.5 above.

**OQ-4 (file: rename trace in compile context).** Closed by [spec 155 §2.4](../155-logical-unit-resolution-semantics/spec.md). Spec 154 §3.6 amended to clarify rename-trace is a gate-context property; resolver compile-context unconditionally hard-errors. See §4.6 above.

**OQ-5 (schema version consumers).** Closed by mechanical verification 2026-05-21. No exact-version equality checks exist on `schemaVersion`. The two real consumers:

- `tools/spec-spine/spec-code-coupling-check/src/lib.rs:298` parses `SCHEMA_VERSION`'s major component and compares against the index's major; rejects only on major-version mismatch. A 2.0.0 → 2.1.0 bump still satisfies `major == 2`.
- `tools/oap/oap-code-index-enrich/src/lib.rs:156` reads `index.schema_version` to touch the field (`let _ = index.schema_version;`) without comparing against a literal.

Test fixtures hardcoding `"2.0.0"` (e.g. `tools/spec-spine/spec-code-coupling-check/tests/cli.rs:20`, `tools/oap/oap-code-index-enrich/src/lib.rs:306`) continue to pass under the major-only comparison logic when `SCHEMA_VERSION` is `2.1.0`. **Verdict:** the 2.0.0 → 2.1.0 bump is safe; no consumer regressions are predicted.

**OQ-6 (tree-sitter grammar vendoring).** Closed by mechanical verification 2026-05-21. The grammar is **already vendored** at `tools/vendor/grammars/tree-sitter-rust` alongside `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-c`, and `tree-sitter-javascript`. The §5 statement ("already vendored at `tools/vendor/`") was correct; the OQ-6 framing ("must be vendored before Segment 3 builds") was a self-contradiction within this doc. Implementation work for Segment 3 is therefore narrower than OQ-6 implied: add `tree-sitter = { version = "0.25" }` to `tools/spec-spine/codebase-indexer/Cargo.toml` and reference the vendored grammar via the existing binding path (exact `crates.io` vs. path-dep choice resolved during implementation by mirroring xray's pattern at `crates/xray/Cargo.toml:37`). No new vendoring required.

**OQ-7 (inline module span boundary).** Closed as a design-doc decision: the resolved span for inline modules includes the `mod foo {` declaration line. Rationale in §4.3 above. No spec amendment required.

---

## Summary of Decisions

| Topic | Decision | Justification |
|---|---|---|
| Span shape | 1-indexed inclusive `LineSpan` | Matches git diff hunk format; no gate-side parser dependency |
| Sort key | `file` then `start_line` then `end_line` | Satisfies SC-01 / SC-002 determinism contract |
| xray integration | In-indexer tree-sitter pass (option b) | xray has no qualified-path API; avoids C build coupling in indexer |
| `symbol:` missing | Hard error | Spec 154 §3.2 explicit |
| `crate:` missing | Hard error | Spec 154 §3.1 explicit |
| `section:` missing anchor | Hard error | Spec 154 §3.4 explicit |
| `file:` missing | Hard error in compile context | Spec 154 §3.6 (rename-trace deferred to Segment 4 gate) |
| `directory:` missing | Hard error (proposed; OQ-3) | Consistency with other existence-checked kinds |
| `module:` missing | Hard error (proposed; OQ-2) | Consistency with §3.1 / §3.2 pattern |
| AnchorParser dispatch | Extension-map by file extension | Low coupling, easy to extend in future specs |
| Schema version | `2.0.0` → `2.1.0` (additive) | `resolved_units` is optional; spec 153 additive-evolution preserved |
| Performance target | Compile under 10 s warm | Gate 50 ms reads pre-built index; builder runs in `make registry` |
