---
id: "050-tool-renderer-system"
title: "Config-Driven Tool Rendering System"
feature_branch: "050-tool-renderer-system"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Config-driven tool rendering replacing hard-coded display logic with a
  ToolDisplayConfig registry. Each tool declares input display, result display,
  content renderers, and color schemes. Supports subagent containers with nested
  tool history and collapsible thinking traces with elapsed time.
code_aliases:
  - TOOL_RENDERER_SYSTEM
establishes:
  - unit: { kind: crate, id: "@opc/tool-renderer" }
---

# Feature Specification: Config-Driven Tool Rendering System

## Purpose

Tool output rendering in the desktop UI is currently hard-coded per tool type, making it difficult to add new tools, customize display behavior, or render subagent output hierarchically. Consolidation sources — claudecodeui (tool display components), deepreasoning (thinking trace display) — each embed rendering logic directly in component trees with tool-specific branching, duplicated color schemes, and no shared configuration for how a tool's input, output, and metadata should be presented.

This feature introduces a `ToolDisplayConfig` registry where each tool declares its rendering configuration. The renderer reads this configuration to produce consistent, customizable tool output without per-tool conditional logic in the UI layer.

## Scope

### In scope

- **ToolDisplayConfig registry**: A configuration-driven registry where each tool id maps to a display config declaring input renderer, result renderer, content renderers, icon, color scheme, and collapse behavior.
- **Input display**: Configurable rendering of tool inputs (e.g., show the Bash command, show the file path for Read, show the query for Search).
- **Result display**: Configurable rendering of tool results (e.g., syntax-highlighted code for file reads, diff view for edits, structured output for API calls).
- **Content renderers**: Pluggable renderer functions for content types (text, code, diff, image, JSON, markdown, error).
- **Color schemes**: Per-tool color theming (accent color, background tint, icon color) defined in config rather than scattered across stylesheets.
- **Subagent container**: A container component that renders a subagent's tool history as a nested, collapsible tree, visually distinguished from the parent agent's output.
- **Thinking traces**: Collapsible thinking/reasoning blocks with elapsed time display, supporting extended thinking output from Claude and other models.
- **Elapsed time**: All tool invocations display wall-clock elapsed time from start to completion.

### Out of scope

- **Tool execution logic**: This feature covers rendering only. Tool dispatch, permission checks, and result collection are separate concerns.
- **Custom user themes**: Full theming support (dark/light, user-defined palettes) is a broader UI concern. This feature defines per-tool color tokens that a theme system can override.
- **Streaming partial rendering**: Progressive rendering of tool output as it streams in is a follow-on optimization.
- **Mobile / responsive layouts**: Desktop rendering only.

## Requirements

### Functional

- **FR-001**: A `ToolDisplayConfig` type defines the rendering configuration for a tool: input display template, result display template, content renderer ids, accent color, icon, and default collapse state.
- **FR-002**: A `ToolDisplayRegistry` maps tool ids (e.g., `"Bash"`, `"Read"`, `"Edit"`, `"MCP"`) to their `ToolDisplayConfig`. Unknown tools fall back to a generic default config.
- **FR-003**: The input display renderer extracts and formats the most relevant fields from the tool's input parameters according to the config's input template.
- **FR-004**: The result display renderer selects the appropriate content renderer based on the result's content type (code, diff, image, JSON, plain text, error).
- **FR-005**: Content renderers are registered by content type id and are reusable across tools. Built-in renderers: `code` (syntax-highlighted), `diff` (unified diff with add/remove coloring), `image` (inline preview), `json` (collapsible tree), `markdown` (rendered), `text` (plain), `error` (styled error block).
- **FR-006**: Each tool invocation block displays elapsed wall-clock time (e.g., "2.3s") from invocation start to result receipt.
- **FR-007**: Subagent tool invocations render inside a visually distinct container that shows the subagent's identity, tool call history as a nested collapsible list, and an aggregate elapsed time.
- **FR-008**: Thinking traces render as collapsible blocks. When collapsed, they show a summary line with elapsed thinking time. When expanded, they show the full thinking text.
- **FR-009**: The registry can be extended at runtime (e.g., MCP tools registering their display config when the MCP server connects).

### Non-functional

- **NF-001**: Adding a new tool's display config requires no changes to renderer core — only a new config entry in the registry.
- **NF-002**: Rendering a tool result block completes in < 16ms (one frame at 60fps) for results up to 500 lines.
- **NF-003**: The config format is serializable to JSON for persistence and transfer between processes.

## Architecture

### ToolDisplayConfig type

