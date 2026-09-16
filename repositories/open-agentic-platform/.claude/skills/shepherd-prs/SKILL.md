---
name: shepherd-prs
description: Post-create PR lifecycle automation — rerun infra failures, triage review comments adversarially, enqueue when green, verify merged main. Designed for /loop.
allowed-tools: Bash, Read, Grep, Glob, Task, Agent
argument-hint: "[PR number to focus on, or empty for all open PRs]"
---

# /shepherd-prs — fire-and-forget PR lifecycle

Run after `/ship` (or any PR creation) so authoring sessions never
babysit checks. Designed to be invoked repeatedly via `/loop` (e.g.
`/loop /shepherd-prs`) — each invocation is one idempotent sweep.
Bound by `.claude/rules/orchestrator-rules.md`; halts (reports, does
not improvise) on anything outside the playbook below.

## Sweep

1. List open PRs: `gh pr list --json number,headRefName,headRefOid,isDraft,autoMergeRequest,mergeStateStatus`
   (or scope to `$ARGUMENTS` if a PR number was given). Skip drafts.

2. For each PR, fetch check state via REST (GraphQL has been
   observed to 401 during GitHub auth incidents while REST stays up):
   `gh api repos/{owner}/{repo}/commits/<headRefOid>/check-runs`

3. Classify and act per the playbook.

## Playbook

### All checks green
- If the PR is labeled `auto-merge` (or the user pre-authorized
  enqueueing for it): enqueue via `gh pr merge <n> --auto --squash`
  (match the repo's merge method). Otherwise report "ready".
- **Once enqueued: NEVER push to the branch.** The queue merges the
  locked candidate and orphans any new push (proven on #309).

### Failures present — classify by failing-job log signature
Fetch the failing job's log tail (`gh api .../jobs/<id>/logs`).

**Infrastructure class** — rerun, don't touch code:
- `HTTP 401: Requires authentication` (GitHub auth incident — check
  https://www.githubstatus.com/api/v2/status.json to confirm)
- `The runner has received a shutdown signal` / lost communication
- npm/cargo registry 5xx, `ETIMEDOUT`, `ECONNRESET`
- GitHub Actions cancellation without a failing step

Action: `gh run rerun <run_id> --failed`. Respect a cap: if
`.run_attempt` is already ≥ 3, stop rerunning and surface to the
user instead — three infra failures in a row is a real signal.

**Real-failure class** — everything else (test failures, gate
failures, lint). Do NOT auto-fix blind. If the failure is the
coupling gate or index staleness, the fix is mechanical
(`make pr-prep`, commit, push — only while NOT enqueued). Anything
else: surface the failing output to the user (orchestrator rule 4)
and move to the next PR.

### New AI-review comment since last sweep
Triage adversarially — never apply findings unverified:
1. For each finding, spawn a refuter agent with repo access:
   "Attempt to refute with file:line evidence; default REFUTED if
   unevidenced." (Same contract as `/code-review` Stage 2.)
2. CONFIRMED + trivial (≤5 lines, no semantic change, no new
   surface) **and the PR is not enqueued** → apply, `make pr-prep`,
   commit, push.
3. CONFIRMED + substantive → surface to the user with the refuter's
   evidence. Do not enqueue past it.
4. REFUTED → note in the sweep report; no action. (Recurring false
   patterns observed from the CI reviewer: claims about CLAUDE.md
   content it cannot see; "unclaimed paths fail the coupling gate" —
   unclaimed paths are skipped.)

### Recently merged PRs (since last sweep)
Verify on-disk truth, not just the MERGED status:
`git fetch origin main && git log origin/main --oneline -5` — confirm
the squashed commit is present. If a fix was orphaned by a queue race,
surface immediately.

## Sweep report (every invocation, even when idle)

```
## shepherd: <n> open PRs
- #<num> <branch>: <state> — <action taken or "no action">
...
merged since last sweep: <list or none>
```

## Hard rules
- Never push to an enqueued PR.
- Never edit a PR body expecting CI to re-read it without a fresh push.
- Never add AI attribution anywhere.
- Waiver decisions are the user's — never add a Spec-Drift-Waiver
  autonomously.
