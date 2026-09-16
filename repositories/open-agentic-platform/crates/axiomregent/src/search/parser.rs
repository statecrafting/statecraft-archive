// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Tree-sitter-based code block extraction for semantic search indexing.
//!
//! Wraps xray's `analysis::call_graph::parse_file` to extract function-level
//! blocks from supported languages (Rust, Python, JavaScript/TypeScript).
//! Falls back to whole-file blocks for unsupported languages.

use std::path::Path;
use xray::analysis::call_graph::{self, BlockType};

/// A code block extracted from a source file for embedding.
pub struct CodeBlock {
    pub file_path: String,
    pub function_name: Option<String>,
    pub class_name: Option<String>,
    pub block_type: String,
    pub code_content: String,
    pub call_edges: Option<String>,
}

/// Tree-sitter supported file extensions.
const TREE_SITTER_EXTENSIONS: &[&str] = &["rs", "py", "js", "ts"];

/// Check if a file extension is supported by tree-sitter parsing.
fn is_tree_sitter_supported(ext: &str) -> bool {
    TREE_SITTER_EXTENSIONS.contains(&ext)
}

/// Extract code blocks from a source file.
///
/// For tree-sitter supported languages, extracts function-level blocks
/// with names and call edges. For unsupported languages, returns a single
/// whole-file block.
pub fn extract_blocks(file_path: &Path, content: &str) -> Vec<CodeBlock> {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let path_str = file_path.to_string_lossy().to_string();

    if !is_tree_sitter_supported(&ext) {
        // Unsupported language: return whole-file block
        return vec![CodeBlock {
            file_path: path_str,
            function_name: None,
            class_name: None,
            block_type: "File".to_string(),
            code_content: content.to_string(),
            call_edges: None,
        }];
    }

    // Parse with tree-sitter via xray
    let blocks = call_graph::parse_file(file_path);

    if blocks.is_empty() {
        // Parsing yielded no blocks (e.g., file has no functions) — fall back to file block
        return vec![CodeBlock {
            file_path: path_str,
            function_name: None,
            class_name: None,
            block_type: "File".to_string(),
            code_content: content.to_string(),
            call_edges: None,
        }];
    }

    // Convert xray Blocks to CodeBlocks.
    // We need to extract the actual source code for each function from the file content.
    // Since xray's Block doesn't carry source text, we index the function name + surrounding context.
    // For now, each function block gets the whole file content but tagged with function metadata.
    // This is still better than file-level because embeddings are tagged with function names.
    //
    // A more precise approach would require tree-sitter byte ranges, which xray doesn't expose yet.
    // For now: emit one block per function with the file content, plus function metadata for search.

    let mut result = Vec::new();

    for block in &blocks {
        if block.block_type == BlockType::Function {
            let call_edges_json = if block.outgoing_calls.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&block.outgoing_calls).unwrap_or_default())
            };

            result.push(CodeBlock {
                file_path: path_str.clone(),
                function_name: block.function_name.clone(),
                class_name: block.class_name.clone(),
                block_type: "Function".to_string(),
                code_content: content.to_string(),
                call_edges: call_edges_json,
            });
        }
    }

    // If only NonFunction blocks exist, fall back to a single file block
    if result.is_empty() {
        return vec![CodeBlock {
            file_path: path_str,
            function_name: None,
            class_name: None,
            block_type: "File".to_string(),
            code_content: content.to_string(),
            call_edges: None,
        }];
    }

    result
}
