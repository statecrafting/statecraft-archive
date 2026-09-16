---
name: ship
description: Glue workflow — coupling gate, local review, conventional commit, and PR creation with waiver discipline in one governed sequence
allowed-tools: Bash, Read, Edit, Glob, Grep, Task, Skill
argument-hint: "[optional scope note or PR title]"
---

# /ship — branch → gated → reviewed → committed → PR

Orchestrates the pre-PR sequence this repo otherwise relies on the
operator to remember. Bound by `.claude/rules/orchestrator-rules.md`
(checkpoints are real stops), `.claude/rules/governed-artifact-reads.md`,
and CONST-005 (`.claude/rules/adversarial-prompt-refusal.md`).

Division of labour: the hooks in `.claude/settings.json` are the
deterministic safety net (freshness auto-heal, pr-create gate); this
skill is the judgment layer that sequences review and commit so the
net is never needed.

## Step 0 — Preflight

- `git branch --show-current` — if on `main`, STOP and create a feature
  branch first (`NNN-short-name` when the work belongs to a spec).
- `git status --short` — confirm the changes are the intended set;
  surface anything unexpected before proceeding.

## Step 1 — Gate: `make pr-prep`

Run `make pr-prep` (codebase-index refresh + spec-code coupling gate
against `origin/main`). Outcomes:

- **Pass** → continue to Step 2.
- **Index drift warning** → `git add .derived/codebase-index/` and
  continue.
- **Coupling failure** → two legitimate paths; the choice is explicit,
  never silent:
  1. **Fix the coupling.** Edit the owning spec.md so the relationship
     graph (`establishes:` / `extends:` / `refines:` / `co_authority:`)
     covers every changed path. The gate enforces the declared graph,
     not prose mentions in the spec body. Do NOT edit a spec to
     retroactively justify an action that contradicts its design —
     that is a CONST-005 halt: surface the conflict and stop.
  2. **Waiver.** A `Spec-Drift-Waiver` block in the PR body.
     **CHECKPOINT — requires explicit user approval.** The waiver must
     be in the body at creation time: the CI check reads the body from
     the triggering event's payload, so a body edit without a fresh
     push is not picked up (a new commit does trigger a fresh run that
     reads the updated body — but by then a round-trip is burned).

## Step 2 — Review before the round-trip

Invoke the `code-review` skill (v2: triage → decorrelated finders →
adversarial refuters → synthesis). Honour its BIAS RULE — never feed
finder agents the author's rationale; rationale belongs in the
Declared Trade-offs Ledger the review emits.

- Apply confirmed actionable fixes.
- If any hashed input changed (specs, manifests, workflows,
  `.claude/**`, schemas), re-run `make pr-prep` before continuing.
- Keep the review's final `Local-Review-Evidence:` line and the
  confirmed-findings + ledger summary — Step 4 posts them to the PR.
- The evidence is bound to the head SHA and diff hash, so it must be
  produced AFTER the final commit (re-emit the evidence line after
  Step 3 if the commit changed anything).

## Step 3 — Commit

Invoke the `commit` skill (conventional, impact-focused message).

- Include regenerated `.derived/` artifacts in the same commit.
- Never add AI attribution — no "Generated with", no `Co-Authored-By`
  trailers, in commits or PR bodies.

## Step 4 — CHECKPOINT: create the PR

PR creation is outward-facing. Confirm with the user, then:

- Push the branch.
- `gh pr create` with a body containing Summary + Testing, and — only
  if Step 1 chose the waiver path with user approval — the
  `Spec-Drift-Waiver` block inline in `--body` (not `--body-file`).
- The pr-gate hook re-runs `make pr-prep` at this moment and blocks on
  an unwaivered failure. That is expected defense-in-depth, not an
  error; if it blocks, return to Step 1.
- **Immediately after creation**, post the Step 2 review evidence as a
  PR comment — the CI ai-review verifies it and skips regeneration when
  the head SHA and diff hash match (it waits only briefly, so post
  promptly):

  ```
  gh pr comment <number> --body "$(cat <<'EOF'
  ## Local Review Evidence
  <confirmed findings summary, severity-ordered>

  ### Declared Trade-offs Ledger
  <ledger entries>

  Local-Review-Evidence: head=<head-sha> diff_sha256=<hash> confirmed=<n> refuted=<m> ledger=<k>
  EOF
  )"
  ```

  The evidence line must reflect the FINAL pushed head — recompute it
  after Step 3's commit if anything changed since the review.

## Step 5 — Post-create discipline

- Once the PR enters the merge queue, NEVER push further commits — the
  queue merges the locked candidate and orphans the new push. All fixes
  land before enqueueing.
- Hand the PR off to `/shepherd-prs` (typically running under
  `/loop`) — it reruns infrastructure-class failures, triages new
  review comments adversarially, and verifies the merge landed. No
  authoring session should babysit checks.
- If shepherding manually instead: watch via REST
  (`gh api .../commits/<sha>/check-runs`); on real failure, halt and
  present the error (orchestrator rule 4).
- After merge, verify on-disk `main` (`git pull` + `git log`), not just
  the MERGED status.
