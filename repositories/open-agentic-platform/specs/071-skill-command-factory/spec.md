---
id: "071-skill-command-factory"
title: "Skill and Command Factory"
feature_branch: "071-skill-command-factory"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-31"
amended: "2026-05-26"
amendment_record: |
  amended by spec 182 (2026-05-26) — acknowledges that the OAP
  repository now treats `.claude/skills/<name>/SKILL.md` as the
  primary surface for slash-command-style entries, with
  `.claude/commands/*.md` retained as the legacy single-file form
  during the spec-182 transition window. No behavioral change to
  the factory mechanism; this is a surface-priority note so future
  authors land new entries under `skills/` by default.
authors: ["open-agentic-platform"]
language: en
summary: >
  Formalizes the skill/command pattern absorbed from Claude Code's extensible
  slash command system. Each skill is a self-contained unit with a prompt
  template, allowed tool list, handler type, and optional hooks. Skills are
  discoverable from bundled definitions, .claude/commands/ files (legacy form),
  .claude/skills/<name>/SKILL.md folders (primary surface post-spec-182), and
  plugin manifests. The factory pattern enables one-file skill authoring with
  automatic registration into the tool registry and prompt assembler.
code_aliases: ["SKILL_COMMAND_FACTORY"]
sources: ["claude-code"]
establishes:
  - unit: { kind: crate, id: skill-factory }
---

# Feature Specification: Skill and Command Factory

> **Amended by spec 182 (2026-05-26).** The OAP repository now treats
> `.claude/skills/<name>/SKILL.md` as the primary surface for slash-
> command-style entries. `.claude/commands/*.md` is retained as the
> legacy single-file form during the spec-182 transition window and
> remains in the codebase-indexer's hashed input set (union, not
> swap). The factory mechanism is unchanged.

## Purpose

OAP's `.claude/commands/` directory contains 13 slash commands authored as markdown prompt files. They work well but lack structure — there's no schema for what a command can declare, no allowed-tool restriction, no hook registration, and no discovery mechanism beyond filesystem scan. Adding a new command means knowing the implicit conventions.

Claude Code's command system (`src/commands.ts`, `src/skills/`) formalizes this with three command types (prompt, react, headless), per-command tool allow-lists, skill-level hook registration, and a factory function that handles registration. Their skill system wraps commands with a tool-invocable interface so agents can invoke `/commit` or `/review` programmatically via `SkillTool`.

This spec absorbs that formalization: every slash command becomes a **Skill** with explicit metadata, tool constraints, and hook declarations. The factory pattern makes authoring a skill a single-file operation with automatic registration.

## Scope

### In scope

- **Skill schema** — YAML frontmatter for `.claude/commands/*.md` defining: name, description, type, allowed tools, model override, hooks, trigger conditions
- **Skill factory** — loader that reads skill files, validates frontmatter, and registers them in the tool registry as invocable tools
- **Tool allow-lists** — each skill declares which tools it may use during execution; others are unavailable
- **Skill types** — `prompt` (template rendered to system prompt), `agent` (spawn sub-agent), `headless` (background execution)
- **Programmatic invocation** — skills are registered as tools in the ToolRegistry, enabling agent-to-skill calls
- **Plugin skill loading** — skills from plugin manifests (`.claude/plugins/`) register alongside bundled skills

### Out of scope

- **Skill marketplace** — remote skill discovery and installation
- **Skill versioning** — version management for skill definitions
- **Interactive skills** — React/Ink component-based skills (OAP uses Tauri for interactive UI)

## Requirements

### Functional

**FR-001**: Skill files in `.claude/commands/*.md` MUST support YAML frontmatter with fields: `name`, `description`, `type` (prompt | agent | headless), `allowed_tools` (list of tool names or `*`), `model` (optional model override), `hooks` (optional hook declarations), `trigger` (optional auto-trigger condition).

**FR-002**: The skill factory MUST scan `.claude/commands/`, validate frontmatter against the schema, and register each valid skill into the ToolRegistry.

**FR-003**: When a skill declares `allowed_tools`, only those tools MUST be available during skill execution. All other tools MUST be hidden from the agent's tool list.

**FR-004**: Prompt-type skills MUST render their markdown body as the system prompt for a sub-agent invocation, with `$ARGS` placeholder replaced by the user's arguments.

