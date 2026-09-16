// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Call graph analysis module.
//!
//! Parses source files using tree-sitter to extract function definitions and
//! detect call relationships, then builds a directed call graph.
//!
//! Supports Rust, Python, JavaScript, and TypeScript (via the JS grammar).

use crate::schema::CallGraphSummary;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tree_sitter::{Language, Node, Parser};
use walkdir::WalkDir;

// Re-use the same FFI bindings already compiled by the analysis-structure build step.
unsafe extern "C" {
    fn tree_sitter_rust() -> Language;
    fn tree_sitter_python() -> Language;
    fn tree_sitter_javascript() -> Language;
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Type of a code block.
#[derive(Debug, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
pub enum BlockType {
    /// A function (or method) definition.
    Function,
    /// Any non-function top-level construct.
    NonFunction,
}

/// A parsed code block, potentially a function definition with outgoing calls.
#[derive(Debug, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
pub struct Block {
    /// Unique key: `<file>::<function>` or `<file>::<class>::<function>`.
    pub node_key: String,
    pub block_type: BlockType,
    /// The name of the function, if this is a function block.
    pub function_name: Option<String>,
    /// Containing class name, if applicable.
    pub class_name: Option<String>,
    /// Keys of functions called from within this block.
    pub outgoing_calls: Vec<String>,
}

impl Block {
    fn new(
        node_key: String,
        block_type: BlockType,
        function_name: Option<String>,
        class_name: Option<String>,
    ) -> Self {
        Block {
            node_key,
            block_type,
            function_name,
            class_name,
            outgoing_calls: Vec::new(),
        }
    }
}

/// A node in the call graph (represents one function).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallStackNode {
    /// File path relative to the scanned root.
    pub file_path: String,
    /// Containing class name, if applicable.
    pub class_name: Option<String>,
    /// Function name.
    pub function_name: String,
}

/// Directed call graph: nodes keyed by their unique key, edges as (caller, callee) pairs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallGraph {
    nodes: HashMap<String, CallStackNode>,
    edges: Vec<(String, String)>,
}

impl CallGraph {
    /// Create a new, empty call graph.
    pub fn new() -> Self {
        CallGraph {
            nodes: HashMap::new(),
            edges: Vec::new(),
        }
    }

    /// Add a node.
    pub fn add_node(&mut self, node_key: String, node: CallStackNode) {
        self.nodes.insert(node_key, node);
    }

    /// Add a directed edge from caller to callee.
    pub fn add_edge(&mut self, from: String, to: String) {
        self.edges.push((from, to));
    }

    /// Returns all node keys that have no incoming edges (potential entry points).
    pub fn get_entry_points(&self) -> Vec<String> {
        let incoming: HashSet<&String> = self.edges.iter().map(|(_, to)| to).collect();
        let mut result: Vec<String> = self
            .nodes
            .keys()
            .filter(|k| !incoming.contains(k))
            .cloned()
            .collect();
        result.sort();
        result
    }

    /// Compute and return a [`CallGraphSummary`].
    pub fn summary(&self) -> CallGraphSummary {
        CallGraphSummary {
            total_functions: self.nodes.len(),
            total_edges: self.edges.len(),
            entry_points: self.get_entry_points(),
        }
    }

    /// Emit a Graphviz DOT representation.
    pub fn to_graphviz(&self) -> String {
        let mut out = String::from("digraph CallGraph {\n");
        out.push_str("  rankdir=LR;\n");
        out.push_str("  node [shape=box];\n");

        // Stable output: sort nodes by key.
        let mut node_keys: Vec<&String> = self.nodes.keys().collect();
        node_keys.sort();
        for key in node_keys {
            let node = &self.nodes[key];
            let file_name = node.file_path.split('/').next_back().unwrap_or("");
            let label = match &node.class_name {
                Some(cls) => format!("{}::{}::{}", file_name, cls, node.function_name),
                None => format!("{}::{}", file_name, node.function_name),
            };
            out.push_str(&format!("  \"{}\" [label=\"{}\"];\n", key, label));
        }

        let mut sorted_edges = self.edges.clone();
        sorted_edges.sort();
        for (from, to) in &sorted_edges {
            out.push_str(&format!("  \"{}\" -> \"{}\";\n", from, to));
        }

        out.push('}');
        out
    }

