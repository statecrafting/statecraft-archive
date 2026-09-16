// SPDX-License-Identifier: AGPL-3.0-or-later

/// Errors produced by provider operations.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("missing API key for provider \"{provider_id}\"")]
    MissingApiKey { provider_id: String },

    #[error("provider not found: \"{id}\"")]
    NotFound { id: String },

    #[error("provider already registered: \"{id}\"")]
    AlreadyRegistered { id: String },

    #[error("transport error: {message}")]
    Transport { message: String, retryable: bool },

    #[error("governance denied: {reason}")]
    GovernanceDenied { reason: String },

    #[error("provider error [{code}]: {message}")]
    Provider {
        code: String,
        message: String,
        retryable: bool,
    },

    #[error("session not found: \"{session_id}\"")]
    SessionNotFound { session_id: String },
}
