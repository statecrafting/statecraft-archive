---
id: "113-statecraft-projects-rename-and-clone"
slug: statecraft-projects-rename-and-clone
title: Statecraft Projects Rename + In-Org Project Clone
status: approved
implementation: complete
owner: bart
created: "2026-04-26"
kind: product
domain: platform
risk: medium
summary: >
  Renames the statecraft web "Dashboard" surface to "Projects" (page title,
  subtitle, top-nav label) and turns the existing copy-icon stub on each
  project row into a real Clone action. Clone opens a dialog where the user
  can rename the new project (project name, slug, GitHub repo name) with
  live, debounced availability checks against the destination org and
  workspace. On submit it duplicates the source project's primary GitHub
  repo (full git history) into the user's current OAP org's GitHub
  installation, registers a new project bound to the new repo, copies the
  adapter binding and `.artifacts/raw/` knowledge objects, and emits a
  `project.cloned` audit event. Members and environments are not copied —
  they are governance state owned per project.
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (workspace as atom; current-org scope)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (factory_adapters binding)
  - "109-factory-pat-and-pubsub-sync"  # factory-pat-and-pubsub-sync (resolveProjectToken, installation broker)
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (import + scaffold reusable primitives)
extends:
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app._index.tsx }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.tsx }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/components/CloneProjectDialog.tsx }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/clone.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/cloneHelpers.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/cloneAvailability.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/encore.service.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/cloneAvailability.test.ts }
references:
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/projects/clone.test.ts }
---

# 113 — Statecraft Projects Rename + In-Org Project Clone

**Feature Branch:** `113-statecraft-projects-rename-and-clone`
**Created:** 2026-04-26
**Status:** Draft
**Input:** User description: "Rename Dashboard to Projects; add a Clone action on each listed project that clones the imported repo into the current org (e.g. `statecrafting`)."

## 1. Problem

The statecraft project listing page is currently labelled "Dashboard" with a "Manage your projects" subtitle, and the top nav uses the same word. The page is not a dashboard — it is a projects index — and the label drifts from spec 087's workspace-as-atom framing where projects are first-class operational units.

Each project row already renders a Copy-style icon between the row title and the Edit/Delete affordances. The handler is a `/* TODO: duplicate project */` stub (`web/app/routes/app._index.tsx:213-219`). There is no API behind it, no audit, no GitHub side-effect.

Users want to fork a working project — repo, adapter binding, raw knowledge objects — into the same OAP org so they can iterate on a copy without disturbing the original. Today they have to: create a new repo by hand on GitHub, mirror-push from the source, run `factory-import` against it, and re-bind whichever adapter applied. This spec collapses that into a single Clone action.

## 2. Goals

- The project listing page reads "Projects" everywhere a user can see it (page title, subtitle, top-nav tab).
- A Clone action on each project row opens a dialog where the user can rename the new project (project name, slug, GitHub repo name). The dialog runs debounced, async availability checks against the destination GitHub org and the workspace's project slugs so the user knows before submitting whether their chosen names will be accepted.
- On submit, Clone creates, in the user's current OAP org's GitHub installation, a fresh GitHub repo populated with the source repo's full git history, registers a new statecraft project bound to that repo, and lands the user on the new project's detail page.
- Clone is governed: it requires `org:project.create` in the destination org and read access to the source project; it emits a `project.cloned` audit event; failures roll back partial state (no orphaned GitHub repos, no orphaned DB rows).
- Adapter binding and `.artifacts/raw/` knowledge objects carry over — the cloned project is operational on day 1 with the same factory shape as the source.

## 3. Non-Goals

- Cross-org clone (cloning into a different OAP org). The user's request is "into the current org"; cross-org cloning is a separate trust boundary and is out of scope.
- Cross-workspace clone within the same org. The clone lands in the same workspace as the source.
- Free-form rename of arbitrary project fields beyond name / slug / GitHub repo name (description, adapter binding, visibility). Description is copied verbatim; the rest are not exposed in the dialog.
- Copying environments, project members, or `project_github_pats` rows. These are governance state — they must be configured explicitly on the new project.
- GitHub-style forks (which live under the source GitHub org, not the destination). Clone uses a dedicated mirror-push so the new repo is a true sibling under the destination org.
- Cloning aside-running factory pipeline state as a separate concern. The bytes of `.factory/pipeline-state.json` are duplicated as part of the git history; no special handling is needed.

