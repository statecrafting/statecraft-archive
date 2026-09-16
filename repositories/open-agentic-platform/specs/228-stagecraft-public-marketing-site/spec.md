---
id: "228-statecraft-public-marketing-site"
title: "Statecraft public marketing site: governed teal/mono port of the ecosystem + whitepaper"
feature_branch: "feat/statecraft-marketing-site"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-07-07"
authors: ["open-agentic-platform"]
language: en
summary: >
  Replaces the thin bounce-to-signin marketing surface of the statecraft web
  app with a five-section public site, natively ported into the React Router 8
  SSR app from two standalone Vite sites (oap-ecosystem and oap-whitepaper).
  The nav is Overview (product landing) + Products (architecture and repo
  catalog, merged) + Papers (a multi-paper reader hosting the comprehensive
  whitepaper plus five focused papers) + Registry (Specs table, relationship
  Graph, and analytics Dashboard over one dataset, with per-spec detail) +
  Get Started (the oap-bootstrap self-host walkthrough); Sign in is unchanged
  (Rauthy OIDC). The Registry pages read a governed build-time projection of
  OAP's own compiled spec corpus: scripts/gen-spec-registry.mjs shells the
  spec-spine registry consumer binary (governed-reads compliant, per spec 103)
  and emits a lean list snapshot plus a rich per-spec detail snapshot; the
  detail blob is loaded only in a server-side loader so the client receives one
  spec at a time. The whole surface adopts a shared teal/mono "governance
  ledger" design system (OKLCH tokens, JetBrains Mono, class-based dark mode
  with a no-flash init) applied without any shadcn dependency. All Sign in
  affordances route straight to the Rauthy flow; all Get started affordances
  route to the self-host guide.
code_aliases: ["STATECRAFT_MARKETING_SITE", "SPEC_REGISTRY_PROJECTION"]
depends_on:
  - "160-factory-adapter-statecraft-relocation"  # broadly establishes the statecraft directory this surface extends
  - "163-statecraft-requirements-view"  # establishes the web app/routes surface + the authenticated spec-registry API; this spec adds the public marketing routes alongside it
  - "103-init-protocol-governed-reads"  # the governed-reads contract the registry projection honors (reads through the spec-spine consumer binary, never raw .derived shards)
  - "217-spec-spine-engine-swap-collapse"  # the published spec-spine CLI whose `registry list --json` consumer the projection generator shells
establishes:
  # New marketing chrome + client-only islands.
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/marketing-chrome.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/theme-toggle.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/sign-in-link.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/client-only.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/paper-reader.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/architecture-explorer.tsx }
  # Paper content + registry projection data access.
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/papers.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/whitepaper-content.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/ecosystem-papers.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/explorer-diagrams.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-details.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/domain-colors.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry.generated.json }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-details.generated.json }
  # Public marketing routes.
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/marketing.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/products.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/papers.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/papers.$slug.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/registry.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/registry._index.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/registry.graph.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/registry.dashboard.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/registry.$specId.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/get-started.tsx }
  # Governed registry-projection generator.
  - unit: { kind: file, path: platform/services/statecraft/web/scripts/gen-spec-registry.mjs }
extends:
  # The public routes register in the shared route config alongside spec 163's
  # authenticated routes; the marketing surface additively extends the web
  # shell (routing, landing page, global CSS tokens, root document) that spec
  # 160 broadly established over the statecraft tree.
  - spec: "163-statecraft-requirements-view"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes.ts }
  - spec: "160-factory-adapter-statecraft-relocation"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/_index.tsx }
  - spec: "160-factory-adapter-statecraft-relocation"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/app.css }
  - spec: "160-factory-adapter-statecraft-relocation"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/root.tsx }
  - spec: "160-factory-adapter-statecraft-relocation"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/package.json }
  - spec: "160-factory-adapter-statecraft-relocation"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/package-lock.json }
  # A new spec adds a node to the featuregraph golden (same precedent as specs
  # 214, 222, 223, 224, 225, 226, 227): claimed additively against spec 034.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
---

# 228. Statecraft public marketing site

## 1. Problem

The statecraft web app (`platform/services/statecraft/web`, React Router 8,
SSR) shipped a thin marketing surface: a single `_index.tsx` landing page whose
"Get started" and "Sign in" both bounced into the authenticated app. There was
no public place to explain what OAP is, browse the ecosystem, read the
whitepapers, explore the spec corpus, or learn how to self-host. Two rich
standalone sites existed as prototypes: `oap-ecosystem` (a multi-tab
governance microsite) and `oap-whitepaper` (a single long-form paper reader),
both Vite SPAs using `wouter` + shadcn/ui. They could not simply be mounted:
they use a different framework, router, and component library than the target
app, and their spec data was a hand-frozen snapshot that would drift from the
live corpus.

## 2. Decision

Port the two sites natively into the React Router 8 SSR app as a public
marketing surface, sharing one design system, one router, and one auth
boundary. No shadcn is introduced; every component is plain Tailwind v4 JSX to
match the host app's house style. The collapsed nav is five content sections
plus the unchanged sign-in:

