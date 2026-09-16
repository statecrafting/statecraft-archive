---
id: "213-tenant-repo-image-build"
title: "Tenant Repo Image Build and Artifact-Ref Record"
feature_branch: "feat/213-tenant-repo-image-build"
status: draft
implementation: pending
kind: platform
domain: platform
created: "2026-06-12"
authors: ["open-agentic-platform"]
language: en
amended: "2026-06-16"
amendment_record: |
  Amended 2026-06-16 by 214-tenant-app-chart-supersession (Stage 2): the
  cd-tenant-hello.yml precedent reference in repoInit.ts's OAP_BUILD_WORKFLOW
  comment is updated to cd-tenant-app.yml, the workflow that replaced it when
  214 retired the synthetic tenant-hello reference. Documentation-only; no
  behavior change.
summary: >
  Close the deferral spec 137 recorded as "CI / container-build for tenant
  repos (separate spec)". Today a factory-created project repo receives only
  the oap-verify.yml governance stub; nothing builds an OCI image for the
  scaffolded commit, and the GitHub webhook handler's preview-deploy path
  assumes a ghcr.io image tag that no workflow produces. This spec seeds an
  active container-build workflow into created repos, locks the image-ref
  naming convention (sha tags on every default-branch push, pr-N alias tags
  on pull requests, per-variant suffixes for dual-profile trees), and gives
  statecraft a project_artifacts record plus a deterministic artifact-ref
  derivation so the deploy path (spec 215) can resolve "the image for this
  commit" without guessing.
code_aliases: ["TENANT_REPO_IMAGE_BUILD"]
depends_on:
  - "112-factory-project-lifecycle"
  - "136-tenant-hello-demo-service"
  - "138-statecraft-create-realised-scaffold"
extends:
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/github/repoInit.ts }
  - spec: "080-github-identity-onboarding"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/github/webhook.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  # Additive extension of 119's project-create service: FR-008 retrofit
  # endpoint (the create-time seed moved to the scaffold path, below).
  - spec: "119-project-as-unit-of-governance"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/projects.ts }
  # FR-001 seeds oap-build.yml into the scaffold tree at commit #1; the
  # scaffold assembly is spec 112's, claimed here as an additive extension.
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts }
  # Same precedent as specs 202, 196, 194, 193, 187, 183: a new spec adds a
  # row to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
establishes:
  # Owning edges for the files this spec brings into existence (FR-005 /
  # FR-006). Converted from references: planned-establishes now that the
  # implementation PR has landed them (spec 200 precedent, including the
  # migration pair).
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/artifacts.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/deploy/artifacts.test.ts }
  # FR-009: one-repo-one-project unique index + its regression cover.
  - unit: { kind: file, path: platform/services/statecraft/api/github/webhook.test.ts }
refines:
  # FR-009 adds webhook.test.ts to the encore-test lane exclude list (the
  # vite.config.ts exclude list IS the lane assignment; same precedent as
  # spec 215's deployments.test.ts row).
  - aspect: "encore-test-lane-assignment"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
references:
  # Precedent only while it lives: spec 214 supersedes and retires this
  # workflow; the seeded oap-build.yml below is the canonical tenant
  # build path going forward.
  - role: build-workflow-precedent
    unit: { kind: file, path: .github/workflows/cd-tenant-hello.yml }
  - role: seeding-precedent
    unit: { kind: file, path: platform/services/statecraft/api/github/repoInit.ts }
  - role: downstream-consumer
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploydClient.ts }
---

# Feature Specification: Tenant Repo Image Build and Artifact-Ref Record

**Feature Branch**: `213-tenant-repo-image-build`
**Created**: 2026-06-12
**Status**: Draft (first of the three deploy-path specs; siblings are 214
tenant-app-chart-supersession and 215 statecraft-deploy-trigger-ux)
**Input**: Spec 137 §Out-of-scope, line 363: "CI / container-build for
tenant repos (separate spec)". This is that spec. The 2026-06-12
deploy-path survey found the chain broken at this link: the webhook
handler dispatches preview deployments with
`artifact_ref: ghcr.io/<org>/<repo>:pr-<n>` (webhook.ts) but no workflow
in the seeded repo ever publishes that tag.

## Purpose

A deployment on deployd-api is, mechanically, a Helm install of an OCI
image (`artifact_ref` on `POST /v1/deployments`). For the reference tenant
(tenant-hello, spec 136) the image exists because the OAP monorepo's own
`cd-tenant-hello.yml` builds and pushes it. For a factory-created project
the equivalent does not exist: `repoInit.ts` seeds exactly one workflow,
`oap-verify.yml`, which is a governance status-check stub with no build
step. The upstream template (template) ships a complete
build-and-push workflow, but as an inactive `.example` file that no one
renames, and its tag convention (`:<sha>`) does not match what the
preview-deploy webhook assumes (`:pr-<n>`).

