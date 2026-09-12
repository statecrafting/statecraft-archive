---
id: "004-marketing-surfaces"
title: "Rich marketing surfaces: products, whitepaper, get-started, sign-in"
status: approved
created: "2026-07-16"
implementation: complete
depends_on:
  - "001-site-scaffold"
  - "002-launch-content"
  - "003-product-family-registry"
establishes:
  - "app/routes/products.tsx"
  - "app/routes/papers.tsx"
  - "app/routes/papers.$slug.tsx"
  - "app/routes/get-started.tsx"
  - "app/components/paper-reader.tsx"
  - "app/components/architecture-explorer.tsx"
  - "app/components/sign-in-link.tsx"
  - "app/components/icons.tsx"
  - "app/lib/whitepaper.ts"
  - "app/lib/papers.ts"
  - "app/lib/products.ts"
  - "app/lib/explorer-diagrams.ts"
  - "app/lib/get-started.ts"
extends:
  - spec: "001-site-scaffold"
    paths:
      - "app/routes.ts"
      - "react-router.config.ts"
      - "app/components/site-chrome.tsx"
summary: >
  Restores the richer marketing experience the OAP-era statecraft web app
  carried, ported onto the static apex: a products/architecture page, a
  papers index with a full whitepaper reader (sticky TOC, reading-progress,
  scroll-spy, inline references) and an interactive clickable-SVG
  architecture explorer, and a get-started walkthrough. It expands the site
  chrome (Products, Papers, Get Started in the nav) and adds a sign-in link
  that hands off to the control plane's login initiator at
  app.statecraft.ing/api/v1/auth/login. All content is re-authored to be truthful
  and checkable against the current public repos (no fabricated hashes,
  spec counts, signatures, or dead subsystems): the OAP name becomes
  Statecraft, and factory-encore / template-encore become enrahitu. The
  site stays fully static and prerendered, with zero runtime off-origin
  requests; sign-in is a plain outbound link, not an auth flow this site
  runs.
---

# 004: Rich marketing surfaces

## 1. Purpose

The launch site (specs 001-002) is honest but sparse: an index, a
registry viewer, and three docs stubs. The OAP-era statecraft web app
carried a much richer public experience: a products/architecture page, a
governed whitepaper with an in-page reader and interactive diagrams, and a
self-host walkthrough. That work is worth harvesting. This spec brings the
rich surfaces back onto the static apex, on the same React Router v7 stack,
under the site's existing honesty rule.

Two constraints shape the port, and neither is negotiable:

- **Every published claim stays checkable** (spec 002 section 1; CLAUDE.md).
  The harvested content is dense with OAP-era claims that are not checkable
  against any current public repo: a specific corpus spec count, fabricated
  SHA-256 certificate and signature hashes, timestamped audit trails, an
  OWASP ASI "full coverage" compliance table, and subsystems that no longer
  exist (deployd-api, axiomregent, OPC Desktop, oap-bootstrap). None of that
  is ported. The narrative is re-authored around the real product family
  (spec 003): spec-spine, enrahitu, statecraft, statecraft-cli, tenant-emit,
  tenant-tail, action-gate, attest-ledger, canonical-keysort-json,
  trust-window, and the live Rauthy identity service.
- **The rename is total.** "Open Agentic Platform" / "OAP" becomes
  "Statecraft"; `factory-encore` and `template-encore` become `enrahitu`
  (the template chassis that replaced both). No harvested string may leave
  a dead product name in place.

## 2. Territory

- **Owns** the four new routes (`products`, `papers`, `papers/:slug`,
  `get-started`), the reader and explorer components, the sign-in link, a
  small inline-icon module, and the five content modules (`whitepaper.ts`,
  `papers.ts`, `products.ts`, `explorer-diagrams.ts`, `get-started.ts`).
- **Extends** spec 001 on three wiring surfaces without disturbing them:
  the route table (`app/routes.ts`), the prerender list
  (`react-router.config.ts`), and the site chrome
  (`app/components/site-chrome.tsx`, for the added nav entries and the
  sign-in link). The base layout, footer, theme, and palette are unchanged.
- **Consumes, does not own**: the product roster
  (`app/lib/product-family.ts`, spec 003), the baked registry
  (`app/lib/registry*.ts`, spec 001), and the index/docs pages (spec 002).
- **Does not change** the registry bake set (spec 001 section 3) or add any
  runtime request. The whitepaper, products, and get-started content is
  authored TypeScript, consistent with spec 002's "typed content, no
  markdown/MDX toolchain" decision.

