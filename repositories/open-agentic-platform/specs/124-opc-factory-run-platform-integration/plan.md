# Implementation Plan: OPC Factory-Run Platform Integration

**Spec**: [spec.md](./spec.md)
**Feature**: `124-opc-factory-run-platform-integration`
**Date**: 2026-05-01
**Branch**: `124-opc-factory-run-platform-integration`

## Summary

Close the spec 108 §7.1 punt and §7.4 deferral. Replace OPC's
`resolve_factory_root()` walk-up-from-`CARGO_MANIFEST_DIR` with an
authenticated `/api/factory/*` fetch into a per-run, content-addressed
cache. Persist runs in a new `factory_runs` table on statecraft, stream
lifecycle events from the desktop over the existing duplex channel
(spec 087 §5.3), and surface a Runs tab + detail view at `/app/factory`
that live-updates while a run is in flight. Agent bodies for each
stage flow through spec 123's `agent_resolver` (catalog + bindings),
not through `/api/factory/*`; this spec's API is for adapter / contract /
process bodies only. Migration is `31_create_factory_runs.up.sql`
(spec 123 reserves `30`). Concludes spec 108 by removing the
`// TODO(spec-108-§7-punt)` marker.

## Sequencing

| Phase | Focus | Spec sections |
|-------|-------|---------------|
| **0** | Foundations: shared TS / Rust types for `factory.run.*` envelopes (`v: 1`); compile-time schema-version constant; cache-root layout helper crate; OIDC desktop-client wiring confirmed | §3, §6.1 |
| **1** | Schema migration `31_create_factory_runs.up.sql` — `factory_runs` table + indexes; Drizzle schema additions; in-DB tests for FK cascades against `factory_adapters` / `factory_processes` / `projects` | §3, §10 A-3 / A-7 |
| **2** | Statecraft API: `api/factory/runs.ts` with `POST /api/factory/runs` (reservation), `GET /api/factory/runs`, `GET /api/factory/runs/:id`; org-scoped reads; idempotent `client_run_id` handling | §4 |
| **3** | Duplex handlers: register `factory.run.*` envelope kinds in `api/sync/duplex.ts`; idempotent `(run_id, stage_id, status)` write path; reject events for runs the caller does not own | §6, §6.1 |
| **4** | Run-level platform client (`crates/factory-platform-client`, new lib crate) — typed `/api/factory/*` client, OIDC token plumbing, content-addressed cache I/O, retry/backoff. No factory-specific business logic | §5 |
| **5** | OPC migration: rewrite `product/apps/opc/src-tauri/src/commands/factory.rs` against the platform client + `agent_resolver`; delete `resolve_factory_root` and the `// TODO(spec-108-§7-punt)` marker; the local `state.json` write path becomes a duplex emit | §4.1, §5, §6 |
| **6** | Sweeper: `api/factory/runsScheduler.ts` cron (modelled on `extraction-staleness-sweeper`); `factory_runs.status = 'failed'` for stale `running` rows; configurable timeout knob | §6 |
| **7** | UI: Runs tab on `/app/factory` (list + filter); run-detail drawer / route with live-updating stage progress via duplex; deep-link from `/app/factory` overview | §7 |
| **8** | Acceptance closure: A-1..A-9 verified; spec 108 §7.1 marker removed in code; `make ci` green on the post-migration branch; spec 124 frontmatter flips to `status: approved` / `implementation: complete` | §10 |

Phase 0 unblocks 1, 2, 3, and 4 in parallel-by-file (types are shared).
Phases 1, 2, 3 are platform-side and run sequentially within statecraft.
Phase 4 (platform client) and Phase 6 (sweeper) can run in parallel
once Phase 0 is in. Phase 5 depends on 1, 2, 3, 4. Phase 7 depends on
2, 3 only (UI consumes the API + duplex). Phase 8 is closure.

## Approach decisions

- **Single migration on top of spec 123's `30`.** Spec 124 adds one
  table; no churn against existing rows. Use `31_create_factory_runs.up.sql`
  and document the ordering in the spec body so future migration slots
  don't collide.
