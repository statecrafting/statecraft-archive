# Spec 108 — Implementation Audit

> Audit performed on 2026-05-01 against the current state of the working tree.
> Result: Phases 1–4 are substantially complete. Phase 2 §8 removals (delete
> `factory/` from repo root) is the only remaining blocker. The spec lifecycle
> is still `status: draft, implementation: in-progress` and must be flipped
> after the removals land and CI is green.
>
> **§3 superseded by [spec 139](../139-factory-artifact-substrate/spec.md)
> (Phase 4, 2026-05-05).** The `factory_adapters` / `factory_contracts` /
> `factory_processes` bucket-blob trio was retired by migration 34. The
> data lives in `factory_artifact_substrate` post Phase 1 dual-write
> + Phase 4 cutover; consumers project the legacy wire shape via
> `loadSubstrateForOrg` + `projectSubstrateToLegacy` so spec 108's
> `/api/factory/{adapters,contracts,processes}` endpoints continue to
> serve byte-stable responses. Spec 108's external API surface is
> preserved; the storage primitive is replaced. See spec 139 §2.1 for
> the substrate row shape and §10 for the symmetry table.

## Section coverage matrix

| Spec section | Status | Notes |
|--------------|--------|-------|
| §3 Data Model | ✅ complete | Schema in `api/db/schema.ts:751–815`; migrations 18 (factory tables) and 19 (PAT + sync_runs). Spec 109 added `factory_sync_runs` and `factory_upstream_pats` on top. |
| §4 Encore APIs | ✅ complete | All 9 endpoints exist (see below). Auth uses `getAuthData()`; mutations gated by `hasOrgPermission(role, "factory:configure")`. |
| §5 Sync Flow | ✅ complete | `runSyncPipeline` in `api/factory/syncPipeline.ts` does clone → translate → upsert with prune. Async via `FactorySyncRequestTopic` (spec 109 §5). |
| §6 UI | ✅ complete | All 5 routes present (Overview, Upstreams, Adapters, Contracts, Processes); top-level nav entry in `app.tsx:35`. |
| §7 OPC contract | ⚠ punted | OPC desktop still calls `resolve_factory_root()` in `product/apps/opc/src-tauri/src/commands/factory.rs:600`. Documented as a follow-up below. |
| §8 Removals | ❌ pending | `factory/` directory still present at repo root; `.claude/commands/factory-sync.md` already deleted. |

## §3 Data Model — concrete location

```
platform/services/statecraft/api/db/schema.ts
  751–767   factoryUpstreams       (org_id PK)
  769–783   factoryAdapters        (unique on org_id, name)
  785–799   factoryContracts       (unique on org_id, name, version)
  801–815   factoryProcesses       (unique on org_id, name, version)
  858–877   factoryUpstreamPats    (spec 109 §6)
  900–921   factorySyncRuns        (spec 109 §5)

platform/services/statecraft/api/db/migrations/
  18_factory_platform_feature.up.sql       — 4 spec-108 tables
  19_factory_pat_and_sync_runs.up.sql      — spec-109 PAT + sync_runs
  20_factory_pipeline_source.up.sql        — downstream column adds
```

Verdict: schema is complete and additionally enriched by spec 109. No gaps.

## §4 Encore APIs — endpoint matrix

| Spec method+path | File / handler | Status |
|------------------|----------------|--------|
| `GET  /api/factory/upstreams` | `upstreams.ts:getUpstreams` | ✅ |
| `POST /api/factory/upstreams` | `upstreams.ts:upsertUpstreams` (admin gate) | ✅ |
| `POST /api/factory/upstreams/sync` | `sync.ts:syncUpstreams` (admin gate, async via PubSub per spec 109) | ✅ |
| `GET  /api/factory/upstreams/sync/:id` | `syncRuns.ts:getFactorySyncRun` | ✅ |
| `GET  /api/factory/upstreams/sync` (list) | `syncRuns.ts:listFactorySyncRuns` (extra surface for the run history table) | ✅ |
| `GET  /api/factory/adapters` | `browse.ts:listAdapters` | ✅ |
| `GET  /api/factory/adapters/:name` | `browse.ts:getAdapter` | ✅ |
| `GET  /api/factory/contracts` | `browse.ts:listContracts` | ✅ |
| `GET  /api/factory/contracts/:name` | `browse.ts:getContract` | ✅ |
| `GET  /api/factory/processes` | `browse.ts:listProcesses` | ✅ |
| `GET  /api/factory/processes/:name` | `browse.ts:getProcess` | ✅ |

