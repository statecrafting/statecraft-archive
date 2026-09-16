// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::path::Path;
use tree_sitter::{Language, Node, Parser};

unsafe extern "C" {
    fn tree_sitter_rust() -> Language;
    fn tree_sitter_python() -> Language;
    fn tree_sitter_javascript() -> Language;
}

/// Metrics extracted from structural analysis of a source file.
#[derive(Debug, Clone)]
pub struct StructureMetrics {
    /// Number of function/method definitions found
    pub functions: u32,
    /// Maximum nesting depth in the file
    pub max_depth: u32,
    /// Computed complexity score: functions * (1 + avg_depth)
    pub complexity: u64,
}

/// Analyze a file and return structural metrics.
/// Returns None if the file's language is unsupported or parsing fails.
pub fn analyze_file(path: &Path) -> Option<StructureMetrics> {
    let language = detect_language(path)?;
    let code = std::fs::read_to_string(path).ok()?;

    let mut parser = Parser::new();
    parser.set_language(&language).ok()?;
    let tree = parser.parse(&code, None)?;

    let root = tree.root_node();
    let mut functions = 0u32;
    let mut max_depth = 0u32;

    count_functions_and_depth(root, &language, 0, &mut functions, &mut max_depth);

    let complexity = if functions > 0 {
        (functions as u64) * (1 + max_depth as u64)
    } else {
        // For files with no functions, use depth alone as a minimal complexity signal
        max_depth as u64
    };

    Some(StructureMetrics {
        functions,
        max_depth,
        complexity,
    })
}

fn detect_language(path: &Path) -> Option<Language> {
    let ext = path.extension()?.to_str()?;
    match ext {
        "rs" => Some(unsafe { tree_sitter_rust() }),
        "py" => Some(unsafe { tree_sitter_python() }),
        "js" | "ts" => Some(unsafe { tree_sitter_javascript() }),
        _ => None,
    }
}

fn is_function_node(kind: &str, language: &Language) -> bool {
    let rust_lang = unsafe { tree_sitter_rust() };
    let python_lang = unsafe { tree_sitter_python() };
    let js_lang = unsafe { tree_sitter_javascript() };

    if *language == rust_lang {
        kind == "function_item" || kind == "impl_item"
    } else if *language == python_lang {
        kind == "function_definition"
    } else if *language == js_lang {
        kind == "function_declaration" || kind == "arrow_function" || kind == "method_definition"
    } else {
        false
    }
}

fn is_nesting_node(kind: &str) -> bool {
    matches!(
        kind,
        "if_expression"
            | "if_statement"
            | "if_let_expression"
            | "match_expression"
            | "match_statement"
            | "for_expression"
            | "for_statement"
            | "for_in_statement"
            | "while_expression"
            | "while_statement"
            | "loop_expression"
            | "try_expression"
            | "try_statement"
            | "with_statement"
            | "function_item"
            | "function_definition"
            | "function_declaration"
            | "arrow_function"
            | "method_definition"
            | "impl_item"
            | "class_definition"
            | "class_declaration"
            | "block"
            | "statement_block"
    )
}

fn count_functions_and_depth(
    node: Node,
    language: &Language,
    current_depth: u32,
    functions: &mut u32,
    max_depth: &mut u32,
) {
    if is_function_node(node.kind(), language) {
        *functions += 1;
    }

    let new_depth = if is_nesting_node(node.kind()) {
        current_depth + 1
    } else {
        current_depth
    };

    if new_depth > *max_depth {
        *max_depth = new_depth;
    }

    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            count_functions_and_depth(cursor.node(), language, new_depth, functions, max_depth);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_analyze_rust_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.rs");
        std::fs::write(&path, "fn main() {\n    if true {\n        for i in 0..10 {\n            println!(\"{}\", i);\n        }\n    }\n}\n\nfn helper() {}\n").unwrap();

        let metrics = analyze_file(&path).unwrap();
        assert_eq!(metrics.functions, 2);
        assert!(metrics.max_depth >= 3);
        assert!(metrics.complexity > 0);
    }

    #[test]
    fn test_analyze_python_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.py");
        std::fs::write(&path, "def main():\n    if True:\n        for i in range(10):\n            print(i)\n\ndef helper():\n    pass\n").unwrap();

        let metrics = analyze_file(&path).unwrap();
        assert_eq!(metrics.functions, 2);
        assert!(metrics.max_depth >= 2);
        assert!(metrics.complexity > 0);
    }

    #[test]
    fn test_analyze_unsupported_returns_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.txt");
        std::fs::write(&path, "hello").unwrap();
        assert!(analyze_file(&path).is_none());
    }
}
