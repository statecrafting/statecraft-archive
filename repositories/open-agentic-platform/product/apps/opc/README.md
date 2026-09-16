# OPC desktop (`@opc/desktop`)

Tauri + React workspace for the OPC desktop shell (inspect, governance, git context, and related tabs).

## Prerequisites

- [Rust](https://rust-lang.org/) (for `src-tauri`)
- [pnpm](https://pnpm.io/) from the repo root

## Common commands

```bash
pnpm -C apps/desktop build
pnpm -C apps/desktop test
pnpm -C apps/desktop tauri dev
```

Typecheck + Rust check: `pnpm -C apps/desktop check`

## Inspect and governance (Feature 032)

1. **Compile the registry** (repo root) so `.derived/spec-registry/` exists. Run `spec-spine compile` or `make registry` from the repo root (see the root [`README.md`](../../README.md)).

2. **Inspect (Xray)** — open the **Xray** tab, enter an **absolute path** to a project root, and run **Scan project**. After a successful scan, a **Follow-up** section may list **View spec** actions when the compiled registry includes feature `specPath` entries for that repo.

3. **Governance** — open the **Governance** tab, enter the repository root (or leave empty to use the current working directory), and **Load governance**. The panels show compiled registry summary and featuregraph status (featuregraph may be unavailable if `spec/features.yaml` is missing — a bounded degraded state). When the registry is **ok**, use **View spec** to open a feature’s `spec.md` in the in-app markdown editor tab.

4. **Git context** — open the **Git Context** tab for native branch/status; optional axiomregent GitHub tools enrichment is additive only.

Follow-up actions use registry data only (no separate task system in the UI). Canonical tasks and status remain in `specs/.../tasks.md`.