- **Overview** (`/`) : the product landing. Keeps the conversion hero and CTAs,
  and adds the ecosystem's Core Principles, seven-repo Ecosystem grid, and
  Trust Fabric band.
- **Products** (`/products`) : the ecosystem's Architecture and Products pages
  merged: an architecture properties table and a governed-delivery-flow diagram
  introduce a repo catalog (status/license badges, install commands, links).
- **Papers** (`/papers`, `/papers/:slug`) : one reader (adapted from the
  whitepaper's TOC + scroll-spy + interactive SVG `ArchitectureExplorer` shell)
  hosting the comprehensive whitepaper as the featured read plus five focused
  papers; focused papers keep their governance chrome (binding panel, audit
  trail, certificate).
- **Registry** (`/registry`, `/registry/graph`, `/registry/dashboard`,
  `/registry/:specId`) : the ecosystem's Specs table, relationship Graph, and
  analytics Dashboard unified under one tab over a single dataset, plus a rich
  per-spec detail page.
- **Get Started** (`/get-started`) : the oap-bootstrap eight-phase self-host
  walkthrough plus the spec lifecycle state machine.

`Feed`, `Contributors`, `SpecCompare`, `SpecHistory`, and the Cmd+K command
palette are intentionally not ported (see Out of Scope).

## 3. Governed spec-registry projection

The Registry pages are wired to the live registry, not a hand-frozen snapshot.
Because statecraft deploys separately from this repo, the projection runs at
build time: `scripts/gen-spec-registry.mjs` shells the `spec-spine registry
list --json` consumer binary (never the raw `.derived` shards, per spec 103)
and emits two committed snapshots, refreshed per deploy so they never silently
drift from the compiled corpus:

- `app/lib/spec-registry.generated.json` : a lean list (id, title, status,
  implementation, kind, domain, created, tags, summary) plus the relationship
  edge set, consumed by the table, graph, and dashboard.
- `app/lib/spec-details.generated.json` : a rich per-spec record (frontmatter,
  all typed relationships, section-heading outline, direct and transitive
  dependents, a real lifecycle timeline derived from the created / amended /
  closed / superseded dates, and a spec.md body excerpt read from the authored
  source). It is imported only inside the `/registry/:specId` route loader, so
  React Router keeps it server-side and the client receives a single spec's
  record per navigation rather than the whole blob.

## 4. Design system

A shared teal/mono "governance ledger" identity is added to
`web/app/app.css`: OKLCH color tokens (cyan accent at hue 195) for a light and
dark theme, JetBrains Mono for headings and chips, and utilities (glow,
pulse-dot, spec-chip, blueprint grid). Dark mode is switched from
prefers-color-scheme to a class-based `.dark` strategy, with a no-flash init
script in `root.tsx` that applies the class from a stored preference, falling
back to the OS preference so the existing authenticated app keeps its current
OS-driven behavior. A shared `SiteHeader`/`SiteFooter` (in
`marketing-chrome.tsx`) supplies consistent nav and a theme toggle via a
pathless `marketing.tsx` layout route.

## 5. Sign in and Get started routing

Every "Sign in" affordance routes straight to the Rauthy OIDC flow
(`/auth/rauthy`, root-relative so it resolves against the current host; forced
to https on any non-local host), skipping the `/signin` interstitial. Every
"Get started" affordance routes to `/get-started`. The `/signin`, `/signup`,
`auth.*`, `app.*`, and `admin.*` routes and their `requireUser`/`requireAdmin`
gates are unchanged.

## 6. Relationships

- **extends 163** (`statecraft-requirements-view`) on `app/routes.ts`: the
  public routes register alongside the authenticated route groups.
- **extends 160** (`factory-adapter-statecraft-relocation`) on the shared web
  shell files (`_index.tsx`, `app.css`, `root.tsx`, `package.json`,
  `package-lock.json`) that 160 broadly established over the statecraft tree.
- **extends 034** on the featuregraph golden node, the standard new-spec
  precedent.
- **depends_on 103** for the governed-reads contract and **217** for the
  spec-spine CLI consumer the projection shells.

## 7. Acceptance criteria

- AC-1: The five public routes render server-side and hydrate without error;
  the existing `/signin` and authenticated app are visually unaffected by the
  class-based dark migration.
- AC-2: The Registry table, graph, dashboard, and per-spec detail render from
  the governed projection; the detail route's client chunk does not embed the
  full details blob (it is loaded in the loader).
- AC-3: `spec-spine registry list --json` is the only source of the projection;
  no ad-hoc parsing of `.derived/**` (spec 103).
- AC-4: All "Sign in" links initiate the Rauthy flow; all "Get started" links
  target `/get-started`.
- AC-5: `react-router build` (client + SSR) is green and the new files
  typecheck clean.

## 8. Out of scope

- `SpecCompare` and `SpecHistory` (the ecosystem's revision-history views used
  procedurally-fabricated data; not reproduced).
- The Cmd+K command palette, `Feed`, and `Contributors` (footer-only tier-2 in
  the ecosystem).
- A dedicated public root-static asset route (the paper reader uses
  `window.print()`, so no PDF/OG file serving is required yet).
