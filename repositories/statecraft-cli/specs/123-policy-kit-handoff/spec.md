---
id: "123-policy-kit-handoff"
title: "The policy, the kit and the handoff: a typed lifecycle per project, a kit manifest with provenance and declared drops, and a capsule any harness can resume from"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "122-action-broker"
  - "118-codex-harness"
  - "025-project-registry"
  - "012-spec-dag-readiness"
  - "033-cost-ceiling"
establishes:
  - "members/src/orchestrator/lifecycle-policy.ts"
  - "members/src/orchestrator/lifecycle-policy.test.ts"
  - "members/src/orchestrator/handoff.ts"
  - "members/src/orchestrator/handoff.test.ts"
  - ".codex/kit-manifest.json"
  - "scripts/codex-kit.test.py"
extends:
  # 118 owns the generator and the generated faces.
  - { spec: "118-codex-harness", unit: "scripts/codex-kit.py", nature: additive }
  - { spec: "118-codex-harness", unit: { kind: directory, path: ".agents/skills/" }, nature: additive }
  # 025 owns the project record, which gains the policy.
  - { spec: "025-project-registry", unit: "members/src/orchestrator/projects.ts", nature: additive }
  - { spec: "025-project-registry", unit: "members/src/orchestrator/projects.test.ts", nature: additive }
  # 012 owns readiness, which reads the policy's statuses.
  - { spec: "012-spec-dag-readiness", unit: "members/src/orchestrator/dag.ts", nature: additive }
  - { spec: "012-spec-dag-readiness", unit: "members/src/orchestrator/dag.test.ts", nature: additive }
  # 021 owns the daemon: the policy reaches the stages and the gate.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.ts", nature: additive }
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.test.ts", nature: additive }
  # 016 and 018 own the prompts that gain the capsule.
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.test.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.test.ts", nature: additive }
  # 122 owns the broker, which consults the policy's merge method and sensitive rule.
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.ts", nature: additive }
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.test.ts", nature: additive }
  # 023, 028 own the CLI: the policy verb, the handoff verb.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  - { spec: "028-cli-projects", unit: "members/src/commands/orchestrator.test.ts", nature: additive }
  # 022 owns the API: the policy route, the handoff route.
  - { spec: "022-http-api-and-events", unit: { kind: directory, path: "members/src/orchestrator/api/" }, nature: additive }
  # 109 owns the Makefile target list; the kit check joins it.
  - { spec: "109-governed-harness", unit: "Makefile", nature: additive }
  # 110 owns the CI workflow, whose PR path gains the kit check.
  - { spec: "110-corpus-merge", unit: ".github/workflows/spec-spine.yml", nature: additive }
  # Fixtures that build a Project or a ProjectView gain the policy field.
  - { spec: "034-adoption-preflight", unit: "members/src/orchestrator/adopt/preflight.test.ts", nature: additive }
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.test.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/fixtures.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/store.test.tsx", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  Doc 04 §7. Three things that today live in prose or in one provider's
  head become typed. A LifecyclePolicy on the projects chain, beside the
  gate contract, says which statuses a project schedules, whether a named
  draft may build, how it merges, which paths are policy-sensitive and
  what a receipt touching them does; absent, it is today's behavior. The
  Codex kit gains a manifest naming every generated file, its source and
  hash, and every field the generator dropped, and the check walks
  directories too. A handoff capsule built from the journal carries what a
  new session in any harness needs, is printed by a verb, and rides into
  every remediation prompt.
---

# 123: The policy, the kit and the handoff

## 1. Purpose

The backlog rules are a section of `AGENTS.md`, which differs between the
repositories this engine drives (spec-spine builds a named draft and
ratifies after; this repository never picks a draft). The Codex kit is
generated and checked, but what it silently dropped is a sentence in a
spec. A remediation session inherits gate tails and nothing else, and a
session in another harness inherits nothing. This spec types all three.

## 2. Territory

Owned: `lifecycle-policy.ts` and its test; `handoff.ts` and its test;
`.codex/kit-manifest.json`; `scripts/codex-kit.test.py`, the
generator's test.

Extended: the generator and the generated skill directory (118); the
project record (025); readiness (012); the daemon (021); the build and
shepherd prompts (016, 018); the broker (122); the CLI and API (023,
028, 022); the Makefile's targets (109).