**FR-005**: Agent-type skills MUST spawn a sub-agent (via Feature 035 dispatch) with the skill's prompt and tool constraints.

**FR-006**: Headless-type skills MUST execute in the background, returning a task ID that can be polled via TaskGet.

**FR-007**: Skills MUST be invocable both as slash commands (`/skill-name args`) and as tool calls (via SkillTool in the ToolRegistry).

**FR-008**: Skills MAY declare hooks that are registered when the skill is loaded. Example: a `/commit` skill that registers a `PostToolUse` hook to verify commit message format.

**FR-009**: Invalid frontmatter MUST produce a warning at load time but MUST NOT prevent other skills from loading.

**FR-010**: Skills from `.claude/plugins/*/commands/*.md` MUST be loaded and registered alongside bundled skills, with plugin-name prefixing to avoid collisions.

### Non-functional

**NF-001**: Skill loading MUST complete in under 100ms for up to 50 skill files.

**NF-002**: Skill definitions MUST be self-documenting — `/help` or listing skills MUST show name, description, and type from frontmatter.

**NF-003**: Skill execution MUST respect the permission runtime (Feature 068) — allowed tools are intersected with permission rules.

## Architecture

### Skill frontmatter schema

```yaml
# .claude/commands/commit.md
---
name: commit
description: Create a git commit with conventional commit message
type: prompt
allowed_tools:
  - Bash
  - FileRead
  - Grep
  - Glob
model: sonnet          # optional: use faster model for this skill
hooks:
  PostToolUse:
    - name: verify-commit-format
      type: bash
      if: "tool == 'Bash' && input.command matches 'git commit*'"
      run: "echo 'Commit created'"
trigger: null          # no auto-trigger; manual invocation only
---

Create a git commit following these steps:
1. Run `git status` and `git diff --staged` to understand changes
2. Draft a conventional commit message (feat/fix/docs/refactor/test)
...
```

### Skill types

```
┌────────────┬──────────────────────────────────────────────┐
│ Type       │ Behavior                                     │
├────────────┼──────────────────────────────────────────────┤
│ prompt     │ Render body as system prompt for sub-agent   │
│            │ Agent runs with allowed_tools only           │
│            │ Result returned to parent conversation       │
├────────────┼──────────────────────────────────────────────┤
│ agent      │ Spawn independent sub-agent via dispatch     │
│            │ Runs with allowed_tools + own context        │
│            │ Can be long-running, returns task ID         │
├────────────┼──────────────────────────────────────────────┤
│ headless   │ Background execution, no user interaction    │
│            │ Returns task ID immediately                  │
│            │ Result retrievable via TaskGet               │
└────────────┴──────────────────────────────────────────────┘
```

### Skill factory

```rust
pub struct SkillFactory {
    registry: Arc<ToolRegistry>,
    hook_registry: Arc<HookRegistry>,
}

impl SkillFactory {
    pub fn load_from_dir(&self, dir: &Path) -> Vec<SkillLoadResult> {
        // 1. Glob for *.md files
        // 2. Parse YAML frontmatter
        // 3. Validate against SkillSchema
        // 4. For each valid skill:
        //    a. Create SkillToolDef implementing ToolDef
        //    b. Register in ToolRegistry
        //    c. Register declared hooks in HookRegistry
        // 5. Return load results (success/warning/error per file)
    }
}

pub struct SkillToolDef {
    pub skill: ParsedSkill,
}

impl ToolDef for SkillToolDef {
    fn name(&self) -> &str { &self.skill.name }

    fn description(&self) -> &str { &self.skill.description }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "args": { "type": "string", "description": "Arguments to pass to the skill" }
            }
        })
    }

    fn execute(&self, input: Value, ctx: &mut ToolContext) -> Result<ToolResult> {
        match self.skill.skill_type {
            SkillType::Prompt => {
                let prompt = self.skill.render_prompt(&input);
                let filtered_tools = ctx.tools.filter(&self.skill.allowed_tools);
                // Invoke sub-agent with prompt + filtered tools
            }
            SkillType::Agent => {
                // Spawn via agent dispatch with skill context
            }
            SkillType::Headless => {
                // Spawn background task, return task ID
            }
        }
    }
}
```

### Loading pipeline

