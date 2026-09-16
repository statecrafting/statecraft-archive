//! Integration tests for spec-lint heuristics.

use open_agentic_spec_lint::{lint_feature_dir, lint_repo};
use std::fs;
use std::process::Command;

#[test]
fn w002_superseded_without_pointer() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w2-test");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w2-test"
title: "t"
status: superseded
created: "2026-03-22"
summary: "x"
---
# Body

No replacement here.
"#,
    )
    .unwrap();
    fs::write(feat.join("tasks.md"), "# T\n").unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(w.iter().any(|x| x.code == "W-002"));
}

#[test]
fn w002_superseded_with_frontmatter_pointer_ok() {
    // Spec 147 Phase 4: W-002 now checks frontmatter `superseded_by:`
    // rather than scanning the body for a backtick spec-id pointer.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w2-ok");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w2-ok"
title: "t"
status: superseded
superseded_by: "010-other-feature"
created: "2026-03-22"
summary: "x"
---
# Body
"#,
    )
    .unwrap();
    fs::write(feat.join("tasks.md"), "# T\n").unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(!w.iter().any(|x| x.code == "W-002"));
}

#[test]
fn w003_retired_with_frontmatter_rationale_ok() {
    // Spec 147 Phase 4: W-003 now checks frontmatter
    // `retirement_rationale:` rather than scanning the body.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w3-ok");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w3-ok"
title: "t"
status: retired
retirement_rationale:
  reason: obsolete
  summary: "feature absorbed into newer spec"
created: "2026-03-22"
summary: "x"
---
# Body
"#,
    )
    .unwrap();
    fs::write(feat.join("tasks.md"), "# T\n").unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(!w.iter().any(|x| x.code == "W-003"));
}

#[test]
fn w003_retired_without_frontmatter_rationale_fires() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w3-test");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w3-test"
title: "t"
status: retired
created: "2026-03-22"
summary: "x"
---
# Body — has retirement rationale in prose, but no frontmatter field.

This spec is retired because of obsolescence.
"#,
    )
    .unwrap();
    fs::write(feat.join("tasks.md"), "# T\n").unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(w.iter().any(|x| x.code == "W-003"));
}

#[test]
fn w006_non_canonical_status() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w6-test");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w6-test"
title: "t"
status: implemented
created: "2026-03-22"
summary: "x"
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(w.iter().any(|x| x.code == "W-006"));
}

#[test]
fn w006_canonical_status_ok() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    for status in &["draft", "approved", "superseded", "retired"] {
        let slug = format!("099-w6-{}", status);
        let feat = root.join(format!("specs/{}", slug));
        fs::create_dir_all(&feat).unwrap();
        fs::write(
            feat.join("spec.md"),
            format!(
                r#"---
id: "{slug}"
title: "t"
status: {status}
created: "2026-03-22"
summary: "x"
---
# Body

Superseded by `000-bootstrap-spec-system`. Retirement rationale noted.
"#
            ),
        )
        .unwrap();

        let w = lint_feature_dir(root, &feat);
        assert!(
            !w.iter().any(|x| x.code == "W-006"),
            "canonical status '{}' should not trigger W-006",
            status
        );
    }
}

#[test]
fn w007_non_canonical_implementation() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-w7-test");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-w7-test"
title: "t"
status: draft
implementation: done
created: "2026-03-22"
summary: "x"
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(w.iter().any(|x| x.code == "W-007"));
}

#[test]
fn w007_canonical_implementation_ok() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    for imp in &["pending", "in-progress", "complete", "n/a", "deferred"] {
        let slug = format!("099-w7-{}", imp.replace('/', "-"));
        let feat = root.join(format!("specs/{}", slug));
        fs::create_dir_all(&feat).unwrap();
        fs::write(
            feat.join("spec.md"),
            format!(
                r#"---
id: "{slug}"
title: "t"
status: draft
implementation: {imp}
created: "2026-03-22"
summary: "x"
---
# Body
"#
            ),
        )
        .unwrap();

        let w = lint_feature_dir(root, &feat);
        assert!(
            !w.iter().any(|x| x.code == "W-007"),
            "canonical implementation '{}' should not trigger W-007",
            imp
        );
    }
}