    /// Emit a Mermaid flowchart representation.
    pub fn to_mermaid(&self) -> String {
        let mut out = String::from("graph TD;\n");

        let mut node_keys: Vec<&String> = self.nodes.keys().collect();
        node_keys.sort();
        for key in node_keys {
            let node = &self.nodes[key];
            let file_name = node.file_path.split('/').next_back().unwrap_or("");
            let label = match &node.class_name {
                Some(cls) => format!("{}::{}::{}", file_name, cls, node.function_name),
                None => format!("{}::{}", file_name, node.function_name),
            };
            let safe_key = key.replace(' ', "_");
            let safe_label = label.replace(' ', "_");
            out.push_str(&format!("  {}[\"{}\"];\n", safe_key, safe_label));
        }

        let mut sorted_edges = self.edges.clone();
        sorted_edges.sort();
        for (from, to) in &sorted_edges {
            let safe_from = from.replace(' ', "_");
            let safe_to = to.replace(' ', "_");
            out.push_str(&format!("  {} --> {};\n", safe_from, safe_to));
        }

        out
    }

    /// Emit a JSON flowchart representation (nodes + edges).
    pub fn to_json_flowchart(&self) -> String {
        use serde_json::json;

        let mut node_keys: Vec<&String> = self.nodes.keys().collect();
        node_keys.sort();

        let nodes: Vec<_> = node_keys
            .iter()
            .map(|key| {
                let node = &self.nodes[*key];
                let file_name = node.file_path.split('/').next_back().unwrap_or("");
                let label = match &node.class_name {
                    Some(cls) => format!("{}::{}::{}", file_name, cls, node.function_name),
                    None => format!("{}::{}", file_name, node.function_name),
                };
                json!({ "id": key, "label": label })
            })
            .collect();

        let mut sorted_edges = self.edges.clone();
        sorted_edges.sort();
        let edges: Vec<_> = sorted_edges
            .iter()
            .map(|(from, to)| json!({ "from": from, "to": to }))
            .collect();

        serde_json::to_string_pretty(&json!({ "nodes": nodes, "edges": edges })).unwrap_or_default()
    }
}

impl Default for CallGraph {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

fn detect_language(path: &Path) -> Option<Language> {
    let ext = path.extension()?.to_str()?;
    match ext {
        "rs" => Some(unsafe { tree_sitter_rust() }),
        "py" => Some(unsafe { tree_sitter_python() }),
        "js" | "ts" => Some(unsafe { tree_sitter_javascript() }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Node key generation
// ---------------------------------------------------------------------------

fn make_node_key(file_stem: &str, class_name: Option<&str>, function_name: &str) -> String {
    match class_name {
        Some(cls) => format!("{}::{}::{}", file_stem, cls, function_name),
        None => format!("{}::{}", file_stem, function_name),
    }
}

// ---------------------------------------------------------------------------
// Language predicate helpers
// ---------------------------------------------------------------------------

fn is_function_node(kind: &str, language: &Language) -> bool {
    let rust_lang = unsafe { tree_sitter_rust() };
    let python_lang = unsafe { tree_sitter_python() };
    let js_lang = unsafe { tree_sitter_javascript() };

    if *language == rust_lang {
        kind == "function_item"
    } else if *language == python_lang {
        kind == "function_definition"
    } else if *language == js_lang {
        kind == "function_declaration"
    } else {
        false
    }
}

fn is_class_definition(kind: &str, language: &Language) -> bool {
    let python_lang = unsafe { tree_sitter_python() };
    *language == python_lang && kind == "class_definition"
}

fn is_call_expression(kind: &str, language: &Language) -> bool {
    let rust_lang = unsafe { tree_sitter_rust() };
    let python_lang = unsafe { tree_sitter_python() };
    let js_lang = unsafe { tree_sitter_javascript() };

    if *language == rust_lang {
        kind == "call_expression"
    } else if *language == python_lang {
        kind == "call"
    } else if *language == js_lang {
        kind == "call_expression"
    } else {
        false
    }
}

fn get_function_name<'a>(code: &'a str, node: Node, _language: &Language) -> Option<&'a str> {
    node.child_by_field_name("name")
        .and_then(|n| n.utf8_text(code.as_bytes()).ok())
}

fn get_call_name<'a>(code: &'a str, node: Node, _language: &Language) -> Option<&'a str> {
    node.child_by_field_name("function")
        .and_then(|n| n.utf8_text(code.as_bytes()).ok())
}

