---
feature: "037-cross-platform-axiomregent"
---

# Tasks: cross-platform axiomregent binaries

## Implementation

- [x] **T001** — Create build script for axiomregent cross-compilation
  - `scripts/build-axiomregent.sh`
  - Supports `--all` for all targets, specific triples, or auto-detects host
  - Uses `cargo build --release --target <triple>` with appropriate toolchains
  - Strips debug symbols on Unix targets

- [x] **T002** — Build Windows x86_64 binary locally
  - `cargo build --release --target x86_64-pc-windows-msvc` (from `crates/axiomregent/`)
  - Copied to `product/apps/opc/src-tauri/binaries/axiomregent-x86_64-pc-windows-msvc.exe`
  - Binary runs: MCP initialize handshake succeeds, tools/list returns all 21 tools
  - Size: 7.3 MB (well under 30 MB NF-001 cap)

- [x] **T003** — ~~Build macOS x86_64 binary~~ **DROPPED** (2026-04-15)
  - Target `x86_64-apple-darwin` removed — Intel Mac builds not feasible to maintain
  - CI workflow matrix entry removed; Rust compile-time branches removed

- [ ] **T004** — Build Linux x86_64 and arm64 binaries (CI or cross-compile)
  - Targets: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`
  - Deferred to CI (requires Linux runner + aarch64 cross-compiler)

- [x] **T005** — Verify sidecar spawn on Windows
  - Binary starts and announces `OPC_AXIOMREGENT_PORT=<port>` on stderr
  - MCP `initialize` handshake returns valid response with protocol version 2024-11-05
  - `tools/list` returns all 21 router tools
  - Port discovery protocol works identically to macOS pattern
  - Agent crate tests: 13 passed (ToolTier rename fix included)
  - Axiomregent crate tests: 42 passed (all suites green)

- [x] **T006** — Create CI workflow for cross-platform builds
  - `.github/workflows/build-axiomregent.yml`
  - Matrix: macOS (arm64), Ubuntu (x86_64), Windows (x86_64)
  - Separate job for Linux arm64 (cross-compilation with aarch64-linux-gnu-gcc)
  - Triggered on push/PR to axiomregent or dependency crates
  - Uploads binaries as artifacts

- [x] **T007** — Document binary sizes and verification results
  - Windows x86_64: 7.3 MB (release, not stripped — MSVC default)
  - macOS arm64: 22.2 MB (existing, pre-037)
  - NF-001: all under 30 MB cap

## Closure

- [x] **T008** — Update `execution/verification.md` with test commands and results
- [x] **T009** — Run `spec-compiler compile` to update registry

## Notes

- **Stale `Tier` import fixed** — `crates/agent/src/agent.rs:8` still imported the old `Tier` name (removed in Feature 036 wide pass). Updated to `ToolTier`. This was a 036 residual, not a 037 issue.
- **T003 dropped** — Intel Mac (`x86_64-apple-darwin`) target removed from all workflows and Rust code on 2026-04-15. Not feasible or realistic to maintain.
- **T004 deferred to CI** — Linux targets cannot be cross-compiled from Windows due to C dependencies (rusqlite bundled, zstd). The CI workflow handles these via platform-native runners.
