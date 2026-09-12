---
id: "006-claim-inventory-and-realignment"
title: "The claim inventory: what this site may say today, and what waits on a decision"
status: approved
created: "2026-09-11"
implementation: n-a
depends_on:
  - "002-launch-content"
  - "003-product-family-registry"
  - "004-marketing-surfaces"
establishes:
  # A record's territory is the record. This spec writes no application code
  # and claims none; it owns its own directory so the ownership graph has an
  # edge for it and `lint` has nothing to warn about.
  - { kind: directory, path: "specs/006-claim-inventory-and-realignment/" }
summary: >
  statecraft.ing's half of the 2026-09-11 family realignment. Every claim the
  site publishes is inventoried and classified as verified available, current
  implementation work, proposed, historical or unsupported, with the evidence
  named. The corrections that needed no decision landed with this change, in
  spec 002 section 8, spec 003 section 7 and spec 004 section 8. What is left
  is recorded here as proposals, because each one changes what spec 002 section
  2 or spec 004 section 3.3 requires the site to say, and the successor thesis
  that would motivate them is statecraft spec 014, still draft. Also carries
  the requests to sibling repositories and the vocabulary packet
  statecrafting-profile asked for. This spec is a record, not a work order: it
  amends no approved spec and authorizes no publication.
---

# 006: The claim inventory

## 1. Purpose

On 2026-09-11 a family-wide realignment arrived as three documents: a plan
that extends spec-spine into a compiler of authority snapshots, work scopes
and context closures; a register of 45 proposals; and a handoff packet
addressed to this repository. The packet asks this site to make three
categories visible to a stranger: what they can use today, what is being
built, and what is only proposed.

The site was already built to resist one kind of dishonesty. Maturity chips
are rolled up from the baked registry rather than asserted, the index loader
fails the build when a referenced spec stops resolving, and the roster is
encoded once. That machinery works, and it caught real drift twice (spec 002
section 7, spec 004 section 7).

What it cannot catch is the failure this record exists for. A spec's
`implementation: complete` says the code was written and its acceptance held.
It does not say the capability has ever been exercised. `statecraft`
spec 005-factory-service is `complete`; `statecraft` spec 014 section 3.3
records that the factory has never run in production. Both are true. A chip
that reads `shipped` beside the word "stamp" is therefore accurate about the
corpus and misleading about the product, and no amount of deriving it harder
will fix that. The distinction the packet asks for is a second axis the chips
do not have: **declared** against **exercised**.

This record inventories the claims against that axis, lands what needed no
decision, and names what does.

## 2. Territory

This spec owns its own directory and nothing else. The corrections it
describes are claimed by the specs that own the files:

- `app/routes/_index.tsx`, `app/lib/docs.ts`, `app/lib/milestones.ts`: spec 002.
- `app/lib/product-family.ts`: spec 003.
- `app/lib/whitepaper.ts`, `app/lib/explorer-diagrams.ts`, `app/lib/papers.ts`,
  `app/lib/products.ts`, `app/lib/get-started.ts`: spec 004.
- `README.md`: unclaimed and inside the coupling gate's bypass floor
  (`spec-spine.toml` `[coupling] bypass_prefixes`).

Nothing here is a licence to edit those files. A proposal in section 4 that a
human approves becomes an edit to the owning spec plus its module, in one
change, the way spec 003 section 2 already requires for a roster change.

## 3. The claim inventory

Five classes, from the packet. **Available** means a reader can do it or see it
today. **Building** means the owning spec reports `in-progress`. **Proposed**
means specified or designed with nothing exercised. **Historical** means it was
true and the tree has moved. **Unsupported** means the site said more than any
evidence carries.

Evidence is a spec id, a path, or a live reading, always in the repository that
owns the fact. Sibling states read on 2026-09-11 at `statecraft` `afe31c3`,
`statecraft-cli` `15103e2`, `enrahitu` `26c75e2`, `rahi` `444bcf8`,
`statecrafting` `85db8fd`, `hqgit` `4d0f9c2`, `statecrafting-profile` `0ac33f9`.

