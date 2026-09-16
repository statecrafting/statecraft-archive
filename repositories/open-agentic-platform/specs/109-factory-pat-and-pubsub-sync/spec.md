---
id: "109-factory-pat-and-pubsub-sync"
slug: factory-pat-and-pubsub-sync
title: Factory PAT Broker + PubSub Sync Worker
status: approved
implementation: complete
owner: bart
created: "2026-04-21"
kind: platform
domain: platform
summary: >
  Finishes spec 108 §10 by making Factory sync asynchronous (PubSub-driven) and
  wires Personal Access Tokens into the two repo access surfaces the platform
  owns: (a) org-level PAT for the Factory upstream sources
  (legacy-factory + template), and (b) per-project PAT for project repos
  that live outside the org and cannot be reached via the OAP GitHub App.
  Resolves the spec 108 §10 inline-vs-PubSub open question.
depends_on:
  - "080-github-identity-onboarding"  # github-identity-onboarding (installation token broker)
  - "106-rauthy-native-oidc-and-membership"  # rauthy-native-oidc-and-membership (patCrypto, PAT primitives)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (tables, UI shell)
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/upstreamPat.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/syncWorker.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/syncRuns.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/syncRunsScheduler.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/tokenResolver.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/projectPat.ts }
extends:
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/factory.ts }
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.factory.upstreams.tsx }
  - spec: "106-rauthy-native-oidc-and-membership"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.settings.github-pat.tsx }
---

# 109 — Factory PAT Broker + PubSub Sync Worker

## 1. Problem

Spec 108 shipped Factory as a platform feature but left two gaps:

1. **`/api/factory/upstreams/sync` is inline.** The HTTP action blocks for the
   duration of two shallow clones plus a full translate. A 30-second sync
   burns an HTTP request slot, collapses the UI into a spinner, and has no
   retry story. Spec 108 §10 flagged this as an open question with the
   default "inline for Phase 3, revisit if syncs exceed 30s." Reality has
   caught up — `legacy-factory` is large enough that admins see the
   request hang.
2. **No PAT pathway into repo access.** The sync worker resolves tokens only
   via `brokerInstallationToken` against the org's `github_installations`
   row. This is fine *if and only if* the factory upstream org has installed
   the OAP GitHub App. It never has, and it won't — `Statecraft-ing` is a
   third-party source controlled by another team. The silent anonymous
   fallback in `api/factory/sync.ts::resolveInstallationToken` covers public
   repos but dies on private ones. The same gap exists for project repos
   that live outside the platform org.

Both failures land on the same user-facing symptom: "Sync now" returns a
`clone failed for … @main: Authentication failed` message and there is no
escape hatch.

## 2. Decision

Add two orthogonal capabilities and keep them small:

1. **Org-scoped Factory Upstream PAT.** One encrypted token per org, stored
   in a new `factory_upstream_pats` table. It authenticates the Factory sync
   worker against whichever GitHub repos are configured as
   `factory_upstreams.factory_source` / `template_source`. This is the
   "global PAT" the user described in the request — not truly global across
   tenants, but global across **one org's Factory sources**.
2. **Project-scoped Repo PAT.** One encrypted token per project in a new
   `project_github_pats` table. It authenticates any repo create/read/update
   performed against `project_repos` entries whose `github_org` lies
   outside the platform org. Existing in-org projects continue to use the
   installation token.

Both tables reuse `api/auth/patCrypto.ts` (AES-256-GCM,
`PAT_ENCRYPTION_KEY` Encore secret, per-row nonce) — no new crypto.

And convert the Factory sync to PubSub:

3. **`factory_sync_runs` table + `FactorySyncRequestTopic`.** The HTTP
   endpoint creates a run row in `pending` and publishes an event. A
   subscription worker in `api/factory/syncWorker.ts` picks up the event,
   runs the existing translate/upsert logic, and updates the run row. The
   original `factory_upstreams.lastSync*` columns stay as a denormalised
   "current state" view for the Overview UI, written at the end of each
   successful run.

## 3. Data Model

Added to `api/db/schema.ts` and migration 19:

```sql
-- One PAT per org for the Factory upstream sources.
CREATE TABLE factory_upstream_pats (
    org_id          UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    token_enc       BYTEA NOT NULL,
    token_nonce     BYTEA NOT NULL,
    token_prefix    TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_fine_grained BOOLEAN NOT NULL DEFAULT FALSE,
    github_login    TEXT,
    last_used_at    TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One PAT per project for repos outside the org.
CREATE TABLE project_github_pats (
    project_id      UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    token_enc       BYTEA NOT NULL,
    token_nonce     BYTEA NOT NULL,
    token_prefix    TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_fine_grained BOOLEAN NOT NULL DEFAULT FALSE,
    github_login    TEXT,
    last_used_at    TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE factory_sync_run_status AS ENUM (
    'pending', 'running', 'ok', 'failed'
);

CREATE TABLE factory_sync_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status          factory_sync_run_status NOT NULL DEFAULT 'pending',
    triggered_by    UUID NOT NULL REFERENCES users(id),
    factory_sha     TEXT,
    template_sha    TEXT,
    counts          JSONB,
    error           TEXT,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_factory_sync_runs_org_queued
    ON factory_sync_runs (org_id, queued_at DESC);
```

