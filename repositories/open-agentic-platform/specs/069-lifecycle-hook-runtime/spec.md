---
id: "069-lifecycle-hook-runtime"
title: "Lifecycle Hook Runtime"
feature_branch: "069-lifecycle-hook-runtime"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-31"
authors: ["open-agentic-platform"]
language: en
summary: >
  Wires the hookify rule engine (Feature 048) into a production runtime with
  the 6-event lifecycle taxonomy proven by Claude Code. Adds hook execution
  for SessionStart, SessionStop, PreToolUse, PostToolUse, UserPromptSubmit,
  and FileChanged events. Supports bash, agent, and prompt handler types with
  multi-source registration from settings, hook rule files, and orchestrator
  manifests.
code_aliases: ["LIFECYCLE_HOOK_RUNTIME"]
sources: ["claude-code"]
extends:
  - spec: "048-hookify-rule-engine"
    nature: wrapping
    unit: { kind: crate, id: "@opc/hookify-rule-engine" }
compliance:
  - framework: "owasp-asi-2026"
    # The Architecture §"Hook definition schema" ships canonical worked
    # examples (block-credential-read, block-force-push) — these patterns
    # are part of what the spec delivers, not just capabilities the
    # runtime would *enable*. ASI05 via the credential-read hook example
    # (blocks FileRead on `*.env`/`*.key`/`*.pem`). ASI09 via the
    # force-push and credential-write hook examples (blocks destructive
    # Bash patterns at PreToolUse).
    controls: ["ASI05", "ASI09"]
---

# Feature Specification: Lifecycle Hook Runtime

## Purpose

Feature 048 designed the hookify rule engine — markdown rules with YAML frontmatter that match lifecycle events and fire block/warn/modify actions. The rule engine package (`product/packages/hookify-rule-engine/`) is scaffolded but not wired to a runtime.

Claude Code's hook system (`src/utils/hooks/`, `src/schemas/hooks.ts`) proves that 6 lifecycle events cover the full agent execution surface: `sessionStart`, `sessionStop`, `pre/postToolCall`, `userPromptSubmit`, and `fileChanged`. Handlers can be bash commands, agent prompts, or interactive prompts. Hooks are registered from multiple sources — settings.json, memory frontmatter, and skill registration.

This spec implements the runtime that connects Feature 048's rule engine to the tool registry (Feature 067) and permission runtime (Feature 068), creating a fully extensible lifecycle interception layer.

## Scope

### In scope

- **6-event lifecycle** — SessionStart, SessionStop, PreToolUse, PostToolUse, UserPromptSubmit, FileChanged
- **3 handler types** — bash (shell command), agent (spawn sub-agent with prompt), prompt (interactive user query)
- **Multi-source registration** — hooks from settings.json, `.claude/hooks/rules/*.md`, orchestrator manifests, and programmatic API
- **Execution engine** — ordered hook dispatch with priority, short-circuit on block, timeout enforcement
- **Hot-reload** — file watcher on `.claude/hooks/rules/` for rule changes without restart
- **Integration** — ToolRegistry emits PreToolUse/PostToolUse; QueryEngine emits UserPromptSubmit; session manager emits Start/Stop

### Out of scope

- **HTTP webhook handlers** — Claude Code supports these but OAP can add them later as an additional handler type
- **Rule authoring UI** — OPC can render hooks but this spec covers the engine, not the editor
- **Cross-session hook state** — hooks are stateless per invocation; persistent state uses session memory (Feature 056)

## Requirements

### Functional

**FR-001**: The runtime MUST support 6 lifecycle events: `SessionStart`, `SessionStop`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `FileChanged`.

**FR-002**: Each event MUST carry a typed payload:
- `PreToolUse`: tool name, input, permission result
- `PostToolUse`: tool name, input, output, duration, error (if any)
- `UserPromptSubmit`: prompt text, session context
- `SessionStart`: session ID, project path, settings snapshot
- `SessionStop`: session ID, duration, tool call count
- `FileChanged`: file path, change type (create/modify/delete), content hash

**FR-003**: Handlers MUST be one of: `bash` (execute shell command, capture stdout/stderr), `agent` (spawn sub-agent with prompt template, capture result), `prompt` (display question to user, capture answer).

