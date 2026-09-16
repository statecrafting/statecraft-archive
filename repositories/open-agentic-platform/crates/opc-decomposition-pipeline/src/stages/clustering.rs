// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 3 — semantic clustering. Default path: group files by their
// top-level directory (FR-010's xray-only fallback). With the
// `embeddings` feature enabled, the alternative path embeds source
// blocks via xray and groups by cosine-similarity threshold.

use std::collections::BTreeMap;
use std::fs;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_stage_dir};
use crate::stages::fingerprint as fp;
use crate::types::{Cluster, DegradedReason, PipelineConfig, StageId, StageRecord, StageStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusteringOutput {
    pub method: String,
    pub clusters: Vec<Cluster>,
}

pub fn run(config: &PipelineConfig, run_dir: &RunDirectory) -> Result<StageRecord, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::Clustering);

    let index = fp::load_index(run_dir)?;

    let (clusters, method, degraded) = if config.embeddings_enabled {
        embedding_clusters(&index, &config.project_root, &config.output_root)?
    } else {
        let c = directory_clusters(&index);
        (c, "by-top-dir".to_string(), Some(DegradedReason::NoEmbeddingsBackend))
    };

    let output = ClusteringOutput {
        method,
        clusters,
    };
    let out_path = stage_dir.join("clusters.json");
    let bytes = serde_json::to_vec_pretty(&output)?;
    fs::write(&out_path, bytes).map_err(|e| PipelineError::io(&out_path, e))?;

    let content_hash = hash_stage_dir(&stage_dir)?;
    let status = if degraded.is_some() {
        StageStatus::Degraded
    } else {
        StageStatus::Complete
    };
    Ok(StageRecord {
        id: StageId::Clustering,
        status,
        content_hash,
        output_relpath: StageId::Clustering.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    })
}

