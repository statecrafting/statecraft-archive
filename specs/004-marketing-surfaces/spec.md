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
  - "app/lib/availability.ts"
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

### 3.3.1 The availability matrix (amendment, 2026-09-12)

`/products` opens with an availability matrix, encoded in
`app/lib/availability.ts` and rendered before the architecture layers. It
answers the question the layers cannot: what a reader can install, run and use
today. Each row is one capability, not one repository, and it is read on four
independent axes:

- **implemented**: the governing specs report `implementation: complete`. For
  a repository in the registry bake set this is rolled up from the baked shards
  and cannot be authored; for any other repository it is authored with the
  commit it was read at, and the page prints that commit.
- **released**: a versioned artifact a stranger can install exists.
- **exercised**: a run outside the repository's own tests is on a public
  record.
- **hosted**: this project operates it as a service a reader can use.

Each authored axis is `yes`, `partial`, `no`, `unknown` or `n-a`, with a note.
A positive reading must carry evidence, and evidence is either a path in the
baked registry or a public URL under the organization, crates.io, npm, or the
control plane's own host. `unknown` is never styled as a pass. A row may also
carry limits: the exceptions a reader should hold with the claim, each with its
evidence.

The loader refuses, and so fails the prerender, when a row names a repository
off the spec-003 roster, a registry spec that does not resolve, an evidence
path that does not resolve or a host outside that list, a read-at value that is
not a commit id, a positive reading with no evidence, or any axis reading `yes`
while the implemented axis reads anything but `yes`. Complete is necessary for
available, never sufficient.

The word "available" is not used as a verdict anywhere in the matrix. The
maturity chips elsewhere on the site keep reporting the corpus and nothing more:
their labels read `implemented`, `in progress` and `pending` (spec 002 section
9), and the surfaces that carry them link here for the other three axes.

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

**Amendment (2026-09-12).** The walkthrough states adoption in the order a
reader can act on it. Runnable today: govern a repository the reader already
has with spec-spine (`spec-spine init`, `compile`, `lint`, then `couple` in
their CI), which needs no account and nothing else in the family. Not yet
installable, each with its own chip: a local governed agent session
(`statecraft-cli`, implemented and not released; it stays not released, and
its step publishes no install command, until a release containing the engine
exists and has been tested on a clean machine, the job that repository's draft
130 specifies), the stamp, and self-hosting the control plane, which states
that no reproducible self-host path and no hosted plane exist. A command
appears on this page only once it has been run on a clean machine. The
`statecraft-cli` `install.sh` installs that repository's v0.1.0 release, the
CLI and MCP server, and is never offered as a way to install the engine.

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
- `/products` prerenders the availability matrix of section 3.3.1, and the
  prerender fails on any row rule that section lists.
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

## 8. Status note (2026-09-11): four published claims corrected

The 2026-09-11 family realignment asked every public surface to replace an
absolute governance claim with the exact guarantee, and to correct verified
factual drift. Four corrections land in this spec's own content modules. None
changes what sections 3.3 to 3.5 require; each makes the copy satisfy section
1's honesty rule and spec 002 section 1's voice constraint, which it had
stopped doing as the siblings moved.

1. **The auth host that was retired.** `whitepaper.ts` said "the OIDC signer
   is live at auth.statecraft.ing" and `explorer-diagrams.ts` figure 3 said
   the signer was "running today at auth.statecraft.ing". That host is
   deliberately gone: `statecraft` spec 009 section 2.4 is titled
   "`auth.statecraft.ing` does not return", its acceptance table records
   "issuer `https://app.statecraft.ing/auth/v1/`; `auth.statecraft.ing`
   NXDOMAIN", and spec 010 accepted the cost of stopping it. Both surfaces now
   say what is true: rauthy runs inside the plane's own container and is
   reached only through the plane's origin, with no separate auth host.

2. **Static non-overlap stated as proof.** "Disjoint territory is provably
   disjoint ... cannot collide" claimed more than the mechanism delivers. Two
   specs whose declared paths do not intersect cannot each claim the same
   file, and the coupling gate refuses a change reaching outside a claim. It
   does not cover what two non-overlapping specs still share (generated files,
   a lockfile, a migration, a fixture, an external resource) and it is not
   operating-system write isolation. The whitepaper, figure 1's territory node
   and the positioning table now say exactly that.

3. **A signed ledger that is not signed.** The whitepaper, figure 2, the
   positioning table, the delivery flow's Verify step, the verification layer
   blurb and the `attest-ledger` catalog card all presented Ed25519 signing as
   a property of the record. It is a capability of the `attest-ledger` library;
   whether a chain is signed is a deployment property. `statecraft` spec 008
   anchors the plane's chain to a fixed genesis root it declares for itself and
   leaves the anchor unsigned until an operator key is configured, and spec 009
   records that key as declared with no delivery path in the deployment. The
   copy now separates integrity (settled by recomputation) from issuer trust
   (not), and says signing is specified and not yet in force.

