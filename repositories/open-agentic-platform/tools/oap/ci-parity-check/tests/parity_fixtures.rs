//! Fixture-based integration tests for `check_parity` (spec 104 §5.2).
//!
//! The parity gate is the load-bearing contract that the Makefile mirrors
//! every enforcing workflow's `run:` block. If `check_parity` itself
//! drifted (false-negative on a divergent repo), the contract would lapse
//! silently. These tests exercise both the aligned and divergent shapes
//! against fixture trees so the detector keeps detecting.

use open_agentic_ci_parity_check::check_parity;
use std::fs;
use std::path::Path;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

#[test]
fn aligned_fixture_reports_no_drift() {
    let fixture = Path::new(FIXTURES).join("aligned");
    assert!(fixture.is_dir(), "missing fixture dir at {fixture:?}");
    let drifts = check_parity(&fixture).expect("check_parity should succeed");
    assert!(
        drifts.is_empty(),
        "aligned fixture must have zero drift, got: {drifts:?}",
    );
}

#[test]
fn divergent_fixture_reports_drift() {
    let fixture = Path::new(FIXTURES).join("divergent");
    assert!(fixture.is_dir(), "missing fixture dir at {fixture:?}");
    let drifts = check_parity(&fixture).expect("check_parity should succeed");
    assert!(
        !drifts.is_empty(),
        "divergent fixture must report at least one drift",
    );
    // Specifically, the manifest path the workflow expects must be missing.
    let manifest_drift = drifts.iter().find(|d| d.missing_token.contains("axiomregent"));
    assert!(
        manifest_drift.is_some(),
        "expected drift on `crates/axiomregent/Cargo.toml` token, got: {drifts:?}",
    );
}

/// Sanity: the fixture trees themselves are committed at the expected
/// shape. Catches accidental fixture drift (e.g. a future cleanup deleting
/// the Makefile in `aligned/`).
#[test]
fn fixture_trees_have_expected_files() {
    for variant in ["aligned", "divergent"] {
        let root = Path::new(FIXTURES).join(variant);
        for required in [
            "Makefile",
            ".github/workflows/ci-axiomregent.yml",
        ] {
            let p = root.join(required);
            assert!(
                fs::metadata(&p).is_ok(),
                "fixture {variant} missing required file {required}",
            );
        }
    }
}
