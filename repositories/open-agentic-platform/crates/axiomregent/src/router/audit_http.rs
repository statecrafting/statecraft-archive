//! Seam B — fire-and-forget HTTP forwarding of audit records to the platform.

use super::oidc_client::AuthProvider;
use serde_json::Value;

/// Forwards audit payloads to the platform's `POST /api/audit-records` endpoint.
/// Failures are logged to stderr but never block MCP dispatch.
pub struct AuditForwarder {
    client: reqwest::Client,
    url: String,
    auth: AuthProvider,
}

impl AuditForwarder {
    pub fn new(url: String, auth: AuthProvider) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("failed to build reqwest client");
        Self { client, url, auth }
    }

    /// Spawn a fire-and-forget POST. Does not block the caller.
    pub fn forward(&self, payload: Value) {
        let client = self.client.clone();
        let url = self.url.clone();
        let auth = self.auth.clone();
        tokio::spawn(async move {
            let token = match auth.get_bearer_token("platform:audit:write").await {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[audit_http] failed to get bearer token: {e}");
                    return;
                }
            };
            let res = client
                .post(&url)
                .bearer_auth(&token)
                .json(&payload)
                .send()
                .await;
            match res {
                Ok(resp) if !resp.status().is_success() => {
                    eprintln!(
                        "[audit_http] platform returned {} for POST {}",
                        resp.status(),
                        url
                    );
                }
                Err(e) => {
                    eprintln!("[audit_http] failed to POST {}: {}", url, e);
                }
                _ => {}
            }
        });
    }
}
