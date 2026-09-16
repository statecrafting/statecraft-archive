// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Bridge between axiomregent's `ToolProvider` trait and the unified
//! `AsyncToolRegistry` from `tool-registry` (spec 067).
//!
//! Each tool exposed by a `ToolProvider` is wrapped as an `AsyncToolDef`
//! and registered in the shared `AsyncToolRegistry`. This gives us:
//! - Schema validation before dispatch
//! - Lifecycle events (PreToolUse / PostToolUse)
//! - A single tool inventory for MCP tools/list
//! - A seam for the future lifecycle hook runtime (spec 069)

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Map, Value};
use tool_registry::async_registry::{AsyncToolDef, AsyncToolRegistry};
use tool_registry::strictness::validate_strict_schema;
use tool_registry::{PermissionResult, ToolContext, ToolEvent, ToolResult};

use crate::router::provider::ToolProvider;

/// Type alias for use in Router and main.
pub type AsyncToolRegistryHandle = Arc<AsyncToolRegistry>;

/// Wraps a single tool from a `ToolProvider` as an `AsyncToolDef`.
///
/// Captures the provider and the tool's static schema metadata.
/// On `execute`, delegates to `provider.handle(name, args)`.
struct ProviderToolDef {
    tool_name: String,
    tool_description: String,
    schema: Value,
    provider: Arc<dyn ToolProvider>,
    /// Spec 169 — true when the schema is permissive and the bridge
    /// auto-marked the registration as opted into the migration window.
    /// Authored providers should tighten their schemas; this flag exists
    /// so the migration is incremental rather than a hard break.
    permissive: bool,
}

#[async_trait]
impl AsyncToolDef for ProviderToolDef {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.tool_description
    }

    fn input_schema(&self) -> Value {
        self.schema.clone()
    }

    fn permissive(&self) -> bool {
        self.permissive
    }

    fn can_use(&self, _ctx: &ToolContext) -> anyhow::Result<PermissionResult> {
        // Permission enforcement is handled by the Router's preflight check
        // (lease-based + policy bundle). The registry layer allows all here.
        Ok(PermissionResult::Allow)
    }

    async fn execute(&self, input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
        let args: Map<String, Value> = match input.as_object() {
            Some(obj) => obj.clone(),
            None => Map::new(),
        };

        match self.provider.handle(&self.tool_name, &args).await {
            Some(Ok(value)) => Ok(ToolResult::success(value)),
            Some(Err(e)) => Ok(ToolResult::error(e.to_string())),
            None => Ok(ToolResult::error(format!(
                "Tool '{}' not handled by provider",
                self.tool_name
            ))),
        }
    }
}

/// Build an `AsyncToolRegistry` from a list of `ToolProvider`s.
///
/// Iterates each provider's `tool_schemas()`, extracts the name/description/schema,
/// and wraps each as a `ProviderToolDef`.
pub fn build_registry(
    providers: &[Arc<dyn ToolProvider>],
    event_sink: Option<Box<dyn Fn(ToolEvent) + Send + Sync>>,
) -> AsyncToolRegistry {
    let mut registry = AsyncToolRegistry::new();

    if let Some(sink) = event_sink {
        registry.set_event_sink(sink);
    }

    for provider in providers {
        for schema_entry in provider.tool_schemas() {
            let name = schema_entry
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let description = schema_entry
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let input_schema = schema_entry
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({"type": "object"}));

            if name.is_empty() {
                log::warn!("Skipping tool with empty name from provider schema");
                continue;
            }

            // Spec 169 — auto-mark permissive provider schemas as opted into
            // the migration window. Authored providers should tighten their
            // schemas (FR-007); this flag keeps the registration path open
            // while the corpus migrates. The strictness validator emits a
            // structured log line naming the tool and pattern.
            let permissive = match validate_strict_schema(&input_schema) {
                Ok(()) => false,
                Err(pattern) => {
                    log::info!(
                        target: "axiomregent::spec169",
                        "permissive schema for provider tool '{}' (migration opt-in): {}",
                        name,
                        pattern,
                    );
                    true
                }
            };

            let tool = Arc::new(ProviderToolDef {
                tool_name: name.clone(),
                tool_description: description,
                schema: input_schema,
                provider: Arc::clone(provider),
                permissive,
            });

            if let Err(e) = registry.register(tool) {
                log::warn!("Failed to register tool '{}': {}", name, e);
            }
        }
    }

    log::info!(
        "AsyncToolRegistry built with {} tools ({} permissive — spec 169 migration window)",
        registry.len(),
        registry.permissive_registrations().len(),
    );
    registry
}
