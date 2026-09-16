---
id: "056-session-memory"
title: "Session Memory / Project-Object Persistence"
feature_branch: "056-session-memory"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Persistent context across AI sessions that stores decisions, patterns,
  corrections, and notes. A harvesting engine detects signals in conversation
  ("let's go with" = decision, "actually/no" = correction) and writes them to a
  Memory MCP server with importance levels (ephemeral to permanent), expiry
  policies, and project scoping.
code_aliases:
  - SESSION_MEMORY
establishes:
  - unit: { kind: directory, path: product/packages/session-memory }
references:
  - role: historical
    unit: { kind: directory, path: product/packages/memory-mcp }
---

# Feature Specification: Session Memory / Project-Object Persistence

## Purpose

AI coding sessions today are stateless: each new conversation starts from scratch, forcing users to re-explain project conventions, past decisions, and accumulated corrections. Multiple consolidation sources — equilateral-agents (persistent agent context), claudepal (project memory store) — implement partial solutions with incompatible storage formats and no shared harvesting logic.

This feature introduces a Memory MCP server backed by structured storage, with an automatic harvesting engine that extracts durable knowledge from conversations and makes it available to future sessions scoped to the same project.

## Scope

### In scope

- **Memory MCP server**: An MCP-compliant server exposing tools for storing, querying, and deleting memory entries.
- **Memory entry schema**: Each entry carries content, importance level, expiry policy, source session, project scope, and tags.
- **Importance levels**: Five tiers — `ephemeral` (session-only), `short-term` (24h default), `medium-term` (7d default), `long-term` (90d default), `permanent` (no expiry).
- **Harvesting engine**: A post-turn analyzer that detects decision signals, corrections, patterns, and explicit notes in conversation text.
- **Signal detection rules**: Pattern-matched phrases that classify harvested entries (e.g., "let's go with" / "we decided" = decision; "actually" / "no, use" = correction; "remember that" / "note:" = explicit note).
- **Project scoping**: Memories are scoped to a project root (derived from git root or workspace path) so they do not leak across unrelated codebases.
- **Expiry and eviction**: Background sweep removes expired entries; importance can be promoted on re-access.
- **Query interface**: Full-text and tag-based retrieval with relevance ranking, exposed as MCP tools.

### Out of scope

- **Cross-project memory sharing**: Memories stay within a single project scope; global user-level memory is a follow-on feature.
- **Embeddings / vector search**: Initial implementation uses keyword and tag matching; semantic search via embeddings is deferred.
- **UI for memory management**: No desktop or web UI for browsing/editing memories in this feature; memories are accessed via MCP tools.
- **Memory conflict resolution**: When two sessions produce contradictory decisions, no automated merge is attempted — latest-write wins with both entries preserved.

## Requirements

### Functional

- **FR-001**: The Memory MCP server exposes `memory_store`, `memory_query`, `memory_delete`, and `memory_list` tools over the standard MCP tool protocol.
- **FR-002**: Each memory entry includes: `id`, `content`, `importance` (ephemeral | short-term | medium-term | long-term | permanent), `expiresAt` (nullable timestamp), `projectScope` (absolute path), `tags` (string array), `sourceSessionId`, `createdAt`, `updatedAt`, `kind` (decision | correction | pattern | note | preference).
- **FR-003**: The harvesting engine runs after each assistant turn and detects at least four signal categories: decisions, corrections, explicit notes, and pattern observations.
- **FR-004**: Signal detection rules are configurable via a rules file so teams can add project-specific triggers.
- **FR-005**: `memory_query` supports filtering by project scope, tags, kind, importance level, and free-text search against content.
- **FR-006**: On session start, the agent automatically retrieves relevant memories for the current project and includes them in context.
- **FR-007**: Accessing a memory entry via query bumps its `updatedAt` and may promote its importance (e.g., short-term to medium-term after three accesses).

### Non-functional

- **NF-001**: Memory storage uses a local SQLite database per project, requiring no external service dependencies.
- **NF-002**: Harvesting adds < 50ms p95 latency per assistant turn.
- **NF-003**: The memory database supports at least 100,000 entries per project without degraded query performance (< 100ms p95 for filtered queries).

## Architecture

### Memory entry schema

```typescript
interface MemoryEntry {
  id: string;                    // UUID
  content: string;               // The extracted knowledge
  kind: "decision" | "correction" | "pattern" | "note" | "preference";
  importance: "ephemeral" | "short-term" | "medium-term" | "long-term" | "permanent";
  expiresAt: number | null;      // Unix timestamp, null for permanent
  projectScope: string;          // Absolute path to project root
  tags: string[];                // Freeform tags for filtering
  sourceSessionId: string;       // Session that produced this entry
  accessCount: number;           // Bumped on query hits
  createdAt: number;             // Unix timestamp
  updatedAt: number;             // Unix timestamp
}
```

