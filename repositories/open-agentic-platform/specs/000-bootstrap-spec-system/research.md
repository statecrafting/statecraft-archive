# Research: Bootstrap spec system

**Feature**: `000-bootstrap-spec-system`  
**Date**: 2026-03-22

## Decisions

### D1 — Compiler implementation language

- **Decision**: Defer binding choice until first implementation task; **default shortlist**: Rust or Go for static binaries and predictable UTF-8 handling.
- **Rationale**: Determinism and single-binary distribution matter for CI; both ecosystems have mature JSON and crypto libraries.
- **Alternatives considered**: Python (faster iteration, higher risk of nondeterminism unless carefully pinned); TypeScript on Node (acceptable if pinned lockfile and fixed JSON stringify — slightly higher drift risk).

### D2 — Canonicalization for hashing

- **Decision**: Hash **normalized text** per file: UTF-8 without BOM; LF newlines; for each file, `path + "\0" + normalized_content` concatenated in **sorted path order**, then SHA-256 hex digest for `build.contentHash`.
- **Rationale**: Stable across OSes when authors use `.gitattributes` for line endings; path-sorted concatenation avoids directory walk order issues.
- **Alternatives considered**: Git tree hash (ties compiler to git presence — rejected for bootstrap MVP).

### D3 — JSON key ordering

- **Decision**: Emit JSON with **lexicographically sorted keys** at every object level (recursive).
- **Rationale**: Simplest portable approach to byte-identical output without relying on a specific library default.

### D4 — Forbidden YAML scope

- **Decision**: **V-004** applies to the **entire repository tree** except: `.git/`, dependency directories (`node_modules/`, `vendor/`, language package caches), and **explicitly listed** third-party subtrees if ever added (must be named in `spec-compiler` config markdown in a later amendment).
- **Rationale**: Maximizes alignment with “no authored YAML”; narrows only when a vendored dependency forces YAML and cannot be subtree-excluded.

### D5 — Relationship to legacy `opc`

- **Decision**: Treat `opc` crates **axiomregent**, **xray**, **featuregraph** as **capability hints**: governance MCP, repo scanning, and feature graph visualization are **not** recreated in Feature 000. Their **future** specs must declare consumption of **`registry.json`**, not YAML registries.
- **Rationale**: Legacy `featuregraph_overview(features_yaml_path: ...)` is a **rejected authoring pattern** for this repo (see main spec).

### D6 — `platform` repo

- **Decision**: No concrete patterns were found under the searched workspace path; no additional legacy constraints adopted. Future discovery of patterns uses the same provenance rules as `opc`.

### D7 — Determinism vs wall-clock timestamps

- **Decision**: **`registry.json`** contains **no** `builtAt`. Wall-clock time lives only in **`build-meta.json`**, which is **compiler-owned** but **not** subject to golden-file byte equality. Golden tests compare **`registry.json`** only.
- **Rationale**: Preserves a single deterministic artifact while still allowing ops to record when a build ran.
- **Alternatives considered**: Deterministic timestamp from last git commit (couples output to VCS); omitting ephemeral file entirely (loses useful CI logs).

### D8 — `build.inputRoot` normalization

- **Decision (bootstrap-level):** The string **`"."`** is the **canonical** `inputRoot` for **full-repository** compilation (CI, golden tests, default CLI). The compiler MUST normalize before emit: **no trailing slash**; **forward slashes only**; **`.`** means repository root as passed to the compiler (see Feature 001 for CLI resolution).
- **Sub-tree compilation:** A later compiler MAY accept a non-`.` root (e.g. a subdirectory) for local iteration; when used, the compiler MUST still emit the **normalized** path string in `inputRoot` and SHOULD document that consumers comparing registries across runs MUST scope comparisons to the same root. Feature 001 MVP SHOULD default to repo-root `.` only and MAY defer sub-tree mode to a patch if needed.
- **Rationale:** Avoids ambiguous `inputRoot` strings (`./` vs `.` vs `specs`) that would make cross-tool comparison brittle.

## Open items (for implementation tasks, not spec ambiguity)

- Exact CLI flags and exit codes for the compiler binary.
- Whether `.derived/spec-registry/` is gitignored entirely or keeps a **committed** golden fixture for tests only.
