// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: MCP_SNAPSHOT_WORKSPACE
// Spec: spec/core/snapshot-workspace.md

use crate::lease::Fingerprint;
use crate::lease::LeaseStore;
use anyhow::{Context, Result, anyhow};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

/// Lexically normalize a caller-supplied relative path's `.`/`..` components
/// without touching the filesystem. Returns `None` when the path is absolute
/// (a `RootDir`/`Prefix` component) or when a `..` component would climb
/// above the top of the (relative) path being built, i.e. it can never
/// resolve to something that lexically escapes whatever root it is later
/// joined onto.
///
/// This is the fix for the "parent does not exist" walk-up branch below,
/// which previously joined the raw, unnormalized `rel_path` onto
/// `repo_root`: a path like `newdir/../../../evil` walked up past
/// `repo_root` before any existence/canonicalization check ever ran,
/// because none of the intermediate components existed yet. Normalizing
/// first guarantees every branch only ever operates on a path that is
/// structurally (lexically) under the root it's joined to.
fn normalize_relative(rel_path: &str) -> Option<PathBuf> {
    let mut stack: Vec<Component<'_>> = Vec::new();
    for component in Path::new(rel_path).components() {
        match component {
            Component::Normal(_) => stack.push(component),
            Component::CurDir => {}
            Component::ParentDir => match stack.last() {
                Some(Component::Normal(_)) => {
                    stack.pop();
                }
                _ => return None, // would climb above the root
            },
            Component::RootDir | Component::Prefix(_) => return None, // absolute path rejected
        }
    }
    Some(stack.iter().collect())
}

pub struct RepoMutationTools {
    pub lease_store: Arc<LeaseStore>,
}

/// Backward-compatible type alias so existing call-sites compile unchanged during migration.
pub type WorkspaceTools = RepoMutationTools;

impl RepoMutationTools {
    pub fn new(lease_store: Arc<LeaseStore>) -> Self {
        Self { lease_store }
    }