## 3. Behavior

### 3.1 Chrome and navigation

The header nav gains Products, Papers, and Get Started alongside the
existing Overview, Registry, and Docs. A "Sign in" affordance appears in
the header (and the mobile drawer), rendered by `sign-in-link.tsx`.

### 3.2 Sign-in

Sign-in is an outbound link to `https://app.statecraft.ing/api/v1/auth/login`,
the control plane's driver-agnostic login initiator: it 302s to the active
auth driver's OIDC kickoff (rauthy today), so this link survives a driver
change without an edit here. This site runs no auth flow, sets no cookie, and
reads no session; it hands off to the control plane, which owns identity
(Rauthy is the live OIDC signer). The link is a plain absolute URL so it works
identically in prerendered HTML with no client JavaScript. If the control
plane is not deployed at that host yet, the link simply leads to the plane's
own status; this site makes no claim that sign-in succeeds.

**Corrected 2026-07-21.** This first pointed at `https://app.statecraft.ing/auth/rauthy`,
described as "the same `/auth/rauthy` OIDC kickoff path the app used before the
apex cutover". That was wrong on the live control plane: `/auth/rauthy` is the
rauthy proxy passthrough, not a login route, and a top-level navigation to it
is refused by rauthy's own CSRF guard with a `BadRequest` /
"cross-origin request forbidden for this resource". The login initiator is
`/api/v1/auth/login`, which is what the app's own sign-in button uses and which
permits cross-site navigation. Verified live: the old path returns the CSRF
refusal, the new one 302s through to `/oidc/authorize`.

### 3.3 Products / architecture (`/products`)

An ecosystem page: the architecture stated as layers (governance toolchain,
substrate, control plane, interface, and the verification primitives), a
governed delivery-flow diagram whose stages are the real verbs
(Specify, Stamp, Operate, Verify), and a catalog of the family repos. The
catalog is derived from `product-family.ts` (spec 003), so it cannot drift
from the roster. Each entry shows its role and SPDX license and links to
GitHub; entries whose repos are in the registry bake set also link to their
spec corpus in `/registry`. No per-repo status badge or spec count is shown
unless it is derived from the baked registry.

### 3.4 Papers and the whitepaper reader (`/papers`, `/papers/:slug`)

The papers index features one flagship whitepaper, "The Statecraft
Ecosystem", re-authored from the harvested paper to describe the real
family. The reader (`paper-reader.tsx`) renders it with a sticky table of
contents, a reading-progress bar, scroll-spy section highlighting, inline
`**bold**` and `[ref:N]` footnote markers, a references list, and inline
interactive architecture diagrams (`architecture-explorer.tsx`: a
clickable inline SVG with per-node descriptions, no animation dependency).
The whitepaper's sections map to real, checkable subjects: the spec spine
(demonstrably governs this very site), governed agent execution via the MCP
face (marked forward-looking where not yet shipped), the tamper-evident
governance record (attest-ledger, tenant-emit, tenant-tail), and identity
via Rauthy. Fabricated certificates, signatures, corpus counts, audit
trails, and the OWASP compliance table are omitted; where the reader shows
a certificate or record shape, it is labelled as an illustrative schema,
not a real signed artifact.

### 3.5 Get started (`/get-started`)

An honest getting-started walkthrough: what a reader can actually run
today (spec-spine governs any corpus; enrahitu is a runnable single-
container substrate) and what is forward-looking (the control plane and
factory are milestones M3-M5, per the index status ladder). Each step
links to the governing spec or the real repo. The OAP-era eight-phase
Hetzner/K3s `oap-bootstrap` choreography is not ported; nothing here claims
a self-host path that does not exist.

### 3.6 Static and dependency posture

Icons are inline SVG (`icons.tsx`), consistent with the existing chrome and
the zero-off-origin-request rule; no icon-font or component library is
added. Every new route is prerendered: `react-router.config.ts` enumerates
`/products`, `/get-started`, `/papers`, and one `/papers/:slug` path per
paper from `papers.ts`. Dark mode and the governance-ledger palette apply
unchanged.

## 4. Acceptance

- `npm run build` prerenders `/products`, `/papers`, every `/papers/:slug`,
  and `/get-started` into static HTML; `npm run typecheck` is clean.
- The header and mobile nav expose Products, Papers, Get Started, and a
  Sign in link; the Sign in link resolves to
  `https://app.statecraft.ing/api/v1/auth/login`.