Not claimed: `AGENTS.md`, which keeps describing the loop for a human
reader; the web UI.

## 3. Behavior

- **B-1 (the policy).** `LifecyclePolicy` is `{schedulable: {statuses:
  string[], namedDraft: boolean}, merge: {method: "squash" | "merge" |
  "rebase"}, sensitive: {prefixes: string[], onTouch: "record" |
  "human"}, humanGate: Stage | null}`. `DEFAULT_LIFECYCLE_POLICY` is
  `{schedulable: {statuses: ["approved"], namedDraft: false}, merge:
  {method: "squash"}, sensitive: {prefixes: <121's list>, onTouch:
  "record"}, humanGate: null}`. `parseLifecyclePolicy` refuses an
  unknown key, an empty status list, an unknown merge method or stage.
- **B-2 (recorded, probed, set).** `Project` gains `policy:
  RecordedLifecyclePolicy` (`legacy: true` for chains that predate this
  spec, folding to the default). Registration probes
  `<repo>/.statecraft/policy.json` once, read-only, and records what it
  finds or the default with `source: "default"`; no fold reads the file
  (041 D-2). `projects policy <name> [--file <path> | --json <text>]`
  sets it, `POST /api/projects/<name>/policy` likewise, both journaled as
  `project.policy.set`. The detail view prints a `policy:` block; the
  list row is unchanged.
- **B-3 (read by the loop).** `statusSchedulable` in dag.ts takes the
  policy's statuses; `namedDraft: true` lets `nextReady` accept a draft
  the operator names through `run/start` with `{specId}`. The broker's
  `merge` uses `policy.merge.method`. A receipt whose `sensitivePaths` is
  non-empty under `onTouch: "human"` puts the spec at 021's human gate
  before ship (`forceHumanGate`, journaled with the paths); under
  `"record"` it proceeds. `humanGate` names a stage the run pauses
  before for every spec, or none.
- **B-4 (the kit manifest).** `codex-kit.py` writes
  `.codex/kit-manifest.json`: `{generator: "scripts/codex-kit.py",
  sourceRoot: ".claude", files: [{target, source, sourceSha256,
  transform: "copy" | "agent-toml" | "hooks-json", dropped:
  [field...]}]}`, sorted by target. `dropped` names the frontmatter keys
  the transform did not carry (`tools`, `model`, `safety_tier`,
  `mutation`, `memory` for agents; `permissions` for hooks). `--check`
  recomputes the manifest and compares it byte for byte, and walks
  directories: an empty generated directory is a stray. `make codex-kit
  --check` is `make kit-check`, and joins `make gate`'s list in the
  Makefile and the CI workflow's PR path. `scripts/codex-kit.test.py`
  runs both modes over a fixture kit in a temp directory.
- **B-5 (the capsule).** `buildCapsule(records, {specId, project})`
  returns `{schemaVersion: 1, project: {name, origin}, spec: {id, pin},
  candidate: {branch, baseSha, headSha} | null, policy: {digest}, profile,
  receipt: <latest passing or null>, decisions: [sealed for the spec's
  scope], outstanding: [{cmd, exitCode, stderrTail}] from the last red
  gate, allowance: {run: SpendFloor | null, day: SpendFloor | null,
  ceiling}, sessions: [{driver, classification, denials, costMicroUsd}]}`.
  Every field is folded from the journal chains; nothing is read from a
  transcript. `renderCapsule` prints it as a prompt section bounded to
  `CAPSULE_BUDGET_CHARS` (12 000), truncating `outstanding` tails first.
- **B-6 (printed and injected).** `orchestrator handoff <project>
  <spec> [--json]` prints the capsule; `GET
  /api/projects/<name>/spec/<id>/handoff` returns it. The build
  remediation prompt and the shepherd remediation prompt include
  `renderCapsule` in place of their bare gate tails, so a session in
  either harness starts from the same record.

## 4. Functional requirements

- **FR-001.** Policy tests: parse and refusal cases; the legacy fold is
  the default; `projects policy` and the API route journal and re-fold;
  the probe reads the file once at registration and never in a fold.
