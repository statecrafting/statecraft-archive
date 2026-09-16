// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md
//   - §5 platform fetch replaces resolve_factory_root
//   - §6 reservation flow
//   - T040..T042 platform client surface
//   - T041 also implements spec 123 `CatalogClient` so a single client
//     instance feeds both the run pipeline and the agent resolver

//! `PlatformClient` — typed REST + OIDC plumbing for `/api/factory/*`.
//!
//! The client is stateless beyond the OIDC token provider: each request
//! pulls a fresh token from the provider before sending. The provider
//! is responsible for refresh; the client never tries to interpret a
//! 401 as "refresh and retry" because the desktop's token broker is the
//! single source of refresh policy.

use async_trait::async_trait;
use std::sync::Arc;
use std::time::Duration;

use factory_engine::agent_resolver::{
    CatalogClient, CatalogClientError, CatalogRow,
};

use crate::error::FactoryClientError;
use crate::wire::{
    AdapterBody, AdapterSummary, ContractBody, ListAdaptersResponse, ListProcessesResponse,
    ListRunsQuery, ListRunsResponse, ProcessBody, ProcessSummary, ReserveRunRequest,
    RunReservation, RunRow, RunSummaryRow,
};

// ---------------------------------------------------------------------------
// OIDC token provider
// ---------------------------------------------------------------------------

/// Abstracts the desktop's OIDC token broker so the client doesn't depend
/// on a specific keychain / refresh implementation. Phase 5 plugs the
/// concrete `StatecraftClient::auth_token()` plumbing in.
///
/// The provider is invoked on every request — the implementation owns the
/// refresh window and decides when to mint a new token. A `Ok(None)`
/// signals "no token available" (UX: prompt the user to log in).
#[async_trait]
pub trait OidcTokenProvider: Send + Sync {
    async fn fetch_token(&self) -> Result<Option<String>, FactoryClientError>;
}

/// Static-token provider for tests + CLI smokes. Always returns the same
/// string. Real desktop code uses a refresh-aware provider.
pub struct StaticTokenProvider(pub String);

#[async_trait]
impl OidcTokenProvider for StaticTokenProvider {
    async fn fetch_token(&self) -> Result<Option<String>, FactoryClientError> {
        Ok(Some(self.0.clone()))
    }
}

// ---------------------------------------------------------------------------
// PlatformClient
// ---------------------------------------------------------------------------

/// Default per-request timeout. Kept short so a flaky network does not
/// make the desktop UI feel stuck; tune via `PlatformClient::with_timeout`.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);

/// Idempotent-GET retry budget. Three attempts (initial + 2 retries) —
/// any more and the user perceives a hang.
const GET_RETRY_ATTEMPTS: u32 = 3;

/// Backoff between GET retries. Linear, short — small enough that a
/// flapping network recovers within a single user gesture.
const GET_RETRY_BACKOFF: Duration = Duration::from_millis(250);

/// Thin clone of the underlying `reqwest::Client` (which is itself a
/// reference-counted handle — `Clone` is cheap).
pub struct PlatformClient {
    base_url: String,
    http: reqwest::Client,
    token_provider: Arc<dyn OidcTokenProvider>,
}

impl Clone for PlatformClient {
    fn clone(&self) -> Self {
        Self {
            base_url: self.base_url.clone(),
            http: self.http.clone(),
            token_provider: Arc::clone(&self.token_provider),
        }
    }
}

