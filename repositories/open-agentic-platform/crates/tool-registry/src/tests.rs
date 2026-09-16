// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use crate::ToolRegistry;
use crate::event::ToolEventKind;
use crate::mcp::McpToolDef;
use crate::registry::RegistryError;
use crate::types::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Minimal tool for testing.
struct EchoTool;

impl ToolDef for EchoTool {
    fn name(&self) -> &str {
        "echo"
    }
    fn description(&self) -> &str {
        "Echoes input back"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "message": { "type": "string" }
            },
            "required": ["message"]
        })
    }
    fn can_use(&self, _ctx: &ToolContext) -> anyhow::Result<PermissionResult> {
        Ok(PermissionResult::Allow)
    }
    fn execute(&self, input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
        Ok(ToolResult::success(input))
    }
}

/// Tool that always denies. Schema is intentionally permissive (no
/// properties) to keep the fixture minimal; opts in via
/// `permissive(): true` per spec 169.
struct DeniedTool;

impl ToolDef for DeniedTool {
    fn name(&self) -> &str {
        "denied"
    }
    fn description(&self) -> &str {
        "Always denied"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object" })
    }
    fn permissive(&self) -> bool {
        true
    }
    fn can_use(&self, _ctx: &ToolContext) -> anyhow::Result<PermissionResult> {
        Ok(PermissionResult::Deny("blocked by policy".into()))
    }
    fn execute(&self, _input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
        unreachable!("should not be called when denied");
    }
}

/// Stub MCP client.
struct StubMcpClient;

impl McpClient for StubMcpClient {
    fn call_tool(&self, _name: &str, input: Value) -> anyhow::Result<ToolResult> {
        Ok(ToolResult::success(json!({ "mcp_echo": input })))
    }
}

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------

#[test]
fn register_and_list() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();
    assert_eq!(reg.len(), 1);
    assert_eq!(reg.list().len(), 1);
    assert_eq!(reg.list()[0].name(), "echo");
}

#[test]
fn duplicate_name_rejected() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();
    let err = reg.register(Box::new(EchoTool)).unwrap_err();
    assert!(matches!(err, RegistryError::DuplicateName(ref n) if n == "echo"));
}

#[test]
fn get_by_name() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();
    assert!(reg.get("echo").is_some());
    assert!(reg.get("nonexistent").is_none());
}

// ---------------------------------------------------------------------------
// Schema validation tests (NF-003, SC-005)
// ---------------------------------------------------------------------------

#[test]
fn valid_input_accepted() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();

    let mut ctx = ToolContext::empty();
    let result = reg.execute("echo", json!({"message": "hello"}), &mut ctx);
    assert!(result.is_ok());
    let res = result.unwrap();
    assert!(!res.is_error);
    assert_eq!(res.content, json!({"message": "hello"}));
}

#[test]
fn invalid_input_rejected_before_execute() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();

    let mut ctx = ToolContext::empty();
    // Missing required "message" field.
    let result = reg.execute("echo", json!({}), &mut ctx);
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(
        matches!(err, RegistryError::InputValidation { ref tool, .. } if tool == "echo"),
        "expected InputValidation, got: {err:?}"
    );
}

#[test]
fn wrong_type_rejected() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();

    let mut ctx = ToolContext::empty();
    // "message" must be a string.
    let result = reg.execute("echo", json!({"message": 42}), &mut ctx);
    assert!(result.is_err());
    assert!(matches!(
        result.unwrap_err(),
        RegistryError::InputValidation { .. }
    ));
}

// ---------------------------------------------------------------------------
// Permission gating tests (FR-004)
// ---------------------------------------------------------------------------

#[test]
fn denied_tool_not_executed() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(DeniedTool)).unwrap();

    let mut ctx = ToolContext::empty();
    let result = reg.execute("denied", json!({}), &mut ctx);
    assert!(matches!(
        result.unwrap_err(),
        RegistryError::PermissionDenied { .. }
    ));
}

