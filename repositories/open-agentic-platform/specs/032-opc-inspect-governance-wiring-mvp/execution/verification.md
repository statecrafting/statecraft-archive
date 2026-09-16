# Verification: OPC inspect + governance wiring

Date: 2026-03-23 (updated 2026-03-28 — T010–T013 closure recorded)  
Feature: `032-opc-inspect-governance-wiring-mvp`

## PR-1 — T000a baseline evidence (fill on import PR)

Record **before** any Feature 032 product wiring (T003+). Goal: prove imported trees are present and minimally healthy; behavior-neutral except required shims.

| Check | Command / how | Result (pass / fail / skip) | Notes |
|-------|----------------|-----------------------------|-------|
| Desktop frontend install | `pnpm -C apps/desktop install --no-frozen-lockfile` | fail | Missing workspace packages (`@opc/types@workspace:*` not present in this repo yet). |
| Desktop frontend build | `pnpm -C apps/desktop build` | skip | Build blocked because install step fails from unresolved workspace dependencies. |
| Tauri / backend compile | `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` | fail | Desktop backend depends on crates not yet imported (`crates/agent` and peers missing). |
| `packages/mcp-client` in workspace | `test -f packages/mcp-client/package.json && test -f packages/mcp-client/src/index.ts` | pass | Package path present after import; workspace resolution remains degraded until workspace files/deps are consolidated. |
| Baseline tests | `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all --quiet` | pass | Existing pre-import repo baseline remains green for current toolchain surface (non-desktop path). |
| Temporary shims / path fixes | N/A — prose | pass | None applied in this PR slice yet. |
| Known non-032 breakages | N/A — prose | pass | Degraded baseline is bounded to missing consolidated workspace dependencies/crates required by imported desktop trees. |

### Freeform: import-only fixes

- Imported trees only:
  - `apps/desktop/**`
  - `packages/mcp-client/**`
- No inspect/git/governance feature behavior changes in this baseline capture step.

---

## PR-1.1 — T000a baseline rerun (consolidation follow-up)

**Goal:** restore workspace + crate resolution so desktop install/build and Tauri compile succeed, without Feature 032 product behavior.

| Check | Command / how | Result (pass / fail / skip) | Notes |
|-------|----------------|-----------------------------|-------|
| Workspace root | `pnpm-workspace.yaml` lists `apps/*`, `packages/*` | pass | Added at repo root. |
| Desktop frontend install | `pnpm install --no-frozen-lockfile` (repo root) | pass | After importing `packages/types`, `packages/ui`. |
| Desktop frontend build | `pnpm -C apps/desktop build` | pass | `tsc && vite build` completed. |
| Tauri / backend compile | `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` | pass | After importing `crates/*`, `grammars/*`, and aligning `tauri` `macos-private-api` with `tauri.macos.conf.json`. |
| `packages/mcp-client` in tree | path check | pass | Unchanged from PR-1. |
| Baseline tests | `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all --quiet` | pass | Still green. |

### Import-only changes (PR-1.1)

- `pnpm-workspace.yaml`, `pnpm-lock.yaml` (lockfile from root `pnpm install`)
- `packages/types/**`, `packages/ui/**` from OPC
- `crates/{agent,asterisk,axiomregent,blockoli,featuregraph,gitctx,run,stackwalk,titor,xray}/**` from OPC
- `grammars/tree-sitter-{c,javascript,python,rust,typescript}/**` from OPC (required by `asterisk` / `stackwalk` / `blockoli` build)
- `apps/desktop/src-tauri/Cargo.toml`: consolidation-only `tauri` feature alignment (`macos-private-api` on main `tauri` dependency; removed duplicate macOS-only `tauri` dep line) so `tauri-build` matches `tauri.macos.conf.json` allowlist

### Freeform: PR-1.1

- No T003+ inspect/git/governance/action wiring.

---

## PR-1.2 — spec-compiler V-004 conformance (governance CI)

**Symptom:** CI `spec-compiler` job failed at **Emit registry (smoke)** (`spec-compiler compile` exit code 1) after consolidation added root `pnpm-workspace.yaml` / `pnpm-lock.yaml` and large imported trees.

**Root cause:** V-004 walks the repo for standalone `.yaml` / `.yml` files. Root pnpm workspace files are package-manager / lockfile material, not authored spec YAML. Imported `apps/`, `crates/`, `grammars/`, `packages/` trees are outside the spec authoring surface and must not trip governance scans.

