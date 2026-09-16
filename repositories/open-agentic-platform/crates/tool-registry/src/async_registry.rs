// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Async tool execution support.
//!
//! Provides [`AsyncToolDef`] for tools with async execute methods and
//! [`AsyncToolRegistry`] that wraps `ToolRegistry` with async dispatch.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::event::{ToolEvent, ToolEventKind};
use crate::registry::{PermissiveRegistration, RegistryError};
use crate::strictness::validate_strict_schema;
use crate::types::{PermissionResult, ToolContext, ToolResult};

/// Async variant of [`crate::ToolDef`].
///
/// Axiomregent's MCP tool handlers are async (tokio). This trait allows
/// them to be registered and executed without blocking the runtime.
#[async_trait]
pub trait AsyncToolDef: Send + Sync {
    /// Unique tool name.
    fn name(&self) -> &str;

    /// Human-readable description.
    fn description(&self) -> &str;

    /// JSON Schema for the tool's input parameters.
    fn input_schema(&self) -> Value;

    /// Spec 169 §2.1 — migration opt-out (see [`crate::ToolDef::permissive`]).
    fn permissive(&self) -> bool {
        false
    }

    /// Permission gate. Defaults to `Allow`.
    fn can_use(&self, ctx: &ToolContext) -> anyhow::Result<PermissionResult> {
        match &ctx.policy {
            Some(handle) => Ok(handle.0.evaluate(self.name(), "")),
            None => Ok(PermissionResult::Allow),
        }
    }

    /// Execute the tool asynchronously.
    async fn execute(&self, input: Value, ctx: &mut ToolContext) -> anyhow::Result<ToolResult>;
}

/// Async-aware tool registry.
///
/// Collects [`AsyncToolDef`] implementations and provides schema validation,
/// permission gating, and lifecycle event emission around async execution.
pub struct AsyncToolRegistry {
    tools: HashMap<String, Arc<dyn AsyncToolDef>>,
    event_sink: Option<Box<dyn Fn(ToolEvent) + Send + Sync>>,
    /// Spec 169 — opted-in permissive registrations (migration window).
    permissive_registrations: Vec<PermissiveRegistration>,
}

impl AsyncToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            event_sink: None,
            permissive_registrations: Vec::new(),
        }
    }

    /// Attach a callback that receives lifecycle events.
    pub fn set_event_sink(&mut self, sink: impl Fn(ToolEvent) + Send + Sync + 'static) {
        self.event_sink = Some(Box::new(sink));
    }

    /// Register an async tool. Rejects duplicate names. Spec 169:
    /// rejects permissive schemas unless `AsyncToolDef::permissive() =
    /// true` is set (migration opt-out).
    pub fn register(&mut self, tool: Arc<dyn AsyncToolDef>) -> Result<(), RegistryError> {
        let name = tool.name().to_owned();

        let schema = tool.input_schema();
        if schema.get("type").and_then(|v| v.as_str()) != Some("object") {
            return Err(RegistryError::InvalidSchema(
                name,
                "input_schema must have \"type\": \"object\"".into(),
            ));
        }

        // Spec 169 — strictness gate.
        if let Err(pattern) = validate_strict_schema(&schema) {
            if tool.permissive() {
                log::warn!(
                    target: "tool_registry::spec169",
                    "permissive schema accepted for async tool '{}' (spec 169 opt-out): {}",
                    name,
                    pattern,
                );
                self.permissive_registrations
                    .push(PermissiveRegistration {
                        tool: name.clone(),
                        pattern,
                    });
            } else {
                return Err(RegistryError::PermissiveSchema {
                    tool: name,
                    pattern,
                });
            }
        }

        if self.tools.contains_key(&name) {
            return Err(RegistryError::DuplicateName(name));
        }

        self.tools.insert(name, tool);
        Ok(())
    }

    /// Inventory of permissive (opted-in) registrations recorded by
    /// `register()`. Drives the migration-count contract (SC-005).
    pub fn permissive_registrations(&self) -> &[PermissiveRegistration] {
        &self.permissive_registrations
    }

    /// List all registered tool schemas (for MCP tools/list).
    pub fn list_schemas(&self) -> Vec<Value> {
        self.tools
            .values()
            .map(|t| {
                serde_json::json!({
                    "name": t.name(),
                    "description": t.description(),
                    "inputSchema": t.input_schema(),
                })
            })
            .collect()
    }

    /// Look up a tool by name.
    pub fn get(&self, name: &str) -> Option<&Arc<dyn AsyncToolDef>> {
        self.tools.get(name)
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Execute a tool by name with schema validation, permission gating,
    /// and lifecycle event emission.
    pub async fn execute(
        &self,
        name: &str,
        input: Value,
        ctx: &mut ToolContext,
    ) -> Result<ToolResult, RegistryError> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| RegistryError::NotFound(name.to_owned()))?;

        // Validate input against schema.
        self.validate_input(name, &input, &tool.input_schema())?;

        // Permission gate.
        let perm = tool
            .can_use(ctx)
            .map_err(|e| RegistryError::PermissionDenied {
                tool: name.to_owned(),
                reason: e.to_string(),
            })?;

        match perm {
            PermissionResult::Deny(reason) => {
                return Err(RegistryError::PermissionDenied {
                    tool: name.to_owned(),
                    reason,
                });
            }
            PermissionResult::Ask(prompt) => {
                return Err(RegistryError::PermissionAsk {
                    tool: name.to_owned(),
                    prompt,
                });
            }
            PermissionResult::Allow => {}
        }

        // Emit PreToolUse.
        self.emit(ToolEvent {
            kind: ToolEventKind::PreToolUse,
            tool_name: name.to_owned(),
            input: Some(input.clone()),
            output: None,
            error: None,
        });

        // Execute async.
        let result = tool.execute(input, ctx).await;

        // Emit PostToolUse.
        match &result {
            Ok(res) => {
                self.emit(ToolEvent {
                    kind: ToolEventKind::PostToolUse,
                    tool_name: name.to_owned(),
                    input: None,
                    output: Some(res.content.clone()),
                    error: if res.is_error {
                        Some(res.content.to_string())
                    } else {
                        None
                    },
                });
            }
            Err(e) => {
                self.emit(ToolEvent {
                    kind: ToolEventKind::PostToolUse,
                    tool_name: name.to_owned(),
                    input: None,
                    output: None,
                    error: Some(e.to_string()),
                });
            }
        }

        result.map_err(|e| RegistryError::PermissionDenied {
            tool: name.to_owned(),
            reason: e.to_string(),
        })
    }

    fn validate_input(
        &self,
        tool_name: &str,
        input: &Value,
        schema: &Value,
    ) -> Result<(), RegistryError> {
        jsonschema::validate(schema, input).map_err(|e| RegistryError::InputValidation {
            tool: tool_name.to_owned(),
            message: e.to_string(),
        })
    }

    fn emit(&self, event: ToolEvent) {
        if let Some(sink) = &self.event_sink {
            sink(event);
        }
    }
}

impl Default for AsyncToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
