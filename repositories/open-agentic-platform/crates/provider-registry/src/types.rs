// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

/// Message role for normalised events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Role::User => write!(f, "user"),
            Role::Assistant => write!(f, "assistant"),
            Role::System => write!(f, "system"),
            Role::Tool => write!(f, "tool"),
        }
    }
}

/// Token usage accounting.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
}

/// Normalised event emitted by all providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TextDelta {
        delta: String,
    },
    TextComplete {
        text: String,
    },
    ToolUseStart {
        tool_call_id: String,
        tool_name: String,
    },
    ToolUseDelta {
        tool_call_id: String,
        delta: String,
    },
    ToolUseComplete {
        tool_call_id: String,
        input: Value,
    },
    ToolResult {
        tool_call_id: String,
        output: Value,
        is_error: bool,
    },
    ThinkingDelta {
        delta: String,
    },
    ThinkingComplete {
        text: String,
    },
    MessageStart {
        role: Role,
        model: String,
    },
    MessageComplete {
        stop_reason: String,
        usage: TokenUsage,
    },
    Error {
        code: String,
        message: String,
        retryable: bool,
    },
}

/// Capabilities a provider advertises.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub streaming: bool,
    pub tool_use: bool,
    pub vision: bool,
    pub extended_thinking: bool,
    pub max_context_tokens: u64,
}

/// Configuration supplied when registering a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_rpm: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

/// A session created by `ProviderAdapter::spawn()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub session_id: String,
    pub provider_id: String,
    pub model: String,
    pub created_at: u64,
}

/// A single message in a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: MessageContent,
}

/// Message content — plain text or structured blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

/// A content block within a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    Image {
        source: Value,
    },
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: Value,
        is_error: bool,
    },
}

/// Tool definition for provider tool-use capabilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Query parameters for single-turn and streaming calls.
#[derive(Debug, Clone)]
pub struct QueryParams {
    pub model: Option<String>,
    pub messages: Vec<Message>,
    pub system_prompt: Option<String>,
    pub tools: Vec<ToolDefinition>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}
