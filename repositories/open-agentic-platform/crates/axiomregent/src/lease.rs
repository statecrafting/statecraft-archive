// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: MCP_SNAPSHOT_WORKSPACE
// Spec: spec/core/snapshot-workspace.md

use anyhow::{Result, anyhow};
use hiqlite::{Client, Param};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Fingerprint {
    pub head_oid: String,
    pub index_oid: String,
    pub status_hash: String,
}

impl Fingerprint {
    pub async fn compute(repo_root: &Path) -> Result<Self> {
        use tokio::process::Command;

        // 1. head_oid
        let head_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repo_root)
            .output()
            .await?;

        let head_oid = if head_output.status.success() {
            String::from_utf8_lossy(&head_output.stdout)
                .trim()
                .to_string()
        } else {
            return Err(anyhow!(
                "Failed to run git rev-parse HEAD. Git repository must be initialized and populated to grant a lease."
            ));
        };

        // 2. index_oid
        let write_tree_output = Command::new("git")
            .arg("write-tree")
            .current_dir(repo_root)
            .output()
            .await?;

        let index_oid = if write_tree_output.status.success() {
            String::from_utf8_lossy(&write_tree_output.stdout)
                .trim()
                .to_string()
        } else {
            return Err(anyhow!(
                "Failed to run git write-tree. Git index must be valid to grant a lease."
            ));
        };

        // 3. status_hash
        // git status --porcelain=v1 -z
        let status_output = Command::new("git")
            .args(["status", "--porcelain=v1", "-z"])
            .current_dir(repo_root)
            .output()
            .await?;

        if !status_output.status.success() {
            return Err(anyhow!("Failed to run git status"));
        }

        let status_hash = hex::encode(Sha256::digest(&status_output.stdout));

        Ok(Self {
            head_oid,
            index_oid,
            status_hash,
        })
    }

    /// Canonical JSON representation for snapshot ID derivation
    pub fn to_canonical_json(&self) -> Result<String> {
        let val = serde_json::to_value(self)?;
        // sort keys
        Ok(serde_json::to_string(&val)?)
    }
}

/// Permission grants bound to a lease (Feature 035). Serialized for `OPC_GOVERNANCE_GRANTS` env.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PermissionGrants {
    #[serde(default = "default_true")]
    pub enable_file_read: bool,
    #[serde(default = "default_true")]
    pub enable_file_write: bool,
    #[serde(default = "default_false")]
    pub enable_network: bool,
    /// `1` = Tier1, `2` = Tier2, `3` = Tier3 (see `agent::safety::ToolTier`).
    #[serde(default = "default_max_tier_three")]
    pub max_tier: u8,
}

fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}
fn default_max_tier_three() -> u8 {
    3
}

impl Default for PermissionGrants {
    fn default() -> Self {
        Self::claude_default()
    }
}

impl PermissionGrants {
    /// Permissive defaults for unit tests only.
    #[cfg(test)]
    pub fn test_permissive() -> Self {
        Self {
            enable_file_read: true,
            enable_file_write: true,
            enable_network: true,
            max_tier: 3,
        }
    }

    /// Default Claude Code session (non-agent): all capabilities, cap at Tier2.
    pub fn claude_default() -> Self {
        Self {
            enable_file_read: true,
            enable_file_write: true,
            enable_network: true,
            max_tier: 2,
        }
    }

    /// From `OPC_GOVERNANCE_GRANTS` JSON, or [`Self::claude_default`].
    pub fn from_env_or_default() -> Self {
        std::env::var("OPC_GOVERNANCE_GRANTS")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(Self::claude_default)
    }