### Harvesting signal rules

```typescript
interface HarvestRule {
  pattern: RegExp;               // Regex matched against assistant/user turns
  kind: MemoryEntry["kind"];     // What kind of memory to create
  importance: MemoryEntry["importance"]; // Default importance level
  extractContent: (match: RegExpMatchArray, fullText: string) => string;
}

// Example built-in rules:
// "let's go with X"        -> decision,   long-term
// "we decided to X"        -> decision,   long-term
// "actually, X" / "no, X"  -> correction, medium-term
// "remember that X"        -> note,       permanent
// "note: X"                -> note,       long-term
// "always use X for Y"     -> preference, permanent
// "the pattern here is X"  -> pattern,    long-term
```

### MCP tool interface

```
memory_store   { content, kind, importance?, tags?, projectScope? }  -> MemoryEntry
memory_query   { text?, tags?, kind?, importance?, projectScope, limit? } -> MemoryEntry[]
memory_delete  { id }  -> { deleted: boolean }
memory_list    { projectScope, kind?, limit?, offset? }  -> MemoryEntry[]
```

### Package structure

```
packages/memory-mcp/
  src/
    index.ts                   -- MCP server entry point
    types.ts                   -- MemoryEntry, HarvestRule, query params
    storage/
      sqlite.ts                -- SQLite persistence layer
      migrations.ts            -- Schema migrations
    harvesting/
      engine.ts                -- Post-turn harvesting orchestrator
      rules.ts                 -- Built-in signal detection rules
      rules-loader.ts          -- Load custom rules from config
    tools/
      store.ts                 -- memory_store tool handler
      query.ts                 -- memory_query tool handler
      delete.ts                -- memory_delete tool handler
      list.ts                  -- memory_list tool handler
    expiry/
      sweeper.ts               -- Background expiry sweep
      promotion.ts             -- Importance promotion on re-access
```

### Data flow

```
User/Assistant conversation turn
  |
  v
Harvesting engine (pattern match against rules)
  |
  v
Detected signals -> memory_store (auto-tagged with kind + importance)
  |
  v
SQLite database (project-scoped)
  |
  v
Next session start -> memory_query (project scope) -> context injection
```

## Implementation approach

1. **Phase 1 -- schema and storage**: Define `MemoryEntry` types, implement SQLite storage layer with migrations, and basic CRUD operations.
2. **Phase 2 -- MCP server**: Stand up the MCP server with `memory_store`, `memory_query`, `memory_delete`, `memory_list` tools.
3. **Phase 3 -- harvesting engine**: Implement the post-turn harvesting engine with built-in signal detection rules for decisions, corrections, notes, and patterns.
4. **Phase 4 -- expiry and promotion**: Add the background expiry sweeper and importance promotion logic on re-access.
5. **Phase 5 -- session integration**: Wire memory retrieval into session startup so relevant memories are automatically loaded into context.
6. **Phase 6 -- custom rules**: Support loading project-specific harvesting rules from a config file.

## Success criteria

- **SC-001**: The Memory MCP server starts and registers four tools (`memory_store`, `memory_query`, `memory_delete`, `memory_list`) accessible via MCP protocol.
- **SC-002**: A stored memory entry persists across server restarts and is retrievable by project scope and tags.
- **SC-003**: The harvesting engine detects at least one decision signal ("let's go with X") and one correction signal ("actually, use Y") from sample conversation text and stores corresponding entries.
- **SC-004**: Expired entries are removed by the sweeper within one sweep cycle after their `expiresAt` timestamp passes.
- **SC-005**: A memory entry accessed three or more times is promoted from `short-term` to `medium-term` importance automatically.
- **SC-006**: On session start for a project with existing memories, relevant entries appear in the agent's initial context.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Memory context injection applies regardless of which provider serves the session |
| 035-agent-governed-execution | Governed execution dispatches the harvesting engine after each turn |

## Risk

- **R-001**: Over-harvesting fills memory with low-value entries, degrading retrieval quality. Mitigation: importance tiers and expiry ensure natural eviction; ephemeral entries auto-expire at session end.
- **R-002**: Signal detection regex rules produce false positives (e.g., "actually" used casually). Mitigation: rules require surrounding context (full phrase matching, not single-word triggers); confidence thresholds can suppress low-confidence matches.
- **R-003**: Large memory databases slow down session-start context loading. Mitigation: query results are capped by limit parameter and ranked by relevance; only top-N entries are injected into context.
