---
id: "114-async-project-clone-pipeline"
title: "Async Project Clone Pipeline"
feature_branch: "feat/114-async-project-clone-pipeline"
status: approved
implementation: complete
owner: bart
created: "2026-04-27"
kind: platform
domain: platform
risk: medium
depends_on:
  - "109-factory-pat-and-pubsub-sync"  # factory-pat-and-pubsub-sync (PubSub run-row + worker pattern this spec mirrors)
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (registerRawArtifactsFromRepo, OPC deep link)
  - "113-statecraft-projects-rename-and-clone"  # statecraft-projects-rename-and-clone (the synchronous endpoint this spec replaces)
code_aliases: ["ASYNC_PROJECT_CLONE"]
supersedes:
  - spec: "113-statecraft-projects-rename-and-clone"
    scope: partial
    unit: { kind: file, path: platform/services/statecraft/api/projects/clone.ts }
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/cloneCore.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/cloneEvents.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/cloneWorker.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/cloneRunStatus.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.$sourceProjectId.clone.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.clone-runs.$cloneJobId.tsx }
extends:
  - spec: "113-statecraft-projects-rename-and-clone"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/components/CloneProjectDialog.tsx }
  - spec: "113-statecraft-projects-rename-and-clone"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
summary: >
  Spec 113's `POST /api/projects/:id/clone` does the full mirror-clone +
  mirror-push + raw-artifact hydration synchronously inside the HTTP
  request. For non-trivial source repos this exceeds the statecraft
  ingress's default ~60s read timeout (no `proxy-read-timeout` annotation
  on the chart) and the SSR proxy translates the upstream cut-off into a
  502 in the browser — the symptom users hit on 2026-04-27. This spec
  splits the endpoint into a thin synchronous queue step and a PubSub
  worker that owns the heavy work, mirroring the pattern spec 109 already
  uses for `factory_sync_runs`. The dialog learns to poll a new
  `GET /api/projects/clone/runs/:cloneJobId` until the run reaches a
  terminal state, then navigates with the worker-resolved final names.
---

# 114 — Async Project Clone Pipeline

**Feature Branch:** `feat/114-async-project-clone-pipeline`
**Created:** 2026-04-27
**Status:** Draft
**Input:** Production 502 on `POST /app/projects/:id/clone` against a real source repo on 2026-04-27. Root-cause analysis traced the failure to synchronous git operations exceeding the ingress timeout, with no pod-side timeout on the spawned `git` subprocess.

## 1. Problem

`platform/services/statecraft/api/projects/clone.ts` (spec 113 §FR-023..FR-038) executes:

1. source-token resolution
2. `git clone --mirror` of the source repo into a tempdir
3. `du -sk` + `git rev-list --count --all` for size caps
4. destination installation token broker
5. final-name / final-slug resolution (each runs N GitHub repo-probe calls)
6. `POST /orgs/:org/repos`
7. `git push --mirror`
8. PATCH default branch
9. Postgres transaction for `projects` + `project_repos` + `project_members`
10. `git worktree add` + `registerRawArtifactsFromRepo` (per-file SHA-256 + S3 PUT + two DB inserts each)
11. audit-log insert
12. `publishProjectCatalogUpsert`

— all inside a single `await` on the Encore handler. Steps 2, 7, and 10 are unbounded shell I/O against GitHub and S3. The statecraft Helm chart (`platform/charts/statecraft/values-hetzner.yaml`) sets only `nginx.ingress.kubernetes.io/proxy-body-size: "10m"`; without `proxy-read-timeout`, ingress-nginx's default 60s upstream read timeout applies. When the handler runs longer than 60s the ingress returns 502 (with `retry-after: 60`), the React Router SSR proxy translates that into 502 to the dialog (`web/app/routes/app.projects.$sourceProjectId.clone.tsx:54`), and the user sees `HTTP 502` inline.

Spec 113 already documented "very large source repo" (`source_too_large` cap at 500 MB / 50k commits) but the reverse case is the live failure: a *legal* repo whose mirror+push+hydrate cumulatively exceeds 60s. Bumping the ingress timeout would mask the underlying shape — synchronous request-bound long-running I/O — without fixing the next failure mode (pod restart drops the request, the user has no visibility into progress, retries are unsafe because the destination repo may already exist).

## 2. Goals

