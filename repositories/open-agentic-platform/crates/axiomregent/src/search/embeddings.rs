// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::{Result, anyhow};
use fastembed::TextEmbedding;
use kd_tree::{KdPoint, KdTree};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use typenum::U384;

pub const VECTOR_SIZE: usize = 384;

static MODEL: Lazy<Result<Mutex<TextEmbedding>, String>> = Lazy::new(|| {
    TextEmbedding::try_new(Default::default())
        .map(Mutex::new)
        .map_err(|e| format!("Failed to initialize embedding model: {e}"))
});

fn get_model() -> Result<parking_lot::MutexGuard<'static, TextEmbedding>> {
    MODEL
        .as_ref()
        .map(|m| m.lock())
        .map_err(|e| anyhow!("{}", e))
}

/// A single embedded code vector with its source content.
#[derive(Clone, Debug)]
pub struct CodeVector {
    pub point: [f32; VECTOR_SIZE],
    pub code: String,
    pub file_path: String,
    pub function_name: Option<String>,
    pub block_type: String,
}

impl KdPoint for CodeVector {
    type Scalar = f32;
    type Dim = U384;
    fn at(&self, i: usize) -> f32 {
        self.point[i]
    }
}

/// Generate an embedding vector for a code snippet.
pub fn embed_code(code: &str) -> Result<[f32; VECTOR_SIZE]> {
    let mut model = get_model()?;
    let embeddings: Vec<Vec<f32>> = model.embed(vec![code.to_owned()], None)?;
    let vec = embeddings
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("No embedding returned"))?;
    vec.as_slice()
        .try_into()
        .map_err(|_| anyhow!("Embedding dimension mismatch: expected {VECTOR_SIZE}"))
}

/// Generate embeddings for multiple code snippets.
pub fn embed_batch(codes: &[String]) -> Result<Vec<[f32; VECTOR_SIZE]>> {
    let mut model = get_model()?;
    let embeddings: Vec<Vec<f32>> = model.embed(codes, None)?;
    embeddings
        .into_iter()
        .map(|v| {
            v.as_slice()
                .try_into()
                .map_err(|_| anyhow!("Embedding dimension mismatch: expected {VECTOR_SIZE}"))
        })
        .collect()
}

/// Search result from semantic search.
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub code: String,
    pub file_path: String,
    pub function_name: Option<String>,
    pub block_type: String,
    pub score: f32,
}

/// Build a kd-tree from vectors and search for nearest neighbours.
pub fn search_vectors(
    vectors: Vec<CodeVector>,
    query: &str,
    top_k: usize,
) -> Result<Vec<SearchResult>> {
    if vectors.is_empty() {
        return Ok(vec![]);
    }
    let query_vec = embed_code(query)?;
    let query_point = CodeVector {
        point: query_vec,
        code: String::new(),
        file_path: String::new(),
        function_name: None,
        block_type: String::new(),
    };

    let tree: KdTree<CodeVector> = KdTree::par_build_by_ordered_float(vectors);
    let results = tree.nearests(&query_point, top_k);

    Ok(results
        .into_iter()
        .map(|item| {
            let dist = item.squared_distance;
            SearchResult {
                code: item.item.code.clone(),
                file_path: item.item.file_path.clone(),
                function_name: item.item.function_name.clone(),
                block_type: item.item.block_type.clone(),
                score: 1.0 / (1.0 + dist),
            }
        })
        .collect())
}