This spec makes image production a property of project creation, not a
manual afterthought, and makes the resulting image ref something statecraft
can compute and verify rather than guess.

## Code reality (2026-06-12 survey)

- `repoInit.ts` seeds `.github/workflows/oap-verify.yml` only (verify stub;
  no build, no push).
- `webhook.ts` `pull_request opened/synchronize` calls
  `createPreviewDeployment` with a hard-coded
  `ghcr.io/{repository.full_name}:pr-{n}` ref that nothing publishes.
- template carries `.github/workflows/encore-cd.yml.example`:
  `encore build docker --base apps/api/Dockerfile.base`, GHCR login, push
  tagged by commit SHA. Inactive by construction (`.example` suffix), and
  not copied into scaffolds by `perRequestScaffold.ts`.
- The scaffold tree always contains `apps/api/Dockerfile.base` (base OS
  layer consumed by `encore build docker --base`); for `dual` profile
  trees the variant copies live under top-level `public/` and `internal/`
  directories, each with its own `apps/api`.
- `encore build docker` requires no Encore-platform authentication
  (validated previously on this workstation).
- There is no table or column anywhere in statecraft that records a built
  image ref; `scaffold_jobs.commitSha` records the seeded commit SHA.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Created project produces a deployable image (Priority: P1)

An operator creates a project through statecraft. Without any manual step
in the new repo, the scaffolded commit is built into an OCI image and
pushed to the org's registry under a predictable name.

**Why this priority**: every downstream deploy feature (specs 214, 215) is
inert without an image to deploy; this is the root of the chain.

**Independent Test**: create a project; wait for the seeded build workflow
to complete; `docker pull` (or registry-API HEAD) the conventional ref for
`scaffold_jobs.commitSha`; the manifest exists.

**Acceptance Scenarios**:

1. **Given** a freshly created project with profile `public`, **When** the
   seeded build workflow completes on the initial commit, **Then**
   `ghcr.io/{org}/{repo}:sha-{shortSha}` is pullable.
2. **Given** a freshly created project with profile `dual`, **When** the
   build workflow completes, **Then** both
   `ghcr.io/{org}/{repo}:sha-{shortSha}-public` and
   `ghcr.io/{org}/{repo}:sha-{shortSha}-internal` are pullable.
3. **Given** the build fails (compile error in a future commit), **Then**
   the workflow run is red on the repo and no tag for that SHA exists; no
   partial/latest tag moves.

### User Story 2 - PR preview tags match the webhook's assumption (Priority: P2)

A developer opens a PR on a tenant repo. The build workflow publishes the
image under both the sha tag and the `pr-{n}` alias, so the existing
preview-deploy webhook path (spec 137 era) dispatches an image that
actually exists.

**Independent Test**: open a PR on a seeded repo; after the build run,
`ghcr.io/{org}/{repo}:pr-{n}` resolves to the same digest as the head
commit's sha tag.

**Acceptance Scenarios**:

1. **Given** an open PR with a completed build, **When** the webhook
   dispatches a preview deployment, **Then** the image pull succeeds in
   the cluster (no ImagePullBackOff caused by a missing tag).

### User Story 3 - Statecraft can answer "what image does this commit have?" (Priority: P2)

Statecraft (the deploy trigger UI of spec 215, or an operator via API)
resolves the artifact ref for a given project + commit without scraping
GitHub: first from the `project_artifacts` record, falling back to the
deterministic naming convention.

**Independent Test**: after a build completes, the artifacts API returns a
row whose `imageRef` equals the conventional derivation for that repo +
SHA; deleting the row, the derivation function still returns the same
string.

**Acceptance Scenarios**:

1. **Given** a completed default-branch push build for SHA S, **When**
   `workflow_run.completed` arrives at the webhook, **Then** a
   `project_artifacts` row exists with `releaseSha = S`, the conventional
   `imageRef`, and the variant (or `root` for single-variant trees). A
   `pull_request` build records no row (its `head_sha` has no
   `sha-<head_sha>` tag).
2. **Given** no recorded row (webhook missed), **When** the deploy path
   asks for the artifact ref, **Then** the derivation function returns the
   conventional ref and the caller verifies existence against the registry
   before dispatch.

### Edge Cases

- Repo renamed after creation: the convention derives from the current
  `project_repos` row, not a frozen string; recorded rows keep the ref
  that was actually pushed.
- Workflow seeded but Actions disabled on the org/repo: surfaced as a
  build-pending state, never as a silent success (spec 215 renders this).
- Two builds race on the same SHA (re-run): tags are idempotent by
  content; the recorded row upserts on `(projectId, releaseSha, variant)`.
