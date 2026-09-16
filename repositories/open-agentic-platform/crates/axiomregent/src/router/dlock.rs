// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Hiqlite distributed lock (dlock) coordination for Tier2/3 tool dispatch.
//!
//! When multiple axiomregent sessions share the same hiqlite instance,
//! Tier2/3 tools that mutate the worktree acquire a dlock keyed by
//! the canonical repo root path before proceeding (FR-007).
//!
//! The hiqlite dlock API is RAII-based: `client.lock(key)` awaits until the
//! lock is acquired and returns a `Lock` guard. The lock is released when the
//! guard is dropped. The internal timeout is 10 seconds (hiqlite built-in,
//! prevents deadlocks if a session crashes before releasing).

use hiqlite::{Client, Lock};

use crate::router::AxiomRegentError;

/// Build the dlock key for a repository root.
fn lock_key(repo_root: &str) -> String {
    format!("dlock:worktree:{}", repo_root)
}

/// Attempt to acquire a distributed lock for the given repo root.
///
/// Returns a `Lock` guard if the lock was acquired. The guard MUST be held
/// until the tool call completes — dropping it releases the lock.
///
/// The call awaits until the lock becomes available. If the hiqlite node is
/// unreachable, an `Internal` error is returned.
pub async fn acquire_repo_lock(client: &Client, repo_root: &str) -> Result<Lock, AxiomRegentError> {
    let key = lock_key(repo_root);

    client.lock(key).await.map_err(|e| {
        AxiomRegentError::Internal(format!("failed to acquire repo lock for {repo_root}: {e}"))
    })
}