- **FR-002.** Readiness tests: a draft is not ready under the default and
  is ready when named under `namedDraft: true`; a status outside the list
  is not ready.
- **FR-003.** Broker and daemon tests: the merge method follows the
  policy; `onTouch: "human"` with a sensitive receipt forces the gate;
  `"record"` does not.
- **FR-004.** Kit tests: the manifest lists every generated file with the
  right transform and drops; `--check` fails on a drifted manifest, a
  drifted file, a stray file and a stray empty directory, and passes on
  the committed tree.
- **FR-005.** Handoff tests: the capsule over a fixture journal carries
  the receipt, the decisions in scope, the last red gate and the
  allowance; the render respects the budget; the CLI and API return it;
  the remediation prompts contain it.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `python3
  scripts/codex-kit.test.py` green; `make gate` green with the kit check
  in it.
- A live smoke, recorded in the status note: `orchestrator handoff` over
  this repository's own project prints a capsule naming a receipt and the
  decisions of the spec built last.

## Verification

```verify:cli
cd members && bun test src/orchestrator/lifecycle-policy.test.ts src/orchestrator/handoff.test.ts src/orchestrator/dag.test.ts src/orchestrator/projects.test.ts src/orchestrator/broker.test.ts
```

```verify:cli
python3 scripts/codex-kit.test.py && python3 scripts/codex-kit.py --check
```

## Status (2026-09-09)

Implemented. `lifecycle-policy.ts` carries the type, the defaults, the
parser with its refusals, the payload codec, the registration probe of
`.statecraft/policy.json` and the detail render; the project record
gained `policy` (legacy for pre-123 chains), registration appends a
`project.policy.set` record beside the gate's, `projects policy` takes
`--file` or `--json-policy`, and `POST .../policy` takes the whole
policy. Readiness takes the policy's statuses and a named set;
`run/start` with `{specId}` names a draft through a `nameSpec` control,
and the daemon passes the names only under `namedDraft`. The daemon
raises 021's human gate before the policy's `humanGate` stage once per
spec and before ship when a receipt touched a sensitive prefix under
`onTouch: "human"`, journaled as `daemon.gate.policy`; shepherd's merge
method is the policy's. The generator writes `.codex/kit-manifest.json`
(sixteen files, the drops declared per B-4), its check walks
directories and found the stray `.agents/skills/init/` doc 04 named,
`--root` points it at a fixture, `scripts/codex-kit.test.py` exercises
both modes, and the check joins `make gate` and the CI workflow's PR
path. `handoff.ts` folds the capsule from the chains; `orchestrator
handoff <spec>` and `GET .../spec/<id>/handoff` serve it; the build and
shepherd remediation prompts carry it rendered. The members suite (955)
and the workspace are green. The live smoke: the capsule over the 122
smoke's real journal named the candidate branch, base and head, the
policy digest and the receipt hash covering the head, with no decisions
in scope and nothing red; the CLI test drives the same verb through a
fixture daemon with a spec that has decisions.

## 6. Out of scope

A neutral kit source language (the Claude kit stays the source, doc 04
D54). Per-stage driver routing. Translating agent tool restrictions into
Codex enforcement (declared as dropped, not emulated). Rewriting
`AGENTS.md`.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority (119 D-1).

D-2 (2026-09-09). The policy is registry state probed once from an
optional file, exactly as the gate contract is (041 D-2), so a fold is a
pure function of the chain and a candidate cannot change the policy that
judges it by editing the file.

D-3 (2026-09-09). The capsule is folded from the chains and never from a
transcript. A transcript is one harness's format and one machine's file;
the chain is what every harness's driver writes.

D-5 (2026-09-09). The handoff verb is project-scoped like every other
read verb (`--project <name> handoff <spec>`, or the bound project),
not a two-positional form: the CLI resolves a project one way.

D-6 (2026-09-09). The policy's `nameSpec` control is a control verb of
its own on the daemon, reached through `run/start`'s body, so a named
draft is journaled as a control record like a skip is.

D-4 (2026-09-09). The manifest declares drops rather than the generator
emulating them. A Codex agent with a `tools:` restriction would be a
claim about enforcement the generator cannot make (doc 04 §2); a
declared drop is a fact.
