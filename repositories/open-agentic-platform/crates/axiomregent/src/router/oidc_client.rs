//! OIDC M2M client for machine-to-machine authentication with the platform control plane.
//!
//! Supports the client_credentials grant flow with token caching and automatic refresh.

use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::Instant;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum OidcError {
    HttpError(String),
    TokenError(String),
    DiscoveryError(String),
}

impl std::fmt::Display for OidcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OidcError::HttpError(m) => write!(f, "OIDC HTTP error: {m}"),
            OidcError::TokenError(m) => write!(f, "OIDC token error: {m}"),
            OidcError::DiscoveryError(m) => write!(f, "OIDC discovery error: {m}"),
        }
    }
}

impl std::error::Error for OidcError {}

// ---------------------------------------------------------------------------
// Cached token
// ---------------------------------------------------------------------------

struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

// ---------------------------------------------------------------------------
// OIDC M2M client
// ---------------------------------------------------------------------------

pub struct OidcM2mClient {
    client: reqwest::Client,
    token_endpoint: String,
    client_id: String,
    client_secret: String,
    cache: Mutex<Option<CachedToken>>,
}

#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    #[allow(dead_code)]
    token_type: String,
}

impl OidcM2mClient {
    /// Create a new client by discovering the token endpoint from the OIDC well-known configuration.
    pub async fn new(
        oidc_endpoint: &str,
        client_id: String,
        client_secret: String,
    ) -> Result<Self, OidcError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| OidcError::DiscoveryError(format!("failed to build HTTP client: {e}")))?;

        let discovery_url = format!(
            "{}/.well-known/openid-configuration",
            oidc_endpoint.trim_end_matches('/')
        );

        let resp = client
            .get(&discovery_url)
            .send()
            .await
            .map_err(|e| OidcError::DiscoveryError(format!("discovery request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(OidcError::DiscoveryError(format!(
                "discovery endpoint returned {}",
                resp.status()
            )));
        }

        let config: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| OidcError::DiscoveryError(format!("discovery JSON parse failed: {e}")))?;

        let token_endpoint = config
            .get("token_endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| OidcError::DiscoveryError("missing token_endpoint in discovery".into()))?
            .to_string();

        Ok(Self {
            client,
            token_endpoint,
            client_id,
            client_secret,
            cache: Mutex::new(None),
        })
    }

    /// Return a valid bearer token, using cache if still valid (with 30s safety margin).
    pub async fn get_bearer_token(&self, scope: &str) -> Result<String, OidcError> {
        let safety_margin = std::time::Duration::from_secs(30);

        {
            let cache = self.cache.lock().await;
            if let Some(ref cached) = *cache
                && Instant::now() + safety_margin < cached.expires_at
            {
                return Ok(cached.access_token.clone());
            }
        }

        // Cache miss or near expiry — fetch new token.
        let token = self.fetch_token(scope).await?;

        {
            let mut cache = self.cache.lock().await;
            let expires_at = Instant::now() + std::time::Duration::from_secs(token.expires_in);
            *cache = Some(CachedToken {
                access_token: token.access_token.clone(),
                expires_at,
            });
        }

        Ok(token.access_token)
    }

    async fn fetch_token(&self, scope: &str) -> Result<TokenResponse, OidcError> {
        let params = [
            ("grant_type", "client_credentials"),
            ("client_id", &self.client_id),
            ("client_secret", &self.client_secret),
            ("scope", scope),
        ];

        let resp = self
            .client
            .post(&self.token_endpoint)
            .form(&params)
            .send()
            .await
            .map_err(|e| OidcError::HttpError(format!("token request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(OidcError::TokenError(format!(
                "token endpoint returned {status}: {body}"
            )));
        }

        resp.json::<TokenResponse>()
            .await
            .map_err(|e| OidcError::TokenError(format!("token response parse failed: {e}")))
    }
}

// ---------------------------------------------------------------------------
// AuthProvider — unified abstraction over OIDC and static token auth
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub enum AuthProvider {
    Oidc(Arc<OidcM2mClient>),
    Static(String),
}

impl AuthProvider {
    pub async fn get_bearer_token(&self, scope: &str) -> Result<String, String> {
        match self {
            AuthProvider::Oidc(client) => client
                .get_bearer_token(scope)
                .await
                .map_err(|e| e.to_string()),
            AuthProvider::Static(token) => Ok(token.clone()),
        }
    }
}
