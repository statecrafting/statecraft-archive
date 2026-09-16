# Implementation Plan: 213-tenant-repo-image-build

> Companion to `spec.md`. Resolves the spec's plan-time Clarifications
> against the actual code reality (2026-06-15 survey) and records the
> file-by-file work and the verification split. First of the three
> deploy-path specs; independent of 214, prerequisite of 215.

## Clarification resolutions

### Clarification 1: build context for dual variants (RESOLVED)

The dual-profile tree is produced by template's
`scripts/setup-dual-app.ts`, which copies the **full** template base into
`<root>/public/` and `<root>/internal/` (each its own `apps/api`,
`apps/api/Dockerfile.base`, `package.json` workspaces, and `.github/`).
So FR-004's model holds exactly: a dual tree has top-level `public/` and
`internal/` directories, each containing `apps/api`. The seeded workflow
detects the layout at runtime and builds **from the variant root**
(working-directory `public` / `internal`); single-variant trees build
from the repo root (working-directory `.`). The `--base
apps/api/Dockerfile.base` path is variant-root-relative and resolves in
both shapes.

### Clarification 2: workflow token scope (RESOLVED, default + documented fallback)

The seeded workflow authenticates to GHCR with the job's `GITHUB_TOKEN`
and `permissions: packages: write`. This suffices for first-publish of a
package owned by the same repo's org in the common case. Org-restricted
package creation (ACME-OLD style) is handled by a documented fallback:
an org-level PAT seeded as a repo secret (`GHCR_PUBLISH_TOKEN`); the
workflow prefers it when present, else falls back to `GITHUB_TOKEN`. The
PAT fallback widens blast radius and is called out at review (spec 213
Clarification 2; spec 202 blast-radius posture).

### Build shape (DECIDED 2026-06-15: full canonical build)

The seeded `oap-build.yml` mirrors template's *real* build
sequence rather than the bare `encore build docker --base` of FR-001's
prose, because the bare form bundles only the committed placeholder SPA
(`apps/api/web/build/index.html`, a spec 053 placeholder) and is not a
genuinely deployable image. The sequence, inlined and parameterized by
variant working-directory:

1. `npm ci` (root workspaces)
2. `npm run build:packages && npm run build:web` (writes
   `apps/api/web/build`)
3. install Encore CLI
4. `npm ci` in `apps/api`
5. `docker build -f apps/api/Dockerfile.base -t <base> apps/api`
6. `encore build docker --config apps/api/infra.config.json --base
   <base> ghcr.io/<org>/<repo>:sha-<short>[-variant]`
7. tag + push (and `pr-<n>[-variant]` on `pull_request`)

It is inlined (not `uses: ./.github/actions/encore-build`) because for
dual trees the composite actions live under `public/.github/` and
`internal/.github/`, and `uses:` cannot interpolate the matrix variant
into a local-action path. Alignment with the template lineage is pinned
by spec 214's FR-010 reference fixture, which builds the same way against
the same `templateCache.ts`-pinned template version (spec 213
§Dependencies, the lockstep requirement).

## Image-ref convention (FR-002, normative, locked in `artifacts.ts`)

- single-variant: `ghcr.io/{githubOrg}/{repoName}:sha-{shortSha}`
- dual: `ghcr.io/{githubOrg}/{repoName}:sha-{shortSha}-{variant}`,
  `variant ∈ {public, internal}`
- `shortSha` is the 12-char commit SHA prefix
- PR alias: `pr-{number}` (+ `-{variant}` for dual)
- no `latest` tag is published
- `project_artifacts.variant` stores `root` for single-variant trees

## File-by-file work

| File | Edge | Change |
|------|------|--------|
| `api/deploy/artifacts.ts` | establishes (new) | `deriveArtifactRef`, `derivePreviewRef`, `artifactExists` |
| `api/deploy/artifacts.test.ts` | establishes (new) | vitest suite over the pure derivations + ref-parse |
| `api/db/schema.ts` | extends (existing) | `projectArtifacts` pgTable |
| `api/db/migrations/48_project_artifacts.up.sql` / `.down.sql` | new | table + unique index |
| `api/github/webhook.ts` | extends (existing) | `workflow_run.completed` upsert; replace inline `:pr-N` ref with `derivePreviewRef` |
| `api/github/repoInit.ts` | extends (existing) | `OAP_BUILD_WORKFLOW_YAML` + `createOapBuildWorkflow`; idempotent retrofit |
| project-create caller | n/a | seed `oap-build.yml` alongside `oap-verify.yml` |
| FR-008 admin endpoint | n/a | authenticated server action to retrofit `oap-build.yml` into an existing repo |
| `crates/featuregraph/tests/golden/features_graph.json` | extends (existing) | regenerated golden row |

## Verification split

**Locally verifiable (this PR):**

- `artifacts.test.ts`: ref convention, variant suffixing, short-sha
  truncation, pr-alias form (pure, no infra).
- statecraft `tsc` type-check; vitest green.
- migration applies under `encore test` (table + unique constraint).
- `oap-build.yml` is valid YAML and passes the workflow-ref SHA-pinning
  lint (spec 158) for any third-party `uses:`.
- spec-code coupling gate, spec-lint, featuregraph golden, codebase index
  staleness (`make pr-prep`).

**Deploy-time only (NOT verifiable here; tracked as open):**

- SC-001 pullable image within 15 min of project creation.
- SC-002 `pr-{n}` digest matches the head sha tag; preview-deploy no
  longer ImagePullBackOffs.
- SC-004 `project_artifacts` resolves the ref without a registry round
  trip after a green `oap-build` run.
- FR-007 live GHCR manifest HEAD against a private package.

These ride the first real tenant deploy (the 213/214/215 chain's
integration test), not this PR's CI.

## Out of this PR (per spec §Out of scope)

`imagePullSecrets` (214), the deploy trigger UI (215), tenant-repo CI
hardening (209), non-GHCR registries, the factory terminal deploy stage
(112 §11 deferral).
