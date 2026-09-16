// SPDX-License-Identifier: AGPL-3.0-or-later
//! OpenAI Chat Completions SSE → AgentEvent normalizer.

use std::collections::HashMap;

use serde_json::Value;

use crate::types::{AgentEvent, Role, TokenUsage};

/// Stateful normalizer for OpenAI streaming chunks.
pub struct OpenAiStreamNormalizer {
    /// Accumulated tool call arguments by index.
    tool_args_by_index: HashMap<u32, String>,
    /// Tool call metadata by index: (id, function_name).
    tool_meta_by_index: HashMap<u32, (String, String)>,
    model: String,
}

impl OpenAiStreamNormalizer {
    pub fn new() -> Self {
        Self {
            tool_args_by_index: HashMap::new(),
            tool_meta_by_index: HashMap::new(),
            model: String::new(),
        }
    }

    /// Process a single streaming chunk (parsed JSON), returning zero or more AgentEvents.
    pub fn push(&mut self, chunk: &Value) -> Vec<AgentEvent> {
        let mut events = Vec::new();

        // Extract model on first chunk
        if self.model.is_empty()
            && let Some(m) = chunk.get("model").and_then(|v| v.as_str())
        {
            self.model = m.to_string();
            events.push(AgentEvent::MessageStart {
                role: Role::Assistant,
                model: self.model.clone(),
            });
        }

        // Process choices
        if let Some(choices) = chunk.get("choices").and_then(|v| v.as_array()) {
            for choice in choices {
                let delta = match choice.get("delta") {
                    Some(d) => d,
                    None => continue,
                };

                // Text content
                if let Some(content) = delta.get("content").and_then(|v| v.as_str())
                    && !content.is_empty()
                {
                    events.push(AgentEvent::TextDelta {
                        delta: content.to_string(),
                    });
                }

                // Tool calls
                if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                    for tc in tool_calls {
                        let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;

                        // Tool call start (has id + function.name)
                        if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                            let name = tc
                                .get("function")
                                .and_then(|f| f.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            self.tool_meta_by_index
                                .insert(index, (id.to_string(), name.clone()));
                            self.tool_args_by_index.insert(index, String::new());
                            events.push(AgentEvent::ToolUseStart {
                                tool_call_id: id.to_string(),
                                tool_name: name,
                            });
                        }

                        // Tool call argument delta
                        if let Some(args) = tc
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .and_then(|v| v.as_str())
                            && !args.is_empty()
                        {
                            if let Some(buf) = self.tool_args_by_index.get_mut(&index) {
                                buf.push_str(args);
                            }
                            let tool_call_id = self
                                .tool_meta_by_index
                                .get(&index)
                                .map(|(id, _)| id.clone())
                                .unwrap_or_else(|| index.to_string());
                            events.push(AgentEvent::ToolUseDelta {
                                tool_call_id,
                                delta: args.to_string(),
                            });
                        }
                    }
                }

                // Finish reason — emit tool_use_complete for any accumulated tool calls
                if let Some(finish) = choice.get("finish_reason").and_then(|v| v.as_str())
                    && (finish == "tool_calls" || finish == "stop")
                {
                    let indices: Vec<u32> = self.tool_meta_by_index.keys().cloned().collect();
                    for idx in indices {
                        if let (Some((id, _name)), Some(args)) = (
                            self.tool_meta_by_index.remove(&idx),
                            self.tool_args_by_index.remove(&idx),
                        ) {
                            let input = if args.is_empty() {
                                Value::Object(Default::default())
                            } else {
                                serde_json::from_str(&args).unwrap_or(Value::String(args))
                            };
                            events.push(AgentEvent::ToolUseComplete {
                                tool_call_id: id,
                                input,
                            });
                        }
                    }
                }
            }
        }

        // Usage (included when stream_options.include_usage = true)
        if let Some(usage) = chunk.get("usage")
            && !usage.is_null()
        {
            let input_tokens = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cache_read = usage
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|v| v.as_u64());

            events.push(AgentEvent::MessageComplete {
                stop_reason: "end_turn".to_string(),
                usage: TokenUsage {
                    input_tokens,
                    output_tokens,
                    cache_read_tokens: cache_read,
                    cache_write_tokens: None,
                },
            });
        }

        events
    }
}

