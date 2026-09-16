---
id: "070-prompt-assembly-cache"
title: "Prompt Assembly and Cache Boundaries"
feature_branch: "070-prompt-assembly-cache"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-31"
authors: ["open-agentic-platform"]
language: en
summary: >
  Implements modular system prompt assembly with explicit cache boundaries,
  absorbed from Claude Code's prompt architecture. Static sections (tool
  descriptions, behavioral rules, orchestrator rules) are assembled once and
  cached across turns. Dynamic sections (memory, MCP context, workflow state,
  active hooks) rebuild each turn. Integrates with context compaction
  (Feature 046) for bounded-context long sessions.
code_aliases: ["PROMPT_ASSEMBLY_CACHE"]
sources: ["claude-code"]
extends:
  - spec: "046-context-compaction"
    nature: additive
    unit: { kind: directory, path: product/packages/prompt-assembly }
references:
  - role: historical
    unit: { kind: file, path: crates/agent/src/prompt_assembly.rs }
---

# Feature Specification: Prompt Assembly and Cache Boundaries

## Purpose

Claude Code's system prompt (`src/constants/prompts.ts`, 54K LOC) splits into cached static sections and dynamic per-turn sections separated by a `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`. This is not just code organization — it directly reduces API cost because the Anthropic API caches prompt prefixes. Content before the cache boundary is served from cache on subsequent turns; content after the boundary is re-processed each turn.

OAP currently uses flat CLAUDE.md files and `.claude/rules/` loaded as-is into the prompt. There's no caching strategy, no structured assembly, and no integration with the compaction service designed in Feature 046. As OAP adds more context sources (tool registry schemas, hook definitions, workflow state, session memory, MCP server instructions), prompt size will grow and cost will compound.

This spec introduces a prompt assembly pipeline that: (1) organizes prompt content into cacheable and dynamic sections, (2) enforces size budgets per section, (3) integrates with context compaction for long sessions, and (4) provides an extension point for new context sources.

## Scope

### In scope

- **Prompt section registry** — named sections with cache lifetime (static/dynamic), priority, and size budget
- **Cache boundary marker** — explicit separator between static and dynamic content for API prompt caching
- **Section assembly pipeline** — ordered composition of sections into the final system prompt
- **Size budget enforcement** — per-section and total prompt size limits with truncation strategies
- **Context compaction integration** — summarize prior conversation context when approaching budget limits
- **Extension API** — register new prompt sections from tools, hooks, MCP servers, and orchestrator manifests

### Out of scope

- **Prompt content authoring** — this spec covers assembly and caching, not writing the prompts themselves
- **API-level cache implementation** — the Anthropic API handles caching; this spec ensures the prompt format enables it
- **Model-specific prompt tuning** — different models may need different prompts; this spec provides the assembly framework

## Requirements

### Functional

**FR-001**: The prompt assembly pipeline MUST produce a system prompt with two regions: a static prefix (cacheable across turns) and a dynamic suffix (rebuilt each turn), separated by a machine-readable boundary marker.

**FR-002**: Prompt sections MUST be registered with: `name`, `content_fn` (returns string), `cache_lifetime` (static | dynamic | per_session), `priority` (determines order), `max_bytes` (size budget).

**FR-003**: Static sections MUST include: tool registry schemas, behavioral rules (from `.claude/rules/`), CLAUDE.md project instructions, and base system identity.

**FR-004**: Dynamic sections MUST include: session memory (Feature 056), active workflow state (Feature 052), MCP server instructions, active hook summaries, and conversation compaction summaries.

**FR-005**: When total prompt size exceeds the configured budget (default: 100KB), sections MUST be truncated starting from lowest-priority dynamic sections, with a truncation notice appended.

**FR-006**: A compaction trigger MUST fire when conversation context (system prompt + messages) exceeds 80% of the model's context window. Compaction summarizes prior turns into a compact representation that replaces the full history.

**FR-007**: New prompt sections MUST be registerable at runtime via `PromptAssembler.register_section()` without modifying the assembler code.

**FR-008**: The assembler MUST emit the final prompt size and section breakdown as structured metadata for observability.

### Non-functional

**NF-001**: Prompt assembly MUST complete in under 10ms for up to 30 sections (excluding content generation time).

**NF-002**: Static section content MUST be deterministic — same inputs produce byte-identical output for cache effectiveness.

**NF-003**: The assembly pipeline MUST be testable in isolation without an API connection.

## Architecture

### Prompt structure

```
┌─────────────────────────────────────────────┐
│  STATIC PREFIX (cached across turns)        │
│                                             │
│  ┌─ Identity section (priority: 1000)       │
│  ├─ Behavioral rules (priority: 900)        │
│  ├─ Tool registry schemas (priority: 800)   │
│  ├─ CLAUDE.md instructions (priority: 700)  │
│  ├─ Orchestrator rules (priority: 600)      │
│  └─ Base hook definitions (priority: 500)   │
│                                             │
│  ═══ CACHE BOUNDARY ═══                     │
│                                             │
│  DYNAMIC SUFFIX (rebuilt each turn)         │
│                                             │
│  ┌─ Active workflow state (priority: 400)   │
│  ├─ Session memory (priority: 350)          │
│  ├─ MCP server context (priority: 300)      │
│  ├─ Conversation summary (priority: 200)    │
│  ├─ Active hooks summary (priority: 150)    │
│  └─ Environment context (priority: 100)     │
│       (date, git status, model info)        │
└─────────────────────────────────────────────┘
```

