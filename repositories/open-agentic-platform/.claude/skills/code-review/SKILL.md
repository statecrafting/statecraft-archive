---
name: code-review
description: Staged adversarial review — triage, decorrelated finders (warm + cold), per-finding refuters, evidence-ready report
allowed-tools: Task, Agent, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git rev-parse:*), Bash(git worktree:*), Bash(git fetch:*), Bash(shasum:*)
argument-hint: "[scope] - e.g., \"branch\", \"recent changes\", \"crates/agent\""
---

# Code Review (v2 — adversarial)

Three-stage review: decorrelated finding, adversarial verification,
honest synthesis. Output ends with a machine-readable evidence block
that `/ship` attaches to the PR so the CI ai-review can verify instead
of regenerate. This skill absorbed `/review-branch` (retired): its
cross-platform checklist lives in Stage 0.

## THE BIAS RULE (load-bearing — read first)

**Never pass the author's rationale, design justifications, or
"this is a deliberate trade-off" framing to finder agents.** Finders
receive the diff and neutral repository facts only. An anchored finder
ratifies the author's trade-offs instead of testing them (proven on
PR #317: a security finder told "this is a decision-forcing gate, not
a security boundary" dismissed the exact finding the cold CI review
correctly led with). Rationale enters the process exactly once — in
the Declared Trade-offs Ledger, *after* verification, where a cold
reader can weigh it against confirmed facts.

## Stage 0 — Triage (orchestrator only, no agents)

1. Gather state:

```
git status --short && git diff --stat && git log --oneline -10
```

2. Determine the base branch (worktree-aware):

```bash
MAIN_WORKTREE=$(git worktree list | head -1 | awk '{print $1}'); CURRENT_DIR=$(git rev-parse --show-toplevel); if [ "$MAIN_WORKTREE" != "$CURRENT_DIR" ]; then BASE=$(git -C "$MAIN_WORKTREE" branch --show-current); else BASE="main"; fi; echo "Base: $BASE" && git diff $BASE...HEAD --stat && git diff HEAD --stat
```

3. Classify changed files (committed + uncommitted):

| Class | Patterns |
|---|---|
| Rust source | `crates/**/*.rs`, `tools/**/*.rs`, `Cargo.toml`, `Cargo.lock` |
| TS/JS source | `product/**/*.{ts,tsx}`, `platform/**/*.ts`, `tools/**/*.ts` |
| Config/CI | `*.json`, `*.toml`, `.github/**`, `.claude/**`, `Makefile` |
| Specs/Docs | `specs/**`, `docs/**`, `*.md` |
| Tests | `*test*`, `tests/` |

4. Run the portability + hygiene checklist yourself (no agent —
   it is pattern-matching, not judgment). Flag for Stage 1 context:
   - **Cross-platform** (Tauri ships to macOS/Windows/Linux):
     hardcoded path separators vs `path.join`; `Meta`/`Cmd` vs
     `CmdOrCtrl`; `HOME` vs `USERPROFILE`/XDG; shell commands that
     break on Windows; case-sensitivity assumptions; CRLF; native
     deps needing per-platform builds; Unix permissions; MAX_PATH.
   - **Dependencies**: manifest adds/bumps/removals.
   - **Hygiene**: debug prints, commented-out code, stray TODOs.

5. Select warm finder dimensions by class (cold finder ALWAYS runs):
   - Rust or TS source → correctness+architecture, security+deps,
     and (if hot paths or async touched) performance+concurrency
   - Tests touched → testing-quality folded into correctness finder
   - Config/CI only → security+deps, correctness+architecture
   - Specs/Docs only → docs-accuracy finder only (+ cold finder)

## Stage 1 — Finders (parallel, decorrelated)

Dispatch ALL selected finders plus the cold finder in a single
parallel batch. Every finder prompt gets the neutral facts block:

```
FACTS:
- Repository: open-agentic-platform (Rust crates + TS packages + Tauri desktop + Encore.ts platform)
- Base: <base> | Head: <branch/worktree>
- Changed files: <list>
- Stage 0 checklist flags: <portability/deps/hygiene flags, stated neutrally>
```

…and NOTHING about why the change was made the way it was.

**Warm finders** (repo read access) — one Task per selected dimension.
Prompt template:

```
Review the branch diff for <dimension>. Read any file you need.
Return ONLY a findings list, one per line:
FINDING|<severity CRITICAL/HIGH/MEDIUM/LOW>|<file:line>|<one-sentence claim>|<one-sentence evidence>
Severity is your honest claim; it will be adversarially verified.
Do not soften or pre-dismiss findings — verification is not your job.
If nothing found for this dimension, return: NO-FINDINGS|<dimension>
```

**Cold finder** (ALWAYS, regardless of class) — reproduce the CI
review's decorrelated vantage in-house. Its prompt contains the RAW
DIFF TEXT inline and these instructions:

```
You are reviewing a unified diff with NO other context. Do NOT read
any files; judge only what is in the diff. Review for:
1. Bugs and logic errors
2. Security vulnerabilities (OWASP top 10)
3. Internal inconsistencies (the diff contradicting itself or its own comments/docs)
4. Performance concerns
Return findings in the same FINDING|… format. Flag anything you
cannot verify from the diff alone as severity LOW with the prefix
UNVERIFIABLE in the claim.
```

## Stage 2 — Adversarial verification (parallel)

Every finding from every finder — **no orchestrator pre-filtering;
filtering before refutation is author bias re-entering** — goes to a
refuter agent with full repo access:

```
Attempt to REFUTE this finding with file:line evidence:
  <finding line>
Check the actual code, the harness/docs contracts it assumes, and the
repo's real conventions. Verdict line:
VERDICT|CONFIRMED or REFUTED or DOWNGRADED-TO-<severity>|<one-paragraph justification with file:line citations>
Default to REFUTED if the claim cannot be positively evidenced.
```

If there are more than 12 findings, group refutation by file (one
refuter per file's findings) to bound cost.

## Stage 3 — Synthesis (orchestrator)

Build the report:

```
## Code Review Report

### Scope
Base: <base> | Head: <head> | Files: <n> | +<a>/-<d>
Finders: <warm list> + cold | Findings: <f> raised, <c> confirmed, <r> refuted

### Confirmed findings
#### CRITICAL / HIGH / MEDIUM / LOW
- [<dimension>] <claim> — `file:line`
  Fix: <specific recommendation>

### Refuted (kept for the record)
- <claim> — refuted: <one-line reason>

### Declared Trade-offs Ledger
(Author rationale enters HERE, not in finder prompts. One entry per
accepted trade-off, written for a cold reader.)
- <trade-off>: <why accepted> — <where documented (spec §/commit)>

### Actions
1. <actionable item>
...
```

End the report with the machine-readable evidence block (consumed by
`/ship`, verified by the CI ai-review):

```bash
git fetch origin main --quiet; DIFF_SHA=$(git diff origin/main...HEAD | shasum -a 256 | cut -d' ' -f1); HEAD_SHA=$(git rev-parse HEAD); echo "Local-Review-Evidence: head=$HEAD_SHA diff_sha256=$DIFF_SHA confirmed=<c> refuted=<r> ledger=<k>"
```

**To proceed:** reply with the action numbers to apply (e.g. "1, 3").

---

**Read-only.** No files are modified unless actions are explicitly
requested afterwards.
