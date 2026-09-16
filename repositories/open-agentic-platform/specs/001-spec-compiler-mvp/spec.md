---
id: "001-spec-compiler-mvp"
title: "Spec compiler MVP (registry.json + build-meta.json)"
feature_branch: "001-spec-compiler-mvp"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
kind: tooling
domain: tooling
created: "2026-03-22"
closed: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
amended: "2026-05-13"
amendment_record: "147-spec-kind-grammar"
summary: >
  Implement the first spec compiler: scan specs/, validate markdown + frontmatter,
  emit deterministic registry.json and ephemeral build-meta.json per Feature 000
  schemas; enforce V-001–V-004; golden tests for determinism.
  Amended by spec 147 (2026-05-13) to extend the compiler with the kind-grammar
  validation surface: KNOWN_KEYS extension, V-012..V-019 (warning severity in
  Phase 1), VALID_KINDS enum, SHAPE_TABLE reservation, and `implements:` scalar/list
  serialization. SPEC_VERSION bumps 1.4.0 → 1.5.0.
# 217 (spec-spine engine swap) deleted the in-tree spec-compiler crate this
# spec established; the establishes file-units (and the monolithic registry.json
# reference) are removed because those paths no longer exist (compile capability
# is now spec-spine-core::compile). Historical authorship is preserved in 217's
# supersedes edge and this spec's prose. Superseded by 217.
---

# Feature Specification: Spec compiler MVP

**Feature Branch**: `001-spec-compiler-mvp`  
**Created**: 2026-03-22  
**Closed**: 2026-03-22 (implementation + schema-gated CI + checkpoint; see [checkpoint.md](./checkpoint.md))  
**Status**: Approved (delivered; reopen only on constitutional or scoped change)  
**Input**: Build the minimal compiler that makes Feature 000 real—**not** product servers (axiomregent, xray, featuregraph).

## Purpose and charter

This feature delivers the **first runnable spec compiler** for `open-agentic-platform`. It **implements** the contracts defined in **`specs/000-bootstrap-spec-system/spec.md`** (and its JSON Schemas), including:

- Discovery of `specs/<NNN>-<kebab>/spec.md`
- Parsing YAML frontmatter and markdown body (section headings)
- Emitting **`.derived/spec-registry/registry.json`** (byte-deterministic) and **`.derived/spec-registry/build-meta.json`** (ephemeral)
- Validation invariants **V-001** through **V-004** (MVP); **V-005** remains reserved per Feature 000

**Explicitly out of scope:**

- **axiomregent**, **xray**, **featuregraph**, or any other runtime/agent product
- Editing or authoring YAML outside `.md` frontmatter
- Sub-tree compilation modes beyond what Feature 000 research **D8** allows for MVP (default **repo-root `.`** only unless a small `--root` flag is added and documented in `research.md`)

## Normative dependency

Feature **001** is **subordinate** to Feature **000**. If this spec’s text conflicts with Feature 000, **Feature 000 wins**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Compile the repository (Priority: P1)

A contributor runs the compiler from the repo root. It writes `registry.json` and `build-meta.json` under `.derived/spec-registry/`. `registry.json` validates against Feature 000’s `registry.schema.json` and lists every feature under `specs/` with normalized fields.

**Why this priority:** Without a working compile, Feature 000 is theoretical.

**Independent Test:** Run CLI against this repo; inspect JSON output.

**Acceptance Scenarios**:

1. **Given** valid feature specs under `specs/`, **When** the compiler runs with default options, **Then** `validation.passed` is true and `features[]` contains one record per feature directory.
2. **Given** a malformed `spec.md` (missing required frontmatter), **When** the compiler runs, **Then** `validation.passed` is false and a **V-002** violation is present.

---

### User Story 2 — Determinism for CI (Priority: P2)

CI runs the compiler twice on the same committed tree. **`registry.json`** files are **byte-identical**. **`build-meta.json`** may differ in `builtAt` only.

**Why this priority:** Feature 000’s SC-002 depends on this.

**Independent Test:** Golden test in the compiler’s test suite.

**Acceptance Scenarios**:

1. **Given** unchanged inputs and compiler version, **When** two runs complete, **Then** `registry.json` outputs are identical byte-for-byte.

---

### User Story 3 — Forbidden standalone YAML is caught (Priority: P3)

A standalone `.yaml` appears under an authored path (e.g. `docs/bad.yaml`). The compiler reports **V-004** and fails validation.

**Why this priority:** Enforces the no–standalone-YAML rule without relying on separate linters (linters may follow later).

**Acceptance Scenarios**:

1. **Given** a new `foo.yaml` under a scanned path, **When** the compiler runs, **Then** validation fails with **V-004**.

---

### Edge Cases

