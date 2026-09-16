# Implementation Plan: Registry consumer MVP

**Branch**: `002-registry-consumer-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-registry-consumer-mvp/spec.md`

## Summary

Introduce the **first canonical read-only consumer** of **`.derived/spec-registry/registry.json`**: a **normative CLI** under **`tools/spec-spine/registry-consumer/`** (binary **`registry-consumer`**), with documented guarantees, safe default behavior when **`validation.passed`** is false, **prefix-only** **`id`** filtering, **`show`** emitting the **full** **`featureRecord`** as JSON, and **human-readable** default output for **`list`**. Optional in-crate **Rust** helpers are **not** part of conformance.

No changes to Feature **000** contracts or Feature **001** compiler scope.

## Technical Context

**Language/Version**: Rust (edition 2021), aligned with **`tools/spec-spine/spec-compiler`** `rust-version` unless this plan is amended.

**Primary Dependencies**: `serde`, `serde_json`, `clap`; duplicate minimal structs in MVP unless a shared crate is clearly justified (avoid coupling to **`spec-compiler`** if it risks cycles).

**Inputs**: Read-only **`registry.json`**; optional **`--registry-path`**.

**Trust model (MVP)**: Parse JSON into the expected registry shape; enforce **`validation.passed`** before authoritative behavior; **do not** run **`registry.schema.json`** validation in the consumer by default—Feature **001** remains the schema gate.

**Testing**: `cargo test`; integration tests covering **exit codes**, **`validation.passed: false`**, **`show`** JSON shape, **`list`** filters.

**Constraints**: No edits to **`specs/`**; no new validation codes; prefer **zero** edits to Feature **000** schemas.

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-only authoring | Pass — consumer reads compiler JSON only |
| Compiler-owned JSON | Pass — does not author parallel machine truth |
| Feature 000 / 001 precedence | Pass — read-only surface over existing contracts |

## Project Structure (documentation)

```text
specs/002-registry-consumer-mvp/
├── spec.md
├── plan.md
├── tasks.md
└── (supporting docs only as needed)
```

## Project Structure (implementation)

```text
tools/spec-spine/registry-consumer/
├── Cargo.toml
├── README.md
├── src/
│   ├── main.rs
│   └── lib.rs   # optional: internal helpers only; not normative for 002
└── tests/
    └── ...
```

**Structure Decision**: Single-purpose crate under **`tools/`**; **CLI** is the **only** required deliverable for Feature **002** MVP.

## CLI (normative summary)

Global:

- **`--registry-path <path>`** — default: **`.derived/spec-registry/registry.json`** relative to current working directory (document that invocations should run from repo root, matching **`spec-compiler`** usage).
- **`--allow-invalid`** — allow reading when **`validation.passed`** is **false** (diagnostics only).

Subcommands:

- **`list`** — optional **`--status <status>`**, **`--id-prefix <prefix>`** (**prefix match** on **`id`** only; no substring).
- **`show <feature-id>`** — print **one** JSON object: full **`featureRecord`** (pretty-print or compact: choose one and document; tests pin stable output).

**`list` output**: Human-readable text (table or fixed columns). **JSON output for `list`** is **not** in MVP.

## Exit codes

Same convention as Feature **001** (see **[spec.md](./spec.md)** normative table):

| Code | Meaning |
|------|---------|
| **0** | Success |
| **1** | Not found; or registry refused (**`validation.passed`** false without **`--allow-invalid`**) |
| **3** | I/O, JSON parse, or unexpected runtime failure |

## Complexity Tracking

| Item | Reason |
|------|--------|
| Optional shared-types crate | Only if duplication becomes costly; MVP may inline structs |
| JSON output for **`list`** | Deferred — avoids a second presentation contract in 002 |