4. **A verifier path nothing has exercised.** The whitepaper described
   tenant-tail re-checking "the run-side artifacts the factory asserted about
   its build" as a live path. No production stamp of an application is on a
   public record, so no production certificate is recorded as having been
   through it. The claim is now stated as a library shape, and the reader is
   told that a chain rebuilt from a fresh anchor verifies while proving nothing
   about its origin.

(Items 3 and 4: evidence re-pointed 2026-09-12 to public sources; section 9.)

One drift fix rides along: `papers.ts` carried a hardcoded "10" for the
family's repo count, stale since the eleventh repo joined (spec 003 section
6). It now reads `PRODUCT_FAMILY.length`, which section 2 already permits
this spec to consume, so the stat cannot fall behind the roster again. The
`statecraft-cli` catalog entry and the Interface layer blurb gain the local
engine the repository now holds, matching spec 003 section 7.

Not changed here, and recorded in spec 006 for review instead: the Stamp rung,
the Substrate layer's framing, the delivery flow's shape, and the addition of
`rahi`. Each of those changes what spec 002 section 2 or section 3.3 here
*requires*, and the successor thesis that would motivate them was then an
unratified draft in `statecraft`.

## 9. Status note (2026-09-12): the matrix, and four claims the first pass missed

Sections 3.3.1 and the 3.5 amendment land with this change, on the owner's
2026-09-12 adoption of revision-4 row WEB-01, which answers spec 006's D-2
(the matrix is a section of `/products`), D-4 (the matrix alone authors the
axes the chips do not carry), D-6 (the first adoption path is spec-spine in a
repository the reader already has) and D-9 (all three prepared tiers), and
accepts P-1 and P-4 in that shape (spec 006 section 10). The same row fixes one
rule for the local engine: it reads not released until a tested release
exists, and `install.sh` is not an engine-install path. Sibling states read on
2026-09-12 at `statecraft-cli` `874766b`, `spec-spine` `59cba05`, `statecraft`
`9658e29`, `enrahitu` `26c75e2`, `attest-ledger` `a9c3595`, `statecrafting`
`85db8fd`; every external evidence link in the matrix was fetched that day and
resolved.

Two readings moved between the proposal and this change. `spec-spine` spec
085, the verifier that refuses unknown fields and an unsupported schema
version, is now implemented on `main` and in no release, so the matrix states
that limit against the released v0.18.0 and names 085 as the unreleased fix;
086 is still a draft. And the statecraft row's unsigned-anchor limit now cites
spec 009's record of the undeliverable key beside spec 008.

Four corrections ride along, each a sentence that section 8 should have caught:

1. **A ledger signs its anchor, not its entries.** Section 8 item 3 rewrote
   "Ed25519-signed" as "can sign entries". `attest-ledger` signs only a chain's
   genesis anchor (`crates/core/src/signing.rs`, `sign_anchor`), and
   `verify_anchor` checks that signature against the public key embedded in the
   same anchor. A valid signature therefore says which key signed, not whose
   key it is. The whitepaper, figure 2, the verification layer blurb and the
   catalog card now say so, and the layer blurb no longer says a signature
   answers who issued a chain on its own.
2. **A license missing from the statecrafting card.** The three platform
   packages carrying the vendored Encore core declare MPL-2.0
   (`statecrafting` spec 002 section 3 and its `packages/toolchain-*`
   manifests, published at 0.4.0 on npm under that license). The card named
   only Apache-2.0 and AGPL-3.0.
3. **"Self-hostable" beside a plane with no self-host path.** The statecraft
   card said "AGPL-3.0: self-hostable, copyleft" while spec 002 section 8 item
   3 says no reproducible self-host path exists. The card now states what the
   license requires and makes no claim about hosting.
4. **A stale count in a meta description.** `/products` described "Ten open
   repos"; it now reads `PRODUCT_FAMILY.length`, as the papers stat already
   does.

**Evidence that is not public (WEB-03).** Section 8 items 3 and 4, the
whitepaper's ledger and verifier paragraphs, and figure 2's ledger node leaned
on `statecraft` spec 014 for the unsigned live chain and the factory never
having run. That record is on no public branch and publication of drafts has
not been authorized, so each now rests on public evidence (`statecraft` 008
and 009) or says "no public record". The matrix already cited none of 014. The
whitepaper edits are mechanism corrections of the kind section 8 made, plus one
word in its abstract ("not yet shipped" becomes "not yet implemented", the
ladder's vocabulary it points to); the July paper is not re-authored.

Not changed: the Stamp step, the Substrate layer, the delivery flow's shape,
`rahi`, and the whitepaper's superseded banner. The owner adopted the successor
thesis on 2026-09-12 (WEB-02: add `rahi`, keep hqgit off, supersede the
whitepaper with a dated banner), and every one of those lands as an explicit
follow-on amendment to this spec, not inside this change.
