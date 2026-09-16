//! Integration tests for `run_check` (spec 212 AC-1, AC-3, AC-4).
//!
//! Builds minimal but complete lockstep trees in tempdirs in-process (no
//! external repo dependency), then drives the public `run_check` entry point.
//! The compare-mode and guard *logic* is unit-tested in `src/lib.rs`; these
//! tests lock the file-walking orchestration, the Tier-B advisory behaviour,
//! and the "a Tier-B gap must not mask a real break" contract (AC-4).

use std::fs;
use std::path::Path;

use open_agentic_factory_schema_lockstep::run_check;

/// Every lockstep file (matching `lockstep_files()`), with minimal valid
/// content. Returns (relative_path, content).
fn baseline_files() -> Vec<(&'static str, String)> {
    vec![
        ("pipeline-state.schema.yaml", "schema_version: \"1.0.0\"\nstages: [s0, s1]\n".into()),
        ("verification.schema.yaml", "schema_version: \"1.0.0\"\nchecks: [build, test]\n".into()),
        ("build-spec.schema.yaml", "schema_version: \"1.1.0\"\nproject:\n  name: string\nauth:\n  audiences:\n    x:\n      provisioning_model:\n        enum: [admin-only, open-authenticated]\n".into()),
        ("adapter-manifest.schema.yaml", "schema_version: \"1.1.0\"\nadapter:\n  name: string\ndirectory_conventions:\n  api_service: string\ngovernance:\n  max_tier: string\n  agents_from: string\ndual_stack:\n  audience_to_variant:\n    citizen: string\n  variants:\n    public:\n      web: string\n".into()),
        ("stage-outputs/audiences.schema.json", "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\",\"description\":\"who\"}}}".into()),
        ("stage-outputs/business-rules.schema.json", "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}".into()),
        ("stage-outputs/entity-model.schema.json", "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}}".into()),
        ("stage-outputs/sitemap.schema.json", "{\"type\":\"object\",\"properties\":{\"page_type\":{\"enum\":[\"landing\",\"list\"]}}}".into()),
        ("stage-outputs/use-cases.schema.json", "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"}}}".into()),
    ]
}

fn write_tree(root: &Path, files: &[(&'static str, String)]) {
    for (rel, content) in files {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, content).unwrap();
    }
}

#[test]
fn aligned_trees_pass_with_tier_b_gap_advisory() {
    let oap = tempfile::tempdir().unwrap();
    let fac = tempfile::tempdir().unwrap();
    let base = baseline_files();
    write_tree(oap.path(), &base);
    write_tree(fac.path(), &base);
    // OAP carries the Tier-B governance-envelope; factory does not (the gap).
    fs::write(oap.path().join("governance-envelope.schema.yaml"), "schema_version: \"1.0.0\"\n").unwrap();

    let report = run_check(oap.path(), fac.path()).expect("run ok");
    assert!(!report.failed(), "aligned trees must pass: {:?}", report.divergences);
    assert_eq!(report.tier_b_gaps.len(), 1, "the governance-envelope gap is advisory");
    assert!(report.divergences.is_empty());
    assert!(report.guard_hits.is_empty());
}

#[test]
fn dropped_floor_field_fails_even_with_tier_b_gap_present() {
    // AC-4: a Tier-B gap must NOT mask a real break in the same run.
    let oap = tempfile::tempdir().unwrap();
    let fac = tempfile::tempdir().unwrap();
    let base = baseline_files();
    write_tree(oap.path(), &base);
    write_tree(fac.path(), &base);
    fs::write(oap.path().join("governance-envelope.schema.yaml"), "schema_version: \"1.0.0\"\n").unwrap();
    // Factory drops an OAP open-standard field from build-spec (floor break).
    fs::write(
        fac.path().join("build-spec.schema.yaml"),
        "schema_version: \"1.1.0\"\nproject:\n  name: string\nauth:\n  audiences:\n    x: {}\n",
    )
    .unwrap();

    let report = run_check(oap.path(), fac.path()).expect("run ok");
    assert!(report.failed(), "a dropped floor field must fail");
    assert!(
        report.divergences.iter().any(|d| d.file == "build-spec.schema.yaml" && d.path.contains("provisioning_model")),
        "divergence must name the dropped field: {:?}",
        report.divergences
    );
    assert_eq!(report.tier_b_gaps.len(), 1, "the gap is still reported, advisory");
}

#[test]
fn dual_stack_stack_model_drift_fails_through_run_check() {
    // Regression for the 2026-06-12 OPC adapter-load failure: dual_stack is a
    // contract-governed section of adapter-manifest (no longer excluded), so a
    // factory side still carrying the legacy stack model (audience_to_stack/
    // stacks instead of audience_to_variant/variants) must fail the full run.
    let oap = tempfile::tempdir().unwrap();
    let fac = tempfile::tempdir().unwrap();
    let base = baseline_files();
    write_tree(oap.path(), &base);
    write_tree(fac.path(), &base);
    fs::write(
        fac.path().join("adapter-manifest.schema.yaml"),
        "schema_version: \"1.1.0\"\nadapter:\n  name: string\ndirectory_conventions:\n  api_service: string\ngovernance:\n  max_tier: string\n  agents_from: string\ndual_stack:\n  audience_to_stack:\n    citizen: string\n  stacks:\n    public:\n      web: string\n",
    )
    .unwrap();

    let report = run_check(oap.path(), fac.path()).expect("run ok");
    assert!(report.failed(), "stack-model drift in dual_stack must fail");
    assert!(
        report.divergences.iter().any(|d| {
            d.file == "adapter-manifest.schema.yaml" && d.path.starts_with("dual_stack.")
        }),
        "divergence must name the dual_stack path: {:?}",
        report.divergences
    );
}

#[test]
fn goa_token_in_either_surface_fails() {
    // AC-3: a classification label introduced into a surface fails the guard.
    let oap = tempfile::tempdir().unwrap();
    let fac = tempfile::tempdir().unwrap();
    let base = baseline_files();
    write_tree(oap.path(), &base);
    write_tree(fac.path(), &base);
    // Inject a forbidden classification label as a real value on the factory side.
    fs::write(
        fac.path().join("adapter-manifest.schema.yaml"),
        "schema_version: \"1.1.0\"\nadapter:\n  name: string\nclassification:\n  enum: [Protected B]\ngovernance:\n  max_tier: string\n  agents_from: string\n",
    )
    .unwrap();

    let report = run_check(oap.path(), fac.path()).expect("run ok");
    assert!(report.failed(), "a GoA token must fail");
    assert!(report.guard_hits.iter().any(|h| h.token == "Protected B"), "{:?}", report.guard_hits);
}

#[test]
fn missing_factory_dir_is_operational_error_not_skipped_green() {
    // AC-6 posture: a missing factory tree fails operationally (exit 2), never green.
    let oap = tempfile::tempdir().unwrap();
    write_tree(oap.path(), &baseline_files());
    let err = run_check(oap.path(), Path::new("/nonexistent/factory/dir"));
    assert!(err.is_err(), "missing factory dir must be an operational error");
}