**FR-004**: Hooks MUST execute in priority order (highest first). A `block` action from any hook MUST short-circuit remaining hooks and prevent the triggering operation.

**FR-005**: Hooks MUST be registerable from: (a) `settings.json` under `hooks` key, (b) `.claude/hooks/rules/*.md` files with YAML frontmatter, (c) orchestrator workflow manifests, (d) programmatic `HookRegistry.register()` API.

**FR-006**: Bash handlers MUST have a configurable timeout (default: 30 seconds). Timeout MUST be treated as a `warn` (log and continue), not a `block`.

**FR-007**: Agent handlers MUST receive the event payload as context and return a structured result (block/warn/modify + message).

**FR-008**: File changes in `.claude/hooks/rules/` MUST trigger hot-reload of affected rules within 2 seconds.

**FR-009**: Hook execution failures (handler crash, timeout) MUST NOT block the triggering operation unless the hook explicitly declares `failMode: block`.

### Non-functional

**NF-001**: PreToolUse hook dispatch overhead MUST be under 5ms when no hooks match (hot path optimization).

**NF-002**: All hook executions MUST be logged with: event type, hook name, handler type, duration, result (block/warn/allow/modify).

**NF-003**: The hook registry MUST support at least 100 registered hooks without degradation.

## Architecture

### Event taxonomy

```
SessionStart ──────────────────────────────────────── SessionStop
     │                                                      │
     ├── UserPromptSubmit                                   │
     │        │                                             │
     │        ├── PreToolUse ──── [execute] ──── PostToolUse│
     │        ├── PreToolUse ──── [execute] ──── PostToolUse│
     │        └── ...                                       │
     │                                                      │
     └── FileChanged (async, polled) ───────────────────────┘
```

### Hook definition schema

```yaml
# In settings.json
hooks:
  PreToolUse:
    - name: "block-force-push"
      type: bash
      if: "tool == 'Bash' && input.command matches 'git push --force*'"
      run: "echo 'Force push blocked by policy'"
      action: block
      priority: 100
    - name: "log-file-writes"
      type: bash
      if: "tool == 'FileWrite'"
      run: "echo $HOOK_TOOL_INPUT >> /tmp/write-audit.log"
      action: warn
      priority: 50
  SessionStart:
    - name: "greet"
      type: prompt
      run: "Session started for project: $HOOK_PROJECT_PATH"
      priority: 10
```

```markdown
# .claude/hooks/rules/block-credential-read.md
---
event: PreToolUse
action: block
priority: 100
failMode: block
---

Block any attempt to read credential files.

## Condition
tool == 'FileRead' && input.path matches '*.env' || input.path matches '*.key' || input.path matches '*.pem'

## Message
Reading credential files is blocked by project policy. Use environment variables instead.
```

### Hook registry

```rust
pub struct HookRegistry {
    hooks: Vec<RegisteredHook>,  // sorted by priority descending
    watcher: Option<FileWatcher>,
}

pub struct RegisteredHook {
    pub name: String,
    pub event: LifecycleEvent,
    pub condition: Option<CompiledCondition>,
    pub handler: HookHandler,
    pub action: HookAction,      // Block | Warn | Modify | Allow
    pub priority: i32,
    pub fail_mode: FailMode,     // Warn | Block
    pub timeout_ms: u64,
    pub source: HookSource,      // Settings | RuleFile | Manifest | Programmatic
}

pub enum HookHandler {
    Bash { command: String },
    Agent { prompt_template: String },
    Prompt { message: String },
}

pub enum HookAction {
    Block(String),    // prevent operation + reason
    Warn(String),     // log warning, continue
    Modify(Value),    // transform payload
    Allow,            // explicit allow (override lower-priority blocks)
}
```

### Execution engine

