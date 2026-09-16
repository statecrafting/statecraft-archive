---
feature_id: "033-axiomregent-activation"
---

# Changeset

## Scope

Activate axiomregent sidecar at startup, document probe port on stderr, surface status in MCP + governance UI, add preflight tier reference command.

## Files touched

| Area | Path |
|------|------|
| Spawn | `apps/desktop/src-tauri/src/lib.rs` — `spawn_axiomregent` after `SidecarState` |
| Sidecar | `apps/desktop/src-tauri/src/sidecars.rs` — stderr/stdout parse, `parse_axiomregent_port_line`, unit tests |
| Binary | `crates/axiomregent/src/main.rs` — local TCP probe + `eprintln!(OPC_AXIOMREGENT_PORT=…)` |
| Commands | `apps/desktop/src-tauri/src/commands/analysis.rs` — `get_preflight_safety_tier_reference` |
| Bindings | `apps/desktop/src-tauri/src/bindings.rs`, `apps/desktop/src/lib/bindings.ts` |
| API | `apps/desktop/src/lib/api.ts` |
| UI | `apps/desktop/src/components/MCPManager.tsx`, `apps/desktop/src/features/governance/GovernanceSurface.tsx` |
| Spec | `specs/033-axiomregent-activation/spec.md`, `tasks.md`, this folder |

## Verification

See [verification.md](./verification.md).
