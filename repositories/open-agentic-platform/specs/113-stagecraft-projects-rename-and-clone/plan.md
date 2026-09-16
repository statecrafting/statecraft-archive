# Implementation Plan: Statecraft Projects Rename + In-Org Project Clone

**Spec**: [spec.md](./spec.md)
**Feature**: `113-statecraft-projects-rename-and-clone`
**Date**: 2026-04-27
**Branch**: `113-statecraft-projects-rename-and-clone`

## Summary

Two changes shipped together because they share the same surface (`/app`). The substantive piece is **Clone**: a row affordance opens a modal, the modal runs debounced async availability checks against the destination GitHub org and the workspace's project slugs, and on submit the backend mirror-clones the source repo into the current OAP org's GitHub installation, registers a new `projects` row, hydrates raw artefacts via the same path as `factory-import`, and audits. Rollback deletes the destination GitHub repo on any post-create failure. The lighter piece is the **rename** of "Dashboard" → "Projects" on the listing page H1, subtitle, and top-nav label — a label-only IA fix; route stays `/app`.

The two stories are independently testable and shippable. US-2 (rename) is a 10-minute cosmetic change; US-1 (clone) is the substantive work and dominates the timeline.

## Sequencing

| Phase | Focus | Story |
|-------|-------|-------|
| **0**  | Foundations: extend `listProjects` with `hasPrimaryRepo`; add `canClone` plumbing through SSR loader | US-1 |
| **1a** | Backend availability endpoint (`GET /api/projects/clone/check-availability`) + format validators + GitHub repo-exists probe | US-1 |
| **1b** | Backend submit endpoint (`POST /api/projects/{id}/clone`) — mirror clone + push + DB writes + raw-artefact hydration + rollback | US-1 |
| **2**  | Frontend `CloneProjectDialog` — pre-fills, debounced availability, four-state indicators, gated Submit, inline error surface | US-1 |
| **3**  | Wire row + grid Clone icons to dialog; navigate to new project on success | US-1 |
| **4**  | Rename "Dashboard" → "Projects" in `app._index.tsx` H1 and `app.tsx` nav | US-2 |
| **5**  | Verification: integration test for rollback on injected failure; UI test asserting H1/nav text and Clone affordance visibility |  |

Phases 1a, 1b, and 2 can begin in parallel once Phase 0 lands; the dialog can stub the availability endpoint until 1a is real, and the submit-button wire-up can stub the submit endpoint until 1b is real. Phase 4 is fully independent of US-1 and can ship first if it unblocks anything else.

## Approach decisions

- **Mirror push, not GitHub fork.** GitHub's fork API would put the new repo under the *source* org and lock the fork relationship. We want a clean sibling under the destination org and we want it independent of GitHub's fork graph. Cost: a real `git clone --mirror` + `git push --mirror`. Reusing the existing shell-based git pattern from `import.ts:782-792` and `scaffold/githubPushInitial.ts` — no new git library dependency.
- **Synchronous orchestration with size cap.** FR-036 caps source size at 500 MB / 50k commits. Above that we'd need a job row with progress streaming (mirroring `scaffold_jobs`); that work is a follow-up spec, not blocking this one. Keep the submit endpoint a single round-trip for now.
- **Default-vs-user-typed name semantics.** When the body's `repoName` matches the server's pre-fill default, we silently suffix on collision. When the user typed a different name, we fail with `name_taken` rather than picking something they didn't choose. This makes the audit row's `requested` vs `final` columns meaningful.
- **Availability endpoint = read-only, no audit, no retry budget.** Cheap and idempotent so the UI can hammer it as the user types. Format validation runs first to keep invalid values from costing GitHub API calls.
- **Rollback discipline.** Three failure boundaries: GitHub repo created → push failed (delete repo); push succeeded → DB insert failed (delete repo); DB insert succeeded → artefact hydration failed (keep row, return success with `rawArtifactsSkipped`, mirroring import's tolerance). Repo deletion is best-effort with `log.warn` on failure — never blocks the error returned to the caller.
- **TOCTOU race on submit.** The dialog's "Available" verdict can be stale. The submit endpoint always re-checks; FR-029/FR-030 describe the resolution. The dialog never claims an outcome it didn't get because FR-038 makes the response carry the actual final names.
- **No new DB migration.** All required state already exists (`projects`, `project_repos`, `audit_log`, `knowledge_objects`, `document_bindings`, `factory_adapters`, `githubInstallations`). The clone path writes to existing tables with existing columns.
- **Dialog component is local to the route, not a global modal.** Lives in `web/app/components/CloneProjectDialog.tsx` and is mounted inside `app._index.tsx`'s render tree. No router state for an open/closed dialog — local React state is enough since the index route is the only opener.

## Risks

- **GitHub secondary rate limit on availability checks.** Heavy editing in the repo-name field could 429 the destination installation token. Mitigated by client-side debounce (≥250ms), client-side format gate (no API call for invalid input), and `unverifiable rate_limited` state that allows submit anyway and relies on server-side uniquification as the safety net.
- **Mirror push of large repos blocking the request thread.** Cap (FR-036) protects the request thread. If a real source is just under the cap, response time can be tens of seconds. Accept this for the first cut; revisit only if telemetry shows it's a problem.
- **Token resolution divergence between source and destination.** Source uses `resolveProjectToken({ projectId })` (spec 109). Destination uses `brokerInstallationToken` against the current org's `githubInstallations` row. They can be different installations — that's fine, just means two `Authorization` headers in play. Tests must cover the cross-org-source case.
- **Repo deletion on rollback can fail silently.** If the destination installation lacks `delete_repo` scope, the orphaned-repo warning is the only signal. Document in `cloneHelpers.ts` and emit a structured `log.warn` with `rollback_repo_delete_failed` so it's grep-able.
- **`canClone` flag adds a second query path.** Either we extend `listProjects` to JOIN against `project_repos` (cheap), or we issue a second `/api/projects/repos-summary` call from the loader. JOIN is preferred — keeps the loader at one round-trip.

## References

- Spec: [`./spec.md`](./spec.md)
- Existing primitives this spec reuses:
  - `platform/services/statecraft/api/projects/import.ts:782-792` — `cloneRepo()` shell pattern (we extend with `--mirror`)
  - `platform/services/statecraft/api/projects/scaffold/githubRepoCreate.ts` — `createRepoWithBranchProtection`
  - `platform/services/statecraft/api/projects/scaffold/githubPushInitial.ts` — initial-push pattern (we substitute `git push --mirror`)
  - `platform/services/statecraft/api/projects/importArtifacts.ts` — `registerRawArtifactsFromRepo`
  - `platform/services/statecraft/api/projects/tokenResolver.ts` — `resolveProjectToken`
  - `platform/services/statecraft/api/github/repoInit.ts` — `createGitHubRepo`, `configureBranchProtection`, `brokerInstallationToken`
  - `platform/services/statecraft/api/auth/membership.ts` — `hasOrgPermission`
  - `platform/services/statecraft/web/app/routes/app._index.tsx:46-79` — header to rename
  - `platform/services/statecraft/web/app/routes/app._index.tsx:211-248` — row affordances + Copy-icon stub to wire
  - `platform/services/statecraft/web/app/routes/app.tsx:42-46` — top-nav `NAV_ITEMS` to relabel
  - `platform/services/statecraft/web/app/lib/projects-api.server.ts:75-110` — pattern for new helper functions
- Related specs: 087 (workspace-as-atom), 108 (factory adapters), 109 (token resolver), 112 (import flow we mirror)
