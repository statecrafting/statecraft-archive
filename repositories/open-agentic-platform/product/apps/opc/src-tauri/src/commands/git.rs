//! Native git commands via the `git2` crate.
//!
//! Provides read-only git information (diff, status, ahead/behind, current branch)
//! without spawning shell processes — avoids PATH issues in sandboxed macOS apps.

use git2::{DiffOptions, Repository, StatusOptions};

use crate::types::{GitAheadBehind, GitDiff, GitError, GitHeadCommit, GitStatusEntry};

fn open_repo(repo_path: &str) -> Result<Repository, GitError> {
    Repository::open(repo_path).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            GitError::NotFound {
                message: format!("No git repository at '{repo_path}'"),
            }
        } else {
            GitError::Other {
                message: e.message().to_string(),
            }
        }
    })
}

/// Returns the unified diff.
///
/// - `ref1 = None, ref2 = None` → HEAD vs working directory (includes staged)
/// - `ref1 = Some("HEAD~1"), ref2 = Some("HEAD")` → diff between two commits
#[tauri::command]
#[specta::specta]
pub fn git_diff(
    repo_path: String,
    ref1: Option<String>,
    ref2: Option<String>,
) -> Result<GitDiff, GitError> {
    let repo = open_repo(&repo_path)?;

    let diff = match (ref1, ref2) {
        (None, None) => {
            let head_tree =
                repo.head()
                    .and_then(|h| h.peel_to_tree())
                    .map_err(|e| GitError::Other {
                        message: format!("Failed to resolve HEAD: {}", e.message()),
                    })?;
            let mut opts = DiffOptions::new();
            repo.diff_tree_to_workdir_with_index(Some(&head_tree), Some(&mut opts))
                .map_err(|e| GitError::Other {
                    message: e.message().to_string(),
                })?
        }
        (Some(r1), Some(r2)) => {
            let obj1 = repo
                .revparse_single(&r1)
                .map_err(|_| GitError::RefNotFound {
                    message: format!("Ref '{r1}' not found"),
                })?;
            let obj2 = repo
                .revparse_single(&r2)
                .map_err(|_| GitError::RefNotFound {
                    message: format!("Ref '{r2}' not found"),
                })?;
            let tree1 = obj1.peel_to_tree().map_err(|e| GitError::Other {
                message: e.message().to_string(),
            })?;
            let tree2 = obj2.peel_to_tree().map_err(|e| GitError::Other {
                message: e.message().to_string(),
            })?;
            repo.diff_tree_to_tree(Some(&tree1), Some(&tree2), None)
                .map_err(|e| GitError::Other {
                    message: e.message().to_string(),
                })?
        }
        _ => {
            return Err(GitError::Other {
                message: "Provide both ref1 and ref2, or neither".to_string(),
            });
        }
    };

    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        use git2::DiffLineType::*;
        let prefix = match line.origin_value() {
            Addition => "+",
            Deletion => "-",
            Context => " ",
            _ => "",
        };
        if let Ok(s) = std::str::from_utf8(line.content()) {
            diff_text.push_str(prefix);
            diff_text.push_str(s);
        }
        true
    })
    .map_err(|e| GitError::Other {
        message: e.message().to_string(),
    })?;

    let stats = diff.stats().map_err(|e| GitError::Other {
        message: e.message().to_string(),
    })?;

    let stat_text = stats
        .to_buf(git2::DiffStatsFormat::FULL, 80)
        .map(|b| b.as_str().unwrap_or("").to_string())
        .unwrap_or_default();

    Ok(GitDiff {
        stat: stat_text,
        diff: diff_text,
        files_changed: stats.files_changed() as u32,
        insertions: stats.insertions() as u32,
        deletions: stats.deletions() as u32,
    })
}

