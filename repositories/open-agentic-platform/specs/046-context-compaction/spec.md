---
id: "046-context-compaction"
title: "Context Compaction for Session Resumption"
feature_branch: "046-context-compaction"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
summary: >
  When token usage exceeds a configurable threshold of the context window,
  older messages are replaced with structured summaries. The compactor
  produces <session_context> blocks that preserve task status, file
  modifications, and interruption state so sessions can be resumed
  efficiently without losing critical context.
establishes:
  - unit: { kind: crate, id: "@opc/prompt-assembly" }
---

# Feature Specification: Context Compaction for Session Resumption

## Purpose

Long-running agent sessions accumulate conversation history that eventually exceeds the model's context window. When this happens, the session either fails outright or silently drops early messages, causing the agent to lose track of completed work, open tasks, and modified files. Context compaction solves this by proactively replacing older messages with structured summaries before the window is exhausted, preserving the information needed for seamless continuation.

## Problem statement

- Agent sessions working on multi-step tasks (refactors, multi-file features, debugging chains) routinely exceed 75% of available context within a single sitting.
- Without compaction, the agent re-reads files it already analyzed, re-attempts completed steps, or contradicts earlier decisions.
- Abrupt session interruptions (user closes terminal, network drop, timeout) compound the problem: the next session has zero context about what was in progress.
- Existing solutions either truncate history (losing signal) or rely on the user to manually summarize, which is error-prone and breaks flow.

## Scope

### In scope

- **Compaction trigger**: Token-budget monitor that fires when usage crosses a configurable threshold (default 75% of context window).
- **Programmatic compactor**: A `ProgrammaticCompactor` module that analyzes the conversation, extracts structured metadata, and emits a `<session_context>` summary block.
- **Summary structure**: A well-defined `<session_context>` XML block format covering task status, file modifications, prompt markers, git state, and interruption flags.
- **Preserve-vs-compress policy**: Rules governing which messages are kept verbatim and which are compressed into the summary.
- **Interruption detection**: Heuristics to identify incomplete operations (uncommitted changes, partial tool sequences, unanswered questions) and flag them in the summary.
- **Session init integration**: The session initialization protocol reads any existing `<session_context>` block and hydrates agent state accordingly.

### Out of scope

- **Cross-session persistence to disk**: This spec covers in-context compaction. Persisting summaries to a session store is a future feature.
- **User-editable summaries**: Summaries are system-generated; manual editing is not supported in this iteration.
- **Multi-agent context sharing**: Compacted context is scoped to a single agent session.

## Requirements

### Functional

- **FR-001**: A token budget monitor tracks cumulative token usage (prompt + completion) against the model's context window size. When usage exceeds the configured threshold (default 75%), the compaction process is triggered.
- **FR-002**: The threshold is configurable via agent configuration (environment variable `OAP_COMPACTION_THRESHOLD` or config key `compaction.threshold`), accepting a float between 0.5 and 0.95.
- **FR-003**: The `ProgrammaticCompactor` analyzes the full message history and produces a single `<session_context>` block that replaces all messages older than the most recent N turns (where N is configurable, default 4).
- **FR-004**: The `<session_context>` block contains the following sections:
  - `<task_summary>`: Natural-language description of the overall goal and current progress.
  - `<completed_steps>`: Ordered list of steps already finished, each with a one-line description.
  - `<pending_steps>`: Ordered list of steps remaining or in progress.
  - `<file_modifications>`: List of files created, modified, or deleted during the session, each with a short description of the change.
  - `<git_state>`: Current branch, number of staged/unstaged changes, last commit hash and message, diff stats summary.
  - `<key_decisions>`: Important decisions or constraints established during the session that must not be forgotten.
  - `<interruption>`: Present only if an interruption was detected; contains the interrupted operation, its state, and recommended resumption action.
- **FR-005**: The compactor preserves the following verbatim (never compressed): the system prompt, the most recent N user/assistant turn pairs, any pinned messages explicitly marked with a `<!-- pin -->` annotation, and tool results from the current active operation.
- **FR-006**: The compactor detects interruption conditions by checking for: (a) tool calls without corresponding tool results, (b) uncommitted file modifications with no subsequent commit message, (c) a final assistant message that ends with a question or explicit "next step" language, (d) incomplete multi-step plans where fewer than all steps are marked done.
- **FR-007**: On session initialization, if a `<session_context>` block is present in the conversation history, the session init protocol surfaces it as the first context message so the agent can orient immediately.
- **FR-008**: After compaction, the total token count of the replacement messages (session_context block + preserved recent turns) must not exceed 40% of the context window, leaving at least 60% for continued interaction.

### Non-functional

- **NF-001**: Compaction must complete in under 2 seconds for conversations up to 100k tokens, to avoid perceptible delay.
- **NF-002**: The compactor must be deterministic: the same message history produces the same `<session_context>` block (no random summarization).
- **NF-003**: The `<session_context>` format must be parseable by a simple XML/regex parser without requiring a full XML library.

## Architecture

### Component overview

