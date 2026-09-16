---
id: "054-agent-frontmatter-schema"
title: "Unified Agent and Skill Frontmatter Schema"
feature_branch: "054-agent-frontmatter-schema"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
risk: medium
depends_on:
  - "035-agent-governed-execution"
  - "036-safety-tier-governance"
  - "067-tool-definition-registry"
  - "068-permission-runtime"
  - "071-skill-command-factory"
  - "093-spec-driven-preflight"
  - "098-governance-enforcement-stitching"
summary: >
  Unified YAML frontmatter schema that formalizes and merges the three divergent
  agent/skill definition formats (Claude Code agents, skill-factory skills, factory
  pipeline agents) into one canonical schema. Progressive disclosure loads metadata
  eagerly, instructions on activation, and resources on demand. Governance-aware
  fields connect agent declarations to safety tiers, spec-driven preflight, and
  enforcement stitching.
code_aliases:
  - AGENT_FRONTMATTER
  - SKILL_SCHEMA
establishes:
  - unit: { kind: crate, id: agent-frontmatter }
  - unit: { kind: file, path: standards/schemas/frontmatter/agent-frontmatter.schema.json }
---

# Feature Specification: Unified Agent and Skill Frontmatter Schema

## Purpose

The codebase has three incompatible frontmatter formats for agent and skill definitions:

| Format | Location | Fields | Parsed by |
|--------|----------|--------|-----------|
| Claude Code agents | `.claude/agents/*.md` | `name`, `description`, `tools`, `model` | Claude Code runtime |
| Skills | `.claude/commands/*.md` | `name`, `description`, `type`, `allowed_tools`, `model`, `hooks`, `trigger` | `crates/skill-factory/src/parser.rs` |
| Factory agents | `factory/process/agents/*.md` | `id`, `role`, `tier`, `model_hint` | `crates/factory-contracts/src/agent_loader.rs` |

Additionally, the desktop `Agent` struct expresses safety as three booleans (`enable_file_read/write/network`) and `AgentRegistryEntry` carries only `id` + `description` — too sparse for governance-aware team selection.

The governed convergence plan (specs 089-099) introduced spec-driven preflight gating (093) and governance enforcement stitching (098). Agent metadata must now express governance requirements so the runtime can gate execution appropriately. A unified schema makes this possible without every consumer implementing its own parsing and validation.

This spec formalizes a single frontmatter schema that all three formats map to, with aliases for backward compatibility and governance-aware fields that connect to the post-convergence runtime.

## Scope

### In scope

- **Unified frontmatter schema**: A single YAML frontmatter definition that subsumes all three existing formats. Existing files parse unchanged through field aliases and defaults.
- **Progressive disclosure**: Three-tier loading — metadata always parsed, instructions loaded on activation, resources loaded on demand.
- **Governance-aware fields**: Safety tier declaration, mutation capability, governance requirement, and spec-risk ceiling that feed into specs 093 and 098.
- **Shared Rust crate**: A thin `agent-frontmatter` crate owning the canonical types, depended on by `skill-factory` and `factory-contracts`.
- **JSON Schema**: Machine-readable schema for IDE autocompletion and CI validation.
- **Quality linter**: Validation rules for contributed agent/skill definitions.
- **Field aliases**: `id` -> `name`, `role` -> `display_name`, `model_hint` -> `model`, `tools` -> `allowed_tools` for backward compatibility.

### Out of scope

- **Agent runtime behavior**: This spec defines metadata, not execution semantics.
- **Agent marketplace or distribution**: Publishing to external registries is a follow-on.
- **Visual editor**: No UI for authoring frontmatter.
- **Multi-provider routing**: Provider selection based on `model` field is deferred to spec 042.

## Requirements

### Functional

