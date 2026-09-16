---
id: "037-cross-platform-axiomregent"
title: "cross-platform axiomregent binaries"
feature_branch: "037-cross-platform-axiomregent"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
amended: "2026-06-04"
amendment_record: |
  Re-amended 2026-06-04 — axiomregent demotion. axiomregent is demoted from a
  standalone shipped product to an INTERNAL UPSTREAM COMPONENT of OPC: built
  from OPC's own release commit and bundled as a Tauri sidecar by
  release-desktop.yml, never independently published. The cross-platform build
  matrix this spec establishes is unchanged; only its destination changed
  (bundle, not publish). This revises the release framing the prior amendment
  (193-paired-release-cadence) added: the standalone `axiomregent-v*` tag and
  draft release are retired. release-axiomregent.yml is removed; the
  build-axiomregent.yml producer/validator is kept.
authors:
  - "open-agentic-platform"
language: en
summary: >
  Build and bundle axiomregent binaries for all supported desktop platforms
  (macOS arm64/x86_64, Linux x86_64/arm64, Windows x86_64) so that governed
  execution works on every platform instead of degrading to bypass mode on
  non-macOS hosts.
extends:
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: crate, id: axiomregent }
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: directory, path: product/apps/opc/src-tauri/binaries }
---

# Feature Specification: cross-platform axiomregent binaries

> **Status: internal upstream component (amended 2026-06-04).**
> axiomregent is **not** an independently released product. It is an internal
> upstream component of OPC: built from OPC's own release commit and bundled as
> a Tauri sidecar by `release-desktop.yml`. There is **one** release lever —
> OPC — and axiomregent rides its commit. It has no independent product version
> (commit-pinned), no standalone binary, crate, or container. Anyone wanting a
> standalone axiomregent forks the repo and builds it. The cross-platform
> **build** matrix this spec establishes (below) is unchanged; only its
> destination changed — **bundle, not publish**. This retires the standalone
> `axiomregent-v*` tag and draft release that the prior 193 amendment described
> (see [193](../193-paired-release-cadence/spec.md) §3–§5, amended) and removes
> `release-axiomregent.yml`. The per-commit producer/validator
> `build-axiomregent.yml` (and the `ci-axiomregent.yml` check/clippy/test lane)
> are kept — they validate and produce the sidecar; they do not publish a
> product.
>
> _Consequence:_ the duplicate-release-object incident class — two release
> objects colliding on one `axiomregent-v*` tag (e.g. an empty operator-decoy
> draft sharing the tag of a real cut) — is **structurally eliminated**: there
> is no longer a second product release object to collide.
>
> _Provenance & SBOM:_ because the sidecar is built at OPC's release commit and
> bundled (build-ref == bundle-ref), single-commit provenance covers it — no
> standalone attestation span is needed. Its CycloneDX SBOM is generated within
> the desktop release flow and bound into the OPC installer SBOM
> ([117](../117-release-artifact-attestations/spec.md), amended).

## Purpose

Governed execution (Feature 035) routes all agent and Claude Code tool calls through axiomregent's MCP router, which enforces permission flags and safety tiers. However, axiomregent only ships as a macOS arm64 binary (`binaries/axiomregent-aarch64-apple-darwin`). On Windows and Linux the sidecar fails to spawn, the desktop falls back to bypass mode (`--dangerously-skip-permissions`), and the entire governance thesis is inoperative.

This feature builds axiomregent for all five Tauri-supported targets and integrates the binaries into the desktop app's bundling pipeline. The pattern follows `gitctx-mcp` binary resolution (`mcp.rs:29-60`), which already handles all five targets with graceful fallback.

## Scope

### In scope

