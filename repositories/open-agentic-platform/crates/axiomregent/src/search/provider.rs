// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use walkdir::WalkDir;

use super::embeddings;
use super::store::{IndexEntry, SearchStore};
use crate::router::provider::{ToolPermissions, ToolProvider};

/// Source file extensions supported for indexing.
const SUPPORTED_EXTENSIONS: &[&str] = &["rs", "py", "js", "ts", "go", "java", "tsx", "jsx"];

pub struct SearchProvider {
    store: Arc<SearchStore>,
}

impl SearchProvider {
    pub fn new(store: Arc<SearchStore>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl ToolProvider for SearchProvider {
    fn tool_schemas(&self) -> Vec<Value> {
        vec![
            json!({
                "name": "search.index",
                "description": "Index a project directory for semantic code search. Parses source files with tree-sitter, extracts code blocks, generates embeddings, and stores them for later search.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_name": { "type": "string", "description": "Unique name for this project index" },
                        "path": { "type": "string", "description": "Absolute path to the directory to index" }
                    },
                    "required": ["project_name", "path"]
                }
            }),
            json!({
                "name": "search.semantic",
                "description": "Search indexed code using natural language or code snippets. Returns the most semantically similar code blocks.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_name": { "type": "string", "description": "Project to search" },
                        "query": { "type": "string", "description": "Natural language query or code snippet" },
                        "top_k": { "type": "integer", "description": "Number of results to return (default 5)" }
                    },
                    "required": ["project_name", "query"]
                }
            }),
        ]
    }

    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<anyhow::Result<Value>> {
        match name {
            "search.index" => {
                let project_name = match args.get("project_name").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("project_name required"))),
                };
                let path = match args.get("path").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("path required"))),
                };
                Some(self.do_index(project_name, path).await)
            }
            "search.semantic" => {
                let project_name = match args.get("project_name").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("project_name required"))),
                };
                let query = match args.get("query").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("query required"))),
                };
                let top_k = args.get("top_k").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                Some(self.do_search(project_name, query, top_k).await)
            }
            _ => None,
        }
    }

    fn tier(&self, name: &str) -> Option<agent::safety::ToolTier> {
        match name {
            "search.semantic" => Some(agent::safety::ToolTier::Tier1),
            "search.index" => Some(agent::safety::ToolTier::Tier2),
            _ => None,
        }
    }

    fn permissions(&self, name: &str) -> Option<ToolPermissions> {
        match name {
            "search.semantic" => Some(ToolPermissions {
                requires_file_read: true,
                ..Default::default()
            }),
            "search.index" => Some(ToolPermissions {
                requires_file_read: true,
                requires_file_write: true,
                ..Default::default()
            }),
            _ => None,
        }
    }
}

impl SearchProvider {
    async fn do_index(&self, project_name: &str, path: &str) -> anyhow::Result<Value> {
        use super::parser;

        // Walk the directory and collect (file_path, content) pairs for supported source files.
        let mut file_pairs: Vec<(std::path::PathBuf, String)> = Vec::new();
        for entry in WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            // Skip files larger than 512 KiB to avoid embedding noise
            if let Ok(meta) = p.metadata()
                && meta.len() > 512 * 1024
            {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(p)
                && !content.trim().is_empty()
            {
                file_pairs.push((p.to_path_buf(), content));
            }
        }

        if file_pairs.is_empty() {
            return Ok(json!({
                "project_name": project_name,
                "blocks_indexed": 0,
                "status": "empty"
            }));
        }

        // Extract code blocks using tree-sitter for supported languages,
        // falling back to whole-file blocks for others.
        let mut all_blocks: Vec<parser::CodeBlock> = Vec::new();
        for (file_path, content) in &file_pairs {
            let blocks = parser::extract_blocks(file_path, content);
            all_blocks.extend(blocks);
        }

        // Generate embeddings for all block contents (CPU-bound; run off the async executor)
        let code_strings: Vec<String> = all_blocks.iter().map(|b| b.code_content.clone()).collect();
        let vectors =
            tokio::task::spawn_blocking(move || embeddings::embed_batch(&code_strings)).await??;

        // Build index entries pairing each block with its embedding
        let entries: Vec<IndexEntry> = all_blocks
            .into_iter()
            .zip(vectors)
            .map(|(block, vector)| IndexEntry {
                file_path: block.file_path,
                block_type: block.block_type,
                function_name: block.function_name,
                code_content: block.code_content,
                vector,
                call_edges: block.call_edges,
            })
            .collect();

        let count = self.store.index_project(project_name, entries).await?;

        // Emit cross-session event (FR-006)
        crate::events::emit(
            self.store.client(),
            crate::events::EVENT_INDEX_UPDATED,
            serde_json::json!({
                "project_name": project_name,
                "blocks_indexed": count,
            }),
        )
        .await;

        Ok(json!({
            "project_name": project_name,
            "blocks_indexed": count,
            "status": "indexed"
        }))
    }

    async fn do_search(
        &self,
        project_name: &str,
        query: &str,
        top_k: usize,
    ) -> anyhow::Result<Value> {
        let vectors = self.store.load_vectors(project_name).await?;
        if vectors.is_empty() {
            return Ok(json!({
                "project_name": project_name,
                "results": [],
                "message": "No indexed data. Run search.index first."
            }));
        }

        let query_str = query.to_string();
        let results = tokio::task::spawn_blocking(move || {
            embeddings::search_vectors(vectors, &query_str, top_k)
        })
        .await??;

        let count = results.len();
        Ok(json!({
            "project_name": project_name,
            "results": results,
            "count": count
        }))
    }
}