- **API for definitions, duplex for run state.** `/api/factory/*` is
  read-only in this spec; mutations to `factory_runs` flow exclusively
  via the duplex bus from OPC. The only mutation REST surface is the
  `POST /api/factory/runs` reservation, which exists so the row is
  born before any duplex event is emitted (eliminates a race the duplex
  handler would otherwise have to compensate for).
- **Reservation returns `source_shas`.** OPC asks for a run id; the
  platform answers with the SHA tuple it expects to see in subsequent
  events. The desktop is the executor but the platform is the canonical
  recorder of "what was run"; this matches the spec 108 ownership
  story.
- **Per-run cache layout mirrors the in-tree shape `factory-engine`
  expected.** No `factory-engine` API change. The materialiser writes
  `adapters/<name>/...`, `process/...`, `contract/...` under a
  content-addressed cache directory and `factory_root` points at it.
  This keeps the blast radius small and lets us delete
  `resolve_factory_root` cleanly.
- **Agent bodies come from spec 123's `agent_resolver`, not from this
  spec's API.** §4.1 of the spec is non-negotiable. Adding an
  `/api/factory/agents/*` surface here would split the agent ownership
  across two specs and re-introduce the project↔org seam spec 123
  exists to remove. The resolver writes resolved bodies into the
  per-run cache so the on-disk shape stays uniform.
- **Resolver flow differs slightly between project-bound and ad-hoc
  runs.** With a `project_id`, the desktop reads
  `project_agent_bindings` first to fix the `(org_agent_id,
  pinned_version)` pair, then calls
  `AgentResolver::resolve(AgentReference::ById { org_agent_id,
  version })` — that's the most stable form (UUID + version pinned).
  Without a `project_id` (ad-hoc runs), the process definition's
  embedded `AgentReference` is used directly: `ByName { name, version
  }` for explicit pins, `ByNameLatest { name }` to take the latest
  published row at run time. The server-side reservation (T020) does
  the same lookup so its `source_shas.agents[]` matches what the
  client materialises (T043 cross-check).
- **Spec 123's `CatalogClient` is what the platform client implements.**
  `factory-engine` carries the `CatalogClient` trait but no HTTP
  dependency; spec 124's new `factory-platform-client` crate provides
  the concrete implementation. One client instance feeds both the run
  pipeline (`/api/factory/runs`, GETs for adapter/contract/process)
  and the agent resolver via the trait, so the desktop has one source
  of authentication + retry policy.
- **Duplex envelopes are versioned independently of spec 123.**
  `factory.run.*` starts at `v: 1`; bumps later if the shape changes.
  Compile-time schema-version constants per the
  `feedback_schema_compile_time` convention catch desktop / platform
  drift at build time.
- **Idempotent duplex handler.** The handler keys on `(run_id, stage_id,
  status)`; re-delivery of the same tuple is a no-op. This is required
  for at-least-once duplex delivery and for the OPC-side replay-on-
  reconnect behaviour the spec mandates in §6.
- **Sweeper bias toward false-positive failure.** A stale `running`
  row marks `failed` after `max_stage_duration × 2`. Better to mark a
  legitimately-slow run failed than to leave dead rows in `running` —
  the user can re-run; the dead row is misinformation.
- **`source_shas.agents[]` is mandatory.** Spec 122's Stage CD
  comparator depends on agent definition equality across runs. Recording
  the spec-123 triple per stage is what makes that signal usable.
- **Cache retention default: 7 days.** Configurable via
  `OAP_FACTORY_CACHE_RETAIN_DAYS`. Long enough for post-mortem
  inspection of a normal run, short enough that a developer's home
  directory doesn't grow unbounded.

## Risks

- **API surface conflict with `/api/factory/upstreams/*`.** The new
  `/api/factory/runs` endpoints share the prefix. Mitigation: keep
  `runs.ts` separate from `upstreams.ts` in the file tree; verify the
  Encore service mapping doesn't double-register.
- **Cache write contention on a fast-clicking user.** Two parallel
  runs against the same `(adapter, process)` SHA share a cache
  directory. Mitigation: the materialiser writes to a temp dir and
  `rename` into place atomically; a successful rename loses to a prior
  rename of identical content (idempotent).
