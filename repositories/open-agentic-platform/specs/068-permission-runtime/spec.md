---
id: "068-permission-runtime"
title: "Permission Runtime and Settings Layering"
feature_branch: "068-permission-runtime"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-31"
authors: ["open-agentic-platform"]
language: en
summary: >
  Implements the runtime permission evaluation engine absorbed from Claude
  Code's multi-layer permission system. Introduces 5-tier settings layering
  (policy > env > user > project > defaults), glob-based permission rule
  matching on tool+path patterns, and denial tracking with escalation. Builds
  on the policy kernel (Feature 049) by adding the dynamic runtime loop that
  evaluates permissions at tool dispatch time.
code_aliases: ["PERMISSION_RUNTIME"]
sources: ["claude-code"]
extends:
  - spec: "036-safety-tier-governance"
    nature: additive
    unit: { kind: crate, id: open_agentic_policy_kernel }
  - spec: "049-permission-system"
    nature: wrapping
    unit: { kind: crate, id: open_agentic_policy_kernel }
compliance:
  - framework: "owasp-asi-2026"
    # ASI03 via FR-008 (enterprise policy `deny` is immutable across tiers,
    # cannot be overridden by user `allow` — explicit anti-escalation).
    # ASI05 via FR-002+FR-004 deny-rule schema (worked example denies
    # FileWrite to `.env`, `*.key`, `*.pem`).
    # ASI09 via same schema (worked example denies `rm -rf *`,
    # `git push --force *`).
    # ASI10 covers the *escalation-tracking* aspect of behavior drift via
    # FR-005 denial tracking with N-strike session block; this is depth on
    # spec 102's runtime-drift coverage rather than a primary drift-detection
    # mechanism.
    controls: ["ASI03", "ASI05", "ASI09", "ASI10"]
---

# Feature Specification: Permission Runtime and Settings Layering

## Purpose

Feature 049 defines the permission system's data model and policy kernel. What's missing is the *runtime evaluation loop* — the code that intercepts every tool call, matches it against layered permission rules, and decides allow/deny/ask in real time.

Claude Code's permission system (`src/utils/permissions/`) demonstrates a production-proven approach: static rules in settings.json matched by glob patterns, a denial tracking counter that escalates to interactive prompts after repeated denials, and a 5-tier settings merge that lets enterprise policies override project defaults without conflicting.

This spec absorbs those patterns into OAP's Rust-based policy kernel, giving the platform a fast, deterministic permission evaluation path that integrates with the tool registry (Feature 067) and hook system (Feature 048).

## Scope

### In scope

- **5-tier settings merge** — policy (enterprise/remote) > environment variables > user (`~/.claude/settings.json`) > project (`.claude/settings.json`) > built-in defaults
- **Permission rule schema** — `allow`, `deny`, `ask` rules with tool name + glob pattern matching
- **Rule evaluation engine** — match tool calls against rules in priority order (deny > allow > ask > default)
- **Denial tracking** — per-tool counter; after N denials, escalate to interactive prompt or block
- **Settings file watcher** — live reload on settings.json change without restart
- **Integration with ToolRegistry** — `can_use()` calls the permission runtime

### Out of scope

- **ML-based auto-approval** — OAP uses deterministic NEVER/ALWAYS dispatch instead
- **Remote managed settings polling** — enterprise policy distribution is a separate concern
- **UI permission prompts** — OPC desktop renders prompts; this spec provides the evaluation, not the UI

## Requirements

### Functional

**FR-001**: Settings MUST be loaded from 5 tiers and merged with strict priority: policy > env > user > project > defaults. Higher-priority tiers override lower-priority tiers for the same key.

**FR-002**: Permission rules MUST support three actions: `allow` (auto-approve), `deny` (auto-reject with reason), `ask` (require interactive approval).

**FR-003**: Each rule MUST match on: tool name (exact or glob), optional file path pattern (glob), optional command pattern (glob for Bash-like tools).

**FR-004**: Rule evaluation order MUST be: check `deny` rules first (any match → deny), then `allow` rules (any match → allow), then `ask` rules (any match → ask), then fall through to default mode.

**FR-005**: Denial tracking MUST count consecutive denials per tool. After a configurable threshold (default: 3), the runtime MUST escalate to a blocking prompt or permanent deny for the session.

**FR-006**: Settings file changes MUST be detected and merged within 2 seconds without requiring restart.

**FR-007**: The permission runtime MUST expose a `evaluate(tool_name: &str, input: &Value, ctx: &ToolContext) -> PermissionResult` function callable from `ToolDef::can_use()`.

**FR-008**: Enterprise policy rules MUST be immutable by user or project settings — a policy `deny` cannot be overridden by a user `allow`.

### Non-functional

**NF-001**: Permission evaluation MUST complete in under 1ms for up to 500 rules (no network calls in the hot path).

**NF-002**: Settings merge MUST be idempotent — merging the same sources twice produces the same result.

**NF-003**: All permission decisions MUST be logged to an audit trail with: timestamp, tool name, input summary, rule matched, decision, tier source.

## Architecture

### Settings layering