## 4. User Scenarios & Testing

### User Story 1 — Clone a project into the current org with rename (Priority: P1)

A workspace member viewing the projects index decides to fork an existing project to experiment without touching the original. They click the Clone icon on the project row. A dialog opens pre-filled with sensible defaults: project name `"{source.name} (clone)"`, project slug `"{source.slug}-clone"`, and destination GitHub repo name `"{source-repoName}-clone"`. The destination GitHub org login (e.g. `statecrafting`) is shown as read-only so the user knows where the new repo will land.

The user can edit any of the three editable fields. As they type into the repo-name field, the UI debounces by ~300ms and asks the server whether the name is available in the destination org; the field shows one of *Checking… / Available / Already exists / Invalid name*. The same live check runs against the workspace's project slug uniqueness for the slug field. The Submit button stays disabled until both checks read Available (or both fields equal a known-available default).

On submit, the listing refreshes with a new entry sitting next to the source, and the user is navigated to the new project's detail page. The new project's repo lives under the destination org login (e.g. `statecrafting/{user-chosen-name}`) with the source repo's full git history.

**Why this priority:** This is the whole feature — the Clone action delivers the user-facing value. Rename without Clone leaves the page worded correctly but no new capability shipped.

**Independent Test:** From a fresh statecraft instance with one imported project bound to a real GitHub repo and an active GitHub App installation in the destination org, click Clone on the row. Edit the repo name to one that already exists in the destination org and verify the dialog shows "Already exists" and Submit is disabled. Edit it back to an unused name, see "Available", and submit. Verify (a) a new GitHub repo exists under the destination org with the user-chosen name, (b) `git log` on the new repo matches the source's default-branch SHAs, (c) a new `projects` row exists with the user-chosen slug, the same `workspaceId` and `factoryAdapterId` as the source, (d) `.artifacts/raw/` files appear in the new project's knowledge objects with matching `contentHash` values, (e) an `audit_log` row of action `project.cloned` is present and records both the user-chosen and source names.

**Acceptance Scenarios:**

1. **Given** a project with a primary repo `acme/foo` and adapter `acme-vue-node`, **and** the current org has GitHub App installed for `statecrafting`, **When** the user clicks Clone on the row, **Then** a dialog opens with name=`foo (clone)`, slug=`foo-clone`, repoName=`foo-clone`, destinationOrg=`statecrafting` (read-only), and the availability indicators next to slug and repoName both report Available.
2. **Given** the dialog is open with default values that are all available, **When** the user submits without editing, **Then** a new repo `statecrafting/foo-clone` is created with the same git history, a new project `foo (clone)` appears in the listing in the same workspace bound to that repo with the same adapter, the user is navigated to its detail page, and an `audit_log` row records the clone.
3. **Given** the destination org already contains a repo `statecrafting/foo-clone`, **When** the dialog opens, **Then** the repoName field shows "Already exists" with a hint to pick another name, **and** the Submit button is disabled, **and** changing the field to `foo-experiment` and waiting past the debounce updates the indicator to Available and re-enables Submit.
4. **Given** the user types `foo bar!` (invalid GitHub repo name) into the repo-name field, **When** the debounce elapses, **Then** the indicator reads "Invalid name" with a one-line rule reminder ("Only letters, digits, hyphens, underscores, and dots; max 100 chars"), **and** Submit is disabled, **and** no GitHub API call is made for that value.
5. **Given** two users open the dialog simultaneously and both pick `foo-clone` (which was free at check time), **When** they both submit, **Then** the server-side uniquification loop picks distinct names so one gets `foo-clone` and the other gets `foo-clone-2`, **and** both successes return their actual final names so the UI reflects truth.
6. **Given** the source repo is private, **When** the user clones, **Then** the destination repo is also created private and inherits the destination org's standard branch protection from the factory-create flow.
7. **Given** the source project has 17 entries in `.artifacts/raw/` registered as knowledge objects, **When** the clone completes, **Then** the new project has 17 knowledge object bindings with identical `contentHash` values, registered through the same path as `factory-import`.
8. **Given** the user clicks Cancel on the dialog, **When** the dialog closes, **Then** no API call is made beyond any already-issued availability checks, and no project / repo / audit row is created.

