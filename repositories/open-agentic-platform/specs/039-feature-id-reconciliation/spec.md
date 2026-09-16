---
id: "039-feature-id-reconciliation"
title: "Feature ID reconciliation (codeAliases)"
feature_branch: "039-feature-id-reconciliation"
status: approved
implementation: complete
kind: platform
domain: tooling
created: "2026-03-29"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that parsed and emitted codeAliases was deleted; that logic is now in spec-spine-core. The spec-compiler edge is stripped (path deleted); the surviving registry.schema.json edge (the codeAliases schema field) is retained.
authors:
  - "open-agentic-platform"
language: en
summary: >
  Bridge the dual identity system — kebab spec IDs and UPPERCASE code attribution
  tokens — by adding an optional codeAliases field to the compiled registry schema,
  spec-compiler, and featuregraph scanner. Implements ADR 0001.
# 217 deleted the in-tree spec-compiler; the codeAliases parse/emit this spec added
# is now in spec-spine-core. The spec-compiler/src/lib.rs edge is stripped (path
# deleted); the surviving registry.schema.json edge (the codeAliases schema field)
# is retained. Amended by 217.
extends:
  - spec: "001-spec-compiler-mvp"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
---

# Feature Specification: Feature ID reconciliation (codeAliases)

## Purpose

Two parallel identifier systems exist with no bridge in the compiled registry:

1. **Spec registry** — kebab-case IDs (`032-opc-inspect-governance-wiring-mvp`) as the canonical `id` in `registry.json`, matching `specs/<id>/` directories.
2. **Code attribution** — `// Feature: UPPERCASE_TOKEN` headers scanned by `featuregraph` (`FEATUREGRAPH_REGISTRY`, `OPC_INSPECT_GOVERNANCE_WIRING_MVP`, etc.).

Governance consumers cannot join spec metadata to scanned code ownership. This grows worse with every new feature (now 38+ specs vs 13+ code tokens). ADR 0001 chose option (a): extend the compiled registry with an optional `codeAliases` field that maps UPPERCASE tokens to their canonical kebab ID.

## Scope

### In scope

- **ADR 0001 gap closure** — address the 4 gaps identified in review (schema bump, validation rules, consumer contract, population ordering).
- **Schema extension** — add optional `codeAliases` property to `featureRecord` in `registry.schema.json`.
- **Spec-compiler extension** — read `code_aliases` from spec frontmatter, emit sorted `codeAliases` array in compiled output, validate alias uniqueness across all features.
- **Scanner consumer update** — `RegistryFeatureRecord` deserializes `codeAliases`; `from_registry_record()` populates `FeatureEntry.aliases`.
- **Frontmatter population** — add `code_aliases` to existing spec frontmatter for features that have code attribution tokens.
- **Verification** — governance panel shows unified view; featuregraph cross-references resolve.

### Out of scope

- **Scanner-derived alias enrichment** — automatically populating `codeAliases` from scanned `// Feature:` headers at compile time. Per ADR review, frontmatter is authoritative at compile time; scanner validates at scan time. Auto-enrichment is a future enhancement.
- **Mass code header migration** — ADR 0001 rejected option (c). Existing `// Feature: UPPERCASE` headers remain as-is.
- **Desktop UI changes** — governance panel already displays whatever the scanner provides. No new UI components needed.

## Requirements

### Functional

- **FR-001**: `registry.schema.json` includes an optional `codeAliases` property on `featureRecord`: a JSON array of strings matching `^[A-Z][A-Z0-9_]{2,63}$`, sorted lexicographically.
- **FR-002**: `spec-compiler` reads an optional `code_aliases` frontmatter field (list of UPPERCASE strings) from `spec.md` files and emits it as `codeAliases` in `registry.json`. When absent or empty, the field is omitted (not `null` or `[]`).
- **FR-003**: `spec-compiler` emits violation `V-005` (error) if the same alias string appears in `code_aliases` frontmatter of more than one feature.
- **FR-004**: `spec-compiler` emits violation `V-006` (warning) if a `code_aliases` entry does not match the required pattern `^[A-Z][A-Z0-9_]{2,63}$`.
- **FR-005**: `RegistryFeatureRecord` in `crates/featuregraph/src/registry_source.rs` deserializes `codeAliases` (optional, default empty). `FeatureEntry::from_registry_record()` populates `aliases` from this field.
- **FR-006**: `featuregraph` scanner resolves `// Feature: TOKEN` → canonical kebab ID via `codeAliases` when loading from compiled registry (closing the gap where the registry path produces empty alias maps).
- **FR-007**: Schema conformance tests pass with the extended schema. Golden determinism tests confirm `codeAliases` ordering is stable.