```
┌─────────────────────────────────┐
│  Tier 1: Policy (enterprise)    │  ← Immutable overrides
├─────────────────────────────────┤
│  Tier 2: Environment variables  │  ← CLAUDE_PERMISSION_MODE, etc.
├─────────────────────────────────┤
│  Tier 3: User settings          │  ← ~/.claude/settings.json
├─────────────────────────────────┤
│  Tier 4: Project settings       │  ← .claude/settings.json (git root)
├─────────────────────────────────┤
│  Tier 5: Built-in defaults      │  ← Hardcoded safe defaults
└─────────────────────────────────┘

Merge: for each key, highest-tier value wins.
Exception: permission rules AGGREGATE across tiers
  (policy deny + user allow → deny wins by rule eval order)
```

### Permission rule schema

```yaml
# In settings.json
permissions:
  defaultMode: "default"   # "default" | "bypass" | "read-only"
  allow:
    - tool: "FileRead"
      paths: ["src/**", "docs/**"]
    - tool: "Bash"
      commands: ["cargo test *", "cargo build *", "git status"]
  deny:
    - tool: "Bash"
      commands: ["rm -rf *", "git push --force *"]
    - tool: "FileWrite"
      paths: [".env", "*.key", "*.pem"]
  ask:
    - tool: "Bash"
      commands: ["*"]
    - tool: "FileWrite"
      paths: ["*"]
```

### Evaluation flow

```
ToolRegistry.execute(name, input, ctx)
  │
  ├── ToolDef::can_use(ctx)
  │     │
  │     └── PermissionRuntime::evaluate(name, input, ctx)
  │           │
  │           ├── 1. Check deny rules (any match → Deny)
  │           ├── 2. Check allow rules (any match → Allow)
  │           ├── 3. Check ask rules (any match → Ask)
  │           ├── 4. Apply defaultMode
  │           └── 5. Log decision to audit trail
  │
  ├── If Allow → execute tool
  ├── If Deny → return error with reason
  └── If Ask → emit AskPermission event → wait for response
```

### Denial tracking

```rust
pub struct DenialTracker {
    counts: HashMap<String, u32>,  // tool_name → consecutive denials
    threshold: u32,                 // default: 3
}

impl DenialTracker {
    pub fn record_denial(&mut self, tool: &str) -> EscalationAction;
    pub fn record_approval(&mut self, tool: &str); // resets counter
}

pub enum EscalationAction {
    Continue,                      // under threshold
    Escalate,                      // at threshold → force interactive
    Block,                         // over threshold → session deny
}
```

### Settings watcher

```rust
pub struct SettingsWatcher {
    paths: Vec<PathBuf>,           // all 4 file-based tiers
    merged: Arc<RwLock<MergedSettings>>,
}

impl SettingsWatcher {
    pub fn start(&self) -> JoinHandle<()>;  // fs::notify loop
    pub fn current(&self) -> MergedSettings;
}
```

## Implementation approach

1. **Define settings schema** in `crates/policy-kernel/src/settings.rs` — Rust structs with serde + schemars for the permission rule format
2. **Implement 5-tier merge** in `crates/policy-kernel/src/merge.rs` — load from each tier, merge with priority semantics
3. **Implement rule evaluator** in `crates/policy-kernel/src/evaluate.rs` — glob matching on tool name, path, and command patterns
4. **Add denial tracker** in `crates/policy-kernel/src/denial.rs` — per-tool counter with escalation
5. **Wire settings watcher** — `notify` crate for filesystem events, trigger re-merge on change
6. **Integrate with ToolRegistry** (Feature 067) — `ToolDef::can_use()` calls `PermissionRuntime::evaluate()`
7. **Audit logging** — append-only log file at `~/.claude/audit/permissions.jsonl`

## Success criteria

**SC-001**: Permission rules in settings.json correctly allow, deny, or prompt for tool calls matching glob patterns.

**SC-002**: A policy-tier deny rule cannot be overridden by a user-tier allow rule.

**SC-003**: After 3 consecutive denials of the same tool, the runtime escalates to a blocking prompt.

**SC-004**: Changing settings.json while a session is running takes effect within 2 seconds without restart.

**SC-005**: Every permission decision is logged to the audit trail with full context.

**SC-006**: `cargo test -p policy-kernel` passes with tests for all rule matching edge cases (exact match, glob, path overlap, tier override, denial escalation).

## Dependencies

| Spec | Relationship |
|------|-------------|
| 049-permission-system | This spec implements the runtime for 049's data model |
| 067-tool-definition-registry | `can_use()` in ToolDef delegates to this permission runtime |
| 048-hookify-rule-engine | Permission decisions emit events consumable by hooks |
| 036-safety-tier-governance | Safety tiers inform default permission mode per tool category |

## Risk

**R-001**: Glob matching performance with many rules. **Mitigation**: Pre-compile glob patterns at settings load time; benchmark confirms <1ms for 500 rules.

**R-002**: Settings file race conditions during live reload. **Mitigation**: Atomic read-then-merge under RwLock; stale reads are safe (next poll corrects).

**R-003**: Audit log grows unbounded. **Mitigation**: Rotate at 10MB; retain last 5 rotations.
