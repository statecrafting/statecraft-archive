// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Hiqlite-backed checkpoint metadata store.
//!
//! [`CheckpointStore`] wraps a [`hiqlite::Client`] and a [`BlobStore`] to
//! provide async checkpoint CRUD, diffing, timeline traversal, fork, and GC.

use std::borrow::Cow;
use std::collections::HashMap;

use anyhow::Result;
use hiqlite::{Client, Param};

use super::blobs::BlobStore;
use super::types::{CheckpointDiff, CheckpointInfo, FileEntry, GcResult, TimelineNode};

/// Combined checkpoint metadata + blob storage.
pub struct CheckpointStore {
    pub client: Client,
    pub blobs: BlobStore,
}

impl CheckpointStore {
    /// Create a new store from an existing hiqlite client and blob store.
    pub fn new(client: Client, blobs: BlobStore) -> Self {
        Self { client, blobs }
    }

    // -----------------------------------------------------------------------
    // Write operations
    // -----------------------------------------------------------------------

    /// Persist a new checkpoint and its file manifest.
    ///
    /// Inserts the checkpoint row, all manifest entries, and upserts blob
    /// reference counts.
    pub async fn create_checkpoint(
        &self,
        info: &CheckpointInfo,
        entries: &[FileEntry],
    ) -> Result<()> {
        self.client
            .execute(
                Cow::Borrowed(
                    "INSERT INTO checkpoints \
                     (checkpoint_id, repo_root, parent_id, label, head_sha, fingerprint, \
                      state_hash, merkle_root, file_count, total_bytes, created_at, metadata, \
                      project_id, branch_name, run_id) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
                ),
                vec![
                    Param::Text(info.checkpoint_id.clone()),
                    Param::Text(info.repo_root.clone()),
                    info.parent_id
                        .clone()
                        .map(Param::Text)
                        .unwrap_or(Param::Null),
                    info.label.clone().map(Param::Text).unwrap_or(Param::Null),
                    info.head_sha
                        .clone()
                        .map(Param::Text)
                        .unwrap_or(Param::Null),
                    Param::Text(info.fingerprint.clone()),
                    Param::Text(info.state_hash.clone()),
                    Param::Text(info.merkle_root.clone()),
                    Param::Integer(info.file_count),
                    Param::Integer(info.total_bytes),
                    Param::Text(info.created_at.clone()),
                    info.metadata
                        .clone()
                        .map(Param::Text)
                        .unwrap_or(Param::Null),
                    info.project_id
                        .clone()
                        .map(Param::Text)
                        .unwrap_or(Param::Null),
                    info.branch_name
                        .clone()
                        .map(Param::Text)
                        .unwrap_or(Param::Null),
                    info.run_id.clone().map(Param::Text).unwrap_or(Param::Null),
                ],
            )
            .await?;

        for entry in entries {
            self.client
                .execute(
                    Cow::Borrowed(
                        "INSERT OR IGNORE INTO manifest_entries \
                         (checkpoint_id, path, blob_hash, size_bytes, permissions) \
                         VALUES ($1, $2, $3, $4, $5)",
                    ),
                    vec![
                        Param::Text(info.checkpoint_id.clone()),
                        Param::Text(entry.path.to_string_lossy().to_string()),
                        Param::Text(entry.content_hash.clone()),
                        Param::Integer(entry.size as i64),
                        Param::Integer(entry.permissions as i64),
                    ],
                )
                .await?;

            self.client
                .execute(
                    Cow::Borrowed(
                        "INSERT INTO blob_refs (blob_hash, ref_count, size_bytes, compression) \
                         VALUES ($1, 1, $2, 'lz4') \
                         ON CONFLICT(blob_hash) DO UPDATE SET ref_count = ref_count + 1",
                    ),
                    vec![
                        Param::Text(entry.content_hash.clone()),
                        Param::Integer(entry.size as i64),
                    ],
                )
                .await?;
        }

        Ok(())
    }

