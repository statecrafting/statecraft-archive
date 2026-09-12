---
id: "002-launch-content"
title: "Launch content: positioning, product family, honest status"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "001-site-scaffold"
establishes:
  - "app/routes/_index.tsx"
  - "app/routes/docs.tsx"
  - "app/routes/docs.$slug.tsx"
  - "app/lib/docs.ts"
  - "app/lib/milestones.ts"
summary: >
  The words on the site at launch. One index page that states what
  Statecraft is in the builder's own register (creator-led,
  OSS-credible, no startup theater), a product-family section
  presenting the roster owned by spec 003, and an honest status section
  tied to the public milestone ladder. The positioning facts are inlined
  here so the implementing session needs no external archive.
---

# 002: Launch content

## 0. Implementation amendment (2026-07-14)

Two design points, settled before coding, so the spec matches the code
it owns:

- **Content architecture is React Router v7, not Astro.** The original
  `establishes: src/content/` was residue from the dropped Astro choice
  (spec 001 was itself amended 2026-07-14 to RR7). The launch content
  lives in the RR7 app tree: the index page (`app/routes/_index.tsx`),
  a docs index (`app/routes/docs.tsx`), a docs stub route
  (`app/routes/docs.$slug.tsx`), and two typed content modules
  (`app/lib/docs.ts`, `app/lib/milestones.ts`). No markdown/MDX
  toolchain is introduced: that would be a runtime-of-the-build
  dependency the site does not need, and §1's voice constraints are
  better served by typed content than by a content collection.
- **The status ladder is derived from the baked registry, never
  hardcoded.** §2's "Status" reads its per-milestone position by rolling
  up the `implementation` field of the constituent specs in the
  build-time-baked payload (`public/data/registry.json`), so it re-derives
  on every deploy and cannot drift from source. The authoring-time hint
  ("M1 done: born-green stamp proven") is explicitly superseded by that
  rule: at implementation time the registry shows `enrahitu/009-template-contract`
  is `in-progress` and `enrahitu/012-born-with-provenance` is `pending`,
  so the born-with stamp is not yet proven. The ladder reflects the
  registry truth (§6), not the hint.

## 1. Voice constraints

Written for engineers who evaluate tools by reading source. No
unverifiable claims, no customer logos that do not exist, no "join
thousands". Present tense for what works today, future tense clearly
marked for the ladder. First person singular is acceptable where it
reads naturally (a single creator builds this in the open).

## 2. Content inventory (index page)

- **Hero**: Statecraft is a governed delivery control plane: intent
  becomes a governed spec, a factory stamps a complete application
  from an open template, a fleet operates the result, and the
  customer's code lives in the customer's GitHub org the whole time.
  One sentence under it: the substrate is EnRaHiTu: Encore.ts +
  rauthy + hiqlite + Turso in a single container with zero managed
  dependencies.
- **The loop** (four short blocks): Specify (spec-spine: markdown
  truth, compiled registries, drift gates in CI), Stamp (template
  contract, born-with certificate binding an explicit agentic
  posture), Operate (one container + one volume per app; update and
  backup as governed verbs), Verify (tamper-evident attestation
  ledger; independent verifier exists).
- **Product family table**: the index renders the product family as a
  list, each row a one-line role + repo link + SPDX license, with the
  note that stamped apps belong to their owners. The roster itself
  (which repos, and their roles and licenses) is owned by spec 003 §3
  and encoded once in `app/lib/product-family.ts`; this section governs
  how that roster is presented, not what it contains, so it does not
  restate it. The family list is broader than the `/registry` bake set:
  repos outside the baked set (spec 001 §3) are named and linked here,
  not rendered as spec corpora, and spec 001 leaves that bake set
  unchanged. (Roster enumeration trimmed 2026-07-15 to defer to spec
  003 §3, its owner.)
- **For agents**: a short section stating the MCP face: coding agents
  operate under the same governance as humans (same verbs, same
  guards, explicit posture, no side doors).
- **Live registry**: a pointer section to the `/registry` viewer
  (spec 001): the product family's spec corpora rendered from
  build-time-baked shards, each page stating the source commit it was
  baked from. This is the "evaluate us by reading source" claim made
  navigable.
- **Status** (kept truthful at every deploy): the milestone ladder
  M1-M5 with current position, linking each milestone to the public
  spec that governs it. At authoring time: M1 done (template contract
  v0, born-green stamp proven), M2-M5 in progress/planned; the
  implementing session must check the repos' registries for the
  then-current truth rather than copying this sentence.
