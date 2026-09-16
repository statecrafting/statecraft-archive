// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use featuregraph::scanner::Scanner;
use serde_json::Value;
use std::fs;
use std::path::Path;

#[test]
fn test_golden_graph() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let repo_root = Path::new(&manifest_dir).parent().unwrap().parent().unwrap();

    // Ensure we are in the right repo. Accept the sharded registry tree
    // (`.derived/spec-registry/by-spec/`, the spec 217 post-collapse layout
    // the scanner actually reads), the legacy singular `registry.json`, or
    // the pre-compiler `spec/features.yaml`. Checking only the singular file
    // made this test silently skip after spec 217 (the file is no longer
    // emitted), so the golden gate was dormant; the scanner reads the shards.
    if !(repo_root.join(".derived/spec-registry/by-spec").is_dir()
        || repo_root
            .join(".derived/spec-registry/registry.json")
            .exists()
        || repo_root.join("spec/features.yaml").exists())
    {
        eprintln!(
            "Skipping golden test: registry not found at {:?}. Run spec compiler first.",
            repo_root
        );
        return;
    }

    let scanner = Scanner::new(repo_root);
    let graph = scanner.scan().expect("Failed to scan repo");

    let json_output = serde_json::to_string_pretty(&graph).expect("Failed to serialize graph");

    let golden_path = Path::new("tests/golden/features_graph.json");

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        fs::write(golden_path, json_output).expect("Failed to write golden file");
    } else {
        if !golden_path.exists() {
            eprintln!(
                "Skipping golden comparison: {:?} not found. Run with UPDATE_GOLDEN=1.",
                golden_path
            );
            return;
        }

        let golden_content = fs::read_to_string(golden_path).expect("Failed to read golden file");

        // Normalize line endings
        let expected: Value = serde_json::from_str(&golden_content).unwrap();
        let actual: Value = serde_json::from_str(&json_output).unwrap();

        assert_eq!(
            expected, actual,
            "Feature graph does not match golden file. Run UPDATE_GOLDEN=1 to update."
        );
    }
}