---

### User Story 2 — Project listing is labelled "Projects" (Priority: P2)

A user landing on `/app` sees "Projects" as the page title (not "Dashboard"). The top-nav tab that points to `/app` reads "Projects". The subtitle reflects the page's purpose ("Manage your projects" remains acceptable, but the H1 is the binding change).

**Why this priority:** The rename is a small but globally visible IA correction. It does not block Clone shipping (the icon was already on the row), but it removes the conceptual mismatch where the index of projects calls itself a dashboard.

**Independent Test:** Open `/app` as an authenticated user. Verify the H1 reads "Projects". Verify the top nav tab linking to `/app` reads "Projects". Verify no instance of the word "Dashboard" remains as a heading or nav label inside the project listing surface (the word may still appear in unrelated screens such as Encore's developer dashboard).

**Acceptance Scenarios:**

1. **Given** an authenticated user on `/app`, **When** the page renders, **Then** the H1 is "Projects" and the active top-nav tab text is "Projects".
2. **Given** the user is on `/app/factory` or `/app/workspace/agents`, **When** they look at the top nav, **Then** the first tab (linking to `/app`) reads "Projects".

---

### Edge Cases

- **No GitHub installation in destination org.** The Clone action MUST fail fast with a typed precondition error (`no_github_installation`). The UI MUST surface this both on dialog open (the dialog refuses to open with an inline explanation) AND on submit (defence in depth). No partial state is created.
- **Source project has no primary repo.** Pre-spec-080 projects may not have a `project_repos` row. Clone MUST refuse with `source_repo_missing` and the UI MUST hide the Clone icon when the loader knows the source has no primary repo.
- **Source repo is unreadable with current credentials.** `resolveProjectToken` for the source returns no usable token (revoked App, deleted PAT, etc.). Clone MUST refuse with `source_unauthorized` and the UI MUST surface a recoverable message pointing to the source project's Settings.
- **Destination repo creation succeeds but mirror-push fails.** The orchestrator MUST delete the GitHub repo it created before returning the error to the caller. No DB row is written.
- **DB insert (project / project_repo) fails after push succeeded.** The orchestrator MUST delete the GitHub repo to avoid an orphaned destination repo.
- **Knowledge-object hydration partially fails.** The new project row remains; the API returns success with a `rawArtifactsSkipped` count, mirroring `factory-import`'s tolerance posture. The audit event records the partial count.
- **Availability check race / TOCTOU.** A name reported Available in the dialog can become unavailable by the time the user submits (another user, another tab, an external GitHub commit). The server MUST always re-uniquify on submit; if the user-supplied name is unavailable AND the user explicitly typed it (i.e. it is not the server's pre-fill default), the server MUST fail with `name_taken` rather than silently pick a different name behind the user's back. If the value submitted equals the server's pre-fill default, the server MAY suffix `-2`, `-3`, … (matching FR-017) and the response carries the actual chosen name so the UI reflects truth.
- **Availability endpoint rate-limited by GitHub.** GitHub's secondary rate limit can throttle repo lookups. The endpoint MUST respond `{ available: null, reason: "rate_limited", retryAfterSec }` rather than guessing. The UI MUST treat `null` as "unable to verify; submit anyway and rely on server-side uniquification" (Submit is enabled but a warning shows).
- **Repo name clash exhausted after N suffix attempts (default N = 25).** Clone MUST fail with `name_exhausted` rather than picking a degenerate name.
- **Very large source repo.** A soft cap (default 500 MB working tree, 50k commits) MUST be enforced server-side. Repos exceeding the cap fail with `source_too_large` and a remediation message. The cap is configurable via env (`STATECRAFT_CLONE_MAX_BYTES`, `STATECRAFT_CLONE_MAX_COMMITS`).
- **Concurrent clones of the same source.** Two clones running simultaneously MUST each get a unique destination name via the same suffix-uniquification loop, gated by GitHub's 422 `already exists` response on `POST /orgs/:org/repos`.
- **Source repo lives in a GitHub org different from the destination.** This is permitted as long as the user has read access to the source (via `resolveProjectToken`). The destination is always the OAP-current-org's installation login — Clone never targets the source's GitHub org unless they happen to be the same.
- **Invalid input characters in the dialog.** GitHub repo names disallow most punctuation; project slugs must match `[a-z0-9-]+`. The UI MUST validate format client-side before issuing an availability call (so an invalid value never costs a GitHub API request) and the server MUST re-validate format on the availability endpoint and the submit endpoint.

## 5. Requirements

### 5.1 Functional Requirements

#### Rename surface

- **FR-001**: The H1 on `/app` MUST read "Projects" (replacing "Dashboard").
- **FR-002**: The top-nav tab pointing to `/app` MUST read "Projects" (replacing "Dashboard"). The route path stays at `/app`; this is a label-only change.
- **FR-003**: The subtitle MAY remain "Manage your projects" (no change required); if reworded it MUST reference projects, not a dashboard.
- **FR-004**: No occurrence of "Dashboard" remains as a heading or nav label on `/app` or in components rendered exclusively by that route. References inside Encore's own developer dashboard, telemetry, or unrelated admin screens are out of scope.

#### Clone action — UI

- **FR-005**: Each project row in the list view MUST render a Clone icon button (the existing copy icon at `app._index.tsx:213-219`) with `aria-label="Clone"`.
- **FR-006**: Each project card in the grid view MUST also expose Clone (parity with the list view; the grid currently has no row affordances and MUST grow them).
- **FR-007**: The Clone affordance MUST be hidden when the source project has no primary `project_repos` row. The loader MUST hydrate a `canClone: boolean` flag per project to drive this without an extra round-trip.
- **FR-008**: Clicking Clone MUST open a Clone Project dialog (modal). The dialog MUST contain three editable fields — Project Name, Project Slug, GitHub Repo Name — and one read-only field showing the destination GitHub org login. The dialog MUST NOT submit any clone request on open.
- **FR-009**: On dialog open the editable fields MUST be pre-filled with `name = "{source.name} (clone)"`, `slug = "{source.slug}-clone"`, `repoName = "{source-repoName}-clone"`. The dialog MUST issue an initial availability check for both slug and repoName so the user sees their state immediately on open.
- **FR-010**: The dialog MUST debounce input changes by ≥250ms (default 300ms) before issuing an availability request, and MUST cancel any in-flight check when a newer character lands.
- **FR-011**: The dialog MUST validate field format client-side BEFORE issuing an availability check: project slug matches `^[a-z0-9][a-z0-9-]{0,62}$`; GitHub repo name matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` and is not in `{".", ".."}`. Format-invalid values MUST show "Invalid name" with a one-line rule reminder and MUST NOT trigger a server call.
- **FR-012**: The dialog MUST render four indicator states next to each checked field: `idle` (no check has been issued for the current value), `checking` (request in flight or debounce pending), `available`, `unavailable` (with reason), `unverifiable` (rate-limited or transient error — Submit allowed with a warning).
- **FR-013**: The Submit button MUST be disabled while either field is in `checking`, `unavailable`, or `idle-with-format-error` state. It MUST be enabled when both fields are `available` or `unverifiable`.
- **FR-014**: While the clone request is in flight, the Submit button MUST show a loading state and the dialog MUST be non-dismissable except via an explicit Cancel that aborts the request (best-effort; server-side rollback handles partial state per FR-024).
- **FR-015**: On success, the page MUST navigate to the new project's detail page (`/app/project/{newProjectId}`). The response MUST carry the *actual* final name and slug (not the requested values) so the UI never claims a name it did not get.
- **FR-016**: On failure, the dialog MUST surface the typed error code and the human message returned by the API inline (no toast), so the user can correct input without losing the dialog.

#### Clone action — async availability API

- **FR-017**: A new endpoint `GET /api/projects/clone/check-availability` MUST exist on the projects service. Query parameters: `repoName?: string`, `slug?: string`, `workspaceId: string` (defaults to `auth.workspaceId`). Either `repoName` or `slug` (or both) MUST be supplied. Response shape: `{ repoName?: { value, state, reason? }, slug?: { value, state, reason? } }` where `state ∈ {"available","unavailable","invalid","unverifiable"}` and `reason` is one of `"format" | "exists" | "rate_limited" | "no_installation" | "transient_error"`.
- **FR-018**: The availability endpoint MUST require auth (`auth: true`) and MUST scope all checks to `auth.orgId` and `workspaceId`. It MUST reject (`forbidden`) if the caller is not a member of the destination workspace.
- **FR-019**: The availability endpoint MUST validate format server-side before any external call. Format failure MUST return `state = "invalid"` with `reason = "format"` and MUST NOT count against external rate limits.
- **FR-020**: For `repoName` checks, the endpoint MUST resolve the destination GitHub installation, broker a token, and call `GET /repos/{githubOrgLogin}/{repoName}`. HTTP 404 ⇒ `available`. HTTP 200 ⇒ `unavailable` with `reason = "exists"`. HTTP 403/429 with secondary-rate-limit headers ⇒ `unverifiable` with `reason = "rate_limited"` and a `retryAfterSec` field. Other non-2xx ⇒ `unverifiable` with `reason = "transient_error"`. Absence of an installation ⇒ `unverifiable` with `reason = "no_installation"`.
- **FR-021**: For `slug` checks, the endpoint MUST query `projects` for `(workspace_id, slug)` and return `unavailable` with `reason = "exists"` on a hit, `available` otherwise.
- **FR-022**: The availability endpoint MUST be cheap and idempotent. It MUST NOT mutate any state, MUST NOT emit audit rows, and MUST NOT consume any retry budget.

#### Clone action — submit API

- **FR-023**: A new endpoint `POST /api/projects/{sourceProjectId}/clone` MUST exist on the projects service. Body: `{ name?: string, slug?: string, repoName?: string }`. Absent fields use server defaults (per FR-009 pre-fills).
- **FR-024**: The endpoint MUST require auth (`auth: true`) and reject if the caller lacks `org:project.create` in the current org or read access to the source project.
- **FR-025**: The endpoint MUST resolve the destination GitHub installation for the current org via `githubInstallations` keyed by `auth.orgId`. Absence MUST return a typed `precondition_failed` with code `no_github_installation`.
- **FR-026**: The endpoint MUST resolve a source-side token via `resolveProjectToken({ projectId: sourceProjectId })` (reusing spec 109's resolver). Failure MUST return `source_unauthorized`.
- **FR-027**: The endpoint MUST clone the source repo's full git history (`git clone --mirror`, no `--depth`) into a tempdir, then push that mirror to the freshly-created destination repo with `git push --mirror`.
- **FR-028**: The destination repo MUST be created with `private = source.isPrivate` (fall back to `private = true` if source visibility is unknown). After push, branch protection MUST be configured via the same `configureBranchProtection` helper used by factory-create.
- **FR-029**: Repo-name resolution: if the request body's `repoName` matches the server's pre-fill default for this source (`{sourceRepoName}-clone`), the server MAY suffix `-2`, `-3`, … up to 25 attempts on collision. If `repoName` is a user-supplied value (anything else), a collision MUST return `name_taken` without silent suffixing — the user explicitly chose it. Exhaustion of suffix attempts on the default path MUST return `name_exhausted`.
- **FR-030**: Project-slug resolution: identical rules to FR-029 but evaluated against `(workspace_id, slug)` in `projects`. User-supplied slug collision returns `slug_taken`; default slug collision suffixes.
- **FR-031**: The new `projects` row MUST inherit `workspaceId`, `orgId`, and `factoryAdapterId` from the source. `name` defaults to `{source.name} (clone)` if absent in the body. `description` MUST be copied verbatim from the source. Submit MUST NOT accept an arbitrary description override (out of scope per §3).
- **FR-032**: The new `project_repos` row MUST link to the destination repo with `isPrimary = true` and `defaultBranch` matching the source's default branch as observed in the mirror clone.
- **FR-033**: After repo+project creation, the orchestrator MUST run the same raw-artifact registration path used by `factory-import` (`registerRawArtifactsFromRepo`) against the locally cloned working copy and bind resulting `knowledge_objects` to the new project.
- **FR-034**: On any failure after GitHub repo creation, the orchestrator MUST delete the destination repo (best-effort, with structured warning if delete fails) before returning the error to the caller. On any failure after the `projects` row insert, the orchestrator MUST delete the row (cascade handles `project_repos`) and the GitHub repo.
- **FR-035**: The endpoint MUST emit an `audit_log` row with `action = "project.cloned"`, `actor = auth.userId`, `target = newProjectId`, and `metadata = { sourceProjectId, sourceRepoFullName, newRepoFullName, requestedRepoName, requestedSlug, rawArtifactsCopied, rawArtifactsSkipped, durationMs }`. Including the requested-vs-final names lets governance reconstruct any silent suffixing.
- **FR-036**: The endpoint MUST enforce a server-side soft cap on source size (`STATECRAFT_CLONE_MAX_BYTES`, default 500 MB working tree post-clone) and commit count (`STATECRAFT_CLONE_MAX_COMMITS`, default 50000). Exceeding either MUST return `source_too_large` and skip both repo creation and DB writes.
- **FR-037**: The endpoint MUST NOT copy `project_members`, `environments`, or `project_github_pats` rows. The new project starts with the cloning user as its only member (role `admin`), matching the create-with-repo flow.
- **FR-038**: The submit response MUST include the actual final `name`, `slug`, `repoName` (post any server-side suffixing) so the UI navigates to the right place and never displays a name that does not match server truth.

#### SSR loader

- **FR-039**: `app._index.tsx`'s loader MUST also surface a per-project `canClone` flag computed from the existence of a primary `project_repos` row. The current `listProjects` API MUST be extended to include `hasPrimaryRepo: boolean` per project, OR the loader MUST issue a second batched call to `/api/projects/repos-summary`. Implementation choice is non-normative; the visible behaviour is that the Clone affordance is hidden for source projects with no repo.

### 5.2 Key Entities

- **`projects`** (existing): a destination row is inserted on Clone success. Inherits workspace, org, adapter binding from source; gets a fresh id and uniquified slug.
- **`project_repos`** (existing): destination repo row with `githubOrg = destinationGitHubOrgLogin`, `repoName = computed`, `defaultBranch = observedFromSource`, `isPrimary = true`.
- **`factory_adapters`** (existing, read-only here): the source's binding is copied as-is to the new project row.
- **`knowledge_objects`** + **`document_bindings`** (existing): re-hydrated from the locally cloned working tree using the same `registerRawArtifactsFromRepo` path as import. Each new binding points the existing knowledge object (deduped by `contentHash` per workspace) at the new project.
- **`audit_log`** (existing): one `project.cloned` row per successful clone.
- **`scaffold_jobs`** (existing): NOT used by the synchronous clone path. If a future iteration moves clone behind a job for progress streaming, that decision lives in a follow-up spec.
- **`githubInstallations`** (existing, read-only here): destination installation lookup keyed by `auth.orgId`.

### 5.3 Permissions and audit

- The cloning user MUST have `org:project.create` in `auth.orgId` (same gate as factory-create).
- The cloning user MUST have read access to the source project (member of the source's project_members, OR workspace-level read via the standard membership resolver).
- One `audit_log` row per Clone, action `project.cloned`. No audit row is written on rejected requests (consistent with the existing pattern).

### 5.4 Out-of-process operations

- `git clone --mirror` and `git push --mirror` are shelled (matching the existing import / push patterns). No new `simple-git` dependency is introduced.
- GitHub HTTP calls reuse `createGitHubRepo` and `configureBranchProtection` from `api/github/repoInit.ts`.
- Destination repo deletion (rollback) issues `DELETE /repos/:owner/:repo` with the destination installation token; failure to delete during rollback emits `log.warn` but does not block error propagation.

## 6. Success Criteria

### Measurable Outcomes

- **SC-001**: A user with the right permissions can clone a 50 MB / 500-commit source project end-to-end in under 30 seconds on a developer machine, finishing on the new project's detail page.
- **SC-002**: 100% of Clone success paths result in (a) a destination GitHub repo whose default-branch HEAD SHA matches the source's default-branch HEAD at clone time, (b) a new `projects` row, (c) a new `project_repos` row marked primary, (d) an `audit_log` row of action `project.cloned` with both requested and final names.
- **SC-003**: 100% of failure paths after GitHub repo creation leave zero orphaned destination repos under the destination org (verified by integration tests injecting failures at each post-create step).
- **SC-004**: No occurrence of the heading text "Dashboard" remains rendered on `/app` or in the top nav (verified by a route-level UI test asserting H1 and nav text).
- **SC-005**: The Clone affordance does not appear on rows for projects with no primary repo (verified by a UI test seeding two projects, one with a repo and one without, and asserting selector visibility).
- **SC-006**: An availability check round-trip from keystroke (post-debounce) to indicator update completes in under 800ms p50 / 2s p95 for `repoName` against an installed GitHub org, and under 100ms p95 for `slug` (DB only) — measured locally with the destination org installed.
- **SC-007**: For 100 randomised dialog sessions where a user types names that are mostly taken, at least 95% of the time the indicator shown to the user when they hit Submit matches the server's verdict on submit (i.e. the live check correctly predicts the submit outcome). The remaining ≤5% covers TOCTOU races, which the server resolves via FR-029/FR-030.
- **SC-008**: Format-invalid inputs (e.g. `foo bar!`) trigger zero outbound GitHub API requests from the availability endpoint (verified by a unit test asserting the GitHub fetch mock is never called for those values).

## 7. Open Decisions

These are intentionally left for the implementation plan to resolve; flagging them here so they don't become silent assumptions:

- **Async vs sync execution.** The spec assumes synchronous orchestration capped by FR-036's size limits. If real-world repos routinely exceed the cap, a follow-up spec adds a `clone_jobs` row with progress streaming, mirroring `scaffold_jobs`. The decision threshold is "do users actually have repos this big in our orgs"; not blocked by spec 113.
- **Per-org clone allow-list.** Some orgs may want to disable Clone entirely (compliance reasons). A boolean column on `organizations` would express this. Not in scope for the first cut.
- **Forking vs mirroring.** GitHub's fork API is faster but lands the new repo under the *source* org, not the destination, and locks the relationship into GitHub's fork graph. Spec 113 deliberately uses an independent mirror push so the destination repo is unrelated to the source on GitHub's side and lives where the user expects.
- **Availability endpoint caching.** A short-lived (e.g. 30s) per-(org, name) cache would smooth GitHub's secondary rate limit and reduce 429s during heavy editing. Implementation can ship without a cache and add it later under the same endpoint shape if telemetry shows it's needed.
- **Combined vs split availability calls.** FR-017 allows either field per request. The dialog can issue one combined call per debounce or two parallel calls. Either is conformant; the choice is purely a request-shape optimisation.

## 8. Provenance

- `web/app/routes/app._index.tsx:46-79` — current "Dashboard" / "Manage your projects" header.
- `web/app/routes/app._index.tsx:211-219` — current Copy-icon stub (`/* TODO: duplicate project */`).
- `web/app/routes/app.tsx:42-46` — current top-nav with `label: "Dashboard"`.
- `api/projects/import.ts:782-792` — `cloneRepo()` shell helper pattern this spec reuses (with `--mirror` instead of `--depth 1`).
- `api/projects/scaffold/githubRepoCreate.ts` — `createRepoWithBranchProtection()` pattern for destination repo setup.
- `api/projects/scaffold/githubPushInitial.ts` — initial-push pattern; clone uses `git push --mirror` against an already-pushed-empty repo.
- `api/projects/importArtifacts.ts` — `registerRawArtifactsFromRepo` reused verbatim for raw-artifact hydration.
- `api/projects/tokenResolver.ts` — `resolveProjectToken` for source-side credential resolution.
- Spec 087 §workspace-as-atom — framing for "current org" scope.
- Spec 109 — token resolution and installation broker primitives.
- Spec 112 §6 — import flow whose orchestration shape this spec mirrors.
