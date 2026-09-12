---
id: "003-a-listed-claim-carries-its-availability"
title: "A listed claim carries its availability"
status: draft
implementation: pending
created: "2026-09-11"
summary: >
  The landing page lists repositories in the present tense and closes with a
  license rationale that is, in two places, not true of the files on disk.
  This spec amends 001 section 3.1 so that every entry states what is
  implemented, what is released, and what is hosted as three separate facts
  (the compact vocabulary of decision G-12, none of them a product verdict),
  the page gains a first adoption path that runs locally with no account, the
  license section names the three licenses that actually ship and says what
  each requires rather than what it prevents, and three overclaims are
  withdrawn (signed-by-code, a gate in every repository, a released CLI that
  carries the local engine). The owner's decisions of 2026-09-12 (PROF-01 to
  PROF-04) settle the roster, enrahitu's first sentence, the adoption path,
  the superseding edge and the license heading. The copy lands in three
  steps: corrections on their own, rahi in the same window as statecraft.ing
  lists it, and the lead once G-03 is recorded. hqgit stays off the page. It
  adopts nothing from the September 2026 realignment.
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

Four things changed under the page since it was written.

1. **The family grew.** `rahi` and `hqgit` are public repositories under this
   organisation and neither is listed. `rahi`'s chassis is implemented in its
   own corpus and has no release. `hqgit` is a specification corpus: its
   build harness is implemented and none of its product specs is.
2. **A member changed shape.** On 2026-09-09 `statecraft-cli` absorbed the
   `claude-observatory` tree (its spec 110): the local run engine, the
   sensors, the drivers, the journal crates and a React interface now live
   there. The page still describes it as an interface to something else, and
   its only release (v0.1.0, 2026-07-22) predates that change.
3. **The license rationale went out of date, in a way that matters.** It says
   every building block a stamped application consumes is Apache-2.0. The
   vendored Encore build toolchain ships in
   `@statecrafting/toolchain-linux-x64`, `-linux-arm64` and `-darwin-arm64`,
   and all three declare MPL-2.0 in their manifests. It also says strong
   copyleft "prevents that work from being absorbed into proprietary control
   planes". A license conditions redistribution; it does not prevent anything.
4. **Three sentences say more than the family does.** "Enforced, reconciled,
   and signed by code": `statecraft-cli`'s receipts are hash-chained journal
   records and are not signed (its spec 121 D-3). A gate "at PR time" in
   every repository: `action-gate`, `attest-ledger` and `trust-window` carry
   only a draft bootstrap spec and run no coupling gate. And nothing on the
   page separates code that is written from software a reader can install.

A reader who takes the page at its word is, today, wrong about what they may
use and wrong about what they can run. That is the defect this spec closes.

## 2. Territory

This spec owns no new file. It claims, through the `extends` edge above,
authority to rewrite the parts of `profile/README.md` that sections 4 to 6
name, and it amends spec 001 section 3.1 so that the design the page is held
to is the one in section 3 here.

Untouched, and deliberately: `README.md` (001 section 3.3 stands, it points
and does not duplicate), `profile/artifacts/` (001 section 3.4 stands), and
the mermaid diagram of the two-plane shape.

Every line 001's `## Verification` block reads in `profile/README.md` stays
true after this change, without editing 001: the thesis line
(`AI can write the code`), the mermaid fence, the `## Projects` heading, the
`## Why these licenses` heading, and the relative banner reference. The
2026-09-11 draft renamed the license heading, which would have turned 001's
acceptance red; section 8 D-6 records the choice.

## 3. Behavior

### 3.1 The page carries five things, in this order

This replaces 001 section 3.1's list of four. Items 1, 2 and 5 are 001's
items 1, 2 and 4 with the changes sections 4 to 6 state; items 3 and 4 are
new.

1. **The thesis.** Unchanged in substance and in its first line: AI can write
   the code; the unsolved problem is trusting what it wrote. The sentence
   beneath it MUST be scoped to what a gate does (refuse a change that drifts
   from the spec that authorised it) rather than to what it refuses in
   general.
2. **The shape.** The mermaid diagram, unchanged.
3. **The first adoption path.** One short block, above the project list, that
   names commands a reader can run in a repository they already have. It MUST
   require no account, no hosted service and no adoption of any runtime in
   this family. Every command in it MUST come from a released version, and
   the path MUST have been exercised end to end outside a source checkout
   (section 11 records the run).
4. **The projects**, grouped by role, each entry carrying a license badge, a
   language badge (or, for a repository with no code, a badge saying so), one
   paragraph of what the thing is, and the lines section 3.2 defines.
5. **The license section.** Which license applies where, from which
   declaration, and what each requires of a redistributor. Nothing about what
   a license guarantees or prevents.

### 3.2 Three facts, stated independently, never as one verdict

The 2026-09-11 draft defined a single **Available:** line as "the specs
governing it are approved and implemented". That definition is withdrawn: it
let a repository with completed acceptance read as a supported product, and
it could not say that `statecraft-cli` has implemented far more than it has
released. An entry instead states each of the following that applies, as its
own labelled line, and omits the ones that do not.

| Label | Means | Evidence the line cites | Does not mean |
|---|---|---|---|
| **Implemented:** | the owning specs in that repository read `implementation: complete` at the revision checked | the spec ids | released, exercised, supported, or fit for production |
| **Released:** | a versioned artifact a reader can install without a source checkout | the registry or release, and what the release contains when that differs from the default branch | that it contains everything implemented, or that it is supported |
| **Hosted:** | a service this organisation operates that a reader can sign up for | the sign-up | that some deployment exists somewhere; a running internal plane is not a hosted offer |

