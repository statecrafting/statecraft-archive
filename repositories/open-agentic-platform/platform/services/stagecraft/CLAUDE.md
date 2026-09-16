# CLAUDE.md — Statecraft (Encore.ts)

Statecraft is the SaaS control plane built on **Encore.ts**. These conventions apply when working in this directory.

## Framework

- Backend: [Encore.ts](https://encore.dev) — type-safe TypeScript APIs with built-in infra primitives
- ORM: Drizzle (PostgreSQL)
- Frontend: React Router v7 (in `web/`)
- Package manager: **npm** (not pnpm — excluded from root workspace)
- Node.js v20+, ES6+ syntax, `import` only (never `require`)

## Encore.ts Patterns

- Define APIs with `import { api } from "encore.dev/api"` — not raw Express handlers
- Service-to-service calls use `import { serviceName } from "~encore/clients"`
- Auth data accessed via `import { getAuthData } from "~encore/auth"`
- Database access via `new SQLDatabase("name", { migrations: "./migrations" })` from `encore.dev/storage/sqldb`
- PubSub via `new Topic<T>("name", { deliveryGuarantee: "at-least-once" })` from `encore.dev/pubsub`
- Secrets via `secret("SecretName")` from `encore.dev/config`
- Structured logging via `import log from "encore.dev/log"`
- Errors via `APIError` / `ErrCode` from `encore.dev/api`

## Local Dev

```bash
cd platform/services/statecraft && npm run start
# App: http://localhost:4000 | Encore dashboard: http://localhost:9400
```

## Testing

```bash
encore test          # Recommended — sets up test databases, isolated infra per test
npm test             # Direct vitest without infra setup
```

Test API endpoints by calling them directly as functions. Don't mock Encore infrastructure (databases, PubSub) — use the real thing.

## Migrations

SQL files live in `api/db/migrations/`, run by `scripts/migrate.mjs` as a Helm `pre-upgrade` hook (`platform/charts/statecraft/templates/migration-job.yaml`).

**Do not call Postgres `md5()` from migrations.** The Hetzner cluster Postgres is built against a FIPS-mode OpenSSL, so `md5()` returns `could not compute MD5 hash: unsupported` and aborts the migrate Job, blocking the whole upgrade. Use sha256 instead — either `encode(sha256('x'::bytea), 'hex')` (PG 11+ core) or precompute the hash in Node and inline a hex literal. Runtime `content_hash` producers (`api/factory/substrate.ts`, `api/projects/importArtifacts.ts`) already use sha256, so this also keeps migration-seeded values consistent with live ones.

## Reference

For full Encore.ts API reference (APIs, databases, PubSub, streaming, auth, middleware, validation, etc.), see [`docs/encore-ts-reference.md`](docs/encore-ts-reference.md).

## Chart selection and deploy wire contract (spec 136 / 214)

Tenant deploys go through statecraft → `deployd-api-rs`, which since spec 136
Phase 2.b drives Kubernetes via `helm upgrade --install` rather than raw
kube-rs object construction. The chart that gets applied is resolved on the
statecraft side by a pure selector and passed across the wire by name.

- `api/deploy/chartSelector.ts` — pure function `selectChart({shape})` returns
  `{chart, version}` from `CHART_REGISTRY`. Unknown shapes throw — there is no
  silent fallback chart. After the spec 214 retirement the sole registered
  shape is `"acme-vue-encore"` → `{ chart: "acme-vue-encore", version: "0.1.0" }`,
  which corresponds to the Helm chart at `platform/charts/acme-vue-encore/`.
  Adding a shape means landing
  a chart under `platform/charts/<shape>/`, embedding its files in
  `platform/services/deployd-api-rs/src/helm.rs` via `include_str!`, and
  appending the registry entry here.
- `api/deploy/chartSelector.test.ts` — vitest unit suite covering the
  positive path, the throw-on-unknown-shape contract, and `listShapes()`.

### deployd-api-rs wire shape

The Rust orchestrator's `POST /v1/deployments` (`platform/services/deployd-api-rs/src/routes.rs`)
accepts two optional fields that flow directly from `selectChart`:

```jsonc
{
  // ...existing fields (tenant_id, app_id, env_id, release_sha, artifact_ref, lane, ...)
  "chart": "acme-vue-encore",      // optional; default "acme-vue-encore"
  "chart_version": "0.1.0"        // optional; advisory — bundled chart is image-pinned
}
```

`deployd-api` materialises the requested chart from its embedded chart bytes,
builds a JSON values file (`image.repository`/`image.tag` from `artifact_ref`,
`fullnameOverride` from `app_slug || app_id`, `ingress.host` from the first
entry in `desired_routes`), and shells `helm upgrade --install --wait`. When
no Kubernetes cluster is reachable (local dev) the route short-circuits to
the same record-only `ROLLED_OUT` path that existed before.

Spec 136 Phase 3 (negative-path C-clause violations against a live cluster)
and the Phase 4 lifecycle flip are still gated on cluster validation — they
intentionally do NOT ride with this PR.

## Factory project scaffold

Project creation and import live under `api/projects/`:

**Spec 139 cutover complete (2026-05-05):** the spec 108
`factory_adapters` / `factory_contracts` / `factory_processes` tables
were dropped by migration 34 (Phase 4 narrow); the spec 111/123
`agent_catalog` / `agent_catalog_audit` / `project_agent_bindings`
tables and the four legacy `factory_upstreams` per-side columns were
dropped by migration 35 (Phase 4b). All reads come from
`factory_artifact_substrate` (`origin='user-authored', kind='agent'` for
spec 111/123 content). The spec 108 legacy projection
(`projection.ts::projectSubstrateToLegacy`) was retired by spec 199
(FR-005): substrate rows are served verbatim by kind via
`api/factory/substrateBrowser.ts::loadSubstrateForOrg` +
`api/factory/adapterView.ts`, with adapter identity coming from the
parsed manifest (`acme-vue-encore`).
`api/agents/{catalog,bindings}.ts` and `api/factory/runAgentRefs.ts`
read+write the substrate directly. The OPC desktop's factory_root
materialises through the substrate-aware `VirtualRoot`
(`crates/factory-engine`).

- `create.ts` (spec 112 §5) — `POST /api/projects/factory-create`. ACP-native; writes commit #1 with a `.factory/pipeline-state.json` L0 seed, links the project to an adapter (substrate-projected; spec 139 Phase 4), auto-provisions a `kind=development` environments row (Phase 7), and returns an `opc://` deep link. Pre-flight checks (warmup readiness, adapter present, upstream PAT configured, spec 112 §10 runtime gate) raise `APIError.failedPrecondition` with the actual cause — never the Encore-wrapped generic 500.
- `scaffoldReadiness.ts` (spec 112 Phase 5; spec 139 T056) — `GET /api/projects/scaffold-readiness`. Per-org readiness verdict for the Create form: `{ ready, step, progress, hasFactoryAdapter, hasUpstreamPat, scaffoldSourceResolved, adapters[], canCreate, blocker }`. Adapter rows project from substrate. The web UI renders a banner per-blocker (`no-scaffold-source-resolved` is the spec 139 addition) and disables submit until `canCreate` flips.
- `import.ts` (spec 112 §6) — `POST /api/projects/factory-import`. Clones the repo, shells the `factory-project-detect` CLI for a governed detection read, branches on the level (reject / translate / register), and emits a `project.imported` audit event.
- `clone.ts` (spec 113) — `POST /api/projects/{sourceProjectId}/clone`. Mirror-clones a source project's primary repo into the caller's current OAP org installation, registers a new project bound to that repo, hydrates raw artefacts via the same `registerRawArtifactsFromRepo` path as import, and emits a `project.cloned` audit event. Default-vs-user-typed name semantics resolve collisions per FR-029/FR-030; rollback deletes the destination repo on any post-create failure.
- `cloneAvailability.ts` (spec 113) — `GET /api/projects/clone/check-availability`. Read-only, idempotent verdict for the Clone dialog's debounced field checks.
- `scaffold/` — the absorbed scaffold subflow:
  - `templateCache.ts` — clones the upstream template into `${STATECRAFT_WORKSPACE_DIR}/_template-cache`, runs `npm install`, persists upstream SHA in `.template-commit`. Materialises `_prebuilt-{minimal,public,internal,dual}` via `tsx scripts/setup-{app,dual-app}.ts`, persists prebuild SHA in `.prebuilt-commit`. Module-scoped `initStatus` drives the readiness endpoint.
  - `scheduler.ts` — Encore `CronJob("scaffold-warmup-refresher", every: "30m")` plus a fire-and-forget warmup at module load. Resolves `(scaffoldRepoUrl, scaffoldRef, PAT)` from the first eligible org. Spec 199 FR-009 cutover: the resolver reads each org's latest admission record, where the manifest's org-agnostic `scaffold.source.remote` was resolved against `factory_upstreams` at admission time; the manifest-injected `scaffold_source_id` (spec 140 §2.2) and the older `template_remote` field are both retired. `WarmupResolution` discriminator: `"no-adapters" | "no-scaffold-source-id" | "no-scaffold-source-resolved" | "no-pat" | "ok"`.
  - `perRequestScaffold.ts` — copies the chosen prebuilt tree into a per-request temp dir, runs `tsx add-module.ts <id>` for each user-selected extra, refreshes the lockfile via `npm install --package-lock-only`, writes `.factory/pipeline-state.json`.
  - `gitInitAndPush.ts` — `git init -b <branch>` → `add` → `commit` → token-injected push, then `git remote set-url origin <bare>` so the token does not survive in `.git/config`. Subprocess output is token-redacted before any error surface.
  - `githubRepoCreate.ts` — wraps `createGitHubRepo` with `autoInit: false` so commit #1 is the scaffold tree, not an auto-generated README.
  - `moduleCatalog.ts` (pure derivation + helpers): `deriveModuleCatalog(manifests)`, `deriveInstallOrder(catalog)`, `parseScaffoldProfiles(manifest)`, `profileModulesFor(profiles, profile)`, `pickProfileFromModules(variant, modules)`, `extrasFor(catalog, builtIns, selected)`, `isKnownModule(catalog, id)`, `isModuleManifestPath(path)`, plus the `RawModuleManifest`/`ModuleDescriptor`/`ProfileDefault` types. Spec 227 Stage 1/2: the catalog derives at request time from the adapter's module `manifest.json` rows, and per-profile defaults from the adapter manifest's `scaffold.profiles[]` (`internal` ships `["user-management"]`), so the create surface projects both without hand-mirroring (no `MODULE_CATALOG`/`INSTALL_ORDER`). The Encore-side loader plus `GET /api/factory/module-catalog` live in `api/factory/moduleCatalog.ts` and now return a `{ modules, profiles }` bundle behind a short-TTL per-org cache (`moduleCatalogCache.ts`, keyed by namespace + org). `extrasFor` filters the profile's derived built-ins out of the user's extras (the Stage 1 empty `PROFILE_MODULES`/`PRESETS` constants are gone). Profiles select AUTH_DRIVER (spec 199 FR-007 cutover, 2026-06-11; the template-distributor shape and `detectProfile` are retired).
  - `seedPipelineState.ts`, `deepLink.ts`, `artifactExtract.ts`, `types.ts` — pure helpers consumed by `create.ts`.

The `template-distributor` external service is retired — all scaffold work for newly-created factory projects happens in-process here under the org's existing GitHub App installation, backed by the workspace PVC declared in `platform/charts/statecraft/templates/workspace-pvc.yaml`.

## Knowledge extraction pipeline (spec 115)

Replaces the manual click-walk on `imported → extracting → extracted` with an
automatic, agent-aware pipeline. Mirrors the spec 114 clone-pipeline shape
(Topic + Subscription + run-row + CAS + staleness sweeper).

Module map:

- `api/knowledge/extractionEvents.ts` — `KnowledgeExtractionRequestTopic` (PubSub, at-least-once)
- `api/knowledge/extractionCore.ts` — `enqueueExtraction`, `runExtractionWork`, `markRunFailed`, `sweepStaleExtractionRuns`
- `api/knowledge/extractionWorker.ts` — Subscription wrapper, drives `runExtractionWork`
- `api/knowledge/scheduler.ts` — `extraction-staleness-sweeper` cron (60s)
- `api/knowledge/extractionPolicy.ts` — project policy slice resolver (loads `build/policy/projects/{projectId}.json`, 30s cache, deterministic-only fallback). Spec 119 §4.5 renamed the on-disk layout from per-workspace to per-project.
- `api/knowledge/extractionOutput.ts` — Zod-validated `ExtractionOutput` contract (FR-016)
- `api/knowledge/prompts.ts` — versioned prompt registry; `promptFingerprint = sha256(kind|version|system)` (FR-020)
- `api/knowledge/magic.ts` — pure mime-sniff + reconcile (FR-014); `storage.sniffMimeType` is the S3-backed wrapper
- `api/knowledge/extractors/`
  - `dispatch.ts` — registry + `pickExtractor` (FR-011)
  - `types.ts` — `Extractor` interface + `ExtractorError` (FR-015)
  - `deterministic-text.ts`, `deterministic-pdf-embedded.ts`, `deterministic-docx.ts`
  - `agent-base.ts` — Anthropic client + cost gates + `runAgentMessage` with prompt caching (FR-017–FR-021)
  - `agent-pdf-vision.ts`, `agent-image-vision.ts`
  - `agent-cost-helpers.ts` — pure cost estimator + `assertNoTools` (FR-018, FR-021)
  - `index.ts` — registers every extractor cheapest-first; side-effect imported by `extractionCore` and `extractionWorker`

Entry points (the four "what to call from the rest of the codebase" surfaces):

- `enqueueExtraction({ knowledgeObjectId, projectId, reason })` — call from any path that lands a row in `imported` (today: `confirmUpload`, `executeSyncRun`). Spec 119 collapsed the legacy workspace scope into project.
- `runExtractionWork({ extractionRunId })` — invoked by the Subscription; tests can drive it directly with a real DB.
- `pickExtractor(input, policy)` — synchronous; returns `null` when no extractor matches.
- `retryExtraction` endpoint at `POST /api/projects/:projectId/knowledge/objects/:id/retry-extraction` — operator re-enqueue for failed objects.

Env knobs:

- `STATECRAFT_EXTRACT_STALE_AFTER_SEC` — sweeper cutoff (default 600)
- `STATECRAFT_EXTRACT_MAX_AUTO_RETRIES` — auto-retry cap before manual Retry needed (default 2)
- `STATECRAFT_EXTRACT_EAGER_BUFFER_BYTES` — worker eager-load threshold (default 4MB)
- `STATECRAFT_EXTRACT_PDF_MIN_MEDIAN_CHARS` — embedded-text PDF threshold (default 80)
- `STATECRAFT_EXTRACT_LEGACY_TRANSITION` — set to `"true"` to re-enable the legacy click-walk endpoint for incident response (FR-027)
- `STATECRAFT_EXTRACT_POLICY_DIR` — override for compiled policy snapshot dir (default `build/policy/projects`; spec 119 §4.5)
- `STATECRAFT_EXTRACT_PRICE_*_USD_PER_MTOK` — Anthropic pricing overrides for the cost estimator
- `ANTHROPIC_API_KEY` — required secret; agent extractors fail closed without it
- `STATECRAFT_FACTORY_RUN_STALE_AFTER_SEC` — `factory_runs` staleness cutoff for the spec 124 sweeper (default 1800, i.e. 30 minutes). Rows in `(queued, running)` whose `last_event_at` is older than this are flipped to `failed` with a `factory.run.swept` audit by `api/factory/runsScheduler.ts` (cron `factory-runs-staleness-sweeper`, every 1m).
- `STATECRAFT_FACTORY_SYNC_STALE_AFTER_SEC`: `factory_sync_runs` staleness cutoff for the spec 109 §5.1 sweeper (default 600, i.e. 10 minutes). Rows in `(pending, running)` whose `COALESCE(started_at, queued_at)` is older than this are flipped to `failed` (and `factory_upstreams.last_sync_status` corrected) with a `factory.upstreams.sync_swept` audit by `api/factory/syncRunsScheduler.ts` (cron `factory-sync-runs-staleness-sweeper`, every 1m).
- `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT`: spec 202 FR-003(c) queue-storm ceiling (default 25). At `POST /api/factory/runs` reservation, `api/factory/queueStormGate.ts::detectQueueStorm` counts the org's `factory_runs` rows in `(queued, running)`; at or over this ceiling it logs a warning and writes a `factory.run.storm_detected` audit row. Detection-only: the run is still admitted regardless of the outcome. Enforcement (a refusal) is deferred until the governance envelope carries an authoritative threshold (the `budgets:` section, spec 202 FR-001); until then this is platform config, not an admitted ceiling.
- `STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC` / `STATECRAFT_FACTORY_APPROVAL_VELOCITY_THRESHOLD`: spec 202 FR-004 approval-velocity (governance-drift) counter (defaults 60s / 10 approvals). At `POST /api/factory/runs/:id/gates/:stageId/approve`, once the `factory.run.gate_approved` row is written, `api/factory/approvalVelocity.ts::detectApprovalVelocity` counts the actor's org-scoped gate approvals in the rolling window; at or over the threshold it logs a warning and writes a `factory.run.approval_velocity_anomaly` audit row. The same count is surfaced read-only as `approvalVelocity` on `GET /api/factory/runs/:id/approval-context`. Detection-only: the approval is still recorded regardless. Records, never blocks (depth of approval policy is org-filed, spec 198 FR-013); like the queue-storm ceiling this is platform config until the envelope carries an authoritative threshold.
