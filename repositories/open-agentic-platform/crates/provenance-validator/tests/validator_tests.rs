// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-001 to FR-005, FR-036 to FR-039

//! Validator integration tests — happy path, fail-closed paths, panic
//! guard, byte-determinism, retroactive audit synthesis, audit
//! read-only invariant.

use chrono::{TimeZone, Utc};
use factory_contracts::knowledge::{ExtractionOutput, Extractor};
use factory_contracts::provenance::{
    anchor_hash, quote_hash, AssumptionTag, Citation, Claim, ClaimId,
    ClaimKind, ProvenanceMode, QuoteHash,
};
use factory_contracts::AssumptionBudget;
use provenance_validator::{
    audit_with_options, derive_allowlist, validate, Allowlist, Corpus,
    CorpusEntry, CorpusSource, ProjectContext,
};
use std::collections::HashMap;
use std::path::PathBuf;

fn empty_extraction(text: &str) -> ExtractionOutput {
    ExtractionOutput {
        text: text.to_string(),
        pages: None,
        language: None,
        outline: None,
        metadata: HashMap::new(),
        extractor: Extractor {
            kind: "test".into(),
            version: "0.0.0".into(),
            agent_run: None,
        },
    }
}

fn corpus_with(entries: &[(&str, &str)]) -> Corpus {
    Corpus::from_entries(
        entries
            .iter()
            .map(|(k, t)| CorpusEntry {
                source_key: PathBuf::from(*k),
                output: empty_extraction(t),
            })
            .collect(),
    )
}

fn allowlist_default() -> Allowlist {
    derive_allowlist(&ProjectContext::default())
}

fn fixed_now() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap()
}

fn make_claim(
    id: &str,
    kind: ClaimKind,
    text: &str,
    citations: Vec<Citation>,
    assumption: Option<AssumptionTag>,
) -> Claim {
    Claim {
        id: ClaimId(id.into()),
        kind,
        stage: 1,
        minted_at: fixed_now(),
        text: text.into(),
        anchor_hash: anchor_hash(text),
        provenance_mode: ProvenanceMode::Derived,
        citations,
        assumption,
        names_external_entity: false,
        extracted_entity_candidates: vec![],
        candidate_promotion: None,
    }
}

// ---------------------------------------------------------------------------
// T-01 byte determinism
// ---------------------------------------------------------------------------

#[test]
fn t01_byte_determinism_two_runs_identical() {
    let claims = vec![
        make_claim(
            "BR-001",
            ClaimKind::Br,
            "applicants must be registered partner organizations",
            vec![],
            None,
        ),
        make_claim(
            "STK-001",
            ClaimKind::Stk,
            "Globex Finance reviews applications quarterly",
            vec![],
            Some(AssumptionTag {
                owner: "ops".into(),
                rationale: "no charter yet".into(),
                expires_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
                tagged_at: fixed_now(),
            }),
        ),
    ];
    let corpus = corpus_with(&[("doc.txt", "applicants must be registered")]);
    let allow = allowlist_default();
    let budget = AssumptionBudget::default();
    let now = fixed_now();

    let r1 = validate(&claims, &corpus, &allow, &budget, now);
    let r2 = validate(&claims, &corpus, &allow, &budget, now);
    let s1 = serde_json::to_string(&r1).unwrap();
    let s2 = serde_json::to_string(&r2).unwrap();
    assert_eq!(s1, s2);
}

// ---------------------------------------------------------------------------
// T-02 fabrication claim rejected (the headline behaviour, SC-002)
// ---------------------------------------------------------------------------

#[test]
fn t02_fabrication_claim_no_citation_rejected() {
    let claim = make_claim(
        "STK-13-FAKE",
        ClaimKind::Stk,
        "Globex Initech ERP integration via Globex Finance",
        vec![],
        None,
    );
    let claims = vec![claim];
    let corpus = corpus_with(&[("doc.txt", "payment processing is out of scope")]);
    let allow = allowlist_default();
    let report = validate(
        &claims,
        &corpus,
        &allow,
        &AssumptionBudget::default(),
        fixed_now(),
    );
    assert_eq!(report.claims.len(), 1);
    let mode = &report.claims[0].provenance_mode;
    assert!(
        matches!(mode, ProvenanceMode::Rejected { reason } if reason.contains("citation")),
        "expected Rejected with citation reason, got {mode:?}",
    );
    assert_eq!(report.summary.rejected_count, 1);
    assert_eq!(report.summary.derived_count, 0);
}

// ---------------------------------------------------------------------------
// T-03 anchor-hash collision (SC-009)
// ---------------------------------------------------------------------------