These three are the compact vocabulary of decision G-12 (section 8 D-7). The
2026-09-12 draft carried a fourth label, **Specification only.**, for
`hqgit`; with `hqgit` off the page (D-2) nothing uses it, and it is dropped.

Four rules hold over all three.

- A draft spec is named as a draft or omitted. It is never written in the
  present tense and never appears under **Implemented:**.
- The page MUST NOT apply a single word like "complete", "shipped", "GA",
  "production-ready" or "available" to a whole repository. "Available" is not
  used as a label at all; where prose needs it, it means released.
- Counts of specs are not published. A count stales on the next merge, and
  the spec ids an entry cites are the checkable part. Each repository's
  `spec-spine registry plan` is the live answer, and the page says so once.
- A positive line cites evidence a reader can reach: a public default branch,
  a public registry, a public release. A claim whose only evidence is local,
  private or unverified is omitted, not softened (G-12). Section 8 C-1 is the
  instance.

A fourth fact, **exercised** (a dated, recorded use outside the development
loop), belongs to statecraft.ing's availability matrix, where each row can
carry its evidence. The profile does not claim it for any entry, and the
definitions above make clear that implemented and released do not imply it.

### 3.3 Evidence claims are bounded to what is independently checkable

The page MAY say that the family is built to produce evidence a third party
can re-check without trusting the producer, because `tenant-tail`,
`attest-ledger` and the coupling gate are built for that, and each is
checkable in its own repository. The page MUST NOT claim proven correctness,
guaranteed containment of an agent, or automated regulatory compliance, and
MUST NOT compare this family against other tools by count, ranking, or by
asserting what they lack.

It MUST keep signed and unsigned evidence apart. `spec-spine attest --sign`
seals a corpus attestation with an Ed25519 key the operator holds (its spec
023). `statecraft-cli`'s acceptance receipts are not signed (its spec 121
D-3). A sentence that says the family's records are "signed" without naming
which is withdrawn.

Preferred phrasing, for the same reason: "independently verifiable evidence".

### 3.4 The license section separates the label from the promise

It MUST name every license that actually ships to a consumer, including
MPL-2.0 for the three toolchain platform packages. It MUST say where each
declaration lives (the repository's `LICENSE` file, or in `statecrafting` each
package's own manifest), state what each license requires of a
redistributor, and MUST NOT state what a license prevents, guarantees, or
protects against. It MUST NOT mix a license claim with a product claim in the
same sentence.

### 3.5 Nothing here adopts the September 2026 realignment

An external realignment arriving 2026-09-11 proposes extending `spec-spine`
into a compiler of authority snapshots, work scopes and context closures, a
permit and proof protocol across the family, and a successor thesis for
Statecraft. Its status in the repositories that would implement it, checked
on 2026-09-12 against each default branch on GitHub:

| Record | Where | State |
| --- | --- | --- |
| AuthoritySnapshot, and specs 084 to 088 | spec-spine `59cba05` | merged as drafts (PR 179). 084, 086, 087 (AuthoritySnapshot) and 088 are still `status: draft`; 085 was since ratified and implemented (PRs 181, 182) and is in no release |
| WorkScope, ContextClosure | spec-spine `docs/design/04-authority-evidence-extension.md` | a design record, no spec |
| WorkPermit | statecraft-cli draft 132, doc 05 | named in a draft and a design record |
| The evaluation itself | statecraft-cli `874766b`, `docs/design/05-the-realignment-checked.md` (PR 41) | merged; specs 126 to 132 `status: draft` |
| The successor thesis | statecraft, draft 014 and drafts 015 to 017 | on a local branch; not on GitHub |
| The runtime binding | rahi, drafts 035 to 041 | on a local branch; not on GitHub |

The page MUST NOT describe any of it. A merged draft is a filed proposal, not
an adopted design, and `statecraft-cli`'s own evaluation is the precedent: the
packet is evidence and a recommendation, and it amends no approved spec.

### 3.6 Corrections, the roster and the lead land separately

Section 4 is copy that corrects a sentence against a source. Section 5 is new
content that needs no thesis or roster decision. Section 6 is copy a decision
in section 8 releases, and each block says which. Approving this spec
approves sections 4 and 5 and, with the decisions of 2026-09-12, sections 6.1
and 6.3. Section 6.2 is withdrawn, and 6.4 waits on G-03.

The copy lands in three steps, because each depends on something different
(PROF-01):

1. **Corrections:** sections 4, 5 and 6.3. They depend on nothing outside
   this repository and land on their own.
2. **Roster:** section 6.1 without its substrate sentence, and "the chassis"
   in 4.9's Apache-2.0 line. It lands in the same publication window as
   statecraft.ing's change that lists rahi, and not before it.
3. **Lead:** section 6.4 and 6.1's substrate sentence, once G-03 is recorded
   (D-1).

### 3.7 One vocabulary with statecraft.ing

The labels in section 3.2 and the nouns in statecraft.ing spec 006 section 6
(governed, spec corpus, coupling gate, territory, receipt, hash-linked,
signed, verified, proposed) are the one vocabulary both public surfaces use,
as decided in G-12: the site states implemented, released, exercised and
hosted as separate facts, and this page uses the compact three. That settles
the one place the site's record differed: "available" is a label on neither
surface.

## 4. Proposed copy, part one: factual corrections

Each block replaces the text it names; everything not named is unchanged.
Section 10 gives the source for every capability claim.

### 4.1 The thesis block

Replace:

> gates (not optimism) refuse anything that drifts from the contract.

with:

> gates (not optimism) refuse a change that drifts from the spec that
> authorised it.

Replace, in "The thesis":

> a hash-verifiable contract that machinery enforces at PR time and at run
> time.

with:

> a hash-verifiable contract. Machinery enforces it at pull-request time
> today, through `spec-spine couple`; enforcing it at run time is what the
> control plane is being built to do.

Replace:

> everything between them is enforced, reconciled, and signed by code.

with:

> everything between them is enforced and recorded by code.

Replace:

> The result is delivery you can hand to an auditor: every change bound to the
> spec that authorised it, every run emitting a certificate anyone can verify
> offline.

with:

> What it is built to produce is independently verifiable evidence: a change
> bound to the spec that authorised it, and a run record a third party can
> re-check offline without trusting whoever produced it. Evidence records what
> a named verifier observed at a named revision. It is not a compliance
> verdict, and nothing here decides one for you.

### 4.2 statecraft

Drop the Rust badge, keep TypeScript. The napi addons moved to the
`statecrafting` repository, and GitHub's language breakdown for the tree
reports TypeScript and no Rust; the badge is a claim about this repository
and it is no longer true of it. Keep the paragraph. Append:

> **Implemented:** the app shell, Postgres adoption, tenants, the factory, the
> fleet, the governance web app, the attestation ledger, the admin frontend
> and the agent harness (its specs 002 to 008, 012 and 013). Control-plane
> deploy, the cluster and tenant lifecycle are in progress (009 to 011).
>
> **Hosted:** no hosted service is open for sign-up. Nothing in **Start here**
> needs one.

### 4.3 statecraft-cli

Add a TypeScript badge beside the Rust badge. Replace the paragraph with:

> The family's local tooling, in one repository. `statecraft` is the CLI for
> humans and an MCP server for agents over the same governance verbs, so a
> coding agent requests approvals, checks spec-code coupling and drives stages
> through the controls a person passes through rather than around them. Since
> 2026-09-09 the repository is also the monorepo for the family's tooling (its
> spec 110): the local run engine, the sensors, the Claude and Codex drivers,
> the contract and journal crates and a local React interface live under
> `members/` and `crates/`, and `statecraft <member>` dispatches to them.
>
> **Implemented:** the CLI and MCP server, member dispatch, the governed
> harness, and the local run floor: candidate worktrees, acceptance receipts,
> the action broker and the credential fence (its specs 101 to 125). Receipts
> are hash-chained journal records and are not signed (its spec 121).
>
> **Released:** `statecraft` v0.1.0 (July 2026), installed by `install.sh` on
> macOS and Linux or from a `.zip` on Windows. Every archive ships a
> `.sha256`, a CycloneDX SBOM and a build-provenance attestation. That release
> predates the monorepo: it carries the hosted-plane verbs and the MCP server,
> not the local engine, drivers or interface. Packaging those for a clean
> install is a draft (130).

