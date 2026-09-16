---
id: "127-pr-review-note"
title: "The review note: what the local cycle found, posted where the pull request can see it"
status: draft
created: "2026-09-10"
implementation: pending
depends_on:
  - "109-governed-harness"
  - "122-action-broker"
  - "017-stage-ship"
  - "018-stage-shepherd"
establishes:
  - "scripts/pr-note.py"
  - "scripts/pr-note.test.py"
  # The note's golden inputs and outputs, read by both renderers (D-8).
  - { kind: directory, path: "scripts/pr-note-fixtures/" }
  - "members/src/orchestrator/review-note.ts"
  - "members/src/orchestrator/review-note.test.ts"
extends:
  # 109 owns the harness: AGENTS.md "Working the backlog" gains the step that
  # posts the note, and the Makefile a target, the same shape 118 used.
  - { spec: "109-governed-harness", unit: "AGENTS.md", nature: additive }
  - { spec: "109-governed-harness", unit: { kind: section, file: "Makefile", anchor: "pr-note" }, nature: additive }
  # 122 owns the broker, which gains a fourth action, `note` (B-8).
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.ts", nature: additive }
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.test.ts", nature: additive }
  # 017 and 018 own the stages that open and update a pull request; the
  # proposal gains its optional `review` field and the note is posted after
  # openPr and after each remediation push.
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  # Doc 05 D62 is the revision this draft carries (2026-09-11).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
summary: >
  This repository reviews locally. `/code-review` runs in the session,
  before the push, and its findings never leave the terminal: the pull
  request shows three green checks and no reasoning. The checks UI already
  reports what CI can know, so the gap is not a CI summary but the thing
  only the session holds, namely what the review found, what was fixed and
  what was accepted. This spec adds one sticky comment per pull request,
  updated in place on every push, carrying the head sha, what changed, the
  gate verdicts that actually ran, and the review's findings with their
  disposition. The session writes the note's content; who posts it depends
  on where the session runs. An interactive session posts with the
  operator's own credentials. A driven session is fenced (125) and holds no
  publish credential, so it submits the review in its proposal and the
  engine's broker posts the note as a fourth action, admitted on the
  receipt and lease and journaled like a push. Machine results come from
  the receipt and are marked receipted; the review is marked narrative; the
  note names the head and the receipt it describes. It never invents a
  verdict, and failing to post it never blocks a ship.
---

# 127: The review note

## 1. Purpose

The governed loop reviews before it pushes. `/code-review` runs in the
session against the diff, the gate runs locally in the exact chain CI runs,
and a finding is either fixed or consciously accepted. None of that reaches
the pull request. A reviewer opening one sees three green checks, a title
and a body, and has no way to tell a change that was reviewed and had two
findings fixed from one that was pushed without a glance.

The obvious fix is the wrong one. A CI job that comments the gate results
restates what the checks UI already shows, and it cannot see the local
review at all, because the review happened on a machine CI never touches.
What is missing is not a second rendering of `pass`; it is the session's
own knowledge.

So the session writes it. One comment per pull request, updated in place,
written after each push from what the process that just did the work knows.

Who posts it is a separate question, and the first draft of this spec
answered it wrongly for half its readers. A comment on a pull request is a
publication, and in a driven run publication belongs to the broker (122):
the session proposes, the engine acts on a receipt and a lease, and every
effect is journaled. The driven session cannot post in any case, because
125 fenced it: `gh` refuses and git holds no credential. Had the first draft
been built, every driven run's note would have failed silently under B-5, and
a note that did reach GitHub through some other credential would have been an
effect with no receipt and no journal record, the thing 122 and 125 exist to
prevent. B-7 and B-8 route a driven session's note through the broker; an
interactive session, which holds the operator's own credentials and is not
fenced, keeps posting as the first draft said.

This spec also settles a question the repository has been carrying
silently: there is a `CLAUDE_CODE_OAUTH_TOKEN` secret and nothing uses it.
D-5 records the decision rather than leaving it as a gap.

## 2. Territory

- `scripts/pr-note.py`: the upsert. Builds the note from inputs it is given
  and posts or updates the single marked comment on a pull request.
- `scripts/pr-note.test.py`: its test, the shape 118's generator uses.
- `AGENTS.md` (extends 109): "Working the backlog" step 7 gains the note,
  so every agent that ships reads the instruction, not only Claude.
- `Makefile` (extends 109), target `pr-note`: the one invocation, so the
  command has a single definition the way `make gate` does.
- `scripts/pr-note-fixtures/`: golden inputs and the exact note each must
  render to, read by both renderers (D-8).
