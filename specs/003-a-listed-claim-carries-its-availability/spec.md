---
id: "003-a-listed-claim-carries-its-availability"
title: "A listed claim carries its availability"
status: draft
implementation: pending
created: "2026-09-11"
summary: >
  The landing page lists eleven repositories in the present tense and closes
  with a license rationale that is, in two places, not true of the files on
  disk. This spec amends 001 section 3.1: every project entry states what is
  available at the level of a capability rather than a product, the family
  gains the two repositories it has grown since (rahi and hqgit, the second
  labelled as specification only), statecraft-cli is described as the tooling
  monorepo it became on 2026-09-09, the license section names the three
  licenses that actually ship and stops claiming what a license prevents, and
  the page acquires a first adoption link that runs locally with no account.
  It does not adopt the September 2026 realignment's proof-protocol roadmap,
  which is proposed and unratified in the repositories that would implement it.
depends_on:
  - "001-the-profile-is-the-org-front-door"
amends:
  - "001-the-profile-is-the-org-front-door"
extends:
  # 001 owns the file and section 3.1 fixes what it must carry. This spec
  # rewrites parts of that content, so the edge is superseding on the unit
  # rather than additive. 001's own `spec.md` is not edited to record it
  # (standards/spec/contract.md: an `amends` edge is declared once, here).
  - { spec: "001-the-profile-is-the-org-front-door", unit: "profile/README.md", nature: superseding }
---

# 003: A listed claim carries its availability

## 1. Purpose

Spec 001 section 3.2 already holds the page to a high standard: a license
badge is "a factual claim about a file on disk in another repository", checked
against that repository. This spec extends the same discipline from the badge
to the sentence beside it.

Three things changed under the page since it was written.

1. **The family grew.** `rahi` and `hqgit` are public repositories under this
   organisation and neither is listed. `hqgit` has 68 approved specs and no
   code; `rahi` has 22 approved specs and is built.
2. **A member changed shape.** On 2026-09-09 `statecraft-cli` absorbed the
   `claude-observatory` tree (its own spec 110): the local run engine, the
   sensors, the drivers, the journal crates and a React interface now live
   there. The page still describes it as an interface to something else.
3. **The license rationale went out of date, in a way that matters.** It says
   every building block a stamped application consumes is Apache-2.0. The
   vendored Encore core reaches stamped applications through
   `@statecrafting/toolchain-linux-x64`, `-linux-arm64` and `-darwin-arm64`,
   and all three are MPL-2.0. It also says strong copyleft "prevents that work
   from being absorbed into proprietary control planes". A license conditions
   redistribution; it does not prevent anything, and this organisation's own
   control plane repository already states the accurate version.

A reader who takes the page at its word is, today, wrong about what they may
use and wrong about what they can run. That is the defect this spec closes.

## 2. Territory

This spec owns no new file. It claims, through the `extends` edge above,
authority to rewrite the parts of `profile/README.md` that section 4 names,
and it amends spec 001 section 3.1 so that the design the page is held to is
the one in section 3 here.

Untouched, and deliberately: `README.md` (001 section 3.3 stands, it points
and does not duplicate), `profile/artifacts/` (001 section 3.4 stands), the
thesis line 001 section 3.1.1 fixes and 001's `## Verification` block greps
for, and the mermaid diagram of the two-plane shape.

## 3. Behavior

### 3.1 The page carries five things, in this order

This replaces 001 section 3.1's list of four. Items 1, 2 and 5 are 001's
items 1, 2 and 4 with the changes section 4 states; items 3 and 4 are new.

1. **The thesis.** Unchanged in substance and in wording: AI can write the
   code; the unsolved problem is trusting what it wrote. The sentence beneath
   it MUST be scoped to what a gate does (refuse a change that drifts from the
   spec that authorised it) rather than to what it refuses in general.
2. **The shape.** The mermaid diagram, unchanged.
3. **The first adoption path.** One short block, above the project list, that
   names a command a reader can run in a repository they already have. It
   MUST require no account, no hosted plane and no adoption of any runtime in
   this family. It MUST NOT be the first thing a reader is asked to install
   that they cannot install today.
4. **The projects**, grouped by role, each entry carrying a license badge, a
   language badge, one paragraph of what the thing is, and an availability
   line as section 3.2 defines it.
5. **The license section.** Which license applies where, what that requires,
   and nothing about what it guarantees or prevents.

### 3.2 Availability is stated per capability, never as a product verdict