impl std::fmt::Debug for PlatformClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlatformClient")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl PlatformClient {
    /// Construct a client. `base_url` MUST not have a trailing slash — the
    /// path-builder helpers below append `/api/...` directly. The provider
    /// is reference-counted so the client can be `clone()`d cheaply for
    /// passing as both a run-pipeline driver and a `CatalogClient` to the
    /// agent resolver.
    pub fn new(
        base_url: impl Into<String>,
        token_provider: Arc<dyn OidcTokenProvider>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(DEFAULT_TIMEOUT)
            .build()
            .expect("reqwest client construction must succeed");
        let base = base_url.into();
        let base = base.trim_end_matches('/').to_string();
        Self {
            base_url: base,
            http,
            token_provider,
        }
    }

    /// Test seam: build a client with a custom `reqwest::Client` (for
    /// wiremock tests that pin a specific timeout / connector).
    pub fn with_http_client(
        base_url: impl Into<String>,
        token_provider: Arc<dyn OidcTokenProvider>,
        http: reqwest::Client,
    ) -> Self {
        let base = base_url.into();
        let base = base.trim_end_matches('/').to_string();
        Self {
            base_url: base,
            http,
            token_provider,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn url(&self, path: &str) -> String {
        debug_assert!(path.starts_with('/'), "client URL path must start with /");
        format!("{}{}", self.base_url, path)
    }

    async fn token(&self) -> Result<String, FactoryClientError> {
        match self.token_provider.fetch_token().await? {
            Some(t) if !t.is_empty() => Ok(t),
            _ => Err(FactoryClientError::MissingToken),
        }
    }

    // -----------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------

    /// Perform an idempotent GET with bounded retries on transient
    /// failures (network errors and 5xx). 4xx responses are returned
    /// immediately — the server is making a decision, not flapping.
    async fn get_with_retry<T>(&self, path: &str) -> Result<T, FactoryClientError>
    where
        T: serde::de::DeserializeOwned,
    {
        let mut last_err: Option<FactoryClientError> = None;
        for attempt in 0..GET_RETRY_ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(GET_RETRY_BACKOFF).await;
            }
            match self.send_get::<T>(path).await {
                Ok(v) => return Ok(v),
                Err(e) => {
                    if !is_transient(&e) {
                        return Err(e);
                    }
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap_or_else(|| FactoryClientError::Network(
            "GET retries exhausted".into(),
        )))
    }

    async fn send_get<T>(&self, path: &str) -> Result<T, FactoryClientError>
    where
        T: serde::de::DeserializeOwned,
    {
        let token = self.token().await?;
        let resp = self
            .http
            .get(self.url(path))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| FactoryClientError::Network(e.to_string()))?;
        decode::<T>(resp).await
    }

    /// POST without retry — even idempotent server-side semantics
    /// (the spec 124 reservation IS idempotent on `client_run_id`) mean
    /// the desktop should observe a conflict and decide explicitly,
    /// rather than blindly re-fire.
    async fn send_post<B, T>(&self, path: &str, body: &B) -> Result<T, FactoryClientError>
    where
        B: serde::Serialize,
        T: serde::de::DeserializeOwned,
    {
        let token = self.token().await?;
        let resp = self
            .http
            .post(self.url(path))
            .bearer_auth(&token)
            .json(body)
            .send()
            .await
            .map_err(|e| FactoryClientError::Network(e.to_string()))?;
        decode::<T>(resp).await
    }

    // -----------------------------------------------------------------
    // /api/factory/* — typed REST surface (T042)
    // -----------------------------------------------------------------

    pub async fn get_adapter(
        &self,
        name: &str,
    ) -> Result<AdapterBody, FactoryClientError> {
        let path = format!("/api/factory/adapters/{}", url_segment(name));
        self.get_with_retry::<AdapterBody>(&path).await
    }

    /// List the org's factory adapters (name + version, no manifest).
    ///
    /// Backs the desktop's adapter picker: the selectable adapters are
    /// whatever the platform reports for the org, never a name compiled
    /// into the client. Idempotent, so it uses the GET-retry helper.
    pub async fn list_adapters(&self) -> Result<Vec<AdapterSummary>, FactoryClientError> {
        self.get_with_retry::<ListAdaptersResponse>("/api/factory/adapters")
            .await
            .map(|r| r.adapters)
    }

    pub async fn get_contract(
        &self,
        name: &str,
    ) -> Result<ContractBody, FactoryClientError> {
        let path = format!("/api/factory/contracts/{}", url_segment(name));
        self.get_with_retry::<ContractBody>(&path).await
    }

    pub async fn get_process(
        &self,
        name: &str,
    ) -> Result<ProcessBody, FactoryClientError> {
        let path = format!("/api/factory/processes/{}", url_segment(name));
        self.get_with_retry::<ProcessBody>(&path).await
    }

    /// List the org's factory processes (name + version, no definition).
    ///
    /// Backs the "resolve the default process by the platform's current
    /// name" path: when an OPC caller starts a run without specifying a
    /// process, the desktop lists processes here and uses what the
    /// platform reports rather than a name compiled into the client. The
    /// endpoint is idempotent, so it uses the GET-retry helper.
    pub async fn list_processes(&self) -> Result<Vec<ProcessSummary>, FactoryClientError> {
        self.get_with_retry::<ListProcessesResponse>("/api/factory/processes")
            .await
            .map(|r| r.processes)
    }

    pub async fn reserve_run(
        &self,
        req: ReserveRunRequest,
    ) -> Result<RunReservation, FactoryClientError> {
        // POST /api/factory/runs — see api/factory/runs.ts. No retry; a
        // 412 (retired agent) is final, and a 5xx is the user's call.
        self.send_post::<_, RunReservation>("/api/factory/runs", &req)
            .await
    }

    pub async fn get_run(&self, id: &str) -> Result<RunRow, FactoryClientError> {
        let path = format!("/api/factory/runs/{}", url_segment(id));
        self.get_with_retry::<RunRow>(&path).await
    }

    /// List recent runs for the caller's org. The query is encoded as
    /// snake_case parameters per the Encore.ts request shape (`status`,
    /// `adapter`, `limit`, `before`). Uses the GET-retry helper because
    /// the endpoint is idempotent.
    pub async fn list_runs_with(
        &self,
        query: ListRunsQuery,
    ) -> Result<ListRunsResponse, FactoryClientError> {
        let mut path = String::from("/api/factory/runs");
        let mut sep = '?';
        let mut push = |k: &str, v: &str| {
            path.push(sep);
            path.push_str(k);
            path.push('=');
            path.push_str(&url_segment(v));
            sep = '&';
        };
        if let Some(s) = query.status.as_deref() {
            push("status", s);
        }
        if let Some(s) = query.adapter.as_deref() {
            push("adapter", s);
        }
        if let Some(n) = query.limit {
            push("limit", &n.to_string());
        }
        if let Some(s) = query.before.as_deref() {
            push("before", s);
        }
        self.get_with_retry::<ListRunsResponse>(&path).await
    }

    /// Convenience: list with default pagination (no filters).
    pub async fn list_runs(&self) -> Result<Vec<RunSummaryRow>, FactoryClientError> {
        self.list_runs_with(ListRunsQuery::default())
            .await
            .map(|r| r.runs)
    }
}