- **FR-001**: Agent and skill definition files use YAML frontmatter (delimited by `---`) with a unified field set defined in this spec.
- **FR-002**: Required field: `name` (string, unique identifier, kebab-case enforced).
- **FR-003**: Recommended field: `description` (string, minimum 50 characters for linting). For agents intended for automated routing, the description should include a trigger condition clause.
- **FR-004**: The `type` field (enum: `prompt`, `agent`, `headless`, `process`, `scaffold`) determines execution semantics. Default: `prompt`. The first three values correspond to `SkillType` in `crates/skill-factory/src/types.rs`. The latter two are factory-specific.
- **FR-005**: The `allowed_tools` field uses the existing `AllowedTools` type from `crates/skill-factory/src/types.rs` — either `"*"` (wildcard) or an array of tool names. Default: `"*"`. The field `tools` is accepted as an alias.
- **FR-006**: The `safety_tier` field (enum: `tier1`, `tier2`, `tier3`) declares the agent's safety classification, mapping to `ToolTier` in `crates/agent/src/safety.rs`. When declared, it acts as a ceiling — the agent cannot invoke tools above its declared tier regardless of individual tool tiers.
- **FR-007**: The `mutation` field (enum: `read-only`, `read-write`, `full`) is a structured replacement for the desktop's `enable_file_read/write/network` booleans. Derivable from `safety_tier` when absent: `tier1` -> `read-only`, `tier2` -> `read-write`, `tier3` -> `full`.
- **FR-008**: The `governance` field (enum: `none`, `advisory`, `enforced`) declares the agent's governance requirement. Connects to spec 098's `governance_mode`. When `enforced`, the agent must pass preflight checks before execution.
- **FR-009**: The `max_spec_risk` field (string: `low`, `medium`, `high`, `critical`) declares the maximum spec risk level the agent should operate under. Connects to spec 093's risk gating via `ToolCallContext.max_spec_risk`.
- **FR-010**: Progressive disclosure is implemented in three tiers:
  - **Tier 1 (metadata)**: Frontmatter fields are always parsed for catalog listing, search, and filtering.
  - **Tier 2 (instructions)**: The full markdown body is loaded only when the agent or skill is activated.
  - **Tier 3 (resources)**: External resources (tool schemas, context files) are loaded on demand during execution.
- **FR-011**: A JSON Schema file is generated from the canonical Rust types (via `schemars` or equivalent), enabling IDE autocompletion and CI validation.
- **FR-012**: Field aliases ensure backward compatibility: `id` maps to `name`, `role` maps to `display_name`, `model_hint` maps to `model`, `tools` maps to `allowed_tools`, `tier` (u8) maps to `safety_tier`.
- **FR-013**: Unknown frontmatter fields are preserved through parse-serialize round-trips (forward compatibility via `serde(flatten)`).
- **FR-014**: A quality linter validates agent/skill definitions: required fields present, `description` minimum length, `name` follows kebab-case, `allowed_tools` non-empty for agents that declare tool use. Integrated as a subcommand of `spec-lint` or standalone.
- **FR-015**: Derivation rules apply when fields are absent:
  - `type: process` implies `safety_tier: tier1`, `mutation: read-only`, `model: opus` (default)
  - `type: scaffold` implies `safety_tier: tier2`, `mutation: read-write`, `model: sonnet` (default)
  - `safety_tier` absent + only read-only tools in allowlist -> suggest `tier1` (warning, not error)
- **FR-016**: The `hooks` field (map of event name to hook declarations) is preserved from `SkillFrontmatter`. Structure: each hook has `name`, `type` (bash/agent/prompt), optional `if` condition, and `run` command.

### Non-functional

- **NF-001**: Tier 1 metadata loading for 500 agent files completes in < 200ms (frontmatter-only parsing, no body loading).
- **NF-002**: Frontmatter parsing is resilient to malformed YAML; parse errors include file path and line number.
- **NF-003**: The `agent-frontmatter` crate has minimal dependencies: `serde`, `serde_yaml`, `serde_json` only. No dependency on `agent`, `skill-factory`, or `factory-contracts`.

## Architecture

### Unified schema

#### Tier 1: Identity (always parsed)

| Field | Type | Required | Aliases | Default | Source |
|-------|------|----------|---------|---------|--------|
| `name` | string | yes | `id` | — | All formats |
| `description` | string | recommended | — | — | All formats |
| `type` | enum | no | — | `prompt` | `SkillType` + factory |
| `model` | string | no | `model_hint` | — | All formats |
| `tags` | string[] | no | — | `[]` | New (replaces `category`) |
| `display_name` | string | no | `role` | — | Factory agents |
| `trigger` | string | no | — | — | `SkillFrontmatter` |

#### Tier 2: Capabilities (parsed on activation)

| Field | Type | Required | Aliases | Default | Source |
|-------|------|----------|---------|---------|--------|
| `allowed_tools` | AllowedTools | no | `tools` | `"*"` | `SkillFrontmatter` / CC agents |
| `safety_tier` | enum(tier1/tier2/tier3) | no | `tier` (u8) | derived | New, maps to `ToolTier` |
| `mutation` | enum(read-only/read-write/full) | no | — | derived | New, replaces desktop booleans |
| `hooks` | map | no | — | `{}` | `SkillFrontmatter` |
| `governance` | enum(none/advisory/enforced) | no | — | `none` | New, spec 098 |
| `max_spec_risk` | string | no | — | — | New, spec 093 |