Each project entry whose reader could otherwise over-read the present tense
MUST carry one **Available:** line. The line states which capabilities are
built, and names what is not, at the granularity the repository's own spec
corpus uses.

- "Built" means: the specs governing that capability are `status: approved`
  and `implementation: complete` in that repository. It does not mean hosted,
  supported, released for general use, or fit for a particular purpose.
- A repository with approved specs and no implementation is labelled
  **specification only**, in those words, and MUST NOT be described in a way
  that implies a running service.
- The page MUST NOT carry a single word like "complete", "shipped" or "GA"
  applied to a whole repository.
- A capability that is a draft spec is named as a draft or omitted. It is
  never written in the present tense.

### 3.3 Evidence claims are bounded to what is independently checkable

The page MAY say that the family produces evidence a third party can verify
without trusting the producer, because `tenant-tail`, `attest-ledger` and the
coupling gate are that, and each is checkable in its own repository. The page
MUST NOT claim proven correctness, guaranteed containment of an agent, or
automated regulatory compliance, and MUST NOT compare this family against
other tools by count, ranking, or by asserting what they lack.

Preferred phrasing, for the same reason: "independently verifiable evidence".

### 3.4 The license section separates the label from the promise

It MUST name every license that actually ships to a consumer, including
MPL-2.0 for the vendored Encore core. It MUST state what each license
requires of a redistributor. It MUST NOT state what a license prevents,
guarantees, or protects against, and MUST NOT mix a license claim with a
product claim in the same sentence.

### 3.5 Nothing here adopts the September 2026 realignment

An external realignment arriving 2026-09-11 proposes extending `spec-spine`
into a compiler of authority snapshots, work scopes and context closures, and
a permit and proof protocol across the family. Its status in the repositories
that would implement it, checked on 2026-09-11:

| Record | Where | State |
| --- | --- | --- |
| AuthoritySnapshot, and specs 085 to 088 | spec-spine | uncommitted in a working tree on branch `085-087-authority-evidence` |
| WorkScope, ContextClosure | spec-spine | a design note, filed nowhere |
| WorkPermit | nowhere | undefined |
| The evaluation itself | statecraft-cli `docs/design/05-the-realignment-checked.md` | "Status: proposed", decisions D58 to D73 unratified, specs 128 to 132 born draft |

The page MUST NOT describe any of it. `statecraft-cli`'s own evaluation is
the precedent: the packet is evidence and a recommendation, and it amends no
approved spec.

## 4. The proposed copy

The replacement text, block by block. Everything not listed here is unchanged.

### 4.1 The thesis block: one sentence tightened

Replace:

> gates (not optimism) refuse anything that drifts from the contract.

with:

> gates (not optimism) refuse a change that drifts from the spec that
> authorised it.

Replace, in "The thesis" section:

> The result is delivery you can hand to an auditor: every change bound to the
> spec that authorised it, every run emitting a certificate anyone can verify
> offline.

with:

> What that produces is independently verifiable evidence: a change bound to
> the spec that authorised it, and a run whose certificate a third party can
> re-check offline without trusting the producer. Evidence is not a compliance
> verdict, and nothing here decides one for you.

Replace:

> a hash-verifiable contract that machinery enforces at PR time and at run
> time.

with:

> a hash-verifiable contract. The pull-request half runs today, in every
> repository below. The run-time half is what the control plane is being built
> to enforce.

### 4.2 A new block, between the thesis and the projects