### 3.1 Governance and the spine

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| spec-spine compiles a markdown corpus to a typed registry and refuses code that drifts from its owning spec | index, whitepaper 01, products | **available** | this repository is one of its corpora; `make gate` exits 0 on every commit; `spec-spine 0.18.0` on `PATH` |
| The compiler is deterministic: same inputs, byte-identical output | whitepaper 01, figure 1 | **available** | the committed shards under `.derived/`; `spec-spine check` compiles in memory and compares without writing |
| The coupling gate runs at pull-request time and refuses an unclaimed file | whitepaper 01, figure 1 | **available** | `spec-spine.toml` `[coupling] require_ownership = true`; `index coverage` reports 32/32 claimed |
| A refusal rule stops an agent editing a spec to match the code it wrote | whitepaper 01, figure 1 | **available, and enforced by a prompt** | `.claude/rules/adversarial-prompt-refusal.md`; `statecraft` spec 014 section 6 records the same row as enforced by "nothing mechanical" |
| Two agents on non-overlapping specs "cannot collide by construction" | whitepaper 01, figure 1, positioning table | **was unsupported; corrected in this change** | shared generated files, lockfiles, migrations, fixtures and external resources are outside a source-path claim; spec 004 section 8 item 2 |

### 3.2 The substrate

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| enrahitu runs as one container with one volume and no managed dependencies | index hero, products, docs, get-started | **available** | `enrahitu/007-single-container-packaging` complete; its README's `docker run` is the whole install |
| The name is the stack: Encore.ts, rauthy, hiqlite, Turso | index hero, docs, whitepaper 02 | **available as the name's expansion** | `rahi/docs/design/00-lineage.md` states the same derivation; hiqlite is in-process via napi, CoreLedger is libSQL |
| CoreLedger is a data layer over libSQL/Turso | docs, "What is EnRaHiTu" | **available, incomplete** | `enrahitu/011-coreledger-postgres-driver` added a Postgres driver, and the production plane runs Postgres (`statecraft` 014 section 3.2) |
| enrahitu is "the chassis every stamped app is built from" | docs, products Substrate layer, whitepaper 02 | **historical** | `enrahitu/035-chassis-boundary` (complete) makes it "a working application an organization extends rather than forks"; its 036 to 038 are a membership domain, not a template |
| rahi, the Rust chassis, exists | absent from every surface | **available and unmentioned** | `rahi` 22 approved specs, all `complete` or `n-a`; six crates; Apache-2.0; proposal P-3 |

### 3.3 The loop

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| Intent becomes a governed spec | index hero, loop, whitepaper 02 | **available** | as 3.1 |
| A factory stamps a complete application from an open template | index hero, loop, ladder M3, products, whitepaper 02, figure 2 | **proposed, never exercised** | `statecraft/005-factory-service` is `complete` in the corpus and `statecraft` 014 section 3.3 records it has never run in production; 014 section 4.2 retires it in the successor thesis |
| The stamped app is born with a certificate binding an agentic posture | loop, docs, whitepaper 02 | **available as a component, unexercised as a path** | `enrahitu/012-born-with-provenance` complete; the stamp that would issue one is `009`, in progress |
| A fleet operates the result: one container, one volume, update and backup as governed verbs | index loop, ladder M4, products, whitepaper 02 | **available, currently empty** | `statecraft/006-fleet` complete; 014 section 3.4 records the fleet holds nothing |
| Your code stays in your GitHub org the whole time | index hero, products | **available** | `statecraft/004-tenants-github-app` and `011-tenant-lifecycle`; 014 section 4.5 lists tenancy as implemented and running |
| A local, account-free governed run exists | absent from every surface | **available and unmentioned** | `statecraft-cli` 119 to 125 complete: candidate worktrees, capability negotiation, the credential fence, `acceptance.receipt` v1, the action broker; proposal P-4 |

