---
id: "158-workflow-ref-sha-pinning-lint"
slug: workflow-ref-sha-pinning-lint
title: Workflow-ref SHA-pinning lint — promote convention to contract (amends 116)
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
approved: "2026-05-22"
closed: "2026-05-22"
kind: governance
domain: tooling
risk: low
amends: ["116-supply-chain-policy-gates"]
depends_on:
  - "116-supply-chain-policy-gates"  # supply-chain-policy-gates (parent contract being amended)
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (CI mirror requirement)
code_aliases: ["WORKFLOW_PINS"]
establishes:
  - unit: { kind: file, path: tools/lint/workflow-pins.sh }
  - unit: { kind: file, path: tools/lint/workflow-pins-test.sh }
  - unit: { kind: file, path: tools/lint/tests/fixtures/passing/action.yml }
  - unit: { kind: file, path: tools/lint/tests/fixtures/failing/action.yml }
refines:
  - aspect: "workflow-ref-pin-enforcement"
    unit: { kind: file, path: .github/workflows/ci-supply-chain.yml }
  - aspect: "workflow-ref-pin-enforcement"
    unit: { kind: file, path: .githooks/pre-commit }
compliance:
  - framework: "owasp-asi-2026"
    # ASI04 (supply-chain compromise). Closes the convention-vs-contract
    # gap on workflow-ref pinning: every external Action ref was already
    # SHA-pinned by discipline, but no gate would have refused a
    # regression. The lint is the compile; the merge boundary and the
    # commit boundary both refuse un-pinned refs.
    controls: ["ASI04"]