> ## Start here
>
> Nothing below needs an account, and nothing below asks you to rewrite an
> application. The spine installs into a repository you already have:
>
> ```sh
> cargo install spec-spine-cli    # or: npm i -D spec-spine, or: pip install spec-spine
> spec-spine init                 # scaffolds spec-spine.toml, standards/, specs/000
> spec-spine compile && spec-spine lint
> ```
>
> Then wire `spec-spine couple` into CI and the gate refuses a change that
> drifts from its owning spec. The corpus that governs this page was started
> exactly that way. The full walkthrough is in
> [spec-spine's adoption guide](https://github.com/statecrafting/spec-spine/blob/main/docs/adoption-guide.md).

### 4.3 The project list: a key, and one changed heading

Immediately under `## Projects`:

> Each entry says what is **available**, at the level of a capability rather
> than a product: the specs governing it are approved and implemented in the
> repository named. That is not a claim that anything is hosted, supported, or
> released for general use. Every repository here carries its own spec corpus,
> and `spec-spine registry plan` is the live answer in each one.

### 4.4 statecraft

Keep the paragraph. Append:

> **Available:** the app shell, Postgres adoption, tenants, factory, fleet,
> the governance web app, the attestation ledger and the admin frontend are
> built (specs 002 to 008, 012, 013). Control-plane deploy, the cluster and
> tenant lifecycle (009, 010, 011) are in progress. There is no hosted plane
> to sign up for yet, and local use of anything else on this page does not
> depend on one.

### 4.5 statecraft-cli

Add a TypeScript badge beside the Rust badge. Replace the paragraph with:

> The family's local tooling, in one repository. `statecraft` is the CLI for
> humans and an MCP server for agents over the same governance verbs, so a
> coding agent requests approvals, checks spec-code coupling and drives stages
> through the controls a person passes through rather than around them. Since
> 2026-09-09 the repository is also the monorepo for the family's tooling (its
> spec 110): the local run engine, the sensors, the Claude and Codex drivers,
> the contract and journal crates and a local React interface live under
> `members/` and `crates/`, and `statecraft <member>` dispatches to them
> locally. Hosted governance verbs are the same binary's other face.
>
> **Available:** the CLI, the MCP stdio server, local member dispatch, the
> governed harness and the credential fence are built (102 to 110, 119 to
> 125). Prebuilt macOS and Linux binaries install from the repository's
> `install.sh`; every release archive ships a `.sha256`, a CycloneDX SBOM and
> a SLSA provenance attestation. The sandboxed executor, the review note,
> member distribution and the evidence view are drafts (126 to 132).

### 4.6 spec-spine

Keep the paragraph. Append:

> It is the one piece here that stands alone: it governs repositories that use
> nothing else in this family, it installs from crates.io, npm or PyPI, and it
> needs no account and no server.
>
> **Available:** built and in use. It governs every repository listed on this
> page, including the one that renders it.

### 4.7 A new group, "The chassis", after "The template"

