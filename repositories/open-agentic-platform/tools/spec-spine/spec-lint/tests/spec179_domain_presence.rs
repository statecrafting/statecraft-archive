//! Spec 179 — `domain:` presence (V-031) and enum-membership (V-030)
//! emission from spec-lint.

use open_agentic_spec_lint::lint_feature_dir;
use std::fs;

fn write_spec(feat: &std::path::Path, fm_body: &str) {
    fs::create_dir_all(feat).unwrap();
    let id = feat.file_name().unwrap().to_str().unwrap();
    fs::write(
        feat.join("spec.md"),
        format!(
            r#"---
id: "{id}"
title: "Fixture for {id}"
status: draft
created: "2026-05-24"
summary: "Spec 179 domain-presence fixture."
{fm_body}---
# Body

Test fixture.
"#
        ),
    )
    .unwrap();
    fs::write(feat.join("tasks.md"), "# T\n").unwrap();
}

#[test]
fn v031_fires_when_domain_absent() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/833-no-domain");
    write_spec(&feat, "");
    let w = lint_feature_dir(root, &feat);
    let v031 = w.iter().filter(|x| x.code == "V-031").collect::<Vec<_>>();
    assert_eq!(v031.len(), 1, "V-031 should fire exactly once");
    assert_eq!(v031[0].severity, "warning");
}

#[test]
fn v031_silent_when_domain_present_and_valid() {
    for value in ["opc", "platform", "substrate", "tooling"] {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let feat = root.join(format!("specs/834-{value}-domain"));
        write_spec(&feat, &format!("domain: {value}\n"));
        let w = lint_feature_dir(root, &feat);
        assert!(
            !w.iter().any(|x| x.code == "V-031"),
            "V-031 must not fire when domain={value:?} is present"
        );
        assert!(
            !w.iter().any(|x| x.code == "V-030"),
            "V-030 must not fire for valid domain={value:?}"
        );
    }
}

#[test]
fn v030_fires_at_error_severity_on_invalid_domain() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/835-bad-domain");
    write_spec(&feat, "domain: cockpit\n");
    let w = lint_feature_dir(root, &feat);
    let v030 = w.iter().filter(|x| x.code == "V-030").collect::<Vec<_>>();
    assert_eq!(v030.len(), 1, "V-030 must fire on invalid domain value");
    assert_eq!(v030[0].severity, "error");
    // V-031 must not piggyback when the field is present-but-invalid;
    // the user gets one diagnostic on the value's content, not two.
    assert!(!w.iter().any(|x| x.code == "V-031"));
}

#[test]
fn v030_fires_on_non_string_domain_value() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/836-list-domain");
    write_spec(&feat, "domain: [opc, platform]\n");
    let w = lint_feature_dir(root, &feat);
    assert!(
        w.iter().any(|x| x.code == "V-030" && x.severity == "error"),
        "V-030 must reject non-string domain shapes at this version"
    );
}