// ─── V-020 (spec 130) — relationship-field emission gate ───

#[test]
fn v020_fires_when_no_relationship_fields_and_no_retroactive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-v20-bare");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-v20-bare"
title: "t"
status: draft
created: "2026-03-22"
summary: "x"
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(
        w.iter().any(|x| x.code == "V-020"),
        "V-020 must fire on a spec with no relationship fields and no `origin: retroactive: true`"
    );
}

#[test]
fn v020_silent_when_origin_retroactive() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-v20-retro");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-v20-retro"
title: "t"
status: draft
created: "2026-03-22"
summary: "x"
origin:
  retroactive: true
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "V-020"),
        "V-020 must NOT fire on `origin: retroactive: true` bootstrap specs"
    );
}

#[test]
fn v020_silent_when_extends_present() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-v20-extends");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-v20-extends"
title: "t"
status: draft
created: "2026-03-22"
summary: "x"
extends:
  - spec: "001-spec-compiler-mvp"
    paths:
      - tools/spec-compiler/src/lib.rs
    nature: additive
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "V-020"),
        "V-020 must NOT fire when `extends:` is declared"
    );
}

#[test]
fn v020_silent_when_establishes_present() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/099-v20-establishes");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "099-v20-establishes"
title: "t"
status: draft
created: "2026-03-22"
summary: "x"
establishes:
  - tools/spec-compiler/src/lib.rs
---
# Body
"#,
    )
    .unwrap();

    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "V-020"),
        "V-020 must NOT fire when `establishes:` is declared"
    );
}

// ─────────────────────────────────────────────────────────────────────
// Spec 154 — L-005 advisory soft lint
// ─────────────────────────────────────────────────────────────────────

fn write_workspace(root: &std::path::Path, members: &[(&str, &str)]) {
    let toml_members = members
        .iter()
        .map(|(dir, _)| format!("    {dir:?},"))
        .collect::<Vec<_>>()
        .join("\n");
    let manifest = format!(
        "[workspace]\nresolver = \"2\"\nmembers = [\n{toml_members}\n]\n"
    );
    fs::write(root.join("Cargo.toml"), manifest).unwrap();
    for (dir, name) in members {
        let crate_root = root.join(dir);
        fs::create_dir_all(crate_root.join("src")).unwrap();
        let member_manifest = format!(
            "[package]\nname = \"{name}\"\nversion = \"0.0.0\"\nedition = \"2024\"\n\n[lib]\npath = \"src/lib.rs\"\n"
        );
        fs::write(crate_root.join("Cargo.toml"), member_manifest).unwrap();
        fs::write(crate_root.join("src/lib.rs"), "// fixture\n").unwrap();
    }
}

#[test]
fn l005_fires_on_legacy_path_inside_workspace_member() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_workspace(root, &[("crates/foo", "foo-crate")]);
    let feat = root.join("specs/810-legacy-crate-path");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "810-legacy-crate-path"
title: "t"
status: draft
created: "2026-05-21"
summary: "L-005 fixture"
establishes:
  - "crates/foo/src/lib.rs"
---
# Body
"#,
    )
    .unwrap();
    let w = lint_repo(root);
    let l005: Vec<_> = w.iter().filter(|x| x.code == "L-005").collect();
    assert_eq!(l005.len(), 1, "expected one L-005, got: {:?}", w);
    // Spec 154 Segment 6: L-005 severity promoted info → error in
    // lockstep with the bare-string parse-arm excision.
    assert_eq!(l005[0].severity, "error");
    assert!(l005[0].message.contains("crates/foo"));
}

#[test]
fn l005_silent_on_legitimate_file_unit() {
    // Files outside any workspace member (e.g. root-level `deny.toml`,
    // `Makefile`) should NOT trigger L-005 — they are legitimate
    // `file:` cases.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_workspace(root, &[("crates/foo", "foo-crate")]);
    let feat = root.join("specs/811-legitimate-file");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "811-legitimate-file"
title: "t"
status: draft
created: "2026-05-21"
summary: "L-005 negative fixture"
establishes:
  - "Makefile"
  - "deny.toml"
  - "standards/schemas/spec-spine/registry.schema.json"
---
# Body
"#,
    )
    .unwrap();
    let w = lint_repo(root);
    assert!(
        !w.iter().any(|x| x.code == "L-005"),
        "L-005 must NOT fire on paths outside workspace members: {:?}",
        w
    );
}

