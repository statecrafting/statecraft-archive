// SPDX-License-Identifier: AGPL-3.0-or-later
//! OpenAI Chat Completions adapter — implemented in Phase 3.

use std::pin::Pin;
use std::sync::Arc;

use dashmap::DashMap;
use futures_core::Stream;
use reqwest::Client;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::ProviderAdapter;
use crate::error::ProviderError;
use crate::normalization::openai::OpenAiStreamNormalizer;
use crate::types::*;

const DEFAULT_BASE_URL: &str = "https://api.openai.com";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// OpenAI Chat Completions API provider.
pub struct OpenAiAdapter {
    config: ProviderConfig,
    client: Client,
    capabilities: ProviderCapabilities,
    inflight: Arc<DashMap<String, CancellationToken>>,
}

impl OpenAiAdapter {
    pub fn new(config: ProviderConfig) -> Self {
        let timeout = config
            .timeout_ms
            .map(std::time::Duration::from_millis)
            .unwrap_or(std::time::Duration::from_secs(300));

        let client = Client::builder()
            .timeout(timeout)
            .build()
            .expect("failed to build reqwest client");

        Self {
            config,
            client,
            capabilities: ProviderCapabilities {
                streaming: true,
                tool_use: true,
                vision: true,
                extended_thinking: false,
                max_context_tokens: 128_000,
            },
            inflight: Arc::new(DashMap::new()),
        }
    }

    fn require_key(&self) -> Result<&str, ProviderError> {
        self.config
            .api_key
            .as_deref()
            .filter(|k| !k.trim().is_empty())
            .ok_or_else(|| ProviderError::MissingApiKey {
                provider_id: self.config.id.clone(),
            })
    }

    fn base_url(&self) -> &str {
        self.config.base_url.as_deref().unwrap_or(DEFAULT_BASE_URL)
    }

    fn build_request_body(&self, session: &AgentSession, params: &QueryParams) -> Value {
        let model = params.model.as_deref().unwrap_or(&session.model);
        let max_tokens = params.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS);

        let mut messages: Vec<Value> = Vec::new();

        // System prompt as first message
        if let Some(ref sys) = params.system_prompt {
            messages.push(json!({ "role": "system", "content": sys }));
        }

        for m in &params.messages {
            if m.role == Role::System {
                continue; // already handled above
            }
            let content = match &m.content {
                MessageContent::Text(t) => Value::String(t.clone()),
                MessageContent::Blocks(blocks) => {
                    let parts: Vec<Value> = blocks
                        .iter()
                        .map(|b| match b {
                            ContentBlock::Text { text } => {
                                json!({ "type": "text", "text": text })
                            }
                            ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                                ..
                            } => {
                                json!({
                                    "role": "tool",
                                    "tool_call_id": tool_use_id,
                                    "content": content.to_string(),
                                })
                            }
                            _ => serde_json::to_value(b).unwrap_or_default(),
                        })
                        .collect();
                    Value::Array(parts)
                }
            };

            let role_str = match m.role {
                Role::Tool => "tool",
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::System => "system",
            };
            messages.push(json!({ "role": role_str, "content": content }));
        }

        let mut body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
        });

        if let Some(temp) = params.temperature {
            body["temperature"] = json!(temp);
        }
        if !params.tools.is_empty() {
            let tools: Vec<Value> = params
                .tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.input_schema,
                        }
                    })
                })
                .collect();
            body["tools"] = Value::Array(tools);
        }

        body
    }
}

#[async_trait::async_trait]
impl ProviderAdapter for OpenAiAdapter {
    fn id(&self) -> &str {
        &self.config.id
    }

    fn capabilities(&self) -> &ProviderCapabilities {
        &self.capabilities
    }

    async fn spawn(&self, _config: Option<&ProviderConfig>) -> Result<AgentSession, ProviderError> {
        self.require_key()?;
        Ok(AgentSession {
            session_id: uuid::Uuid::new_v4().to_string(),
            provider_id: self.config.id.clone(),
            model: self.config.default_model.clone(),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        })
    }

