---
id: "131-evidence-view"
title: "The evidence view: one account of a change, joined from the records a run already writes, with every gap labelled"
status: draft
created: "2026-09-11"
implementation: pending
risk: low
depends_on:
  - "121-candidate-and-receipt"
  - "122-action-broker"
  - "120-capability-contract"
  - "124-provider-conformance"
  - "125-credential-fence"
  - "129-gate-fence"
  - "132-evidence-fixtures"
  - "027-api-projects"
establishes:
  - "members/src/orchestrator/explain.ts"
  - "members/src/orchestrator/explain.test.ts"
extends:
  # 022 owns the API directory: the route, its view type and the client call.
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/types.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/api-client.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.test.ts", nature: additive }
  # 023 owns the engine's CLI: `explain <spec>`.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  # 029 owns the UI tree (as 038 extended it): the explanation panel.
  - { spec: "029-ui-projects", unit: "members/web/", nature: additive }
  # Doc 05 is the record this spec is born from (D65).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
summary: >
  Specs 119 to 125 made a run write the evidence a reviewer needs: gate
  commands and exit codes, a receipt with its suite and policy digests,
  denials, fence refusals, the capabilities a driver applied, degraded or
  refused, a provider's qualification, approvals, and the broker's intents,
  outcomes and refusals. No surface shows any of it: the UI's panels predate
  them, and the only verdict on screen is a project's qualification. This
  spec adds one read-only account per spec, reached by a verb, a route and a
  UI panel, folded from the existing journals and nothing else. Every value
  names the record it came from. Absence has three names and never reads as
  success: none (the run recorded that nothing happened), not recorded (no
  record of this kind exists, including every field a future scope, context
  or permit contract will add), and stale (a receipt for a head that is no
  longer the branch's). What a profile declared sits beside what a session
  says was applied, and a model's narrative is labelled as narrative, apart
  from what a machine observed.
---

# 131: The evidence view

## 1. Purpose

A reviewer asking "should this change be trusted" needs, today, to read two
hash-chained JSON files by hand. Everything they would ask is in them:

- which revision was judged, against which base, by which commands, with
  which exit codes, under which policy digest (`acceptance.receipt`, 121);
- whether the judged revision held still (`acceptance.unstable`) and whether
  the change touched what judges it (`acceptance.sensitive`);
- whether a harness refused anything (`stage.build.denials`, 119) and
  whether a session reached for a fenced tool (`fenceRefusals`, 125; and the
  gate's, 129);
- what the driver actually enforced (`session.init`'s `applied` and
  `degraded`, `driver.refused`, 120) and whether its binary was qualified
  (`driver.unqualified`, 124);
- who approved or forced what (`control.approve`, `control.forceHumanGate`,
  `control.nameSpec`, sealed decisions, 020);
- what was published, on which receipt, and what the broker refused
  (`broker.action`, `broker.refused`, 122), and what merged
  (`daemon.merge-sha`) and verified (`stage.verify.result`).

No verb, route or panel joins them. The web UI's seven panels were built
before 119 and show none of these records. This spec is the join. It adds no
record kind and changes no record; it reads.

The realignment asks for more than this (context closures, work permits, a
governance replay) and those depend on contracts no repository has agreed
(doc 05 §8). The view reserves their places and labels them `not recorded`,
so a reader sees the shape of what is missing rather than its absence.

## 2. Territory

- `members/src/orchestrator/explain.ts`: `explainSpec(records, decisions,
  registry, branchHead)`, a pure fold to `ExplainView`.
- `members/src/orchestrator/explain.test.ts`: its suite over fixture
  journals.
- `members/src/orchestrator/api/{server,types,api-client}.ts` (extends 022):
  `GET /api/projects/<name>/explain/<specId>`, the view type, the client call.
- `members/src/commands/orchestrator.ts` (extends 023): `explain <spec>
  [--project <name>] [--json]`.
- `members/web/` (extends 029): the explanation panel, opened from a spec's
  row in the DAG and history panels.

## 3. Behavior

### B-1. Every value carries its source

Each field of `ExplainView` is either a value with a source (the record's
kind, chain, `seq` and `recordHash`) or one of four labels. A reader can go
from any line of the view to the record that justifies it, and the export of
the same chains (031) carries the same hashes.

### B-2. Four labels, never collapsed

- `none`: the run recorded, explicitly, that nothing happened (a denial count
  of zero, a refusal tally of zero, an empty `degraded` list).
- `not recorded`: no record of the kind exists for this spec. A run that
  predates a spec (a build before 121 has no receipt) reads this way, and so
  does every reserved field of B-6.
- `stale`: a receipt whose candidate sha is not the branch's current head,
  or a qualification record for a binary version other than the one that
  ran.
- `unknown`: a fact the records cannot establish at all. Provider tool-event
  coverage is the standing case: neither driver proves it saw every tool
  call, so the view never claims a complete trace.

`none` and `not recorded` are the pair that matters. Rendering both as an
empty cell is the error this spec exists to prevent (125 D-3's rule, applied
to presentation).

### B-3. The sections

One view per spec, in this order: the spec (id, lifecycle status and
implementation from the registry, the pin the run built from); the candidate
(branch, base, the receipt's candidate and the branch's current head); each
build round (the gate's commands and exit codes, the gate's fence record,
denials, the session's driver, binary version, qualification, capabilities
applied, degraded and refused, and its fence refusals); acceptance (every
receipt with suite digest, policy digest, verifier version and sensitive
paths, the latest marked current or stale, and every unstable record);
authority (approvals, forced gates, named drafts, sealed decisions);
publication (each broker intent with its outcome, each refusal with its
reason, the pull request, the merge sha); and verification (verify's
result).

### B-4. Declared beside enforced

A section sets, side by side, what was declared and what the records say
was in force: the profile's posture and its `required` and `preferred`
tokens against `session.init`'s `applied` and `degraded` and any
`driver.refused`; the gate contract's digest against the receipt's policy
digest; the fence as the stage expected it against the gate's and the
session's fence records; and, once 126 lands, the sandbox policy against the
applied profile's digest. Where the two disagree the row says so. Where the
enforced side has no record the row reads `not recorded`, never `applied`.

### B-5. Narrative is labelled

Text a model produced (a session's result tail, a pull request body, a
review note's findings, 127) is shown under a `narrative` label and never in
the same column as an exit code or a digest. A model's statement that tests
pass is not a test result, and the view does not let it look like one.

### B-6. Reserved fields

`scope`, `contextClosure`, `permit` and `executionContext` are present in
every view and read `not recorded`, each with the one-line reason (for
example "no WorkScope contract: doc 05 D70"). When a later spec records one,
it fills the field; the view's shape does not change, and its version does
not move for an additive fill.

### B-7. One version, owned here

`ExplainView` carries `explainVersion: 1`. The route answers in 022's
envelope; the CLI's `--json` prints the same envelope. Adding a field is
additive; renaming or removing one moves the version.

## 4. Functional requirements

- **FR-001.** A fixture journal holding a full round (receipt, broker push,
  openPr and merge, one denial, one fence refusal, one degraded capability,
  one approval) folds to a view whose every value names a record that exists
  in the fixture with that `seq` and `recordHash`.
- **FR-002.** Labels: a journal from before 121 yields `not recorded` for
  acceptance; a round with an explicit zero denial count yields `none`; a
  receipt for a head the fixture's branch has moved past yields `stale`;
  tool-event coverage is `unknown` in every view.
- **FR-003.** Declared versus enforced: a profile requiring `max-turns` with
  a `session.init` that degraded it renders a disagreement row.
- **FR-004.** The route over real HTTP returns the same view the pure fold
  returns, and `explain <spec> --json` prints it in the envelope.
- **FR-005.** The UI panel renders each label distinctly (a browser
  assertion in the shape of 024's `verify:browser`), and renders narrative
  under its label.
- **FR-006.** Nothing is written: the chains' heads are unchanged after the
  fold, the route and the verb.
- **FR-007.** Coverage (D-6): a view over evidence whose report reads
  `signature: unsigned` and `issuerTrust: unknown`, and whose bundle carries an
  omitted field and an unbound withheld payload, renders each of the four by
  name; no surface renders a single verified value.

## 5. Acceptance

- `bun test` in `members/` is green; `make gate` and `make members` are
  green; `bun run web:build` succeeds.
- Over this repository's own journals, or a fixture project driven through a
  real round, `explain` answers for a spec that shipped through the broker,
  and every value it shows can be found by its hash in the journal file.

## Verification

```sh
cd members && bun test src/orchestrator/explain.test.ts
cd members && bun test src/orchestrator/api/server.test.ts
cd members && bun run web:build
make gate
```

## 6. Out of scope

- **New evidence.** The view reads what exists. What a session submitted to
  its provider, a work scope and a permit are doc 05 D69 and D70, each its
  own spec after the contract it depends on.
- **Verification of a bundle.** The view reads live chains; checking an
  exported bundle offline is 031's verb, and its outcomes are 132's.
- **Replay and shadow policy.** Doc 05 §11.
- **Judging.** The view states what the records say and where they are
  silent. It does not score a change, and it does not call one trusted.

## 7. Resolved decisions

D-1 (2026-09-11). A fold over the journals, not a new record. A second
record of the same facts would be a second authority that can disagree with
the first; the journal chain already is the authority (121 D49), and the
view is its projection, as every other read route is (022 B-6).

D-2 (2026-09-11). Four labels, not a nullable field. A `null` cannot say
which of "nothing happened", "nothing was recorded", "recorded for another
head" and "cannot be known" it means, and each calls for a different action
from a reviewer.

D-3 (2026-09-11). Reserved fields are present now. A field that appears only
when a later contract exists teaches a reader that its absence is normal;
one that is present and reads `not recorded` with a reason teaches the
opposite.

D-4 (2026-09-12; adopted by the owner the same day, D-6). Verification is shown as 132's report, never as a
badge. Where the view shows whether a run's evidence verifies, it renders the
four evidence dimensions of 132 B-7 with their values and reasons, and the
admission result apart from them; it never collapses them into "verified". This
is why 131 now depends on 132: the view follows the evidence contract rather
than inventing a display vocabulary for it first. The view's own four labels
(B-2) describe whether a record exists; the report's values describe what a
verifier concluded; the two are not mixed. Doc 05 D80.

D-5 (2026-09-12). A fence tally is labelled for what it can show. A gate or
session tally of zero reads `none` with the note that the tally records a
reach through `PATH` only (129 D-8), never "no attempt was made". (Amended
2026-09-12: 129 B-3 now counts at the supervisor, so a child can no longer
erase a tally; what a zero cannot show is unchanged.)

D-6 (2026-09-12, the owner). The adoption of revision 4's CLI-06 (doc 05
§19): the view renders 132's report after 132's schema freezes, and not
before, so it renders the frozen names (G-05's dimensions and `admission`)
rather than a draft's. Four kinds of incomplete coverage are each shown by
name wherever a report or a record carries them, and none is folded into its
neighbor: `unknown` (a check that did not run or could not answer),
`unsigned` (no signature carried), omitted (a field or payload withheld on
export) and unbound (a withheld payload whose commitment version 1 does not
bind, 132 B-3). There is no single verified badge, in the panel, the route
or the verb.

## Status (2026-09-12, amended)

Amended on 2026-09-12 to the owner's adoption of revision 4 (doc 05 §19,
CLI-06; D-6): D-4 adopted with `admission` for `policy`, D-5 corrected for
129 B-3, and the four coverage names. Still `draft`, `implementation:
pending`: it is built last, against 132's frozen report, and its flip to
`approved` is recorded in the change that dispatches it.

## Status (2026-09-12)

Authored `draft`, `implementation: pending`, from doc 05 D65 and the
packet's third action. It depends on 129 only for the gate's fence record,
and reads `not recorded` for it on journals written before 129.

Revised on 2026-09-12 from doc 05 §18 (D76, D80): a dependency on 132, whose
report the view renders, and the label for a fence tally. The UI this view
would join is `source-only` today (doc 05 D84): a compiled engine outside the
checkout answers its root with 503. Nothing is implemented, and approval is a
human flip.
