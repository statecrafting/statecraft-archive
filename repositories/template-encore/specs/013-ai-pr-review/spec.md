---
id: "013-ai-pr-review"
title: "AI PR review folded into ci-gate"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: low
implementation: complete
depends_on: ["009-repo-ci-orchestrator", "012-enterprise-actions-governance"]
code_aliases: ["AI_PR_REVIEW"]
summary: >
  An App-free Claude review of every PR, dispatched from ci.yml and
  required by ci-gate: subscription OAuth token, pinned CLI version, diff
  over stdin, no ANTHROPIC_API_KEY, no exit-code swallowing, and a visible
  skip comment when the diff exceeds the size budget. A Claude API outage
  passes ci-gate with a visible notice while an auth failure still hard-fails.
establishes:
  - ".github/workflows/ai-pr-review.yml"
---

# 013 — AI PR review folded into ci-gate

## 1. Purpose

Every pull request receives a Claude review that is a required member of
the `ci-gate` aggregator. The review uses the Claude Code subscription OAuth
token and the Claude Code CLI directly — no GitHub App is installed, and no
API key is used. `ai-pr-review.yml` is dispatched from `ci.yml` via
`workflow_call` and its result is included in `ci-gate.needs`, so a failed
or absent review blocks merge (a green `ci-gate` implies the PR was reviewed
or visibly skipped as oversized).

## 2. Territory

This spec owns `.github/workflows/ai-pr-review.yml` and the `jobs.ai-review`
section of `ci.yml` (co-authored with spec `009-repo-ci-orchestrator`). The
`ci-gate` aggregator job is owned by spec `009-repo-ci-orchestrator`; this
spec governs the `ai-review` entry in its `needs:` list.

The interactive `@claude` mention bot is explicitly outside this spec's
territory; it requires a GitHub App and has no App-free equivalent.

## 3. Behavior

### FR-01: Subscription-OAuth auth, never an API key

The review step MUST authenticate via `CLAUDE_CODE_OAUTH_TOKEN` and MUST NOT
set `ANTHROPIC_API_KEY`. An unset `ANTHROPIC_API_KEY` is the correct state:
setting it alongside the OAuth token produces a silent auth failure where the
review appears to succeed but returns no output. The step MUST fail loudly and
distinctly when `CLAUDE_CODE_OAUTH_TOKEN` is unset — "secret missing" must be
distinguishable from an API error. The CLI's exit code MUST NOT be swallowed
(`|| echo …` or equivalent patterns are forbidden); an auth failure surfaces as
a red check rather than a misleading "review passed" comment.

### FR-02: Hardened, App-free review workflow

`.github/workflows/ai-pr-review.yml` MUST:

- Trigger on `workflow_call` and `workflow_dispatch` only. A standalone
  `pull_request` trigger is forbidden; the workflow is dispatched from `ci.yml`
  and a direct trigger would cause double execution.
- Pin the CLI version in a single `env: CLAUDE_CLI_VERSION` variable so
  upgrades are a one-line change with full diff visibility.
- Pass the diff to the CLI via **stdin** (`< /tmp/pr-diff.txt`), never via
  `$(cat …)` command substitution. Shell-evaluation of backticks or `$( )`
  embedded in contributor-controlled diff content is a code-injection vector
  this constraint eliminates.
- Skip draft PRs (`if: github.event.pull_request.draft == false`).
- Cap the diff at `DIFF_SIZE_CAP` lines. When the cap is exceeded the review
  step MUST skip AND post a **visible** PR comment stating that the review was
  skipped and manual review is required. A silent skip produces a green
  `ci-gate` that falsely implies "reviewed."

### FR-03: ci-gate membership

`ci.yml` MUST contain an `ai-review` job that:

- Calls `uses: ./.github/workflows/ai-pr-review.yml`.
- Runs on pull requests only (`if: github.event_name == 'pull_request'`), the
  same condition as other PR-context gates. On `push`/`workflow_dispatch` the
  job is skipped; the `ci-gate` aggregator treats a skipped dependency as
  success.
- Declares job-level `permissions: { contents: read, pull-requests: write }`
  to override `ci.yml`'s read-only default so the review can post a comment
  and the oversized-skip comment can be written.
- Passes the OAuth secret with `secrets: inherit`.

The terminal `ci-gate` job's `needs:` list MUST include `ai-review`.