    async fn query(
        &self,
        session: &AgentSession,
        params: QueryParams,
    ) -> Result<Vec<AgentEvent>, ProviderError> {
        let api_key = self.require_key()?;
        let url = format!("{}/v1/chat/completions", self.base_url());
        let body = self.build_request_body(session, &params);

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Transport {
                message: e.to_string(),
                retryable: e.is_timeout() || e.is_connect(),
            })?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Provider {
                code: format!("http_{status}"),
                message: body_text,
                retryable: status == 429 || status >= 500,
            });
        }

        let msg: Value = resp.json().await.map_err(|e| ProviderError::Transport {
            message: format!("failed to parse response: {e}"),
            retryable: false,
        })?;

        Ok(crate::normalization::openai::completion_to_agent_events(
            &msg,
        ))
    }

    fn stream(
        &self,
        session: AgentSession,
        params: QueryParams,
    ) -> Pin<Box<dyn Stream<Item = Result<AgentEvent, ProviderError>> + Send + 'static>> {
        let api_key = match self.require_key() {
            Ok(k) => k.to_string(),
            Err(e) => return Box::pin(futures_util::stream::once(async { Err(e) })),
        };

        let url = format!("{}/v1/chat/completions", self.base_url());
        let mut body = self.build_request_body(&session, &params);
        body["stream"] = json!(true);
        body["stream_options"] = json!({ "include_usage": true });

        let client = self.client.clone();
        let cancel = CancellationToken::new();
        self.inflight
            .insert(session.session_id.clone(), cancel.clone());
        let inflight_ref = self.inflight.clone();
        let session_id_owned = session.session_id.clone();

        Box::pin(async_stream::stream! {
            let send_fut = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("content-type", "application/json")
                .json(&body)
                .send();

            let resp = tokio::select! {
                r = send_fut => r,
                _ = cancel.cancelled() => {
                    inflight_ref.remove(&session_id_owned);
                    return;
                }
            };

            let resp = match resp {
                Ok(r) => r,
                Err(e) => {
                    inflight_ref.remove(&session_id_owned);
                    yield Err(ProviderError::Transport {
                        message: e.to_string(),
                        retryable: e.is_timeout() || e.is_connect(),
                    });
                    return;
                }
            };

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body_text: String = resp.text().await.unwrap_or_default();
                inflight_ref.remove(&session_id_owned);
                yield Err(ProviderError::Provider {
                    code: format!("http_{status}"),
                    message: body_text,
                    retryable: status == 429 || status >= 500,
                });
                return;
            }

            let mut normalizer = OpenAiStreamNormalizer::new();
            let mut byte_stream = resp.bytes_stream();
            let mut buf = String::new();

            loop {
                use futures_util::StreamExt;
                let chunk = tokio::select! {
                    c = byte_stream.next() => c,
                    _ = cancel.cancelled() => {
                        inflight_ref.remove(&session_id_owned);
                        return;
                    }
                };

                match chunk {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));

                        while let Some(line_end) = buf.find('\n') {
                            let line = buf[..line_end].trim_end_matches('\r').to_string();
                            buf = buf[line_end + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                if data == "[DONE]" {
                                    inflight_ref.remove(&session_id_owned);
                                    return;
                                }
                                if let Ok(chunk_val) = serde_json::from_str::<Value>(data) {
                                    for agent_event in normalizer.push(&chunk_val) {
                                        yield Ok(agent_event);
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(e)) => {
                        inflight_ref.remove(&session_id_owned);
                        yield Err(ProviderError::Transport {
                            message: e.to_string(),
                            retryable: true,
                        });
                        return;
                    }
                    None => {
                        inflight_ref.remove(&session_id_owned);
                        return;
                    }
                }
            }
        })
    }

    async fn abort(&self, session: &AgentSession) -> Result<(), ProviderError> {
        if let Some((_, token)) = self.inflight.remove(&session.session_id) {
            token.cancel();
        }
        Ok(())
    }
}
