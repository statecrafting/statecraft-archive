// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use std::path::Path;

/// Detects language from file path (extension based).
/// Returns explicit "Unknown" if not matched, or the canonical language name.
pub fn detect_language(path: &Path) -> String {
    // Special filenames
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        if name.eq_ignore_ascii_case("Dockerfile") {
            return "Dockerfile".to_string();
        }
        if name.eq_ignore_ascii_case("Makefile") {
            return "Makefile".to_string();
        }
    }

    // Extensions
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        match ext.to_lowercase().as_str() {
            "go" => "Go",
            "rs" => "Rust",
            "md" => "Markdown",
            "json" => "JSON",
            "js" => "JavaScript",
            "ts" => "TypeScript",
            "yaml" | "yml" => "YAML",
            "toml" => "TOML",
            "sh" | "bash" => "Shell",
            "html" | "htm" => "HTML",
            "css" => "CSS",
            "sql" => "SQL",
            "py" => "Python",
            "java" => "Java",
            "c" | "h" => "C",
            "cpp" | "hpp" | "cc" | "cxx" => "C++",
            "tf" => "Terraform",
            "txt" | "text" => "Text",

            _ => "Unknown", // LOCKED POLICY: Returns "Unknown".
                            // Aggregation logic MUST exclude "Unknown" from the "languages" map.
                            // This ensures the map only contains detected languages with high confidence.
        }
        .to_string()
    } else {
        "Unknown".to_string() // Policy: No extension = Unknown
    }
}