#[test]
fn t03_anchor_hash_collision_both_rejected() {
    let text = "applicants must be registered partner organizations";
    let a = make_claim("BR-001", ClaimKind::Br, text, vec![], None);
    let b = make_claim("BR-002", ClaimKind::Br, text, vec![], None);
    assert_eq!(a.anchor_hash, b.anchor_hash);
    let report = validate(
        &[a, b],
        &Corpus::default(),
        &allowlist_default(),
        &AssumptionBudget::default(),
        fixed_now(),
    );
    assert_eq!(report.claims.len(), 2);
    for r in &report.claims {
        assert!(matches!(
            r.provenance_mode,
            ProvenanceMode::Rejected { ref reason } if reason == "duplicate_anchor"
        ));
    }
}

// ---------------------------------------------------------------------------
// T-04 assumption budget cap (SC-007)
// ---------------------------------------------------------------------------

#[test]
fn t04_assumption_budget_cap_at_one() {
    let tag = AssumptionTag {
        owner: "ops".into(),
        rationale: "pending Globex Finance authorization".into(),
        expires_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
        tagged_at: fixed_now(),
    };
    let claims = vec![
        make_claim(
            "INT-001",
            ClaimKind::Int,
            "first assumption",
            vec![],
            Some(tag.clone()),
        ),
        make_claim(
            "INT-002",
            ClaimKind::Int,
            "second assumption",
            vec![],
            Some(tag.clone()),
        ),
    ];
    let budget = AssumptionBudget { cap: 1, used: 0 };
    let report = validate(
        &claims,
        &Corpus::default(),
        &allowlist_default(),
        &budget,
        fixed_now(),
    );
    assert_eq!(report.claims[0].provenance_mode, ProvenanceMode::Assumption);
    assert!(matches!(
        report.claims[1].provenance_mode,
        ProvenanceMode::Rejected { ref reason } if reason == "assumption_budget_exceeded"
    ));
    assert_eq!(report.summary.assumption_count, 1);
    assert_eq!(report.summary.rejected_count, 1);
    assert_eq!(report.summary.assumption_slots_consumed, 1);
}

// ---------------------------------------------------------------------------
// T-05 expired assumption (SC-008)
// ---------------------------------------------------------------------------

#[test]
fn t05_expired_assumption_becomes_rejected() {
    let expired = AssumptionTag {
        owner: "ops".into(),
        rationale: "stale".into(),
        expires_at: Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap(),
        tagged_at: Utc.with_ymd_and_hms(2019, 12, 1, 0, 0, 0).unwrap(),
    };
    let claim = make_claim(
        "INT-001",
        ClaimKind::Int,
        "stale assumption",
        vec![],
        Some(expired),
    );
    let report = validate(
        &[claim],
        &Corpus::default(),
        &allowlist_default(),
        &AssumptionBudget::default(),
        fixed_now(),
    );
    assert!(matches!(
        report.claims[0].provenance_mode,
        ProvenanceMode::Rejected { ref reason } if reason == "assumption_expired"
    ));
}

// ---------------------------------------------------------------------------
// T-06 citation hash mismatch is hard-rejected (FR-020)
// ---------------------------------------------------------------------------

#[test]
fn t06_citation_hash_mismatch_is_hard_rejected() {
    // FR-020 is explicit: a citation whose declared quote_hash does NOT
    // match the actual content at the cited lineRange MUST be Rejected
    // with reason `quote_hash_mismatch`. This catches BOTH stale and
    // forged citations at this verify-time check; the spec does not
    // permit silent downgrade to AssumptionOrphaned. The §4 US-5 / FR-022
    // drift path that produces AssumptionOrphaned operates differently
    // (corpusHash change + search-elsewhere) and is not exercised here.
    let cit = Citation {
        source: PathBuf::from("doc.txt"),
        line_range: (1, 1),
        quote: "beta".into(),
        quote_hash: quote_hash("beta"),
    };
    let claim = make_claim(
        "BR-001",
        ClaimKind::Br,
        "Frobozz Engine handles rotation",
        vec![cit],
        None,
    );
    let corpus = corpus_with(&[("doc.txt", "alpha")]);
    let report = validate(
        &[claim],
        &corpus,
        &allowlist_default(),
        &AssumptionBudget::default(),
        fixed_now(),
    );
    assert!(
        matches!(
            report.claims[0].provenance_mode,
            ProvenanceMode::Rejected { ref reason } if reason == "quote_hash_mismatch"
        ),
        "expected Rejected with quote_hash_mismatch, got {:?}",
        report.claims[0].provenance_mode,
    );
}

// ---------------------------------------------------------------------------
// T-07 happy path (Derived)
// ---------------------------------------------------------------------------