### 4.4 spec-spine

Keep the paragraph. Append:

> It stands alone: it governs repositories that use nothing else in this
> family, and it needs no account and no server. Every other repository on
> this page carries its own spec corpus and runs its coupling gate in CI,
> except the three primitives noted below.
>
> **Released:** 0.18.0 on crates.io (`spec-spine-cli`), npm and PyPI, with
> prebuilt binaries on its GitHub releases. A corpus attestation can be sealed
> with an Ed25519 key you hold (`spec-spine attest --sign`, its spec 023); a
> valid seal says that key signed those bytes, not that the key is trusted or
> the corpus correct.

### 4.5 enrahitu: the facts, whichever way D-3 goes

Append to the entry:

> **Implemented:** the single-container application with its own identity
> provider and in-process state, the chassis boundary that leaves `app/` to
> the organisation across upgrades, the membership core and application mail
> (its specs 002, 005, 007, 035, 036 and 037). The versioned `template.toml`
> contract is in progress (009) and board governance is pending (038).
>
> **Released:** no installable artifact this page can point to yet. Its
> README and operations guide describe the container.

The **Released:** line rests on a negative reading, and section 8 C-1 records
the check behind it: on 2026-09-12 an anonymous pull of
`ghcr.io/statecrafting/enrahitu` was refused, while the same token and
manifest requests against a known public image succeeded. The page therefore makes no claim that the
container is publicly available (PROF-04). Naming an image here later is a
change to this line, with its evidence.

### 4.6 The tenant toolkit

Append after `tenant-tail`'s paragraph, once for the group:

> **Released:** `tenant-emit` and `tenant-tail` on npm and PyPI, and as
> binaries on each repository's GitHub releases.

### 4.7 The primitives

Insert directly under `### The primitives`:

> Rust libraries. `trust-window` and `canonical-keysort-json` are released on
> crates.io; `action-gate` and `attest-ledger` are tagged `v0.1.0` on GitHub
> and are not on crates.io. `action-gate`, `attest-ledger` and `trust-window`
> each carry only a draft bootstrap spec and run no coupling gate yet;
> `canonical-keysort-json` is governed like the rest of the family.

In `attest-ledger`'s paragraph, replace:

> A tamper-evident record ledger: append-only, hash-linked, Ed25519-signed,
> with an independent verifier that does not trust its producer.

with:

> A tamper-evident record ledger library: append-only and hash-linked, with
> Ed25519 signing and an independent verifier that does not trust its
> producer.

### 4.8 statecrafting

Replace the last sentence of the paragraph with:

> Three licenses coexist here, each declared in the package's own manifest
> and `LICENSE` file: `@statecrafting/toolchain`, `kernel-native` and
> `hiqlite-native` are Apache-2.0; `governance-native` and `fleet-native` are
> AGPL-3.0; and the three `@statecrafting/toolchain-<platform>` packages,
> which carry the vendored Encore build toolchain, are MPL-2.0.
>
> **Released:** every package is published on npm under `@statecrafting/*`.

### 4.9 The license section

Keep the heading `## Why these licenses` (section 8 D-6). Replace the body
with:

> Each license below is the one declared in that repository's `LICENSE` file
> or, in `statecrafting`, in each package's own manifest. What each requires:
>
> - **AGPL-3.0**: `statecraft`, and the `governance-native` and `fleet-native`
>   packages. Running it carries no condition. Distributing it, or offering a
>   modified version to users over a network, requires making the
>   corresponding source available to them under the same license.
> - **Apache-2.0**: the template, the CLI, the spine, the tenant toolkit, the
>   primitives, and the `toolchain`, `kernel-native` and `hiqlite-native`
>   packages. Redistribution keeps the license text and notices and marks the
>   files that were changed.
> - **MPL-2.0**: the three `@statecrafting/toolchain-<platform>` packages.
>   Distributing them requires making the source of those MPL-covered files
>   available under MPL-2.0, including any changes to them; other code in the
>   same application keeps its own license.
>
> The split is deliberate: the control plane carries the network-use
> condition, and the building blocks an application consumes do not. This
> section summarises license terms. It is not legal advice, and no license
> here is a warranty.

The roster step (3.6) inserts "the chassis" after "the spine" in the
Apache-2.0 line, in the same change that lists rahi. `hqgit` is not named
(D-2).

## 5. Proposed copy, part two: new blocks that need no thesis or roster decision

### 5.1 Start here, between the thesis and the projects

> ## Start here
>
> Nothing in this block needs an account, a hosted service, or a change of
> runtime. spec-spine installs into a repository you already have:
>
> ```sh
> cargo install spec-spine-cli
> spec-spine init      # scaffolds spec-spine.toml, standards/, specs/000-bootstrap
> spec-spine compile && spec-spine index && spec-spine lint
> ```
>
> It is also on npm (`npm i -D spec-spine`, then `npx spec-spine`) and PyPI
> (`pip install spec-spine`). Write a spec that claims the files it governs,
> run `spec-spine couple` on pull requests, and a change to a claimed file
> without an edit to its owning spec is refused. The full walkthrough is
> [spec-spine's adoption guide](https://github.com/statecrafting/spec-spine/blob/main/docs/adoption-guide.md).
> The repository that renders this page is governed the same way.

The first command is the site's own (`INSTALL_COMMAND` in statecraft.ing
`app/lib/get-started.ts`), so the two surfaces send a reader to the same
place. `statecraft-cli`'s `install.sh` is not offered here: its release does
not yet carry the local engine (section 4.3). Section 8 D-4 records the
choice, and section 11 run 1 records the path exercised from each of the
three registries the block names.

### 5.2 The key, immediately under `## Projects`

> Each entry keeps three facts apart. **Implemented** means the owning specs
> in that repository are complete. **Released** means a version you can
> install without a source checkout. **Hosted** means a service you can sign
> up for, and there is none yet. Implemented is not released, and none of the
> three means supported or proven in production. A draft is a proposal and is
> named as one. Every repository here has its own spec corpus, and
> `spec-spine registry plan` run there is the live answer.

## 6. Proposed copy, part three: copy a recorded decision releases

Each block names the decision in section 8 that releases it and the landing
step in section 3.6 it belongs to.

### 6.1 rahi (D-2, roster step): a new group, "The chassis", after "The template"

Lands in the same publication window as statecraft.ing's change that lists
rahi, not before it.

