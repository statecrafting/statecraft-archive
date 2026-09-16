// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::Result;
use kd_tree::{KdPoint, KdTree, KdTreeN};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

/// Embedding vector dimension (fastembed default model).
pub const VECTOR_SIZE: usize = 384;

/// Lazily initialized fastembed model.
static MODEL: Lazy<Result<parking_lot::Mutex<fastembed::TextEmbedding>, String>> =
    Lazy::new(|| {
        fastembed::TextEmbedding::try_new(Default::default())
            .map(parking_lot::Mutex::new)
            .map_err(|e| format!("fastembed model initialization failed: {e}"))
    });

/// A code block paired with its vector embedding.
#[derive(Debug, Clone)]
pub struct Vector {
    pub point: [f32; VECTOR_SIZE],
    pub code: String,
    /// Source file path for this code block.
    pub source_file: String,
}

impl KdPoint for Vector {
    type Scalar = f32;
    type Dim = typenum::U384;
    fn at(&self, k: usize) -> f32 {
        self.point[k]
    }
}

type VectorKdTree = KdTreeN<Vector, typenum::U384>;

/// Search result from semantic code search.
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    /// Best matching code block.
    pub nearest: String,
    /// Top-k matching code blocks.
    pub k_nearest: Vec<SearchMatch>,
}

/// A single search match.
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub code: String,
    pub source_file: String,
}

/// Generate a vector embedding for a single code string.
pub fn embed_code(code: &str) -> Result<[f32; VECTOR_SIZE]> {
    let model = MODEL.as_ref().map_err(|e| anyhow::anyhow!("{e}"))?;
    let output = model.lock().embed(vec![code.to_owned()], None)?;
    let vector: [f32; VECTOR_SIZE] = output[0]
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("Unexpected embedding dimension"))?;
    Ok(vector)
}

/// Generate embeddings for a batch of code blocks.
pub fn embed_batch(code_blocks: &[String]) -> Result<Vec<[f32; VECTOR_SIZE]>> {
    let model = MODEL.as_ref().map_err(|e| anyhow::anyhow!("{e}"))?;
    let output = model.lock().embed(code_blocks.to_vec(), None)?;
    output
        .into_iter()
        .map(|v| {
            v.as_slice()
                .try_into()
                .map_err(|_| anyhow::anyhow!("Unexpected embedding dimension"))
        })
        .collect()
}

/// Semantic search over a set of vectors.
pub fn search(vectors: &[Vector], query: &str, top_k: usize) -> Result<SearchResult> {
    if vectors.is_empty() {
        return Err(anyhow::anyhow!("No indexed vectors"));
    }

    let query_embedding = embed_code(query)?;
    let query_vector = Vector {
        point: query_embedding,
        code: query.to_string(),
        source_file: String::new(),
    };

    let kdtree: VectorKdTree = KdTree::par_build_by_ordered_float(vectors.to_vec());

    let nearest = kdtree
        .nearest(&query_vector)
        .ok_or_else(|| anyhow::anyhow!("No nearest neighbor found"))?;

    let k_nearest = kdtree.nearests(&query_vector, top_k);
    let matches: Vec<SearchMatch> = k_nearest
        .iter()
        .map(|n| SearchMatch {
            code: n.item.code.clone(),
            source_file: n.item.source_file.clone(),
        })
        .collect();

    Ok(SearchResult {
        nearest: nearest.item.code.clone(),
        k_nearest: matches,
    })
}

/// Index a directory: read all files, split into chunks, embed them.
/// Returns a Vec<Vector> that can be serialized or searched.
pub fn index_directory(dir: &std::path::Path) -> Result<Vec<Vector>> {
    let mut code_blocks = Vec::new();
    let mut source_files = Vec::new();

    for entry in walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|s| {
                    !matches!(
                        s,
                        ".git" | "node_modules" | "target" | "dist" | "build" | "vendor" | ".cache"
                    )
                })
                .unwrap_or(true)
        })
    {
        let entry = entry?;
        if !entry.path().is_file() {
            continue;
        }

        // Only index text files with recognized extensions
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !matches!(
            ext,
            "rs" | "py" | "js" | "ts" | "go" | "java" | "c" | "cpp" | "h" | "hpp"
        ) {
            continue;
        }

        if let Ok(content) = std::fs::read_to_string(entry.path()) {
            if content.len() > 100_000 {
                continue; // Skip very large files
            }
            let rel_path = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .to_string();
            code_blocks.push(content);
            source_files.push(rel_path);
        }
    }

    if code_blocks.is_empty() {
        return Ok(Vec::new());
    }

    let embeddings = embed_batch(&code_blocks)?;

    let vectors: Vec<Vector> = embeddings
        .into_iter()
        .zip(code_blocks.into_iter())
        .zip(source_files.into_iter())
        .map(|((point, code), source_file)| Vector {
            point,
            code,
            source_file,
        })
        .collect();

    Ok(vectors)
}