    pub fn for_agent(
        enable_file_read: bool,
        enable_file_write: bool,
        enable_network: bool,
    ) -> Self {
        Self {
            enable_file_read,
            enable_file_write,
            enable_network,
            max_tier: 3,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Lease {
    pub id: String,
    pub fingerprint: Fingerprint,
    pub touched_files: HashSet<String>,
    pub grants: PermissionGrants,
}

#[derive(Clone)]
pub struct LeaseStore {
    client: Client,
    default_grants: PermissionGrants,
}

impl LeaseStore {
    pub fn new(client: Client) -> Self {
        Self::with_default_grants(client, PermissionGrants::claude_default())
    }

    pub fn with_default_grants(client: Client, default_grants: PermissionGrants) -> Self {
        Self {
            client,
            default_grants,
        }
    }

    pub fn default_grants(&self) -> PermissionGrants {
        self.default_grants.clone()
    }

    /// Access the underlying hiqlite client (e.g. for dlock operations).
    pub fn client(&self) -> &Client {
        &self.client
    }

    pub async fn issue(&self, fingerprint: Fingerprint) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let fp_json = fingerprint.to_canonical_json()?;
        let grants_json = serde_json::to_string(&self.default_grants)?;
        let now = chrono::Utc::now().to_rfc3339();
        let expires = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();

        self.client
            .execute(
                Cow::Borrowed(
                    "INSERT INTO leases \
                     (lease_id, repo_root, fingerprint, touched_files, grants, issued_at, expires_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7)",
                ),
                vec![
                    Param::Text(id.clone()),
                    Param::Text("".to_string()),
                    Param::Text(fp_json.clone()),
                    Param::Text("[]".to_string()),
                    Param::Text(grants_json),
                    Param::Text(now),
                    Param::Text(expires),
                ],
            )
            .await?;

        // Emit cross-session event (FR-006)
        crate::events::emit(
            &self.client,
            crate::events::EVENT_LEASE_ACQUIRED,
            serde_json::json!({
                "lease_id": &id,
                "fingerprint": &fp_json,
            }),
        )
        .await;

        Ok(id)
    }

    pub async fn get_lease(&self, lease_id: &str) -> Option<Lease> {
        #[derive(serde::Deserialize)]
        struct LeaseRow {
            lease_id: String,
            fingerprint: String,
            touched_files: String,
            grants: String,
        }

        let rows: Vec<LeaseRow> = self
            .client
            .query_as(
                "SELECT lease_id, fingerprint, touched_files, grants \
                 FROM leases WHERE lease_id = $1",
                vec![Param::Text(lease_id.to_string())],
            )
            .await
            .ok()?;

        let row = rows.into_iter().next()?;
        let fingerprint: Fingerprint = serde_json::from_str(&row.fingerprint).ok()?;
        let touched: HashSet<String> = serde_json::from_str(&row.touched_files).ok()?;
        let grants: PermissionGrants = serde_json::from_str(&row.grants).ok()?;

        Some(Lease {
            id: row.lease_id,
            fingerprint,
            touched_files: touched,
            grants,
        })
    }

    pub async fn get_fingerprint(&self, lease_id: &str) -> Option<Fingerprint> {
        self.get_lease(lease_id).await.map(|l| l.fingerprint)
    }

    /// Record that a set of files were touched under this lease.
    pub async fn touch_files(&self, lease_id: &str, files: Vec<String>) -> Result<()> {
        if let Some(mut lease) = self.get_lease(lease_id).await {
            for f in files {
                lease.touched_files.insert(f);
            }
            let touched_json = serde_json::to_string(&lease.touched_files)?;
            self.client
                .execute(
                    Cow::Borrowed("UPDATE leases SET touched_files = $1 WHERE lease_id = $2"),
                    vec![Param::Text(touched_json), Param::Text(lease_id.to_string())],
                )
                .await?;
        }
        Ok(())
    }

    pub async fn get_touched_files(&self, lease_id: &str) -> Option<Vec<String>> {
        self.get_lease(lease_id).await.map(|l| {
            let mut v: Vec<String> = l.touched_files.into_iter().collect();
            v.sort(); // Lexicographic order
            v
        })
    }

    /// Verifies lease against current repo state.
    /// Returns Ok(()) if valid.
    /// Returns Err(STALE_LEASE) if mismatch.
    pub async fn check_lease(&self, lease_id: &str, repo_root: &Path) -> Result<()> {
        let lease = self
            .get_lease(lease_id)
            .await
            .ok_or_else(|| anyhow!("Lease not found: {}", lease_id))?;

        let current_fp = Fingerprint::compute(repo_root).await?;

        if lease.fingerprint != current_fp {
            return Err(StaleLeaseError {
                lease_id: lease_id.to_string(),
                current_fingerprint: current_fp,
                msg: "Lease is stale (repo changed)".into(),
            }
            .into());
        }

        Ok(())
    }
}

#[derive(Debug)]
pub struct StaleLeaseError {
    pub lease_id: String,
    pub current_fingerprint: Fingerprint,
    pub msg: String,
}

impl std::fmt::Display for StaleLeaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.msg)
    }
}

impl std::error::Error for StaleLeaseError {}