```rust
impl HookRegistry {
    pub async fn dispatch(
        &self,
        event: LifecycleEvent,
        payload: &EventPayload,
    ) -> HookResult {
        let matching = self.hooks.iter()
            .filter(|h| h.event == event && h.matches(payload));

        for hook in matching {
            let result = match &hook.handler {
                HookHandler::Bash { command } =>
                    execute_bash(command, payload, hook.timeout_ms).await,
                HookHandler::Agent { prompt_template } =>
                    execute_agent(prompt_template, payload).await,
                HookHandler::Prompt { message } =>
                    execute_prompt(message).await,
            };

            match result {
                Ok(HookAction::Block(reason)) => return HookResult::Blocked(reason),
                Ok(HookAction::Modify(patch)) => payload.apply(patch),
                Ok(HookAction::Warn(msg)) => log::warn!("{}", msg),
                Ok(HookAction::Allow) => continue,
                Err(e) if hook.fail_mode == FailMode::Block =>
                    return HookResult::Blocked(format!("Hook {} failed: {}", hook.name, e)),
                Err(e) => log::warn!("Hook {} failed (non-blocking): {}", hook.name, e),
            }
        }

        HookResult::Allowed
    }
}
```

### Environment variables passed to bash handlers

| Variable | Content |
|----------|---------|
| `HOOK_EVENT` | Event type (PreToolUse, PostToolUse, etc.) |
| `HOOK_TOOL` | Tool name (for tool events) |
| `HOOK_TOOL_INPUT` | JSON-serialized tool input |
| `HOOK_TOOL_OUTPUT` | JSON-serialized tool output (PostToolUse only) |
| `HOOK_SESSION_ID` | Current session identifier |
| `HOOK_PROJECT_PATH` | Git root of the current project |
| `HOOK_PROMPT` | User prompt text (UserPromptSubmit only) |
| `HOOK_FILE_PATH` | Changed file path (FileChanged only) |

## Implementation approach

1. **Define event types and payloads** in `product/packages/hookify-rule-engine/src/events.ts` (extending existing scaffolding)
2. **Implement hook registry** with priority sorting and condition compilation
3. **Implement bash handler** — spawn subprocess with env vars, capture output, enforce timeout
4. **Implement agent handler** — invoke agent dispatch (Feature 035) with prompt template + payload context
5. **Implement prompt handler** — emit `AskUser` event for OPC to render
6. **Wire to ToolRegistry** (Feature 067) — `execute()` calls `dispatch(PreToolUse)` before and `dispatch(PostToolUse)` after tool execution
7. **Wire to session manager** — emit SessionStart/SessionStop at session boundaries
8. **Add file watcher** on `.claude/hooks/rules/` for hot-reload
9. **Add settings.json parser** for hooks declared in settings

## Success criteria

**SC-001**: A `PreToolUse` hook with `action: block` prevents the tool from executing and returns the block reason.

**SC-002**: Hooks from settings.json, `.claude/hooks/rules/*.md`, and programmatic registration all fire correctly for matching events.

**SC-003**: A bash handler that exceeds its timeout is logged as a warning and does not block the operation (unless `failMode: block`).

**SC-004**: Adding a new `.md` rule file to `.claude/hooks/rules/` takes effect within 2 seconds without restart.

**SC-005**: PreToolUse dispatch with no matching hooks adds less than 5ms overhead.

**SC-006**: All hook executions appear in the audit log with event type, hook name, handler type, duration, and result.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 048-hookify-rule-engine | This spec implements the runtime for 048's rule engine design |
| 067-tool-definition-registry | ToolRegistry calls hook dispatch around tool execution |
| 068-permission-runtime | Permission decisions are available as PreToolUse payload context |
| 035-agent-governed-execution | Agent handlers use the dispatch protocol for sub-agent execution |
| 052-state-persistence | Hook state (denial counts, execution logs) can be persisted for session resume |

## Risk

**R-001**: Bash handlers as an attack vector (arbitrary command execution). **Mitigation**: Hooks are configured by the project owner (checked into `.claude/`); runtime refuses hooks from untrusted sources. Shell commands are executed with the same permissions as the user.

**R-002**: Hook condition language complexity. **Mitigation**: Start with simple field matching (equality, glob, regex). Defer complex expression evaluation (AST-based) to a future iteration.

**R-003**: Circular hooks (hook triggers tool that triggers hook). **Mitigation**: The runtime sets a `in_hook` flag during dispatch; hooks are not re-entrant.
