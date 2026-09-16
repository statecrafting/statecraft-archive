# Implementation Plan: Conformance lint

**Branch**: `006-conformance-lint-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Implement **`tools/spec-spine/spec-lint/`**: a **Rust** CLI **`spec-lint`** that walks **`specs/<NNN>-<slug>/`**, applies **W-001**–**W-006** heuristics (MVP may ship a **subset**; spec lists full catalog), prints warnings to **stderr**, exits **0** by default, **`--fail-on-warn`** exits **1** when any warning emitted.

## Technical Context

**Language**: Rust **1.74+**, **`clap`**, **`serde_yaml`** for frontmatter, **`walkdir`** or `fs::read_dir`.

**Testing**: `cargo test` with **fixture** trees under **`tests/fixtures/`**.

**CI**: Run **`spec-lint`** after **`spec-compiler compile`**; default **non-failing**; optional strict job later.

## Constitution Check

| Gate | Status |
|------|--------|
| Does not replace **001** | Pass |
| Markdown + optional frontmatter only as inputs | Pass |
| No new registry JSON | Pass |

## Project Structure

```text
tools/spec-spine/spec-lint/
├── Cargo.toml
├── README.md
├── src/
│   ├── main.rs
│   └── lib.rs
└── tests/
```

## Exit codes

| Code | Meaning |
|------|---------|
| **0** | Lint run completed (warnings may have printed) |
| **1** | **`--fail-on-warn`** and at least one warning |
| **2** | Usage / CLI error |
| **3** | I/O panic / unexpected failure |

Adjust if aligned with **001/002** style; document in README.