    /// Delete a checkpoint and decrement blob reference counts.
    pub async fn delete_checkpoint(&self, checkpoint_id: &str) -> Result<()> {
        let entries = self.get_entries(checkpoint_id).await?;
        for entry in &entries {
            self.client
                .execute(
                    Cow::Borrowed(
                        "UPDATE blob_refs SET ref_count = ref_count - 1 WHERE blob_hash = $1",
                    ),
                    vec![Param::Text(entry.content_hash.clone())],
                )
                .await?;
        }

        self.client
            .execute(
                Cow::Borrowed("DELETE FROM manifest_entries WHERE checkpoint_id = $1"),
                vec![Param::Text(checkpoint_id.to_string())],
            )
            .await?;

        self.client
            .execute(
                Cow::Borrowed("DELETE FROM checkpoints WHERE checkpoint_id = $1"),
                vec![Param::Text(checkpoint_id.to_string())],
            )
            .await?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read operations
    // -----------------------------------------------------------------------

    /// Look up a single checkpoint by ID.
    pub async fn get_checkpoint(&self, checkpoint_id: &str) -> Result<Option<CheckpointInfo>> {
        let rows: Vec<CheckpointInfo> = self
            .client
            .query_as(
                "SELECT checkpoint_id, repo_root, parent_id, label, head_sha, fingerprint, \
                 state_hash, merkle_root, file_count, total_bytes, created_at, metadata, \
                 project_id, branch_name, run_id \
                 FROM checkpoints WHERE checkpoint_id = $1",
                vec![Param::Text(checkpoint_id.to_string())],
            )
            .await?;
        Ok(rows.into_iter().next())
    }

    /// List all checkpoints for a repository root, newest first.
    ///
    /// When `project_id` is `Some`, only checkpoints with a matching
    /// `project_id` are returned. `None` returns all checkpoints for the repo.
    pub async fn list_checkpoints(
        &self,
        repo_root: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<CheckpointInfo>> {
        match project_id {
            Some(pid) => self
                .client
                .query_as(
                    "SELECT checkpoint_id, repo_root, parent_id, label, head_sha, fingerprint, \
                         state_hash, merkle_root, file_count, total_bytes, created_at, metadata, \
                         project_id, branch_name, run_id \
                         FROM checkpoints WHERE repo_root = $1 AND project_id = $2 \
                         ORDER BY created_at DESC",
                    vec![
                        Param::Text(repo_root.to_string()),
                        Param::Text(pid.to_string()),
                    ],
                )
                .await
                .map_err(Into::into),
            None => self
                .client
                .query_as(
                    "SELECT checkpoint_id, repo_root, parent_id, label, head_sha, fingerprint, \
                         state_hash, merkle_root, file_count, total_bytes, created_at, metadata, \
                         project_id, branch_name, run_id \
                         FROM checkpoints WHERE repo_root = $1 ORDER BY created_at DESC",
                    vec![Param::Text(repo_root.to_string())],
                )
                .await
                .map_err(Into::into),
        }
    }

    /// Return all manifest entries for a checkpoint, sorted by path.
    pub async fn get_entries(&self, checkpoint_id: &str) -> Result<Vec<FileEntry>> {
        #[derive(serde::Deserialize)]
        struct EntryRow {
            path: String,
            blob_hash: String,
            size_bytes: i64,
            permissions: Option<i64>,
        }

        let rows: Vec<EntryRow> = self
            .client
            .query_as(
                "SELECT path, blob_hash, size_bytes, permissions \
                 FROM manifest_entries WHERE checkpoint_id = $1 ORDER BY path",
                vec![Param::Text(checkpoint_id.to_string())],
            )
            .await?;

        Ok(rows
            .into_iter()
            .map(|r| FileEntry {
                path: r.path.into(),
                content_hash: r.blob_hash,
                size: r.size_bytes as u64,
                permissions: r.permissions.unwrap_or(0o644) as u32,
                // combined_hash is not stored in manifest_entries; left empty
                // because it is only needed at checkpoint-creation time.
                combined_hash: String::new(),
            })
            .collect())
    }

    // -----------------------------------------------------------------------
    // Diff / timeline
    // -----------------------------------------------------------------------

    /// Compute a path-level diff between two checkpoints.
    pub async fn diff_checkpoints(&self, from_id: &str, to_id: &str) -> Result<CheckpointDiff> {
        let from_entries = self.get_entries(from_id).await?;
        let to_entries = self.get_entries(to_id).await?;

        let from_map: HashMap<String, &str> = from_entries
            .iter()
            .map(|e| {
                (
                    e.path.to_string_lossy().to_string(),
                    e.content_hash.as_str(),
                )
            })
            .collect();
        let to_map: HashMap<String, &str> = to_entries
            .iter()
            .map(|e| {
                (
                    e.path.to_string_lossy().to_string(),
                    e.content_hash.as_str(),
                )
            })
            .collect();

        let mut added = Vec::new();
        let mut modified = Vec::new();
        let mut deleted = Vec::new();

        for (path, hash) in &to_map {
            match from_map.get(path) {
                None => added.push(path.clone()),
                Some(old_hash) if *old_hash != *hash => modified.push(path.clone()),
                _ => {}
            }
        }
        for path in from_map.keys() {
            if !to_map.contains_key(path) {
                deleted.push(path.clone());
            }
        }

        Ok(CheckpointDiff {
            from_id: from_id.to_string(),
            to_id: to_id.to_string(),
            added,
            modified,
            deleted,
        })
    }

    /// Build the timeline graph for a repository root.
    ///
    /// The "current" checkpoint is the most-recently-created one (first in the
    /// list returned by [`list_checkpoints`], which orders by `created_at DESC`).
    /// When `project_id` is `Some`, the graph is restricted to checkpoints
    /// belonging to that project.
    pub async fn get_timeline(
        &self,
        repo_root: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<TimelineNode>> {
        let checkpoints = self.list_checkpoints(repo_root, project_id).await?;

        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
        for cp in &checkpoints {
            if let Some(pid) = &cp.parent_id {
                children_map
                    .entry(pid.clone())
                    .or_default()
                    .push(cp.checkpoint_id.clone());
            }
        }

        let current_id = checkpoints.first().map(|c| c.checkpoint_id.clone());

        Ok(checkpoints
            .into_iter()
            .map(|cp| {
                let children = children_map
                    .get(&cp.checkpoint_id)
                    .cloned()
                    .unwrap_or_default();
                let is_current = current_id.as_ref() == Some(&cp.checkpoint_id);
                TimelineNode {
                    checkpoint_id: cp.checkpoint_id,
                    parent_id: cp.parent_id,
                    label: cp.label,
                    created_at: cp.created_at,
                    children,
                    is_current,
                    head_sha: cp.head_sha,
                    branch_name: cp.branch_name,
                    run_id: cp.run_id,
                }
            })
            .collect())
    }

    // -----------------------------------------------------------------------
    // Fork
    // -----------------------------------------------------------------------

    /// Create a copy of `source_id` as a new checkpoint (with a fresh ID) and
    /// return the new [`CheckpointInfo`].
    pub async fn fork_checkpoint(
        &self,
        source_id: &str,
        label: Option<String>,
    ) -> Result<CheckpointInfo> {
        let source = self
            .get_checkpoint(source_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Checkpoint not found: {}", source_id))?;
        let entries = self.get_entries(source_id).await?;

        let new_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let fork = CheckpointInfo {
            checkpoint_id: new_id,
            parent_id: Some(source_id.to_string()),
            label,
            repo_root: source.repo_root,
            head_sha: source.head_sha,
            fingerprint: source.fingerprint,
            state_hash: source.state_hash,
            merkle_root: source.merkle_root,
            file_count: source.file_count,
            total_bytes: source.total_bytes,
            created_at: now,
            metadata: source.metadata,
            project_id: source.project_id,
            branch_name: source.branch_name,
            run_id: source.run_id,
        };

        self.create_checkpoint(&fork, &entries).await?;
        Ok(fork)
    }

    // -----------------------------------------------------------------------
    // Garbage collection
    // -----------------------------------------------------------------------

    /// Remove all blobs whose `ref_count` has dropped to zero or below.
    ///
    /// `repo_root` is accepted for API symmetry but GC is global across all
    /// repos sharing this store (blob refs are not scoped by repo).
    pub async fn gc(&self, _repo_root: &str) -> Result<GcResult> {
        #[derive(serde::Deserialize)]
        struct BlobRow {
            blob_hash: String,
            size_bytes: i64,
        }

        let orphans: Vec<BlobRow> = self
            .client
            .query_as(
                "SELECT blob_hash, size_bytes FROM blob_refs WHERE ref_count <= 0",
                vec![],
            )
            .await?;

        let mut removed = 0usize;
        let mut freed = 0u64;

        for orphan in &orphans {
            self.blobs.delete(&orphan.blob_hash)?;

            self.client
                .execute(
                    Cow::Borrowed("DELETE FROM blob_refs WHERE blob_hash = $1"),
                    vec![Param::Text(orphan.blob_hash.clone())],
                )
                .await?;

            removed += 1;
            freed += orphan.size_bytes as u64;
        }

        Ok(GcResult {
            objects_removed: removed,
            bytes_freed: freed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint::types::{CheckpointInfo, FileEntry};

    /// Create a temp-dir-backed CheckpointStore.
    ///
    /// Returns the `TempDir` handle so it is not dropped (and cleaned up)
    /// before the test body finishes.
    async fn make_test_store() -> (tempfile::TempDir, CheckpointStore) {
        let dir = tempfile::tempdir().unwrap();
        let client = crate::db::init_hiqlite(dir.path()).await.unwrap();
        let blobs = BlobStore::new(dir.path().join("blobs")).unwrap();
        (dir, CheckpointStore::new(client, blobs))
    }

    fn make_info(id: &str, repo: &str) -> CheckpointInfo {
        CheckpointInfo {
            checkpoint_id: id.to_string(),
            parent_id: None,
            label: None,
            repo_root: repo.to_string(),
            head_sha: None,
            fingerprint: "fp-000".to_string(),
            state_hash: "sh-000".to_string(),
            merkle_root: "mr-000".to_string(),
            file_count: 0,
            total_bytes: 0,
            created_at: "2026-04-12T00:00:00Z".to_string(),
            metadata: None,
            project_id: None,
            branch_name: None,
            run_id: None,
        }
    }

    fn make_entry(path: &str, hash: &str, size: u64) -> FileEntry {
        FileEntry {
            path: path.into(),
            content_hash: hash.to_string(),
            size,
            permissions: 0o644,
            combined_hash: format!("{hash}-combined"),
        }
    }

    // -----------------------------------------------------------------------
    // Create + Get
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_1_create_and_get_checkpoint() {
        let (_dir, store) = make_test_store().await;
        let mut info = make_info("cp-1", "/repo");
        info.head_sha = Some("abc123".into());
        info.project_id = Some("ws-1".into());
        info.branch_name = Some("main".into());
        info.run_id = Some("run-42".into());
        info.label = Some("initial".into());
        info.file_count = 2;
        info.total_bytes = 512;
        info.fingerprint = "fp-xyz".into();
        info.state_hash = "sh-xyz".into();
        info.merkle_root = "mr-xyz".into();

        let entries = vec![make_entry("a.rs", "h1", 256), make_entry("b.rs", "h2", 256)];
        store.create_checkpoint(&info, &entries).await.unwrap();

        let loaded = store.get_checkpoint("cp-1").await.unwrap().unwrap();
        assert_eq!(loaded.checkpoint_id, "cp-1");
        assert_eq!(loaded.repo_root, "/repo");
        assert_eq!(loaded.head_sha.as_deref(), Some("abc123"));
        assert_eq!(loaded.project_id.as_deref(), Some("ws-1"));
        assert_eq!(loaded.branch_name.as_deref(), Some("main"));
        assert_eq!(loaded.run_id.as_deref(), Some("run-42"));
        assert_eq!(loaded.label.as_deref(), Some("initial"));
        assert_eq!(loaded.file_count, 2);
        assert_eq!(loaded.total_bytes, 512);
        assert_eq!(loaded.fingerprint, "fp-xyz");
        assert_eq!(loaded.state_hash, "sh-xyz");
        assert_eq!(loaded.merkle_root, "mr-xyz");
    }

    #[tokio::test]
    async fn sc095_1_create_records_manifest_entries() {
        let (_dir, store) = make_test_store().await;
        let info = make_info("cp-m", "/repo");
        let entries = vec![
            make_entry("src/c.rs", "hc", 100),
            make_entry("src/a.rs", "ha", 200),
            make_entry("src/b.rs", "hb", 300),
        ];
        store.create_checkpoint(&info, &entries).await.unwrap();

        let loaded = store.get_entries("cp-m").await.unwrap();
        assert_eq!(loaded.len(), 3);
        // get_entries sorts by path
        assert_eq!(loaded[0].path.to_string_lossy(), "src/a.rs");
        assert_eq!(loaded[0].content_hash, "ha");
        assert_eq!(loaded[0].size, 200);
        assert_eq!(loaded[1].path.to_string_lossy(), "src/b.rs");
        assert_eq!(loaded[2].path.to_string_lossy(), "src/c.rs");
    }

    #[tokio::test]
    async fn sc095_1_create_upserts_blob_refs() {
        let (_dir, store) = make_test_store().await;

        // First checkpoint: entries with hashes h-shared and h-only-a
        let info_a = make_info("cp-a", "/repo");
        let entries_a = vec![
            make_entry("a.rs", "h-shared", 100),
            make_entry("b.rs", "h-only-a", 200),
        ];
        store.create_checkpoint(&info_a, &entries_a).await.unwrap();

        // Second checkpoint: entries with hashes h-shared and h-only-b
        let mut info_b = make_info("cp-b", "/repo");
        info_b.created_at = "2026-04-12T00:01:00Z".into();
        let entries_b = vec![
            make_entry("a.rs", "h-shared", 100),
            make_entry("c.rs", "h-only-b", 300),
        ];
        store.create_checkpoint(&info_b, &entries_b).await.unwrap();

        // Query blob_refs for h-shared — ref_count should be 2
        #[derive(serde::Deserialize)]
        struct RefRow {
            ref_count: i64,
        }
        let rows: Vec<RefRow> = store
            .client
            .query_as(
                "SELECT ref_count FROM blob_refs WHERE blob_hash = $1",
                vec![hiqlite::Param::Text("h-shared".into())],
            )
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ref_count, 2);

        // h-only-a should have ref_count 1
        let rows_a: Vec<RefRow> = store
            .client
            .query_as(
                "SELECT ref_count FROM blob_refs WHERE blob_hash = $1",
                vec![hiqlite::Param::Text("h-only-a".into())],
            )
            .await
            .unwrap();
        assert_eq!(rows_a[0].ref_count, 1);
    }

    // -----------------------------------------------------------------------
    // Get / List
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_2_get_nonexistent_returns_none() {
        let (_dir, store) = make_test_store().await;
        let result = store.get_checkpoint("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn sc095_2_list_by_repo_root() {
        let (_dir, store) = make_test_store().await;

        let mut info1 = make_info("cp-1", "/repo-a");
        info1.created_at = "2026-04-12T00:00:00Z".into();
        store.create_checkpoint(&info1, &[]).await.unwrap();

        let mut info2 = make_info("cp-2", "/repo-a");
        info2.created_at = "2026-04-12T00:01:00Z".into();
        store.create_checkpoint(&info2, &[]).await.unwrap();

        let mut info3 = make_info("cp-3", "/repo-b");
        info3.created_at = "2026-04-12T00:02:00Z".into();
        store.create_checkpoint(&info3, &[]).await.unwrap();

        let list = store.list_checkpoints("/repo-a", None).await.unwrap();
        assert_eq!(list.len(), 2);
        // Ordered by created_at DESC — cp-2 first
        assert_eq!(list[0].checkpoint_id, "cp-2");
        assert_eq!(list[1].checkpoint_id, "cp-1");
    }

    #[tokio::test]
    async fn sc095_2_list_filtered_by_project() {
        let (_dir, store) = make_test_store().await;

        let mut info1 = make_info("cp-w1a", "/repo");
        info1.project_id = Some("ws-1".into());
        info1.created_at = "2026-04-12T00:00:00Z".into();
        store.create_checkpoint(&info1, &[]).await.unwrap();

        let mut info2 = make_info("cp-w1b", "/repo");
        info2.project_id = Some("ws-1".into());
        info2.created_at = "2026-04-12T00:01:00Z".into();
        store.create_checkpoint(&info2, &[]).await.unwrap();

        let mut info3 = make_info("cp-w2", "/repo");
        info3.project_id = Some("ws-2".into());
        info3.created_at = "2026-04-12T00:02:00Z".into();
        store.create_checkpoint(&info3, &[]).await.unwrap();

        let proj1 = store.list_checkpoints("/repo", Some("ws-1")).await.unwrap();
        assert_eq!(proj1.len(), 2);

        let all = store.list_checkpoints("/repo", None).await.unwrap();
        assert_eq!(all.len(), 3);
    }

    // -----------------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_3_delete_removes_rows() {
        let (_dir, store) = make_test_store().await;

        let info = make_info("cp-del", "/repo");
        let entries = vec![make_entry("a.rs", "hd1", 100)];
        store.create_checkpoint(&info, &entries).await.unwrap();

        store.delete_checkpoint("cp-del").await.unwrap();

        assert!(store.get_checkpoint("cp-del").await.unwrap().is_none());
        assert!(store.get_entries("cp-del").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn sc095_3_delete_decrements_blob_refs() {
        let (_dir, store) = make_test_store().await;

        let info = make_info("cp-ref", "/repo");
        let entries = vec![make_entry("a.rs", "h-dec", 100)];
        store.create_checkpoint(&info, &entries).await.unwrap();

        // Before delete: ref_count = 1
        #[derive(serde::Deserialize)]
        struct RefRow {
            ref_count: i64,
        }
        let before: Vec<RefRow> = store
            .client
            .query_as(
                "SELECT ref_count FROM blob_refs WHERE blob_hash = $1",
                vec![hiqlite::Param::Text("h-dec".into())],
            )
            .await
            .unwrap();
        assert_eq!(before[0].ref_count, 1);

        store.delete_checkpoint("cp-ref").await.unwrap();

        let after: Vec<RefRow> = store
            .client
            .query_as(
                "SELECT ref_count FROM blob_refs WHERE blob_hash = $1",
                vec![hiqlite::Param::Text("h-dec".into())],
            )
            .await
            .unwrap();
        assert_eq!(after[0].ref_count, 0);
    }

    // -----------------------------------------------------------------------
    // Diff
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_4_diff_added_modified_deleted() {
        let (_dir, store) = make_test_store().await;

        let info_a = make_info("cp-da", "/repo");
        let entries_a = vec![
            make_entry("foo.rs", "h1", 100),
            make_entry("bar.rs", "h2", 200),
        ];
        store.create_checkpoint(&info_a, &entries_a).await.unwrap();

        let mut info_b = make_info("cp-db", "/repo");
        info_b.created_at = "2026-04-12T00:01:00Z".into();
        let entries_b = vec![
            make_entry("foo.rs", "h3", 150), // modified (different hash)
            make_entry("baz.rs", "h4", 300), // added
                                             // bar.rs deleted
        ];
        store.create_checkpoint(&info_b, &entries_b).await.unwrap();

        let diff = store.diff_checkpoints("cp-da", "cp-db").await.unwrap();
        assert_eq!(diff.from_id, "cp-da");
        assert_eq!(diff.to_id, "cp-db");
        assert_eq!(diff.added, vec!["baz.rs"]);
        assert_eq!(diff.modified, vec!["foo.rs"]);
        assert_eq!(diff.deleted, vec!["bar.rs"]);
    }

    #[tokio::test]
    async fn sc095_4_diff_identical_empty() {
        let (_dir, store) = make_test_store().await;

        let info_a = make_info("cp-id-a", "/repo");
        let entries = vec![make_entry("x.rs", "hx", 100)];
        store.create_checkpoint(&info_a, &entries).await.unwrap();

        let mut info_b = make_info("cp-id-b", "/repo");
        info_b.created_at = "2026-04-12T00:01:00Z".into();
        store.create_checkpoint(&info_b, &entries).await.unwrap();

        let diff = store.diff_checkpoints("cp-id-a", "cp-id-b").await.unwrap();
        assert!(diff.added.is_empty());
        assert!(diff.modified.is_empty());
        assert!(diff.deleted.is_empty());
    }

    // -----------------------------------------------------------------------
    // Timeline
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_5_timeline_linear_chain() {
        let (_dir, store) = make_test_store().await;

        let mut c1 = make_info("c1", "/repo");
        c1.created_at = "2026-04-12T00:00:00Z".into();
        store.create_checkpoint(&c1, &[]).await.unwrap();

        let mut c2 = make_info("c2", "/repo");
        c2.parent_id = Some("c1".into());
        c2.created_at = "2026-04-12T00:01:00Z".into();
        store.create_checkpoint(&c2, &[]).await.unwrap();

        let mut c3 = make_info("c3", "/repo");
        c3.parent_id = Some("c2".into());
        c3.created_at = "2026-04-12T00:02:00Z".into();
        store.create_checkpoint(&c3, &[]).await.unwrap();

        let timeline = store.get_timeline("/repo", None).await.unwrap();
        assert_eq!(timeline.len(), 3);

        // Ordered by created_at DESC: c3, c2, c1
        assert_eq!(timeline[0].checkpoint_id, "c3");
        assert!(timeline[0].is_current);
        assert!(!timeline[1].is_current);
        assert!(!timeline[2].is_current);

        // c1 has child c2
        let c1_node = timeline.iter().find(|n| n.checkpoint_id == "c1").unwrap();
        assert!(c1_node.children.contains(&"c2".to_string()));

        // c2 has child c3
        let c2_node = timeline.iter().find(|n| n.checkpoint_id == "c2").unwrap();
        assert!(c2_node.children.contains(&"c3".to_string()));

        // c3 has no children
        let c3_node = timeline.iter().find(|n| n.checkpoint_id == "c3").unwrap();
        assert!(c3_node.children.is_empty());
    }

    #[tokio::test]
    async fn sc095_5_timeline_project_scoped() {
        let (_dir, store) = make_test_store().await;

        let mut c1 = make_info("cw-1", "/repo");
        c1.project_id = Some("ws-A".into());
        c1.created_at = "2026-04-12T00:00:00Z".into();
        store.create_checkpoint(&c1, &[]).await.unwrap();

        let mut c2 = make_info("cw-2", "/repo");
        c2.project_id = Some("ws-B".into());
        c2.created_at = "2026-04-12T00:01:00Z".into();
        store.create_checkpoint(&c2, &[]).await.unwrap();

        let timeline = store.get_timeline("/repo", Some("ws-A")).await.unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].checkpoint_id, "cw-1");
    }

    // -----------------------------------------------------------------------
    // Fork
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_6_fork_creates_new_with_parent() {
        let (_dir, store) = make_test_store().await;

        let info = make_info("cp-src", "/repo");
        let entries = vec![make_entry("a.rs", "ha", 100), make_entry("b.rs", "hb", 200)];
        store.create_checkpoint(&info, &entries).await.unwrap();

        let fork = store
            .fork_checkpoint("cp-src", Some("experiment".into()))
            .await
            .unwrap();

        assert_ne!(fork.checkpoint_id, "cp-src");
        assert_eq!(fork.parent_id.as_deref(), Some("cp-src"));
        assert_eq!(fork.label.as_deref(), Some("experiment"));
        assert_eq!(fork.repo_root, "/repo");

        // Fork entries match source
        let fork_entries = store.get_entries(&fork.checkpoint_id).await.unwrap();
        assert_eq!(fork_entries.len(), 2);
        assert_eq!(fork_entries[0].content_hash, "ha");
        assert_eq!(fork_entries[1].content_hash, "hb");
    }

    #[tokio::test]
    async fn sc095_6_fork_nonexistent_errors() {
        let (_dir, store) = make_test_store().await;
        let err = store
            .fork_checkpoint("nonexistent", None)
            .await
            .unwrap_err();
        assert!(
            err.to_string().contains("not found"),
            "Expected 'not found' in error: {}",
            err
        );
    }

    // -----------------------------------------------------------------------
    // GC
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn sc095_7_gc_removes_orphan_blobs() {
        let (_dir, store) = make_test_store().await;

        // Put real blobs so GC can delete files
        let hash_a = store.blobs.put(b"blob-a-content").unwrap();
        let hash_b = store.blobs.put(b"blob-b-content").unwrap();

        let info = make_info("cp-gc", "/repo");
        let entries = vec![
            make_entry("a.rs", &hash_a, 14),
            make_entry("b.rs", &hash_b, 14),
        ];
        store.create_checkpoint(&info, &entries).await.unwrap();

        // Delete the checkpoint → ref_counts go to 0
        store.delete_checkpoint("cp-gc").await.unwrap();

        assert!(store.blobs.has(&hash_a), "blob should exist before GC");

        let gc = store.gc("/repo").await.unwrap();
        assert!(
            gc.objects_removed >= 2,
            "expected 2+ removed, got {}",
            gc.objects_removed
        );
        assert!(gc.bytes_freed > 0);
        assert!(!store.blobs.has(&hash_a), "blob should be deleted after GC");
        assert!(!store.blobs.has(&hash_b), "blob should be deleted after GC");
    }

    #[tokio::test]
    async fn sc095_7_gc_preserves_referenced_blobs() {
        let (_dir, store) = make_test_store().await;

        let hash_shared = store.blobs.put(b"shared-content").unwrap();

        // Two checkpoints share the same blob
        let info1 = make_info("cp-gc1", "/repo");
        let entries1 = vec![make_entry("a.rs", &hash_shared, 14)];
        store.create_checkpoint(&info1, &entries1).await.unwrap();

        let mut info2 = make_info("cp-gc2", "/repo");
        info2.created_at = "2026-04-12T00:01:00Z".into();
        let entries2 = vec![make_entry("a.rs", &hash_shared, 14)];
        store.create_checkpoint(&info2, &entries2).await.unwrap();

        // Delete one checkpoint — ref_count goes to 1
        store.delete_checkpoint("cp-gc1").await.unwrap();

        let gc = store.gc("/repo").await.unwrap();
        assert_eq!(gc.objects_removed, 0, "shared blob should be preserved");
        assert!(store.blobs.has(&hash_shared));
    }

    #[tokio::test]
    async fn sc095_7_gc_noop_when_no_orphans() {
        let (_dir, store) = make_test_store().await;

        let hash = store.blobs.put(b"live-content").unwrap();
        let info = make_info("cp-live", "/repo");
        let entries = vec![make_entry("a.rs", &hash, 12)];
        store.create_checkpoint(&info, &entries).await.unwrap();

        let gc = store.gc("/repo").await.unwrap();
        assert_eq!(gc.objects_removed, 0);
        assert_eq!(gc.bytes_freed, 0);
    }
}
