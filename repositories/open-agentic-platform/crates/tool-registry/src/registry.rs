// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::collections::HashMap;

use serde_json::Value;

use crate::event::{ToolEvent, ToolEventKind};
use crate::strictness::{PermissivePattern, validate_strict_schema};
use crate::types::{PermissionResult, ToolContext, ToolDef, ToolResult};

/// Validation errors for tool registration and input.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("duplicate tool name: '{0}'")]
    DuplicateName(String),
    #[error("invalid input schema for tool '{0}': {1}")]
    InvalidSchema(String, String),
    #[error("input validation failed for tool '{tool}': {message}")]
    InputValidation { tool: String, message: String },
    #[error("tool not found: '{0}'")]
    NotFound(String),
    #[error("permission denied for tool '{tool}': {reason}")]
    PermissionDenied { tool: String, reason: String },
    #[error("permission check requires confirmation for tool '{tool}': {prompt}")]
    PermissionAsk { tool: String, prompt: String },
    /// Spec 169 — schema is permissive and the tool did not opt in via
    /// `permissive(): true`. Names the specific pattern that triggered
    /// the rejection (SC-002).
    #[error(
        "permissive schema for tool '{tool}' rejected by spec 169: {pattern}; \
         override with ToolDef::permissive() = true during migration"
    )]
    PermissiveSchema {
        tool: String,
        pattern: PermissivePattern,
    },
}

/// Record of a `permissive: true` registration — used for inventory and
/// the migration-count contract (SC-005).
#[derive(Debug, Clone)]
pub struct PermissiveRegistration {
    pub tool: String,
    pub pattern: PermissivePattern,
}

/// Central registry collecting all tool definitions (FR-002).
///
/// Tools are registered at startup and looked up by name. The registry
/// validates input against each tool's JSON Schema before execution and
/// emits lifecycle events around every call.
pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn ToolDef>>,
    /// Optional event sink. When set, `PreToolUse` / `PostToolUse` events
    /// are pushed here during `execute()`.
    event_sink: Option<Box<dyn Fn(ToolEvent) + Send + Sync>>,
    /// Spec 169 — registrations that opted into permissive schemas via
    /// `ToolDef::permissive() = true`. Surface this list as a migration
    /// inventory (SC-005).
    permissive_registrations: Vec<PermissiveRegistration>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
            event_sink: None,
            permissive_registrations: Vec::new(),
        }
    }

    /// Attach a callback that receives lifecycle events (FR-007).
    pub fn set_event_sink(&mut self, sink: impl Fn(ToolEvent) + Send + Sync + 'static) {
        self.event_sink = Some(Box::new(sink));
    }

    /// Register a tool. Rejects duplicate names (FR-006). Spec 169:
    /// rejects permissive schemas unless `ToolDef::permissive() = true`
    /// is set (migration opt-out); when opted in, records the
    /// registration so the migration count can be reported.
    pub fn register(&mut self, tool: Box<dyn ToolDef>) -> Result<(), RegistryError> {
        let name = tool.name().to_owned();

        // Validate that the schema is a JSON object with "type": "object".
        let schema = tool.input_schema();
        if schema.get("type").and_then(|v| v.as_str()) != Some("object") {
            return Err(RegistryError::InvalidSchema(
                name,
                "input_schema must have \"type\": \"object\"".into(),
            ));
        }

        // Spec 169 — strictness gate. Permissive schemas are rejected
        // unless the tool opts in via `permissive(): true`.
        if let Err(pattern) = validate_strict_schema(&schema) {
            if tool.permissive() {
                log::warn!(
                    target: "tool_registry::spec169",
                    "permissive schema accepted for tool '{}' (spec 169 opt-out): {}",
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

    /// List all registered tools.
    pub fn list(&self) -> Vec<&dyn ToolDef> {
        self.tools.values().map(|t| t.as_ref()).collect()
    }

    /// Look up a tool by name.
    pub fn get(&self, name: &str) -> Option<&dyn ToolDef> {
        self.tools.get(name).map(|t| t.as_ref())
    }

    /// Number of registered tools.
    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    /// Execute a tool by name with schema validation, permission gating,
    /// and lifecycle event emission (FR-002, NF-003, FR-004, FR-007).
    pub fn execute(
        &self,
        name: &str,
        input: Value,
        ctx: &mut ToolContext,
    ) -> Result<ToolResult, RegistryError> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| RegistryError::NotFound(name.to_owned()))?;

        // NF-003: validate input against schema before execution.
        self.validate_input(name, &input, &tool.input_schema())?;

        // FR-004: permission gate.
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

        // FR-007: emit PreToolUse.
        self.emit(ToolEvent {
            kind: ToolEventKind::PreToolUse,
            tool_name: name.to_owned(),
            input: Some(input.clone()),
            output: None,
            error: None,
        });

        // Execute.
        let result = tool.execute(input, ctx);

        // FR-007: emit PostToolUse.
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

    /// Validate `input` against the tool's JSON Schema (NF-003).
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

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