#[test]
fn t07_derived_claim_with_verified_citation_passes() {
    let source_line = "Frobozz Engine emits rotation events";
    let cit = Citation {
        source: PathBuf::from("doc.txt"),
        line_range: (1, 1),
        quote: source_line.into(),
        quote_hash: quote_hash(source_line),
    };
    let claim = make_claim(
        "BR-001",
        ClaimKind::Br,
        "Frobozz Engine emits rotation events",
        vec![cit],
        None,
    );
    let corpus = corpus_with(&[("doc.txt", source_line)]);
    let report = validate(
        &[claim],
        &corpus,
        &allowlist_default(),
        &AssumptionBudget::default(),
        fixed_now(),
    );
    assert_eq!(report.claims[0].provenance_mode, ProvenanceMode::Derived);
}

// T-08 (assumption-orphaned consumes budget) and T-09 (panic guard) live
// as unit tests inside `validator.rs` (`mod panic_guard_tests`). Phase 3's
// FR-020 fix removed the AssumptionOrphaned route from `validate()` so
// the only path that produces an orphan today is the (deferred) FR-022
// drift workflow, which has no integration coverage yet — that arrives
// when the live drift gate lands.

// ---------------------------------------------------------------------------
// T-10 audit synthesis from .txt sets the synthesized_corpus flag
// ---------------------------------------------------------------------------

#[test]
fn t10_audit_synthesis_from_txt_flags_synthesized() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let req = project.join("requirements");
    std::fs::create_dir_all(&req).unwrap();
    std::fs::write(
        req.join("business-requirements-document.md"),
        "# Business Requirements Document\n\n### BR-001 Applicant eligibility\n\nApplicants must hold registered status.\n",
    )
    .unwrap();
    let extracted = project.join(".artifacts/extracted");
    std::fs::create_dir_all(&extracted).unwrap();
    std::fs::write(
        extracted.join("business-case.txt"),
        "Applicants must hold registered status.\nThe program funds partner organizations.\n",
    )
    .unwrap();

    let report = audit_with_options(project, None);
    assert!(report.synthesized_corpus);
    assert_eq!(report.corpus_source, CorpusSource::LegacyTxt);
    assert!(!report.brd_not_found);
    assert!(!report.validation.claims.is_empty());
}

// ---------------------------------------------------------------------------
// T-11 audit library function is read-only (FR-038)
// ---------------------------------------------------------------------------

#[test]
fn t11_audit_library_function_is_read_only() {
    use sha2::{Digest, Sha256};
    fn dir_fingerprint(p: &std::path::Path) -> String {
        // Hash every (relative path, file content) pair for a directory.
        let mut entries: Vec<(PathBuf, Vec<u8>)> = Vec::new();
        fn walk(
            base: &std::path::Path,
            here: &std::path::Path,
            out: &mut Vec<(PathBuf, Vec<u8>)>,
        ) {
            for entry in std::fs::read_dir(here).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if path.is_dir() {
                    walk(base, &path, out);
                } else {
                    let rel = path.strip_prefix(base).unwrap().to_path_buf();
                    let bytes = std::fs::read(&path).unwrap();
                    out.push((rel, bytes));
                }
            }
        }
        walk(p, p, &mut entries);
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut hasher = Sha256::new();
        for (path, bytes) in entries {
            hasher.update(path.to_string_lossy().as_bytes());
            hasher.update(b":");
            hasher.update(&bytes);
            hasher.update(b"\n");
        }
        format!("{:x}", hasher.finalize())
    }

    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let req = project.join("requirements");
    std::fs::create_dir_all(&req).unwrap();
    std::fs::write(
        req.join("business-requirements-document.md"),
        "# Business Requirements Document\n\n### BR-001 Eligibility\n\nApplicants must hold registered status.\n",
    )
    .unwrap();
    let extracted = project.join(".artifacts/extracted");
    std::fs::create_dir_all(&extracted).unwrap();
    std::fs::write(extracted.join("a.txt"), "content").unwrap();

    let before = dir_fingerprint(project);
    // Call the LIBRARY function — the binary entry point is the only
    // thing that writes the report; the library is strictly read-only.
    let _ = audit_with_options(project, None);
    let after = dir_fingerprint(project);
    assert_eq!(
        before, after,
        "audit_with_options() library function must not mutate the project directory",
    );
}

// ---------------------------------------------------------------------------
// T-12 BRD parser extracts headers
// ---------------------------------------------------------------------------