// ---------------------------------------------------------------------------
// find_calls — walk the subtree and collect outgoing call keys
// ---------------------------------------------------------------------------

fn find_calls(code: &str, root: Node, language: &Language, file_stem: &str) -> Vec<String> {
    let mut calls: HashSet<String> = HashSet::new();
    let mut cursor = root.walk();

    loop {
        let node = cursor.node();

        if is_call_expression(node.kind(), language)
            && let Some(raw_name) = get_call_name(code, node, language)
        {
            // Strip method-call chains: "foo.bar" → callee is "bar" on object "foo".
            // We record the simple function name scoped to the current file.
            let function_name = raw_name.split('.').next_back().unwrap_or(raw_name);
            let key = make_node_key(file_stem, None, function_name);
            calls.insert(key);
        }

        if !cursor.goto_first_child() {
            while !cursor.goto_next_sibling() {
                if !cursor.goto_parent() {
                    let mut result: Vec<String> = calls.into_iter().collect();
                    result.sort();
                    return result;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// traverse_tree — recursive AST traversal, extracts Blocks
// ---------------------------------------------------------------------------

fn traverse_tree(
    code: &str,
    cursor: &mut tree_sitter::TreeCursor,
    blocks: &mut Vec<Block>,
    language: &Language,
    class_name: Option<String>,
    file_stem: &str,
) {
    let node = cursor.node();
    let kind = node.kind();

    if is_class_definition(kind, language)
        && let Some(name_node) = node.child_by_field_name("name")
        && let Ok(extracted) = name_node.utf8_text(code.as_bytes())
    {
        // Descend into class with the class name as context.
        let extracted = extracted.to_string();
        if cursor.goto_first_child() {
            loop {
                traverse_tree(
                    code,
                    cursor,
                    blocks,
                    language,
                    Some(extracted.clone()),
                    file_stem,
                );
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
            cursor.goto_parent();
        }
        return;
    } else if is_function_node(kind, language)
        && let Some(fn_name) = get_function_name(code, node, language)
    {
        let fn_name = fn_name.to_string();
        let node_key = make_node_key(file_stem, class_name.as_deref(), &fn_name);

        let mut block = Block::new(
            node_key,
            BlockType::Function,
            Some(fn_name.clone()),
            class_name.clone(),
        );

        block.outgoing_calls = find_calls(code, node, language, file_stem);

        // Avoid duplicates (e.g. when recursing into nested functions).
        if !blocks.iter().any(|b| b.node_key == block.node_key) {
            blocks.push(block);
        }
    }

    // Always recurse into children (unless we already did for class).
    if cursor.goto_first_child() {
        loop {
            traverse_tree(
                code,
                cursor,
                blocks,
                language,
                class_name.clone(),
                file_stem,
            );
            if !cursor.goto_next_sibling() {
                break;
            }
        }
        cursor.goto_parent();
    }
}

// ---------------------------------------------------------------------------
// parse_file — parse a single source file into Blocks
// ---------------------------------------------------------------------------

/// Parse a single file and return a list of `Block`s.
///
/// Returns an empty vector if the file extension is unsupported or parsing fails.
pub fn parse_file(path: &Path) -> Vec<Block> {
    let language = match detect_language(path) {
        Some(l) => l,
        None => return Vec::new(),
    };

    let code = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut parser = Parser::new();
    if parser.set_language(&language).is_err() {
        return Vec::new();
    }

    let tree = match parser.parse(&code, None) {
        Some(t) => t,
        None => return Vec::new(),
    };

    // Use the file stem as the module identifier (e.g. "src/main" from "src/main.rs").
    let file_stem = path.with_extension("").to_string_lossy().to_string();

    let mut blocks = Vec::new();
    let mut cursor = tree.root_node().walk();

    traverse_tree(&code, &mut cursor, &mut blocks, &language, None, &file_stem);

    blocks
}

// ---------------------------------------------------------------------------
// analyze_directory — walk a directory, build the full CallGraph
// ---------------------------------------------------------------------------

/// Walk `dir`, parse all supported files, and build a [`CallGraph`].
///
/// Returns the graph and its summary.
pub fn analyze_directory(dir: &Path) -> (CallGraph, CallGraphSummary) {
    let mut graph = CallGraph::new();

    // Collect all function blocks from every supported file.
    let mut all_blocks: Vec<Block> = Vec::new();

    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        if detect_language(path).is_none() {
            continue;
        }

        // Compute the path relative to `dir` for use as the node key prefix.
        let rel_path = path
            .strip_prefix(dir)
            .unwrap_or(path)
            .with_extension("")
            .to_string_lossy()
            .to_string();

        let code = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let language = match detect_language(path) {
            Some(l) => l,
            None => continue,
        };

        let mut parser = Parser::new();
        if parser.set_language(&language).is_err() {
            continue;
        }

        let tree = match parser.parse(&code, None) {
            Some(t) => t,
            None => continue,
        };

        let mut cursor = tree.root_node().walk();
        let mut file_blocks: Vec<Block> = Vec::new();

        traverse_tree(
            &code,
            &mut cursor,
            &mut file_blocks,
            &language,
            None,
            &rel_path,
        );

        // Add nodes for every function block found in this file.
        for block in &file_blocks {
            if block.block_type == BlockType::Function
                && let Some(ref fn_name) = block.function_name
            {
                let node = CallStackNode {
                    file_path: path
                        .strip_prefix(dir)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .to_string(),
                    class_name: block.class_name.clone(),
                    function_name: fn_name.clone(),
                };
                graph.add_node(block.node_key.clone(), node);
            }
        }

        all_blocks.extend(file_blocks);
    }

    // Add edges: for each function block, record its outgoing calls.
    for block in &all_blocks {
        for callee_key in &block.outgoing_calls {
            // Only add edges where the callee is a known node in the graph.
            if graph.nodes.contains_key(callee_key) {
                graph.add_edge(block.node_key.clone(), callee_key.clone());
            }
        }
    }

    let summary = graph.summary();
    (graph, summary)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.path().join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn test_parse_rust_two_functions_caller_callee() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "example.rs",
            r#"
fn helper() {
    println!("I am helper");
}

fn main() {
    helper();
}
"#,
        );

        let path = dir.path().join("example.rs");
        let blocks = parse_file(&path);

        // Should find both functions.
        let fn_names: Vec<Option<String>> =
            blocks.iter().map(|b| b.function_name.clone()).collect();
        assert!(
            fn_names.contains(&Some("main".to_string())),
            "Expected 'main' in blocks, got: {:?}",
            fn_names
        );
        assert!(
            fn_names.contains(&Some("helper".to_string())),
            "Expected 'helper' in blocks, got: {:?}",
            fn_names
        );

        // The 'main' block should have an outgoing call to helper.
        let main_block = blocks
            .iter()
            .find(|b| b.function_name == Some("main".to_string()))
            .expect("main block not found");

        assert!(
            !main_block.outgoing_calls.is_empty(),
            "main should have outgoing calls"
        );
    }

    #[test]
    fn test_analyze_directory_builds_graph() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "lib.rs",
            r#"
fn helper() {}

fn run() {
    helper();
}
"#,
        );

        let (_graph, summary) = analyze_directory(dir.path());

        assert_eq!(summary.total_functions, 2, "should find 2 functions");
        // 'run' calls 'helper', which is a known node → 1 edge
        assert_eq!(summary.total_edges, 1, "should find 1 edge");
    }

    #[test]
    fn test_entry_points_detected() {
        let dir = TempDir::new().unwrap();
        // 'run' calls 'helper'; 'run' itself is not called → it is an entry point.
        write_file(
            &dir,
            "app.rs",
            r#"
fn helper() {}

fn run() {
    helper();
}
"#,
        );

        let (_graph, summary) = analyze_directory(dir.path());

        // 'run' has no incoming edges → entry point.
        // 'helper' has one incoming edge from 'run' → not an entry point.
        assert!(
            summary.entry_points.iter().any(|k| k.contains("run")),
            "run should be an entry point, entry_points = {:?}",
            summary.entry_points
        );
        assert!(
            !summary.entry_points.iter().any(|k| k.contains("helper")),
            "helper should NOT be an entry point, entry_points = {:?}",
            summary.entry_points
        );
    }

    #[test]
    fn test_summary_generation() {
        let dir = TempDir::new().unwrap();
        write_file(
            &dir,
            "calc.rs",
            r#"
fn add(a: i32, b: i32) -> i32 { a + b }

fn main() {
    let _ = add(1, 2);
}
"#,
        );

        let (_graph, summary) = analyze_directory(dir.path());

        assert_eq!(summary.total_functions, 2);
        assert_eq!(summary.total_edges, 1);
        assert!(!summary.entry_points.is_empty());
    }
}
