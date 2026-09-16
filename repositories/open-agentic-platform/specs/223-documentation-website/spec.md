---
id: "223-documentation-website"
slug: documentation-website
title: "Documentation website (Docusaurus v3) on GitHub Pages"
status: approved
implementation: complete
owner: bart
created: "2026-06-25"
kind: product
domain: tooling
risk: low
depends_on:
  - "118-workflow-spec-traceability"  # workflow-spec-traceability (the # Spec: header convention this deploy workflow honours)
code_aliases: ["DOCUMENTATION_WEBSITE"]
establishes:
  - unit: { kind: directory, path: website }
  - unit: { kind: file, path: .github/workflows/deploy-docs.yml }
extends:
  # A new spec adds a row to the featuregraph golden, regenerated from the
  # registry shards (same precedent as specs 222, 208, 196, 194, 193, 187, 183).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  The repository ships a public documentation website built with
  Docusaurus v3 under website/, and a GitHub Pages deploy workflow
  (.github/workflows/deploy-docs.yml) that builds and publishes it on
  every push to main touching website/**. The site is authored content
  (getting-started, concepts, architecture, the spec-spine workflow,
  platform, OPC desktop, security, and reference sections) rendered as a
  static site; it is a reader-facing surface, not a source of machine
  truth. This spec gives that website and its deploy pipeline an owning
  spec so both trace under the spec-code coupling gate (127) and the
  workflow-to-spec traceability convention (118), closing the gap where a
  62-file feature and a CI workflow had shipped with no governing spec.
---

# Feature Specification: Documentation website

## Purpose

The platform is documented across the root `README.md`,
`docs/ARCHITECTURE.md`, `docs/DEVELOPERS.md`, and 200-plus specs under
`specs/`. None of that is a reader-friendly entry point for someone
arriving cold: the specs are the authoritative design record, dense and
cross-referential by design, and the markdown docs assume a clone in
hand. This spec establishes a curated, navigable documentation website
that sits in front of that corpus.

The site is built with **Docusaurus v3** under `website/`. Its content
is organised into the sections that mirror how a newcomer learns the
system: getting-started, the governed model and core concepts, the
three-layer architecture, the spec-spine authoring workflow, the
platform control plane, the OPC desktop cockpit, security, and a
reference index. A landing page surfaces the load-bearing ideas (spec
spine, coupling gate, OPC cockpit, governance certificate, platform
control plane, two-phase factory engine).

Crucially, the website is a **projection for human readers, not a source
of truth**. The spec spine remains the authoritative design record and
the compiler-emitted registries remain machine truth (constitution
Principle II). The site reads from neither at build time; it is authored
markdown compiled to a static bundle. Nothing downstream consumes it.

## Functional requirements

### FR-001: Authored documentation under `website/`

The repository MUST carry a Docusaurus v3 project under `website/`
containing the authored documentation tree (`website/docs/**`), the site
configuration (`website/docusaurus.config.ts`, `website/sidebars.ts`),
the landing page (`website/src/`), and static assets
(`website/static/**`). This directory is owned by this spec.

### FR-002: GitHub Pages deploy workflow

`.github/workflows/deploy-docs.yml` MUST build the site and publish it to
GitHub Pages. It runs on push to `main` filtered to `website/**` and the
workflow file itself, plus `workflow_dispatch`. It uses the GitHub Pages
deploy model (`configure-pages`, `upload-pages-artifact`, `deploy-pages`)
with the `contents: read` / `pages: write` / `id-token: write`
permission set and a `pages` concurrency group. This workflow is owned by
this spec.

### FR-003: SHA-pinned action references

Every external Action reference in `deploy-docs.yml` MUST be pinned to a
full 40-hex commit SHA with a trailing version comment, satisfying the
workflow-ref SHA-pinning lint (spec 158). No tag-only or branch refs.

### FR-004: Workflow-to-spec traceability header

`deploy-docs.yml` MUST carry a `# Spec: 223-documentation-website` header
line within its first ten lines, per the convention spec 118 owns, so the
workflow traces to this spec in the codebase index Layer 5 view.

### FR-005: Reader-facing, not machine truth

The website MUST remain a projection for human readers. It MUST NOT be
read by any orchestrated workflow, gate, or compiler as an input, and it
carries no authority over spec or registry content. The authoritative
record stays the spec spine and the compiler-emitted registries.

## Acceptance criteria

- **AC-1.** `website/` contains a buildable Docusaurus v3 project:
  `npm ci && npm run build` in `website/` produces a static bundle.
  (FR-001)
- **AC-2.** `.github/workflows/deploy-docs.yml` exists, triggers on push
  to `main` under `website/**`, and deploys to GitHub Pages with the
  Pages permission set and concurrency group. (FR-002)
- **AC-3.** The `supply-chain / workflow-pins` lint passes on
  `deploy-docs.yml`: all five Action refs are SHA-pinned. (FR-003)
- **AC-4.** `deploy-docs.yml` carries a `# Spec: 223-documentation-website`
  header within its first ten lines, and the codebase index surfaces the
  workflow-to-spec mapping. (FR-004)
- **AC-5.** The spec-code coupling gate (127) is green on this PR: the
  changed paths `website/**` and `.github/workflows/deploy-docs.yml` trace
  to this spec, which is authored in the same PR. (FR-001, FR-002)
- **AC-6.** `spec-lint`, the registry by-spec shard freshness gate (222),
  the featuregraph golden, and the codebase-index staleness check are all
  green with spec 223 and its derived artifacts committed. (cross-cutting)

## Out of scope

- **Versioned docs / i18n.** The site ships a single current version with
  no Docusaurus versioning or translation. A later spec may add them.
- **Auto-generated reference from the registries.** The reference section
  is authored prose, not generated from `.derived/**`. Wiring the site to
  render registry or codebase-index data at build time is deliberately
  deferred; it would make the site a consumer of machine truth and is a
  separate design question (governed-artifact-reads discipline).
- **Custom domain and analytics.** The site deploys to the default
  GitHub Pages URL; custom-domain and analytics configuration are out of
  scope here.

## Dependencies and sequencing

- **118** (`workflow-spec-traceability`) owns the `# Spec:` header
  convention this workflow honours (FR-004).
- **158** (`workflow-ref-sha-pinning-lint`) is the contract that requires
  the SHA-pinned Action refs (FR-003).
- **127** (`spec-code-coupling-gate`) is the gate this spec satisfies by
  establishing authority over the website directory and the deploy
  workflow.

No sequencing constraint: the spec, its registry shard, the regenerated
featuregraph golden row, the codebase index, the workflow header, and the
authored site land together in one PR, and the gates validate that PR.