- GHCR package visibility is private by default: pulling from the cluster
  is the concern of spec 214 (`imagePullSecrets`); this spec only
  guarantees push.
- Phantom artifact from a PR build (corrected 2026-07-01): the webhook
  originally recorded a `project_artifacts` row for **every** successful
  `oap-build` run, including `pull_request` ones, keyed on `run.head_sha`.
  For a PR run `head_sha` is the PR head commit, but the workflow's
  `Push sha tag` step tags the checkout HEAD, which on a `pull_request`
  event is the ephemeral merge commit, so it publishes `sha-<mergesha>`
  plus the `pr-<n>` alias, never `sha-<head_sha>`. The recorded row therefore
  pointed at a tag GHCR never had (observed with `single-simple`'s open
  Dependabot PR head `8c65109b6020`), and because it was the newest `builtAt`
  the deploy path (`resolveLatestArtifact`) selected it over the valid
  default-branch image and failed to pull. FR-006 now records only
  default-branch push builds (`isDefaultBranchPush`), so a PR build can never
  shadow the deployable image.
- Repo linked to more than one project (FR-009): observed 2026-06-20 when
  creating project B's repo emitted a `repository.created` webhook that
  the handler auto-linked to the only project then existing (A), racing
  B's own creation. B's build was then recorded under A's
  `project_artifacts`, and A's manual deploy resolved B's image and failed
  on the cluster. FR-009 makes the `(github_org, repo_name)` edge unique,
  removes the speculative link, and makes `findRepoRow` fail loud on
  ambiguity, so a build can never be attributed to the wrong project.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Project creation MUST seed an active build workflow
  (`.github/workflows/oap-build.yml`) into the new repo so the scaffolded
  commit builds with no manual step in the new repo (SC-001). The seed is
  written into the factory-create scaffold tree by
  `scaffold/perRequestScaffold.ts` so it rides commit #1. (Mechanism
  corrected at implementation, 2026-06-15: the original "same `repoInit.ts`
  step that seeds `oap-verify.yml`" wording targeted `createProjectWithRepo`,
  the README-only create path with no `apps/api` to build; the scaffold tree
  is where the buildable app actually lands.) The workflow builds via
  `encore build docker --base apps/api/Dockerfile.base`, preceded by the
  canonical `npm ci` + `npm run build` (see `plan.md` "Build shape"),
  authenticates to GHCR with the workflow's `GITHUB_TOKEN` (`packages:
  write`) with the `GHCR_PUBLISH_TOKEN` PAT fallback of Clarification 2, and
  pushes. Repos created before this spec are seeded via the FR-008 retrofit.
- **FR-002**: Image naming convention (normative):
  `ghcr.io/{githubOrg}/{repoName}:sha-{shortSha}` for single-variant trees;
  `...:sha-{shortSha}-{variant}` per variant for dual-profile trees
  (variant in `public | internal`). `shortSha` is the 12-character commit
  SHA prefix. No `latest` tag is published.
- **FR-003**: On `pull_request` events the workflow additionally tags the
  head-commit image `pr-{number}` (and `pr-{number}-{variant}` for dual),
  aligning the existing preview-deploy dispatch in `webhook.ts` with a tag
  that exists. The webhook's hard-coded ref construction MUST be replaced
  by the shared derivation of FR-005.
- **FR-004**: The workflow MUST detect the tree layout: if top-level
  `public/` and `internal/` directories each contain `apps/api`, build a
  matrix over the two variant roots; otherwise build the repo root.
- **FR-005**: A single derivation function (new module
  `platform/services/statecraft/api/deploy/artifacts.ts`) MUST own the
  ref convention: `deriveArtifactRef({githubOrg, repoName, sha, variant})`.
  All statecraft call sites (webhook preview path, spec 215 trigger path)
  MUST use it; no inline `ghcr.io/...` string construction remains.
- **FR-006**: New table `project_artifacts` (Postgres, `schema.ts` +
  migration): `id`, `projectId`, `releaseSha`, `variant` (`root | public |
  internal`), `imageRef`, `workflowRunId`, `builtAt`, unique on
  `(projectId, releaseSha, variant)`. Populated by the GitHub webhook on
  `workflow_run.completed` (workflow name `oap-build`, conclusion
  `success`) for repos present in `project_repos`, **and only for
  default-branch push builds** (`run.event = push` and `run.head_branch =
  repository.default_branch`; gate pure function `isDefaultBranchPush` in
  `webhook.ts`). This follows directly from FR-002: only a default-branch
  push publishes a `sha-<head_sha>` tag whose sha equals `run.head_sha`. A
  `pull_request` run checks out the ephemeral merge commit, so it publishes
  `sha-<mergesha>` plus the FR-003 `pr-<n>` alias, never `sha-<head_sha>`;
  recording its `head_sha` stores a row pointing at a never-pushed tag
  (corrected 2026-07-01, see Edge Cases). Best-effort: a missed event
  degrades to FR-005 derivation, never to a hard failure.
- **FR-007**: An existence check `artifactExists(imageRef)` MUST be
  provided (GHCR manifest HEAD using the GitHub App installation token),
  so deploy callers can distinguish "image not built yet" from "deploy
  failed". Rate-limit failures return indeterminate, not false.
- **FR-008**: Retrofit path: an idempotent server-side action MUST be able
  to seed `oap-build.yml` into an existing project repo created before
  this spec (same GitHub App content-write used at create time). Exposed
  as an admin API; UI exposure is spec 215's concern.
- **FR-009** (added 2026-06-20): One GitHub repo maps to **exactly one**
  project. FR-006 derives a build's owning project from `project_repos`
  via `findRepoRow(org/repo)`; that attribution is correct only if the
  `(github_org, repo_name)` edge is 1:1. The invariant MUST be enforced
  structurally and at every write site:
  1. **Schema**: `project_repos` carries a unique index on
     `(github_org, repo_name)` (migration `51_project_repos_unique_repo`).
     The migration resolves any pre-existing duplicate links by keeping
     the `is_primary` link and dropping non-primary duplicates; it fails
     loud when a duplicate group has zero or multiple primaries rather
     than guessing.
  2. **No speculative linking**: the `repository.created` webhook MUST NOT
     link a newly-created repo to an arbitrary project in the org. A new
     repo's owning project is established by the create/clone/import flow
     that produced it (the primary `project_repos` row); a repo with no
     owning project is left unlinked for explicit import, never
     auto-attached.
  3. **Deterministic resolution**: `findRepoRow` MUST NOT return an
     arbitrary row on ambiguity. Under the unique index at most one row
     matches; as defense in depth it prefers the primary link and fails
     loud (throws) on a genuinely ambiguous match rather than silently
     picking one.

### Key Entities

- **project_artifacts**: the record of a successfully published image for
  a project commit; the deploy path's first lookup.
- **Artifact-ref convention**: the deterministic string form binding repo
  identity + commit SHA + variant to a registry location; the fallback
  when no record exists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newly created `public`-profile project has a pullable
  image for its scaffolded commit within 15 minutes of creation, with no
  human action in the new repo.
- **SC-002**: Opening a PR on a seeded repo yields a `pr-{n}` tag whose
  digest matches the head sha tag, and the preview-deploy dispatch for
  that PR no longer references a nonexistent image (the 137-era
  ImagePullBackOff class disappears for seeded repos).
- **SC-003**: Zero inline registry-string construction outside
  `artifacts.ts` in statecraft (`grep -rn "ghcr.io/" api/ | grep -v
  artifacts` returns only tests/fixtures).
- **SC-004**: For any (project, sha, variant) with a green `oap-build`
  run, `project_artifacts` resolves the ref without a registry round trip.

## Out of scope

- Pulling private images inside the cluster (`imagePullSecrets`): spec 214.
- The deploy trigger and its UI: spec 215.
- Build hardening of the tenant repo's own CI gates (spec-lint, coupling,
  certificate verify): spec 209.
- Non-GHCR registries (ACR et al.): the convention isolates registry
  choice inside `artifacts.ts`; a future spec may parameterise it
  per-org.
- The factory pipeline's automated terminal deploy stage: remains the
  unowned deferral of spec 112 §11; spec 215 is its manual precursor.

## Dependencies and sequencing

Independent of spec 214; both are prerequisites of spec 215. The
`encore-cd.yml.example` in template remains untouched upstream;
the seeded `oap-build.yml` is generated by statecraft at create time so
its contract is owned here, not in the template lineage. Once spec 214's
supersession retires `cd-tenant-hello.yml`, the seeded workflow is the
only tenant build path; its shape and the spec 214 FR-010 reference
fixture build MUST stay aligned (both invoke `encore build docker`
against the same template lineage).

## Clarifications

1. **Build context for dual variants**: whether `encore build docker` is
   invoked from the variant root (`public/`, `internal/`) or with a path
   flag MUST be validated against the actual dual-profile tree layout at
   plan time (the variant copies are full trees per the adapter manifest's
   `dual_stack.variants` model).
2. **Workflow token scope**: confirm `GITHUB_TOKEN` with `packages:
   write` suffices for first-publish package creation under the org
   (ACME-OLD style orgs may restrict package creation; if so, fall back
   to an org-level PAT secret seeded as a repo secret, which widens the
   blast radius and must be called out at review).