**Fix (consolidation-only):** Narrow V-004 scan in `tools/spec-compiler` — skip consolidated product/vendor directory names; exempt root `pnpm-workspace.yaml` and `pnpm-lock.yaml`. Added `tools/spec-compiler/tests/v004_consolidation_excludes.rs`.

| Check | Command / how | Result (pass / fail) | Notes |
|-------|----------------|----------------------|-------|
| Spec compiler | `cargo build --release --manifest-path tools/spec-compiler/Cargo.toml && ./tools/spec-compiler/target/release/spec-compiler compile` | pass | Exit code 0; `validation.passed` true. |
| Spec-compiler tests | `cargo test --manifest-path tools/spec-compiler/Cargo.toml` | pass | Includes new V-004 consolidation test. |

### Freeform: PR-1.2

- No Feature 032 product behavior; compiler boundary fix only.

---

## PR-2 — T003 inspect shell only (`feat/032-pr2-inspect-shell`)

**Scope:** Typed inspect flow + `InspectSurface` for the existing Xray tab entry (`createXrayTab` → `XrayPanel` → `xray_scan_project`). **Out of scope:** git/governance hydration, follow-up actions, T004–T011.

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop build | `pnpm -C apps/desktop build` | pass |
| Spec compiler | `./tools/spec-compiler/target/release/spec-compiler compile` | pass (after rebuild if needed) |
| Registry consumer tests | `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all --quiet` | pass |

**Touchpoints:** `apps/desktop/src/features/inspect/{types.ts,xrayResult.ts,useInspectFlow.ts,InspectSurface.tsx}`, `apps/desktop/src/components/XrayPanel.tsx`.

---

## PR-3 — Git context panel (`feat/032-pr3-git-context`)

**Scope (user milestone T004–T005: git hydration only):** Native git via Tauri `commands` — **no** governance, **no** inspect refactors, **no** MCP/sidecar in this PR (T006 remains).

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop build | `pnpm -C apps/desktop build` | pass |
| Spec compiler | `./tools/spec-compiler/target/release/spec-compiler compile` | pass |
| Registry consumer tests | `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all --quiet` | pass |

**Touchpoints:** `apps/desktop/src/features/git/{types.ts,useGitContext.ts,GitContextSurface.tsx}`, `apps/desktop/src/components/GitContextPanel.tsx`.

**Behavior:** `idle` / `loading` / `success` / `error` / `unavailable` (not a repo) / `degraded` (partial, e.g. ahead/behind failed). Branch name shown when not detached; `(detached)` when `DetachedHead`; dirty/clean from status entries; ahead/behind when upstream resolvable.

---

## PR-4 — T006 gitctx MCP enrichment (`feat/032-pr4-t006-gitctx-sidecar`, merged)

**Scope:** T006 — Rust-owned per-request stdio MCP bridge to bundled `gitctx-mcp` (`commands/mcp.rs`); `@opc/mcp-client` wraps Tauri commands; additive enrichment via `useGitCtxEnrichment` + `GitContextSurface`. **Not** port-based gitctx readiness; `get_sidecar_ports` remains for axiomregent-class sidecars only. Native git (PR-3) stays source-of-truth.

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop check | `pnpm -C apps/desktop check` | pass (at merge; re-run after pull) |
| Spec compiler | `./tools/spec-compiler/target/release/spec-compiler compile` | pass (when run in CI / locally) |

**Touchpoints:** `apps/desktop/src-tauri/src/commands/mcp.rs`, `packages/mcp-client/src/index.ts`, `apps/desktop/src/features/git/useGitCtxEnrichment.ts`, `GitContextSurface.tsx`, `sidecars.rs` (gitctx port removed), `execution/t006-checklist.md`, `tasks.md`.

