// SPDX-License-Identifier: AGPL-3.0-or-later
//! ProviderRegistryExecutor — GovernedExecutor backed by the Rust provider registry (spec 042).
//!
//! Coexists with `ClaudeCodeExecutor`. Selected when `DispatchRequest.agent_id`
//! uses the `provider_id:model` syntax (e.g., `"anthropic:claude-sonnet-4-20250514"`).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use futures_util::StreamExt;
use provider_registry::{
    AgentEvent, GovernedProviderRegistry, Message, MessageContent, ProviderError, QueryParams, Role,
};

use crate::{DispatchRequest, DispatchResult, GovernedExecutor};

/// GovernedExecutor that dispatches to API providers via the Rust ProviderRegistry.
pub struct ProviderRegistryExecutor {
    registry: Arc<GovernedProviderRegistry>,
    project_path: PathBuf,
}

impl ProviderRegistryExecutor {
    pub fn new(registry: Arc<GovernedProviderRegistry>, project_path: PathBuf) -> Self {
        Self {
            registry,
            project_path,
        }
    }
}

/// Parse `"provider_id:model_name"` from an agent_id string.
/// Returns `(provider_id, model)`. If no `:` is present, returns `None`.
pub fn parse_provider_model(agent_id: &str) -> Option<(&str, &str)> {
    let colon = agent_id.find(':')?;
    if colon == 0 || colon == agent_id.len() - 1 {
        return None;
    }
    Some((&agent_id[..colon], &agent_id[colon + 1..]))
}

#[async_trait]
impl GovernedExecutor for ProviderRegistryExecutor {
    async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
        let start = Instant::now();

        let (provider_id, model) = parse_provider_model(&request.agent_id).ok_or_else(|| {
            format!(
                "ProviderRegistryExecutor requires 'provider:model' syntax, got '{}'",
                request.agent_id
            )
        })?;

        // Read input artifacts as context
        let mut context = String::new();
        for path in &request.input_artifacts {
            let full_path = if path.is_absolute() {
                path.clone()
            } else {
                self.project_path.join(path)
            };
            match tokio::fs::read_to_string(&full_path).await {
                Ok(content) => {
                    context.push_str(&format!("--- {} ---\n{}\n\n", path.display(), content));
                }
                Err(e) => {
                    context.push_str(&format!(
                        "--- {} (read error: {}) ---\n\n",
                        path.display(),
                        e
                    ));
                }
            }
        }

        // Build the query
        let user_message = if context.is_empty() {
            request.system_prompt.clone()
        } else {
            format!("{}\n\n---\n\nContext:\n{}", request.system_prompt, context)
        };

        let params = QueryParams {
            model: Some(model.to_string()),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text(user_message),
            }],
            system_prompt: None,
            tools: vec![],
            max_tokens: Some(4096),
            temperature: None,
        };

        // Spawn session
        let adapter = self
            .registry
            .registry()
            .get(provider_id)
            .await
            .map_err(|e| format!("provider lookup failed: {e}"))?;

        let session = adapter
            .spawn(None)
            .await
            .map_err(|e| format!("session spawn failed: {e}"))?;

        // Stream the response and collect results
        let stream = self
            .registry
            .governed_stream(provider_id, session, params)
            .map_err(|e| format!("governance check failed: {e}"))?;

        let mut stream = std::pin::pin!(stream);
        let mut full_text = String::new();
        let mut tokens_used: Option<u64> = None;
        let mut cost_usd: Option<f64> = None;

        while let Some(event_result) = stream.next().await {
            match event_result {
                Ok(event) => match &event {
                    AgentEvent::TextDelta { delta } => full_text.push_str(delta),
                    AgentEvent::TextComplete { text } => full_text.push_str(text),
                    AgentEvent::MessageComplete { usage, .. } => {
                        let total = usage.input_tokens + usage.output_tokens;
                        tokens_used = Some(total);
                        // Rough cost estimate (Sonnet-class pricing as default)
                        cost_usd = Some(
                            (usage.input_tokens as f64 * 3.0 / 1_000_000.0)
                                + (usage.output_tokens as f64 * 15.0 / 1_000_000.0),
                        );
                    }
                    AgentEvent::Error {
                        code,
                        message,
                        retryable,
                    } if !retryable => {
                        return Err(format!("provider error [{code}]: {message}"));
                    }
                    _ => {}
                },
                Err(ProviderError::GovernanceDenied { reason }) => {
                    return Err(format!("governance denied: {reason}"));
                }
                Err(e) => {
                    return Err(format!("provider stream error: {e}"));
                }
            }
        }

        let duration_ms = start.elapsed().as_millis() as u64;

        // Write output to first output artifact if specified
        if let Some(output_path) = request.output_artifacts.first() {
            let full_path = if output_path.is_absolute() {
                output_path.clone()
            } else {
                self.project_path.join(output_path)
            };
            if let Some(parent) = full_path.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            tokio::fs::write(&full_path, &full_text)
                .await
                .map_err(|e| format!("failed to write output artifact: {e}"))?;
        }

        Ok(DispatchResult {
            tokens_used,
            output_hashes: std::collections::HashMap::new(),
            session_id: None,
            cost_usd,
            duration_ms: Some(duration_ms),
            num_turns: Some(1),
            governance_mode: Some("governed".into()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_provider_model_valid() {
        let (p, m) = parse_provider_model("anthropic:claude-sonnet-4-20250514").unwrap();
        assert_eq!(p, "anthropic");
        assert_eq!(m, "claude-sonnet-4-20250514");
    }

    #[test]
    fn parse_provider_model_openai() {
        let (p, m) = parse_provider_model("openai:gpt-4o").unwrap();
        assert_eq!(p, "openai");
        assert_eq!(m, "gpt-4o");
    }

    #[test]
    fn parse_provider_model_no_colon() {
        assert!(parse_provider_model("claude-sonnet-4-20250514").is_none());
    }

    #[test]
    fn parse_provider_model_empty_parts() {
        assert!(parse_provider_model(":model").is_none());
        assert!(parse_provider_model("provider:").is_none());
    }
}
