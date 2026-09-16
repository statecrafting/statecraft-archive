//! Factory Build Spec discovery / indexing integration tests
//! (spec 074 FR-007 + spec 102 compliance overlay).
//!
//! Cut D W-06c: moved from `tools/spec-compiler/tests/factory_projects.rs`
//! when factoryProjects + per-feature compliance emission moved out of
//! the generic spec compiler. The end-to-end check now exercises
//! `oap-registry-enrich`'s walk over `.factory/build-spec.yaml` files
//! and asserts on `build/spec-registry/registry-oap.json`, the new
//! authoritative home for OAP-specific overlays.

use open_agentic_registry_enrich::{enrich_and_write, parse_factory_project};
use serde_json::Value;
use std::fs;

fn write_minimal_registry(repo: &std::path::Path) {
    // Spec 217 engine swap: the committed registry is the sharded `by-spec` tree,
    // not a monolithic registry.json. These tests exercise the factoryProjects
    // walk with an empty feature set, so an empty `by-spec` dir suffices (the
    // library reader requires only that the directory exists).
    fs::create_dir_all(repo.join(".derived/spec-registry/by-spec")).unwrap();
}

/// When a `.factory/build-spec.yaml` exists, the enricher emits a
/// `factoryProjects` array in registry-oap.json.
#[test]
fn factory_project_indexed_in_registry_oap_json() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    write_minimal_registry(root);

    let factory_dir = root.join("projects/my-app/.factory");
    fs::create_dir_all(&factory_dir).unwrap();
    fs::write(
        factory_dir.join("build-spec.yaml"),
        "project:\n  name: my-app\n  variant: dual\n  org: acme\n",
    )
    .unwrap();

    let oap_path = enrich_and_write(root).expect("enricher succeeds");
    let raw = fs::read_to_string(&oap_path).unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();

    let factory_projects = v["factoryProjects"]
        .as_array()
        .expect("factoryProjects should be an array");
    assert_eq!(factory_projects.len(), 1);

    let proj = &factory_projects[0];
    assert_eq!(proj["projectName"], "my-app");
    assert_eq!(proj["variant"], "dual");
    assert_eq!(proj["org"], "acme");
    assert_eq!(
        proj["buildSpecPath"],
        "projects/my-app/.factory/build-spec.yaml"
    );
    let hash = proj["contentHash"].as_str().unwrap();
    assert_eq!(hash.len(), 64);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
}

/// When no `.factory/build-spec.yaml` exists, `factoryProjects` is
/// absent from registry-oap.json (opt-in semantics, same as
/// pre-Cut D spec-compiler behaviour).
#[test]
fn factory_projects_absent_when_no_build_specs() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_minimal_registry(root);

    let oap_path = enrich_and_write(root).unwrap();
    let raw = fs::read_to_string(&oap_path).unwrap();
    let v: Value = serde_json::from_str(&raw).unwrap();

    assert!(
        v.get("factoryProjects").is_none(),
        "factoryProjects should be absent when no build specs exist"
    );
}

/// A malformed build spec (missing project.name) is silently skipped
/// by the enricher.
///
/// Pre-Cut D the spec-compiler emitted V-010 warnings for malformed
/// factory build specs; W-06c removes that violation surface from the
/// generic compiler. The enricher inherits the "skip silently" path
/// because V-codes are spec-compiler's domain, not the enricher's.
#[test]
fn malformed_build_spec_is_silently_skipped() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_minimal_registry(root);

    let factory_dir = root.join(".factory");
    fs::create_dir_all(&factory_dir).unwrap();
    fs::write(
        factory_dir.join("build-spec.yaml"),
        "project:\n  description: missing name\n",
    )
    .unwrap();

    let oap_path = enrich_and_write(root).expect("enricher succeeds");
    let v: Value = serde_json::from_str(&fs::read_to_string(&oap_path).unwrap()).unwrap();
    // factoryProjects should be absent (the only build spec was malformed).
    assert!(v.get("factoryProjects").is_none());
}

/// Pipeline state sibling enriches the factory project record with
/// adapter and status (carries through `pipeline-state.json`).
#[test]
fn pipeline_state_enriches_factory_project() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_minimal_registry(root);

    let factory_dir = root.join("app/.factory");
    fs::create_dir_all(&factory_dir).unwrap();
    fs::write(
        factory_dir.join("build-spec.yaml"),
        "project:\n  name: enriched-app\n  variant: single-internal\n",
    )
    .unwrap();
    fs::write(
        factory_dir.join("pipeline-state.json"),
        r#"{"adapter": "encore-react", "status": "completed"}"#,
    )
    .unwrap();

    let oap_path = enrich_and_write(root).expect("enricher succeeds");
    let v: Value = serde_json::from_str(&fs::read_to_string(&oap_path).unwrap()).unwrap();
    let projects = v["factoryProjects"].as_array().unwrap();
    assert_eq!(projects.len(), 1);

    let proj = &projects[0];
    assert_eq!(proj["projectName"], "enriched-app");
    assert_eq!(proj["adapter"], "encore-react");
    assert_eq!(proj["pipelineStatus"], "completed");
}

/// parse_factory_project's content-hash discipline: 64-char lowercase
/// hex, deterministic per (path, normalized-content) input. Carried
/// over from the spec-compiler unit test removed in W-06c.
#[test]
fn parse_factory_project_extracts_fields_directly() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let factory_dir = root.join("myproject/.factory");
    fs::create_dir_all(&factory_dir).unwrap();
    fs::write(
        factory_dir.join("build-spec.yaml"),
        "project:\n  name: my-app\n  variant: dual\n  org: acme\n",
    )
    .unwrap();

    let record = parse_factory_project(root, &factory_dir.join("build-spec.yaml"))
        .unwrap()
        .expect("should parse");
    assert_eq!(record.project_name, "my-app");
    assert_eq!(record.variant.as_deref(), Some("dual"));
    assert_eq!(record.org.as_deref(), Some("acme"));
    assert_eq!(record.content_hash.len(), 64);
}