- `members/src/orchestrator/review-note.ts`: the engine's renderer and the
  parser for a proposal's `review` field (B-7).
- `members/src/orchestrator/review-note.test.ts`: its suite, over the same
  fixtures.
- `members/src/orchestrator/broker.ts` (extends 122): the `note` action
  (B-8).
- `members/src/orchestrator/stages/ship.ts` (extends 017) and
  `stages/shepherd.ts` (extends 018): the brokered ship prompt asks for the
  `review` field; the stage asks the broker for the note after `openPr`, and
  shepherd after each push it brokers.

## 3. Behavior

### B-1. One comment, found by marker, never a thread

The note carries an HTML marker (`<!-- statecraft:pr-note -->`) as its first
line. The script lists the pull request's issue comments, finds the one
whose body contains the marker, and `PATCH`es it; absent one, it `POST`s.

`gh pr comment --edit-last --create-if-none` exists and is deliberately not
used: it edits the *current user's last comment*, which on a pull request
where the session has also answered a review thread is the wrong comment.
D-1 records this. The marker makes the target explicit rather than
positional.

### B-2. What the note carries

In order:

- the head sha the note describes, the time it was written, and the receipt
  hash it rests on when there is one (B-9);
- **what this push changed**, one line, in the same voice as the commit;
- **machine results**, each command that actually ran with its exit code,
  under one of two labels that never mix. `receipted` when the lines are
  copied from an `acceptance.receipt` (the engine's path: the receipt's
  `results`, which the engine ran itself, 121); `reported by the session`
  when the session ran them and says so (the interactive path, where no
  receipt exists). In this repository that is `make gate` always, the cargo
  half when the diff touched `src/` or `tests/`, the bun half when it touched
  `members/`;
- **review findings (narrative)**: every `/code-review` finding as
  `file:line`, its severity, and its disposition, one of `fixed` (with the
  sha that fixed it), `accepted` (with the reason), or `deferred` (with where
  it went). The heading says what this section is: the reviewing model's
  account, which no machine verified. A finding is never promoted into the
  machine section, and an exit code is never restated as a finding.

### B-3. Absence is stated, never implied

A section with nothing to report says so. A review that found nothing reads
`no findings`; a review that did not run reads `not run`, and the two are
never collapsed. A gate half that did not apply reads `not applicable`, not
a blank.

This is 125 D-3's rule and kit 082's `not read` versus `none`, applied
here: a missing line must not read as an absence of findings to someone
deciding whether to look closer.

### B-4. The note never invents a verdict

The script reports the exit codes it is handed and the findings it is
handed. It does not run the gate, does not infer a result from a green
check, and has no opinion. A caller that passes nothing gets a note saying
nothing ran, which is the honest output for that input.

### B-5. Posting is not a gate

A failure to post the note (no network, no token, no pull request yet) is
reported and does not fail the ship. Visibility is worth having and is not
worth blocking a correct change over, and a ship stage that fails on a
comment would teach the next session to skip the step.

### B-6. The note carries no credential

The script writes only its given inputs and never echoes an environment
variable, a token, a remote URL with userinfo, or the contents of a file it
was not given. `pr-note.test.py` asserts it on a payload seeded with
token-shaped strings, and `review-note.test.ts` asserts the same for the
engine's renderer.

### B-7. A driven session submits the review; it does not post

