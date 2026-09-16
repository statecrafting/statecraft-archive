// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::ProviderAdapter;
use crate::error::ProviderError;
use crate::types::ProviderCapabilities;

/// Thread-safe registry of provider adapters.
#[derive(Clone)]
pub struct ProviderRegistry {
    adapters: Arc<RwLock<HashMap<String, Arc<dyn ProviderAdapter>>>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            adapters: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a provider adapter. Fails if an adapter with the same id exists.
    pub async fn register(&self, adapter: Arc<dyn ProviderAdapter>) -> Result<(), ProviderError> {
        let id = adapter.id().to_string();
        let mut map = self.adapters.write().await;
        if map.contains_key(&id) {
            return Err(ProviderError::AlreadyRegistered { id });
        }
        map.insert(id, adapter);
        Ok(())
    }

    /// Retrieve a provider adapter by id.
    pub async fn get(&self, id: &str) -> Result<Arc<dyn ProviderAdapter>, ProviderError> {
        let map = self.adapters.read().await;
        map.get(id)
            .cloned()
            .ok_or_else(|| ProviderError::NotFound { id: id.to_string() })
    }

    /// Check if a provider is registered.
    pub async fn has(&self, id: &str) -> bool {
        let map = self.adapters.read().await;
        map.contains_key(id)
    }

    /// List all registered providers with their capabilities.
    pub async fn list(&self) -> Vec<(String, ProviderCapabilities)> {
        let map = self.adapters.read().await;
        map.iter()
            .map(|(id, adapter)| (id.clone(), adapter.capabilities().clone()))
            .collect()
    }

    /// Remove a provider adapter. Returns true if it was present.
    pub async fn unregister(&self, id: &str) -> bool {
        let mut map = self.adapters.write().await;
        map.remove(id).is_some()
    }
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use futures_core::Stream;
    use std::pin::Pin;

    /// Minimal test adapter.
    struct StubAdapter {
        adapter_id: String,
        caps: ProviderCapabilities,
    }

    impl StubAdapter {
        fn new(id: &str) -> Self {
            Self {
                adapter_id: id.to_string(),
                caps: ProviderCapabilities {
                    streaming: true,
                    tool_use: false,
                    vision: false,
                    extended_thinking: false,
                    max_context_tokens: 4096,
                },
            }
        }
    }

    #[async_trait::async_trait]
    impl ProviderAdapter for StubAdapter {
        fn id(&self) -> &str {
            &self.adapter_id
        }

        fn capabilities(&self) -> &ProviderCapabilities {
            &self.caps
        }

        async fn spawn(
            &self,
            _config: Option<&ProviderConfig>,
        ) -> Result<AgentSession, ProviderError> {
            Ok(AgentSession {
                session_id: "stub-session".into(),
                provider_id: self.adapter_id.clone(),
                model: "stub-model".into(),
                created_at: 0,
            })
        }

        async fn query(
            &self,
            _session: &AgentSession,
            _params: QueryParams,
        ) -> Result<Vec<AgentEvent>, ProviderError> {
            Ok(vec![AgentEvent::TextComplete {
                text: "stub response".into(),
            }])
        }

        fn stream(
            &self,
            _session: AgentSession,
            _params: QueryParams,
        ) -> Pin<Box<dyn Stream<Item = Result<AgentEvent, ProviderError>> + Send + 'static>>
        {
            Box::pin(futures_util::stream::empty())
        }

        async fn abort(&self, _session: &AgentSession) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn register_and_get() {
        let registry = ProviderRegistry::new();
        let adapter = Arc::new(StubAdapter::new("test-provider"));
        registry.register(adapter).await.unwrap();

        let retrieved = registry.get("test-provider").await.unwrap();
        assert_eq!(retrieved.id(), "test-provider");
    }

    #[tokio::test]
    async fn duplicate_registration_fails() {
        let registry = ProviderRegistry::new();
        let a1 = Arc::new(StubAdapter::new("dup"));
        let a2 = Arc::new(StubAdapter::new("dup"));
        registry.register(a1).await.unwrap();

        let err = registry.register(a2).await.unwrap_err();
        assert!(matches!(err, ProviderError::AlreadyRegistered { id } if id == "dup"));
    }

    #[tokio::test]
    async fn get_missing_provider_fails() {
        let registry = ProviderRegistry::new();
        let result = registry.get("nonexistent").await;
        assert!(matches!(
            result,
            Err(ProviderError::NotFound { ref id }) if id == "nonexistent"
        ));
    }

    #[tokio::test]
    async fn list_returns_all_providers() {
        let registry = ProviderRegistry::new();
        registry
            .register(Arc::new(StubAdapter::new("alpha")))
            .await
            .unwrap();
        registry
            .register(Arc::new(StubAdapter::new("beta")))
            .await
            .unwrap();

        let list = registry.list().await;
        assert_eq!(list.len(), 2);

        let ids: Vec<&str> = list.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"alpha"));
        assert!(ids.contains(&"beta"));
    }

    #[tokio::test]
    async fn has_and_unregister() {
        let registry = ProviderRegistry::new();
        registry
            .register(Arc::new(StubAdapter::new("removable")))
            .await
            .unwrap();
        assert!(registry.has("removable").await);

        assert!(registry.unregister("removable").await);
        assert!(!registry.has("removable").await);

        // Unregistering again returns false
        assert!(!registry.unregister("removable").await);
    }
}