> #### [rahi](https://github.com/statecrafting/rahi)
> ![License](https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square)
> ![Rust](https://img.shields.io/badge/-Rust-000?style=flat-square&logo=rust)
>
> A Rust library chassis for a governed cell. It supplies identity (rauthy,
> co-deployed, reached only through the app's own origin), replicated state
> (hiqlite, in-process), a hash-chained decision ledger, a deny-by-default
> capability kernel, an axum edge with probes, metrics and tracing,
> operational verbs for preflight, migrate, backup and restore, single-container
> packaging, and a dev substrate that boots the real binary in tests. An
> application composes the crates and declares a manifest. The name is the
> lineage: enrahitu was Encore, rauthy, hiqlite, Turso; drop Encore and Turso
> and this is what remains.
>
> **Nothing else on this page requires it.**
>
> **Implemented:** the chassis crates, the operational verbs, single-container
> packaging, cluster topology, the dev substrate and the `hello-cell`
> reference application (its specs 010 to 034).
>
> **Released:** not yet; there is no published crate or release.

In the lead step, and only once G-03 is recorded (D-1), append to the
paragraph:

> It is the planned substrate for Statecraft's hosted service. Applications
> built with anything else on this page do not need to adopt it.

### 6.2 hqgit: withdrawn (D-2)

D-2 keeps `hqgit` off both public surfaces for now, so the entry this section
proposed on 2026-09-12 is withdrawn and the page does not link it. Listing
`hqgit` later is its own change, made on this page and statecraft.ing
together.

### 6.3 enrahitu's paragraph (D-3, corrections step)

Replace the paragraph with:

> A membership and association management platform that organisations
> self-host and extend rather than fork: members, tiers, renewals, dues,
> events, volunteers, documents and board governance. One container and one
> volume is the whole deployment: typed Encore.ts APIs, rauthy as the
> organisation's own identity provider, and hiqlite in-process, with no
> managed-infrastructure dependency. **EnRaHiTu** is the stack it began as:
> **En**core.ts + **ra**uthy + **hi**qlite + **Tu**rso/libSQL. It began as the
> template chassis the Statecraft factory stamps, and the versioned
> `template.toml` contract that serves that role is still in progress (its
> spec 009).

The **Implemented:** and **Released:** lines of section 4.5 follow it
unchanged. The mermaid label `enrahitu · the template chassis` stays: the
diagram draws Statecraft's approved thesis (its spec 001), in which that is
still enrahitu's role.

### 6.4 The lead (D-1, lead step): waits on G-03

G-03 adopts existing-repositories-first as Statecraft's thesis, through
statecraft's spec 014 and its amendment to 001. It counts as recorded when
that approval is on statecraft's GitHub default branch: the front door cites
evidence a reader can reach (3.2). On 2026-09-12 it is not. statecraft's
`main` is `9658e29`, and 014 sits on a local branch that is not on GitHub.

Once it is recorded, the heading line
`### Governed software delivery for the agentic era` becomes:

> ### Governed delivery for the repositories you already have

and the paragraph beneath the thesis line adds, after "Stop reviewing
output; start constraining intent.":

> Local use needs no account; a hosted team layer is planned.

The thesis line itself stays, because 001's `## Verification` reads it. A
successor thesis that retires stamping also changes the two-plane diagram,
which 001 section 3.1 item 2 requires; that is a further amendment to 001 and
not this spec's to make.

## 7. Out of scope

- **The mermaid diagram.** It draws the two-plane design, which is still
  Statecraft's approved design (its spec 001 section 3). rahi and hqgit are
  not in it, and adding them is a picture of a proposal rather than of the
  system.
- **statecraft.ing.** A different property and a different corpus (001
  section 4). Section 9 records what this spec asks of it; it changes nothing
  there.
- **Any repository not named in sections 4 to 6**: `chancery`,
  `claude-observatory`, `Frame`, `aicortex`, `butler-ai`, `cold-bore`,
  `icebeek`, and the archived repositories. Listing or retiring any of them is
  its own decision.
- **Community health files.** Still unwritten, still a spec each (001
  section 2).
- **`profile/artifacts/statecraft-ing-logo.jpg`.** On disk, referenced by
  neither rendered surface. Using it or removing it is a change to 001's
  imagery territory (its section 3.4) and is not this spec's to make.
- **Security posture of the local engine.** `statecraft-cli` drafts 128 and
  129 concern the local daemon's origin and credential boundaries. The page
  does not invite anyone to run the unreleased engine, and it does not
  describe those drafts.

## 8. Decisions

This spec was `draft` while these were open, and none was an agent's to
settle. The owner decided them on 2026-09-12 by adopting rows PROF-01 to
PROF-04 of the revision-4 decision package (`07-revision-4-decision-package.md`,
section 3), which cite that package's decisions G-03 and G-12. Each entry
keeps the proposal it answered.

- **D-1. The lead and the successor thesis.** Proposal: keep the current
  thesis-first lead and heading until Statecraft records adoption of a
  successor thesis in its own governing corpus. Then land section 6.4 and the
  rahi substrate sentence of 6.1 in the same change, with a follow-up spec for
  the diagram.
  **Decided (PROF-01):** update the lead once G-03 is recorded. Until then the
  current lead and heading stay. Section 6.4 says what "recorded" means here.
  The diagram change a successor thesis requires is a further amendment to
  001, not this spec's.
- **D-2. The roster.** 001 section 3.2 says a repository that is not listed is
  not part of the family's public story, and statecraft.ing's roster (its spec
  003) must move with this page. Proposal: add `rahi` (6.1 without the
  substrate sentence) on both surfaces together, and hold `hqgit` off both.
  **Decided (PROF-01):** add rahi with the site and omit hqgit. The roster
  step (3.6) lands in statecraft.ing's publication window; corrections do not
  wait for it. Section 6.2 is withdrawn.
- **D-3. enrahitu's first sentence.** Proposal: lead with the membership
  platform (its README's own first sentence, and its spec 035), with the
  chassis history second and the template contract named as in progress.
  **Decided (PROF-01):** as proposed (6.3), in the corrections step.
- **D-4. The adoption path.** Proposal: `cargo install spec-spine-cli`, then
  `spec-spine init` (5.1), matching the site's `INSTALL_COMMAND`. Revisit
  `statecraft-cli`'s `install.sh` as a second path only when a release carries
  the local engine and its draft 130's clean-machine job has passed.
  **Decided (PROF-02):** spec-spine installation followed by `init`. The page
  does not equate the `statecraft-cli` v0.1.0 release with the local engine
  (4.3). The tested installation is recorded in section 11 run 1, and an
  install that was already on the machine is not called a clean install.
- **D-5. The `extends` edge.** This spec claims superseding authority over a
  unit spec 001 owns, which the `/spec` skill makes a human checkpoint.
  Proposal: grant it by approving this spec.
  **Decided (PROF-03):** approved. The edge stands as declared, and this spec
  is approved with it.
- **D-6. The license heading.** Proposal: keep `## Why these licenses` with
  the factual body of 4.9, so 001's `## Verification` stays green without
  touching an approved spec.
  **Decided (PROF-03):** keep the exact heading. 001's heading test is not
  amended, and both 001's and this spec's verification blocks run on the
  change (section 11 run 4).
- **D-7. The shared vocabulary.** Proposal: statecraft.ing and this page adopt
  section 3.2's labels and the site's nouns (3.7).
  **Decided (PROF-02):** adopt G-12. The site states implemented, released,
  exercised and hosted separately; this page uses the compact implemented,
  released and hosted (3.2). No single available or shipped label is inferred
  from spec completion, and a public positive claim needs evidence a reader
  can reach.
- **C-1. A check, not a choice.** Whether `ghcr.io/statecrafting/enrahitu` is
  publicly available.
  **Checked (PROF-04), 2026-09-12:** it is not anonymously pullable. The
  anonymous token request returned 401 and the manifest and tag reads
  returned 403, while the same token and manifest requests against a known
  public image both succeeded (section 11 run 5). Whether the image is
  private or absent is not distinguishable anonymously, and it does not need
  to be. The page makes no public-availability claim, and 4.5's
  **Released:** line stands as the negative reading.

## 9. What this asks of other repositories

Requests, not changes. Nothing here is edited by this spec or by the session
that wrote it.

- **statecraft.ing.**
  1. Its request T-13 asked which vocabulary this page settles on. G-12
     answers it: the site's nouns and its six phrases to avoid, as written;
     implemented, released, exercised and hosted as separate facts on the
     site, with exercise evidence naming its environment and limits; the
     compact three on this page; and "available" as a label on neither.
  2. Its spec 003 licensing note still says the `statecrafting` packages are
     Apache-2.0 with "two AGPL-3.0 per-package licenses"; it omits the three
     MPL-2.0 toolchain platform packages, the defect 3.4 fixes here.
  3. Its safe sentence 3 ("every family verifier reports integrity and issuer
     trust as separate outcomes") is not yet true: `statecraft-cli` receipts
     are unsigned and the verdict dimensions are not agreed across the family.
     Hold it until they are.
  4. Its get-started step "Run the enrahitu substrate" depends on C-1, which
     found the image not anonymously pullable on 2026-09-12.
  5. rahi lands on both surfaces in the same window (D-2), and hqgit stays
     off both. This page's roster step waits for the site's.
- **statecraft-cli.** Its README's Status paragraph names milestone M4 and
  specs 102 to 110, and its Install section does not say that v0.1.0 predates
  member dispatch. Either note it there or cut a release that carries the
  members; 4.3 is written from the release, not the README.
- **rahi.** Its README says wave 3 is not started while its specs 030 to 034
  are complete, points at `bartekus/claude-observatory` (retired into
  `statecraft-cli`), and opens by calling it "the substrate the statecrafting
  products stand on", which Statecraft's approved thesis does not yet say.
- **hqgit.** Its README and this spec agree that it is specified and not
  built. Its build instructions carry the same stale `claude-observatory`
  pointer.
- **enrahitu, tenant-emit, tenant-tail.** `spec-spine check` at 0.18.0 reports
  each committed spec registry stale. `tenant-tail`'s three verifier specs are
  `status: draft` with `implementation: complete` while the code they govern
  is released. C-1 is enrahitu's.
- **action-gate, attest-ledger, trust-window.** Each carries a draft bootstrap
  spec, no committed shards and no coupling gate. 4.7 says so; adopting the
  spine there is each repository's own work.
- **spec-spine.** Nothing for this page. Its realignment specs 084 to 088
  stay off it (3.5), including 085, which is implemented but in no release.

## 10. Sources

Every capability claim in sections 4 to 6, and where it was checked. Revisions
are each repository's GitHub default branch on 2026-09-12. Lifecycle was read
with `spec-spine registry list --repo` (0.18.0) and the specs' own
frontmatter, never by parsing `.derived/`. Every cited revision was re-read
against GitHub at 22:57 UTC that day. Twelve were unchanged. spec-spine had
moved to `59cba05` (specs 085 and 089 ratified, 085 implemented), and
statecrafting had moved to `35126be` (a draft spec 009, no package manifest
touched). Neither move changes a claim on the page.

| Claim | Source |
|---|---|
| statecraft: TypeScript, no Rust | GitHub languages API, `statecrafting/statecraft` |
| statecraft: 002 to 008, 012, 013 complete; 009 to 011 in progress | statecraft `9658e29`, registry |
| statecraft: no hosted service open for sign-up | statecraft `README.md` and specs 009 to 011 (deploy in progress); no sign-up surface on statecraft.ing |
| statecraft-cli: monorepo since 2026-09-09; members, drivers, crates | statecraft-cli `874766b`, spec 110, `README.md`, `members/web/package.json` (React 19) |
| statecraft-cli: 101 to 125 complete; 126 to 132 draft | statecraft-cli `874766b`, registry |
| statecraft-cli: receipts not signed | statecraft-cli spec 121 D-3 |
| statecraft-cli: v0.1.0 assets, checksum, SBOM, attestation | GitHub release `v0.1.0` (2026-07-22); section 11 run 3 |
| statecraft-cli: v0.1.0 has no member verbs | `statecraft --help` of the v0.1.0 darwin-arm64 archive (section 11 run 3) |
| spec-spine: stands alone, no account; the Start here path | section 11 run 1 |
| spec-spine: 0.18.0 on crates.io, npm, PyPI; release binaries | crates.io, npm and PyPI APIs, each reporting 0.18.0 as latest at 22:55 UTC; GitHub release `v0.18.0` (15 assets); section 11 run 1 installed from all three |
| spec-spine: `attest --sign`, Ed25519, spec 023 complete | `spec-spine attest --help`; spec 023 frontmatter at spec-spine `59cba05`; section 11 run 2 |
| coupling gate in CI everywhere except three primitives | each repository's `.github/workflows/` at its default branch |
| enrahitu: 002, 005, 007, 035, 036, 037 complete; 009 in progress; 038 pending | enrahitu `26c75e2`, spec frontmatter (its committed registry is stale) |
| enrahitu: membership platform; `app/` boundary | enrahitu `README.md`; spec 035 |
| enrahitu: no installable artifact to point to | GitHub release `v0.2.0`, its latest, has no assets; anonymous `ghcr.io` pull refused, with a positive control (C-1, section 11 run 5) |
| tenant-emit, tenant-tail: npm, PyPI, release binaries | npm and PyPI APIs (0.3.0, 0.4.0); GitHub releases |
| primitives: crates.io presence; tags | crates.io API; GitHub releases `v0.1.0` |
| primitives: draft bootstrap only, no gate | each repository's `specs/000-*` frontmatter; no `couple` in its workflows |
| attest-ledger: signing is a library capability | attest-ledger `README.md`; statecraft.ing 006 section 3.4 |
| statecrafting: per-package licenses | each package's `package.json` and `LICENSE`, statecrafting `844ac86` (no package file changed by `35126be`); npm registry `license` fields |
| statecrafting: every package on npm | npm registry, all eight `@statecrafting/*` names |
| rahi: responsibilities, lineage | rahi `c13cc70` `README.md`, spec 002 |
| rahi: 010 to 034 complete; 000 and 002 n-a | rahi `c13cc70`, registry |
| rahi: no release | no GitHub release; crates.io reports no `rahi` crate |
| G-03 not yet recorded | statecraft `main` at `9658e29`; no `014` branch on its GitHub remote |
| AGPL-3.0, Apache-2.0 per repository | GitHub license detection for each repository, matching its `LICENSE` |
| site install command | statecraft.ing `f074586`, `app/lib/get-started.ts` |

## 11. What was run

Every run below is in a scratch directory outside any checkout, on
2026-09-12, with spec-spine 0.18.0.

1. **The adoption path, installed from each registry, and its negative case.**
   Each install went into empty scratch space on the operator's macOS arm64
   workstation between 22:55 and 22:57 UTC. None of them is a clean-machine
   install: Rust 1.96, Node 24 and Python 3.14 were already present, and
   cargo's local registry cache supplied most dependency sources. None used
   the `spec-spine` already on the operator's `PATH`; each run resolved the
   binary its own install produced.
   - **crates.io:** `cargo install spec-spine-cli`, into an empty `--root`
     with a fresh target directory, built `spec-spine-cli` 0.18.0 (exit 0).
     The run's `PATH` held only that root and the system directories, so the
     bare `spec-spine` of the Start here block resolved to it.
   - **npm:** `npm i -D spec-spine`, in an empty package with an empty cache
     (exit 0). `spec-spine` was then not on `PATH`, and
     `npx --no-install spec-spine --version` printed 0.18.0. The run invoked
     `node_modules/.bin/spec-spine`, the file `npx` resolves.
   - **PyPI:** `pip install --no-cache-dir spec-spine`, in a new virtual
     environment, installed the 0.18.0 macOS arm64 wheel (exit 0).

   With each of the three binaries, in an empty Git repository:
   `spec-spine init`, `compile`, `index`, `lint` and `registry list`, all
   exit 0. A spec claiming one file, committed as the base. A branch that
   changes the file without touching the spec:
   `spec-spine couple --base main --head HEAD` exits 1 with
   `C-001 'greeting.txt' changed without an authoring edit to any owning spec (001-greeting)`.
   The positive control, the same change plus an authoring edit to the spec:
   exits 0, "2 path(s) checked, no drift". All three gave identical results.
   Not exercised: Linux, Windows, and a machine without a toolchain.
2. **The attestation seal, and its negative cases.** With the operator's
   previously installed 0.18.0 binary: `spec-spine attest
   --sign` with a fresh Ed25519 key: exit 0. `verify-attestation --recompute
   --signature` with the signer's public key: `MATCH`, `VALID`, exit 0. With a
   different key: `INVALID`, exit 1. With one field of the attestation changed
   after sealing: `--signature` `INVALID`, exit 1; `--recompute` `CONTENT
   MISMATCH`, exit 1. This exercises the seal only; it does not test the
   recomputation gaps described by spec-spine's 085 (implemented after
   0.18.0, in no release) and draft 086.
3. **The statecraft-cli release.** The v0.1.0 darwin-arm64 archive: `.sha256`
   check exit 0; `gh attestation verify --repo statecrafting/statecraft-cli`
   exit 0, SLSA provenance v1, signer `release.yml@refs/tags/v0.1.0`. The same
   archive with one byte appended: checksum mismatch, and attestation lookup
   exit 1 (no attestation for that digest). `statecraft --help` lists
   `login`, `whoami`, `tenants`, `stamp`, `fleet`, `template`, `mcp`,
   `version`, `config`, `completions`, and no member verb.
4. **This verification block against the live page, and against the proposed
   page.** The block must fail on today's `profile/README.md` and pass on the
   page after the corrections step and after the roster step, with 001's block
   passing on all three. Single-fault mutants of the proposed pages must each
   fail this block at the command that guards the fault. Recorded when the
   corrections step is built (section 13).
5. **The enrahitu container (C-1).** At 22:55 UTC, with no credentials, the
   registry token endpoint for `repository:statecrafting/enrahitu:pull`
   returned 401 `UNAUTHORIZED`, and the `latest` manifest and tag list reads
   returned 403 `DENIED`. The GitHub package page for it returned 404 to an
   anonymous request. The positive control, the same token and manifest
   requests for `home-assistant/home-assistant`, returned 200 with a token and
   200 for the manifest. The enrahitu repository's latest release, `v0.2.0`,
   has no assets. The operator's GitHub token lacks `read:packages`, so the
   package's visibility setting was not read; public accessibility is what
   the page would claim, and that is what was tested.

## 12. Revision history

- **2026-09-11.** Drafted.
- **2026-09-12.** Revised against the revision-3 packet
  (`09-statecrafting-profile.md`) and each sibling's default branch.
  Superseded from the first draft:
  1. "Built means approved and implementation complete", and the single
     **Available:** line: replaced by the four labels of 3.2.
  2. rahi "all 22 specs approved and built": 20 are implemented and 2 are
     records (`n-a`). hqgit "68 approved specs": its harness is implemented,
     three are records, and the product specs are pending. The copy now
     carries no counts.
  3. enrahitu "the platform and the template contract are built": the
     template contract (009) is in progress and board governance (038) is
     pending.
  4. statecraft-cli's release sentence sat beside the implemented list as if
     it installed that list; v0.1.0 predates specs 108 and 110.
  5. "The pull-request half runs today, in every repository below", and
     spec-spine "governs every repository listed": false for `action-gate`,
     `attest-ledger` and `trust-window`.
  6. "Nothing below needs an account": the released CLI's hosted verbs need a
     plane, so the sentence is scoped to the block.
  7. The install line offered three installers as if each yielded
     `spec-spine` on `PATH`; the npm install yields `npx spec-spine`.
  8. The license heading rename, which would have failed 001's verification.
  9. `! grep -qF 'refuse anything that drifts'` passed against the live page,
     because the phrase breaks across two lines there; the check is now on
     `refuse anything`.
  10. "Signed by code" was not addressed; it is now (4.1).
  11. 3.5's table: the spec-spine drafts were uncommitted and are now merged
      as drafts; the CLI evaluation is merged.
  12. "The corpus that governs this page was started exactly that way" was not
      checkable; replaced with a statement that is.
  13. statecrafting's "existing consumers are unaffected" and rahi's "an
      alternative to the Encore.ts template" had no source; removed.
  14. rahi, hqgit, enrahitu's first sentence and the lead moved from the
      copy into section 6, behind the decisions that release them.
- **2026-09-12, later.** Revised against the owner's decisions PROF-01 to
  PROF-04 (section 8), before ratification. Changed:
  1. Section 8 records each decision beside the proposal it answered.
  2. G-12's compact vocabulary: three labels, and **Specification only.**
     dropped with `hqgit` (3.2). A new rule: a positive line cites evidence a
     reader can reach.
  3. The three landing steps (3.6): corrections, the roster with the site,
     and the lead after G-03.
  4. 6.2 withdrawn, `hqgit` removed from 4.9, and 6.4 defines when G-03
     counts as recorded.
  5. Run 1 replaced. The earlier run used a binary already on the machine
     and no install; the new run installs from crates.io, npm and PyPI and
     exercises each binary.
  6. C-1 checked with a positive control (run 5). No public-availability
     claim.
  7. 3.5 and section 10 refreshed where spec-spine and statecrafting had
     moved on their default branches.
  8. Verification: `hqgit` must be absent, a listed rahi is checked inside
     its own entry, enrahitu leads with the membership platform, and the
     enrahitu image is not named.

## 13. Implementation notes

None yet. Dated notes on what each landing step did, and what remains, go
here.

## Verification

```verify:cli
# 3.1 item 3: the adoption path exists, sits above the projects, and needs nothing hosted.
grep -qF '## Start here' profile/README.md
grep -qF 'cargo install spec-spine-cli' profile/README.md
grep -qF 'spec-spine init' profile/README.md
awk '/^## Start here/{s=NR} /^## Projects/{p=NR} END{exit !(s>0 && p>0 && s<p)}' profile/README.md
grep -qF 'Nothing in this block needs an account' profile/README.md
# 3.2: implementation and release are separate facts, and no whole-repository verdict is given.
grep -qF '**Implemented:**' profile/README.md
grep -qF '**Released:**' profile/README.md
grep -qF '**Hosted:**' profile/README.md
! grep -qiE 'status: *(complete|shipped|ga)|generally available|production-ready' profile/README.md
! grep -qF '**Available:**' profile/README.md
# 3.3: the evidence claim is bounded, the unbounded ones are gone, and unsigned is said.
grep -qF 'independently verifiable evidence' profile/README.md
! grep -qF 'hand to an auditor' profile/README.md
! grep -qF 'refuse anything' profile/README.md
! grep -qF 'signed by code' profile/README.md
awk '/^#### \[statecraft-cli\]/{f=1;next} /^###/{f=0} f' profile/README.md | grep -qF 'not signed'
# 3.4: every shipping license is named, and no license is said to prevent or guarantee anything.
grep -qF 'MPL-2.0' profile/README.md
grep -qF 'AGPL-3.0' profile/README.md
grep -qF 'Apache-2.0' profile/README.md
! grep -qiE 'prevent|guarantee' profile/README.md
# 3.5: the unratified realignment is not on the page.
! grep -qiE 'AuthoritySnapshot|WorkPermit|ContextClosure|WorkScope' profile/README.md
# 4.2: the statecraft entry no longer claims a language its tree does not have.
! awk '/^#### \[statecraft\]/{f=1;next} /^###/{f=0} f' profile/README.md | grep -qF 'logo=rust'
# 4.3: the CLI's release is not presented as carrying the local engine.
awk '/^#### \[statecraft-cli\]/{f=1;next} /^###/{f=0} f' profile/README.md | grep -qF 'predates the monorepo'
# 4.7: the three primitives without a gate are not described as governed.
awk '/^### The primitives/{f=1;next} /^### /{f=0} f' profile/README.md | grep -qF 'draft bootstrap spec'
# 4.5, C-1: no public-availability claim for an image anonymous pull refused.
! grep -qF 'ghcr.io/statecrafting/enrahitu' profile/README.md
# 6.1, D-2: before and after the roster step, a listed rahi says in its own entry that nothing needs it.
! grep -qF 'github.com/statecrafting/rahi' profile/README.md || awk '/^#### \[rahi\]/{f=1;next} /^###/{f=0} f' profile/README.md | grep -qF 'Nothing else on this page requires it'
# 6.2, D-2: hqgit is not listed.
! grep -qF 'github.com/statecrafting/hqgit' profile/README.md
# 6.3, D-3: enrahitu leads with the membership platform.
awk '/^#### \[enrahitu\]/{f=1;next} /^###/{f=0} f' profile/README.md | grep -qF 'A membership and association management platform'
# 2: every line 001's own verification reads is still true.
grep -qF 'AI can write the code' profile/README.md
grep -q '```mermaid' profile/README.md
grep -qF '## Projects' profile/README.md
grep -qF '## Why these licenses' profile/README.md
grep -qF '](artifacts/statecraft-github-banner.jpg)' profile/README.md
! grep -qF '## Projects' README.md
```