### 3.4 The record and the verifier

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| attest-ledger is append-only and hash-linked | whitepaper 03, figure 2, products, roster | **available** | `attest-ledger` README and `crates/core`; `statecraft/008-governance-attestation` complete |
| The ledger is Ed25519-signed | whitepaper 03, figure 2, positioning table, delivery flow, layer blurb, papers stat | **library capability, not a deployment property; corrected in this change** | `attest-ledger/crates/core/src/signing.rs` exists; `statecraft` 014 section 3.5 reads the live anchor as `{"kind": "unsigned"}` with `GOVERNANCEANCHORKEY` absent from the live secret |
| An independent verifier re-checks the record with no trust in the producer | whitepaper 03, figure 2, products | **available as a library; the path is unexercised** | `tenant-tail` exists; no production certificate has passed through it because the factory never ran |
| Verification catches tampering | whitepaper 03, figure 2 | **available, with a stated hole; corrected in this change** | a chain rebuilt end to end from a fresh anchor verifies: `statecraft` 014 section 3.5 and `statecraft-cli` doc 05 F5 found this independently |
| Canonical JSON makes independent parties agree on a hash | whitepaper 03 | **available** | `canonical-keysort-json` |
| The certificate shapes in the reader are illustrative, not real artifacts | whitepaper 03 | **available, correctly labelled** | already stated in the copy |

### 3.5 Identity and decision

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| rauthy is the sole OIDC session signer, federating GitHub | whitepaper 04, figure 3 | **available** | `enrahitu/005-rauthy-same-origin` complete; rauthy runs inside the plane's container (`statecraft` 014 section 3.6: 36M of `/data` is `rauthy/`) |
| The signer is live at `auth.statecraft.ing` | whitepaper 04, figure 3 | **was unsupported; corrected in this change** | `statecraft/009-control-plane-deploy` section 2.4 is titled "`auth.statecraft.ing` does not return"; its acceptance records the host as NXDOMAIN and the issuer as `https://app.statecraft.ing/auth/v1/`; spec 010 accepted the cost of stopping it |
| Sign-in hands off to the plane's login initiator | site chrome | **available** | `app/components/sign-in-link.tsx`; `statecraft` 014 section 3.1 reports the deployment healthy |
| action-gate returns Allow, Deny or Degrade deterministically | whitepaper 04, figure 3, products | **available** | `action-gate`; `statecraft/008` complete |
| Every mutating verb passes the gate | whitepaper 04, figure 3 | **available, with a stated exception** | `statecraft` 014 section 6: a soft verb (deploy, backup) warns and proceeds when the governance service is unreachable; proposal P-6 |
| trust-window scores a rolling window into a privilege level | whitepaper 04, figure 3, products | **available as a library; unwired** | `trust-window`; no surface in the running plane reads it |
| An agent passes the same controls a person does | index for-agents, whitepaper 04 | **available, with an unknown** | `statecraft-cli/105-mcp-server` complete; no driver proves it observed every provider tool call, so coverage is `unknown` (its doc 05 section 12) |

### 3.6 The site's own claims about itself

| Claim | Surface | Class | Evidence |
|---|---|---|---|
| The site is static, prerendered, and makes zero runtime off-origin requests | spec 004 section 3.6, footer | **available** | `npm run build` prerenders every route; the built output's only external references are anchor hrefs |
| The registry shows N specs across M repos, each page stamped with its source commit | index, `/registry` | **available** | derived from the baked payload at build time |
| The family is eleven public repositories | index, papers stat, README | **available; the stat was stale and is now derived** | spec 003 section 3; the papers stat read a hardcoded "10" until this change |
| "Site content and stack land here later; this placeholder marks the repo's role" | README | **was unsupported; corrected in this change** | nine routes, six content modules and a live apex contradict it |
| statecraft-cli is "the CLI and MCP server" | roster, products | **was historical; corrected in this change** | eight Rust crates, a Bun engine under `members/`, a browser UI, 76 spec directories; spec 003 section 7 |
| The whitepaper is dated July 16, 2026 | `/papers` | **historical, and correctly dated** | preserve it; proposal P-7 adds a successor link rather than editing it |

