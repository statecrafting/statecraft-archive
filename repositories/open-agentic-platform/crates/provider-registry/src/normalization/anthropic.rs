// SPDX-License-Identifier: AGPL-3.0-or-later
//! Anthropic SSE → AgentEvent normalizer.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::types::{AgentEvent, Role, TokenUsage};

/// Raw Anthropic SSE event, deserialized from the `data:` field.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum AnthropicSseEvent {
    #[serde(rename = "message_start")]
    MessageStart { message: MessagePayload },
    #[serde(rename = "content_block_start")]
    ContentBlockStart {
        index: u32,
        content_block: ContentBlockPayload,
    },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { index: u32, delta: DeltaPayload },
    #[serde(rename = "content_block_stop")]
    ContentBlockStop { index: u32 },
    #[serde(rename = "message_delta")]
    MessageDelta {
        delta: MessageDeltaInfo,
        usage: UsagePayload,
    },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "error")]
    Error { error: ErrorPayload },
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessagePayload {
    pub model: String,
    #[serde(default)]
    pub usage: Option<UsagePayload>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ContentBlockPayload {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum DeltaPayload {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "input_json_delta")]
    InputJsonDelta { partial_json: String },
    #[serde(rename = "thinking_delta")]
    ThinkingDelta { thinking: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct MessageDeltaInfo {
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UsagePayload {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorPayload {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

/// Stateful normalizer: one per streaming request.
pub struct AnthropicStreamNormalizer {
    tool_input_by_index: HashMap<u32, String>,
    tool_meta_by_index: HashMap<u32, (String, String)>, // (id, name)
    last_usage: Option<TokenUsage>,
    last_stop_reason: Option<String>,
}

impl AnthropicStreamNormalizer {
    pub fn new() -> Self {
        Self {
            tool_input_by_index: HashMap::new(),
            tool_meta_by_index: HashMap::new(),
            last_usage: None,
            last_stop_reason: None,
        }
    }

    /// Process a single SSE event, returning zero or more AgentEvents.
    pub fn push(&mut self, event: &AnthropicSseEvent) -> Vec<AgentEvent> {
        match event {
            AnthropicSseEvent::MessageStart { message } => {
                vec![AgentEvent::MessageStart {
                    role: Role::Assistant,
                    model: message.model.clone(),
                }]
            }
            AnthropicSseEvent::ContentBlockStart {
                index,
                content_block,
            } => match content_block {
                ContentBlockPayload::ToolUse { id, name } => {
                    self.tool_meta_by_index
                        .insert(*index, (id.clone(), name.clone()));
                    self.tool_input_by_index.insert(*index, String::new());
                    vec![AgentEvent::ToolUseStart {
                        tool_call_id: id.clone(),
                        tool_name: name.clone(),
                    }]
                }
                _ => vec![],
            },
            AnthropicSseEvent::ContentBlockDelta { index, delta } => match delta {
                DeltaPayload::TextDelta { text } => {
                    vec![AgentEvent::TextDelta {
                        delta: text.clone(),
                    }]
                }
                DeltaPayload::InputJsonDelta { partial_json } => {
                    if let Some(buf) = self.tool_input_by_index.get_mut(index) {
                        buf.push_str(partial_json);
                    }
                    let tool_call_id = self
                        .tool_meta_by_index
                        .get(index)
                        .map(|(id, _)| id.clone())
                        .unwrap_or_else(|| index.to_string());
                    vec![AgentEvent::ToolUseDelta {
                        tool_call_id,
                        delta: partial_json.clone(),
                    }]
                }
                DeltaPayload::ThinkingDelta { thinking } => {
                    vec![AgentEvent::ThinkingDelta {
                        delta: thinking.clone(),
                    }]
                }
            },
            AnthropicSseEvent::ContentBlockStop { index } => {
                let meta = self.tool_meta_by_index.remove(index);
                let buf = self.tool_input_by_index.remove(index);
                match (meta, buf) {
                    (Some((id, _name)), Some(buf)) => {
                        let input = if buf.is_empty() {
                            Value::Object(serde_json::Map::new())
                        } else {
                            serde_json::from_str(&buf).unwrap_or(Value::String(buf))
                        };
                        vec![AgentEvent::ToolUseComplete {
                            tool_call_id: id,
                            input,
                        }]
                    }
                    _ => vec![],
                }
            }
            AnthropicSseEvent::MessageDelta { delta, usage } => {
                self.last_usage = Some(TokenUsage {
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    cache_read_tokens: usage.cache_read_input_tokens,
                    cache_write_tokens: usage.cache_creation_input_tokens,
                });
                self.last_stop_reason = delta.stop_reason.clone();
                vec![]
            }
            AnthropicSseEvent::MessageStop => {
                if let Some(usage) = self.last_usage.take() {
                    vec![AgentEvent::MessageComplete {
                        stop_reason: self
                            .last_stop_reason
                            .take()
                            .unwrap_or_else(|| "end_turn".to_string()),
                        usage,
                    }]
                } else {
                    vec![]
                }
            }
            AnthropicSseEvent::Ping => vec![],
            AnthropicSseEvent::Error { error } => {
                vec![AgentEvent::Error {
                    code: error.error_type.clone(),
                    message: error.message.clone(),
                    retryable: error.error_type == "overloaded_error",
                }]
            }
        }
    }
}

impl Default for AnthropicStreamNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert a non-streaming Anthropic response to AgentEvents.
pub fn message_to_agent_events(
    model: &str,
    stop_reason: Option<&str>,
    content: &[Value],
    usage: &UsagePayload,
) -> Vec<AgentEvent> {
    let mut out = vec![AgentEvent::MessageStart {
        role: Role::Assistant,
        model: model.to_string(),
    }];

    for block in content {
        let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match block_type {
            "text" => {
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    out.push(AgentEvent::TextComplete {
                        text: text.to_string(),
                    });
                }
            }
            "tool_use" => {
                let id = block
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let input = block
                    .get("input")
                    .cloned()
                    .unwrap_or(Value::Object(Default::default()));
                out.push(AgentEvent::ToolUseStart {
                    tool_call_id: id.clone(),
                    tool_name: name,
                });
                out.push(AgentEvent::ToolUseComplete {
                    tool_call_id: id,
                    input,
                });
            }
            "thinking" => {
                if let Some(text) = block.get("thinking").and_then(|v| v.as_str()) {
                    out.push(AgentEvent::ThinkingComplete {
                        text: text.to_string(),
                    });
                }
            }
            _ => {}
        }
    }

    out.push(AgentEvent::MessageComplete {
        stop_reason: stop_reason.unwrap_or("end_turn").to_string(),
        usage: TokenUsage {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_tokens: usage.cache_read_input_tokens,
            cache_write_tokens: usage.cache_creation_input_tokens,
        },
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_event(json: &str) -> AnthropicSseEvent {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn normalizes_text_stream() {
        let mut n = AnthropicStreamNormalizer::new();

        let events_json = [
            r#"{"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":10,"output_tokens":0}}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":10,"output_tokens":5}}"#,
            r#"{"type":"message_stop"}"#,
        ];

        let all_events: Vec<AgentEvent> = events_json
            .iter()
            .flat_map(|json| n.push(&parse_event(json)))
            .collect();

        assert!(
            matches!(&all_events[0], AgentEvent::MessageStart { role: Role::Assistant, model } if model == "claude-sonnet-4-20250514")
        );
        assert!(matches!(&all_events[1], AgentEvent::TextDelta { delta } if delta == "Hello"));
        assert!(matches!(&all_events[2], AgentEvent::TextDelta { delta } if delta == " world"));
        assert!(
            matches!(&all_events[3], AgentEvent::MessageComplete { stop_reason, usage } if stop_reason == "end_turn" && usage.output_tokens == 5)
        );
        assert_eq!(all_events.len(), 4);
    }

    #[test]
    fn normalizes_tool_use_stream() {
        let mut n = AnthropicStreamNormalizer::new();

        let events_json = [
            r#"{"type":"message_start","message":{"model":"claude-sonnet-4-20250514"}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"loc"}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ation\":\"NYC\"}"}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":20,"output_tokens":15}}"#,
            r#"{"type":"message_stop"}"#,
        ];

        let all_events: Vec<AgentEvent> = events_json
            .iter()
            .flat_map(|json| n.push(&parse_event(json)))
            .collect();

        assert!(matches!(&all_events[0], AgentEvent::MessageStart { .. }));
        assert!(
            matches!(&all_events[1], AgentEvent::ToolUseStart { tool_call_id, tool_name } if tool_call_id == "toolu_01" && tool_name == "get_weather")
        );
        assert!(matches!(&all_events[2], AgentEvent::ToolUseDelta { .. }));
        assert!(matches!(&all_events[3], AgentEvent::ToolUseDelta { .. }));
        // ToolUseComplete with parsed JSON input
        if let AgentEvent::ToolUseComplete {
            tool_call_id,
            input,
        } = &all_events[4]
        {
            assert_eq!(tool_call_id, "toolu_01");
            assert_eq!(input.get("location").and_then(|v| v.as_str()), Some("NYC"));
        } else {
            panic!("expected ToolUseComplete, got {:?}", all_events[4]);
        }
        assert!(
            matches!(&all_events[5], AgentEvent::MessageComplete { stop_reason, .. } if stop_reason == "tool_use")
        );
    }

    #[test]
    fn normalizes_thinking_stream() {
        let mut n = AnthropicStreamNormalizer::new();

        let events_json = [
            r#"{"type":"message_start","message":{"model":"claude-sonnet-4-20250514"}}"#,
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}"#,
            r#"{"type":"content_block_stop","index":0}"#,
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"The answer is 42."}}"#,
            r#"{"type":"content_block_stop","index":1}"#,
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":30,"output_tokens":20}}"#,
            r#"{"type":"message_stop"}"#,
        ];

        let all_events: Vec<AgentEvent> = events_json
            .iter()
            .flat_map(|json| n.push(&parse_event(json)))
            .collect();

        assert!(matches!(&all_events[0], AgentEvent::MessageStart { .. }));
        assert!(
            matches!(&all_events[1], AgentEvent::ThinkingDelta { delta } if delta == "Let me think...")
        );
        assert!(
            matches!(&all_events[2], AgentEvent::TextDelta { delta } if delta == "The answer is 42.")
        );
        assert!(matches!(&all_events[3], AgentEvent::MessageComplete { .. }));
    }

    #[test]
    fn handles_error_event() {
        let mut n = AnthropicStreamNormalizer::new();
        let event = parse_event(
            r#"{"type":"error","error":{"type":"overloaded_error","message":"API is overloaded"}}"#,
        );
        let events = n.push(&event);
        assert_eq!(events.len(), 1);
        assert!(
            matches!(&events[0], AgentEvent::Error { code, retryable, .. } if code == "overloaded_error" && *retryable)
        );
    }

    #[test]
    fn handles_ping() {
        let mut n = AnthropicStreamNormalizer::new();
        let event = parse_event(r#"{"type":"ping"}"#);
        assert!(n.push(&event).is_empty());
    }
}