// ---------------------------------------------------------------------------
// CatalogClient impl — feeds spec 123's `AgentResolver`
// ---------------------------------------------------------------------------

/// Statecraft's org-scoped catalog endpoints (spec 123 §8.2):
///
///   GET /api/orgs/:orgId/agents
///   GET /api/orgs/:orgId/agents/:id
///
/// `PlatformClient` is the desktop's concrete implementation; sharing
/// the auth + retry policy with the Factory pipeline path means a
/// single login produces a single set of refreshes for both.
#[async_trait]
impl CatalogClient for PlatformClient {
    async fn list_agents(
        &self,
        org_id: &str,
    ) -> Result<Vec<CatalogRow>, CatalogClientError> {
        let path = format!("/api/orgs/{}/agents", url_segment(org_id));
        self.get_with_retry::<CatalogListResponse>(&path)
            .await
            .map(|r| r.agents)
            .map_err(catalog_err_from_factory)
    }

    async fn get_agent(
        &self,
        org_id: &str,
        org_agent_id: &str,
    ) -> Result<CatalogRow, CatalogClientError> {
        let path = format!(
            "/api/orgs/{}/agents/{}",
            url_segment(org_id),
            url_segment(org_agent_id),
        );
        self.get_with_retry::<CatalogRow>(&path)
            .await
            .map_err(catalog_err_from_factory)
    }
}

