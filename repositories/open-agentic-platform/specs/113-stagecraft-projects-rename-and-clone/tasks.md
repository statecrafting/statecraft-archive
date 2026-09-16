# Tasks: Statecraft Projects Rename + In-Org Project Clone

**Input**: `/specs/113-statecraft-projects-rename-and-clone/`
**Prerequisites**: spec.md, plan.md
**Stories**: US-1 (Clone with rename dialog, P1), US-2 (Dashboard → Projects rename, P2)

Tasks are grouped by phase per `plan.md`. `[P]` = can run in parallel with other `[P]` tasks in the same phase. `[US1]` / `[US2]` = which user story.

---

## Phase 0 — Foundations (US-1)

Loader plumbing so the Clone affordance knows when to render.

- [ ] **T001** [US1] Extend `listProjects` (`api/projects/projects.ts`) to JOIN `project_repos` and return `hasPrimaryRepo: boolean` per row. Update the response type and any other callers.
- [ ] **T002** [US1] Update `web/app/lib/projects-api.server.ts` `listProjects` return type to include `hasPrimaryRepo`. Compute `canClone = hasPrimaryRepo` in the loader at `web/app/routes/app._index.tsx`.
- [ ] **T003** [US1] Pass `canClone` through `ProjectRow` props. Hide the Clone icon on rows where `canClone === false`.

**Checkpoint:** Listing renders. Rows without a primary repo show no Clone icon. Clone icon is still a no-op.

---

## Phase 1a — Backend availability endpoint (US-1)

Read-only, no audit, no retry budget. Fast feedback for the dialog.