- The clone HTTP request returns within a few seconds, well inside any reasonable ingress timeout, regardless of source repo size up to the 500 MB cap.
- The heavy work (mirror clone, mirror push, artifact hydration, audit) runs in a worker process that survives ingress disconnects and can be retried idempotently under at-least-once redelivery.
- The dialog polls a single endpoint to know when navigation is safe and what final name the worker chose (preserving spec 113 FR-029/FR-030 user-vs-default semantics).
- All existing spec 113 invariants — rollback on push/DB failure, audit row at terminal state, suffix-uniquification only for default-path inputs, `.artifacts/raw/` hydration via the same `registerRawArtifactsFromRepo` path — survive the split unchanged.
- The `registry-consumer` and codebase-indexer keep working; spec 113 stays approved+complete and is not retroactively rewritten — this spec layers on top.

## 3. Non-Goals

- Cross-org clones, environment copy, member copy, PAT copy — all out of scope per spec 113 §3 and not reopened here.
- Background retry of failed clones. A failed run is terminal; the user resubmits from the dialog. Worker idempotency under PubSub redelivery is required (CAS-claim) but operator-driven retry is not.
- Real-time progress events. The dialog polls; no SSE / WebSocket stream. (A later spec MAY layer one on if needed.)
- A separate ingress-timeout patch. Statecraft's chart can keep its current timeouts; the clone HTTP call no longer depends on them. Other long endpoints, if any, are not in scope.
- Changing the availability endpoint (`GET /api/projects/clone/check-availability`). It stays exactly as spec 113 §FR-017..FR-022 left it.

## 4. User Scenarios & Testing

### User Story 1 — Clone a legal-sized repo without timing out (Priority: P1)

A workspace member opens the Clone dialog on a project whose primary repo holds ~30 MB of git history and ~200 entries under `.artifacts/raw/`. They edit no fields and press Clone project. The Clone button enters a loading state. Within ~2 seconds the server has accepted the request (the run row is `pending` → `running`). The dialog stays open and shows "Cloning…" with a small progress hint. After ~25 seconds (mirror clone + push + S3 hydration), the worker terminates the run as `ok`, the dialog auto-navigates to `/app/project/{newProjectId}`, and the listing already shows the new entry. Compared to the 113 sync flow this user previously saw a 502 at the 60s mark and the new project never appeared.

**Why this priority:** This is the failure mode users hit today. Without it, Clone is functionally broken for any non-trivial source repo.

**Independent Test:** Pick a real GitHub repo whose mirror clone + push + hydration takes 90–120 s on the dev cluster. Submit Clone. Verify (a) the POST returns 202 (or 200 with `status: queued`) within 5 s, (b) the dialog polls `/clone/runs/:id` and never sees a 502, (c) the worker pod logs show one `clone worker: claimed` and one `clone worker: ok` line, (d) a single `audit_log` row of action `project.cloned` exists, (e) the destination repo has the same default-branch SHA as the source.

**Acceptance Scenarios:**

1. **Given** a source repo whose clone-push-hydrate runs >60s, **When** the user submits Clone, **Then** the dialog never sees a 502, the run row reaches `ok`, and the user is navigated to the new project's detail page with the worker-chosen final names.
2. **Given** the worker pod is restarted between `pending → running` claim and the `git push --mirror` step, **When** PubSub redelivers the message, **Then** the redelivered handler observes `status = 'running'`, treats its own redelivery as idempotent (no duplicate destination repo, no duplicate DB rows), and either resumes or fails-cleanly with a typed error rather than producing two clones.
3. **Given** the worker fails midway (`git push` rejects, DB insert violates unique), **When** rollback runs, **Then** the destination GitHub repo is deleted, no `projects` / `project_repos` rows are left, the run row terminates as `failed` with a typed error code, and the dialog surfaces the error inline.
4. **Given** the dialog is closed by the user mid-clone, **When** the worker eventually finishes, **Then** the run still reaches a terminal state and emits its audit row; the listing's catalog-upsert broadcast (spec 112 phase 8) shows the new project anyway.
5. **Given** a network blip on the polling client, **When** poll requests transiently 5xx, **Then** the dialog backs off and retries; it does not re-submit Clone.

### Edge Cases

- **PubSub at-least-once redelivery.** The worker MUST CAS-transition `pending → running`; a redelivered message whose row is already `running` / `ok` / `failed` is a no-op (mirror of `factory/syncWorker.ts:32`).
- **Race between two workers claiming the same run.** Postgres `UPDATE … WHERE status='pending' RETURNING id` is the atomic claim; only the row that returned a row continues.
- **Sync-step DB write fails before publish.** If the run row never enters Postgres, the publish is skipped; the user's POST fails with 5xx and the dialog re-enables. No leak.
- **Sync-step succeeds but publish to PubSub fails.** The endpoint MUST treat publish failure as terminal: mark the run `failed` with a typed error and return 5xx to the caller. Otherwise the row sits at `pending` forever.
- **User polls for a run row in a different workspace.** The status endpoint MUST scope by `workspaceId` and return 404, never the row.
- **Two concurrent submits for the same source.** Each gets its own `cloneJobId` and its own destination repo (suffix loop runs in worker context, exactly once per run because the loop is inside the CAS-claimed branch).
- **Worker dies after `createCloneDestRepo` but before the row is marked `ok` or `failed`.** PubSub redelivers. The redelivered handler observes `status = 'running'` and a non-null `dest_repo_full_name` — it MUST run the rollback path (delete the dest repo) and mark the row `failed` with `partial_state_reclaimed`. (Without this, a redelivery would attempt to create the same dest repo and 422.)
- **Caller submits with `Idempotency-Key` header.** Out of scope; the dialog doesn't generate one. A future spec MAY add it.