pub fn load_clusters(run_dir: &RunDirectory) -> Result<ClusteringOutput, PipelineError> {
    let path = run_dir.stage_dir(StageId::Clustering).join("clusters.json");
    let bytes = fs::read(&path).map_err(|e| PipelineError::io(&path, e))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Top-level directories excluded from clustering: VCS, build output, and
/// crucially the pipeline's own `.opc/` scratch dir — otherwise stage 6
/// would emit "specs" describing the decomposition run's own artifacts.
/// Mirrors xray's `IGNORED_DIRS` plus `.opc`.
const CLUSTER_IGNORED_DIRS: &[&str] = &[
    ".opc",
    ".git",
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

/// Group files by their top-level path component. Stable across runs:
/// clusters and `paths` within them are sorted lexicographically. Files
/// under `CLUSTER_IGNORED_DIRS` (incl. the run's own `.opc/`) are dropped.
fn directory_clusters(index: &xray::XrayIndex) -> Vec<Cluster> {
    let mut buckets: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for f in &index.files {
        let top = top_dir(&f.path);
        if CLUSTER_IGNORED_DIRS.contains(&top.as_str()) {
            continue;
        }
        buckets.entry(top).or_default().push(f.path.clone());
    }
    let mut clusters = Vec::with_capacity(buckets.len());
    for (i, (root_dir, mut paths)) in buckets.into_iter().enumerate() {
        paths.sort();
        let summary = format!(
            "Cluster rooted at {root_dir}, {n} file(s). Method: directory grouping.",
            n = paths.len()
        );
        clusters.push(Cluster {
            id: format!("c{:03}", i + 1),
            paths,
            root_dir,
            summary,
        });
    }
    clusters
}

fn top_dir(path: &str) -> String {
    match path.split_once('/') {
        Some((head, _)) if !head.is_empty() => head.to_string(),
        _ => ".".to_string(),
    }
}

#[cfg(feature = "embeddings")]
fn embedding_clusters(
    index: &xray::XrayIndex,
    project_root: &std::path::Path,
    output_root: &std::path::Path,
) -> Result<(Vec<Cluster>, String, Option<DegradedReason>), PipelineError> {
    use crate::embedding_cache::EmbeddingCache;
    use xray::analysis::embeddings;

    // Spec 192: front the embedder with a content-addressed cache so
    // unchanged content is never re-embedded across runs.
    let cache = EmbeddingCache::new(output_root);

    // Build per-file (path, snippet, content-key). We give the embedder up
    // to ~2KB of file content; longer files dominate fastembed's truncation
    // window anyway, so trimming is safe and keeps the run bounded.
    let mut paths: Vec<String> = Vec::with_capacity(index.files.len());
    let mut snippets: Vec<String> = Vec::with_capacity(index.files.len());
    let mut keys: Vec<String> = Vec::with_capacity(index.files.len());
    for f in &index.files {
        if CLUSTER_IGNORED_DIRS.contains(&top_dir(&f.path).as_str()) {
            continue;
        }
        let abs = project_root.join(&f.path);
        let bytes = match fs::read(&abs) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let snippet: String = String::from_utf8_lossy(&bytes).chars().take(2048).collect();
        if snippet.trim().is_empty() {
            continue;
        }
        keys.push(EmbeddingCache::key(snippet.as_bytes()));
        snippets.push(snippet);
        paths.push(f.path.clone());
    }
    if paths.is_empty() {
        return Ok((Vec::new(), "embedding".to_string(), Some(DegradedReason::EmptyProjectTree)));
    }

    // Resolve embeddings through the cache; only misses hit the model.
    let mut resolved: Vec<Option<[f32; 384]>> = vec![None; paths.len()];
    let mut miss_indices: Vec<usize> = Vec::new();
    let mut miss_blocks: Vec<String> = Vec::new();
    for (i, key) in keys.iter().enumerate() {
        match cache.get(key) {
            Some(v) if v.len() == 384 => {
                resolved[i] = Some(v.try_into().expect("len checked == 384"));
            }
            _ => {
                miss_indices.push(i);
                miss_blocks.push(snippets[i].clone());
            }
        }
    }
    if !miss_blocks.is_empty() {
        let embedded = embeddings::embed_batch(&miss_blocks)
            .map_err(|e| PipelineError::XrayScan(format!("embed_batch: {e}")))?;
        for (j, &i) in miss_indices.iter().enumerate() {
            let arr = embedded[j];
            // Cache write is best-effort: a failure here must not fail the
            // run (spec 192 FR-003 — the cache is an optimisation).
            let _ = cache.put(&keys[i], &arr);
            resolved[i] = Some(arr);
        }
    }
    let vectors: Vec<[f32; 384]> = resolved
        .into_iter()
        .map(|v| v.expect("every embedding resolved (cache hit or fresh embed)"))
        .collect();

    // Threshold-clustered union-find: any pair with cosine sim > 0.85
    // joins. Deterministic for a given input ordering.
    let threshold = 0.85_f32;
    let n = vectors.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], mut x: usize) -> usize {
        while p[x] != x {
            p[x] = p[p[x]];
            x = p[x];
        }
        x
    }
    fn union(p: &mut [usize], a: usize, b: usize) {
        let ra = find(p, a);
        let rb = find(p, b);
        if ra != rb {
            p[ra] = rb;
        }
    }
    fn cosine(a: &[f32; 384], b: &[f32; 384]) -> f32 {
        let mut dot = 0f32;
        let mut na = 0f32;
        let mut nb = 0f32;
        for i in 0..384 {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        if na == 0.0 || nb == 0.0 {
            0.0
        } else {
            dot / (na.sqrt() * nb.sqrt())
        }
    }
    for i in 0..n {
        for j in (i + 1)..n {
            if cosine(&vectors[i], &vectors[j]) >= threshold {
                union(&mut parent, i, j);
            }
        }
    }

    let mut by_root: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for (i, p) in paths.iter().enumerate() {
        let r = find(&mut parent, i);
        by_root.entry(r).or_default().push(p.clone());
    }

    let mut clusters = Vec::with_capacity(by_root.len());
    for (i, (_root, mut ps)) in by_root.into_iter().enumerate() {
        ps.sort();
        let root_dir = ps.first().map(|p| top_dir(p)).unwrap_or_else(|| ".".to_string());
        let summary = format!(
            "Cluster rooted at {root_dir}, {n} file(s). Method: embedding cosine > {threshold:.2}.",
            n = ps.len()
        );
        clusters.push(Cluster {
            id: format!("c{:03}", i + 1),
            paths: ps,
            root_dir,
            summary,
        });
    }
    Ok((clusters, "embedding".to_string(), None))
}

#[cfg(not(feature = "embeddings"))]
fn embedding_clusters(
    _index: &xray::XrayIndex,
    _project_root: &std::path::Path,
    _output_root: &std::path::Path,
) -> Result<(Vec<Cluster>, String, Option<DegradedReason>), PipelineError> {
    // Embeddings requested but feature not compiled in. Surface this
    // as the FR-010 degraded path so the orchestrator can flag it.
    Ok((Vec::new(), "unavailable".to_string(), Some(DegradedReason::NoEmbeddingsBackend)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::stages::fingerprint;
    use crate::types::{PipelineConfig, RunId};

    fn fresh_run_dir(out: &std::path::Path) -> RunDirectory {
        let rid = RunId(String::from("test-cluster"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    #[test]
    fn directory_clusters_group_by_top_dir() {
        let project = tempdir().unwrap();
        let crates_a = project.path().join("crates").join("a");
        let crates_b = project.path().join("crates").join("b");
        let tools = project.path().join("tools");
        fs::create_dir_all(&crates_a).unwrap();
        fs::create_dir_all(&crates_b).unwrap();
        fs::create_dir_all(&tools).unwrap();
        fs::write(crates_a.join("lib.rs"), "fn a(){}\n").unwrap();
        fs::write(crates_b.join("lib.rs"), "fn b(){}\n").unwrap();
        fs::write(tools.join("main.rs"), "fn main(){}\n").unwrap();
        fs::write(project.path().join("README.md"), "# x").unwrap();

        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());

        // Stage 2 must run first so we have an index.json to read.
        fingerprint::run(&cfg, &rd).unwrap();

        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Degraded); // no embeddings backend by default
        let out = load_clusters(&rd).unwrap();
        // Top-level groups: "crates", "tools", "." (for README.md).
        let roots: Vec<_> = out.clusters.iter().map(|c| c.root_dir.clone()).collect();
        assert!(roots.contains(&"crates".to_string()));
        assert!(roots.contains(&"tools".to_string()));
    }
}
