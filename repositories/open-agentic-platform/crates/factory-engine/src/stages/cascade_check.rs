// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-032 to FR-034

//! Cross-stage cascade check for spec 121.
//!
//! Stage 4 (DDL / data model) and Stage 5 (UI / tests) MUST NOT emit
//! artifacts whose origin claim is `Assumption` or `AssumptionOrphaned`
//! (FR-032, FR-033). The validator records each such claim's external-
//! entity surface forms in `assumption-only-manifest.md`. This module
//! greps the post-emission generated-artifact directory for those
//! surface forms; any reference outside `pending-promotion.md` is a
//! `CascadeViolation` that FAILs the stage.
//!
//! Match key is the claim's `anchor_hash`, NOT its literal `KIND-NNN`
//! string — a renumber must NOT silently revive emission.
//!
//! ## Generated artifact directory convention
//!
//! Phase 5 establishes `<project>/.artifacts/generated/<stage-id>/` as
//! the path Stage 4 / Stage 5 emit into. The cascade check walks the
//! whole `.artifacts/generated/` tree.

use factory_contracts::provenance::{AnchorHash, ClaimId};
use provenance_validator::parse_assumption_manifest;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Extensions the cascade check scans for vendor surface-form
/// references. Binary or unknown extensions are skipped (the substring
/// scan is meaningless on non-text files).
const SCANNED_EXTENSIONS: &[&str] = &[
    "sql", "ts", "tsx", "vue", "prisma", "rs", "json", "yaml", "yml",
    "js", "jsx", "py", "go", "java", "kt", "html", "css", "scss",
];

/// One cascade-check violation: a generated-artifact file references a
/// surface form recorded against an `Assumption`-tagged claim's anchor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeViolation {
    pub anchor_hash: AnchorHash,
    pub claim_id: ClaimId,
    pub surface_form: String,
    pub offending_file: PathBuf,
    pub line_number: u32,
}

#[derive(Debug, Error)]
pub enum CascadeCheckError {
    #[error("io error reading manifest at {0}: {1}")]
    Io(PathBuf, std::io::Error),
}

/// Outcome of a cascade scan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CascadeCheckOutcome {
    /// No assumption-only-manifest.md present, OR it has zero
    /// `Assumption` entries → fail-soft "nothing to verify".
    NothingToVerify,
    /// The scan completed and found no violations.
    Clean,
    /// One or more generated-artifact references to assumption surface
    /// forms exist outside `pending-promotion.md`.
    Violations(Vec<CascadeViolation>),
}

/// FR-034: scan `generated_dir` for any reference to an `Assumption`
/// claim's surface form recorded in `manifest_path`. The
/// `pending_promotion_path` (always `pending-promotion.md` next to the
/// manifest) is excluded from the scan because it's the explicit place
/// the spec parks would-have-been-emitted records.
///
/// Returns `NothingToVerify` if the manifest is absent or empty —
/// projects without ASSUMPTION claims have nothing to gate.
pub fn check_assumption_only_cascade(
    generated_dir: &Path,
    manifest_path: &Path,
    pending_promotion_path: &Path,
) -> Result<CascadeCheckOutcome, CascadeCheckError> {
    if !manifest_path.exists() {
        return Ok(CascadeCheckOutcome::NothingToVerify);
    }
    let body = std::fs::read_to_string(manifest_path).map_err(|e| {
        CascadeCheckError::Io(manifest_path.to_path_buf(), e)
    })?;
    let entries = parse_assumption_manifest(&body);
    if entries.is_empty() || entries.iter().all(|e| e.surface_forms.is_empty())
    {
        return Ok(CascadeCheckOutcome::NothingToVerify);
    }

    if !generated_dir.exists() {
        // No generated artifacts to scan; vacuously clean.
        return Ok(CascadeCheckOutcome::Clean);
    }

    // Build the exclusion set of canonical paths.
    let manifest_canon = canonicalize_or_self(manifest_path);
    let promotion_canon = canonicalize_or_self(pending_promotion_path);
    let exclude = |p: &Path| -> bool {
        let canon = canonicalize_or_self(p);
        canon == manifest_canon || canon == promotion_canon
    };

    // Walk the generated tree.
    let candidate_files = collect_scannable_files(generated_dir);
    let mut violations: Vec<CascadeViolation> = Vec::new();

    for path in candidate_files {
        if exclude(&path) {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue, // skip undecodable / binary files
        };
        let lower = content.to_lowercase();
        for entry in &entries {
            for form in &entry.surface_forms {
                if form.is_empty() {
                    continue;
                }
                let needle = form.to_lowercase();
                let mut search_from = 0usize;
                while let Some(pos) = lower[search_from..].find(&needle) {
                    let abs_pos = search_from + pos;
                    let line_number = lower[..abs_pos]
                        .bytes()
                        .filter(|b| *b == b'\n')
                        .count() as u32
                        + 1;
                    violations.push(CascadeViolation {
                        anchor_hash: entry.anchor_hash.clone(),
                        claim_id: entry.id.clone(),
                        surface_form: form.clone(),
                        offending_file: path.clone(),
                        line_number,
                    });
                    search_from = abs_pos + needle.len();
                }
            }
        }
    }

    // Determinism: sort the violations.
    violations.sort_by(|a, b| {
        (
            &a.offending_file,
            a.line_number,
            &a.anchor_hash,
            &a.surface_form,
        )
            .cmp(&(
                &b.offending_file,
                b.line_number,
                &b.anchor_hash,
                &b.surface_form,
            ))
    });
    violations.dedup();

    if violations.is_empty() {
        Ok(CascadeCheckOutcome::Clean)
    } else {
        Ok(CascadeCheckOutcome::Violations(violations))
    }
}