## 5. Requirements

### 5.1 Sync endpoint behaviour

- **FR-001**: `POST /api/projects/:sourceProjectId/clone` MUST validate auth, permission (`org:project.create`), the source-project workspace scope, and the destination installation existence — *exactly as today* — but MUST NOT perform any GitHub API call beyond what spec 113's availability endpoint already does.
- **FR-002**: After validation, the endpoint MUST insert a `project_clone_runs` row with `status='pending'`, capturing `sourceProjectId`, `workspaceId`, `orgId`, `triggeredBy`, the requested `name` / `slug` / `repoName` (verbatim, may be `null` for default), and a `queuedAt` timestamp.
- **FR-003**: The endpoint MUST publish a `ProjectCloneRequest` PubSub message keyed on the new run id. Publish MUST happen after the row is committed; publish failure MUST mark the row `failed` with `error='publish_failed'` and propagate a typed 5xx to the caller.
- **FR-004**: The endpoint MUST return `{ cloneJobId, status: 'queued' }` with HTTP 202 on success. The response MUST NOT include `projectId`, `repoFullName`, or `opcDeepLink` — those don't exist yet.
- **FR-005**: The endpoint MUST complete in well under the ingress timeout floor (target p99 < 2s; budget < 5s including the publish round-trip). It performs at most one DB write and one PubSub publish.

### 5.2 Worker behaviour

- **FR-006**: A new Encore PubSub `Subscription` on `ProjectCloneRequestTopic` MUST own the heavy lifting. The handler MUST CAS-transition the run row `pending → running` before any side-effect; a no-row-returned outcome MUST be a logged no-op.
- **FR-007**: After claim, the worker MUST replay all current spec 113 §5.3 steps in their existing order: source-token resolution, `mirrorClone`, size-cap check, dest-token broker, `resolveFinalRepoName` / `resolveFinalSlug`, `createCloneDestRepo`, `mirrorPush`, `setDefaultBranch`, the projects+repos+members transaction, `addWorktree` + `registerRawArtifactsFromRepo`, the audit-log insert, and the `publishProjectCatalogUpsert` broadcast.
- **FR-008**: Rollback semantics MUST match spec 113 FR-034 exactly: a failure after `createCloneDestRepo` MUST best-effort `deleteGithubRepo`; a failure after the projects insert MUST also delete the `projects` row (cascade handles `project_repos`).
- **FR-009**: On terminal success the worker MUST set the run row to `status='ok'` and populate `projectId`, `finalName`, `finalSlug`, `finalRepoName`, `defaultBranch`, `opcDeepLink`, `rawArtifactsCopied`, `rawArtifactsSkipped`, `durationMs`, and `completedAt`. The audit-log insert MUST happen exactly once per run (gated by the CAS-claim, not by success).
- **FR-010**: On terminal failure the worker MUST set `status='failed'`, populate `error` with a typed code (`source_unauthorized | source_too_large | name_taken | name_exhausted | slug_taken | slug_exhausted | dest_repo_create_failed | mirror_push_failed | db_insert_failed | partial_state_reclaimed | unknown`) and `completedAt`. It MUST NOT throw past the subscription handler — at-least-once delivery would loop a thrown error forever.
- **FR-011**: On redelivery of a message whose run row is already `running` with a recorded `dest_repo_full_name`, the worker MUST treat the run as a partial-state recovery: delete the recorded dest repo, mark the run `failed` with `error='partial_state_reclaimed'`, and return. (Resumption is out of scope; reclaiming is sufficient to keep state clean.)

### 5.3 Polling endpoint

