---
id: warn-large-write
event: PreToolUse
matcher:
  tool: Write
conditions:
  - field: input.content
    matches: "[\\s\\S]{8000,}"
action:
  type: warn
priority: 100
---

This write appears very large (roughly 500+ lines equivalent by character count).
Consider splitting the change or using a patch file.