#[test]
fn l005_silent_on_explicit_unit_declarations() {
    // When the author uses the new `unit:` form, L-005 doesn't nudge
    // — the path is already typed.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write_workspace(root, &[("crates/foo", "foo-crate")]);
    let feat = root.join("specs/812-already-typed");
    fs::create_dir_all(&feat).unwrap();
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "812-already-typed"
title: "t"
status: draft
created: "2026-05-21"
summary: "L-005 typed fixture"
establishes:
  - unit: { kind: crate, id: foo-crate }
---
# Body
"#,
    )
    .unwrap();
    let w = lint_repo(root);
    assert!(
        !w.iter().any(|x| x.code == "L-005"),
        "L-005 must NOT fire on explicit unit declarations: {:?}",
        w
    );
}

// ─────────────────────────────────────────────────────────────────────
// Spec 161 — W-161 decomposition-origin role reservation
// ─────────────────────────────────────────────────────────────────────

fn write_minimal_spec(root: &std::path::Path, id: &str, references_yaml: &str) -> std::path::PathBuf {
    let feat = root.join(format!("specs/{id}"));
    fs::create_dir_all(&feat).unwrap();
    let body = format!(
        r#"---
id: "{id}"
title: "t"
status: draft
created: "2026-05-22"
summary: "spec 161 fixture"
{references_yaml}
---
# Body
"#
    );
    fs::write(feat.join("spec.md"), body).unwrap();
    feat
}

#[test]
fn w161_happy_path_knowledge_provenance_with_derived_at() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
    provenance:
      kind: knowledge
      ref: "statecraft://project/00000000-0000-0000-0000-000000000001/knowledge/00000000-0000-0000-0000-000000000002"
      derived_at: "2026-05-22T10:30:00Z"
"#;
    let feat = write_minimal_spec(root, "900-w161-ok", refs);
    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "W-161"),
        "W-161 must NOT fire on well-formed decomposition-origin entry: {:?}",
        w
    );
}

#[test]
fn w161_happy_path_code_fingerprint_with_date_only_derived_at() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
    provenance:
      kind: code-fingerprint
      ref: "xray-fingerprint://e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      derived_at: "2026-05-22"
"#;
    let feat = write_minimal_spec(root, "901-w161-fp-ok", refs);
    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "W-161"),
        "W-161 must NOT fire on code-fingerprint decomposition-origin entry with date-only derived_at: {:?}",
        w
    );
}

#[test]
fn w161_missing_provenance_is_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
"#;
    let feat = write_minimal_spec(root, "902-w161-missing-prov", refs);
    let w = lint_feature_dir(root, &feat);
    let hits: Vec<&_> = w.iter().filter(|x| x.code == "W-161").collect();
    assert_eq!(hits.len(), 1, "expected exactly one W-161 hit: {:?}", w);
    assert_eq!(hits[0].severity, "error");
    assert!(
        hits[0].message.contains("provenance:"),
        "message should name the missing field: {:?}",
        hits[0].message
    );
}

#[test]
fn w161_unit_arm_with_reserved_role_is_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
"#;
    let feat = write_minimal_spec(root, "903-w161-unit-arm", refs);
    let w = lint_feature_dir(root, &feat);
    let hits: Vec<&_> = w.iter().filter(|x| x.code == "W-161").collect();
    assert_eq!(hits.len(), 1, "expected exactly one W-161 hit: {:?}", w);
    assert_eq!(hits[0].severity, "error");
    assert!(
        hits[0].message.contains("unit:"),
        "message should name the disallowed arm: {:?}",
        hits[0].message
    );
}

#[test]
fn w161_missing_derived_at_is_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
    provenance:
      kind: knowledge
      ref: "statecraft://project/00000000-0000-0000-0000-000000000001/knowledge/00000000-0000-0000-0000-000000000002"