### Section registry

```rust
pub struct PromptSection {
    pub name: String,
    pub content_fn: Box<dyn Fn(&AssemblyContext) -> String + Send + Sync>,
    pub cache_lifetime: CacheLifetime,
    pub priority: u32,         // higher = earlier in prompt
    pub max_bytes: usize,      // per-section budget
}

pub enum CacheLifetime {
    Static,       // assembled once, reused across turns
    PerSession,   // assembled once per session, cached within session
    Dynamic,      // rebuilt every turn
}

pub struct PromptAssembler {
    sections: Vec<PromptSection>,  // sorted by priority descending
    total_budget: usize,            // default: 100KB
    cache: HashMap<String, String>, // cached static/per_session content
}
```

### Assembly pipeline

```rust
impl PromptAssembler {
    pub fn assemble(&mut self, ctx: &AssemblyContext) -> AssembledPrompt {
        let mut static_parts = Vec::new();
        let mut dynamic_parts = Vec::new();
        let mut total_size = 0;

        for section in &self.sections {
            let content = match section.cache_lifetime {
                CacheLifetime::Static | CacheLifetime::PerSession => {
                    self.cache.entry(section.name.clone())
                        .or_insert_with(|| (section.content_fn)(ctx))
                        .clone()
                }
                CacheLifetime::Dynamic => (section.content_fn)(ctx),
            };

            let truncated = truncate_to_budget(&content, section.max_bytes);
            total_size += truncated.len();

            if total_size > self.total_budget {
                // Emit truncation notice and stop adding sections
                break;
            }

            match section.cache_lifetime {
                CacheLifetime::Static | CacheLifetime::PerSession =>
                    static_parts.push(truncated),
                CacheLifetime::Dynamic =>
                    dynamic_parts.push(truncated),
            }
        }

        AssembledPrompt {
            static_prefix: static_parts.join("\n"),
            cache_boundary: CACHE_BOUNDARY_MARKER.to_string(),
            dynamic_suffix: dynamic_parts.join("\n"),
            metadata: AssemblyMetadata {
                total_bytes: total_size,
                section_count: static_parts.len() + dynamic_parts.len(),
                truncated_sections: /* ... */,
            },
        }
    }
}
```

### Compaction integration

```
Turn N: context_size = system_prompt + messages
  │
  ├── If context_size < 80% window → normal operation
  │
  └── If context_size >= 80% window → trigger compaction
        │
        ├── Summarize messages[0..N-K] into compact summary
        ├── Replace message history with summary + messages[N-K..N]
        ├── Update "Conversation summary" dynamic section
        └── Log compaction event (messages summarized, new size)
```

### Compaction strategy

```rust
pub struct CompactionService {
    pub summarizer: Box<dyn Fn(&[Message]) -> String>,
    pub window_threshold: f32,  // 0.8 = 80%
    pub keep_recent: usize,     // keep last N messages uncompacted
}

impl CompactionService {
    pub fn should_compact(
        &self,
        prompt_size: usize,
        messages: &[Message],
        model_context_window: usize,
    ) -> bool;

    pub fn compact(
        &self,
        messages: &[Message],
    ) -> CompactionResult;
}
```

## Implementation approach

1. **Define `PromptSection` struct and `PromptAssembler`** in `crates/agent/src/prompt/` (new module)
2. **Register static sections** — identity, rules, tool schemas, CLAUDE.md
3. **Register dynamic sections** — workflow state, session memory, MCP context
4. **Implement cache boundary** — literal marker string that the API client recognizes for cache-point placement
5. **Implement size budgets** — per-section truncation with configurable limits
6. **Implement compaction trigger** — monitor context size, invoke summarizer when threshold exceeded
7. **Wire to SDK bridge** (Feature 045) — the assembled prompt feeds into Claude API calls
8. **Add observability** — log section sizes, cache hit rates, compaction events

## Success criteria

**SC-001**: Static sections produce byte-identical content across turns, enabling API prompt caching.

**SC-002**: Adding a new prompt section requires one `register_section()` call; no existing code changes needed.

**SC-003**: When total prompt exceeds 100KB, lowest-priority sections are truncated with a notice; no silent data loss.

**SC-004**: Context compaction fires at 80% context window usage and reduces message history to a summary + recent messages.

**SC-005**: Assembly metadata logs show section names, sizes, and cache hit/miss for each turn.

**SC-006**: `cargo test -p agent -- prompt` passes with tests for: section ordering, budget enforcement, cache hit/miss, compaction trigger.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 046-context-compaction | This spec implements the compaction trigger and integration point |
| 045-claude-code-sdk-bridge | Assembled prompt feeds into the SDK bridge's API calls |
| 067-tool-definition-registry | Tool schemas are a static prompt section |
| 056-session-memory | Session memory is a dynamic prompt section |
| 052-state-persistence | Active workflow state is a dynamic prompt section |

## Risk

**R-001**: Cache invalidation — static sections that change (e.g., CLAUDE.md edited mid-session) produce stale cache. **Mitigation**: File watcher invalidates cached sections on source file change. `PerSession` lifetime covers sections that change rarely but aren't truly static.

**R-002**: Compaction loses important context. **Mitigation**: Always keep the last K messages uncompacted (default: 10). Compaction summaries include key decisions and state changes, not just a narrative.

**R-003**: Different models have different context windows. **Mitigation**: `model_context_window` is passed to the compaction threshold check; the assembler doesn't hardcode a window size.
