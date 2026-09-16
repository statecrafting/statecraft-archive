---
feature: "037-cross-platform-axiomregent"
---

# Changeset: cross-platform axiomregent binaries

## Files changed

### New files
- `apps/desktop/src-tauri/binaries/axiomregent-x86_64-pc-windows-msvc.exe` — Windows x86_64 axiomregent binary (7.3 MB)
- `scripts/build-axiomregent.sh` — Build script for axiomregent cross-compilation (host, --all, or specific targets)
- `.github/workflows/build-axiomregent.yml` — CI workflow for matrix builds (macOS, Linux, Windows + Linux arm64 cross-compile)

### Modified files
- `crates/agent/src/agent.rs:8` — Fixed stale `Tier` → `ToolTier` import (Feature 036 residual)
- `crates/agent/src/agent.rs:115` — Fixed stale `Tier` → `ToolTier` parse type
- `specs/037-cross-platform-axiomregent/spec.md` — Promoted from draft to active
- `specs/037-cross-platform-axiomregent/tasks.md` — Task completion recorded
- `specs/037-cross-platform-axiomregent/execution/verification.md` — Test results recorded

### No changes needed
- `apps/desktop/src-tauri/tauri.conf.json` — `externalBin` already lists `binaries/axiomregent` (Tauri appends target triple automatically)
- `apps/desktop/src-tauri/src/sidecars.rs` — `spawn_axiomregent` uses Tauri's `app.shell().sidecar()` which resolves platform automatically