- **Footer**: GitHub org, license notes, no tracking statement.

## 3. Docs seed

Turn the single placeholder docs page (`app/routes/docs.tsx`) into an
index over three real stubs, each rendered by `app/routes/docs.$slug.tsx`
from `app/lib/docs.ts`, sourced from the repos' own READMEs and specs (do
not fork prose; link and summarize): "What is EnRaHiTu", "The template
contract", "Self-hosting the control plane (AGPL)". Where a stub describes
work that is spec-approved but not yet built (the control plane), it says
so in future tense and points at the governing specs, per §1.

## 4. Acceptance

- Every claim on the page is checkable against a public repo at build
  time; the status section names real spec ids.
- Builds clean; internal links resolve; docs stubs render.
- A skim test: a stranger can answer "what is this, what can I run
  today, what license am I touching" from the index alone.

## 5. Out of scope

- Pricing, waitlists, email capture.
- Long-form architecture essays (belong in the repos' specs/docs).

## 6. Status (2026-07-14): complete

Implemented and verified. The launch content replaces the spec-001
placeholders; no new build toolchain was added.

- **Index** (`app/routes/_index.tsx`): hero (the loop stated as thesis +
  the EnRaHiTu substrate line), the four-block loop (Specify / Stamp /
  Operate / Verify, each linking to the spec that governs it), the
  product-family list (from `app/lib/product-family.ts`, licenses shown,
  with the note that stamped apps belong to their owners), a "for agents"
  block pointing at the MCP server spec, a live-registry pointer, and the
  status ladder.
- **Status ladder** (`app/lib/milestones.ts`): M1-M5 mapped to real
  sibling-repo spec ids; the loader rolls each rung up from the baked
  payload at build time. Verified truth at implementation time: **M1
  Substrate 8/8 → shipped** (`enrahitu/001`-`008` complete); **M2 Stamp
  0/2 → in progress** (`enrahitu/009` in-progress, `enrahitu/012`
  pending); **M3 Factory**, **M4 Fleet**, **M5 Verify** → planned
  (`statecraft/*`, `statecraft-cli/*` approved, pending). This supersedes
  the §0 authoring hint: the born-with stamp is not yet proven, so the
  ladder does not claim it.
- **Docs** (`app/routes/docs.tsx` index + `app/routes/docs.$slug.tsx` +
  `app/lib/docs.ts`): three stubs (What is EnRaHiTu, The template
  contract, Self-hosting the control plane (AGPL)), each summarizing and
  linking its source, with an honest maturity marker; the control-plane
  stub is marked planned per §1.

Acceptance: every claim links to a public repo or a baked spec id (the
ladder is a pure function of the baked shards); `npm run typecheck` and
`npm run build` are clean (all routes prerendered, including the three new
docs pages); every internal link resolves (all linked registry/docs paths
prerender to 200); the built output makes zero off-origin resource
requests; the skim test holds (what it is, what runs today, and the
licenses are all answerable from the index). Spine gates green (`compile`,
`index`, `lint --fail-on-warn`, `index check`).

## 7. Status note (2026-09-11): the ladder re-points at a renumbered corpus

`statecraft-cli` merged the `claude-observatory` corpus into its own (its
spec `110-corpus-merge`) and moved its original specs into the `1xx` range.
The three ids the M5 rung named stopped resolving at the moment that repo's
`main` moved, and the index loader's build-time check did exactly what
section 2 asks of it: it failed the build loud rather than rendering a rung
with dead links.

The rung's meaning is unchanged; only the ordinals are. `app/lib/milestones.ts`
now names `101-cli-mcp-thesis`, `104-governance-verbs` and `105-mcp-server`,
which are the same three specs under their post-merge ids, each `complete` in
the baked payload. A fourth reference to the same corpus lives outside the
ladder: the for-agents block's `AGENT_REF` in `app/routes/_index.tsx`, moved
from `005-mcp-server` to `105-mcp-server`. Nothing here is re-curated: the
rollup still reads live state from the shards, so the position on the ladder
remains a pure function of the sibling repos and not a claim this file
makes.

This is the failure mode section 2 anticipated when it told the implementing
session to check the registries for the then-current truth rather than trust a
sentence. It will recur whenever a sibling renumbers, and the honest fix is
the same each time: re-point the ids, never weaken the check.

## 8. Status note (2026-09-11): three claims catch up with the siblings

Content corrections in this spec's own surfaces, from the 2026-09-11 family
realignment. Nothing in section 2 or section 3 changes what it requires; each
edit makes a sentence true again after a sibling moved. Sibling states read at
`statecraft` `afe31c3`, `statecraft-cli` `15103e2`, `enrahitu` `26c75e2`.

1. **The MCP face is present tense now.** The for-agents block said the face
   "will expose the governed verbs", while the maturity chip rendered beside it
   already read `shipped`, because `statecraft-cli/105-mcp-server` is
   `implementation: complete` in the baked payload. The prose was the only part
   still waiting. It also gains the limit the CLI's own doc 05 section 12
   records: no driver proves it observed every tool call a provider made, so
   provider tool-event coverage is `unknown` rather than claimed.

2. **The born-with certificate exists.** The template-contract stub said the
   certificate was "specced but not yet implemented".
   `enrahitu/012-born-with-provenance` is `implementation: complete`; only
   `009-template-contract`, the contract that drives the stamp, is still in
   progress. The stub now separates the two.

3. **The control plane runs, and you still cannot install it.** The self-host
   stub said the plane was "spec-approved and on the milestone ladder, not yet
   a thing you deploy", which is wrong in one direction and right in the other.
   A deployment serves `app.statecraft.ing`, and
   `statecraft/009-control-plane-deploy` describes it. What does not exist is a
   reproducible self-host path: 009 is still `implementation: in-progress` and
   describes one specific cluster. The stub now says both halves, and names the
   two limits a reader should carry into the rest of the docs: no production
   stamp of an application is on a public record, and the plane's chain anchor
   is unsigned until an operator key is configured
   (`statecraft/008-governance-attestation`), a key 009 records as declared
   with no delivery path. (Evidence re-pointed 2026-09-12; section 9.)

Not changed here: the Stamp rung, the hero's factory sentence, and the ladder's
M3 shape. Each is a change to what section 2 *requires*, motivated by a
successor thesis that was then an unratified draft in `statecraft`. Spec 006
records them as proposals P-1 to P-7 for review, with the evidence and the
dependency named.

## 9. Status note (2026-09-12): a chip reports the corpus, and says so

The maturity chips on the loop blocks, the for-agents block and the ladder
read `shipped`, `in progress` and `planned`. The first is the problem: it is
derived from `implementation: complete`, and a complete spec is not a shipped
product. On the live build of 2026-09-12 the M4 rung read "The fleet operates
the result: shipped" and the Operate block read `shipped`, from
`statecraft/006-fleet` alone, while no release of the plane exists and no
placed application is on a public record.

One rollup quirk is recorded and left alone: a constituent spec at
`implementation: n-a` counts as incomplete, so M3, which includes the
`statecraft` thesis record 001, cannot reach its top state however far the
rest of the rung moves. Whether a record belongs on a rung at all is for the
thesis-dependent amendment below to settle, since that amendment redraws the
rungs.

The derivation in section 0 is unchanged and stays the rule. Only the words
change: `milestoneStateLabel` in `app/lib/milestones.ts` now reads
`implemented`, `in progress` and `pending`, the corpus's own vocabulary. The
loop and status introductions each gain one sentence saying that implemented is
not released, exercised or hosted, and link to the availability matrix spec
004 section 3.3.1 adds to `/products`, which is the one place those three axes
are authored (spec 006 D-4).

This lands on the owner's 2026-09-12 adoption of revision-4 row WEB-01, which
chooses the matrix and chips together with the factual corrections and the
spec-spine-first adoption path (spec 006 section 10).

**Evidence that is not public (WEB-03).** Section 8 item 3 and the self-host
stub it describes cited `statecraft` spec 014 for the live deployment, the
factory never having run and the unsigned chain. That record is not on any
public branch, and publication of drafts has not been authorized, so a reader
could not check the citation. The item and the stub now rest on public
evidence only: `statecraft` 009 for the deployment and for the anchor key it
records as declared with no delivery path, 008 for the anchor being unsigned
until a key is configured, and "no public record" where nothing public records
a production stamp. The stub gains links to 008 and 009. What the limits say
is unchanged; only what a stranger can open behind them is.

Not changed here: the hero, the Stamp block, the ladder's M3 shape, and the
rungs themselves. The owner adopted the successor thesis the same day (WEB-02),
and those changes land as an explicit follow-on amendment, not inside this
one, per spec 006 section 10.