### 3.7 What no surface says, and should

Four absences are as much a finding as a wrong sentence, because the packet's
acceptance is that a new visitor can answer four questions.

| Question a visitor cannot answer today | Where the answer lives | Proposal |
|---|---|---|
| What can I install and run right now? | `spec-spine` installs and runs; `statecraft-cli`'s umbrella binary installs (its spec 107, complete); its local engine does not yet package cleanly (its draft 130, and doc 05 F4) | P-4 |
| Do I need an account, or a runtime migration? | no: the local path is account-free (`statecraft-cli` 119 to 125) and Rahi is the service's own substrate, not a customer prerequisite (`statecraft` 014 section 4.4: "Nothing in it requires the customer's application to run on Rahi") | P-1, P-3 |
| What is paid or shared? | undecided: `statecraft` 014 O-6 leaves entitlements, metering, retention and support open | not proposed; see section 7 |
| What is still only proposed? | scattered across five corpora | P-1 |

## 4. Proposals

Each is a concrete edit to a named spec section, with its dependency. None is
authorized by this record; approval is a human flip, and each approved proposal
lands as a spec edit plus its module in one change.

- **P-1. An availability matrix is a first-class surface.** A new route, or a
  section of `/products`, that states every capability in the family in three
  columns: available today, being built, proposed. Each row names its owning
  spec and carries the declared-against-exercised distinction section 1
  describes, so `complete` never reads as `exercised` without evidence. This is
  the packet's acceptance criterion and the one proposal that does not wait on
  the thesis: it can be built against today's facts and re-derived later.
  Amends spec 004 section 3.3. Depends on nothing.

- **P-2. enrahitu is described as what it is.** Its roster role, the Substrate
  layer blurb, the "What is EnRaHiTu" stub and whitepaper 02 stop calling it
  the chassis a stamped app is born from. Its own approved corpus
  (`035-chassis-boundary`, `036-membership-core`, `037-app-mail`,
  `038-board-governance`) makes it a membership and association platform an
  organization extends. Amends spec 002 section 2, spec 003 section 3 and spec
  004 section 3.3. Depends on: nothing factual. It is held because it guts the
  Substrate layer and the Stamp rung that spec 002 section 2 requires, which is
  an owner's call, not a session's.

- **P-3. rahi joins the roster, as the service's substrate.** Twelve repos, not
  eleven. Its role line says what `statecraft` 014 section 4.4 says: Rahi is
  the chassis the Statecraft service is being rebuilt on, and optionally a
  runtime a customer may choose, never a prerequisite for using the local
  delivery tools. Amends spec 003 section 3 and spec 004 section 3.3 (every
  roster repo needs a layer and a `PRODUCT_DETAIL` entry, asserted at build
  time). Depends on: confirming the GitHub repository is public, which spec 003
  section 5 requires and this session could not check offline; and on
  `statecraft` spec 014 for how prominently Rahi is framed.

- **P-4. Three adoption paths, each with an honest install.** `/get-started`
  splits into: **govern a repository you already have** (spec-spine, available,
  `cargo install spec-spine-cli`); **run a governed session locally** (the
  `statecraft` binary from its `install.sh`, available; the local engine it
  dispatches to is not yet distributed as a working install, so the step says
  so and links `statecraft-cli` draft 130); and **connect a team plane**
  (proposed, `statecraft` drafts 015 and 016). The existing enrahitu step
  becomes "run the enrahitu application", not "run the substrate". Publish no
  install command that has not been run on a clean machine: `statecraft-cli`
  doc 05 F4 measured a packaged engine failing outside its checkout, and its
  draft 130's acceptance is exactly the clean-machine job. Amends spec 004
  section 3.5. Depends on: `statecraft-cli` draft 130 for the engine half.

