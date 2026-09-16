---
id: "016-docs-website"
title: "Documentation website: the Docusaurus docs site and its GitHub Pages publish workflow"
status: approved
created: "2026-06-25"
owner: bart
kind: feature
domain: ci-cd
risk: low
implementation: complete
depends_on:
  - "011-workflow-pins-lint"
  - "012-enterprise-actions-governance"
code_aliases: ["DOCS_WEBSITE"]
summary: >
  The standalone Docusaurus v3 documentation site under `website/` and the
  `deploy-docs.yml` workflow that builds it and publishes to GitHub Pages.
  The site is a shipped deliverable (authored docs about the architecture,
  security model, governance, and developer workflow), not part of the
  runnable app or the npm workspace. The publish workflow runs on pushes to
  `main` that touch the site, is inert until a repo admin enables Pages, and
  satisfies the SHA-pin (spec 011) and allow-listed-publisher (spec 012)
  constraints like every other workflow.
establishes:
  - "website/"
  - ".github/workflows/deploy-docs.yml"
---

# 016 - Documentation website

## 1. Purpose

The template ships a browsable documentation website, distinct from the
in-repo `docs/` tree. It is a Docusaurus v3 site under `website/` that
renders authored guides, concept pages, reference material, and the
governance story, and a CI workflow that builds and publishes it to GitHub
Pages. This spec owns both halves so the site and its publish pipeline are
traceable to a spec rather than living as orphan artifacts.

## 2. Territory

This spec owns two trees:

- **`website/`**: the Docusaurus project, namely configuration
  (`docusaurus.config.ts`, `sidebars.ts`, `tsconfig.json`), the authored
  `docs/` pages, the landing page under `src/`, static assets, and the
  site's own `package.json`/`package-lock.json`. The site is **outside the
  npm workspace** (`spec-spine.toml`'s `npm_workspaces`/`standalone_npm_packages`
  list the app, not the site): it installs and builds on its own via
  `npm ci` in the workflow, so it does not participate in the root build or
  test loop.
- **`.github/workflows/deploy-docs.yml`**: the GitHub Pages build-and-deploy
  workflow.

Why `kind: feature` in the `ci-cd` domain: the website is a shipped
deliverable (documentation a reader consumes), which is feature-shaped
rather than a governance gate; its only governed *code* is a CI/CD publish
workflow, so it sits in the `ci-cd` domain alongside the other
workflow-owning specs (007–013).

This spec **establishes** `deploy-docs.yml`. Spec 012
(`012-enterprise-actions-governance`) separately **constrains** it (and
every workflow) to allow-listed publishers; spec 011
(`011-workflow-pins-lint`) requires its external refs to be SHA-pinned.
Ownership (this spec) and the cross-cutting constraints (011, 012) compose:
all must hold together.

## 3. Behavior

### FR-01: Standalone Docusaurus site under `website/`

The documentation site MUST live under `website/` as a self-contained
Docusaurus v3 project with its own `package.json` and lockfile, built with
`npm run build`. It MUST NOT be wired into the root npm workspace or the
root build/test scripts: the workflow installs and builds it in isolation.

### FR-02: GitHub Pages publish workflow

`deploy-docs.yml` MUST build the site and deploy it to GitHub Pages. It:

- triggers on `push` to `main` limited to `website/**` and the workflow file
  itself, plus manual `workflow_dispatch`
- grants only `contents: read`, `pages: write`, `id-token: write`
- serialises deploys through a `pages` concurrency group
- builds in the `build` job (`npm ci` then `npm run build`, uploading
  `website/build` as the Pages artifact) and publishes in a dependent
  `deploy` job via the `github-pages` environment

### FR-03: Constraint conformance

Every external `uses:` ref in `deploy-docs.yml` MUST be SHA-pinned to a full
40-hex commit SHA (spec 011) and MUST resolve to an allow-listed publisher
(spec 012). The workflow uses only first-party `actions/*` publishers
(`checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`,
`deploy-pages`).

### FR-04: Inert until Pages is enabled

The workflow is **inert** until a repo admin enables GitHub Pages with the
source set to **GitHub Actions** (Settings → Pages). Enabling Pages is a
repo-admin action outside any workflow file, consistent with the
branch-protection and merge-queue carve-outs in specs 009 and 012.

Inertness is realised by a `preflight` job that reads the Pages API
(`GET /repos/{owner}/{repo}/pages`) with the workflow's `github.token` and
branches on the HTTP status: **200** reports `enabled=true`; **404** (Pages not
configured) reports `enabled=false` so the `build` job is skipped by its
job-level `if`, and `deploy` (which `needs: build` under the default `success()`
guard) is skipped in turn, so the run concludes successfully instead of failing
at `configure-pages`; any other status, or a transport failure, fails the
preflight loudly rather than masquerading as "Pages off" and silently swallowing
a publish. Because a custom job-level `if` overrides the implicit `success()`
needs-guard, `build` checks `needs.preflight.result == 'success'` explicitly and
`deploy` carries no custom `if` (so a failed `build` never publishes). This
keeps a freshly produced repo green on its first push; once an admin enables
Pages the next qualifying run builds and publishes. The workflow never enables
Pages itself: enablement stays a repo-admin action (see §5).

## 4. Acceptance criteria

**AC-1** The site builds in isolation:
```bash
cd website && npm ci && npm run build   # exit 0
```

**AC-2** Every external ref in the workflow is SHA-pinned:
```bash
bash tools/lint/workflow-pins.sh .github/workflows .github/actions   # exit 0
```

**AC-3**
```bash
npx spec-spine registry show 016-docs-website
```
exits 0 and lists both established paths.

## 5. Out of scope

- **Enabling GitHub Pages**: a repo-admin action outside any workflow file
  (see FR-04).
- **The in-repo `docs/` tree**: `docs/` is separate prose documentation in
  the coupling bypass floor; this spec governs the published `website/` site,
  not `docs/`.
- **Adding publishers to the org allow-list**: governed by spec 012's
  out-of-scope note; the org controls the allow-list.
