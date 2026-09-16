// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use serde_json::Value;
use std::sync::Arc;

use crate::types::{McpClient, ToolContext, ToolDef, ToolResult};

/// Adapter that wraps an MCP-discovered tool as a [`ToolDef`] (FR-005).
///
/// Created from the `ListTools` response of an MCP server and delegates
/// execution to the MCP client's `CallTool`.
pub struct McpToolDef {
    tool_name: String,
    tool_description: String,
    schema: Value,
    client: Arc<dyn McpClient>,
}

impl McpToolDef {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        schema: Value,
        client: Arc<dyn McpClient>,
    ) -> Self {
        Self {
            tool_name: name.into(),
            tool_description: description.into(),
            schema,
            client,
        }
    }
}

impl ToolDef for McpToolDef {
    fn name(&self) -> &str {
        &self.tool_name
    }

    fn description(&self) -> &str {
        &self.tool_description
    }

    fn input_schema(&self) -> Value {
        self.schema.clone()
    }

    fn execute(&self, input: Value, _ctx: &mut ToolContext) -> anyhow::Result<ToolResult> {
        self.client.call_tool(&self.tool_name, input)
    }
}
