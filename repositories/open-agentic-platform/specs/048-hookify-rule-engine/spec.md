---
id: "048-hookify-rule-engine"
title: "Declarative Hook Rule Engine"
feature_branch: "048-hookify-rule-engine"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Declarative rule engine that intercepts Claude Code lifecycle events
  (PreToolUse, PostToolUse, UserPromptSubmit, Stop) using markdown-defined rules
  with YAML frontmatter. Rules specify matchers, conditions, and actions
  (block, warn, modify). Ships a hooks.json manifest for Claude Code plugin
  integration.
code_aliases:
  - HOOKIFY_RULE_ENGINE
establishes:
  - unit: { kind: crate, id: "@opc/hookify-rule-engine" }
---

# Feature Specification: Declarative Hook Rule Engine

## Purpose

Claude Code exposes lifecycle hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop) but configuring behavior around those hooks today requires imperative code scattered across multiple projects. Consolidation sources — claude-code (Hookify module), ruflo (19-event hook system), claudepal (plugin hooks) — each implement hook-driven logic with their own formats, condition languages, and action semantics.

This feature introduces a declarative rule engine where rules are authored as markdown files with YAML frontmatter. Each rule declares which events it matches, under what conditions it fires, and what action it takes. A `hooks.json` manifest registers the engine as a Claude Code plugin so rules are evaluated automatically during agent execution.

## Scope

### In scope

- **Rule file format**: Markdown files with YAML frontmatter defining event matcher, conditions, and action. The markdown body provides human-readable rationale displayed when a rule fires.
- **Event matchers**: Pattern-based matching on event type (PreToolUse, PostToolUse, UserPromptSubmit, Stop) and event payload fields (tool name, input patterns, output patterns).
- **Condition language**: A small expression grammar supporting field comparisons, glob matching, regex matching, and boolean combinators (AND, OR, NOT).
- **Action types**: `block` (prevent the operation and return a message), `warn` (emit a warning but allow), `modify` (transform the event payload before it proceeds).
- **hooks.json manifest**: A Claude Code plugin manifest that registers the rule engine as the handler for all supported lifecycle events.
- **Rule loading and hot-reload**: Rules are loaded from a configurable directory. File changes trigger re-evaluation of the rule set without restarting the agent session.
- **Rule priority and ordering**: Rules declare a numeric priority; when multiple rules match, they execute in priority order. A `block` action short-circuits remaining rules.
- **Built-in rule library**: A starter set of rules covering common safety patterns (e.g., block destructive git commands, warn on large file writes, block credential file reads).

### Out of scope

- **Visual rule editor**: No GUI for authoring rules in this feature.
- **Rule versioning or Git-based rule management**: Rules are plain files; version control is the user's responsibility.
- **Cross-session rule state**: Rules are stateless per evaluation. Persistent counters or rate-limiting across sessions is a follow-on concern.
- **Custom action plugins**: Only the three built-in action types (block, warn, modify) are supported. User-defined action handlers are deferred.

## Requirements

### Functional

- **FR-001**: Rules are defined as markdown files with YAML frontmatter. The frontmatter contains `event`, `matcher`, `conditions`, `action`, and `priority` fields.
- **FR-002**: The engine evaluates all loaded rules against each incoming lifecycle event and executes matching rules in priority order (lowest number = highest priority).
- **FR-003**: A `block` action prevents the intercepted operation, returns the rule's markdown body as the block reason, and short-circuits further rule evaluation for that event.
- **FR-004**: A `warn` action emits a user-visible warning containing the rule's markdown body but allows the operation to proceed.
- **FR-005**: A `modify` action applies a transformation defined in the rule's `action.transform` field to the event payload before passing it downstream.
- **FR-006**: The condition language supports field access (`tool.name`, `input.command`), comparisons (`==`, `!=`, `contains`, `matches`), glob patterns, regex patterns, and boolean combinators (`AND`, `OR`, `NOT`).
- **FR-007**: A `hooks.json` file is generated or maintained that registers the rule engine as the handler for PreToolUse, PostToolUse, UserPromptSubmit, and Stop events in Claude Code plugin format.
- **FR-008**: Rules are loaded from a configurable directory (default: `.claude/hooks/rules/`). Adding, removing, or modifying a rule file takes effect on the next event evaluation without restart.
- **FR-009**: When a rule has a syntax error or invalid condition, the engine logs a diagnostic and skips that rule rather than failing the entire hook pipeline.

### Non-functional