/// Returns the working-tree status (tracked + untracked files).
#[tauri::command]
#[specta::specta]
pub fn git_status(repo_path: String) -> Result<Vec<GitStatusEntry>, GitError> {
    let repo = open_repo(&repo_path)?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| GitError::Other {
            message: e.message().to_string(),
        })?;

    let mut entries = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let flags = entry.status();

        if flags.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED,
        ) {
            let status = if flags.contains(git2::Status::INDEX_NEW) {
                "added"
            } else if flags.contains(git2::Status::INDEX_DELETED) {
                "deleted"
            } else if flags.contains(git2::Status::INDEX_RENAMED) {
                "renamed"
            } else {
                "modified"
            };
            entries.push(GitStatusEntry {
                path: path.clone(),
                status: status.to_string(),
                staged: true,
            });
        }

        if flags.intersects(
            git2::Status::WT_NEW
                | git2::Status::WT_MODIFIED
                | git2::Status::WT_DELETED
                | git2::Status::CONFLICTED,
        ) {
            let status = if flags.contains(git2::Status::WT_NEW) {
                "untracked"
            } else if flags.contains(git2::Status::WT_DELETED) {
                "deleted"
            } else if flags.contains(git2::Status::CONFLICTED) {
                "conflicted"
            } else {
                "modified"
            };
            entries.push(GitStatusEntry {
                path,
                status: status.to_string(),
                staged: false,
            });
        }
    }

    Ok(entries)
}

/// Returns how many commits the local branch is ahead of and behind its upstream.
/// Returns `ahead = 0, behind = 0` when there is no upstream configured.
#[tauri::command]
#[specta::specta]
pub fn git_ahead_behind(repo_path: String, branch: String) -> Result<GitAheadBehind, GitError> {
    let repo = open_repo(&repo_path)?;

    let local_branch = repo
        .find_branch(&branch, git2::BranchType::Local)
        .map_err(|_| GitError::RefNotFound {
            message: format!("Local branch '{branch}' not found"),
        })?;

    let upstream = match local_branch.upstream() {
        Ok(u) => u,
        Err(_) => {
            return Ok(GitAheadBehind {
                ahead: 0,
                behind: 0,
            });
        }
    };

    let local_oid = local_branch.get().target().ok_or_else(|| GitError::Other {
        message: "Local branch has no target OID".to_string(),
    })?;

    let upstream_oid = upstream.get().target().ok_or_else(|| GitError::Other {
        message: "Upstream branch has no target OID".to_string(),
    })?;

    let (ahead, behind) = repo
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| GitError::Other {
            message: e.message().to_string(),
        })?;

    Ok(GitAheadBehind {
        ahead: ahead as u32,
        behind: behind as u32,
    })
}

/// Returns the name of the currently checked-out branch.
/// Returns `GitError::DetachedHead` when in detached HEAD state.
#[tauri::command]
#[specta::specta]
pub fn git_current_branch(repo_path: String) -> Result<String, GitError> {
    let repo = open_repo(&repo_path)?;

    let head = repo.head().map_err(|e| GitError::Other {
        message: format!("Failed to read HEAD: {}", e.message()),
    })?;

    if head.is_branch() {
        // git2 0.21: Reference::shorthand returns Result<&str, Error> (was
        // Option<&str> in 0.20). A UTF-8 error is treated as the prior None
        // case (DetachedHead); is_branch already gates the detached-HEAD path.
        head.shorthand()
            .ok()
            .map(|s| s.to_string())
            .ok_or(GitError::DetachedHead)
    } else {
        Err(GitError::DetachedHead)
    }
}

/// `git log -1` — full object id and first line of the commit message.
#[tauri::command]
#[specta::specta]
pub fn git_last_commit(repo_path: String) -> Result<GitHeadCommit, GitError> {
    let repo = open_repo(&repo_path)?;

    let head = repo.head().map_err(|e| GitError::Other {
        message: format!("Failed to read HEAD: {}", e.message()),
    })?;

    let oid = head.target().ok_or_else(|| GitError::Other {
        message: "HEAD has no target OID".to_string(),
    })?;

    let commit = repo.find_commit(oid).map_err(|e| GitError::Other {
        message: e.message().to_string(),
    })?;

    let hash = oid.to_string();
    // git2 0.21: Commit::summary returns Result<Option<&str>, Error> (was
    // Option<&str> in 0.20); Ok(None) when there is no summary. Fall back to
    // an empty string on error or no-summary, preserving prior behaviour.
    let message = commit
        .summary()
        .ok()
        .flatten()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "".to_string());

    Ok(GitHeadCommit { hash, message })
}