    // Safety helper: ensure path is inside repo root and is safe
    fn resolve_target_path(&self, repo_root: &Path, rel_path: &str) -> Result<PathBuf> {
        // Reject `..`/absolute components before joining onto repo_root, so
        // every branch below (including the "parent does not exist" walk-up)
        // only ever operates on a path that is lexically under repo_root.
        let normalized = normalize_relative(rel_path)
            .ok_or_else(|| anyhow!("Path escapes repo root: {}", rel_path))?;
        let path = repo_root.join(&normalized);
        // If file needs to be created, we must check parent directory presence and safety.
        // For existing files, we canonicalize.

        let canonical_root = repo_root
            .canonicalize()
            .context("Failed to canonicalize repo root")?;

        // We try to canonicalize path. If it fails (doesn't exist), we canonicalize parent.
        if path.exists() {
            let canonical_path = path
                .canonicalize()
                .context("Failed to canonicalize target path")?;
            if !canonical_path.starts_with(&canonical_root) {
                return Err(anyhow!("Path escapes repo root: {}", rel_path));
            }
            Ok(canonical_path)
        } else {
            // Path doesn't exist. Check parent.
            let parent = path.parent().ok_or_else(|| anyhow!("Invalid path"))?;
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .context("Failed to canonicalize parent")?;
                if !canonical_parent.starts_with(&canonical_root) {
                    return Err(anyhow!("Parent path escapes repo root: {}", rel_path));
                }
                // Return the joined path (since we can't canonicalize non-existent file)
                // But we should use the canonical parent + filename to be safe against some symlink tricks?
                // join filename
                let filename = path
                    .file_name()
                    .ok_or_else(|| anyhow!("Invalid filename"))?;
                Ok(canonical_parent.join(filename))
            } else {
                // Parent doesn't exist. Strict safety: reject deep creation unless create_dirs=true?
                // But for this helper, let's say we require parent to be safe.
                // If parent doesn't exist, we can't prove it's safe without resolving up to root.

                // Walk up until we find a base that exists, verify it's in root.
                let mut current = parent;
                while !current.exists() {
                    if let Some(p) = current.parent() {
                        current = p;
                    } else {
                        return Err(anyhow!("Cannot verify path safety (root not found)"));
                    }
                }
                let canonical_base = current.canonicalize()?;
                if !canonical_base.starts_with(&canonical_root) {
                    return Err(anyhow!("Path escapes repo root: {}", rel_path));
                }

                // If base safe, and we assume we are not following symlinks in non-existent components (obviously), it is safe.
                // But target logic must be precise.

                // Simple approach: we join components to canonical root? No, symlinks.
                // If intermediate components don't exist, they are just names.
                Ok(path)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn apply_patch(
        &self,
        repo_root: &Path,
        patch: &str,
        mode: &str,
        lease_id: Option<String>,
        _snapshot_id: Option<String>,
        strip: Option<usize>,
        _reject_on_conflict: bool,
        dry_run: bool,
    ) -> Result<serde_json::Value> {
        if mode == "worktree" {
            let lid = lease_id.ok_or_else(|| anyhow!("lease_id required"))?;
            self.lease_store.check_lease(&lid, repo_root).await?;

            let mut cmd = tokio::process::Command::new("git");
            cmd.arg("apply");
            cmd.arg("--verbose"); // To get details?

            // "No fuzzing": git apply has specific whitespace options but strict context usually default or --ignore-space-change.
            // "byte-for-byte": default.
            // "no fuzzing": technically `git apply` might fuzz. `--unidiff-zero`?
            // To prevent fuzzing, we might need recent git version flags, but default is usually fine.

            if dry_run {
                cmd.arg("--check");
            }

            if let Some(n) = strip {
                cmd.arg(format!("-p{}", n));
            }

            // Write patch to stdin
            cmd.current_dir(repo_root);
            cmd.stdin(std::process::Stdio::piped());
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            let mut child = cmd.spawn()?;
            if let Some(mut stdin) = child.stdin.take() {
                use tokio::io::AsyncWriteExt;
                stdin.write_all(patch.as_bytes()).await?;
            }

            let output = child.wait_with_output().await?;

            if output.status.success() {
                // Touched files
                let touched = parse_patch_touched_files(patch);
                self.lease_store.touch_files(&lid, touched.clone()).await?;

                let new_fingerprint = Fingerprint::compute(repo_root).await?;

                let applied_value: Vec<serde_json::Value> = touched
                    .iter()
                    .map(|f| {
                        serde_json::json!({
                            "path": f,
                            "status": "ok"
                        })
                    })
                    .collect();

                Ok(serde_json::json!({
                    "applied": applied_value,
                    "rejects": [],
                    "lease_id": lid,
                    "fingerprint": new_fingerprint,
                    "cache_key": format!("{}:sha256:{}", lid, new_fingerprint.status_hash),
                    "cache_hint": "until_dirty"
                }))
            } else {
                // Parse reject reasons.
                // Assuming simple failure means "whole patch rejected" or specific hunks?
                // Git apply fails atomically usually.
                let stderr = String::from_utf8_lossy(&output.stderr);

                // Return errors as structured rejects if possible?
                // Or just fail.
                // Spec allows returning "rejects" list in Success response (if partial assert allowed?)
                // Schema has "rejects" field.
                // But if `git apply` fails (exit 1), nothing changed.
                // So "applied": []
                // "rejects": [ ... ]

                // We fake a "conflict" reject for all touched paths?
                // Or parse "error: patch failed: file:line".

                let rejects = parse_git_apply_errors(&stderr, patch);

                Ok(serde_json::json!({
                    "applied": [],
                    "rejects": rejects,
                    "lease_id": lid,
                    "fingerprint": Fingerprint::compute(repo_root).await?, // State didn't change ideally
                    "cache_key": "conflict",
                    "cache_hint": "until_dirty"
                }))
            }
        } else if mode == "snapshot" {
            Err(anyhow!(
                "snapshot mode is deprecated; use checkpoint.create via MCP router"
            ))
        } else {
            Err(anyhow!("Invalid mode"))
        }
    }

    pub async fn write_file(
        &self,
        repo_root: &Path,
        path: &str,
        content_base64: &str,
        lease_id: Option<String>,
        create_dirs: bool,
        dry_run: bool,
    ) -> Result<bool> {
        let lid = lease_id.ok_or_else(|| anyhow!("lease_id required"))?;
        self.lease_store.check_lease(&lid, repo_root).await?;

        let target = self.resolve_target_path(repo_root, path)?;

        use base64::{Engine as _, engine::general_purpose};
        let content = if let Some(rest) = content_base64.strip_prefix("base64:") {
            general_purpose::STANDARD
                .decode(rest)
                .context("Invalid base64 content")?
        } else {
            // accept plain text
            content_base64.as_bytes().to_vec()
        };

        if let Some(parent) = target.parent()
            && !parent.exists()
        {
            if create_dirs {
                if !dry_run {
                    std::fs::create_dir_all(parent)?;
                }
            } else {
                return Err(anyhow!(
                    "Parent directory does not exist (set create_dirs=true)"
                ));
            }
        }

        if !dry_run {
            std::fs::write(&target, content)?;
            self.lease_store
                .touch_files(&lid, vec![path.to_string()])
                .await?;
        }

        Ok(true)
    }

    pub async fn delete(
        &self,
        repo_root: &Path,
        path: &str,
        lease_id: Option<String>,
        dry_run: bool,
    ) -> Result<bool> {
        let lid = lease_id.ok_or_else(|| anyhow!("lease_id required"))?;
        self.lease_store.check_lease(&lid, repo_root).await?; // Verify at start

        let target = self.resolve_target_path(repo_root, path)?;

        if !target.exists() {
            return Err(anyhow!("File not found"));
        }

        if !dry_run {
            if target.is_dir() {
                std::fs::remove_dir_all(&target)?;
            } else {
                std::fs::remove_file(&target)?;
            }
            self.lease_store
                .touch_files(&lid, vec![path.to_string()])
                .await?;
        }

        Ok(true)
    }
}

// Helpers

fn parse_patch_touched_files(patch: &str) -> Vec<String> {
    let mut files = Vec::new();
    for line in patch.lines() {
        if line.starts_with("+++ ") {
            let path_part = line.trim_start_matches("+++ ").trim();
            // strip 'b/' or 'a/'? git diff is a/ b/
            // Usually destination is b/
            let clean_path = if let Some(stripped) = path_part.strip_prefix("b/") {
                stripped
            } else {
                path_part
            };
            if clean_path != "/dev/null" {
                files.push(clean_path.to_string());
            }
        }
    }
    files
}

fn parse_git_apply_errors(stderr: &str, patch: &str) -> Vec<serde_json::Value> {
    // Parse "error: patch failed: <file>:<line>"
    // Return structured rejects
    let mut rejects = Vec::new();
    // Simplified parsing
    for line in stderr.lines() {
        if let Some(part) = line.strip_prefix("error: patch failed: ") {
            let parts: Vec<&str> = part.split(':').collect();
            if parts.len() >= 2 {
                let file = parts[0];
                rejects.push(serde_json::json!({
                    "path": file,
                    "hunks": [{ "index": 0, "reason": "context_mismatch" }] // Dummy index/reason
                }));
            }
        }
    }

    // Fallback if no specific failure found but status failed
    if rejects.is_empty() {
        // Mark all touched as rejected?
        let touched = parse_patch_touched_files(patch);
        for f in touched {
            rejects.push(serde_json::json!({
                "path": f,
                "hunks": [{ "index": 0, "reason": "unknown_failure" }]
            }));
        }
    }
    rejects
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lease::LeaseStore;
    use std::sync::Arc;

    #[test]
    fn normalize_relative_rejects_absolute_paths() {
        assert!(normalize_relative("/etc/passwd").is_none());
    }

    #[test]
    fn normalize_relative_rejects_climb_above_root() {
        // Every one of these lexically climbs above the (empty) root before
        // any component that could "absorb" the `..`.
        assert!(normalize_relative("..").is_none());
        assert!(normalize_relative("../evil").is_none());
        assert!(normalize_relative("newdir/../../../evil").is_none());
    }

    #[test]
    fn normalize_relative_collapses_internal_dotdot() {
        // `..` that stays within the path (never climbs above the top) is
        // fine: it collapses lexically, same as `a/b/../c` -> `a/c`.
        assert_eq!(
            normalize_relative("a/b/../c").unwrap(),
            std::path::PathBuf::from("a/c")
        );
        assert_eq!(
            normalize_relative("./a/./b").unwrap(),
            std::path::PathBuf::from("a/b")
        );
    }

    #[tokio::test]
    async fn resolve_target_path_rejects_traversal_via_nonexistent_parent() {
        // Regression test for the "parent does not exist" walk-up branch:
        // a target under a not-yet-created directory whose relative path
        // climbs above repo_root must be rejected, not silently resolved
        // outside repo_root.
        let dir = tempfile::tempdir().unwrap();
        let client = crate::db::init_hiqlite(dir.path()).await.unwrap();
        let lease_store = Arc::new(LeaseStore::new(client));
        let tools = RepoMutationTools::new(lease_store);

        let err = tools
            .resolve_target_path(dir.path(), "newdir/../../../evil")
            .unwrap_err();
        assert!(
            err.to_string().contains("escapes repo root"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn test_snapshot_mode_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let client = crate::db::init_hiqlite(dir.path()).await.unwrap();
        let lease_store = Arc::new(LeaseStore::new(client));
        let tools = RepoMutationTools::new(lease_store);

        let res = tools
            .apply_patch(dir.path(), "", "snapshot", None, None, None, false, false)
            .await;

        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("deprecated"));
    }
}
