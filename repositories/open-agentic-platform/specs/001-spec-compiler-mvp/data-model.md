# Data model: Spec compiler MVP (implementation view)

**Feature**: `001-spec-compiler-mvp`

This feature **consumes** the registry data model defined in Feature **000** (`specs/000-bootstrap-spec-system/data-model.md`). No parallel schema.

## Internal types (suggested, non-normative)

| Internal struct | Maps to |
|-----------------|---------|
| `ParsedSpec` | Raw path + frontmatter map + body + extracted headings |
| `NormalizedFeature` | `FeatureRecord` in `registry.json` |
| `BuildFingerprint` | Inputs contributing to `contentHash` |

## Outputs

| File | Schema |
|------|--------|
| `.derived/spec-registry/registry.json` | `standards/schemas/spec-spine/registry.schema.json` |
| `.derived/spec-registry/build-meta.json` | `standards/schemas/spec-spine/build-meta.schema.json` |

## Heading extraction (non-normative implementation note)

This section describes **intended MVP behavior** for the compiler implementation. It does **not** extend Feature 000’s contract: only **`sectionHeadings`** strings in emitted JSON are observable. The **exact** rule (including whether the first H1 is skipped when it duplicates `title`) MUST be written in **`tools/spec-spine/spec-compiler/README.md`** once implemented and kept in sync with code—**not** silently diverge into undocumented normative behavior.

- **MVP:** Collect **level-1** (`#`) and **level-2** (`##`) ATX headings only, in source order; optional duplicate-title suppression is an implementation detail documented in the crate README.
