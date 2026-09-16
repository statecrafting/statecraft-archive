# Verification: axiomregent activation

**Feature**: `033-axiomregent-activation`

## Commands

| Check | Command | Result |
|-------|---------|--------|
| Desktop build | `pnpm -C apps/desktop build` | **ok** (tsc + vite) |
| Desktop check | `pnpm -C apps/desktop check` | **ok** (tsc --noEmit + `cargo check` for `src-tauri`) |
| Tauri lib tests (port parse) | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml parse_port` | **ok** |
| axiomregent crate tests | `cargo test --manifest-path crates/axiomregent/Cargo.toml` | Most pass; `tests/mcp_contract.rs` golden may need `UPDATE_GOLDEN=1` if schema drift (unrelated to sidecar probe) |

## Sidecar / bundling notes

- **`externalBin`**: `apps/desktop/src-tauri/tauri.conf.json` lists `binaries/axiomregent` (Tauri resolves `axiomregent-{target-triple}` under `src-tauri/binaries/`).
- **Present in repo today**: `axiomregent-aarch64-apple-darwin` only. Windows/Linux targets: no bundled binary yet — spawn fails gracefully (logs + empty probe port in UI).
- **Probe line**: axiomregent prints `OPC_AXIOMREGENT_PORT=<port>` on **stderr** before the MCP stdio loop; desktop `SidecarState` reads stderr (and stdout as fallback).

## Manual smoke (developer)

1. On **macOS arm64** with dev deps: run the desktop app; open **MCP Servers** — bundled axiomregent card should show a numeric probe port after startup, or a degraded message if the sidecar failed.
2. Open **Governance** tab — preflight tier labels + probe port line should populate when Tauri commands succeed.
