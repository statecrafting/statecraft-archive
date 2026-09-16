// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use async_trait::async_trait;
use serde_json::{Map, Value};

/// Permission requirements for a tool.
#[derive(Debug, Clone, Default)]
pub struct ToolPermissions {
    pub requires_file_read: bool,
    pub requires_file_write: bool,
    pub requires_network: bool,
}

/// A provider that handles a group of related MCP tools.
///
/// The router iterates all registered providers in order. For `tool_schemas()`,
/// all providers contribute their schemas. For `handle()`, the first provider
/// that returns `Some` wins.
#[async_trait]
pub trait ToolProvider: Send + Sync {
    /// Return JSON schema definitions for all tools this provider handles.
    /// Each entry is a JSON object matching the MCP tool schema format:
    /// `{ "name": "...", "description": "...", "inputSchema": { ... } }`
    fn tool_schemas(&self) -> Vec<Value>;

    /// Attempt to handle a tool call. Returns `None` if this provider does not
    /// recognize the tool name. Returns `Some(Ok(value))` on success or
    /// `Some(Err(e))` on failure.
    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<anyhow::Result<Value>>;

    /// Return the tool tier for the given name, or None if not handled.
    /// Used by the router for permission enforcement before dispatch.
    fn tier(&self, name: &str) -> Option<agent::safety::ToolTier>;

    /// Return permission requirements for the given tool name.
    /// Used by the router for grant checking before dispatch.
    fn permissions(&self, name: &str) -> Option<ToolPermissions>;
}
