//! Platform integration configuration — reads from environment variables.
//! All values are optional; when absent, axiomregent operates in local-only mode.

/// Configuration for connecting axiomregent to the platform control plane.
#[derive(Debug, Clone)]
pub struct PlatformConfig {
    /// Seam B: URL for posting audit records (e.g., `http://localhost:4000/api/audit-records`).
    pub audit_url: Option<String>,
    /// Seam A: URL for fetching policy bundles (e.g., `http://localhost:4000/api/policy-bundle`).
    pub policy_url: Option<String>,
    /// Seams C, D: Base URL for platform API (e.g., `http://localhost:4000/api`).
    pub api_url: Option<String>,
    /// Bearer token for all platform calls (M2M auth). Used when OIDC is not configured.
    pub m2m_token: Option<String>,
    /// OIDC issuer/base URL (e.g., `https://rauthy.localdev.online/auth/v1`). PLATFORM_OIDC_ENDPOINT.
    pub oidc_endpoint: Option<String>,
    /// OIDC client ID for M2M client_credentials flow. PLATFORM_OIDC_CLIENT_ID.
    pub oidc_client_id: Option<String>,
    /// OIDC client secret for M2M client_credentials flow. PLATFORM_OIDC_CLIENT_SECRET.
    pub oidc_client_secret: Option<String>,
}

impl PlatformConfig {
    /// Load from environment variables. Missing vars yield `None` (local-only mode).
    pub fn from_env() -> Self {
        Self {
            audit_url: non_empty_env("PLATFORM_AUDIT_URL"),
            policy_url: non_empty_env("PLATFORM_POLICY_URL"),
            api_url: non_empty_env("PLATFORM_API_URL"),
            m2m_token: non_empty_env("PLATFORM_M2M_TOKEN"),
            oidc_endpoint: non_empty_env("PLATFORM_OIDC_ENDPOINT"),
            oidc_client_id: non_empty_env("PLATFORM_OIDC_CLIENT_ID"),
            oidc_client_secret: non_empty_env("PLATFORM_OIDC_CLIENT_SECRET"),
        }
    }

    /// Returns `true` when at least one platform URL is configured.
    pub fn is_connected(&self) -> bool {
        self.audit_url.is_some() || self.policy_url.is_some() || self.api_url.is_some()
    }

    /// Returns `true` when all three OIDC fields are set, enabling OIDC M2M auth.
    pub fn oidc_configured(&self) -> bool {
        self.oidc_endpoint.is_some()
            && self.oidc_client_id.is_some()
            && self.oidc_client_secret.is_some()
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}
