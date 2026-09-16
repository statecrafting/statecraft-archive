//! Seam A — background HTTP refresh of policy bundles from the platform.

use open_agentic_policy_kernel::{PolicyBundle, PolicyRule};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use super::oidc_client::AuthProvider;
use super::policy_bundle::PolicyBundleCache;

const REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// Spawn a background task that periodically fetches the policy bundle from the platform
/// and updates the shared `PolicyBundleCache`. Falls back to stale cache on failure.
pub fn spawn_policy_refresh(
    cache: Arc<PolicyBundleCache>,
    base_url: String,
    auth: AuthProvider,
    repo_root: String,
) {
    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("failed to build reqwest client for policy refresh");

        loop {
            tokio::time::sleep(REFRESH_INTERVAL).await;

            let url = format!("{}/{}", base_url.trim_end_matches('/'), &repo_root);
            match fetch_bundle(&client, &url, &auth).await {
                Ok(bundle) => {
                    cache.update_bundle(&repo_root, bundle);
                }
                Err(e) => {
                    eprintln!("[policy_http] refresh failed for {url}: {e}");
                }
            }
        }
    });
}

async fn fetch_bundle(
    client: &reqwest::Client,
    url: &str,
    auth: &AuthProvider,
) -> Result<PolicyBundle, String> {
    let token = auth
        .get_bearer_token("platform:policy:read")
        .await
        .map_err(|e| format!("failed to get bearer token: {e}"))?;

    let resp = client
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse failed: {e}"))?;

    let constitution: Vec<PolicyRule> = serde_json::from_value(
        v.get("constitution")
            .ok_or("missing 'constitution' key")?
            .clone(),
    )
    .map_err(|e| format!("constitution parse: {e}"))?;

    let shards: BTreeMap<String, Vec<PolicyRule>> =
        serde_json::from_value(v.get("shards").ok_or("missing 'shards' key")?.clone())
            .map_err(|e| format!("shards parse: {e}"))?;

    Ok(PolicyBundle {
        constitution,
        shards,
    })
}