Auth: every endpoint declares `auth: true`; all reads call `getAuthData()` and
filter by `auth.orgId`. Admin-only mutations use `hasOrgPermission(role,
"factory:configure")` rather than role string comparison.

Spec 109 layered additional surfaces (`factory.ts`, `oapContracts.ts`,
`upstreamPat.ts`, `tokenResolver.ts`, `events.ts`, `clone.ts`) on top — they
fall under spec 109 but are required for spec 108 §5 to function (the sync
worker uses `resolveFactoryUpstreamToken` and `withClonedRepo`).

## §5 Sync Flow — pipeline

`api/factory/syncPipeline.ts:runSyncPipeline` performs:

1. `withClonedRepo(...)` for both `factorySource` and `templateSource`
   (clone.ts uses the resolved PAT from `tokenResolver.ts`).
2. `translateUpstreams(...)` walks the layouts and builds:
   - one `factoryProcesses` row (`7-stage-build`) derived from the factory
     source's Factory Agent tree;
   - one `factoryAdapters` row (`acme-vue-node`) derived from the template
     repo's orchestration tree;
   - one `factoryContracts` row per `*.schema.{json,yaml,yml}` discovered.
3. `applyTranslation(...)` upserts adapters/contracts/processes inside a
   single transaction and prunes rows no longer present upstream.
4. The PubSub worker (`syncWorker.ts`) updates `factory_sync_runs` and the
   denormalised `last_sync_*` columns on `factory_upstreams`, plus emits an
   audit log entry.

The "should sync run inline or as a PubSub job?" §10 open question is
answered by spec 109 § 5: PubSub. The Phase 3 capability is wired and reachable
from the Overview tile / "Sync now" button; the run-id polling pattern is
implemented in `app.factory._index.tsx:useSyncRunPolling`.

## §6 UI — route inventory

| Tab | Route file | Verdict |
|-----|-----------|---------|
| Overview | `app.factory._index.tsx` | ✅ counts, last-sync banner, "Sync now", recent runs table |
| Upstreams | `app.factory.upstreams.tsx` | ✅ form + PAT section (spec 109 §6) |
| Adapters | `app.factory.adapters.tsx` + `components/factory-browser.tsx` | ✅ list + detail drawer |
| Contracts | `app.factory.contracts.tsx` + browser | ✅ |
| Processes | `app.factory.processes.tsx` + browser | ✅ |
| Shell + tabs | `app.factory.tsx` | ✅ NavLink tab strip |
| Top-level nav | `app.tsx:35` | ✅ "Factory" appears in the platform nav |

Phase 1 (route shell + Overview placeholder), Phase 2 (DB schema + Upstreams
form), Phase 3 (sync worker + Sync now button), Phase 4 (browsers) are all
already wired.

## §7 OPC interface contract — punt

`rg "factory/(adapters|contracts|process|upstream-map)" apps/ crates/` returns:

