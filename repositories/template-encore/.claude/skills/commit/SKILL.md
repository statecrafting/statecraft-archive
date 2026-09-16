---
name: commit
description: Create a git commit with an impact-focused conventional commit message
---

# Commit

Create a git commit following these steps:

## 1. Analyze staged and unstaged changes

Run these commands to understand the current state:

```
git status
git diff --cached
git diff
git log --oneline -5
```

Review the output carefully. Identify:
- What files are staged vs unstaged
- The nature of each change (new feature, bug fix, refactor, docs, tests, chore)
- The user-visible impact of the changes

## 2. Draft a commit message

Follow these rules strictly:

**Type prefix (required):** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Use optional scope when it clarifies the affected area: `feat(desktop):`, `fix(ci):`, `chore(specs):`
- Match the scoping conventions visible in recent commit history

**Subject line:**
- Maximum 72 characters (hard limit -- count them)
- Lead with the IMPACT or problem solved, not the technique used
- No trailing period
- No emojis

**Good vs bad examples:**
- BAD: `feat: add pre-edit tagging for non-agentic AI providers`
- GOOD: `fix: OpenAI/LMStudio diffs now persist across app restarts`
- BAD: `refactor: extract helper function for validation`
- GOOD: `fix: prevent crash when user input is empty`
- BAD: `feat(desktop): implement checkpoint restore UI components`
- GOOD: `feat(desktop): checkpoint/restore UI panel (Feature 041, Slice G)`

**Body (optional):**
- Separate from subject with a blank line
- Use bullet points (dash prefix) only if there are multiple distinct changes
- Keep each line under 72 characters
- Explain HOW only if it is non-obvious; the subject covers WHAT and WHY

**Issue linking (when applicable):**
- For GitHub issues: `Fixes #XXX` or `Closes #XXX` on its own line after the body

## 3. Stage relevant files

Use `git add` with specific file paths. Do not use `git add -A` or `git add .` unless every changed file belongs in this commit. Never stage files that appear to contain secrets (.env, credentials, tokens).

## 4. Pre-commit gate

Run `make pr-prep` before committing on a PR branch. This regenerates the codebase index and runs the coupling gate (`npx spec-spine couple --base origin/main`) — the two checks that fail first in CI when forgotten. If the index drifted, stage the regenerated `.derived/codebase-index/` shards.

```bash
make pr-prep
```

If `make pr-prep` exits non-zero, fix the reported issue before creating the commit. Do not skip or suppress the gate.

## 5. Create the commit

Use a HEREDOC to pass the message:

```
git commit -m "$(cat <<'EOF'
type(scope): subject line here

Optional body with details.
EOF
)"
```

## 6. Verify

Run `git status` to confirm the commit succeeded and the working tree is in the expected state.

## Banned content

- Do NOT add `Co-Authored-By` or any attribution lines
- Do NOT add marketing taglines, links, or promotional text
- Do NOT add emojis anywhere in the commit message
- Do NOT pad the message with unnecessary details about what was not changed
- Be direct and factual

$ARGUMENTS