- **P-5. The architecture explorer shows stages with owners.** Figure 2 is
  redrawn as compile, issue, enforce, observe, verify, each node naming the
  single owner `statecraft` 014 section 4.3 assigns it (spec-spine computes,
  the plane or the operator issues, the executor enforces, the workload
  observes, a neutral verifier reports) and each edge carrying the record that
  crosses it. Nodes with nothing built are drawn as proposed, and no node
  implies an hqgit feature exists: hqgit's 68 implementation specs are pending.
  Amends spec 004 section 3.4. Depends on `statecraft` specs 014, 015 and 016
  being approved, because the stage owners are exactly what they decide.

- **P-6. Guarantees are stated with their exceptions.** A short
  declared-against-enforced block on `/products`, transcribed from the rows the
  siblings already publish about themselves: soft verbs proceed when the
  governance service is unreachable; a candidate worktree is isolation, not a
  security boundary; the credential fence holds for a session and not for the
  gate the session's own code runs (`statecraft-cli` doc 05 F2, its draft 129);
  provider tool-event coverage is unknown. Amends spec 004 section 3.3. Depends
  on nothing; it only quotes.

- **P-7. Historical papers keep their dates and gain successors.** The
  whitepaper stays as authored, dated July 16, 2026, with a dated banner that
  links the successor record once one is approved. Its stamp-centred sections
  are not edited to conceal the architecture change; they are labelled as the
  July architecture. Amends spec 004 section 3.4. Depends on: an approved
  successor to link, which is `statecraft` spec 014.

## 5. Requests to sibling repositories

Proposals for each repository's own governance. None changes its contract from
here, and none is a dependency this record assumes satisfied.

**statecraft.**

- T-1. Requested: approve or reject spec 014. Six of the seven proposals above
  either depend on it or are shaped by it, and while it is `draft` the site's
  approved copy must keep describing the enrahitu-era architecture, which its
  own section 4.2 says is being replaced. This is the single highest-value
  unblock for this repository.
- T-2. Requested: decide O-1, whether managed application hosting is in the
  initial offer. 014 recommends no. The answer decides whether `/products` has
  a hosting story at all, and whether the fleet is described as a product or as
  the project's own operations.
- T-3. Requested: decide O-6, entitlements and metering, before any surface
  here says a word about price. Until then this site publishes no pricing,
  which spec 002 section 5 already puts out of scope.
- T-4. Requested: when 014 is approved, state where the successor thesis is
  published so P-7 has a public URL to link. A record that only exists in a
  draft spec cannot be a footnote on a public page.

**statecraft-cli.**

- T-5. Requested: the clean-machine install path of draft 130, including the
  `members.json` manifest and `statecraft members doctor`. P-4's middle path
  cannot publish an install instruction before that job passes; doc 05 F4
  measured today's packaged engine failing outside its checkout.
- T-6. Requested: confirm which verbs are the public surface after the flatten
  D73 describes, so `/get-started` does not publish a command spelling that is
  about to become an alias.
- T-7. Noted: this site will describe the local path as account-free and will
  not imply it uploads anything. If that changes, it changes here first.

**rahi.**

- T-8. Requested: confirm the GitHub repository is public, so P-3 can add it
  without breaking spec 003 section 5.
- T-9. Requested: a one-line consumer description this site may quote, and
  explicit confirmation of what `statecraft` 014 section 4.4 already implies:
  Rahi is not a prerequisite for a customer's own application runtime. The
  packet is explicit that this must not accidentally become a requirement, and
  a public page is exactly where such an accident happens.