```
TokenBudgetMonitor
  │
  ├── watches token usage after each turn
  ├── compares against threshold (default 0.75 * context_window)
  └── fires compaction event when exceeded
          │
          v
ProgrammaticCompactor
  │
  ├── analyzes full message history
  ├── extracts structured metadata (tasks, files, git, decisions)
  ├── detects interruption patterns
  ├── applies preserve-vs-compress policy
  └── emits <session_context> block
          │
          v
MessageRewriter
  │
  ├── replaces old messages with <session_context> block
  ├── retains recent N turns verbatim
  └── retains pinned messages
          │
          v
SessionInitProtocol (on next session start)
  │
  └── reads <session_context>, hydrates agent orientation
```

### session_context block format

```xml
<session_context version="1" compacted_at="2026-03-29T14:30:00Z" turn_count_original="47" token_count_original="89234">
  <task_summary>
    Implementing a new feature for multi-file refactoring across the registry consumer module.
    Currently 6 of 9 planned steps are complete.
  </task_summary>

  <completed_steps>
    <step index="1">Created feature branch 044-context-compaction</step>
    <step index="2">Added TokenBudgetMonitor with threshold config</step>
    <step index="3">Implemented ProgrammaticCompactor core logic</step>
  </completed_steps>

  <pending_steps>
    <step index="4">Wire compactor into message pipeline</step>
    <step index="5">Add interruption detection heuristics</step>
  </pending_steps>

  <file_modifications>
    <file path="src/compactor/mod.rs" action="created">Core compaction module with ProgrammaticCompactor struct</file>
    <file path="src/monitor/token_budget.rs" action="created">Token budget tracking and threshold logic</file>
    <file path="src/session/init.rs" action="modified">Added session_context hydration on startup</file>
  </file_modifications>

  <git_state>
    <branch>044-context-compaction</branch>
    <staged_changes>2</staged_changes>
    <unstaged_changes>1</unstaged_changes>
    <last_commit hash="abc1234">feat: add ProgrammaticCompactor core logic</last_commit>
    <diff_stats insertions="342" deletions="18" files_changed="5"/>
  </git_state>

  <key_decisions>
    <decision>Using XML format for session_context to allow simple regex parsing</decision>
    <decision>Default threshold set to 75% after testing showed 80% left insufficient room for tool-heavy turns</decision>
  </key_decisions>

  <interruption detected="true">
    <operation>Modifying src/session/init.rs to add hydration logic</operation>
    <state>File opened and partially edited; 3 of 5 functions updated</state>
    <resumption_hint>Continue editing init.rs — remaining functions: hydrate_git_state, hydrate_pending_steps</resumption_hint>
  </interruption>
</session_context>
```

### Preserve-vs-compress policy

| Content category | Policy | Rationale |
|---|---|---|
| System prompt | Preserve verbatim | Required for agent behavior |
| Most recent N turns (default 4) | Preserve verbatim | Active working context |
| Pinned messages (`<!-- pin -->`) | Preserve verbatim | User-designated critical context |
| Tool results from active operation | Preserve verbatim | Needed for in-flight work |
| Older user/assistant turns | Compress into `<session_context>` | Recoverable via summary |
| Older tool call/result pairs | Compress; extract file paths and outcomes only | High token cost, low resumption value |
| Error messages and stack traces | Compress; preserve error type and file location | Full traces rarely needed for resumption |

### Integration with session init protocol

1. On session start, the init protocol scans the message history for a `<session_context>` block.
2. If found, it is promoted to the first context message after the system prompt.
3. The agent receives an implicit instruction: "A compacted session context is available. Review it before proceeding."
4. The `<interruption>` section, if present, is surfaced with elevated priority so the agent addresses incomplete work first.

## Success criteria

- **SC-001**: When a session exceeds 75% token usage, compaction fires automatically and reduces token usage below 40% while preserving all information listed in FR-004.
- **SC-002**: A compacted session can be resumed by a new agent instance that correctly identifies completed steps, pending steps, and modified files from the `<session_context>` block alone.
- **SC-003**: Interrupted sessions produce a `<session_context>` block with a populated `<interruption>` section that accurately identifies the incomplete operation.
- **SC-004**: The preserved recent turns (FR-005) remain byte-identical after compaction — no content is altered, only older messages are replaced.
- **SC-005**: Round-trip test: a 50-turn session is compacted, resumed, and the resumed agent completes the remaining steps without re-doing completed work or asking for already-provided information.
- **SC-006**: Threshold configuration via `OAP_COMPACTION_THRESHOLD` is respected; setting it to 0.5 triggers compaction earlier, setting it to 0.95 triggers it later.

## Risk

- **R-001**: Compaction may discard nuance from early conversation that later becomes relevant. Mitigation: the `<key_decisions>` section explicitly captures important constraints, and pinned messages provide an escape hatch.
- **R-002**: Interruption detection heuristics may produce false positives (flagging completed work as interrupted). Mitigation: heuristics are conservative — they require multiple signals (e.g., missing tool result AND uncommitted changes) before flagging.
- **R-003**: Very large file modification lists could bloat the `<session_context>` block. Mitigation: FR-008 enforces a 40% ceiling; if exceeded, older file entries are collapsed into a count summary.
