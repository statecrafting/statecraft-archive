// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/139-factory-artifact-substrate/spec.md
//
// Phase 3 (T070) — `FactoryRoot` enum.
//
// Lifts `FactoryEngineConfig.factory_root: PathBuf` into a two-variant enum
// so the OPC desktop can drive the engine against either a local checkout
// (legacy / test) or a HTTP-backed `VirtualRoot` (spec 139 §8).
//
// **Scope reminder (locked Phase 3 directive):** virtualisation covers
// `factory_root` proper only. `LocalArtifactStore.base_dir` and
// `StageCdInputs.artifact_store` remain filesystem-anchored — they are
// per-run output stores, not factory-content stores. If during surgery
// it becomes apparent that one of them needs virtualising too, halt and
// surface — that's a scope expansion, not a Phase 3 task.
//
// The Virtual variant materialises substrate content into the local cache
// directory before the engine runs; from the engine's perspective the
// cache is an ordinary filesystem tree.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::virtual_root::{VirtualRoot, VirtualRootError};

/// Source of factory content for a Factory pipeline run.
#[derive(Clone)]
pub enum FactoryRoot {
    /// On-disk `factory/` directory. Existing tests + ad-hoc local
    /// development use this variant; the OPC desktop used to use this
    /// pre-spec-139.
    Filesystem(PathBuf),
    /// HTTP-backed substrate root, materialised into a local cache. The
    /// `Arc` makes the variant cheaply cloneable into multiple subsystems
    /// (engine, manifest gen, verify harness) without re-creating the
    /// HTTP client + cache state.
    Virtual(Arc<VirtualRoot>),
}

impl std::fmt::Debug for FactoryRoot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FactoryRoot::Filesystem(p) => f.debug_tuple("Filesystem").field(p).finish(),
            FactoryRoot::Virtual(_) => f.debug_struct("Virtual").finish_non_exhaustive(),
        }
    }
}

impl FactoryRoot {
    /// Construct a filesystem-backed root.
    pub fn filesystem(path: impl Into<PathBuf>) -> Self {
        Self::Filesystem(path.into())
    }

    /// Construct a virtual (HTTP-backed) root from an already-built
    /// [`VirtualRoot`]. Caller is responsible for calling
    /// [`VirtualRoot::materialize`] before invoking the engine — `local_path`
    /// returns the cache directory which the engine treats as a regular
    /// filesystem tree.
    pub fn virtual_root(root: Arc<VirtualRoot>) -> Self {
        Self::Virtual(root)
    }

    /// Local filesystem path the engine reads from.
    ///
    /// - Filesystem variant: the configured directory verbatim.
    /// - Virtual variant: the cache directory. The cache MUST have been
    ///   warmed by `VirtualRoot::materialize` (or per-artifact reads) for
    ///   engine code to find files; the engine doesn't drive HTTP itself.
    pub fn local_path(&self) -> &Path {
        match self {
            FactoryRoot::Filesystem(p) => p.as_path(),
            FactoryRoot::Virtual(vr) => vr.local_path(),
        }
    }

    /// Ensure substrate content is materialised in the local cache. No-op
    /// for the Filesystem variant.
    pub async fn materialize(&self) -> Result<(), VirtualRootError> {
        match self {
            FactoryRoot::Filesystem(_) => Ok(()),
            FactoryRoot::Virtual(vr) => vr.materialize().await,
        }
    }

    /// True iff the variant requires HTTP fetches before engine reads
    /// will resolve.
    pub fn is_virtual(&self) -> bool {
        matches!(self, FactoryRoot::Virtual(_))
    }
}

impl Default for FactoryRoot {
    fn default() -> Self {
        // Mirrors the prior `PathBuf::from("factory")` default so existing
        // tests + the `cargo run -- factory-run` CLI keep working without
        // explicit config.
        FactoryRoot::Filesystem(PathBuf::from("factory"))
    }
}

impl From<PathBuf> for FactoryRoot {
    fn from(path: PathBuf) -> Self {
        FactoryRoot::Filesystem(path)
    }
}

impl From<&Path> for FactoryRoot {
    fn from(path: &Path) -> Self {
        FactoryRoot::Filesystem(path.to_path_buf())
    }
}