```
Startup
  │
  ├── Scan .claude/commands/*.md
  │     ├── Parse frontmatter (YAML)
  │     ├── Validate against SkillSchema
  │     ├── Warn on invalid, skip
  │     └── Collect valid skills
  │
  ├── Scan .claude/plugins/*/commands/*.md
  │     └── Same pipeline, prefix name with plugin name
  │
  ├── Register each skill as ToolDef in ToolRegistry
  │
  ├── Register skill-declared hooks in HookRegistry
  │
  └── Log skill count and any warnings
```

### Tool allow-list enforcement

```
Skill executes with allowed_tools: [Bash, FileRead, Grep]
  │
  ├── Create filtered ToolContext
  │     tools = ToolRegistry.filter(allowed_tools)
  │
  ├── Sub-agent sees only: Bash, FileRead, Grep
  │     (all other tools hidden from tool list)
  │
  └── Permission runtime still applies
        (allowed_tools ∩ permission_rules)
```

## Implementation approach

1. **Define `SkillSchema`** — Zod/serde schema for the YAML frontmatter fields
2. **Implement frontmatter parser** — extract YAML from markdown files, validate against schema
3. **Implement `SkillToolDef`** — wraps a parsed skill as a `ToolDef` for tool registry registration
4. **Implement `SkillFactory`** — directory scanner + validation + registration pipeline
5. **Implement tool filtering** — `ToolContext` method to create a filtered view with only allowed tools
6. **Wire to startup** — `SkillFactory.load_from_dir()` runs at session init after ToolRegistry is populated
7. **Add `/help` integration** — list all loaded skills with name, description, type
8. **Add plugin skill loading** — scan `.claude/plugins/*/commands/` with name prefixing
9. **Migrate existing commands** — add frontmatter to existing `.claude/commands/*.md` files (backward-compatible: files without frontmatter load as prompt-type with all tools allowed)

## Success criteria

**SC-001**: All 13 existing `.claude/commands/*.md` files load successfully with or without frontmatter (backward compatibility).

**SC-002**: A skill with `allowed_tools: [Bash, FileRead]` cannot invoke FileWrite or any other tool.

**SC-003**: Skills are listed by the ToolRegistry alongside native tools and can be invoked by agents via SkillTool.

**SC-004**: A headless skill returns a task ID immediately; result is retrievable via TaskGet after completion.

**SC-005**: Skills declaring hooks have those hooks registered and firing during skill execution.

**SC-006**: Invalid frontmatter produces a warning at load time but does not prevent other skills from loading.

**SC-007**: Adding a new skill requires creating one `.md` file in `.claude/commands/` — no code changes.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 067-tool-definition-registry | Skills register as ToolDef instances in the ToolRegistry |
| 069-lifecycle-hook-runtime | Skills can declare hooks that register in the HookRegistry |
| 068-permission-runtime | Tool allow-lists are intersected with permission rules |
| 035-agent-governed-execution | Agent-type skills use the dispatch protocol for sub-agent execution |
| 070-prompt-assembly-cache | Prompt-type skills feed their rendered prompt into the assembly pipeline |

## Contract notes

- **Backward compatibility**: Files without YAML frontmatter are treated as prompt-type skills with `allowed_tools: *` and name derived from filename.
- **Name collision**: If a bundled skill and a plugin skill share a name, the bundled skill wins with a warning. Plugin skills are always prefixed (`plugin-name:skill-name`) to avoid this.
- **Frontmatter-only validation**: The markdown body is opaque to the factory — it's a prompt template, not code. Validation only applies to frontmatter fields.
- **Model override**: The `model` field in frontmatter passes through to the sub-agent as a hint; the agent dispatch may override based on availability.

## Risk

**R-001**: Tool allow-list bypass via nested agent calls. **Mitigation**: Tool filtering propagates to all sub-agents spawned by the skill; the filtered context is inherited, not just applied at the top level.

**R-002**: Frontmatter schema evolution breaks existing commands. **Mitigation**: Unknown frontmatter fields are ignored (forward-compatible). Required fields are minimal (name only; all others have defaults).

**R-003**: Plugin skills executing untrusted code. **Mitigation**: Plugin skills go through the same permission runtime as all other tools. The `allowed_tools` list restricts their capability surface.