> #### [rahi](https://github.com/statecrafting/rahi)
> Apache-2.0, Rust
>
> A Rust library chassis for a governed cell, and an alternative to the
> Encore.ts template rather than a replacement for it. It supplies identity
> (rauthy, co-deployed, reached only through the app's own origin), replicated
> state (hiqlite, in-process), a hash-chained decision ledger, a deny-by-default
> capability kernel, an axum edge with probes and tracing, single-container
> packaging with preflight, migrate, backup and restore, and a dev substrate
> that boots the real binary in tests. An application composes the crates and
> declares a manifest. The name is the lineage: enrahitu was Encore, rauthy,
> hiqlite, Turso; drop Encore and Turso and this is what remains.
>
> **Nothing else on this page requires it.** It is a chassis an application
> may compose, not a runtime anything is rewritten onto.
>
> **Available:** all 22 specs of the current corpus are approved and built,
> through the operational verbs, single-container packaging, cluster topology,
> the dev substrate and a `hello-cell` reference application (010 to 034).

### 4.8 A new group, "Specified, not built", last before the packages

> #### [hqgit](https://github.com/statecrafting/hqgit)
> AGPL-3.0, specification only
>
> A proposed verifiable evidence ledger for software change: canonical state
> as a per-repository DAG of signed, content-addressed objects covering code,
> collaboration and evidence, with every index, feed and dashboard a
> projection rebuildable from zero. The stated wedge is absorption rather than
> replacement, over repositories that stay where they are.
>
> **Available: nothing.** 68 approved specs and no code; the crate directory
> does not exist. The only integration scope adopted so far is one boundary
> decision (its spec 003): waves 1 to 5 stay chassis-free so the CLI works with
> no server, and a wave 6 server would compose rahi as a cell. There is no
> forge, no review service and no hosted anything to use today.

### 4.9 enrahitu

Replace the paragraph with:

> **EnRaHiTu**: **En**core.ts + **ra**uthy + **hi**qlite + **Tu**rso/libSQL.
> Two things at once, both current. It is a membership and association
> management platform that organisations self-host and extend: members, tiers,
> renewals, dues, events, volunteers, documents, board governance. It is also
> the template chassis the Statecraft factory stamps, through the versioned
> `template.toml` contract (its spec 009), where `app/` is the one directory
> an upgrade never touches (its spec 035). One container and one volume is the
> whole deployment: typed APIs, a real OIDC identity provider, and embedded
> Raft-replicated SQLite in one image, with no managed-infrastructure
> dependency. The Encore toolchain is consumed as a published package and
> driven directly, no CLI anywhere.
>
> **Available:** the platform and the template contract are built (39 approved
> specs). `docker run` and the operations guide are in the repository.

### 4.10 statecrafting

Replace the last sentence of the paragraph with:

> Three licenses coexist here on purpose, per package: `kernel-native` and
> `hiqlite-native`, the addons a stamped application consumes, and
> `@statecrafting/toolchain` are Apache-2.0; `governance-native` and
> `fleet-native`, the control-plane addons, are AGPL-3.0; and the three
> platform packages carrying the vendored Encore core
> (`toolchain-linux-x64`, `toolchain-linux-arm64`, `toolchain-darwin-arm64`)
> are MPL-2.0, as their upstream is.
>
> **Available:** all five packages are published. Existing `@statecrafting/*`
> consumers are unaffected by anything newer on this page; this repository is
> not retired and nothing here asks anyone to migrate off it.

### 4.11 The license section

Replace the whole `## Why these licenses` section with:

> ## Which license applies, and what it requires
>
> **AGPL-3.0: the control plane, and hqgit.** Self-hosting is free. Offering
> a modified version of either as a service means publishing the
> modifications. That is the condition; it is a term of redistribution and
> nothing more.
>
> **Apache-2.0: everything a stamped application consumes.** The template,
> the CLI, the chassis, the tenant toolkit and the primitives, so the building
> blocks are free to adopt anywhere. Applications stamped from the template
> belong to their owners.
>
> **MPL-2.0: the vendored Encore core**, inside the
> `@statecrafting/toolchain-*` platform packages, as its upstream is. File-level
> copyleft: modifications to those files are published, the rest of an
> application is unaffected.
>
> Every badge above names the license in that repository's own `LICENSE` file.
> A license says what redistribution requires. It is not a statement about what
> the software does, and none of it is a warranty.

## 5. Out of scope

- **The lead paragraph and the tagline.** The handoff proposes leading with
  governed delivery for existing repositories, local use independent of a
  hosted account. That is a positioning decision, it is section 6's D-1, and
  this spec neither makes it nor writes it.
- **The mermaid diagram.** It draws the two-plane design, which is still the
  design (statecraft spec 001 section 3). rahi and hqgit are not in it, and
  adding them is a picture of a proposal rather than of the system.
- **statecraft.ing.** A different property and a different corpus (001
  section 4). Section 7 records what this spec asks of it; it changes nothing
  there.
- **Any repository not listed and not named in section 4**: `chancery`,
  `claude-observatory`, `Frame`, `aicortex`, `butler-ai`, `cold-bore`,
  `icebeek`, and the four archived repositories. Listing or retiring any of
  them is its own decision.
- **Community health files.** Still unwritten, still a spec each (001
  section 2).

## 6. Open decisions, for the approver

This spec is `draft` and these are why. None is an agent's to settle.

- **D-1. The lead.** Keep the current thesis-first lead, or lead with
  "governed delivery for existing repositories, local use independent of a
  hosted account"? The handoff proposes the second and asks for confirmation
  before it is described as the adopted offer. Note that 001's `## Verification`
  block greps `profile/README.md` for `AI can write the code`, so a lead that
  drops the thesis line also edits 001's verification. Section 4 assumes the
  first and adds the adoption path beneath it.
- **D-2. The roster.** 001 section 3.2 says a repository that is not listed is
  not part of the family's public story. Adding rahi and hqgit says they are.
  Confirm, and note that statecraft.ing's own roster is eleven repositories
  (its spec 003), so an addition here without section 7's request leaves the
  two surfaces disagreeing.
- **D-3. enrahitu's first sentence.** Its own README leads with the membership
  platform; this page leads with the chassis. Section 4.9 leads with both,
  which is accurate and is one sentence longer than either.
- **D-4. The adoption path.** Section 4.2 sends a reader to `spec-spine init`,
  which was run end to end on 2026-09-11 in an empty repository (`init`,
  `compile`, `lint`, `registry list`, all exit 0, no account, no manifest).
  `statecraft-cli`'s `install.sh` is the alternative. Whichever is chosen has
  to be the same one statecraft.ing sends a reader to.
- **D-5. The `extends` edge.** This spec claims superseding authority over a
  unit spec 001 owns. That is a claim about someone else's territory and the
  `/spec` skill makes it a human checkpoint. Approving this spec grants it;
  the alternative is a ratified authoring edit to 001 instead, and then this
  spec is withdrawn.

## 7. What this asks of other repositories

Requests, not changes. Nothing here is edited by this spec or by the session
that wrote it.

- **statecraft.ing.** (1) Its roster is eleven repositories, owned by its spec
  003 section 3 and encoded in `app/lib/product-family.ts`. If D-2 is approved
  here, that roster and this page have to move together, or the two public
  surfaces contradict each other. (2) The same spec's licensing note says the
  `statecrafting` repository's packages are Apache-2.0 with "two AGPL-3.0
  per-package licenses"; it omits the three MPL-2.0 platform packages, and the
  omission is the same defect section 3.4 fixes here. (3) D-4's adoption path
  has to match the site's. The exact site description this page is coordinated
  against is quoted in section 8.
- **statecraft-cli.** Its README's Status paragraph names milestone M4 and
  specs 102 to 110; the corpus has since reached 125 complete with 126 to 132
  draft. Section 4.5's availability line is written from the corpus, not from
  that paragraph.
- **rahi.** Its README says six crates exist and that wave 3 is not started.
  The corpus reads 22 specs approved and complete, including 030, 031, 032,
  033 and 034. Section 4.7 is written from the corpus. The README is stale and
  is that repository's to correct.
- **hqgit.** Its README and this page agree that it is specified and not
  built. Its build instructions point at `bartekus/claude-observatory`, which
  is retired into `statecraft-cli` under this organisation; `rahi`'s README
  carries the same stale pointer.
- **spec-spine.** Drafts 085 to 088, `docs/authority-evidence.md` and
  `docs/design/04-authority-evidence-extension.md` are uncommitted on branch
  `085-087-authority-evidence`. Until they are committed and reviewed, section
  3.5 holds and this page says nothing about them.

## 8. The site description this page is coordinated against

Quoted verbatim from `statecraft.ing`, `app/routes/_index.tsx`, on
2026-09-11, so a later edit to either surface can be checked against what the
other actually said.

Page title:

> Statecraft: governed agentic delivery control plane

Meta description:

> Intent becomes a governed spec, a factory stamps a complete app from an open
> template, a fleet operates the result, and your code stays in your GitHub
> org. Spec-governed, open source, static by construction.

Hero lead:

> Statecraft is built around one governed loop: intent becomes a governed
> spec, a factory stamps a complete application from an open template, a fleet
> operates the result, and your code stays in your GitHub org the whole time.

The page's own lead does not restate this and should not: the site sells the
loop, the profile maps the repositories. What the two must agree on is the
roster (D-2), the adoption path (D-4), and the licenses (section 3.4).

## Verification

```verify:cli
# 3.1.3: the adoption path exists, is above the projects, and is runnable.
grep -qF '## Start here' profile/README.md
grep -qF 'spec-spine init' profile/README.md
awk '/^## Start here/{s=NR} /^## Projects/{p=NR} END{exit !(s>0 && p>0 && s<p)}' profile/README.md
# 3.1.3: the first adoption path does not require an account or a hosted plane.
grep -qF 'Nothing below needs an account' profile/README.md
# 3.2: availability is stated, and no whole-repository verdict is.
grep -qF '**Available:**' profile/README.md
grep -qF 'Available: nothing' profile/README.md
! grep -qiE 'status: (complete|shipped|ga)\b' profile/README.md
# 3.3: the evidence claim is bounded, and the unbounded ones are gone.
grep -qF 'independently verifiable evidence' profile/README.md
! grep -qF 'hand to an auditor' profile/README.md
! grep -qF 'refuse anything that drifts' profile/README.md
# 3.4: every shipping license is named, and no license is said to prevent anything.
grep -qF 'MPL-2.0' profile/README.md
grep -qF 'AGPL-3.0' profile/README.md
grep -qF 'Apache-2.0' profile/README.md
! grep -qF 'prevents that work from being absorbed' profile/README.md
# 3.5: the unratified realignment is not on the page.
! grep -qiE 'AuthoritySnapshot|WorkPermit|ContextClosure|WorkScope' profile/README.md
# D-2, once approved: the two new entries are present and correctly labelled.
grep -qF 'github.com/statecrafting/rahi' profile/README.md
grep -qF 'github.com/statecrafting/hqgit' profile/README.md
grep -qF 'Nothing else on this page requires it' profile/README.md
grep -qF 'specification only' profile/README.md
# 2: what 001 still owns is untouched.
grep -qF 'AI can write the code' profile/README.md
grep -q '```mermaid' profile/README.md
grep -qF '](artifacts/statecraft-github-banner.jpg)' profile/README.md
! grep -qF '## Projects' README.md
```