### FR-04: SHA-pinned action references

Every `uses:` reference in `ai-pr-review.yml` MUST be pinned to a full
40-hex commit SHA, per spec `011-workflow-pins-lint`. The only external action
in the workflow is `actions/checkout`; it reuses the same SHA already used
across the other workflows in this repository.

### FR-05: No interactive mention bot

The `claude.yml` mention-responder bot is not shipped. The interactive `@claude`
responder is the GitHub App's responsibility and has no clean App-free CLI
equivalent. PR review is the portable subset that runs without any org-admin
action.

### FR-06: API-failure resilience (pass visibly, never silently)

A Claude API outage MUST NOT red-gate merges, but a pass MUST NEVER be silent.
The review step MUST classify a non-zero `claude` exit rather than fail blindly:

- An unset `CLAUDE_CODE_OAUTH_TOKEN` (FR-01) remains a hard failure.
- An auth or permission error (`authentication_error`, `permission_error`,
  401/403, an invalid/expired/revoked token) MUST hard-fail: a broken token
  must be fixed, not masked. This preserves the FR-01 anti-silent-green guard.
- Any other failure (`overloaded_error`, `rate_limit_error`, 5xx, timeout,
  network, unclassified) MUST pass `ci-gate` with a loud `::warning::` AND a
  visible PR comment stating the review could not run and why. The pass is
  visible (a comment is posted), never silent, the same posture as the
  oversized-diff skip (FR-02).

The step writes `review_status` (`ok` / `api_failure`) to `$GITHUB_OUTPUT`. The
"Post review comment" step runs only when `review_status == 'ok'`; a dedicated
"Post API-failure notice" step posts the visible-skip comment when
`review_status == 'api_failure'`.

## 4. Acceptance criteria

- **AC-1:** `.github/workflows/ai-pr-review.yml` exists, declares
  `on: [workflow_call, workflow_dispatch]` only, and contains no reference to
  `ANTHROPIC_API_KEY`. The `CLAUDE_CODE_OAUTH_TOKEN` secret is the sole auth
  input.
- **AC-2:** `ci.yml` declares an `ai-review` job with
  `if: github.event_name == 'pull_request'`, `permissions: { pull-requests: write }`,
  and `secrets: inherit`. The `ci-gate` job's `needs:` list includes `ai-review`.
- **AC-3:** `tools/lint/workflow-pins.sh` exits 0 over `ai-pr-review.yml`
  (all `uses:` references SHA-pinned).
- **AC-4:** The diff is passed to the CLI via stdin redirection, not command
  substitution. `grep -F '$(cat' .github/workflows/ai-pr-review.yml` returns
  zero matches.
- **AC-5:** The oversized-diff branch posts a PR comment before exiting 0, so
  `ci-gate` can proceed while leaving a visible audit trail.
- **AC-6:** `npx spec-spine couple --base origin/main` exits 0 with this spec
  and the updated `ci.yml` in the same diff.
- **AC-7:** A non-auth `claude` failure (e.g. `overloaded_error`) leaves
  `ci-gate` green and posts an API-failure notice comment; an
  `authentication_error` exits non-zero (red). The "Post review comment" step
  is gated on `review_status == 'ok'`.

## 5. Out of scope

- **`ai-changelog.yml`** — a release-notes companion. Not shipped; a downstream
  project may add it under its own spec.
- **The interactive `@claude` mention bot** — see FR-05. Requires the GitHub
  App. If a downstream org installs the App the mention bot becomes available
  independently of this spec.
- **Installing the Claude GitHub App** — this spec exists to deliver review
  without the App.
- **A local `make ci` equivalent** — an AI review has no deterministic local
  mirror and no `make ci` analogue. The local CI loop is unchanged.

## 6. Design notes

The App-free pattern needs only the subscription OAuth token (already
provisioned as a repo secret) and the built-in `GITHUB_TOKEN`. No org-admin
action is required. The CLI installs at a pinned version via
`npm install -g @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}`, runs with
`claude -p "$PROMPT" --output-format text < /tmp/pr-diff.txt`, and posts with
`gh pr comment` — the same three-step shape proven in similar CI surfaces.

The PR-only constraint mirrors the `spec-spine` workflow's `couple` step:
both need PR context (base/head diff, PR number). On `push: main` that
context is absent; the job skips and `ci-gate` treats the skip as success,
preserving the clean push-to-main path.