- [ ] **T010** [US1] Create `api/projects/cloneAvailability.ts` with shared format validators: `isValidGithubRepoName(s)` (regex `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, reject `.` and `..`), `isValidProjectSlug(s)` (regex `^[a-z0-9][a-z0-9-]{0,62}$`).
- [ ] **T011** [US1] In `cloneAvailability.ts`, add helper `checkRepoAvailable(token, githubOrgLogin, repoName) → { state, reason?, retryAfterSec? }` calling `GET /repos/:org/:repo`. Map: 404 → `available`; 200 → `unavailable/exists`; 403/429 with secondary-rate-limit headers → `unverifiable/rate_limited`; other → `unverifiable/transient_error`.
- [ ] **T012** [US1] Add helper `checkSlugAvailable(workspaceId, slug)` querying `projects` for `(workspace_id, slug)`. `available` on 0 rows, `unavailable/exists` otherwise.
- [ ] **T013** [US1] Expose `GET /api/projects/clone/check-availability` (Encore `api({ expose: true, auth: true, method: "GET", path: "/api/projects/clone/check-availability" })`). Accept `repoName?`, `slug?`, `workspaceId?` (default `auth.workspaceId`). Return `{ repoName?, slug? }` shape per FR-017. Reject if either query param is missing OR if user is not a workspace member (`forbidden`).
- [ ] **T014** [P] [US1] Format-invalid inputs MUST return `{ state: "invalid", reason: "format" }` without making any GitHub call (FR-019). Add unit test in `cloneAvailability.test.ts` asserting the GitHub fetch mock is never called for invalid inputs.
- [ ] **T015** [P] [US1] Unit test: 404 → available; 200 → unavailable/exists; 429 with `X-RateLimit-*` → unverifiable/rate_limited with `retryAfterSec`. Use mocked `fetch`.
- [ ] **T016** [P] [US1] Unit test: slug check returns unavailable for an existing `(workspace_id, slug)` and available otherwise. Use the test DB harness already used by `import.test.ts`.
- [ ] **T017** [US1] Register `cloneAvailability.ts` in `api/projects/encore.service.ts` if Encore requires explicit registration (it auto-discovers, but verify in dev).

**Checkpoint:** `curl localhost:4000/api/projects/clone/check-availability?repoName=foo` returns a typed JSON response with the right state for available / taken / invalid / no-installation cases.

---

## Phase 1b — Backend submit endpoint (US-1)

Mirror clone, push, register, hydrate, audit. Rollback on every failure boundary.

- [ ] **T020** [US1] Create `api/projects/cloneHelpers.ts` with: `mirrorClone(token, owner, repo) → string` (returns workdir path; uses `git clone --mirror`), `mirrorPush(workdir, authedRemoteUrl) → void` (uses `git push --mirror`), `enforceSizeCaps(workdir, maxBytes, maxCommits) → void` (throws typed `source_too_large`), `defaultRepoName(sourceRepo) → string`, `defaultProjectSlug(sourceSlug) → string`.
- [ ] **T021** [US1] In `cloneHelpers.ts`, add `uniquifyRepoName(token, githubOrgLogin, baseName) → string` looping `baseName, baseName-2, … baseName-25`, using `checkRepoAvailable` from Phase 1a. Throws `name_exhausted` after 25 attempts.
- [ ] **T022** [US1] In `cloneHelpers.ts`, add `uniquifyProjectSlug(workspaceId, baseSlug) → string` mirroring T021 for project slug uniqueness.
- [ ] **T023** [US1] In `cloneHelpers.ts`, add `deleteGithubRepo(token, fullName) → void` (best-effort `DELETE /repos/:owner/:repo`; `log.warn rollback_repo_delete_failed` on non-2xx, never throws).
- [ ] **T024** [US1] Create `api/projects/clone.ts` with `POST /api/projects/{sourceProjectId}/clone` Encore endpoint. Body: `{ name?, slug?, repoName? }`. Steps: auth + `org:project.create` check; load source project + primary repo; resolve source token via `resolveProjectToken`; resolve destination installation token via `brokerInstallationToken`; mirror-clone source into tempdir; enforce size caps; resolve final repoName per FR-029; resolve final slug per FR-030; create destination GitHub repo; `git push --mirror` to destination; insert `projects` + `project_repos` rows in a DB transaction; run `registerRawArtifactsFromRepo` against the working tree; insert `audit_log` row with `requestedRepoName`, `requestedSlug`, final names, and durations; return `{ projectId, name, slug, repoFullName, opcDeepLink }`.
- [ ] **T025** [US1] Wrap T024's orchestration in try/catch that distinguishes failure boundaries: pre-create (no rollback), post-create-pre-push (delete repo), post-push-pre-db (delete repo), post-db-pre-hydrate (keep row, return partial success with `rawArtifactsSkipped`).
- [ ] **T026** [P] [US1] Integration test `clone.test.ts` happy path: source with 1 primary repo → submit with default body → assert new repo on GitHub mock, new `projects` row, new `project_repos` row, audit row, raw artefacts copied, response carries final names.
- [ ] **T027** [P] [US1] Integration test rollback on push failure: inject a push error → assert destination repo was deleted via the GitHub mock and no `projects` row exists.
- [ ] **T028** [P] [US1] Integration test rollback on DB insert failure: inject a DB insert error after push success → assert destination repo deleted and zero `projects` rows.
- [ ] **T029** [P] [US1] Integration test name conflict on user-supplied name: source default is free but user submits `repoName: "taken"` which exists → assert `name_taken` error and no DB writes.
- [ ] **T030** [P] [US1] Integration test name conflict on default: source default `foo-clone` already exists → assert response carries `repoFullName` ending `foo-clone-2` and audit `requestedRepoName === "foo-clone"`, `newRepoFullName.endsWith("foo-clone-2")`.
- [ ] **T031** [P] [US1] Integration test size cap: pre-clone size > `STATECRAFT_CLONE_MAX_BYTES` → assert `source_too_large` and zero side-effects.
- [ ] **T032** [P] [US1] Integration test no-installation path: destination org without `githubInstallations` row → assert `precondition_failed/no_github_installation` and zero side-effects.

**Checkpoint:** All clone integration tests pass. End-to-end: `POST /api/projects/{id}/clone` produces a working destination repo, project row, audit row, and survives every failure injection cleanly.

---

## Phase 2 — Frontend dialog (US-1)

Pre-filled, debounced, format-then-availability gated.

- [ ] **T040** [US1] Add `cloneProject` and `checkCloneAvailability` helpers to `web/app/lib/projects-api.server.ts` mirroring the existing `factory-import` / `createFactoryProject` shape. Types match the API responses exactly.
- [ ] **T041** [US1] Create `web/app/components/CloneProjectDialog.tsx`. Props: `{ source: ProjectRow; destinationGithubOrgLogin: string; onClose(): void; onSubmitted(newProjectId: string): void }`. Local state: editable `name`, `slug`, `repoName`; per-field `state ∈ {idle, checking, available, unavailable, invalid, unverifiable}`; submitting flag; submit error.
- [ ] **T042** [US1] Pre-fill name = `${source.name} (clone)`, slug = `${source.slug}-clone`, repoName = `${sourceRepoName}-clone`. On open, fire one initial availability call for both fields so the indicator never starts in `idle`.
- [ ] **T043** [US1] Wire debounced (300ms) availability calls. Cancel any in-flight request on a newer keystroke. Format-validate client-side first; if invalid, set state to `invalid` with the rule reminder and DO NOT call the server (FR-011, FR-019, SC-008).
- [ ] **T044** [US1] Render four indicator states with copy: `Checking…` (spinner), `Available` (green check), `Already exists` / `Invalid name` / `Rate-limited (retry in {n}s)` (red/yellow), and an `idle-with-format-error` variant. Disable Submit per FR-013.
- [ ] **T045** [US1] On Submit, post to `/api/projects/{id}/clone` with body `{ name, slug, repoName }`. While in flight, show button loading state and make Cancel abort the fetch (best-effort). On success, call `onSubmitted(response.projectId)`.
- [ ] **T046** [US1] On failure, surface the typed error code + human message inline in the dialog (no toast). Do not auto-close; let the user fix and retry.
- [ ] **T047** [US1] In `app._index.tsx`, replace the Copy-icon `onClick={() => /* TODO: duplicate project */}` with `setCloneSource(project)` to open the dialog. Mount `<CloneProjectDialog … />` once at the route level. On `onSubmitted`, navigate via `useNavigate()` to `/app/project/${newProjectId}`.
- [ ] **T048** [US1] Mirror the same Clone affordance on the grid card (`ProjectGrid` component) — currently the grid has no row affordances and grows them per FR-006.
- [ ] **T049** [P] [US1] UI test (Playwright or vitest+RTL — match whatever statecraft web tests already use): open dialog, verify pre-fill values and initial Available state.
- [ ] **T050** [P] [US1] UI test: type a taken name → see `Already exists` and disabled Submit; clear and type a free name → see `Available` and enabled Submit (after debounce).
- [ ] **T051** [P] [US1] UI test: type `foo bar!` → see `Invalid name` immediately; assert no availability fetch was issued for that value.

**Checkpoint:** Clicking Clone opens the dialog. Editing fields produces correct indicators. Submitting with valid input lands on the new project's detail page. Submitting with a now-taken name surfaces the inline error.

---

## Phase 3 — Rename Dashboard → Projects (US-2)

Independent, fast.

- [ ] **T060** [US2] In `web/app/routes/app._index.tsx`, change the H1 from `Dashboard` to `Projects` (line ~73). Subtitle stays as `Manage your projects`.
- [ ] **T061** [US2] In `web/app/routes/app.tsx`, change `NAV_ITEMS[0].label` from `"Dashboard"` to `"Projects"` (line ~43). Route stays `/app`.
- [ ] **T062** [P] [US2] Grep `web/` for any other user-visible `"Dashboard"` heading or nav label tied to `/app`. Update any found; ignore Encore's developer dashboard and unrelated admin screens.
- [ ] **T063** [P] [US2] UI test asserting the H1 on `/app` reads `Projects` and the active top-nav tab text is `Projects`.

**Checkpoint:** No instance of `Dashboard` heading or nav label remains on `/app`. SC-004 passes.

---

## Phase 4 — Polish & verification

- [ ] **T070** Run `make ci` locally; fix any lint, typecheck, or test breakage from the new files.
- [ ] **T071** Add an entry to `platform/services/statecraft/CLAUDE.md` "Factory project scaffold" section describing `clone.ts` alongside `create.ts` and `import.ts`.
- [ ] **T072** Manual end-to-end: from a real statecraft instance with a GitHub installation in the destination org, clone a small public repo project; verify the destination repo, project row, audit row, knowledge-objects, and the new project's detail page render.
- [ ] **T073** Manual rollback verification: temporarily make `git push --mirror` fail (e.g. revoke installation token mid-flight); confirm the destination repo is deleted and no orphan remains under the destination org.
- [ ] **T074** Update spec frontmatter `implementation:` from `pending` to `complete` once all checkpoints pass; re-run `tools/spec-spine/spec-compiler/target/release/spec-compiler compile` and `tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile` so traceability picks up the new files.

---

## Dependencies & parallel opportunities

- **Phase 0** blocks frontend rendering of the Clone affordance but does NOT block backend work (1a, 1b can develop with stubbed loader).
- **Phase 1a** blocks Phase 2 dialog availability calls being real; the dialog can scaffold with a stubbed availability response and switch over once 1a lands.
- **Phase 1b** blocks Phase 2 submit being real; same stub-then-replace pattern.
- **Phase 2** depends on Phases 0 + 1a + 1b for full integration but can scaffold ahead with stubs.
- **Phase 3 (US-2)** is fully independent and can ship at any time, including before US-1.
- Tasks marked `[P]` within a phase touch different files and can run in parallel.

## Notes

- Each task should land as one or two commits keeping the diff under the 500-line `CONST-004` warn threshold where practical.
- Tests live next to the file they cover (`clone.test.ts` next to `clone.ts`), matching the existing `import.test.ts`, `opcBundle.test.ts`, `scaffold.test.ts` pattern.
- No new DB migration is required (per plan.md). If T024's transaction shape calls for one (e.g. an index on `(workspace_id, slug)` we don't already have), add it as a sub-task and call it out in the PR.
- Audit row metadata is the surface governance reads; keep the field set in T024 stable across renames so dashboards don't break.