"#;
    let feat = write_minimal_spec(root, "904-w161-no-date", refs);
    let w = lint_feature_dir(root, &feat);
    let hits: Vec<&_> = w.iter().filter(|x| x.code == "W-161").collect();
    assert_eq!(hits.len(), 1, "expected exactly one W-161 hit: {:?}", w);
    assert_eq!(hits[0].severity, "error");
    assert!(
        hits[0].message.contains("derived_at"),
        "message should name the missing field: {:?}",
        hits[0].message
    );
}

#[test]
fn w161_malformed_derived_at_is_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
    provenance:
      kind: knowledge
      ref: "statecraft://project/00000000-0000-0000-0000-000000000001/knowledge/00000000-0000-0000-0000-000000000002"
      derived_at: "yesterday"
"#;
    let feat = write_minimal_spec(root, "905-w161-bad-date", refs);
    let w = lint_feature_dir(root, &feat);
    let hits: Vec<&_> = w.iter().filter(|x| x.code == "W-161").collect();
    assert_eq!(hits.len(), 1, "expected exactly one W-161 hit: {:?}", w);
    assert_eq!(hits[0].severity, "error");
    assert!(
        hits[0].message.contains("ISO-8601"),
        "message should reference ISO-8601: {:?}",
        hits[0].message
    );
}

#[test]
fn w161_other_role_with_unit_arm_does_not_fire_sc003() {
    // SC-003: hand-authored specs with `references:` entries that do
    // NOT carry `role: decomposition-origin` are unaffected by W-161,
    // regardless of whether they use the `unit:` or `provenance:` arm.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: precedent
    unit: { kind: file, path: docs/ARCHITECTURE.md }
  - role: derivation
    provenance:
      kind: knowledge
      ref: "statecraft://project/00000000-0000-0000-0000-000000000001/knowledge/00000000-0000-0000-0000-000000000002"
"#;
    let feat = write_minimal_spec(root, "906-w161-other-roles", refs);
    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "W-161"),
        "W-161 must only fire on `role: decomposition-origin` entries (SC-003): {:?}",
        w
    );
}

#[test]
fn w161_error_tier_fails_binary_without_fail_on_warn() {
    // Spec 161 §2.3 / SC-004: `error`-tier diagnostics fail spec-lint
    // unconditionally. The binary must exit non-zero on a W-161 hit
    // even when --fail-on-warn is absent.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let refs = r#"references:
  - role: decomposition-origin
"#;
    write_minimal_spec(root, "910-w161-bin-error", refs);

    let bin = env!("CARGO_BIN_EXE_spec-lint");
    let output = Command::new(bin)
        .arg("--repo")
        .arg(root)
        .output()
        .expect("spawn spec-lint");
    assert!(
        !output.status.success(),
        "spec-lint must exit non-zero on W-161 error tier; stderr was:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("W-161"),
        "stderr should mention W-161; got:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn warning_tier_alone_does_not_fail_binary_without_fail_on_warn() {
    // Companion to the error-tier test above: a spec that emits only
    // warning-tier diagnostics (e.g. V-020 — missing relationship
    // fields) must NOT fail the binary unless --fail-on-warn is set.
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let feat = root.join("specs/911-warn-only");
    fs::create_dir_all(&feat).unwrap();
    // Spec has no relationship fields and no retroactive marker — emits
    // V-020 at warning tier.
    fs::write(
        feat.join("spec.md"),
        r#"---
id: "911-warn-only"
title: "t"
status: draft
created: "2026-05-22"
summary: "warning-tier-only fixture"
---
# Body
"#,
    )
    .unwrap();

    let bin = env!("CARGO_BIN_EXE_spec-lint");
    let output = Command::new(bin)
        .arg("--repo")
        .arg(root)
        .output()
        .expect("spawn spec-lint");
    assert!(
        output.status.success(),
        "spec-lint must exit zero on warning-tier-only diagnostics without --fail-on-warn; stderr was:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn w161_no_references_field_does_not_fire() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    // Spec with no references field at all — common shape for early
    // bootstrap or self-contained specs. Must not trigger W-161.
    let feat = write_minimal_spec(
        root,
        "907-w161-no-refs",
        "establishes:\n  - unit: { kind: file, path: docs/example.md }",
    );
    let w = lint_feature_dir(root, &feat);
    assert!(
        !w.iter().any(|x| x.code == "W-161"),
        "W-161 must not fire on specs without a `references:` field: {:?}",
        w
    );
}