fn canonicalize_or_self(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn collect_scannable_files(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if !root.is_dir() {
        return out;
    }
    walk_dir(root, &mut out);
    out.sort();
    out
}

fn walk_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_dir(&path, out);
        } else if let Some(ext) = path.extension().and_then(|s| s.to_str())
            && SCANNED_EXTENSIONS.contains(&ext)
        {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use factory_contracts::provenance::{
        AssumptionTag, Claim, ClaimKind, ProvenanceMode,
    };
    use provenance_validator::{
        emit_assumption_manifest, ClaimRecord, ValidationReport,
        ValidationSummary,
    };

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap()
    }

    fn assumption_claim(
        id: &str,
        anchor: &str,
        candidates: Vec<String>,
    ) -> (Claim, ClaimRecord) {
        let claim = Claim {
            id: ClaimId(id.into()),
            kind: ClaimKind::Int,
            stage: 1,
            minted_at: now(),
            text: candidates.join(" "),
            anchor_hash: AnchorHash(anchor.into()),
            provenance_mode: ProvenanceMode::Derived,
            citations: vec![],
            assumption: Some(AssumptionTag {
                owner: "ops".into(),
                rationale: "x".into(),
                expires_at: Utc.with_ymd_and_hms(2026, 7, 30, 0, 0, 0).unwrap(),
                tagged_at: now(),
            }),
            names_external_entity: true,
            extracted_entity_candidates: candidates.clone(),
            candidate_promotion: None,
        };
        let record = ClaimRecord {
            id: ClaimId(id.into()),
            kind: ClaimKind::Int,
            anchor_hash: AnchorHash(anchor.into()),
            provenance_mode: ProvenanceMode::Assumption,
            names_external_entity: true,
            extracted_entity_candidates: candidates,
            entity_search: vec![],
        };
        (claim, record)
    }

    fn build_manifest_at(
        dir: &Path,
        records: Vec<ClaimRecord>,
        claims: Vec<Claim>,
    ) {
        let report = ValidationReport {
            schema_version: "1.0.0".into(),
            provenance_schema_version: "1.0.0".into(),
            validator_version: "0.1.0".into(),
            extracted_corpus_hash: "0".repeat(64),
            allowlist_version_hash: "0".repeat(64),
            claims: records,
            summary: ValidationSummary::default(),
            panic_reason: None,
        };
        emit_assumption_manifest(&report, &claims, dir).unwrap();
    }

    #[test]
    fn nothing_to_verify_when_no_manifest() {
        let dir = tempfile::tempdir().unwrap();
        let r = check_assumption_only_cascade(
            &dir.path().join("generated"),
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        assert_eq!(r, CascadeCheckOutcome::NothingToVerify);
    }

    #[test]
    fn nothing_to_verify_when_manifest_has_no_assumptions() {
        let dir = tempfile::tempdir().unwrap();
        // Empty manifest body.
        std::fs::write(
            dir.path().join("assumption-only-manifest.md"),
            "# Assumption-Only Manifest\n\n_No assumptions._\n",
        )
        .unwrap();
        let r = check_assumption_only_cascade(
            &dir.path().join("generated"),
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        assert_eq!(r, CascadeCheckOutcome::NothingToVerify);
    }

    #[test]
    fn cascade_check_passes_clean_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-003",
            "anchor-abc",
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);

        let gen_dir = dir.path().join("generated/s6b-data");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(
            gen_dir.join("payment_request.sql"),
            "-- legitimate DDL with no vendor reference\nCREATE TABLE applications (...);\n",
        )
        .unwrap();

        let r = check_assumption_only_cascade(
            &dir.path().join("generated"),
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        assert_eq!(r, CascadeCheckOutcome::Clean);
    }

    #[test]
    fn cascade_check_flags_vendor_reference() {
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-003",
            "anchor-abc",
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);

        let gen_dir = dir.path().join("generated/s6b-data");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(
            gen_dir.join("payment_request.sql"),
            "CREATE TABLE globex_payment_request (id UUID);\n",
        )
        .unwrap();

        let r = check_assumption_only_cascade(
            &dir.path().join("generated"),
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        match r {
            CascadeCheckOutcome::Violations(v) => {
                assert_eq!(v.len(), 1);
                assert_eq!(v[0].surface_form, "Globex");
                assert_eq!(v[0].claim_id.0, "INT-003");
                assert_eq!(v[0].anchor_hash.0, "anchor-abc");
                assert_eq!(v[0].line_number, 1);
            }
            other => panic!("expected Violations, got {other:?}"),
        }
    }

    #[test]
    fn cascade_check_excludes_pending_promotion_md() {
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-003",
            "anchor-abc",
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);

        // pending-promotion.md mentions the surface form; that is
        // exactly its purpose. The check must NOT flag it.
        std::fs::write(
            dir.path().join("pending-promotion.md"),
            "## INT-003\n- wouldEmit: payment_request table for Globex integration\n",
        )
        .unwrap();

        // The generated tree has nothing.
        std::fs::create_dir_all(dir.path().join("generated")).unwrap();

        let r = check_assumption_only_cascade(
            &dir.path().join("generated"),
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        assert_eq!(r, CascadeCheckOutcome::Clean);
    }

    #[test]
    fn cascade_check_excludes_assumption_manifest_md() {
        // The manifest itself contains the surface forms as data; a
        // file at path != generated_dir should never be scanned.
        // Confirm by placing a generated file with a vendor ref AND
        // a manifest file with the same ref; the violation count
        // should be 1 (only the generated file).
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-003",
            "anchor-abc",
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);
        let gen_dir = dir.path().join("generated");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(gen_dir.join("a.sql"), "globex is here\n").unwrap();
        let r = check_assumption_only_cascade(
            &gen_dir,
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        match r {
            CascadeCheckOutcome::Violations(v) => assert_eq!(v.len(), 1),
            other => panic!("expected one violation, got {other:?}"),
        }
    }

    #[test]
    fn per_anchor_invariant_rename_still_flagged() {
        // Operator renames INT-003 to INT-004 in the manifest but keeps
        // the same anchor_hash. The cascade check still flags surface
        // forms because the match key is the anchor's surface forms,
        // not the literal claim ID.
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-004",
            "anchor-abc", // same anchor as before
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);
        let gen_dir = dir.path().join("generated");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(gen_dir.join("a.sql"), "CREATE TABLE globex_x ();\n").unwrap();
        let r = check_assumption_only_cascade(
            &gen_dir,
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        match r {
            CascadeCheckOutcome::Violations(v) => {
                assert_eq!(v.len(), 1);
                // claim_id is the renamed value; anchor_hash carries the
                // identity that the cascade keys on.
                assert_eq!(v[0].claim_id.0, "INT-004");
                assert_eq!(v[0].anchor_hash.0, "anchor-abc");
            }
            other => panic!("expected violation after rename, got {other:?}"),
        }
    }

    #[test]
    fn binary_files_skipped() {
        // A `.bin` file with the surface form should not be scanned.
        let dir = tempfile::tempdir().unwrap();
        let (claim, record) = assumption_claim(
            "INT-003",
            "abc",
            vec!["Globex".into()],
        );
        build_manifest_at(dir.path(), vec![record], vec![claim]);
        let gen_dir = dir.path().join("generated");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(gen_dir.join("art.bin"), b"raw bytes Globex hidden").unwrap();
        let r = check_assumption_only_cascade(
            &gen_dir,
            &dir.path().join("assumption-only-manifest.md"),
            &dir.path().join("pending-promotion.md"),
        )
        .unwrap();
        assert_eq!(r, CascadeCheckOutcome::Clean);
    }
}