```typescript
interface ToolDisplayConfig {
  toolId: string;
  label: string;
  icon: string;
  accentColor: string;
  inputDisplay: {
    fields: string[];            // Fields to extract from input (e.g., ["command"], ["file_path"])
    format: "inline" | "block";  // Inline for short inputs, block for multi-line
    syntaxHighlight?: string;    // Language hint for syntax highlighting
  };
  resultDisplay: {
    contentRenderer: string;     // Content renderer id (e.g., "code", "diff", "json")
    maxCollapsedLines: number;   // Lines shown before "show more"
    syntaxHighlight?: string;    // Language hint
  };
  collapse: {
    defaultState: "expanded" | "collapsed";
    collapseThreshold: number;   // Line count above which auto-collapse
  };
}
```

### Package structure

```
packages/tool-renderer/
  src/
    index.ts                     — Public API
    types.ts                     — ToolDisplayConfig, ContentRenderer, SubagentContainer
    registry.ts                  — ToolDisplayRegistry (register, get, fallback)
    renderers/
      code.ts                    — Syntax-highlighted code blocks
      diff.ts                    — Unified diff with add/remove coloring
      image.ts                   — Inline image preview
      json.ts                    — Collapsible JSON tree
      markdown.ts                — Rendered markdown
      text.ts                    — Plain text
      error.ts                   — Styled error block
    components/
      tool-block.tsx             — Top-level tool invocation block
      input-display.tsx          — Tool input rendering
      result-display.tsx         — Tool result rendering
      subagent-container.tsx     — Nested subagent tool history
      thinking-trace.tsx         — Collapsible thinking block with elapsed time
      elapsed-time.tsx           — Wall-clock elapsed time badge
    configs/
      defaults.ts               — Built-in ToolDisplayConfig entries for standard tools
```

### Rendering flow

```
Tool invocation event
  |
  v
ToolDisplayRegistry.get(toolId) --> ToolDisplayConfig
  |
  v
tool-block component
  |
  +---> elapsed-time badge (start timer)
  |
  +---> input-display component
  |       |
  |       v
  |     Extract fields per config.inputDisplay.fields
  |     Render inline or block per config.inputDisplay.format
  |
  +---> (wait for result)
  |
  +---> result-display component
  |       |
  |       v
  |     Select content renderer per config.resultDisplay.contentRenderer
  |     Render with syntax highlighting, collapse threshold
  |
  +---> elapsed-time badge (stop timer, show duration)

Subagent invocation:
  |
  v
subagent-container component
  |
  +---> Agent identity header (name, model)
  +---> Nested list of tool-block components (recursive)
  +---> Aggregate elapsed time
```

## Implementation approach

1. **Phase 1 — types and registry**: Define ToolDisplayConfig, ContentRenderer interfaces. Implement the ToolDisplayRegistry with register, get, and fallback behavior.
2. **Phase 2 — content renderers**: Implement the seven built-in content renderers (code, diff, image, json, markdown, text, error).
3. **Phase 3 — tool block component**: Build the top-level tool-block component that reads from the registry and delegates to input-display, result-display, and elapsed-time components.
4. **Phase 4 — default configs**: Author ToolDisplayConfig entries for all standard Claude Code tools (Bash, Read, Edit, Write, Glob, Grep, MCP).
5. **Phase 5 — subagent container**: Build the subagent-container component with nested tool history and aggregate timing.
6. **Phase 6 — thinking traces**: Build the collapsible thinking-trace component with elapsed time and summary line.

## Success criteria

- **SC-001**: A Bash tool invocation renders with the command as input, syntax-highlighted output as result, and elapsed time — all driven by config, not hard-coded branching.
- **SC-002**: An Edit tool invocation renders with a diff content renderer showing added/removed lines in color.
- **SC-003**: An unknown tool (e.g., a new MCP tool) renders using the generic fallback config without errors.
- **SC-004**: A subagent's tool calls render inside a nested container visually distinguished from the parent agent's tool calls.
- **SC-005**: A thinking trace block renders collapsed with elapsed time, and expands to show full thinking text on click.
- **SC-006**: Adding a new tool's display config to the registry requires only a new ToolDisplayConfig object — no changes to rendering components.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Provider events include thinking deltas and tool use events that this renderer displays |
| 035-agent-governed-execution | Governed execution produces the tool invocation events this system renders |
| 051-worktree-agents | Background agents' tool output needs subagent container rendering |

## Risk

- **R-001**: Config-driven rendering may not handle edge cases that hard-coded logic covered (e.g., special Bash error formatting). Mitigation: content renderers are pluggable — edge cases get their own renderer rather than conditional branches.
- **R-002**: Nested subagent containers could become deeply nested and hard to navigate. Mitigation: collapse by default after depth 2, with expand-all/collapse-all controls.
- **R-003**: Elapsed time measurement across process boundaries (e.g., MCP tool calls) may be inaccurate. Mitigation: use timestamps from the event stream rather than local timers.