Both PAT tables enforce **one active token per scope** by making the scope
id the primary key — `POST` semantics are upsert + audit. Unlike
`user_github_pats`, there is no revoked-history row kept here: a revoke is
a hard delete. Rationale: these are operational credentials, not identity
artifacts. Audit lives in `audit_log` rows.

## 4. Token Resolution

### Factory upstream sync

Defined in `api/factory/tokenResolver.ts::resolveFactoryUpstreamToken(orgId)`:

1. If a row exists in `factory_upstream_pats` for the org → decrypt and
   return it. Stamp `last_used_at`.
2. Else if `github_installations` has an active row for the org → broker an
   installation token via `brokerInstallationToken(id, { contents: 'read', metadata: 'read' })`.
3. Else → `undefined` (anonymous clone; only works for public repos).

Errors during step 1 decryption propagate — we do not silently fall through
to an installation token when a PAT is configured but broken. That's the
kind of failure the user wants to see loudly.

### Project repo operations

Defined in `api/projects/tokenResolver.ts::resolveProjectRepoToken(projectId, repo)`:

1. If `repo.github_org` matches the platform org's primary GitHub org **and**
   an active installation exists → installation token.
2. Else if `project_github_pats` has a row for the project → decrypt + return.
3. Else → `undefined`.

This keeps in-org repos on the existing installation path and only reaches
for a PAT when the repo is external.

## 5. PubSub Sync Worker

New topic:

```ts
// api/factory/events.ts
export const FactorySyncRequestTopic = new Topic<FactorySyncRequest>(
  "factory-sync-request",
  { deliveryGuarantee: "at-least-once" }
);
interface FactorySyncRequest {
  sync_run_id: string;
  org_id: string;
  triggered_by: string;
}
```

Flow:

1. `POST /api/factory/upstreams/sync` — validates `factory:configure`,
   inserts a `factory_sync_runs` row with `status='pending'`, publishes
   `FactorySyncRequestTopic` with the run id, returns
   `{ sync_run_id, status: 'pending' }`. **Does not block** on the clone.
2. `Subscription` in `api/factory/syncWorker.ts` (subscription name:
   `factory-sync-worker`) consumes the event:
   - Marks the run `status='running'`, stamps `started_at`.
   - Loads the upstream row, resolves a token via
     `resolveFactoryUpstreamToken`.
   - Calls the existing `cloneAndTranslate` + `applyTranslation` helpers
     (lifted out of `sync.ts` into `syncWorker.ts` or a shared
     `syncPipeline.ts`).
   - On success, updates the run row (`status='ok'`, `factory_sha`,
     `template_sha`, `counts`, `completed_at`) **and** the denormalised
     `factory_upstreams.lastSync*` columns.
   - On failure, updates the run row (`status='failed'`, `error`,
     `completed_at`) **and** mirrors the error onto
     `factory_upstreams.lastSyncStatus/lastSyncError`.
   - Either way, writes an `audit_log` entry.
3. `GET /api/factory/upstreams/sync/:id` — reads the run row, returns
   status + counts + error. Admin poll target.
4. `GET /api/factory/upstreams/sync` (list) — returns last 20 runs for the
   org, newest first.

The Encore `at-least-once` guarantee means the worker must be idempotent —
it is: the upsert logic already replaces every adapter/contract/process
row per sync. The run row's `status` transitions are guarded by a CAS
(`WHERE status = 'pending'` on the `running` transition) so a double
delivery silently no-ops on the second attempt.

### 5.1 Staleness sweeper (amendment 2026-06-29)

The CAS guard that makes redelivery idempotent also means a `running` row can
never be reclaimed by redelivery: if the worker claims a row
(`pending -> running`) and then the process dies before writing `ok`/`failed`,
every later delivery fails the `WHERE status = 'pending'` guard and no-ops, so
the row is stuck `running` forever. The enqueue coalesce guard then returns
that in-flight row instead of starting new work, so the UI Sync button stays
disabled indefinitely (observed in production 2026-06-27: a row stuck two
days). `factory_sync_runs` had no recovery path of its own (the spec 124
sweeper covers only `factory_runs`).

`api/factory/syncRunsScheduler.ts` adds that recovery loop, mirroring the spec
124 `runsScheduler.ts` pattern: a `factory-sync-runs-staleness-sweeper` cron
(every 1 minute) flips any `(pending, running)` row whose
`COALESCE(started_at, queued_at)` is older than
`STATECRAFT_FACTORY_SYNC_STALE_AFTER_SEC` (default 600s; the per-repo clone
timeout is 120s, so a healthy sync finishes well inside the window) to
`failed`, corrects the denormalised `factory_upstreams.last_sync_status` for
the org's factory-side row so the Overview banner and Sync button re-arm, and
records a `factory.upstreams.sync_swept` audit row under the system user. Each
row is swept in its own transaction with a status re-check so it cannot race
the worker writing a terminal state.

