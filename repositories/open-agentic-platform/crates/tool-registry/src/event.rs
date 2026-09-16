// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Lifecycle events emitted around tool execution (FR-007).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEvent {
    pub kind: ToolEventKind,
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolEventKind {
    PreToolUse,
    PostToolUse,
}
