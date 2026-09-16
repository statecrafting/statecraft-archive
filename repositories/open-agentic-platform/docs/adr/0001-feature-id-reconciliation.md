# ADR 0001: Feature ID reconciliation (code ↔ spec registry)

| Field | Value |
|-------|--------|
| Status | **Accepted** — implemented under Feature 039 |
| Date | 2026-03-29 |
| Context | Slice E (pre-OSS planning) |

## Context

Two parallel identifier systems exist:

1. **Spec registry (canonical)** — Kebab-case IDs with a three-digit numeric prefix, matching `specs/<id>/` and `FeatureRecord.id` in `registry.json` (see `standards/schemas/spec-spine/registry.schema.json`).
2. **Code attribution** — `// Feature: UPPERCASE_TOKEN` (and `#` variants) scanned by `featuregraph` (`crates/featuregraph/src/scanner.rs`), using semantic names such as `FEATUREGRAPH_REGISTRY` that do not encode the spec folder slug.

There is no stable bridge in compiled registry JSON between these systems, so governance consumers cannot join spec metadata to scanned code ownership. Legacy YAML alias plumbing does not apply to the deterministic compiled registry path.

## Decision

- **Canonical feature identity** remains the **kebab-case `id`** in `registry.json` (and spec frontmatter). No change to directory layout, compiler primary key, or `specPath` rules.
- **Code-side tokens** are treated as **aliases** of that canonical id. The compiled registry gains an optional, deterministic field on each feature record — **`codeAliases`**: a JSON array of unique strings matching the existing scanner token shape (`[A-Z][A-Z0-9_]{2,63}`), sorted lexicographically for stable output.
- **Population strategy (implemented):** aliases are declared in **spec frontmatter** (`code_aliases` in each `specs/<id>/spec.md`) as the **sole compile-time source**. `spec-spine compile` validates pattern and cross-feature uniqueness, then emits `codeAliases` in the compiled shards. The featuregraph scanner **does not** enrich aliases at compile time; it **loads** `codeAliases` from the compiled registry and populates `FeatureEntry.aliases` so existing `alias_map` resolution applies. At scan time, the scanner attributes files to features; policy for orphan or mismatched headers is unchanged.

This corresponds to **option (a)** in the next-slice plan: extend the compiled registry so both human/spec ids and code tokens are first-class for matching.

## Rationale

| Option | Verdict |
|--------|---------|
| **(a) Aliases in compiled registry** | **Chosen.** Preserves kebab ids as single source of truth for specs; avoids mass header churn; handles many-to-one (several code tokens → one feature) explicitly; aligns with deterministic-registry goals if arrays are sorted and merge rules are fixed. |
| **(b) Convention-derived UPPERCASE from kebab slug** | Rejected. Slugs are long and not isomorphic to semantic bundle names (`032-opc-…` vs `OPC_INSPECT_…`); automatic derivation is noisy and breaks when one feature legitimately uses multiple distinct code tokens. |
| **(c) Kebab everywhere in code headers** | Rejected. Very large change surface; `scanner` today encodes UPPERCASE in `FEATURE_REGEX`; widespread churn for limited gain when explicit aliases solve linking without renaming every file’s header. |

## Consequences

### Positive

- Governance UI and tools can resolve `// Feature: FOO` → kebab `id` via `codeAliases` without ambiguous heuristics.
- Spec workflow remains anchored on `specs/<id>/`; no second “primary” id system.

### Negative / follow-up

- **Schema and compiler** were extended (`registry.schema.json`, the spec-spine compiler, validation rules) for Feature 039. (spec 217: the in-tree `tools/spec-spine/spec-compiler` is now the published `spec-spine` CLI.)
- **Content maintenance:** new or renamed code tokens require updates to spec frontmatter `code_aliases` until optional automation exists; see Feature 039 tasks.
- **Consumers** (`spec-spine registry` subcommands, featuregraph, desktop; spec 217: previously `registry-consumer`) treat **`id` as canonical** and use `codeAliases` only for lookup; optional field preserves backward compatibility until consumers opt in.

## Schema versioning

- **`specVersion`** in compiled `registry.json` is **`1.1.0`** (minor bump from `1.0.0`).
- **`codeAliases`** is optional and **omitted when empty** (not `null` or `[]`).
- Schema and compiler changes that emit `codeAliases` **ship in the same commit** so `additionalProperties: false` on `featureRecord` stays satisfied and schema conformance tests do not break.

## Validation rules (spec-spine compile; spec 217: previously spec-compiler)

| Code | Severity | Meaning |
|------|----------|---------|
| **V-005** | error | The same alias string appears in `code_aliases` frontmatter of **more than one** feature. |
| **V-006** | warning | A `code_aliases` entry does not match `^[A-Z][A-Z0-9_]{2,63}$` (invalid entries are omitted from emitted `codeAliases`). |

## Consumer contract

- **featuregraph** (registry path): when loading shards under `.derived/spec-registry/by-spec/` (spec 217: previously the monolithic `.derived/spec-registry/registry.json`), **`RegistryFeatureRecord` MUST deserialize `codeAliases`** (optional). **`FeatureEntry::from_registry_record()` MUST copy them into `FeatureEntry.aliases`** so `Scanner::scan()` builds `alias_map` and resolves `// Feature: TOKEN` lines to the canonical kebab `id`.

## Population ordering

- **Compile time:** only spec frontmatter `code_aliases` feeds the compiler.
- **Scan time:** the scanner uses registry-provided aliases for resolution; it does not add aliases from scanned headers into the registry. No circular dependency.

## References

- `standards/schemas/spec-spine/registry.schema.json` — `featureRecord.id` pattern.
- `crates/featuregraph/src/scanner.rs` — `FEATURE_REGEX`, attribution model.
- Slice E scope and options (a)–(c) (formerly in `.ai/plans/next-slice.md`, removed with .ai/ cleanup).