**Merge:** [PR #4](https://github.com/statecrafting/open-agentic-platform/pull/4) to `main` (2026-03-26).

---

## PR-5 — T004/T005 inspect journey wiring (`feat/032-t004-t005-inspect-wiring`)

**Scope:** Wire inspect entrypoint through shared adapter path and replace inspect success/degraded placeholder JSON rendering with explicit hydrated inspect panels. Keep bounded explicit degraded/error states.

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop build | `pnpm -C apps/desktop build` | pass |
| Lint status (touched files) | `ReadLints` scoped to `apps/desktop/src/features/inspect/InspectSurface.tsx`, `apps/desktop/src/features/inspect/useInspectFlow.ts`, `apps/desktop/src/lib/apiAdapter.ts` | pass (no lints) |
| Type status (touched files) | Included in `pnpm -C apps/desktop build` via `tsc` | pass |

**Touchpoints:** `apps/desktop/src/features/inspect/{InspectSurface.tsx,useInspectFlow.ts}`, `apps/desktop/src/lib/apiAdapter.ts`, `specs/032-opc-inspect-governance-wiring-mvp/{tasks.md,execution/changeset.md,execution/verification.md}`.

**Test note:** `apps/desktop/src/features/inspect/__tests__/InspectSurface.test.tsx` did not exist before this slice and remains pending (not added in PR-5).

---

## PR-6 — T008/T009 governance wiring (`feat/032-t008-t009-governance-wiring`)

**Scope:** Replace governance placeholders with real hydrated panels using adapter-routed reads and backend analysis commands; keep compiled registry and featuregraph outputs authoritative with explicit degraded/unavailable/error states.

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop build | `pnpm -C apps/desktop build` | pass |
| Tauri backend compile check | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | pass |
| Targeted backend tests | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::analysis::tests:: -- --nocapture` | pass |
| Lint status (touched files) | `ReadLints` scoped to governance/UI/backend touched files | pass (no lints) |
| Type status (touched files) | Included in `pnpm -C apps/desktop build` via `tsc` | pass |

**Touchpoints:** `apps/desktop/src/components/GovernancePanel.tsx`, `apps/desktop/src/features/governance/{GovernanceSurface.tsx,useGovernanceStatus.ts}`, `apps/desktop/src/lib/apiAdapter.ts`, `apps/desktop/src-tauri/src/commands/analysis.rs`, `specs/032-opc-inspect-governance-wiring-mvp/{tasks.md,execution/changeset.md,execution/verification.md}`.

**Behavior notes:** Governance panel now renders structured registry/featuregraph summaries on success; unavailable sources are surfaced as bounded degraded states with source-specific reasons (registry missing, featuregraph unavailable, parse/read failures).

---

## PR-2+ — Feature 032 implementation commands

```bash
# Feature wiring: add package-specific test/build commands per PR.
```

## Results

- PR-1 baseline: preserved above (degraded truth at merge time).
- PR-1.1 baseline: **T000a green** for desktop install, desktop build, and Tauri compile on this host.
- PR-1.2: **spec-compiler compile green** (governance CI smoke unblocked).
- PR-2: **T003 complete** — inspect shell states + real `xray_scan_project` path via `useInspectFlow` / `InspectSurface`.
- PR-3: **Git context panel** — native `git_*` bindings + typed UI states (`GitContextSurface`).
- PR-4: **T006 complete** — gitctx MCP enrichment (Rust stdio bridge + additive UI); see PR-4 section above.
- PR-5: **T004/T005 complete** — inspect entrypoint routed via shared adapter; inspect success/degraded surfaces hydrated with explicit panels; degraded/error behavior remains bounded and explicit.
- PR-6: **T008/T009 complete** — governance surface wired to backend overview; compiled registry + featuregraph hydration with explicit degraded/unavailable/error states and no action-flow wiring.
- Consolidation gate: **T000 complete**, **T000a complete** after PR-1.1 (full baseline checks green where applicable); **spec registry emission** restored after PR-1.2.

---

## T010–T013 — Action, docs, targeted tests, full verification (`main`, 2026-03-28)

**Scope:** “View spec” follow-up from compiled registry (`featureSummaries` in `featuregraph_overview` / `read_registry_summary`), markdown editor tab for arbitrary spec paths, operator docs, Vitest coverage, recorded green run.

| Check | Command / how | Result |
|-------|----------------|--------|
| Desktop build | `pnpm -C apps/desktop build` | pass |
| Desktop unit tests | `pnpm -C apps/desktop test` | pass (6 tests) |
| Tauri backend check | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | pass |
| Analysis registry tests | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml commands::analysis::tests::` | pass |
| Registry consumer | `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all --quiet` | pass |
| Spec compiler smoke | `cargo build --release --manifest-path tools/spec-compiler/Cargo.toml && ./tools/spec-compiler/target/release/spec-compiler compile` | pass |

**Product notes:** When `spec/features.yaml` is absent, featuregraph overview remains **unavailable** while the compiled registry can still be **ok** — this is a **bounded degraded** state (FR-003), not a verification failure.

**Touchpoints:** `apps/desktop/src-tauri/src/commands/analysis.rs` (`featureSummaries`), `apps/desktop/src/features/inspect/{actions.ts,RegistrySpecFollowUp.tsx,InspectSurface.tsx}`, `apps/desktop/src/features/governance/GovernanceSurface.tsx`, `apps/desktop/src/components/MarkdownEditor.tsx`, `apps/desktop/src/hooks/useTabState.ts`, `apps/desktop/README.md`, root `README.md`.
