// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::PipelineError;
use crate::types::{PipelineRun, RunId, StageId};

/// Filesystem layout under `<project>/.opc/decomposition/<run-id>/`.
///
/// ```text
/// <run_id>/
///   run.json                # PipelineRun manifest
///   s1-extraction/
///   s2-fingerprint/
///   s3-clusters/
///   s4-callgraph/
///   s5-lineage/
///   s6-synthesis/
///     specs/
///       NNN-slug/spec.md    # one per cluster
/// ```
pub struct RunDirectory {
    root: PathBuf,
    run_id: RunId,
}

impl RunDirectory {
    /// Build a handle without creating directories. Call `ensure()` to
    /// materialise the on-disk layout.
    pub fn new(output_root: impl Into<PathBuf>, run_id: RunId) -> Self {
        let root = output_root.into().join(run_id.as_str());
        Self { root, run_id }
    }

    pub fn run_id(&self) -> &RunId {
        &self.run_id
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn ensure(&self) -> Result<(), PipelineError> {
        fs::create_dir_all(&self.root).map_err(|e| PipelineError::io(&self.root, e))?;
        for stage in StageId::all() {
            let dir = self.stage_dir(stage);
            fs::create_dir_all(&dir).map_err(|e| PipelineError::io(&dir, e))?;
        }
        // Synthesis nests `specs/` underneath itself.
        let specs_dir = self.synthesis_specs_dir();
        fs::create_dir_all(&specs_dir).map_err(|e| PipelineError::io(&specs_dir, e))?;
        Ok(())
    }

    pub fn stage_dir(&self, stage: StageId) -> PathBuf {
        self.root.join(stage.dir_name())
    }

    pub fn synthesis_specs_dir(&self) -> PathBuf {
        self.stage_dir(StageId::Synthesis).join("specs")
    }

    pub fn manifest_path(&self) -> PathBuf {
        self.root.join("run.json")
    }

    pub fn write_manifest(&self, run: &PipelineRun) -> Result<(), PipelineError> {
        let path = self.manifest_path();
        let bytes = serde_json::to_vec_pretty(run)?;
        fs::write(&path, bytes).map_err(|e| PipelineError::io(&path, e))?;
        Ok(())
    }

    pub fn load_manifest(&self) -> Result<Option<PipelineRun>, PipelineError> {
        let path = self.manifest_path();
        match fs::read(&path) {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(PipelineError::io(&path, e)),
        }
    }
}

/// Hash a stage's on-disk output directory by SHA-256-ing the
/// concatenated bytes of each regular file in lexicographic order. The
/// orchestrator uses this as the cache key for stage re-runs and as
/// the value persisted in `StageRecord::content_hash`.
pub fn hash_stage_dir(dir: &Path) -> Result<String, PipelineError> {
    let mut entries: Vec<PathBuf> = Vec::new();
    if dir.exists() {
        for entry in walkdir::WalkDir::new(dir)
            .sort_by_file_name()
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            entries.push(entry.into_path());
        }
    }
    let mut hasher = Sha256::new();
    for path in entries {
        let rel = path.strip_prefix(dir).unwrap_or(&path);
        hasher.update(rel.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        let bytes = fs::read(&path).map_err(|e| PipelineError::io(&path, e))?;
        hasher.update(&bytes);
        hasher.update(b"\0");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// SHA-256 over the bytes of a single file, lowercase hex. Used by
/// the synthesiser to populate `DraftSpecRef::content_hash`.
pub fn hash_file(path: &Path) -> Result<String, PipelineError> {
    let bytes = fs::read(path).map_err(|e| PipelineError::io(path, e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

/// Directory names excluded from the cache tree signature. Mirrors xray's
/// `IGNORED_DIRS` plus `.opc` — the pipeline's own output dir, which would
/// otherwise change the signature on every run and defeat the cache.
const SIGNATURE_IGNORED_DIRS: &[&str] = &[
    ".git",
    ".opc",
    ".bin",
    "node_modules",
    "dist",
    "build",
    "out",
    "vendor",
    "target",
    ".cache",
    ".tmp",
    "coverage",
    ".axiomregent",
];

/// Content signature of a project working tree: SHA-256 over every source
/// file's relative path, length, and bytes, in lexicographic order, with
/// `SIGNATURE_IGNORED_DIRS` pruned. This is the cache key the orchestrator
/// uses to decide whether the tree-dependent stages can be reused. Cheap
/// (IO-bound walk + hash); the expensive work it gates is xray parsing,
/// the call graph, and embeddings.
pub fn compute_tree_signature(project_root: &Path) -> Result<String, PipelineError> {
    let mut hasher = Sha256::new();
    let walker = walkdir::WalkDir::new(project_root)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            !e.file_name()
                .to_str()
                .map(|n| SIGNATURE_IGNORED_DIRS.contains(&n))
                .unwrap_or(false)
        });
    for entry in walker.filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()) {
        let path = entry.path();
        let rel = path.strip_prefix(project_root).unwrap_or(path);
        let bytes = fs::read(path).map_err(|e| PipelineError::io(path, e))?;
        hasher.update(rel.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
        hasher.update(b"\0");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Content signature of the knowledge bundle directory, or the empty
/// string when no bundle is configured. The cache key for stage 1.
pub fn compute_knowledge_signature(bundle: Option<&Path>) -> Result<String, PipelineError> {
    let Some(dir) = bundle else {
        return Ok(String::new());
    };
    if !dir.is_dir() {
        return Ok(String::new());
    }
    let mut hasher = Sha256::new();
    for entry in walkdir::WalkDir::new(dir)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let rel = path.strip_prefix(dir).unwrap_or(path);
        let bytes = fs::read(path).map_err(|e| PipelineError::io(path, e))?;
        hasher.update(rel.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        hasher.update(&bytes);
        hasher.update(b"\0");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Recursively copy the contents of `src` into `dst` (which must already
/// exist). Used to materialise a cached stage's output into a fresh run
/// directory so each run stays self-contained for certification.
pub fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), PipelineError> {
    for entry in walkdir::WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = match path.strip_prefix(src) {
            Ok(r) if !r.as_os_str().is_empty() => r,
            _ => continue,
        };
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| PipelineError::io(&target, e))?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| PipelineError::io(parent, e))?;
            }
            fs::copy(path, &target).map_err(|e| PipelineError::io(&target, e))?;
        }
    }
    Ok(())
}

/// Enumerate every run directory under `output_root`. The Tauri layer
/// surfaces this to OPC so a developer can browse prior decomposition
/// runs without parsing the filesystem layout themselves. Each entry
/// loads its manifest; entries with missing or malformed `run.json`
/// are dropped (corrupted runs aren't surfaced to the UI). Sort order:
/// run-id string descending (newest first by virtue of the timestamp
/// prefix).
pub fn list_runs(output_root: &Path) -> Result<Vec<PipelineRun>, PipelineError> {
    if !output_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut runs: Vec<PipelineRun> = Vec::new();
    for entry in fs::read_dir(output_root).map_err(|e| PipelineError::io(output_root, e))? {
        let entry = entry.map_err(|e| PipelineError::io(output_root, e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest = path.join("run.json");
        let bytes = match fs::read(&manifest) {
            Ok(b) => b,
            Err(_) => continue,
        };
        if let Ok(run) = serde_json::from_slice::<PipelineRun>(&bytes) {
            runs.push(run);
        }
    }
    runs.sort_by(|a, b| b.run_id.as_str().cmp(a.run_id.as_str()));
    Ok(runs)
}

/// Load a single run by id. Returns `Ok(None)` when the directory
/// exists but its manifest is missing or malformed; returns the error
/// only on I/O failure of the enclosing directory.
pub fn load_run(output_root: &Path, run_id: &RunId) -> Result<Option<PipelineRun>, PipelineError> {
    let manifest = output_root.join(run_id.as_str()).join("run.json");
    match fs::read(&manifest) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(PipelineError::io(&manifest, e)),
    }
}