- **FR-012**: A new endpoint `GET /api/projects/clone/runs/:cloneJobId` MUST exist on the projects service. It MUST require auth (`auth: true`), scope to the caller's workspace, and 404 for runs the caller cannot see.
- **FR-013**: The response shape MUST be `{ cloneJobId, status, queuedAt, startedAt, completedAt, sourceProjectId, projectId?, finalName?, finalSlug?, repoFullName?, defaultBranch?, opcDeepLink?, rawArtifactsCopied?, rawArtifactsSkipped?, durationMs?, error? }` where the optional fields are present only when populated by the worker.
- **FR-014**: The endpoint MUST be cheap (single indexed PK lookup) and idempotent. It MUST NOT mutate, MUST NOT audit, and MUST NOT consume any retry budget.

### 5.4 Dialog behaviour

- **FR-015**: `CloneProjectDialog` MUST submit Clone, receive `{ cloneJobId }`, and then poll `/clone/runs/:cloneJobId` every 1500 ms (jitter ±250 ms) until `status` is `ok` or `failed`.
- **FR-016**: While polling the dialog MUST keep the dialog non-dismissable (existing spec 113 FR-014 invariant) and MUST surface a benign progress hint (e.g. `"Cloning… (NNs)"`).
- **FR-017**: On `status='ok'` the dialog MUST navigate to `/app/project/{projectId}` using the run row's `projectId` and pass the run row's `finalName` / `finalSlug` to the calling page (so the listing reflects the worker's actual choices, per spec 113 FR-015's truth-not-claims rule).
- **FR-018**: On `status='failed'` the dialog MUST surface the typed `error` code inline (existing spec 113 FR-016 path) and re-enable Submit. The dialog MUST NOT auto-retry.
- **FR-019**: Poll responses with `5xx` MUST be retried up to N=4 times with exponential backoff (1.5s, 3s, 6s, 12s). After N the dialog MUST fall back to surfacing a "polling lost contact" error and a Retry-Polling button.

### 5.5 Schema + migration

- **FR-020**: A new migration `24_project_clone_runs.up.sql` MUST create:
  - enum `project_clone_run_status('pending','running','ok','failed')`.
  - table `project_clone_runs` with columns: `id uuid pk default gen_random_uuid()`, `source_project_id uuid not null`, `workspace_id uuid not null`, `org_id uuid not null`, `triggered_by uuid not null`, `status project_clone_run_status not null default 'pending'`, `requested_name text`, `requested_slug text`, `requested_repo_name text`, `final_name text`, `final_slug text`, `final_repo_name text`, `default_branch text`, `dest_repo_full_name text`, `project_id uuid`, `opc_deep_link text`, `raw_artifacts_copied integer`, `raw_artifacts_skipped integer`, `duration_ms integer`, `error text`, `queued_at timestamptz not null default now()`, `started_at timestamptz`, `completed_at timestamptz`.
  - index on `(workspace_id, queued_at desc)` for future operator listing.
- **FR-021**: The Drizzle `db/schema.ts` MUST mirror the migration with a typed enum and a `pgTable` matching column types. No additional `unique` constraints (the run id PK is sufficient).

### 5.6 Backward compatibility

- **FR-022**: The web SSR proxy at `app.projects.$sourceProjectId.clone.tsx` MUST forward to the new sync endpoint and pass through its 202 / typed 5xx response. The browser-typed `CloneProjectResponse` MUST be replaced by `CloneJobAccepted` ( `{ cloneJobId; status: 'queued' }` ) and a new `CloneRunStatus` ( the FR-013 shape ); call sites MUST be updated.
- **FR-023**: The OPC desktop app does not call the clone submit directly today — it consumes the project listing's catalog-upsert broadcast (spec 112 phase 8). The worker's broadcast at terminal success preserves OPC's existing behaviour. **No OPC change is required by this spec.**

## 6. Open Questions

- **Telemetry.** Should the run row also capture mirror size + commit count to make `source_too_large` self-documenting, or stay minimal and rely on logs? Default: stay minimal; the cap reason is already a typed error.
- **Worker concurrency.** Encore's PubSub `Subscription` defaults are sufficient for the expected clone rate (small organisations cloning a few projects per day). If we hit lock contention later, we add a `maxConcurrency` knob — out of scope here.
- **OPC progress visibility.** A future spec MAY surface in-flight clone runs in OPC's project list (greyed-out card, polling status). Not required for this fix.

## 7. Risks

- **Worker pod and statecraft API pod separation.** Encore PubSub subscriptions run inside the same Encore service binary today; if we ever split projects out, the worker subscription needs to come along.
- **DB schema drift.** The schema changes are additive — no existing column is dropped — but the test fixtures touched by spec 113 will need to gain a `project_clone_runs` table. The drizzle CI step MUST regenerate the migration set.
- **Suffix-uniquification race.** Two queued runs for the same source with default names will both run `resolveFinalRepoName` in worker context. The 422-on-create path covers the residual race (spec 113 FR-029 already documents this as the safety net).