/// Helper response wrapper for the list endpoint — statecraft returns the
/// rows under a top-level `agents` key.
#[derive(Debug, serde::Deserialize)]
struct CatalogListResponse {
    agents: Vec<CatalogRow>,
}

fn catalog_err_from_factory(e: FactoryClientError) -> CatalogClientError {
    match e {
        FactoryClientError::Network(m) => CatalogClientError::Network(m),
        FactoryClientError::Http { status, body } => CatalogClientError::Server { status, body },
        FactoryClientError::NotFound(detail) => {
            CatalogClientError::NotFound { org_id: String::new(), id: detail }
        }
        FactoryClientError::Decode(m) => CatalogClientError::Decode(m),
        FactoryClientError::MissingToken => {
            CatalogClientError::Network("missing OIDC access token".into())
        }
        FactoryClientError::TokenProvider(m) => CatalogClientError::Network(m),
        FactoryClientError::RetiredAgent(m) => CatalogClientError::Server {
            status: 412,
            body: m,
        },
        FactoryClientError::Resolver(m)
        | FactoryClientError::CacheIo(m)
        | FactoryClientError::AgentDrift(m) => CatalogClientError::Network(m),
        // Not reachable via the CatalogClient REST methods above (only the
        // materialiser's write_* helpers produce this variant); bucketed
        // with the other local/non-transport errors above for exhaustiveness.
        FactoryClientError::InvalidPathComponent { field, value } => {
            CatalogClientError::Network(format!("invalid path component ({field}): {value:?}"))
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Encode a path segment so a name with `/` or whitespace doesn't break
/// the URL. The spec's catalog rows use kebab-case IDs but we belt-and-
/// braces here.
fn url_segment(s: &str) -> String {
    // `percent-encoding` would be ideal but we keep deps minimal —
    // hand-roll a path-segment encoder (RFC 3986 unreserved + a few
    // commonly-used path chars).
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char);
            }
            _ => {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
    }
    out
}

async fn decode<T>(resp: reqwest::Response) -> Result<T, FactoryClientError>
where
    T: serde::de::DeserializeOwned,
{
    let status = resp.status();
    if status.is_success() {
        return resp
            .json::<T>()
            .await
            .map_err(|e| FactoryClientError::Decode(e.to_string()));
    }
    let code = status.as_u16();
    let body = resp.text().await.unwrap_or_default();
    if code == 404 {
        return Err(FactoryClientError::NotFound(body));
    }
    if code == 412 {
        return Err(FactoryClientError::RetiredAgent(body));
    }
    Err(FactoryClientError::Http { status: code, body })
}

fn is_transient(e: &FactoryClientError) -> bool {
    match e {
        FactoryClientError::Network(_) => true,
        FactoryClientError::Http { status, .. } => *status >= 500,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_segment_passes_unreserved() {
        assert_eq!(url_segment("kebab-case-name"), "kebab-case-name");
        assert_eq!(url_segment("v1.0"), "v1.0");
    }

    #[test]
    fn url_segment_encodes_slashes_and_spaces() {
        assert_eq!(url_segment("a/b"), "a%2Fb");
        assert_eq!(url_segment("a b"), "a%20b");
    }

    #[test]
    fn is_transient_classification() {
        assert!(is_transient(&FactoryClientError::Network("x".into())));
        assert!(is_transient(&FactoryClientError::Http {
            status: 503,
            body: "".into(),
        }));
        assert!(!is_transient(&FactoryClientError::Http {
            status: 401,
            body: "".into(),
        }));
        assert!(!is_transient(&FactoryClientError::NotFound("".into())));
    }

    #[tokio::test]
    async fn missing_token_surfaces_as_typed_error() {
        struct NoToken;
        #[async_trait]
        impl OidcTokenProvider for NoToken {
            async fn fetch_token(&self) -> Result<Option<String>, FactoryClientError> {
                Ok(None)
            }
        }
        let client = PlatformClient::new("http://does-not-matter", Arc::new(NoToken));
        let err = client.get_adapter("ada").await.unwrap_err();
        assert!(matches!(err, FactoryClientError::MissingToken));
    }
}
