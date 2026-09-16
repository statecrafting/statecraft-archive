---
id: "011-workflow-pins-lint"
title: "Workflow-ref SHA-pinning lint"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: low
implementation: complete
code_aliases: ["WORKFLOW_PINS"]
summary: >
  Every `uses:` reference across .github/** must be pinned to a full commit
  SHA. tools/lint/workflow-pins.sh is the line-oriented lint (five
  classification rules, no allow-list — the only fix for a flagged ref is
  to pin it), workflow-pins-test.sh the fixture-backed regression runner.
  The gate runs in ci-supply-chain.yml and in the opt-in pre-commit hook.
establishes:
  - "tools/lint/workflow-pins.sh"
  - "tools/lint/workflow-pins-test.sh"
  - "tools/lint/tests/fixtures/passing/action.yml"
  - "tools/lint/tests/fixtures/failing/action.yml"
references:
  - { unit: { kind: file, path: ".githooks/pre-commit" }, role: "opt-in local enforcement point (owned by spec 000)" }
---

# 011 — Workflow-ref SHA-pinning lint

## 1. Purpose

GitHub Actions workflows reference external actions via `uses:` refs.
Tag and branch pins are mutable — a compromised upstream can silently
swap what a tag points at, turning a reviewed workflow into an attacker-
controlled one. Full 40-hex commit SHA pinning is the defensible posture:
a SHA is immutable by content addressing, and a compromised upstream
cannot change what that SHA refers to.

Enforcing pinning by convention — hand maintained, review-verified,
socially enforced — is not refusable: a single tag-pinned or dynamic
`${{ ... }}` ref can merge in a low-attention PR without any gate firing.

`tools/lint/workflow-pins.sh` promotes SHA-pinning from convention to
contract. It runs as a gate in `ci-supply-chain.yml` (spec 010) at the
merge boundary, and as a gate in the opt-in `.githooks/pre-commit` at
the commit boundary. Same script, two consumers.

The Megalodon campaign (2026-05-18, 5,718 malicious commits to 5,561
repositories) is the motivating precedent. Both payload variants
exploited the ability to introduce or replace workflow files; SHA-pinning
changes the attack surface from "exfiltrate at run time" to "commit a
frozen binary ref that reviewers can inspect" — but only if pinning is
enforced, not merely asserted.

## 2. Territory

`tools/lint/workflow-pins.sh` is the canonical enforcement mechanism and
the full scope of this spec's owned code surface. The lint is pure shell
(no external dependencies beyond `grep`, `awk`, and a POSIX shell), 
shellcheck-clean, and line-oriented — no YAML parser is introduced.

The test runner (`workflow-pins-test.sh`) and two fixture files cover the
lint's behavioral contract: the passing fixture exercises every ref form
that must pass; the failing fixture exercises every ref form that must
fail.

This spec governs the `jobs.workflow-pins` section of
`ci-supply-chain.yml` (spec 010) via section-anchored co-authority.
The `.githooks/pre-commit` hook is owned by spec 000; this spec governs
only the lint script that the hook invokes.

## 3. Behavior

### FR-01: SHA-pin enforcement

Every `uses:` ref in `.github/workflows/**/*.{yml,yaml}` and
`.github/actions/**/*.{yml,yaml}` MUST be pinned to a full 40-hex commit
SHA, with the sole exceptions of:

- Local paths (`./...`) — path-relative refs resolve to the same
  commit as the calling workflow and require no external pin
- Docker images pinned by digest (`docker://image@sha256:<hex>`)

Dynamic `${{ ... }}` expressions inside `uses:` refs are non-conforming
and MUST be replaced with literal pins. There is no other exception.

### FR-02: One script, two consumers

`tools/lint/workflow-pins.sh` is the canonical implementation. It MUST
run unmodified as:

1. A step in `.github/workflows/ci-supply-chain.yml` (merge boundary)
2. A gate in `.githooks/pre-commit` when enabled by the developer
   (commit boundary)

Both consumers invoke the same script. Exit codes:

| Exit | Meaning |
|------|---------|
| 0 | All refs pinned, or no files to scan |
| 1 | One or more refs are not SHA-pinned (diagnostics on stderr) |
| 2 | Lint could not run (bad invocation or unsupported shell) |

Exit codes 1 and 2 MUST both fail the consumer. A lint that cannot run
(exit 2) is never treated as success — "gate failed to run" is
structurally distinct from "all pinned".

### FR-03: No allow-list

There is no exception list. Dynamic `${{ ... }}` expressions MUST be
refused unconditionally. The lint is a static proof system: approving an
unprovable claim degrades the contract from a refusal mechanism into a
heuristic. If a ref cannot be SHA-pinned for some reason, the correct
resolution is to pin it literally in YAML.