- T-10. Noted: rahi's own README says "wave 3, the operational verbs and
  packaging, is not started", while its specs 030 to 034 are all
  `implementation: complete`. This site will read the corpus, not the README;
  the README is that repository's to fix.

**enrahitu.**

- T-11. Requested: a one-line description of what enrahitu is now, for P-2. Its
  README's first sentence ("a membership and association management platform
  for non-profits and associations") is a good candidate, and a confirmation
  that this is the public framing would let P-2 land without guessing.
- T-12. Requested: say whether the template contract (`009`) and the scaffold
  verb (`014`) survive the pivot, since the Stamp rung and the
  template-contract docs stub both point at them.

**statecrafting-profile.** Section 6 is the packet it asked for. One request in
return: T-13, tell this repository which vocabulary the profile settles on, so
the org front door and the site do not describe the same eleven or twelve repos
in two different registers.

**hqgit.** No request. It is named on no surface here and will stay unnamed
until it has exercised behavior: its 68 implementation specs are pending. P-5
records explicitly that no diagram may imply otherwise.

**spec-spine.** No request from this repository as a publisher. As a consumer,
this repository is governed at the `0.18.0` floor and will follow the released
CLI, not the working tree. One dependency has moved since the realignment was
written: its specs 085 to 088, the verifier, the compared index, the authority
snapshot and change classification, are now committed at `85467be`, which
satisfies `statecraft` 014's request S-3 and `statecraft-cli` doc 05's first
request. All four are `status: draft`, `implementation: pending`. So the
expansion is a filed proposal rather than an uncommitted one, and it stays
described nowhere on this site until something is implemented; a proposed
record or command name is labelled an example, per section 6.

## 6. The vocabulary packet for statecrafting-profile

The org front door and this site describe the same family, so they should use
the same words. This section is the packet, written to be copied.

**Nouns, with their exact meaning.**

| Word | Means | Does not mean |
|---|---|---|
| governed | a change is bound to a spec that declares the paths it owns, and a gate refuses code that moves without it | reviewed, approved, or secure |
| spec corpus | a directory of markdown specs a deterministic compiler turns into a typed registry | documentation |
| coupling gate | the pull-request check that cross-references changed paths against the authority graph | a test suite |
| territory | the source paths one spec claims | write isolation, or a guarantee about generated files, lockfiles or shared resources |
| receipt | a record that a named gate ran over a named revision and what it returned | proof the software is correct |
| hash-linked | each record commits to the previous one, so an edit in the middle is detectable | signed, or attributable to an issuer |
| signed | an issuer's key committed to these exact bytes | trusted, current, or unrevoked |
| verified | a named verifier recomputed a named property and reported it | correct, compliant, or certified |
| available | a reader can run it or see it today | the owning spec says `complete` |
| proposed | designed, possibly specified, with nothing exercised | coming soon |

**Four sentences that are safe to publish.** Each is checkable today.

1. spec-spine compiles a repository's specs into a typed authority graph and
   refuses, at pull-request time, code that moves without its owning spec.
2. Statecraft connects those declarations to attributable execution and
   authorized delivery: what ran, against which revision, under whose
   authority, and what it was allowed to publish.
3. The record is hash-linked, and every family verifier reports integrity and
   issuer trust as separate outcomes, so an unsigned chain reads as unsigned
   rather than as verified.
4. The local path runs on your own machine with no account, and your code stays
   in your own GitHub org.

**Six phrases to avoid, and what to write instead.**

| Do not write | Write |
|---|---|
| evidence proves the software is correct | evidence records what a named verifier observed at a named revision |
| complete agent context | the closure the run was built from, with omissions and truncations listed |
| safe parallelism | declared, non-overlapping source paths, checked at merge |
| compliance becomes free | an evidence workflow: control mappings, scope, retention, reviewer decisions and export |
| sandboxed | the deny set that was applied, named by digest, and what it does not confine |
| N repos, fully governed | the count, read off the roster, with each repo's own lifecycle counts linked |