- **NF-001**: Rule evaluation for a single event completes in < 10ms p99 with up to 100 loaded rules.
- **NF-002**: The rule file format is self-documenting — the markdown body serves as both the user-facing message and the rule's documentation.
- **NF-003**: The engine is testable in isolation: rules can be evaluated against synthetic events without a running Claude Code session.

## Architecture

### Rule file format

```markdown
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
```

### Engine structure

```
packages/hookify-rule-engine/
  src/
    index.ts                  — Public API: loadRules, evaluate, register
    types.ts                  — Rule, Condition, Action, EventPayload types
    parser.ts                 — Markdown + YAML frontmatter parser
    matcher.ts                — Event type and payload field matching
    conditions.ts             — Condition expression evaluator
    actions.ts                — Block, warn, modify action executors
    loader.ts                 — File-system rule loader with hot-reload
    hooks-json.ts             — hooks.json manifest generator
  rules/
    block-force-push.md       — Built-in: block git push --force
    block-credential-read.md  — Built-in: block reading .env, credentials
    warn-large-write.md       — Built-in: warn on writes > 500 lines
```

### Evaluation flow

```
Claude Code lifecycle event (e.g., PreToolUse)
  |
  v
hooks.json routes to rule engine
  |
  v
Engine filters rules by event type
  |
  v
For each matching rule (sorted by priority):
  |
  +---> Evaluate conditions against event payload
  |       |
  |       +---> Conditions met?
  |               |
  |               YES --> Execute action (block / warn / modify)
  |               |         |
  |               |         +---> block? Return block reason, stop.
  |               |         +---> warn? Emit warning, continue.
  |               |         +---> modify? Transform payload, continue.
  |               |
  |               NO  --> Skip rule, continue.
  |
  v
Return (possibly modified) event payload to Claude Code
```

### hooks.json integration

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "hookify-rule-engine evaluate --event PreToolUse" }],
    "PostToolUse": [{ "command": "hookify-rule-engine evaluate --event PostToolUse" }],
    "UserPromptSubmit": [{ "command": "hookify-rule-engine evaluate --event UserPromptSubmit" }],
    "Stop": [{ "command": "hookify-rule-engine evaluate --event Stop" }]
  }
}
```

## Implementation approach

1. **Phase 1 — types and parser**: Define Rule, Condition, Action types. Implement the markdown+YAML frontmatter parser that produces Rule objects.
2. **Phase 2 — condition evaluator**: Implement the condition expression grammar supporting field access, comparisons, globs, regex, and boolean combinators.
3. **Phase 3 — action executors**: Implement block, warn, and modify action handlers that produce the appropriate response for Claude Code hooks.
4. **Phase 4 — engine core**: Wire matcher, condition evaluator, and action executors into the main `evaluate()` function with priority ordering and short-circuit logic.
5. **Phase 5 — loader and hot-reload**: Implement file-system rule loading with file-watch for hot-reload.
6. **Phase 6 — hooks.json and built-in rules**: Generate the hooks.json manifest and ship the starter rule library.

## Success criteria

- **SC-001**: A `block` rule matching `git push --force` in a Bash PreToolUse event prevents the tool call and returns the rule's rationale.
- **SC-002**: A `warn` rule fires and emits a visible warning while allowing the operation to complete.
- **SC-003**: A `modify` rule transforms the event payload (e.g., appends `--dry-run` to a command) and the modified payload is what Claude Code executes.
- **SC-004**: Adding a new rule file to the rules directory takes effect on the next event without restarting the session.
- **SC-005**: A rule with invalid YAML is skipped with a logged diagnostic; other rules continue to function.
- **SC-006**: The hooks.json manifest registers the engine for all four lifecycle events and Claude Code invokes it correctly.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 035-agent-governed-execution | Governed execution dispatches tool calls that this engine intercepts via hooks |
| 036-safety-tier-governance | Safety tier rules may be expressed as hookify rules for declarative enforcement |
| 049-permission-system | Permission decisions may consult hook rules before prompting the user |

## Risk

- **R-001**: The condition expression grammar could grow unbounded in complexity. Mitigation: start with a minimal grammar (field comparisons + boolean combinators) and extend only when concrete use cases demand it.
- **R-002**: Hot-reload of rules during active evaluation could cause race conditions. Mitigation: rule sets are loaded atomically — a snapshot is taken at the start of each evaluation cycle.
- **R-003**: Claude Code's hook format may evolve across versions. Mitigation: the hooks.json generator is version-aware and can emit different manifest formats.
