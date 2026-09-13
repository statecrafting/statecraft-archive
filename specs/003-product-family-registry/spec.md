---
id: "003-product-family-registry"
title: "Product-family registry: a single owner for the shared repo list"
status: approved
created: "2026-07-15"
origin:
  retroactive: true   # app/lib/product-family.ts shipped under 001/002 (PR #2) before this spec adopted it
implementation: complete
depends_on:
  - "001-site-scaffold"
  - "002-launch-content"
establishes:
  - "app/lib/product-family.ts"
summary: >
  The canonical registry of the Statecraft product family: each repo's
  name, role, SPDX license, and URL, encoded once in
  app/lib/product-family.ts and consumed by the index family section, the
  footer, and the /registry viewer's repoMeta lookup. This spec gives that
  module a single explicit owner so a roster change (a repo added, removed,
  or re-described) is an ordinary authoring edit here plus the module, with
  no coupling waiver and no edit to the scaffold (001) or launch-content
  (002) specs. It owns the roster data, not the rendering.
---

# 003: Product-family registry

## 1. Purpose

`app/lib/product-family.ts` is the one place the product family is
enumerated: the `RepoMeta` shape, the `REPO_META` table, the ordered
`PRODUCT_FAMILY` array, and the `repoMeta` lookup. It is consumed by the
index page's family section and footer (spec 002) and by the `/registry`
viewer's metadata lookup (spec 001). The roster changes on its own cadence
(it went from four repos to ten on 2026-07-15), independent of the site
scaffold and the launch copy.

Until this spec, the module had no explicit owner: it fell under spec
001's `app/` directory by default, while its content was authored in
spec 002 section 2. So every roster edit tripped the coupling gate and was
cleared with a `Spec-Drift-Waiver:` (PR #2 added six repos; PR #3 fixed
the derived count), because neither owning spec is the natural home for a
repo-list change. This spec removes that recurring friction.

## 2. Territory

- **Owns** `app/lib/product-family.ts`: the `RepoMeta` interface, the
  `REPO_META` table, the `PRODUCT_FAMILY` display array, and `repoMeta`.
  The roster in section 3 is the authoritative source the module encodes.
- **A roster change is an edit to this spec plus the module.** Adding,
  removing, or re-describing a family repo means editing section 3 here
  and `product-family.ts` in the same change; that satisfies `spec-spine
  couple` directly (this spec is now a declared owner), with no waiver and
  no edit to spec 001 or spec 002.
- **Does not own the rendering.** The index family section and footer
  stay with spec 002; the `/registry` viewer stays with spec 001. They
  consume this module. Spec 002 section 2's inline list describes the page
  copy; section 3 here is authoritative for the roster data, and the
  coupling gate steers a roster edit to this spec (an owner) rather than
  to spec 002 (not an owner of the module).
- **Does not change the bake set.** The family list and the baked
  `/registry` corpora are separate (spec 002 section 2): naming a repo
  here does not render it as a spec corpus. Unchanged.

## 3. The roster

Eleven public repositories under the `statecrafting` org, each checkable
against its own repo; the license is the SPDX id in that repo's LICENSE.
Each URL is `https://github.com/statecrafting/<repo>`.