summary: >
  Promote the SHA-pinning convention across .github/workflows/** and
  .github/actions/** into a merge-blocking and commit-blocking contract.
  Adds tools/lint/workflow-pins.sh (line-oriented lint with five
  classification rules and fail-closed dynamic-ref handling), test
  fixtures that act as the lint's own spec, and a regression test
  runner. The lint runs as a step in ci-supply-chain.yml AND as a
  pre-commit hook gate in .githooks/pre-commit — same script, two
  consumers. No allow-list for un-pinned refs; the correct
  resolution for any flagged ref is to pin it.
---

# 158 — Workflow-ref SHA-pinning lint

## 1. Problem Statement

At the time spec 116 closed (2026-05-02), every `uses:` ref in
`.github/workflows/**` and `.github/actions/**` was SHA-pinned to a
40-hex commit. That posture was correct, but it was *convention*:
maintained by hand, verified by review, and refusable only by social
pressure. A single tag-pinned ref (or worse, a dynamic
`${{ ... }}@${{ ... }}` ref) merged in a low-attention PR would have
shipped without a gate firing.

The Megalodon campaign (2026-05-18, 5,718 malicious commits to 5,561
repositories) is the proximate motivation. Two payload variants
exfiltrated CI environment variables, cloud-provider credentials, SSH
keys, and OIDC tokens; the targeted variant (`Optimize-Build`) sat
dormant behind `workflow_dispatch` for selective activation. Both
variants relied on the attacker being able to introduce a workflow
file or replace an existing one. SHA-pinning is one of several
controls that change the attack from "exfiltrate at run time" to
"reduce the new workflow to a frozen spec at merge/commit time" —
but only if SHA-pinning is enforced, not asserted.

This spec amends 116 by promoting SHA-pinning from convention to
contract.

## 2. Goals

- **G-1.** Every `uses:` ref across `.github/workflows/**` and
  `.github/actions/**` is SHA-pinned to a full 40-hex commit, with
  the sole exceptions of local paths and Docker `sha256:` digests.
- **G-2.** The contract is enforced at both the merge boundary
  (CI gate) and the commit boundary (pre-commit hook). An
  un-pinned ref never exists in pushed history, not only never
  merges to main.
- **G-3.** The lint's semantics are versioned and verifiable
  independently of the lint binary — test fixtures act as the
  spec for the lint.

## 3. Functional Requirements

### FR-001 — SHA-pin enforcement (the contract)

Every `uses:` ref in `.github/workflows/**/*.{yml,yaml}` and
`.github/actions/**/*.{yml,yaml}` MUST be SHA-pinned to a full
40-hex commit SHA, with the sole exceptions of (a) local paths
(`./...`) and (b) Docker images pinned via `sha256:<digest>`.
Dynamic `${{ ... }}` expressions inside `uses:` refs are
non-conforming and MUST be replaced with literal pins.

### FR-002 — Lint as the compile (one script, two consumers)

`tools/lint/workflow-pins.sh` is the canonical enforcement
mechanism. It MUST run as a step in
`.github/workflows/ci-supply-chain.yml` and MUST be available
to run as a gate in `.githooks/pre-commit`. Both consumers
invoke the same script unmodified. Exit codes are distinct:

| Exit | Meaning |
|------|---------|
| 0    | All refs pinned (or no files to scan) |
| 1    | One or more refs are not SHA-pinned (diagnostics on stderr) |
| 2    | Lint could not run (bad invocation or unsupported shell) |

Exit codes 1 and 2 MUST both fail the consumer. Gates MUST NOT
treat exit 2 as success — "gate failed to run" is structurally
different from "all pinned" and must be loud, not silent.

### FR-003 — No allow-list (soundness)

There is no exception list for un-pinned refs. Dynamic
`${{ ... }}` expressions in `uses:` refs MUST be refused
unconditionally; the lint is a static proof system and
approving an unprovable claim would degrade the contract from
a refusal mechanism into a heuristic. If a ref cannot be
SHA-pinned, the correct resolution is to pin it literally in
YAML — not to add an exception.

This is the same soundness argument as Rust refusing to compile
code where the borrow checker cannot prove non-aliasing — not
because aliasing definitely happens, but because soundness
requires refusal in the absence of proof.

### FR-004 — Workflow YAML must not embed example `uses:`

To preserve the lint's line-oriented exactness without
introducing a YAML parser dependency, workflow YAML and
composite-action YAML MUST NOT embed example `uses:` lines
inside string scalars (heredocs, folded blocks, `run:` step
bodies, etc.). Documentation that needs to show example refs
lives in `docs/examples/**`, which the lint excludes by path.

This converts an undetectable false-positive surface into a
documentable contract violation. The lint is exact about what
the contract allows, not approximate about what YAML might
mean.

### FR-005 — Trust transitivity (the positive shape of escape valves)

Refs to repositories within the same governance perimeter MAY
be pinned by tag if and only if (a) that repository itself
enforces SHA-pinning via an equivalent gate, and (b) that
repository is documented as a `co_authority` on this spec.
There is no other exception.

For OAP today this clause is forward-looking — zero refs
target org-owned shared-workflows repositories. Stating the
future shape now ensures the answer is already written when
the question arises. Without this lever, the answer is "pin
its SHA like anything else."

## 4. Implementation

### 4.1 Lint surface

The lint classifies each `uses:` line as one of:

| Form | Classification | Behavior |
|------|---------------|----------|
| `uses: ./.github/actions/foo` | local path | skip |
| `uses: ./.github/workflows/foo.yml` | local reusable workflow | skip |
| `uses: docker://image@sha256:<hex>` | digest-pinned image | skip |
| `uses: owner/repo@<40-hex>` | SHA-pinned | pass |
| `uses: owner/repo@<40-hex> # v6` | SHA-pinned with version comment | pass |
| `uses: owner/repo@v4` | tag pin | FAIL (FR-001) |
| `uses: owner/repo@main` | branch pin | FAIL (FR-001) |
| `uses: ${{ ... }}@<anything>` | dynamic ref | FAIL (FR-003) |

Both mapping-key form (`uses: ...`) and list-item form
(`- uses: ...`) are accepted by all regexes.

### 4.2 Test fixtures (the lint's own spec)

`tools/lint/tests/fixtures/passing/action.yml` exercises every
form that MUST pass.

`tools/lint/tests/fixtures/failing/action.yml` exercises every
form that MUST fail, with expected line numbers documented in
the fixture header.

`tools/lint/workflow-pins-test.sh` asserts both fixtures
produce the expected exit codes and (for the failing fixture)
the expected violation count. It additionally asserts the
tree-wide scan exits 0 — the "convention has been 100%
correct" claim, verified by script.

### 4.3 CI consumer

`.github/workflows/ci-supply-chain.yml` adds a `workflow-pins`
job alongside `cargo-deny`, `pnpm-audit`, and
`npm-audit-statecraft`. Job name follows the existing
convention (`<job> / <descriptor>`). Path triggers expanded
to include `.github/workflows/**`, `.github/actions/**`, and
`tools/lint/**`.

### 4.4 Pre-commit consumer

`.githooks/pre-commit` gains a Stage 2 gate invoking the same
lint script. The hook is opt-in via
`git config core.hooksPath .githooks`; when enabled, it
refuses commits containing un-pinned refs at the commit
boundary, not only at the merge boundary.

The hook fails closed: if the lint script is missing or
unexecutable, the commit is refused with a clear
diagnostic. Same exit-code discipline as the CI gate.

## 5. Falsifiers

Verification was by falsification — four reproducible terminal
blocks, each a specific way the spec's claims could be wrong and
the output that proved they are not. The living proof of each is
the lint's own test fixtures (`tools/lint/tests/fixtures/`) plus
the CI (`ci-supply-chain.yml`) and pre-commit gates; the
point-in-time launch evidence bundle has been retired.

1. **Tree-wide scan** (FR-001 holds today) — 126 refs across
   22 workflows, exit 0, silent.
2. **Synthetic bad fixture** (FR-001 + FR-003 enforced) —
   5 violations correctly classified and reported.
3. **Regression tests** (FR-002 + lint semantics versioned) —
   all 4 assertions pass.
4. **Full pre-commit hook** (FR-002 — both consumers wired) —
   both stages exit 0 silently.

A fifth implicit falsifier is the "zero-scan regression": a lint
that returns 0 across zero scanned lines is the precise failure
mode this spec exists to prevent. The first draft of
`workflow-pins.sh` shipped that bug; an independent
count-the-lines check caught it before the spec was written.
Preserved in the failing fixture as a standing regression
check.

## 6. Migration & Compatibility

- **Zero migration cost for the current corpus.** Every existing
  `uses:` ref already complies; the tree-wide scan exits 0 from
  day one. The lint promotes a verified-correct state from
  convention to contract.
- **Opt-in pre-commit posture preserved.** The Stage 2 gate is
  added to the existing opt-in hook. Adopters enable via
  `git config core.hooksPath .githooks` as today; non-adopters
  are still protected by the CI gate at merge.
- **No breaking change to ci-supply-chain.yml triggers.** The
  path expansion adds `.github/workflows/**`, `.github/actions/**`,
  and `tools/lint/**` to existing trigger lists. The pre-existing
  triggers (`**/Cargo.toml`, `**/Cargo.lock`, etc.) remain.

## 7. Non-Goals

- **Not introducing a YAML parser.** The line-oriented grep
  approach is exact for the contract surface defined by FR-004.
  Pulling in a YAML dependency would invert the cost (the
  current lint is 153 lines of shell, shellcheck-clean).
- **Not enforcing SHA pinning on Docker `sha256:` digests
  beyond their presence.** Docker pinning is a separate
  concern; the lint trusts the `sha256:` prefix as a marker of
  pinned intent. A future spec MAY add digest verification
  against a known-good list.
- **Not auto-resolving SHAs from tags.** The lint reports
  violations; humans (or a follow-up tool) resolve them. An
  auto-resolve tool would create a tag-to-SHA dependency the
  contract explicitly refuses (FR-005).