- **Empty `specs/` directory (no `specs/*/spec.md` files):** The compiler MUST emit **`features: []`**, **`validation.passed: true`** (assuming no other errors), and a **`contentHash`** computed per **FR-007** over the **empty** set of spec inputs (deterministic empty-input hash). This is the **only** valid behavior—no alternate “bootstrap-only” mode that invents synthetic feature rows without a `spec.md` source.
- **At least one feature spec:** Normal operation; `features[]` lists one record per `specs/<NNN>-<kebab>/spec.md` discovered.
- **Frontmatter keys** not mapped to normalized fields: appear only under **`extraFrontmatter`**, constrained by Feature 000 schema (`extraFrontmatterValue`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Provide a **CLI entry point** (exact name in `plan.md`) runnable from the repository root with documented flags.
- **FR-002**: Default **`inputRoot`** behavior MUST match Feature 000 research **D8**: canonical **`"."`** for full-repo compilation; emitted `build.inputRoot` MUST be normalized (no trailing slash, forward slashes).
- **FR-003**: Emit **`registry.json`** satisfying `standards/schemas/spec-spine/registry.schema.json` (including **`extraFrontmatter`** value constraints).
- **FR-004**: Emit **`build-meta.json`** satisfying `standards/schemas/spec-spine/build-meta.schema.json`.
- **FR-005**: Implement **V-001**, **V-002**, **V-003**, **V-004** as defined in Feature 000. **V-005** MUST NOT be claimed as enforced.
- **FR-006**: Implement **deterministic** emission for **`registry.json`** per Feature 000 (sorted keys, sorted arrays where applicable, stable feature order—**lexicographic by `id`** unless Feature 000 specifies otherwise).
- **FR-007**: Compute **`build.contentHash`** per Feature 000 `research.md` **D2** using **only** the following inputs (nothing else unless this list is amended by a spec change):
  1. **Every** file path `specs/<NNN>-<kebab-name>/spec.md` that exists and is read for compilation, with file content normalized per D2 (UTF-8 without BOM, LF newlines), concatenated in **sorted path order** as D2 defines.
  2. **Optionally**, the bytes of `standards/schemas/spec-spine/registry.schema.json` and `build-meta.schema.json` **only if** the compiler reads them at runtime to validate or embed—if the compiler does **not** read these files, they MUST NOT be included in the hash.

  Adding new inputs to the fingerprint **requires** an explicit spec amendment; implementations MUST NOT silently fold in extra paths (“relevant to compilation” is **not** an elastic escape hatch).
- **FR-008**: Exit with **non-zero** status when `validation.passed` is false or on unrecoverable I/O error; exact mapping in `research.md`.

### Key Entities

- **Compiler CLI**: The binary + library crate(s) under `tools/spec-spine/spec-compiler/` (path fixed in `plan.md`).
- **Compilation run**: One invocation producing a pair of JSON files.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new contributor can run documented commands and produce valid `registry.json` in under 15 minutes on a clean clone (excluding dependency download time).
- **SC-002**: Golden test demonstrates **byte-identical** `registry.json` across two runs on a fixture tree.
- **SC-003**: `ajv` (or equivalent) validation of emitted JSON against Feature 000 schemas passes with **zero** errors.
- **SC-004**: Introducing a standalone `.yaml` in a covered path yields **V-004** with non-zero exit.

## Clarifications

### Session 2026-03-22

- Deliberately **not** specifying axiomregent/xray/featuregraph; Feature 001 is the **compiler MVP** only.

### Session 2026-05-04 — Implementation behaviour hoisted from `tools/spec-spine/spec-compiler/README.md`

These clauses refine the spec's narrative with binary-specific normative
behaviour that has been part of `spec-compiler` since 2026-03-22 but lived
only in the tool's README. They do not change `registry.json` shape and
do not introduce new V-codes; they make existing parser strictness
discoverable from the spec spine.

- **Frontmatter delimiter strictness (MVP).** The parser expects an
  opening line that starts **exactly** with `---` — no leading
  whitespace, no trailing content on the same line. Variants such as
  `--- ` (trailing space) on the opening delimiter are **not** accepted.
  Editors that emit such variants must be configured to elide the
  trailing whitespace. The closing delimiter follows the same rule. This
  is the source of FR-002's "frontmatter parser" boundary; spec authors
  should not assume a more permissive YAML loader.
- **Heading extraction (normative for this binary).** The compiler emits
  `sectionHeadings` covering only `#` (H1) and `##` (H2) ATX headings;
  deeper levels (H3+) are intentionally ignored. Document order is
  preserved. As an MVP-specific deduplication: if the **first** heading
  text equals the frontmatter `title` (trimmed), that heading is
  **dropped** from `sectionHeadings` so the title does not appear twice
  in any rendered TOC. Feature 000 only requires `sectionHeadings` to be
  stable; this binary's specific extraction policy is documented here so
  the contract is reachable from the spec, not only from the README.
- **Exit code mapping.** `0` = success and validation passed; `1` =
  validation failed (FR-008's non-zero on `validation.passed = false`);
  `3` = I/O or parse error (FR-008's "unrecoverable I/O error"). Future
  exit codes require a spec change.