### Non-functional

- **NF-001**: No change to spec-compiler compile time for repos without `code_aliases` frontmatter (zero overhead when field is absent).
- **NF-002**: `specVersion` bump from `1.0.0` to `1.1.0` signals the new optional field. Consumers that ignore unknown fields are unaffected.

## Architecture

### Schema change

Add to `featureRecord` in `registry.schema.json`:

```json
"codeAliases": {
  "type": "array",
  "items": {
    "type": "string",
    "pattern": "^[A-Z][A-Z0-9_]{2,63}$"
  },
  "uniqueItems": true
}
```

The field is optional (not in `required`). The compiler omits it when empty (`skip_serializing_if`).

### Compiler change

1. Add `"code_aliases"` to `KNOWN_KEYS` in `tools/spec-spine/spec-compiler/src/lib.rs`.
2. Add `code_aliases: Option<Vec<String>>` to `FeatureRecord` with `#[serde(rename = "codeAliases", skip_serializing_if = "Option::is_none")]`.
3. Parse from frontmatter, validate pattern, sort lexicographically.
4. Cross-feature uniqueness check: build `HashMap<String, String>` (alias → feature id) during compilation; emit `V-005` on collision.

### Scanner change

1. Add `code_aliases: Option<Vec<String>>` to `RegistryFeatureRecord` with `#[serde(rename = "codeAliases", default)]`.
2. In `FeatureEntry::from_registry_record()`, map `code_aliases` → `aliases`.
3. Existing `alias_map` logic in `Scanner::scan()` already handles alias resolution — no further changes needed.

### Population ordering

**Frontmatter is authoritative at compile time.** The compiler reads `code_aliases` from spec frontmatter only. The scanner validates that scanned code tokens match declared aliases at scan time. There is no circular dependency.

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Schema | `standards/schemas/spec-spine/registry.schema.json` | Add `codeAliases` property |
| Compiler | `tools/spec-spine/spec-compiler/src/lib.rs` | `KNOWN_KEYS`, `FeatureRecord`, validation |
| Compiler tests | `tools/spec-spine/spec-compiler/tests/` | Schema conformance, golden, alias collision |
| Scanner source | `crates/featuregraph/src/registry_source.rs` | Deserialize `codeAliases` |
| Scanner | `crates/featuregraph/src/scanner.rs` | `from_registry_record()` populates aliases |
| Spec frontmatter | `specs/*/spec.md` | Add `code_aliases` where applicable |
| ADR | `docs/adr/0001-feature-id-reconciliation.md` | Close 4 review gaps |

## Success criteria

- **SC-001**: `spec-compiler compile` produces `registry.json` with `codeAliases` arrays on features that declare `code_aliases` in frontmatter.
- **SC-002**: Features without `code_aliases` in frontmatter have no `codeAliases` field in registry output.
- **SC-003**: Duplicate alias across features produces `V-005` error in validation output.
- **SC-004**: `featuregraph` scan resolves `// Feature: FEATUREGRAPH_REGISTRY` to `034-featuregraph-registry-scanner-fix` (or whichever kebab ID declares that alias) via the compiled registry path.
- **SC-005**: Schema conformance tests pass (`tools/spec-spine/spec-compiler/tests/schema_conformance.rs`).
- **SC-006**: `specVersion` in compiled output is `1.1.0`.

## Contract notes

- `codeAliases` is **optional and omit-when-empty**. Consumers using `#[serde(default)]` or dynamic JSON access are unaffected. The `additionalProperties: false` constraint means the schema MUST be updated before the compiler emits the field.
- Schema and compiler changes MUST land in the same commit to avoid schema conformance test breakage.
- The `specVersion` bump to `1.1.0` is a minor version increase per semver (new optional field = backward-compatible addition).
- Orphaned aliases (declared in frontmatter but no matching `// Feature:` header in code) are acceptable — the feature may not have code yet or the code may live in a non-scanned location.

## Risk

- **R-001**: Frontmatter population is manual. Mitigation: Feature 039 populates aliases for all existing features with code tokens. Future automation can derive suggestions from scanner output.
- **R-002**: `additionalProperties: false` on schema makes field addition a coordinated change. Mitigation: schema + compiler update in same commit (contract note above).
