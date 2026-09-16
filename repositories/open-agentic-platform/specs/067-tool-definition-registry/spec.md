---
id: "067-tool-definition-registry"
title: "Tool Definition Registry"
feature_branch: "067-tool-definition-registry"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-31"
authors: ["open-agentic-platform"]
language: en
summary: >
  Introduces a unified ToolDef trait and registration pattern absorbed from
  Claude Code's buildTool() factory. Every tool in the platform — Rust crate
  tools, OPC Tauri commands, and MCP-bridged tools — registers through a
  single schema-driven interface with name, description, JSON Schema input,
  permission gate, and execute function. This replaces ad-hoc dispatch wiring
  with a discoverable, composable tool surface.
code_aliases: ["TOOL_DEFINITION_REGISTRY"]
sources: ["claude-code"]
extends:
  - spec: "036-safety-tier-governance"
    nature: additive
    unit: { kind: crate, id: tool-registry }
compliance:
  - framework: "owasp-asi-2026"
    # ASI03 via FR-004 (`can_use()` consults policy kernel before every
    # tool dispatch — single gate against unauthorised tool invocation).
    # ASI09 via NF-003 (pre-execute JSON Schema validation — invalid input
    # MUST return error without invoking the tool).
    controls: ["ASI03", "ASI09"]
---

# Feature Specification: Tool Definition Registry

## Purpose

The open-agentic-platform currently dispatches agent work through `crates/agent/dispatch.rs` using NEVER/ALWAYS substring lists and complexity scoring. Individual tools (Tauri commands, orchestrator steps, MCP servers) each define their interfaces differently — Rust structs, Tauri command signatures, MCP tool schemas — with no shared registration or discovery mechanism.

Claude Code's `buildTool()` factory (from `src/Tool.ts`) demonstrates a proven pattern: every tool is a value conforming to a single interface with Zod-validated input, a permission check, and an execute function. This gives the runtime a uniform dispatch surface, enables tool discovery at startup, and makes adding new tools a one-file operation.

This spec absorbs that pattern into OAP's Rust-first architecture, replacing implicit dispatch wiring with an explicit, schema-driven tool registry.

## Scope

### In scope

- **ToolDef trait** — Rust trait defining the tool contract (name, description, JSON Schema, can_use, execute)
- **Tool registry** — Central `ToolRegistry` struct that collects, validates, and serves tool definitions at startup
- **Schema derivation** — Derive JSON Schema from Rust types via `schemars` so tool inputs are machine-verifiable
- **Permission gate** — Each tool declares a `can_use()` method that consults the policy kernel (Feature 049) before execution
- **MCP tool bridging** — MCP-discovered tools auto-register as `ToolDef` instances with schemas from `ListTools`
- **OPC integration** — Tauri commands expose their tool definitions to the registry via IPC

### Out of scope

- **ML-based auto-approval** — Claude Code's YOLO classifier; OAP uses deterministic dispatch instead
- **React/Ink UI rendering** — OAP's desktop app handles UI separately
- **Tool implementation migration** — Existing crate functionality stays in crates; this spec adds the registration surface, not rewrites

## Requirements

### Functional

**FR-001**: A `ToolDef` trait MUST define: `name() -> &str`, `description() -> &str`, `input_schema() -> serde_json::Value`, `can_use(ctx: &ToolContext) -> Result<PermissionResult>`, `execute(input: serde_json::Value, ctx: &mut ToolContext) -> Result<ToolResult>`.

**FR-002**: A `ToolRegistry` MUST collect all tool definitions at startup and expose `list()`, `get(name)`, and `execute(name, input, ctx)` methods.

**FR-003**: `input_schema()` MUST return a valid JSON Schema object. For Rust-native tools, this SHOULD be derived from the input struct using `schemars::JsonSchema`.

**FR-004**: `can_use()` MUST consult the policy kernel (Feature 049) permission rules before returning. If no policy kernel is available, it MUST default to `PermissionResult::Ask`.

**FR-005**: MCP tools discovered via `ListTools` MUST be wrapped as `ToolDef` implementations with schemas from the MCP response and execution delegated to the MCP client.

**FR-006**: The registry MUST reject duplicate tool names at registration time with an explicit error.

**FR-007**: Tool execution MUST emit lifecycle events (`PreToolUse`, `PostToolUse`) consumable by the hook system (Feature 048).

### Non-functional

**NF-001**: Tool registration MUST complete in under 50ms for up to 200 tools (excluding MCP discovery network time).

