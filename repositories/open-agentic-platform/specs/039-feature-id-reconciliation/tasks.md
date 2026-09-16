---
feature: "039-feature-id-reconciliation"
---

# Tasks: Feature ID reconciliation (codeAliases)

## ADR closure

- [x] **T001** — Update ADR 0001 with review gap closures
  - Add "Schema versioning" subsection: `specVersion` bump `1.0.0` → `1.1.0`, omit-when-empty semantics, atomic schema+compiler commit
  - Add "Validation rules" subsection: `V-005` (error) for duplicate alias across features, `V-006` (warning) for malformed alias pattern
  - Add consumer contract note: featuregraph scanner MUST populate `FeatureEntry.aliases` from `codeAliases` on registry path
  - Clarify population ordering: frontmatter-only at compile time; scanner validates, not enriches
  - Change ADR status from `Proposed` to `Accepted`

## Schema and compiler

- [x] **T002** — Extend `registry.schema.json` with `codeAliases`
  - Add optional `codeAliases` property to `featureRecord` definition
  - Pattern: `^[A-Z][A-Z0-9_]{2,63}$`, `uniqueItems: true`
  - Do NOT add to `required` array

- [x] **T003** — Extend `spec-compiler` to read and emit `codeAliases`
  - Add `"code_aliases"` to `KNOWN_KEYS`
  - Add `code_aliases: Option<Vec<String>>` to `FeatureRecord` with serde rename + skip_serializing_if
  - Parse from frontmatter, sort lexicographically
  - Validate pattern per-entry (emit `V-006` warning on mismatch)
  - Cross-feature uniqueness: build alias→feature map, emit `V-005` error on collision

- [x] **T004** — Bump `specVersion` to `1.1.0`
  - Update default `specVersion` in compiler output
  - Update any hardcoded version references in tests

## Scanner consumer update

- [x] **T005** — Extend `RegistryFeatureRecord` to deserialize `codeAliases`
  - Add `code_aliases: Option<Vec<String>>` with `#[serde(rename = "codeAliases", default)]`
  - In `FeatureEntry::from_registry_record()`, map to `aliases` field

- [x] **T006** — Verify scanner alias resolution end-to-end
  - Confirm `featuregraph` scan resolves UPPERCASE tokens to kebab IDs via compiled registry
  - Test with at least one real feature that has both a `code_aliases` frontmatter entry and `// Feature: TOKEN` code headers

## Frontmatter population

- [x] **T007** — Add `code_aliases` to existing spec frontmatter
  - Scan codebase for all `// Feature: TOKEN` headers
  - Map each token to its canonical spec ID
  - Add `code_aliases` field to each spec's frontmatter
  - Verify no duplicate aliases across features

## Verification and closure

- [x] **T008** — Run compiler and scanner, verify SC-001 through SC-006
  - `spec-compiler compile` produces correct output
  - `featuregraph` scan resolves aliases via registry path
  - Schema conformance tests pass
  - Record results in `execution/verification.md`

- [x] **T009** — Run `spec-compiler compile` to update registry with new field

## Notes

- **T002 and T003 MUST be committed together** — `additionalProperties: false` on the schema means emitting `codeAliases` without the schema update will break conformance tests.
- **T004 can be part of the T002+T003 commit** — the version bump signals the schema extension.
- **T007 is the largest task** — requires scanning the entire codebase for `// Feature:` headers and mapping them. Use `featuregraph` scanner output or `grep` to build the mapping.
- **Existing `aliases` field in `FeatureEntry`** (scanner.rs) already drives `alias_map` resolution. T005 just bridges the data from registry JSON into this existing mechanism.
