---
id: block-force-push
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    matches: "git push.*--force"
action:
  type: block
priority: 10
---

Force-pushing to a remote branch rewrites public history and can cause data
loss for collaborators. Use `--force-with-lease` instead, or coordinate with
the team before force-pushing.