| repo | role | license |
| --- | --- | --- |
| statecraft | the governed delivery control plane | AGPL-3.0 |
| enrahitu | the EnRaHiTu template chassis (Encore.ts + rauthy + hiqlite + Turso) | Apache-2.0 |
| statecraft-cli | the CLI, the MCP server, and the local delivery engine they drive | Apache-2.0 |
| spec-spine | the spec-governance toolchain everything above is governed by | Apache-2.0 |
| tenant-emit | the tenant certificate emitter, signing a certificate reconstructed from a finished run | Apache-2.0 |
| tenant-tail | the tenant certificate verifier, re-checking a factory's run-side paperwork | Apache-2.0 |
| action-gate | the deterministic decision gate (Allow / Deny / Degrade) | Apache-2.0 |
| attest-ledger | the tamper-evident, hash-linked record ledger with an Ed25519-signable genesis anchor | Apache-2.0 |
| canonical-keysort-json | canonical JSON at the hash boundary | Apache-2.0 |
| trust-window | the rolling-window trust scorer | Apache-2.0 |
| statecrafting | the shared native packages (the @statecrafting/* napi addons and the Encore toolchain) | Apache-2.0 |

The `statecrafting` repo's root LICENSE is Apache-2.0 (the org-scope
default); two of its addons carry AGPL-3.0 per-package licenses, and the
three platform packages carrying the vendored Encore core carry MPL-2.0, all
of which the repo's own spec corpus documents (its specs 001 and 002).

`REPO_META` also carries a `statecraft.ing` entry (this site, unlicensed)
as a lookup convenience; it is not part of the public roster above.

## 4. Acceptance

- `app/lib/product-family.ts` encodes exactly these eleven repos, in this
  order, with these licenses; each role is a faithful one-line summary of
  the repo's own description (the module may phrase it more fully).
- A subsequent roster edit (this section 3 plus the module) passes
  `spec-spine couple --base origin/main` with no `Spec-Drift-Waiver:`,
  because this spec is a declared owner of the module.
- Spine gates green: `compile`, `index`, `lint --fail-on-warn`,
  `index check`. The site build stays static and clean.

## 5. Out of scope

- The rendering of the family and the footer (spec 002) and the registry
  viewer (spec 001).
- The `/registry` bake set (spec 001 section 3): this spec adds nothing to
  the baked corpora.
- Any repository not yet public.

## 6. Status (2026-07-15): complete

Retroactive adoption. `app/lib/product-family.ts` already exists (it
shipped with the launch content and grew to ten repos in PR #2), so this
spec declares ownership rather than creating the file, hence
`origin.retroactive: true`. No code change ships with this spec; the
module already matches section 3. The next roster edit couples cleanly
against this spec instead of requiring a waiver.

2026-07-23: first such roster edit; the `statecrafting` packages repo
(the @statecrafting/* napi addons and the Encore toolchain) joins as the
eleventh member, coupled here plus the module, no waiver.

## 7. Status note (2026-09-11): the CLI's role line catches up with its tree

A re-description, not a roster change: the eleven repositories and their
licenses are unchanged. `statecraft-cli` was described as "the CLI and MCP
server", which was accurate when this section was written and is now
materially incomplete. Since 2026-09-09 (its own design record 02) that
repository is the monorepo for the family's tooling: eight Rust crates
(contracts, the journal, two sensors, two provider drivers and their cores),
a Bun orchestrator engine under `members/`, a local browser UI, and a
`statecraft <name>` dispatch that reaches them without an account. Read at
its HEAD `15103e2`: 76 spec directories, `crates/`, `members/src/`, and
`members/web/src/views/`.

The role line becomes "the CLI, the MCP server, and the local delivery engine
they drive". Section 4's acceptance is unchanged and still holds: eleven
repos, this order, these licenses, each role a faithful one-line summary of
the repo's own description.

What is deliberately *not* changed here: `enrahitu`'s role line. Its own
corpus has pivoted (its approved specs 035 to 038 make it a membership
platform an organization extends rather than a chassis something is stamped
from), which is a change to what spec 002 section 2 requires the index to
say, not a phrasing fix. Spec 006 section 4 records it as proposal P-2 for
review rather than settling it here.

## 8. Status note (2026-09-12): three role lines stop overstating

A re-description, not a roster change: the eleven repositories, their order and
their root licenses are unchanged, and section 4 still holds. Read at
`attest-ledger` `a9c3595`, `tenant-emit` `2d5b538`, `tenant-tail` `7855a65`,
`statecrafting` `35126be`, each that repository's public `main`.

These role lines render in the footer of every prerendered page, so a sentence
here is the most-published sentence on the site.

- `attest-ledger` said "Ed25519-signed". The library signs a chain's genesis
  anchor and verifies that signature against the key the anchor carries; it
  does not sign entries, and a chain is only signed if its deployment
  configured a key. The line now says "an Ed25519-signable genesis anchor".
- `tenant-emit` said it "signs a produced app's governance certificate", and
  `tenant-tail` that it "re-checks the factory's paperwork". Both read as a
  path that has run. Each now describes what the tool does, in its own README's
  terms: the emitter reconstructs and signs a certificate from a run directory,
  and the verifier re-checks a factory's run-side paperwork.
- `statecrafting` names its three per-package licenses. The license column
  keeps the root SPDX id, as section 3 defines it; the MPL-2.0 platform packages
  were missing from the note beneath the table.