**Two structural rules.** A proposed command or record name is labelled as an
example until it is implemented. A comparison to another product cites a dated
primary source or is not published: the realignment's own competitive table is
a planning artifact, not marketing evidence, and market counts and rankings are
not to be reused.

## 7. Open decisions for the owner

Each blocks something named above.

- **D-1. Is spec 014's successor thesis adopted?** Blocks P-2, P-3, P-5, P-7
  and every sentence on this site that currently says "stamp". Owner:
  `statecraft`. Until it resolves, the approved copy here keeps describing the
  July architecture, which is the honest state of an unratified change and also
  a growing gap.
- **D-2. Does P-1's availability matrix go on `/products` or on a route of its
  own?** A route is more findable and adds a surface to keep true; a section
  reuses the page a reader already opens to compare repos. Recommendation: a
  section of `/products` first, promoted to a route if it outgrows it.
- **D-3. Does the site name `rahi` before `statecraft` 017 has migrated
  anything?** Naming it early is honest about direction and risks reading as a
  shipped substrate; naming it late leaves the family roster describing a
  chassis the successor thesis replaces. Recommendation: name it, in the
  proposed column, with the "not a customer prerequisite" sentence attached.
- **D-4. Does the ladder gain the declared-against-exercised axis, or does the
  matrix carry it alone?** The ladder is derived and cheap to keep true; the
  axis cannot be derived from a spec's frontmatter and would have to be
  authored, which is a maintenance cost and a place for drift to hide.
  Recommendation: author it in one place (the matrix), and have the ladder link
  to it rather than duplicate it.
- **D-5. Is the whitepaper re-authored or superseded?** Re-authoring loses the
  dated record; superseding leaves a July paper as the first thing a reader
  opens. Recommendation: supersede, with the July paper preserved, dated, and
  linked from its successor. Depends on D-1.

## 8. Out of scope

- **Any publication.** This record authorizes no copy change beyond the
  corrections already landed under specs 002, 003 and 004, and no deploy.
  Merging to `main` is a deploy to the live apex and stays a human checkpoint.
- **Amending specs 002, 003 or 004's requirements.** Sections 2 and 3.3 of
  those specs still require what they required. Section 4 proposes; it does not
  decide.
- **Pricing, waitlists, metering.** Spec 002 section 5, and `statecraft` 014
  O-6.
- **Sibling repositories' internal design.** Section 5 asks; it does not
  decide.
- **The registry bake set.** Spec 001 section 3 is unchanged; naming a repo
  here does not bake its corpus.

## 9. Sources

The handoff packet `08-statecraft-ing.md`, the realignment plan
`spec-spine-realignment.md` and the feature disposition register, all dated
2026-09-11. This repository at `f87e3eb`. `statecraft` at `afe31c3`, specs 009,
010 and 014 read in full. `statecraft-cli` at `15103e2`,
`docs/design/05-the-realignment-checked.md` read in full. `enrahitu` at
`26c75e2`, specs 001, 035 and its README. `rahi` at `444bcf8`, its README and
registry. `attest-ledger`, `trust-window`, `action-gate`,
`canonical-keysort-json`, `tenant-emit` and `tenant-tail` at their working
copies. `statecrafting-profile` at `0ac33f9`. `spec-spine` at `85467be`, specs 085 to
088 read for lifecycle only. Sibling lifecycle states were
read through `spec-spine registry` and the specs' own frontmatter, never by
parsing `.derived/`.

## Verification

```sh
spec-spine compile
spec-spine index
spec-spine lint --fail-on-warn
spec-spine check
spec-spine index coverage --fail-on-untraced
make typecheck build
```

All six must exit 0. This spec is a record: it writes no application code, so
its acceptance is that the corpus still validates with it in place and the site
still builds and prerenders every route. `implementation: n-a`.
