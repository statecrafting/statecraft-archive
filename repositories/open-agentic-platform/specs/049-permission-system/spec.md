---
id: "049-permission-system"
title: "Permission Request System with Memory and Wildcards"
feature_branch: "049-permission-system"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  SDK-level permission request system built on the canUseTool hook with a
  layered decision model (interactive, bypass, disallowed, allowed, prompt).
  Supports wildcard patterns like Bash(git commit:*) for granular tool
  authorization. "Allow & remember" persists decisions across sessions.
  UI surfaces Allow once / Allow & remember / Deny choices.
code_aliases:
  - PERMISSION_SYSTEM
establishes:
  - unit: { kind: crate, id: "@opc/permission-system" }
---

# Feature Specification: Permission Request System with Memory and Wildcards

## Purpose

Agent tool execution requires user consent, but the consent model today is either too coarse (allow all or deny all) or requires per-invocation approval that degrades the interactive experience. Consolidation sources — claudecodeui (permission dialog), crystal (MCP permission bridge) — each implement permission logic with different granularity, persistence, and UI patterns. There is no shared permission model that supports fine-grained wildcard patterns, persistent memory of past decisions, or a layered evaluation pipeline.

This feature introduces a permission system anchored on the SDK `canUseTool` hook. Permissions are evaluated through a layered model — bypass, disallowed, allowed, prompt — with wildcard pattern support and persistent decision memory, so users grant consent once and the system remembers it.

## Scope

### In scope

- **Layered permission model**: Five layers evaluated in order — `interactive` (session is interactive), `bypass` (tool is unconditionally allowed), `disallowed` (tool is unconditionally blocked), `allowed` (tool+pattern matches a remembered grant), `prompt` (ask the user).
- **Wildcard patterns**: Permission rules use patterns like `Bash(git commit:*)`, `Read(/Users/*/projects/**)`, `MCP(server:tool_name)` to match tool invocations at varying granularity.
- **Decision persistence**: "Allow & remember" saves the grant (tool + pattern + scope) to a persistent store so it applies to future sessions.
- **Permission store**: A JSON-backed store (`.claude/permissions.json`) holding granted and denied patterns, scoped per project or global.
- **UI contract**: Three-choice prompt — Allow once, Allow & remember, Deny — surfaced through the SDK permission callback.
- **canUseTool hook integration**: The permission system registers as the `canUseTool` handler in the Claude Code SDK, intercepting every tool invocation before execution.
- **Scope levels**: Permissions can be scoped to `session` (ephemeral), `project` (stored per project directory), or `global` (stored in user config).

### Out of scope

- **Desktop UI implementation**: This feature defines the permission contract and evaluation logic. Rendering the permission dialog in the desktop app is a UI concern.
- **Permission delegation across agents**: Multi-agent permission inheritance is a follow-on concern.
- **Audit logging of permission decisions**: Logging is handled by the observability layer.
- **OAuth / external identity integration**: Permissions are local to the user's machine.

## Requirements

### Functional

- **FR-001**: Every tool invocation passes through the `canUseTool` hook before execution. The hook receives the tool name, input parameters, and session context.
- **FR-002**: The permission evaluator checks layers in order: bypass list, disallowed list, remembered grants, then prompt. The first matching layer determines the outcome.
- **FR-003**: Wildcard patterns support `*` (single segment) and `**` (recursive / any depth) in both tool name and argument positions. Example: `Bash(git:*)` matches any Bash command starting with `git`.
- **FR-004**: When the evaluator reaches the prompt layer, it invokes the UI callback with three options: Allow once (grants for this invocation only), Allow & remember (persists the grant), Deny (blocks the invocation).
- **FR-005**: "Allow & remember" writes the granted pattern and scope to the permission store. Subsequent invocations matching the same pattern skip the prompt.
- **FR-006**: The permission store is a JSON file (`.claude/permissions.json` for project scope, `~/.claude/permissions.json` for global scope) with a schema that records tool, pattern, scope, timestamp, and grant/deny decision.
- **FR-007**: A `disallowed` entry takes precedence over `allowed` entries — explicitly blocked tools cannot be unblocked by a wildcard grant.
- **FR-008**: Permission entries can be listed, revoked, and edited through a CLI subcommand (`claude permissions list`, `claude permissions revoke <pattern>`).
- **FR-009**: When running in non-interactive mode (e.g., CI), the prompt layer is replaced by a configurable default (deny-all or allow-from-list).

### Non-functional

- **NF-001**: Permission evaluation adds < 2ms p99 overhead per tool invocation with up to 500 stored permission entries.
- **NF-002**: The permission store format is human-readable and hand-editable.
- **NF-003**: The wildcard pattern matcher is deterministic — the same pattern and input always produce the same match result.

## Architecture

### Layered evaluation model