## 6. Encore APIs

### Factory upstream PAT

| Method | Path                                  | Role        | Purpose                                    |
|--------|---------------------------------------|-------------|--------------------------------------------|
| GET    | `/api/factory/upstreams/pat`          | member+     | Metadata only. Returns `{exists,prefix,…}`. |
| POST   | `/api/factory/upstreams/pat`          | admin/owner | Body `{token}`. Validates against GitHub, stores or returns reason. |
| DELETE | `/api/factory/upstreams/pat`          | admin/owner | Hard delete. Audit-logged.                 |
| POST   | `/api/factory/upstreams/pat/validate` | admin/owner | Re-probe stored token, refresh scopes.     |

### Factory sync (replaces Phase 3's inline endpoint)

| Method | Path                                 | Role        | Purpose                        |
|--------|--------------------------------------|-------------|--------------------------------|
| POST   | `/api/factory/upstreams/sync`        | admin/owner | Enqueue a run. Returns `sync_run_id`. |
| GET    | `/api/factory/upstreams/sync/:id`    | member+     | Poll status.                   |
| GET    | `/api/factory/upstreams/sync`        | member+     | Last 20 runs.                  |

### Project PAT

| Method | Path                                       | Role            | Purpose                           |
|--------|--------------------------------------------|-----------------|-----------------------------------|
| GET    | `/api/projects/:id/github-pat`             | project:viewer+ | Metadata only.                    |
| POST   | `/api/projects/:id/github-pat`             | project:admin   | Validate + store.                 |
| DELETE | `/api/projects/:id/github-pat`             | project:admin   | Hard delete.                      |
| POST   | `/api/projects/:id/github-pat/validate`    | project:admin   | Re-probe.                         |

Validation reuses the `probeGitHub(token)` helper from `api/auth/pat.ts` —
that function is lifted into `api/auth/patProbe.ts` so both surfaces share
it without introducing a circular import.

## 7. UI

### `/app/factory/upstreams`

Adds a "Token" section below the existing upstream form:

- If a token exists: show prefix, scopes, format, last-used, last-checked,
  `Revalidate` and `Revoke` buttons.
- If no token: explain that PAT takes precedence over installation token
  and show a paste-in form. Required scope hints:
  fine-grained with `Contents: Read` on both source repos, or classic `repo`
  for private repos, or `public_repo` if both are public.

### `/app/factory` (Overview)

Converts the "Sync now" flow to poll the new run endpoint:

- Submit → returns `sync_run_id` → UI polls
  `GET /api/factory/upstreams/sync/:id` every 2s until terminal.
- Status banner reads from the run row's `status` + `counts` + `error`.
- A small "Recent syncs" table below the upstream cards shows the last 5
  runs (ok / failed / running / pending with timestamps).

### `/app/project/:id/settings/github-pat`

Rewires the existing page to use the new project-scoped endpoints instead
of `/auth/pat` (which stays as the user-level OIDC fallback). The UI
surface is largely the same — token paste, revoke, revalidate — but scoped
to the project.

## 8. Security

- Tokens never leave the Encore service in either direction — neither the
  metadata GET nor the POST response echoes the plaintext.
- Error messages from `git clone` already have the token scrubbed (see
  `api/factory/clone.ts:86`). Extend that pattern in any new log sites.
- Audit log entries on every `factory_upstream_pats` / `project_github_pats`
  mutation: `pat.factory.stored`, `pat.factory.revoked`,
  `pat.project.stored`, `pat.project.revoked`. Metadata includes
  `token_prefix`, `is_fine_grained`, `scopes` — never the plaintext.
- PostgreSQL foreign keys (`ON DELETE CASCADE`) ensure a project or org
  deletion also deletes its PAT row — no orphaned credentials.

## 9. Non-Goals

- A weekly background revalidator for the two new PAT tables. The user-PAT
  cron (`/internal/auth/pat-revalidate`) exists for the identity surface;
  revalidation of operational credentials is deferred.
- Multiple PATs per scope (e.g. read-only + write-capable). One per scope
  is sufficient until a concrete use case demands more.
- Fine-grained permission-scope validation (asserting the token has
  `Contents: Read` on the specific upstream). We capture whatever GitHub
  returns in `X-OAuth-Scopes` and surface it; failures show up on first
  clone attempt.
- Workspace-level factory PAT overrides. Spec 108 §3 already deferred
  workspace-level overrides for the upstream config; PATs follow the same
  rule.

## 10. Rollout

Four commits along the spec's natural seams, all on `main` (per the
no-compat-concerns working style):

1. **Spec 109 + migration 19 + schema.** DB surface, no behaviour change.
2. **tokenResolver + PAT APIs.** Add the two CRUD surfaces. Sync worker
   still inline.
3. **PubSub sync worker.** Replace inline sync with topic + subscription +
   run endpoints. Overview UI polls.
4. **Project PAT + UI wiring.** Project repo helpers use
   `resolveProjectRepoToken`; project settings page switches to the new
   endpoints; factory upstreams page grows the token section.