impl Default for OpenAiStreamNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert a non-streaming OpenAI chat completion response to AgentEvents.
pub fn completion_to_agent_events(response: &Value) -> Vec<AgentEvent> {
    let model = response
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let mut events = vec![AgentEvent::MessageStart {
        role: Role::Assistant,
        model,
    }];

    if let Some(choices) = response.get("choices").and_then(|v| v.as_array()) {
        for choice in choices {
            let message = match choice.get("message") {
                Some(m) => m,
                None => continue,
            };

            // Text content
            if let Some(content) = message.get("content").and_then(|v| v.as_str()) {
                events.push(AgentEvent::TextComplete {
                    text: content.to_string(),
                });
            }

            // Tool calls
            if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
                for tc in tool_calls {
                    let id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let args_str = tc
                        .get("function")
                        .and_then(|f| f.get("arguments"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let input: Value = serde_json::from_str(args_str)
                        .unwrap_or(Value::String(args_str.to_string()));

                    events.push(AgentEvent::ToolUseStart {
                        tool_call_id: id.clone(),
                        tool_name: name,
                    });
                    events.push(AgentEvent::ToolUseComplete {
                        tool_call_id: id,
                        input,
                    });
                }
            }
        }
    }

    // Usage
    if let Some(usage) = response.get("usage") {
        let input_tokens = usage
            .get("prompt_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output_tokens = usage
            .get("completion_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let stop_reason = response
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("finish_reason"))
            .and_then(|v| v.as_str())
            .unwrap_or("stop");

        events.push(AgentEvent::MessageComplete {
            stop_reason: stop_reason.to_string(),
            usage: TokenUsage {
                input_tokens,
                output_tokens,
                cache_read_tokens: None,
                cache_write_tokens: None,
            },
        });
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_text_stream() {
        let mut n = OpenAiStreamNormalizer::new();

        let chunks = [
            r#"{"model":"gpt-4o","choices":[{"delta":{"role":"assistant","content":""},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{"content":"Hello"},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{"content":" world"},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#,
        ];

        let all_events: Vec<AgentEvent> = chunks
            .iter()
            .flat_map(|json| n.push(&serde_json::from_str::<Value>(json).unwrap()))
            .collect();

        assert!(
            matches!(&all_events[0], AgentEvent::MessageStart { model, .. } if model == "gpt-4o")
        );
        assert!(matches!(&all_events[1], AgentEvent::TextDelta { delta } if delta == "Hello"));
        assert!(matches!(&all_events[2], AgentEvent::TextDelta { delta } if delta == " world"));
        assert!(
            matches!(&all_events[3], AgentEvent::MessageComplete { usage, .. } if usage.input_tokens == 10)
        );
    }

    #[test]
    fn normalizes_tool_call_stream() {
        let mut n = OpenAiStreamNormalizer::new();

        let chunks = [
            r#"{"model":"gpt-4o","choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"loc"}}]},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\":\"NYC\"}"}}]},"index":0}]}"#,
            r#"{"model":"gpt-4o","choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":15}}"#,
        ];

        let all_events: Vec<AgentEvent> = chunks
            .iter()
            .flat_map(|json| n.push(&serde_json::from_str::<Value>(json).unwrap()))
            .collect();

        assert!(matches!(&all_events[0], AgentEvent::MessageStart { .. }));
        assert!(
            matches!(&all_events[1], AgentEvent::ToolUseStart { tool_call_id, tool_name } if tool_call_id == "call_abc" && tool_name == "get_weather")
        );
        // Deltas
        assert!(matches!(&all_events[2], AgentEvent::ToolUseDelta { .. }));
        assert!(matches!(&all_events[3], AgentEvent::ToolUseDelta { .. }));
        // Complete with parsed input
        if let AgentEvent::ToolUseComplete {
            tool_call_id,
            input,
        } = &all_events[4]
        {
            assert_eq!(tool_call_id, "call_abc");
            assert_eq!(input.get("location").and_then(|v| v.as_str()), Some("NYC"));
        } else {
            panic!("expected ToolUseComplete");
        }
        assert!(matches!(&all_events[5], AgentEvent::MessageComplete { .. }));
    }

    #[test]
    fn non_streaming_completion() {
        let response = serde_json::from_str::<Value>(
            r#"{
            "model": "gpt-4o",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Hello!"
                },
                "finish_reason": "stop"
            }],
            "usage": { "prompt_tokens": 5, "completion_tokens": 2 }
        }"#,
        )
        .unwrap();

        let events = completion_to_agent_events(&response);
        assert_eq!(events.len(), 3);
        assert!(matches!(&events[0], AgentEvent::MessageStart { model, .. } if model == "gpt-4o"));
        assert!(matches!(&events[1], AgentEvent::TextComplete { text } if text == "Hello!"));
        assert!(
            matches!(&events[2], AgentEvent::MessageComplete { stop_reason, usage } if stop_reason == "stop" && usage.output_tokens == 2)
        );
    }
}
