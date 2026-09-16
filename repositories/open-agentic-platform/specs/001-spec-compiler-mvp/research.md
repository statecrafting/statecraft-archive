# Research: Spec compiler MVP

**Feature**: `001-spec-compiler-mvp`  
**Date**: 2026-03-22

## Decisions

### R1 — Rust

- **Decision**: Implement in **Rust** for a single static binary, predictable UTF-8 handling, and strong ecosystem for JSON + crypto.
- **Rationale**: Aligns with Feature 000 research D1 shortlist; one `cargo install --path` or committed binary for CI.
- **Alternatives considered**: Go (similar fit; team may switch in a rare replatform).

### R2 — Deterministic JSON serialization

- **Decision**: Build the emitted `serde_json::Value` (or domain structs using **`BTreeMap`** for all map-like fields) and serialize with a **canonical** routine: recursive lexicographic key sort on all objects before writing UTF-8 bytes. Alternatively use a small **canonical JSON** helper crate if it matches RFC 8785-style output; document exact crate/version in `Cargo.lock`.
- **Rationale**: Feature 000 D3 requires stable key order at every object level.

### R3 — Feature array order

- **Decision**: Emit `features` sorted by **`id`** ascending (lexicographic).
- **Rationale**: Stable order for diffs and golden files.

### R4 — Exit codes

- **Decision**: `0` = success and `validation.passed == true`; `1` = validation failed (`validation.passed == false`); `2` = usage / CLI error; `3` = I/O or internal error. (Adjust if POSIX conventions need refinement—document in README.)

### R5 — `inputRoot` MVP

- **Decision**: Single mode: compiler assumes **current working directory is repository root**; `build.inputRoot` is always **`"."`** after normalization. No `--root` flag in MVP unless scope expands mid-implementation (prefer deferring).

- **Rationale**: Feature 000 D8 canonical case; avoids inconsistent consumer behavior.

### R7 — `contentHash` inputs (ties to FR-007)

- **Decision**: MVP compiler hashes **only** the contents of discovered `specs/<NNN>-*/spec.md` files per Feature 000 D2. It does **not** read Feature 000 JSON Schema files at runtime for hashing (schemas are validated externally or in tests).
- **Rationale**: Keeps FR-007 non-elastic; schema files are contract artifacts, not compilation inputs unless we later embed validation in-process.

### R6 — V-004 scan roots

- **Decision**: Walk from repo root (cwd), **do not descend** into `.git/`, `.github/`, `build/`, `target/`, `node_modules/`, `vendor/`, `.idea/`, etc. Scan **all** remaining paths for `*.yaml` / `*.yml` **files** (not only `specs/`).
- **Rationale**: Feature 000 default policy is repo-wide authored surface; matches D4 spirit. **`.github/` is excluded** so CI workflow YAML (e.g. GitHub Actions) does not collide with V-004—those files are repository tooling, not platform feature specs.

## Open items

- Exact crate names for frontmatter splitting (evaluate `matter`, `serde_yaml` security posture).
- Whether to embed `specVersion` from compiler crate version vs constant in code.