#[test]
fn no_policy_kernel_returns_deny() {
    // FR-020: default can_use denies when no policy kernel (fail-closed).
    struct DefaultGateTool;
    impl ToolDef for DefaultGateTool {
        fn name(&self) -> &str {
            "default_gate"
        }
        fn description(&self) -> &str {
            "Uses default can_use"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object" })
        }
        fn permissive(&self) -> bool {
            true
        }
        fn execute(&self, _input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::success(json!("ok")))
        }
    }

    let mut reg = ToolRegistry::new();
    reg.register(Box::new(DefaultGateTool)).unwrap();

    let mut ctx = ToolContext::empty(); // no policy kernel
    let result = reg.execute("default_gate", json!({}), &mut ctx);
    assert!(matches!(
        result.unwrap_err(),
        RegistryError::PermissionDenied { .. }
    ));
}

// ---------------------------------------------------------------------------
// MCP bridge tests (FR-005)
// ---------------------------------------------------------------------------

#[test]
fn mcp_tool_registration_and_execution() {
    let client: Arc<dyn McpClient> = Arc::new(StubMcpClient);
    let mcp_tool = McpToolDef::new(
        "mcp__server__greet",
        "Greeting tool from MCP server",
        json!({
            "type": "object",
            "properties": { "name": { "type": "string" } },
            "required": ["name"]
        }),
        client,
    );

    let mut reg = ToolRegistry::new();
    reg.register(Box::new(mcp_tool)).unwrap();

    assert_eq!(
        reg.get("mcp__server__greet").unwrap().name(),
        "mcp__server__greet"
    );

    // Execute (need Allow permission — override via explicit can_use in McpToolDef
    // which uses the default trait method; supply a policy kernel that allows).
    struct AllowAll;
    impl PolicyEvaluator for AllowAll {
        fn evaluate(&self, _tool: &str, _args: &str) -> PermissionResult {
            PermissionResult::Allow
        }
    }

    let mut ctx = ToolContext {
        policy: Some(PolicyKernelHandle(Box::new(AllowAll))),
        workflow_id: None,
        state: None,
    };

    let result = reg
        .execute("mcp__server__greet", json!({"name": "world"}), &mut ctx)
        .unwrap();
    assert!(!result.is_error);
    assert_eq!(result.content, json!({ "mcp_echo": { "name": "world" } }));
}

// ---------------------------------------------------------------------------
// Lifecycle event tests (FR-007)
// ---------------------------------------------------------------------------

#[test]
fn events_emitted_on_execute() {
    let events: Arc<Mutex<Vec<crate::event::ToolEvent>>> = Arc::new(Mutex::new(Vec::new()));

    let mut reg = ToolRegistry::new();
    reg.register(Box::new(EchoTool)).unwrap();

    let captured = events.clone();
    reg.set_event_sink(move |e| {
        captured.lock().unwrap().push(e);
    });

    let mut ctx = ToolContext::empty();
    reg.execute("echo", json!({"message": "hi"}), &mut ctx)
        .unwrap();

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].kind, ToolEventKind::PreToolUse);
    assert_eq!(events[0].tool_name, "echo");
    assert!(events[0].input.is_some());
    assert_eq!(events[1].kind, ToolEventKind::PostToolUse);
    assert_eq!(events[1].tool_name, "echo");
    assert!(events[1].output.is_some());
}

// ---------------------------------------------------------------------------
// Not-found test
// ---------------------------------------------------------------------------

#[test]
fn execute_unknown_tool_returns_not_found() {
    let reg = ToolRegistry::new();
    let mut ctx = ToolContext::empty();
    let result = reg.execute("nope", json!({}), &mut ctx);
    assert!(matches!(result.unwrap_err(), RegistryError::NotFound(ref n) if n == "nope"));
}

// ---------------------------------------------------------------------------
// Invalid schema rejected at registration
// ---------------------------------------------------------------------------