```
Tool invocation (tool name + input)
  |
  v
Layer 1: Interactive check
  |  Is this a non-interactive session?
  |  YES --> apply non-interactive default (deny-all or allow-list), DONE
  |  NO  --> continue
  |
  v
Layer 2: Bypass list
  |  Tool matches a bypass pattern?
  |  YES --> ALLOW, DONE
  |  NO  --> continue
  |
  v
Layer 3: Disallowed list
  |  Tool matches a disallowed pattern?
  |  YES --> DENY with reason, DONE
  |  NO  --> continue
  |
  v
Layer 4: Remembered grants
  |  Tool matches a stored "allowed" pattern?
  |  YES --> ALLOW, DONE
  |  NO  --> continue
  |
  v
Layer 5: Prompt user
  |  Display: Allow once / Allow & remember / Deny
  |  User chooses:
  |    Allow once     --> ALLOW (ephemeral)
  |    Allow & remember --> ALLOW + persist pattern
  |    Deny           --> DENY
```

### Wildcard pattern syntax

```
Pattern             Matches
------              -------
Bash(*)             Any Bash invocation
Bash(git:*)         Bash where command starts with "git"
Bash(git commit:*)  Bash where command starts with "git commit"
Read(**)            Any Read invocation on any path
Read(/Users/me/**)  Read on any file under /Users/me/
MCP(server:*)       Any tool on the named MCP server
```

### Package structure

```
packages/permission-system/
  src/
    index.ts                  — Public API: createPermissionHandler
    types.ts                  — PermissionEntry, PermissionScope, PermissionDecision
    evaluator.ts              — Layered evaluation pipeline
    pattern.ts                — Wildcard pattern parser and matcher
    store.ts                  — JSON-backed permission store (read/write/revoke)
    prompt.ts                 — UI callback contract (Allow once / remember / Deny)
    cli.ts                    — CLI subcommands for permission management
    defaults.ts               — Bypass and disallowed default lists
```

### Permission store schema

```json
{
  "version": 1,
  "entries": [
    {
      "id": "a1b2c3",
      "tool": "Bash",
      "pattern": "git commit:*",
      "decision": "allow",
      "scope": "project",
      "createdAt": "2026-03-29T12:00:00Z",
      "expiresAt": null
    }
  ]
}
```

## Implementation approach

1. **Phase 1 — types and pattern matcher**: Define PermissionEntry, PermissionDecision types. Implement the wildcard pattern parser and matcher with `*` and `**` support.
2. **Phase 2 — permission store**: Implement the JSON-backed store with read, write, revoke, and list operations. Support project and global scope paths.
3. **Phase 3 — layered evaluator**: Implement the five-layer evaluation pipeline that consults bypass, disallowed, stored grants, and prompt in order.
4. **Phase 4 — canUseTool hook**: Wire the evaluator into the Claude Code SDK `canUseTool` hook so every tool invocation is intercepted.
5. **Phase 5 — CLI subcommands**: Add `permissions list`, `permissions revoke`, and `permissions clear` CLI subcommands.
6. **Phase 6 — non-interactive defaults**: Implement the configurable default for non-interactive sessions (CI/automation).

## Success criteria

- **SC-001**: A tool invocation matching a bypass pattern is allowed without prompting.
- **SC-002**: A tool invocation matching a disallowed pattern is denied even if a broader allowed wildcard exists.
- **SC-003**: Choosing "Allow & remember" for `Bash(git commit:*)` persists the grant and subsequent `git commit` commands execute without prompting.
- **SC-004**: The pattern `Read(/Users/me/**)` matches `Read(/Users/me/projects/foo/bar.ts)` and does not match `Read(/Users/other/file.ts)`.
- **SC-005**: `claude permissions list` displays all stored permission entries with their patterns, scopes, and timestamps.
- **SC-006**: `claude permissions revoke "Bash(git commit:*)"` removes the entry and subsequent git commit commands prompt again.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 048-hookify-rule-engine | Hook rules may trigger permission checks; permission decisions may be expressed as hook rules |
| 036-safety-tier-governance | Safety tiers inform the default bypass and disallowed lists |
| 035-agent-governed-execution | Governed execution invokes canUseTool before dispatching tools |

## Risk

- **R-001**: Wildcard patterns that are too broad (e.g., `Bash(*)`) could silently grant dangerous permissions. Mitigation: the disallowed list takes precedence over allowed, and a "dangerous commands" disallowed set ships by default.
- **R-002**: The permission store could accumulate stale entries over time. Mitigation: entries support optional `expiresAt` timestamps, and the CLI provides `permissions clear --expired`.
- **R-003**: Pattern matching semantics may be ambiguous for complex tool inputs (e.g., multi-line Bash commands). Mitigation: matching operates on the first line / primary argument by default, with documented rules for multi-value inputs.
