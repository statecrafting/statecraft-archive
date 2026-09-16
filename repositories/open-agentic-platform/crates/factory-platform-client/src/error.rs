// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md — §5 / §6

//! Typed errors for the platform client. Used by both the REST surface
//! (T042) and the materialiser (T043). Mapped one-to-one to the desktop's
//! `FactoryError` in Phase 5; surfacing each failure mode separately is
//! what lets the UI render an actionable message instead of a generic
//! "request failed".

use thiserror::Error;

#[derive(Debug, Error)]
pub enum FactoryClientError {
    /// The OIDC token provider produced no token. The desktop UX path
    /// when this fires is "log in again" — different from a 401, which
    /// means the token was sent but rejected.
    #[error("missing OIDC access token (provider returned None)")]
    MissingToken,

    /// Token provider error path — e.g. the keychain refused to unlock.
    #[error("oidc token provider failed: {0}")]
    TokenProvider(String),

    /// Transport-level error (DNS, timeout, TLS). The retry helper for
    /// idempotent GETs treats this as transient.
    #[error("network error: {0}")]
    Network(String),

    /// HTTP status indicates the server understood and rejected — surfaced
    /// to the UI verbatim.
    #[error("http {status}: {body}")]
    Http { status: u16, body: String },

    /// 404 from the server. Distinct from the generic Http arm so the
    /// caller can map it to a `not_found` UX without parsing the message.
    #[error("not found: {0}")]
    NotFound(String),

    /// 412 (failedPrecondition) from the server — the spec 124 reservation
    /// path uses this when a project's binding points at a retired catalog
    /// row. The desktop deep-links the user to the project's binding page.
    #[error("retired agent: {0}")]
    RetiredAgent(String),

    /// JSON decode failure on the response body.
    #[error("decode error: {0}")]
    Decode(String),

    /// I/O while writing into the per-run cache directory.
    #[error("cache I/O error: {0}")]
    CacheIo(String),

    /// The server-side reservation's `source_shas.agents[]` disagreed with
    /// the desktop-side agent_resolver's output. Aborts materialisation
    /// rather than producing a half-built cache (spec 124 §6.1 / T043).
    #[error("agent triple drift: {0}")]
    AgentDrift(String),

    /// The agent_resolver returned an error that is not retired (e.g. the
    /// catalog disagrees with the process's pinned version). Surfaced
    /// verbatim so the UI can show a targeted message.
    #[error("resolver error: {0}")]
    Resolver(String),

    /// A platform-supplied name destined for a cache path component (adapter
    /// name, agent role, contract name) failed validation: empty, or
    /// contains a path separator or `..`. Rejected before any write so a
    /// malicious/misbehaving platform response can't steer a write outside
    /// the per-run cache directory.
    #[error("invalid path component ({field}): {value:?}")]
    InvalidPathComponent { field: &'static str, value: String },
}

impl From<serde_json::Error> for FactoryClientError {
    fn from(e: serde_json::Error) -> Self {
        FactoryClientError::Decode(e.to_string())
    }
}

impl From<std::io::Error> for FactoryClientError {
    fn from(e: std::io::Error) -> Self {
        FactoryClientError::CacheIo(e.to_string())
    }
}
