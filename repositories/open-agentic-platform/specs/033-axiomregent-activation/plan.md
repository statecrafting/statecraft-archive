# Implementation Plan: axiomregent activation

**Spec**: [spec.md](./spec.md)  
**Feature**: `033-axiomregent-activation`

## Summary

Wire **`spawn_axiomregent`** into **`lib.rs`** startup, validate **bundling** and **port discovery**, then incrementally **surface** tools and safety-tier information in the desktop UI. Keep each PR reviewable and reversible.

## Sequencing

| Phase | Focus |
|-------|--------|
| **1** | Startup spawn + logging; gate with feature flag if needed |
| **2** | Verification matrix per OS; fix packaging gaps |
| **3** | MCP UI surfacing for axiomregent tools |
| **4** | Safety tier read-only display |

## Risks

- Sidecar binary missing on a platform → must degrade gracefully (FR-002).
- Port parsing race → reuse existing patterns in `sidecars.rs`.

## References

- `product/apps/opc/src-tauri/src/sidecars.rs` — `spawn_axiomregent`
- `product/apps/opc/src-tauri/tauri.conf.json` — `externalBin`
- `crates/axiomregent/` — router and tools