**NF-002**: The `ToolDef` trait MUST be object-safe to allow `Box<dyn ToolDef>` collections.

**NF-003**: Schema validation of tool input against `input_schema()` MUST occur before `execute()` is called. Invalid input MUST return a structured error without invoking the tool.

## Architecture

### ToolDef trait

```rust
use serde_json::Value;

pub struct ToolContext {
    pub permissions: PolicyKernelHandle,
    pub mcp_clients: Vec<McpClientHandle>,
    pub state: AppStateHandle,
    pub workflow_id: Option<String>,
}

pub enum PermissionResult {
    Allow,
    Deny(String),
    Ask(String),
}

pub struct ToolResult {
    pub content: Value,
    pub is_error: bool,
    pub metadata: Option<Value>,
}

pub trait ToolDef: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    fn can_use(&self, ctx: &ToolContext) -> Result<PermissionResult>;
    fn execute(&self, input: Value, ctx: &mut ToolContext) -> Result<ToolResult>;
}
```

### ToolRegistry

```rust
pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn ToolDef>>,
}

impl ToolRegistry {
    pub fn register(&mut self, tool: Box<dyn ToolDef>) -> Result<()>;
    pub fn list(&self) -> Vec<&dyn ToolDef>;
    pub fn get(&self, name: &str) -> Option<&dyn ToolDef>;
    pub fn execute(&mut self, name: &str, input: Value, ctx: &mut ToolContext) -> Result<ToolResult>;
}
```

### Registration flow

```
Startup
  ├── Scan crates/ for #[tool_def] annotated structs
  ├── Register built-in tools (Bash, FileRead, FileEdit, Glob, Grep, etc.)
  ├── Connect MCP servers → ListTools → wrap as McpToolDef
  ├── Load OPC Tauri command manifest → wrap as TauriToolDef
  └── Validate: no duplicates, all schemas valid JSON Schema
```

### MCP bridge adapter

```rust
pub struct McpToolDef {
    name: String,
    description: String,
    schema: Value,
    client: McpClientHandle,
}

impl ToolDef for McpToolDef {
    fn execute(&self, input: Value, ctx: &mut ToolContext) -> Result<ToolResult> {
        // Delegate to MCP CallTool
        self.client.call_tool(&self.name, input)
    }
}
```

## Implementation approach

1. **Define `ToolDef` trait and `ToolRegistry`** in a new `crates/tool-registry/` crate
2. **Derive macro** — `#[derive(ToolDef)]` proc macro using `schemars` for automatic `input_schema()` generation
3. **Implement built-in tools** — wrap existing crate capabilities (gitctx, xray, orchestrator steps) as ToolDef implementations
4. **MCP adapter** — `McpToolDef` struct that bridges MCP `ListTools`/`CallTool` to the trait
5. **OPC integration** — Tauri command in `product/apps/opc/src-tauri/` that serializes the registry to JSON for the React frontend
6. **Hook emission** — `execute()` in `ToolRegistry` emits `PreToolUse`/`PostToolUse` events before/after delegation

## Success criteria

**SC-001**: All existing agent dispatch paths route through `ToolRegistry.execute()`.

**SC-002**: `cargo test -p tool-registry` passes with unit tests for registration, schema validation, duplicate rejection, and permission gating.

**SC-003**: MCP tools from `gitctx` and `session-memory` are discoverable via `ToolRegistry.list()`.

**SC-004**: Adding a new tool requires exactly one file implementing `ToolDef` and one `register()` call.

**SC-005**: Tool input that violates the JSON Schema is rejected before `execute()` runs, with a structured error message.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 049-permission-system | `can_use()` delegates to the policy kernel's permission evaluation |
| 048-hookify-rule-engine | `execute()` emits lifecycle events consumed by the hook runtime |
| 035-agent-governed-execution | Dispatch protocol routes through the tool registry |
| 044-multi-agent-orchestration | Orchestrator steps register as tools |

## Risk

**R-001**: Object safety constraints may limit the `ToolDef` trait (no generics in trait methods). **Mitigation**: Use `serde_json::Value` as the universal input/output type; concrete types are validated against the schema before deserialization.

**R-002**: MCP tool discovery adds startup latency. **Mitigation**: Discover MCP tools asynchronously; registry serves local tools immediately and adds MCP tools as they resolve.

**R-003**: Proc macro complexity for `#[derive(ToolDef)]`. **Mitigation**: Start with manual implementations; add the derive macro in a follow-up once the trait is stable.
