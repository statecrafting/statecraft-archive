// SPDX-License-Identifier: AGPL-3.0-or-later
//! Multi-provider LLM registry with governed dispatch (spec 042).
//!
//! Provides a `ProviderAdapter` trait and `ProviderRegistry` that normalise
//! multiple LLM backends behind a common `AgentEvent` stream.

pub mod error;
pub mod registry;
pub mod types;

pub mod adapters;
pub mod governed;
pub mod normalization;

pub use error::ProviderError;
pub use governed::GovernedProviderRegistry;
pub use registry::ProviderRegistry;
pub use types::*;

use futures_core::Stream;
use std::pin::Pin;

/// The trait every LLM backend must implement.
#[async_trait::async_trait]
pub trait ProviderAdapter: Send + Sync {
    /// Unique identifier for this provider (e.g., "anthropic", "openai").
    fn id(&self) -> &str;

    /// Capabilities this provider advertises.
    fn capabilities(&self) -> &ProviderCapabilities;

    /// Create a new agent session.
    async fn spawn(&self, config: Option<&ProviderConfig>) -> Result<AgentSession, ProviderError>;

    /// Single-turn request/response.
    async fn query(
        &self,
        session: &AgentSession,
        params: QueryParams,
    ) -> Result<Vec<AgentEvent>, ProviderError>;

    /// Streaming response. Returns an owned stream the caller can drop to cancel.
    fn stream(
        &self,
        session: AgentSession,
        params: QueryParams,
    ) -> Pin<Box<dyn Stream<Item = Result<AgentEvent, ProviderError>> + Send + 'static>>;

    /// Cancel an in-flight operation.
    async fn abort(&self, session: &AgentSession) -> Result<(), ProviderError>;
}