#### Tier 3: Metadata (for tooling, never gates execution)

| Field | Type | Required | Default | Source |
|-------|------|----------|---------|--------|
| `version` | string | no | — | Semver |
| `author` | string | no | — | Attribution |
| `priority` | integer | no | — | Trigger ordering |
| `icon` | string | no | — | Desktop display |
| `stage` | u8 | no | — | Factory pipeline stage |
| `context_budget` | string | no | — | Factory token budget hint |

### Derivation rules

```
if type == "process" && safety_tier.is_none():
    safety_tier = tier1
    mutation = read-only
    model = model.unwrap_or("opus")

if type == "scaffold" && safety_tier.is_none():
    safety_tier = tier2
    mutation = read-write
    model = model.unwrap_or("sonnet")

if mutation.is_none() && safety_tier.is_some():
    mutation = match safety_tier:
        tier1 -> read-only
        tier2 -> read-write
        tier3 -> full
```

### Progressive disclosure flow

```
Agent catalog request
  |
  v
Tier 1: Parse frontmatter only (all files)
  |
  +---> Return catalog: [{name, description, type, model, tags}, ...]
  |
  v
User selects / routing activates an agent
  |
  v
Tier 2: Load full markdown body + capability fields
  |
  +---> System prompt, allowed_tools, safety_tier, governance
  |
  v
Agent requests a resource during execution
  |
  v
Tier 3: Load referenced resources on demand
  |
  +---> Tool schemas, context files, standards (spec 055)
```

### Rust type mapping

| Schema field | Rust type | Crate |
|-------------|-----------|-------|
| `name` | `String` | `agent-frontmatter` (new) |
| `type` | `AgentType` (superset of `SkillType`) | `agent-frontmatter` |
| `allowed_tools` | `AllowedTools` (moved from skill-factory) | `agent-frontmatter` |
| `safety_tier` | `SafetyTier` (converts to/from `ToolTier`) | `agent-frontmatter` |
| `mutation` | `MutationCapability` | `agent-frontmatter` |
| `governance` | `GovernanceRequirement` | `agent-frontmatter` |
| `hooks` | `HashMap<String, Vec<HookDeclaration>>` (moved from skill-factory) | `agent-frontmatter` |

The `agent-frontmatter` crate exports types only. `skill-factory` re-exports `AllowedTools` and `HookDeclaration` for backward compatibility. `factory-contracts` depends on `agent-frontmatter` for parsing.

### Backward compatibility through aliases

The parser accepts both canonical and alias field names:

```yaml
# Claude Code agent format (works unchanged)
name: reviewer
tools: [Read, Grep, Glob, Bash, LS]    # alias for allowed_tools
model: sonnet

# Factory agent format (works unchanged)
id: requirements-agent                   # alias for name
role: requirements-analyst               # alias for display_name
tier: 1                                  # alias for safety_tier (u8 -> tier1)
model_hint: opus                         # alias for model

# Skill format (works unchanged)
name: research
type: agent
allowed_tools: [Read, Write, Bash, WebSearch]
trigger: "when the user asks for deep research"
```

### Key integration points

| Component | File | Role |
|-----------|------|------|
| Unified types | `crates/agent-frontmatter/src/lib.rs` (new) | Canonical types, parser, validator |
| Skill factory | `crates/skill-factory/src/types.rs` | Re-exports shared types; `SkillFrontmatter` wraps `UnifiedFrontmatter` |
| Factory agents | `crates/factory-contracts/src/agent_loader.rs` | Delegates parsing to shared crate |
| Agent registry | `crates/agent/src/registry.rs` | `AgentRegistryEntry` enriched with Tier 1 fields |
| Safety tiers | `crates/agent/src/safety.rs` | `From<SafetyTier> for ToolTier` conversion |
| Policy kernel | `crates/policy-kernel/src/lib.rs` | `ToolCallContext` consumes governance and risk fields |
| Standards | `crates/standards-loader/src/lib.rs` | Tier 3 resource loaded during execution (spec 055) |
| JSON Schema | `standards/schemas/frontmatter/agent-frontmatter.schema.json` (new) | Generated from Rust types |

## Implementation approach

