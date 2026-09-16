//! JSON-serializable I/O shapes for the napi surface. The Encore.ts fleet
//! service marshals these as plain objects (camelCase); the addon parses them
//! into these structs and returns them serialized. No native types cross the
//! boundary (statecraft spec 006 §2).

use serde::{Deserialize, Serialize};

fn default_volume() -> u32 {
    1
}
fn default_port() -> u16 {
    4000
}
fn default_issuer() -> String {
    "letsencrypt-prod-dns01-cloudflare".to_string()
}
fn default_restic_image() -> String {
    "restic/restic:0.17.3".to_string()
}

/// The desired placement for one app. `namespace` is computed by the caller
/// (`t-<tenantId>`); the addon revalidates it (DNS-1123 + reserved blocklist).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploySpec {
    pub name: String,
    pub namespace: String,
    pub image: String,
    pub host: String,
    #[serde(default = "default_volume")]
    pub volume_size_gi: u32,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_issuer")]
    pub tls_issuer: String,
    #[serde(default)]
    pub tls_secret_name: Option<String>,
    #[serde(default)]
    pub image_pull_secret: Option<String>,
}

/// The observed state of a placed app, refreshed from the live Deployment.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub name: String,
    pub namespace: String,
    /// One of: placing | running | updating | failed.
    pub status: String,
    pub host: String,
    pub image: String,
    pub available_replicas: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Restic + Hetzner Object Storage target for a backup (statecraft spec 006 §3). The
/// per-app repository is `<repository_base>/<namespace>/<app>`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTarget {
    /// e.g. `s3:https://nbg1.your-objectstorage.com/oap-fleet-backups-prod`.
    pub repository_base: String,
    /// RESTIC_PASSWORD: the client-side encryption key (the real at-rest
    /// control, since the Hetzner S3 credential is project-scoped).
    pub password: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    #[serde(default = "default_restic_image")]
    pub restic_image: String,
}

/// The recorded artifact location after a backup, written onto FleetOp.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub repository: String,
    pub tag: String,
    pub job_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
}

/// The outcome of removing an app's per-app resources.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub name: String,
    pub namespace: String,
    pub removed: bool,
}
