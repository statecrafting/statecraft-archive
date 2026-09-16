// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — SC-001
//
// Spec 121 SC-001: Running the validator on a fabrication-shaped BRD in
// audit mode reports STK-13, INT-003, and SN-022 as Rejected.
//
// The fixture under tests/fixtures/payment-scope-fabrication/ replicates
// the STRUCTURAL pattern of a fabrication forensic (an external payment
// system named across stakeholder / integration / scope claims, with a
// corpus that explicitly says payment processing is out of scope)
// without copying any private content. SC-001 is the headline behaviour
// the spec exists to prevent: a forensic-shaped BRD must produce a
// Rejected verdict on each fabricated claim, every time.

use factory_contracts::provenance::ProvenanceMode;
use provenance_validator::{audit_with_options, CorpusSource};

fn fixture_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/payment-scope-fabrication")
}

#[test]
fn sc001_audit_rejects_stk13_int003_sn022_against_fixture() {
    let report = audit_with_options(&fixture_path(), None);

    // FR-039: legacy `.txt` corpus → synthesizedCorpus flag is set.
    assert!(
        report.synthesized_corpus,
        "fixture has only legacy .txt extracted, expected synthesized_corpus=true",
    );
    assert_eq!(report.corpus_source, CorpusSource::LegacyTxt);
    assert!(!report.brd_not_found, "fixture BRD must be found");
    assert!(
        !report.corpus_empty,
        "fixture business-case.txt must produce a non-empty corpus",
    );

    // Build an id → mode index for the assertions below.
    let by_id: std::collections::BTreeMap<String, &ProvenanceMode> = report
        .validation
        .claims
        .iter()
        .map(|r| (r.id.0.clone(), &r.provenance_mode))
        .collect();

    for needed_id in ["STK-13", "INT-003", "SN-022"] {
        let mode = by_id
            .get(needed_id)
            .unwrap_or_else(|| panic!("missing claim {needed_id} in audit report"));
        assert!(
            matches!(mode, ProvenanceMode::Rejected { .. }),
            "SC-001 violation: {needed_id} should be Rejected (fabricated claim with no corpus backing); \
             got {mode:?}",
        );
    }

    // The summary must reflect at least the three known fabrications.
    assert!(
        report.validation.summary.rejected_count >= 3,
        "expected >=3 rejected claims, got {} (claims: {:?})",
        report.validation.summary.rejected_count,
        report.validation.claims.len(),
    );
}

#[test]
fn sc001_audit_is_deterministic_against_fixture() {
    // FR-002 / SC-010 corollary at the audit boundary: two runs against
    // the on-disk fixture produce reports whose validation summary is
    // identical. (We assert the summary rather than the full report
    // because the audit synthesises Claim.minted_at via wall clock for
    // the legacy-txt corpus — but the per-claim ClaimRecord that lands
    // in the report does not surface minted_at, so the summary IS
    // stable.)
    let r1 = audit_with_options(&fixture_path(), None);
    let r2 = audit_with_options(&fixture_path(), None);
    assert_eq!(r1.validation.summary, r2.validation.summary);
    assert_eq!(r1.synthesized_corpus, r2.synthesized_corpus);
    assert_eq!(r1.corpus_source, r2.corpus_source);
    // Per-claim modes must match too.
    let modes1: Vec<_> = r1
        .validation
        .claims
        .iter()
        .map(|c| (c.id.0.clone(), c.provenance_mode.clone()))
        .collect();
    let modes2: Vec<_> = r2
        .validation
        .claims
        .iter()
        .map(|c| (c.id.0.clone(), c.provenance_mode.clone()))
        .collect();
    assert_eq!(modes1, modes2);
}