- **Cross-compile axiomregent** for four targets: `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`. _(Intel Mac `x86_64-apple-darwin` dropped 2026-04-15 — not feasible to maintain; Apple Silicon only.)_
- **Bundle binaries** in `product/apps/opc/src-tauri/binaries/` with Tauri's `{name}-{triple}[.exe]` naming convention.
- **Build script** — a reproducible build/fetch script (following the gitctx-mcp pattern) that can be run locally and in CI.
- **Verify sidecar spawn on Windows** — confirm `spawn_axiomregent` works with the bundled Windows binary (Tauri's `app.shell().sidecar()` resolves `axiomregent` → `axiomregent-x86_64-pc-windows-msvc.exe`).
- **CI pipeline** — GitHub Actions workflow for cross-platform binary builds, triggered on axiomregent crate changes.

### Out of scope

- **axiomregent behavior changes** — the binary itself is unchanged; only the build/bundle pipeline is new.
- **gitctx-mcp cross-platform** — gitctx-mcp resolution code already handles all targets; its binaries are a separate concern (only macOS arm64 is shipped currently, but the code degrades gracefully).
- **Tauri app cross-compilation** — this feature builds only the sidecar binary, not the full desktop app for other platforms.
- **ARM Windows** — not a common development target; omitted for now.

## Requirements

### Functional

- **FR-001**: `product/apps/opc/src-tauri/binaries/` contains axiomregent binaries for all four target triples. Windows binary has `.exe` extension.
- **FR-002**: `spawn_axiomregent()` successfully starts the sidecar on at least macOS arm64 and Windows x86_64, with port discovery completing within 5 seconds.
- **FR-003**: A build script (`scripts/build-axiomregent.sh` or equivalent) can produce binaries for all targets from a single host (using cross-compilation or CI matrix).
- **FR-004**: The governed execution path (Feature 035) works end-to-end on Windows — permission checks, tier enforcement, and audit logging behave identically to macOS.

### Non-functional

- **NF-001**: Binary sizes remain reasonable (< 30 MB per target after stripping). The current macOS binary is ~22 MB.
- **NF-002**: Build script is idempotent and can be run in CI without manual setup beyond standard Rust toolchain installation.

## Architecture

### Binary naming convention (Tauri requirement)

Tauri 2's `app.shell().sidecar("axiomregent")` resolves to `binaries/axiomregent-{target_triple}[.exe]` based on the compile-time target of the Tauri app. The `externalBin` entry in `tauri.conf.json` is already `"binaries/axiomregent"` (no triple suffix) — Tauri appends the suffix automatically.

### Target matrix

| Target triple | OS | Arch | Notes |
|---|---|---|---|
| `aarch64-apple-darwin` | macOS | arm64 | Already exists and verified |
| ~~`x86_64-apple-darwin`~~ | ~~macOS~~ | ~~x86_64~~ | Dropped 2026-04-15 — Intel Mac not feasible to maintain |
| `x86_64-unknown-linux-gnu` | Linux | x86_64 | Most Linux dev machines |
| `aarch64-unknown-linux-gnu` | Linux | arm64 | Linux on ARM (Raspberry Pi, cloud ARM) |
| `x86_64-pc-windows-msvc` | Windows | x86_64 | Windows dev machines |

### Cross-compilation considerations

- **`rusqlite` with `bundled` feature** compiles SQLite from C source. This requires a C cross-compiler for each target (e.g., `x86_64-w64-mingw32-gcc` for Windows from Linux, or MSVC on Windows). The `cross` tool or CI matrix builds per-platform are the standard solutions.
- **`zstd`** also bundles C code. Same cross-compilation constraint.
- **Recommended approach**: CI matrix build (one runner per OS family) rather than single-host cross-compilation. macOS runners for both Apple targets, Linux runner for both Linux targets, Windows runner for Windows target.

### Reference implementation: gitctx-mcp resolution

`mcp.rs:29-60` (`bundled_gitctx_mcp_binary_path()`) demonstrates the pattern:
- `cfg!(target_os, target_arch)` at compile time selects the correct triple suffix
- `.exe` appended on Windows
- Falls back to error if binary not found

axiomregent uses Tauri's `app.shell().sidecar()` instead, which handles resolution automatically. No code changes needed — only binary files.

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Binary directory | `product/apps/opc/src-tauri/binaries/` | Add 4 new binaries |
| Build script | `scripts/build-axiomregent.sh` (new) | Cross-compile for all targets |
| CI workflow | `.github/workflows/build-axiomregent.yml` (new) | Matrix build per platform |
| Tauri config | `tauri.conf.json` | No change needed (`externalBin` already lists `binaries/axiomregent`) |
| Sidecar spawn | `sidecars.rs` | No change needed (Tauri resolves target automatically) |

## Success criteria

- **SC-001**: `spawn_axiomregent()` succeeds on Windows (axiomregent port discovered, governance UI shows connected state).
- **SC-002**: Agent execution on Windows uses governed dispatch (not bypass mode) when axiomregent binary is present.
- **SC-003**: CI workflow produces binaries for all 5 targets on push to axiomregent crate.
- **SC-004**: `execution/verification.md` records commands and results from at least two platforms.

## Contract notes

- The `tauri.conf.json` `externalBin` list does NOT need per-target entries — Tauri appends the target triple automatically. This is verified by the existing macOS behavior.
- Binary size may vary significantly across targets due to different linker behavior and debug info stripping. Document expected sizes after first successful cross-build.
- The `gitctx-mcp` binaries should ideally get the same treatment in a follow-on, but this feature focuses exclusively on axiomregent to unblock governed execution.

## Risk

- **R-001**: C dependency cross-compilation failures (rusqlite, zstd). Mitigation: use CI matrix with native compilers per platform rather than cross-compilation from a single host.
- **R-002**: Tauri sidecar resolution differences on Windows (path separators, `.exe` handling). Mitigation: FR-002 requires explicit Windows verification.
- **R-003**: Binary size bloat on some targets. Mitigation: NF-001 cap at 30 MB; strip debug symbols in release builds.