#[test]
fn t12_audit_extracts_brd_claim_headers() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let req = project.join("requirements");
    std::fs::create_dir_all(&req).unwrap();
    std::fs::write(
        req.join("business-requirements-document.md"),
        "# Business Requirements Document\n\
         \n\
         ## 3. Stakeholders\n\
         \n\
         ### STK-01 Premier's Office\n\
         The Premier's Office sponsors the program.\n\
         \n\
         ### 3.2 BR-003: Applicant eligibility\n\
         Applicants must hold registered status.\n\
         \n\
         ### INT-002\n\
         Integration with grants registry.\n\
         \n\
         ## 4. Out of scope\n\
         \n\
         The fictional XYZ-99 token here is inline only.\n",
    )
    .unwrap();
    let report = audit_with_options(project, None);
    assert!(!report.brd_not_found);
    let ids: Vec<String> = report
        .validation
        .claims
        .iter()
        .map(|r| r.id.0.clone())
        .collect();
    assert!(ids.contains(&"STK-01".to_string()));
    assert!(ids.contains(&"BR-003".to_string()));
    assert!(ids.contains(&"INT-002".to_string()));
}

// ---------------------------------------------------------------------------
// T-13 unparsed inline KIND-NNN counted, not classified
// ---------------------------------------------------------------------------

#[test]
fn t13_audit_counts_unparsed_inline_refs() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let req = project.join("requirements");
    std::fs::create_dir_all(&req).unwrap();
    std::fs::write(
        req.join("business-requirements-document.md"),
        "# Business Requirements Document\n\
         \n\
         The BR-100 referenced in this prose is not a header.\n\
         Another inline ref STK-99 also.\n\
         \n\
         ### BR-001 Real header\n\
         body text\n",
    )
    .unwrap();
    let report = audit_with_options(project, None);
    assert_eq!(report.validation.claims.len(), 1);
    assert_eq!(report.validation.claims[0].id.0, "BR-001");
    assert!(report.unparsed_inline_count >= 2);
}

// ---------------------------------------------------------------------------
// T-14 SC-001 retroactive audit reports REJECTED on synthetic fabrication shape
// ---------------------------------------------------------------------------

#[test]
fn t14_retroactive_audit_rejects_synthetic_fabrication() {
    // Synthetic fabrication: BRD claims STK-13/INT-003/SN-022
    // referencing Globex with no corpus backing; corpus says payment
    // processing is OUT OF SCOPE. Mirrors the structural pattern Phase
    // 7 will exercise as a fixture; this test pins the SC-001 path.
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path();
    let req = project.join("requirements");
    std::fs::create_dir_all(&req).unwrap();
    std::fs::write(
        req.join("business-requirements-document.md"),
        "# Business Requirements Document\n\
         \n\
         ### STK-13 Globex Finance / Globex ERP\n\
         Globex Finance Integrations operate the Globex payment system.\n\
         \n\
         ### INT-003 Globex integration\n\
         The portal integrates with Globex for payment processing.\n\
         \n\
         ### SN-022 Globex scope inclusion\n\
         Globex integration is in scope for Phase 1.\n",
    )
    .unwrap();
    let extracted = project.join(".artifacts/extracted");
    std::fs::create_dir_all(&extracted).unwrap();
    std::fs::write(
        extracted.join("business-case.txt"),
        "Payment processing — Out of Scope. Finance systems are not in scope for Phase 1.\n",
    )
    .unwrap();

    let report = audit_with_options(project, None);
    let by_id: std::collections::BTreeMap<String, &ProvenanceMode> = report
        .validation
        .claims
        .iter()
        .map(|r| (r.id.0.clone(), &r.provenance_mode))
        .collect();
    for needed in ["STK-13", "INT-003", "SN-022"] {
        let mode = by_id
            .get(needed)
            .unwrap_or_else(|| panic!("missing claim {needed}"));
        assert!(
            matches!(mode, ProvenanceMode::Rejected { .. }),
            "expected {needed} to be Rejected, got {mode:?}",
        );
    }
}

// ---------------------------------------------------------------------------
// FR-020: forged citation (declared quote_hash != actual at lineRange) is
// hard-rejected. No silent budget admission.
// ---------------------------------------------------------------------------

#[test]
fn forged_citation_quote_hash_mismatch_is_hard_rejected() {
    let cit = Citation {
        source: PathBuf::from("doc.txt"),
        line_range: (1, 1),
        quote: "fabricated".into(),
        quote_hash: QuoteHash(
            "0000000000000000000000000000000000000000000000000000000000000000".into(),
        ),
    };
    let claim = make_claim(
        "BR-001",
        ClaimKind::Br,
        "Frobozz Engine emits rotation events",
        vec![cit],
        None,
    );
    let corpus = corpus_with(&[("doc.txt", "actual content")]);
    let report = validate(
        &[claim],
        &corpus,
        &allowlist_default(),
        &AssumptionBudget { cap: 5, used: 0 },
        fixed_now(),
    );
    assert!(matches!(
        report.claims[0].provenance_mode,
        ProvenanceMode::Rejected { ref reason } if reason == "quote_hash_mismatch"
    ));
    // The forge path consumes ZERO budget slots (FR-020 hard reject, not
    // an orphan promotion).
    assert_eq!(report.summary.assumption_slots_consumed, 0);
}