1. **Phase 1 — shared crate**: Create `crates/agent-frontmatter/` with `UnifiedFrontmatter`, `AgentType`, `SafetyTier`, `MutationCapability`, `GovernanceRequirement`, `AllowedTools` (moved), `HookDeclaration` (moved), parser, and derivation logic. Minimal deps: `serde`, `serde_yaml`, `serde_json`.

2. **Phase 2 — skill-factory integration**: Refactor `crates/skill-factory/src/types.rs` to re-export types from `agent-frontmatter`. `SkillFrontmatter` becomes a thin wrapper or type alias. `parser.rs` delegates YAML parsing to the shared crate. All existing skill tests pass.

3. **Phase 3 — factory-contracts integration**: Align `crates/factory-contracts/src/agent_loader.rs` to parse via `agent-frontmatter`. The private `AgentFrontmatter` struct is replaced. `AgentPrompt` wraps `UnifiedFrontmatter`. Existing factory agent files parse unchanged via aliases.

4. **Phase 4 — registry enrichment**: Add `agent_type`, `model`, `tags`, `safety_tier` to `AgentRegistryEntry` in `crates/agent/src/registry.rs`. Add `From<SafetyTier> for ToolTier` in `safety.rs`. The organizer can now make governance-aware team selections.

5. **Phase 5 — JSON Schema and linting**: Generate `standards/schemas/frontmatter/agent-frontmatter.schema.json` from Rust types. Build quality linter (required fields, description length, kebab-case names, non-empty tool lists). Integrate as `spec-lint` subcommand or standalone binary.

6. **Phase 6 — file migration**: Add `safety_tier` and `mutation` fields to existing `.claude/agents/*.md` and `factory/process/agents/*.md` files. Purely additive — files without new fields continue to parse via derivation rules.

## Success criteria

- **SC-001**: All existing agent files (`.claude/agents/*.md`), skill files (`.claude/commands/*.md`), and factory agent files (`factory/process/agents/*.md`, `factory/adapters/*/agents/*.md`) parse without modification through the unified parser.
- **SC-002**: The Tier 1 catalog loader parses metadata for all agents in < 200ms without loading markdown bodies.
- **SC-003**: An agent declaring `safety_tier: tier1` is blocked from invoking Tier 2 or Tier 3 tools, with a clear error.
- **SC-004**: The quality linter catches missing `name`, descriptions shorter than 50 characters, and non-kebab-case names.
- **SC-005**: Unknown frontmatter fields are preserved through parse-serialize round-trips.
- **SC-006**: `SkillFrontmatter` continues to work as before — `skill-factory` tests pass without modification.
- **SC-007**: Factory agent files with `id`/`role`/`tier`/`model_hint` parse correctly through aliases.
- **SC-008**: JSON Schema validates all existing agent/skill files in CI.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 035-agent-governed-execution | Governed dispatch model; agent frontmatter feeds execution constraints |
| 036-safety-tier-governance | `ToolTier` maps to/from `SafetyTier` declared in frontmatter |
| 055-yaml-standards-schema | Standards loaded as Tier 3 resources during agent execution |
| 067-tool-definition-registry | `allowed_tools` references tool names registered in `ToolRegistry` |
| 068-permission-runtime | Permission evaluation intersects agent tool allowlist with policy rules |
| 071-skill-command-factory | `SkillFrontmatter` types unified into shared crate; skill-factory re-exports |
| 093-spec-driven-preflight | `max_spec_risk` frontmatter field feeds `ToolCallContext.max_spec_risk` |
| 098-governance-enforcement-stitching | `governance` field connects to `governance_mode` on dispatch results |

## Risk

- **R-001**: Unifying three formats may surface edge cases in alias resolution (e.g., a file has both `id` and `name`). Mitigation: canonical field wins; alias is ignored with a warning if both are present.
- **R-002**: Moving `AllowedTools` and `HookDeclaration` to a shared crate is a breaking change for direct imports. Mitigation: `skill-factory` re-exports the moved types; downstream code updates import paths.
- **R-003**: The `agent-frontmatter` crate becomes a dependency of multiple crates, making it a coordination bottleneck. Mitigation: the crate is intentionally thin (types + parser only, no runtime logic) to minimize churn.
- **R-004**: Factory agent files use `tier: 1` (u8) while the schema uses `safety_tier: tier1` (string enum). Mitigation: the parser accepts both via serde's `deserialize_with` or a custom `From<u8>` impl.