#[test]
fn bad_schema_rejected_at_registration() {
    struct BadSchemaTool;
    impl ToolDef for BadSchemaTool {
        fn name(&self) -> &str {
            "bad"
        }
        fn description(&self) -> &str {
            "bad schema"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "array" })
        }
        fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
            unreachable!()
        }
    }

    let mut reg = ToolRegistry::new();
    let err = reg.register(Box::new(BadSchemaTool)).unwrap_err();
    assert!(matches!(err, RegistryError::InvalidSchema(..)));
}

// ---------------------------------------------------------------------------
// Spec 169 — schema strictness enforcement
// ---------------------------------------------------------------------------

/// Permissive tool that does NOT opt in via `permissive(): true`. The
/// registry must reject it.
struct StrictRejectTool;
impl ToolDef for StrictRejectTool {
    fn name(&self) -> &str {
        "strict_reject"
    }
    fn description(&self) -> &str {
        "tool whose schema is permissive and does not opt in"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "additionalProperties": true,
                "properties": { "x": { "type": "string" } } })
    }
    fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
        unreachable!()
    }
}

#[test]
fn permissive_schema_rejected_when_not_opted_in() {
    let mut reg = ToolRegistry::new();
    let err = reg.register(Box::new(StrictRejectTool)).unwrap_err();
    match err {
        RegistryError::PermissiveSchema { ref tool, ref pattern } => {
            assert_eq!(tool, "strict_reject");
            assert!(matches!(
                pattern,
                crate::strictness::PermissivePattern::AdditionalPropertiesTrue { .. }
            ));
        }
        other => panic!("expected PermissiveSchema, got {other:?}"),
    }
    assert_eq!(reg.len(), 0);
}

/// Permissive tool that opts in via `permissive(): true`. Must be
/// accepted and surfaced in the permissive-registrations inventory.
struct OptInPermissiveTool;
impl ToolDef for OptInPermissiveTool {
    fn name(&self) -> &str {
        "legacy_thing"
    }
    fn description(&self) -> &str {
        "permissive tool that opts in"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "additionalProperties": true })
    }
    fn permissive(&self) -> bool {
        true
    }
    fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
        unreachable!()
    }
}

#[test]
fn permissive_schema_accepted_when_opted_in() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(OptInPermissiveTool)).unwrap();
    assert_eq!(reg.len(), 1);
    let inventory = reg.permissive_registrations();
    assert_eq!(inventory.len(), 1);
    assert_eq!(inventory[0].tool, "legacy_thing");
    assert!(matches!(
        inventory[0].pattern,
        crate::strictness::PermissivePattern::AdditionalPropertiesTrue { .. }
    ));
}

/// Strict-schema tool: accepted, not recorded in the permissive inventory.
struct StrictTool;
impl ToolDef for StrictTool {
    fn name(&self) -> &str {
        "strict_one"
    }
    fn description(&self) -> &str {
        "strict-schema tool"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "x": { "type": "string" } },
            "required": ["x"]
        })
    }
    fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
        unreachable!()
    }
}

#[test]
fn strict_tool_accepted_and_not_recorded() {
    let mut reg = ToolRegistry::new();
    reg.register(Box::new(StrictTool)).unwrap();
    assert_eq!(reg.len(), 1);
    assert_eq!(reg.permissive_registrations().len(), 0);
}

#[test]
fn type_any_rejected_at_registration() {
    struct TypeAnyTool;
    impl ToolDef for TypeAnyTool {
        fn name(&self) -> &str {
            "type_any"
        }
        fn description(&self) -> &str {
            "tool with type: any"
        }
        fn input_schema(&self) -> Value {
            json!({
                "type": "object",
                "properties": { "payload": { "type": "any" } }
            })
        }
        fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
            unreachable!()
        }
    }
    let mut reg = ToolRegistry::new();
    let err = reg.register(Box::new(TypeAnyTool)).unwrap_err();
    assert!(matches!(
        err,
        RegistryError::PermissiveSchema {
            pattern: crate::strictness::PermissivePattern::TypeAny { .. },
            ..
        }
    ));
}