- The whitepaper reader renders the flagship paper with a working TOC,
  reading-progress, references, and at least one interactive architecture
  diagram.
- No harvested surface contains the strings "Open Agentic Platform", "OAP",
  "factory-encore", "template-encore", "oap-bootstrap", "deployd-api", or a
  fabricated hash / signature / spec-count presented as fact. Every product
  and paper claim links to a public repo, a baked spec, or is marked
  forward-looking.
- The built output makes zero runtime requests to any non-same-origin host
  (sign-in is a static outbound link, followed only on user click).
- Spine gates green: `spec-spine compile`, `index`, `lint --fail-on-warn`,
  `index check`; `spec-spine couple --base origin/main` passes with spec 004
  as the owner of the new files and the extended wiring, with no
  `Spec-Drift-Waiver:` needed.

## 5. Out of scope

- The control plane itself, its auth callback, and any authenticated route:
  this site only links out to sign-in.
- The five OAP-era "focused" ecosystem papers, whose value was their
  fabricated per-paper governance certificates and audit trails; only the
  re-authored flagship whitepaper ships.
- New registry corpora (spec 001 section 3 bake set is unchanged) and any
  runtime data fetch.
- Blog, search, versioned docs, PDF generation.

## 6. Status (2026-07-16): complete

Implemented and verified; section 4 holds end to end.

- **Surfaces**: `/products` (layers, a registry-derived delivery flow, the
  spec-003 repo catalog), `/papers` plus the whitepaper reader at
  `/papers/statecraft-ecosystem` (sticky TOC, reading-progress, scroll-spy,
  inline references, a positioning table, three interactive architecture
  explorers), and `/get-started` (runs-today vs on-the-ladder, every step
  linked to its governing spec). Chrome gained Products, Papers, Get Started,
  and a Sign in link to `https://app.statecraft.ing/api/v1/auth/login`.
- **Honesty**: content re-authored around the real family; no fabricated
  hash, signature, spec count, or dead subsystem in any user-facing surface.
  Maturity is rolled up from the baked registry wherever it is shown (the
  products delivery flow mirrors the home page ladder: Specify shipped,
  Stamp in progress, Operate shipped, Verify shipped), so the copy cannot
  drift from the specs. The stamp and self-host steps link to genuinely
  in-progress specs (`enrahitu/009-template-contract`,
  `statecraft/009-control-plane-deploy`).
- **Gates**: `npm run typecheck` clean; `npm run build` prerenders every new
  route; `spec-spine compile`, `index`, `lint --fail-on-warn`, `index check`
  green; `spec-spine couple --base origin/main` reports 17 paths checked, no
  drift, no waiver (this spec owns the new files and extends 001 on the
  wiring). Icons are inline SVG; the built output makes zero runtime
  off-origin requests.

Deploy is gated by human approval: main auto-deploys to the live apex, so
the change ships in PR #6 and awaits merge. Sign-in is a real hand-off once
`app.statecraft.ing` is deployed with a valid certificate; until then the
link reaches the control-plane host's own (in-progress) state.

## 7. Status note (2026-09-11): the eleventh roster repo gets its layer

Section 3.3 requires every family repo to appear in exactly one architecture
layer, and the route loader asserts it at build time against the spec-003
roster. When spec 003 added `statecrafting` as the eleventh repo, no layer
claimed it, so the assertion fired and the deploy on `main` went red on
2026-07-23 and stayed red.

`statecrafting` is placed in **Substrate**. It holds the shared native
packages (the `@statecrafting/*` napi addons) and the vendored Encore
toolchain that the chassis is built from, which is the same layer `enrahitu`
occupies and the one `enrahitu/008-vendored-encore-toolchain` consumes it in.
The layer blurb is extended to name that second half, so a layer that now
lists two repos describes both rather than only the chassis.

The catalog carries a second assertion the layer fix does not satisfy: every
roster repo needs a `PRODUCT_DETAIL` entry, and the loader throws by name when
one is absent. `statecrafting` gets one, with three claims each checkable
against the repo: the `@statecrafting/*` napi addons, the Encore build
toolchain `enrahitu` vendors, and the license shape spec 003 section 3 already
records (Apache-2.0 at the root, two packages AGPL-3.0).

No status badge, spec count, or maturity claim is added: `statecrafting` is
outside the registry bake set (spec 001 section 3), so the catalog links it to
GitHub and not to a spec corpus, exactly as section 3.3 specifies.
