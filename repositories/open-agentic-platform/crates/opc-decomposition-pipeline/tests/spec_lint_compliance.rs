// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — SC-002
//
// SC-002 says every emitted draft spec must pass spec-lint at
// warning severity or better — concretely, no `error`-tier diagnostics
// (e.g. W-161 from the spec 161 emission contract).
//
// We run the pipeline against a fixture project, lift the emitted
// spec.md files into a synthetic repo layout at
// `<tmp>/specs/<slug>/spec.md`, and invoke `lint_repo` directly to
// avoid taking a hard dependency on a pre-built binary path.

use std::fs;
use std::path::Path;

use opc_decomposition_pipeline::{PipelineConfig, PipelineRunner};

fn fixture_project(root: &Path) {
    let crates_a = root.join("crates").join("alpha");
    let tools = root.join("tools");
    fs::create_dir_all(&crates_a).unwrap();
    fs::create_dir_all(&tools).unwrap();
    fs::write(crates_a.join("lib.rs"), "fn alpha(){}\n").unwrap();
    fs::write(tools.join("main.rs"), "fn main(){}\n").unwrap();
}

#[test]
fn emitted_specs_pass_spec_lint() {
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());
    let output_root = project.path().join(".opc").join("decomposition");
    let cfg = PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: None,
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };
    let run = PipelineRunner::new(cfg).run().unwrap();
    assert!(!run.emitted_specs.is_empty());

    // Lift the emitted spec.md files into a synthetic repo layout
    // (`<tmp>/specs/<slug>/spec.md`) so lint_repo sees them.
    let repo = tempfile::tempdir().unwrap();
    let specs = repo.path().join("specs");
    fs::create_dir_all(&specs).unwrap();

    let synthesis_root = output_root.join(run.run_id.as_str()).join("s6-synthesis");
    for r in &run.emitted_specs {
        let src = synthesis_root.join(&r.relpath);
        // r.relpath = specs/<slug>/spec.md (relative to s6-synthesis).
        let dest_dir = specs.join(&r.slug);
        fs::create_dir_all(&dest_dir).unwrap();
        fs::copy(&src, dest_dir.join("spec.md")).unwrap();
    }

    let diagnostics = open_agentic_spec_lint::lint_repo(repo.path());
    let errors: Vec<_> = diagnostics
        .iter()
        .filter(|d| d.severity == "error")
        .collect();
    assert!(
        errors.is_empty(),
        "emitted specs hit error-tier diagnostics: {errors:?}",
    );
}