#[test]
fn computed_schema_validation_runs_at_registration_time() {
    // FR-002: rejection at runtime registration time for computed schemas.
    struct ComputedSchemaTool {
        // Pretend the schema was computed from runtime input.
        runtime_schema: Value,
    }
    impl ToolDef for ComputedSchemaTool {
        fn name(&self) -> &str {
            "computed"
        }
        fn description(&self) -> &str {
            "schema computed at construction time"
        }
        fn input_schema(&self) -> Value {
            self.runtime_schema.clone()
        }
        fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
            unreachable!()
        }
    }
    let mut reg = ToolRegistry::new();
    let permissive = ComputedSchemaTool {
        runtime_schema: json!({ "type": "object" }),
    };
    let err = reg.register(Box::new(permissive)).unwrap_err();
    assert!(matches!(
        err,
        RegistryError::PermissiveSchema {
            pattern: crate::strictness::PermissivePattern::ObjectWithoutProperties { .. },
            ..
        }
    ));
}

#[test]
fn async_registry_rejects_permissive_async_tool() {
    use crate::async_registry::{AsyncToolDef, AsyncToolRegistry};
    use std::sync::Arc;

    struct AsyncPermissive;
    #[async_trait::async_trait]
    impl AsyncToolDef for AsyncPermissive {
        fn name(&self) -> &str {
            "async_permissive"
        }
        fn description(&self) -> &str {
            "permissive async tool"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object" })
        }
        async fn execute(
            &self,
            _: Value,
            _: &mut ToolContext,
        ) -> anyhow::Result<ToolResult> {
            unreachable!()
        }
    }

    let mut reg = AsyncToolRegistry::new();
    let err = reg.register(Arc::new(AsyncPermissive)).unwrap_err();
    assert!(matches!(err, RegistryError::PermissiveSchema { .. }));
}

#[test]
fn async_registry_accepts_opted_in_permissive_async_tool() {
    use crate::async_registry::{AsyncToolDef, AsyncToolRegistry};
    use std::sync::Arc;

    struct AsyncOptIn;
    #[async_trait::async_trait]
    impl AsyncToolDef for AsyncOptIn {
        fn name(&self) -> &str {
            "async_opt_in"
        }
        fn description(&self) -> &str {
            "permissive async tool that opts in"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object" })
        }
        fn permissive(&self) -> bool {
            true
        }
        async fn execute(
            &self,
            _: Value,
            _: &mut ToolContext,
        ) -> anyhow::Result<ToolResult> {
            unreachable!()
        }
    }

    let mut reg = AsyncToolRegistry::new();
    reg.register(Arc::new(AsyncOptIn)).unwrap();
    assert_eq!(reg.permissive_registrations().len(), 1);
    assert_eq!(reg.permissive_registrations()[0].tool, "async_opt_in");
}

// ---------------------------------------------------------------------------
// Performance: 200 tools register quickly (NF-001)
// ---------------------------------------------------------------------------

#[test]
fn register_200_tools_under_50ms() {
    use std::time::Instant;

    struct NthTool(usize);
    impl ToolDef for NthTool {
        fn name(&self) -> &str {
            // Leak a string so we get &str — acceptable in tests.
            Box::leak(format!("tool_{}", self.0).into_boxed_str())
        }
        fn description(&self) -> &str {
            "bench tool"
        }
        fn input_schema(&self) -> Value {
            json!({ "type": "object" })
        }
        fn permissive(&self) -> bool {
            true
        }
        fn execute(&self, _: Value, _: &mut ToolContext) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::success(json!(null)))
        }
    }

    let start = Instant::now();
    let mut reg = ToolRegistry::new();
    for i in 0..200 {
        reg.register(Box::new(NthTool(i))).unwrap();
    }
    let elapsed = start.elapsed();
    assert_eq!(reg.len(), 200);
    assert!(
        elapsed.as_millis() < 50,
        "Registration took {}ms, expected < 50ms",
        elapsed.as_millis()
    );
}