The brokered ship prompt (122 B-1) asks for one more field in the proposal
the session already writes to the drop box: `review`, an object with `ran`
(boolean) and `findings` (each `{file, line, severity, summary,
disposition}` with the disposition's sha, reason or destination). It is
optional: a proposal without it is valid and its note reads `not run`, never
`no findings` (B-3). A malformed `review` is reported in the note as `not
readable` and does not fail the ship.

`pr-note.py` does not post from a fenced session. When `gh` exits 127 (the
fence's refusal, 125) it reports that the engine publishes the note from the
proposal and exits 0, and "Working the backlog" tells a driven session to
fill `review` instead of running `make pr-note`.

### B-8. The broker posts the note as its fourth action

`note` joins `push`, `openPr` and `merge` (122 B-2). It is admitted exactly
as `openPr` is, on the lease and a receipt covering the head, and refused on
the same grounds. It also requires the pull request's head to equal the
receipt's candidate sha (`pr-head-mismatch` otherwise), checks the body with
017's forbidden-marker rules, and performs B-1's marker upsert. It is
journaled as `broker.action` intent and outcome with the action, the target
`#<number>`, the head, the receipt hash and the SHA-256 of the body it
posted; the body itself is not journaled. The ship stage asks for it after
`openPr`; shepherd asks again after each push it brokers, with the new
receipt. A failed or refused note is journaled like any other outcome and,
by B-5, does not fail the stage.

### B-9. The note is bound to a head and says when it is stale

Every note names the head sha it describes and, on the broker's path, the
receipt hash its machine section came from. The renderer is given the pull
request's current head, and a note whose head is not that head leads with
`stale: describes <sha>, the pull request is at <sha>` rather than being
presented as current. The broker never posts a stale note (B-8's head
check); the interactive path can, and says so.

## 4. Functional requirements

- **FR-001.** Upsert: two runs against one pull request leave exactly one
  marked comment, the second body replacing the first.
- **FR-002.** Marker: a comment by the same user without the marker is
  never touched.
- **FR-003.** Absence: each of `no findings`, `not run` and `not applicable`
  renders distinctly (B-3).
- **FR-004.** Honesty: given no gate results, the note says nothing ran
  rather than omitting the section (B-4).
- **FR-005.** Non-blocking: a failing post exits non-zero from the script
  but `make pr-note` reports and returns success (B-5).
- **FR-006.** Redaction: token-shaped inputs do not appear in the body.
- **FR-007.** Two sections: given both a receipt and a review, the machine
  section is labelled `receipted` and names the receipt hash, the findings
  section is labelled narrative, and no line appears in both; given no
  receipt, the machine section is labelled `reported by the session`.
- **FR-008.** Parity: every fixture under `scripts/pr-note-fixtures/`
  renders byte-identically through `pr-note.py` and `review-note.ts`.
- **FR-009.** The broker's `note` (in `broker.test.ts`): refused without the
  lease, without a covering receipt, and when the pull request's head is not
  the receipt's candidate; an upsert over an existing marked comment patches
  it; intent and outcome are journaled with the body's digest and without
  its text.
- **FR-010.** Fenced: with a `gh` that exits 127, `make pr-note` reports that
  the engine publishes the note and returns success, and posts nothing.
- **FR-011.** Staleness: a note rendered for a head other than the pull
  request's current head leads with the `stale` line (B-9).

## 5. Acceptance

- `python3 scripts/pr-note.test.py` exits 0.
- `make gate` exits 0.
- A live round on this repository: two pushes to one pull request produce
  exactly **one** comment, whose final body names the second head sha and
  the findings of the review that ran before it.
- A round where the review found nothing shows `no findings`, and a round
  where it was skipped shows `not run`.
- With posting forced to fail, the ship stage still completes and the
  failure is reported in the session.
- A driven round, on a fixture project with a local bare remote and a fake
  GitHub client (122's live-smoke shape): the session fills `review`, the
  broker posts one marked note after `openPr`, and the journal shows
  `broker.action` intent and outcome for `note` with the receipt hash. A
  remediation push through shepherd updates the same comment, which then
  names the new head and the new receipt.
- `bun test` in `members/` is green.

## Verification

```sh
python3 scripts/pr-note.test.py
cd members && bun test src/orchestrator/review-note.test.ts
cd members && bun test src/orchestrator/broker.test.ts
make gate
```

## 6. Out of scope

- **A CI-side AI review.** See D-5.
- **Reviewing.** This spec transports a review's result; it does not review,
  and it changes nothing about `/code-review`.
- **The checks UI.** The note does not restate per-job pass and fail, which
  GitHub already renders better than a comment can.
- **Review threads.** Answering a reviewer stays `/shepherd`'s job on its
  own threads; the note is a one-way record and never a reply.
- **Any skill file.** 109 §3.1 requires every `SKILL.md` byte-identical to
  the kit, so the instruction lives in `AGENTS.md`, which is where this
  repository's project layer belongs.
- **Verifying the review.** B-2's narrative section is transported, not
  checked. Nothing here makes a model's finding into evidence; doc 05 D65's
  evidence view keeps the same separation.

## 7. Resolved decisions

D-1 (2026-09-10). Marker-based upsert, not `gh pr comment --edit-last`.
`--edit-last` (available in gh 2.73.0, with `--create-if-none`) targets the
current user's most recent comment, which is only the note when the session
has posted nothing else. A session that also comments on a pull request
would silently overwrite that instead. A marker names the target rather
than counting backwards from the end.

D-2 (2026-09-10; narrowed 2026-09-11 by D-6). The session posts, not CI. CI
cannot see the local review, which is the whole content worth adding; a CI
comment would restate the checks UI. The cost is that the step can be
skipped, which is why it lives in `AGENTS.md` "Working the backlog", read by
every agent, rather than in a skill that only one of them runs. "The session
posts" now holds for an interactive session only; a driven session's note is
posted by the broker (D-6).

D-3 (2026-09-10). Posting failures are reported, not fatal (B-5). The
alternative teaches the next session that the step is a hazard, and a
skipped step provides no visibility at all.

D-4 (2026-09-10). The note is not a substitute for the checks UI, and B-2
deliberately omits per-job status. Two renderings of the same fact drift,
and the one in the comment is the one that goes stale.

D-5 (2026-09-10). No CI-side AI review, and the decision is recorded here
because until now it existed only as a gap. This repository carries a
`CLAUDE_CODE_OAUTH_TOKEN` secret, added 2026-07-23, referenced by no
workflow: no `anthropics/claude-*` action appears anywhere under
`.github/`, and no spec or design document mentions one. The local cycle
reviews before the push, inside the loop that can act on a finding, and it
costs no CI minutes and no round trip. A CI review would arrive after the
push, restate what the session already knew, and lengthen every iteration.
The token is therefore left unused deliberately rather than by oversight.
Removing the secret is a separate operator action and is not required by
this spec; a later session that wants a CI review amends this decision
rather than discovering an unexplained secret and guessing.

D-6 (2026-09-11, proposed revision). A note is a publication, and a
driven session's publication is the broker's. 122 moved push, pull request
and merge to the engine so every effect is receipted, leased and journaled,
and 125 fenced the session so no other path works. A comment is the same kind
of effect on the same remote. Posting it from the session would either fail
under the fence (and, by B-5, silently) or succeed around it and leave no
record. The interactive path keeps the first draft's shape because the
operator's own session is not fenced and the operator is the publisher.

D-7 (2026-09-11, proposed revision). Machine results in the note are copied
from the receipt, not from the session. The session can report exit codes it
did not observe, or observe them before its last edit; the receipt's
`results` are what the engine ran (121 B-5) over a head that held still
while it ran (121 B-4). Where no
receipt exists the note says `reported by the session`, which is 125 D-3's
"state the absence" applied to provenance.

D-8 (2026-09-11, proposed revision). Two renderers, one set of fixtures. The
engine works target repositories that do not carry `scripts/pr-note.py`, so
it needs its own renderer, and two renderers drift unless something holds
them together. Golden fixtures that both must reproduce byte for byte are
that thing, the same shape 039 FR-003 gave the two journal exports.

D-9 (2026-09-11, proposed revision). The body's digest is journaled, not the
body. The note carries a model's prose, which the export policy would strip
anyway (031's free-text rule); its digest is enough to prove later which text
was posted, by anyone who holds it.

D-10 (2026-09-12, the owner). The adoption of revision 4's CLI-03 (doc 05
§19) settles the revision: in a driven run the broker posts the note (B-7,
B-8), and D-6 to D-9, proposed on 2026-09-11, are adopted as written. The
note transports a review and claims nothing about isolation or confinement.
It is scheduled after 128 and 129, and it delays nothing in 132.

## Status (2026-09-12)

Amended on 2026-09-12 to the owner's adoption of revision 4 (doc 05 §19,
CLI-03; D-10): the 2026-09-11 revision is accepted, so the proposal caveat
below no longer applies. Still `draft`, `implementation: pending`: the flip
to `approved` is recorded in the change that dispatches it, after 128 and
129.

## Status (2026-09-11)

Still `draft`, `implementation: pending`. Revised on 2026-09-11 from doc 05
D62, and **the revision is a proposal for the owner's review, not a change the
owner has accepted**. The first draft had the session post the note in every
case; the revision keeps that for interactive sessions and routes a driven
session's note through the broker as a `note` action (B-7, B-8, D-6),
separates receipted machine results from the review's narrative (B-2, D-7),
binds the note to a head and a receipt (B-9), and adds the engine's renderer
with shared fixtures (D-8). The territory grows accordingly: 122's broker and
017's and 018's stages are now extended, and the spec depends on them. D-1,
D-3, D-4 and D-5 are unchanged; D-2 is narrowed, not reversed.

## Status (2026-09-10)

Authored `draft`, `implementation: pending`. It comes from an observation
made while shipping specs 109 and 126: the pull requests for both carried
three green checks and no trace of the review that had already happened
locally.

The facts D-5 rests on were measured on 2026-09-10: `gh secret list` shows
`CLAUDE_CODE_OAUTH_TOKEN` dated 2026-07-23; a repository-wide search finds
no reference to it and no `anthropics/claude-*` action; `.github/workflows/`
holds `ci.yml`, `members.yml`, `release.yml` and `spec-spine.yml`; and no
file under `specs/`, `docs/` or `standards/` mentions a CI-side AI review.

Approval is a human flip.