- **`agent_resolver` retired-binding regression.** If a project's
  binding points at a retired agent (spec 123 I-B3), the run is
  rejected client-side BEFORE reservation. The desktop must surface
  the reason clearly, not a generic 4xx. Mitigation: typed error from
  the resolver propagates through to a localised UI message; an
  integration test covers retired-binding rejection.
- **Sweeper false positives on legitimately slow runs.** Some pipelines
  legitimately exceed the timeout. Mitigation: the timeout is per-stage
  not per-run; configurable knob. A future spec can introduce
  per-adapter timeout overrides if the default proves wrong.
- **Migration ordering vs. spec 123.** If spec 123 lands later than
  expected, migration `30` may slip. Mitigation: this spec carries the
  hard claim on `31` and the implementation script aborts if `30` is
  missing, so the ordering is observable, not silent.
- **Duplex bus saturation under high run frequency.** If many runs
  emit stage_started/completed in close proximity, the duplex
  handler's per-event DB write becomes a hotspot. Mitigation: events
  are PubSub-published platform-side (deliveryGuarantee:
  at-least-once) — the API write is small and indexed; revisit only
  if metrics show contention.
- **`source_shas.agents[]` schema drift with spec 123.** The triple
  shape `(org_agent_id, version, content_hash)` must match spec 123's
  binding-row shape exactly. Mitigation: the type is imported from a
  shared module owned by spec 123, not re-declared here; a CI gate
  asserts the import path resolves.
- **`resolve_factory_root` deletion breaks downstream test fixtures.**
  Spec 108 §8 already updated the wording on factory-engine fixtures
  to skip cleanly when `factory/` is absent. After spec 124, those
  fixtures continue to skip — the deletion is in `commands/factory.rs`
  only. Mitigation: A-2 acceptance grep verifies no live consumer
  remains after the deletion.
- **Pre-alpha clean break is acceptable, but Runs tab is operator-
  facing.** The Runs tab will surface to a real user (the operator).
  Mitigation: ship a minimal but coherent v1 (list, filter, detail
  drawer); fancy stage-level visualisation is explicitly Phase 1
  follow-up territory in spec §7.

## References

- Spec: [`./spec.md`](./spec.md)
- Tasks: [`./tasks.md`](./tasks.md)
- Pattern reuse:
  - Spec 108 (`factory-as-platform-feature`) — provides `/api/factory/*`
    and the §7.1 / §7.4 punt this spec closes
  - Spec 109 (`factory-pat-and-pubsub-sync`) — the platform-side sync
    model; the run-state path mirrors the
    `factory-sync-worker` PubSub pattern
  - Spec 114 (`async-project-clone-pipeline`) — the run-row → worker
    → poll lifecycle and the staleness sweeper pattern
  - Spec 115 (`knowledge-extraction-pipeline`) — `extraction-staleness-sweeper`
    cron is the model for `factory-runs-staleness-sweeper`
  - Spec 123 (`agent-catalog-org-rescope`) — `agent_resolver` and the
    `(org_agent_id, version, content_hash)` triple
- Existing primitives this spec touches:
  - `product/apps/opc/src-tauri/src/commands/factory.rs` — rewritten,
    `resolve_factory_root` deleted
  - `platform/services/statecraft/api/factory/` — new `runs.ts` and
    `runsScheduler.ts`
  - `platform/services/statecraft/api/sync/duplex.ts` — register
    `factory.run.*` envelope kinds
  - `platform/services/statecraft/api/db/schema.ts` — `factoryRuns`
    table addition
  - `platform/services/statecraft/web/app/routes/app.factory.runs*` —
    new Runs tab + detail
  - `crates/factory-engine` — accepts the materialised cache root via
    its existing `factory_root` config (no API change)
- Cross-crate dependencies:
  - `crates/factory-platform-client` (new) — typed REST client +
    cache I/O
  - `crates/factory-engine` — unchanged surface; consumes the cache
  - `crates/factory-contracts` — typed views of adapters / contracts /
    processes for the cache materialiser
- Related specs: 087 §5.3 (duplex), 106 / 107 (desktop OIDC),
  108 (factory platform feature), 109 (PubSub sync), 114 (clone-pipeline
  pattern), 115 (extraction sweeper pattern), 122 (Stage CD comparator
  consumer), 123 (agent resolver)