This is the same soundness argument as a compiler refusing code it
cannot prove safe — not because unsafety definitely occurs, but because
soundness requires refusal in the absence of proof.

### 3.1 Classification rules

The lint classifies each `uses:` line as one of five forms:

| Form | Classification | Behavior |
|------|---------------|----------|
| `uses: ./.github/actions/foo` | local path | skip |
| `uses: ./.github/workflows/foo.yml` | local reusable workflow | skip |
| `uses: docker://image@sha256:<hex>` | digest-pinned image | skip |
| `uses: owner/repo@<40-hex>` | SHA-pinned | pass |
| `uses: owner/repo@<40-hex> # v6` | SHA-pinned with comment | pass |
| `uses: owner/repo@v4` | tag pin | FAIL (FR-01) |
| `uses: owner/repo@main` | branch pin | FAIL (FR-01) |
| `uses: ${{ ... }}@<anything>` | dynamic ref | FAIL (FR-03) |

Both mapping-key form (`uses: ...`) and list-item form (`- uses: ...`)
are recognized by all classification rules.

### FR-04: Workflow YAML must not embed example `uses:` lines

To preserve the lint's line-oriented exactness without introducing a YAML
parser, workflow and composite-action YAML files MUST NOT embed example
`uses:` lines inside string scalars (heredocs, folded blocks, `run:`
step bodies). Documentation that shows example refs lives in `docs/`
or `README.md`, which the lint excludes by path.

This converts an undetectable false-positive surface into a documentable
constraint violation.

### 3.2 Test fixtures as lint spec

`tools/lint/tests/fixtures/passing/action.yml` exercises every ref form
that MUST pass. It is the positive oracle for the lint.

`tools/lint/tests/fixtures/failing/action.yml` exercises every ref form
that MUST fail, with expected line numbers and violation counts
documented in the fixture header. It is the negative oracle.

`tools/lint/workflow-pins-test.sh` asserts:
- The passing fixture produces exit 0 with zero violations
- The failing fixture produces exit 1 with the documented violation count
- A tree-wide scan of `.github/**` exits 0 (the "convention was already
  100% correct" claim, verified by script on each CI run)

The zero-scan regression: a lint that returns 0 because it scanned zero
lines is the exact failure mode this spec prevents. The test runner
includes an independent line-count check to distinguish "all-pass scan"
from "no-op scan".

### FR-05: Trust transitivity

Refs to repositories within the same governance perimeter MAY be pinned
by tag if and only if (a) that repository itself enforces SHA-pinning
via an equivalent gate, and (b) that repository is documented as a
`co_authority` on this spec. There is no other exception.

Today this clause is forward-looking — no refs target org-owned
shared-workflow repositories. Stating the rule now ensures the answer is
available when the question arises; without this lever, the answer is
"pin its SHA like anything else."

## 4. Acceptance criteria

**AC-1** `tools/lint/workflow-pins.sh` exists and is executable.

**AC-2** `tools/lint/workflow-pins-test.sh` exists and exits 0:
```bash
bash tools/lint/workflow-pins-test.sh
```

**AC-3** Tree-wide scan exits 0:
```bash
bash tools/lint/workflow-pins.sh .github/workflows .github/actions
```

**AC-4** The passing fixture exits 0 and the failing fixture exits 1:
```bash
bash tools/lint/workflow-pins.sh tools/lint/tests/fixtures/passing/action.yml
# → exit 0
bash tools/lint/workflow-pins.sh tools/lint/tests/fixtures/failing/action.yml
# → exit 1 with violation diagnostics on stderr
```

**AC-5**
```bash
npx spec-spine registry show 011-workflow-pins-lint
```
exits 0 and resolves all four `establishes:` units.

**AC-6** The `workflow-pins` job in `ci-supply-chain.yml` invokes the
script and fails the workflow on exit 1 or 2.

## 5. Out of scope

- **Introducing a YAML parser** — the line-oriented approach is exact for
  the contract surface defined by FR-04. A YAML dependency would increase
  tool surface without improving the contract.
- **Auto-resolving SHAs from tags** — the lint reports violations; humans
  resolve them. An auto-resolve tool would create a tag-to-SHA dependency
  the contract explicitly refuses.
- **Enforcing Docker digest freshness** — the lint trusts the `sha256:`
  prefix as a marker of pinned intent. Digest verification against a
  known-good list is a separate concern.
- **Pre-commit hook ownership** — the `.githooks/pre-commit` hook is owned
  by spec 000. This spec governs only the lint script that the hook
  invokes; enabling or disabling the hook is a bootstrap concern.