| Site | What it does | Disposition |
|------|--------------|-------------|
| `product/apps/opc/src-tauri/src/commands/factory.rs:600 resolve_factory_root` | Walks up from the desktop binary's manifest dir to find `factory/adapters/`. | **Punt.** Migration to platform API fetches is out of scope for spec 108; tracked as follow-up. See Punt note below. |
| `crates/factory-engine/src/engine.rs:54` | Default `FactoryEngineConfig::factory_root = "factory"`. | The engine still takes `factory_root` as input; the type signature does not assume the in-tree path. Punt covers this. |
| `crates/factory-engine/src/preflight.rs:442` | Test-only path under `#[cfg(test)]` that early-returns when fixture is absent. | No change needed; deletion of `factory/` causes the test to skip cleanly. |
| `crates/factory-engine/tests/integration_078_e2e.rs:48,98` | Integration tests guarded by `factory_root().join("adapters/acme-vue-node").exists()`. | Skip cleanly on missing dir. |
| `crates/factory-contracts/src/adapter_registry.rs:440,456,487` | Three `#[cfg(test)]` real-fixture tests guarded by `if !factory_root.exists() { return; }`. | Skip cleanly. |
| `crates/factory-contracts/src/agent_loader.rs:6–7`, `crates/factory-contracts/src/adapter_registry.rs:6–7`, `crates/agent-frontmatter/src/types.rs:277` | Doc-comment references describing `factory/` layout. | Update wording so docs no longer claim the path is in-tree. |

**Punt: OPC factory-run migration.** The desktop's `commands/factory.rs`
runs a 7-stage local pipeline by reading `factory/adapters/...` directly off
the developer machine. Migrating that to fetch adapter/contract/process
definitions from the new `/api/factory/*` endpoints is a separate effort with
a meaningful surface area (auth, caching, run state, offline behaviour).
Rather than block spec 108 on it, spec 108 §7 carries this punt explicitly:
the API contract is shipped and ready, and the desktop migration will land
under a follow-up spec referencing 108 §7. Until then, OPC factory runs
require a developer to keep a local clone of the `legacy-factory`
repo and point `resolve_factory_root` at it.

This audit retains the existing `resolve_factory_root` implementation and
adds a `// TODO(spec-108-§7-punt)` note pointing at the follow-up.

## §8 Removals — actual state

| Spec target | State |
|-------------|-------|
| `factory/adapters/**` | present (4 dirs: acme-vue-node, encore-react, next-prisma, rust-axum) |
| `factory/contract/**` | present |
| `factory/process/**` | present |
| `factory/upstream-map.yaml` | present |
| `factory/docs/**` | present (5 markdown files) — migrate to `platform/services/statecraft/docs/factory/` |
| `factory/README.md` | present — included in deletion |
| `.claude/commands/factory-sync.md` | already removed |

Steps to take:

1. Migrate `factory/docs/*.md` → `platform/services/statecraft/docs/factory/`,
   adjusting any intra-doc links so relative paths still resolve.
2. Delete the entire `factory/` directory (`adapters`, `contract`, `process`,
   `docs`, `upstream-map.yaml`, `README.md`, `.gitignore`, `.DS_Store`).
3. Touch up the three doc-comments in `crates/factory-contracts/src/{agent_loader,adapter_registry}.rs`
   and `crates/agent-frontmatter/src/types.rs` so the doc no longer asserts an
   in-tree location for the factory.
4. Run `make registry` to refresh `.derived/codebase-index/index.json` (paths
   under `factory/` will drop out of the inventory) and `make ci-statecraft`
   plus `make ci-rust` and `make ci-tools` to confirm no consumer regresses.

## Phase boundaries for implementation

Because phases 1–4 are already shipped on `main`, the per-phase commit trail
the plan calls for collapses: there is nothing left to implement for phases
1–4 beyond a quality-gate run. The remaining work breaks down as:

- **No-op verification commits** for phases 1–4 are not appropriate (no
  diff). Instead, run the gates and commit only when there is an actual change.
- **Phase 2 removals** (the only outstanding code work) ships as the
  `chore(repo): retire in-tree factory/ directory (spec 108 §8)` commit and
  carries the doc-migration + doc-comment touch-ups.
- **Lifecycle flip** ships as the `feat(specs): mark spec 108 approved + complete; refresh registry`
  commit after `make ci` is green.

Net commit count on this branch: 2 (removals + lifecycle flip), not 5–6 as the
plan anticipated. The plan's per-phase commit cadence assumed phases 1–4 were
greenfield.
