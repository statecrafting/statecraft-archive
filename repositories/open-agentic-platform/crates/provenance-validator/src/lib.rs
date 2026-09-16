// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-001, FR-015 to FR-022

//! `provenance-validator` — Phase 2 deliverable for spec 121.
//!
//! This crate is the read-only "data and matching" layer of the claim
//! provenance validator. It owns:
//!
//!   - the project allowlist derivation pipeline (FR-015 to FR-018),
//!   - the corpus view and inventory hash for drift detection (FR-022),
//!   - citation verification against the typed extraction corpus
//!     (FR-019, FR-020, FR-021),
//!   - the external-entity plausibility heuristic (FR-016).
//!
//! The `validate()` and `audit()` entry points (FR-001 to FR-005, FR-036
//! to FR-039) are deferred to a later phase; this crate exposes the
//! building blocks they will compose.
//!
//! ## LLM independence (FR-001)
//!
//! `provenance-validator` MUST NOT depend on any LLM client crate. The
//! integration test `tests/no_llm_deps.rs` enforces this at `cargo test`
//! time. The validator must not be foolable by the same model that
//! minted the claims it validates — that is the whole point.

pub mod allowlist;
pub mod citation;
pub mod corpus;
pub mod manifest;
pub mod validator;

pub use allowlist::{
    derive as derive_allowlist, detect_external_entities, Allowlist,
    CapitalizationHeuristic, EntityPlausibility, ProjectContext,
};
pub use citation::{
    search_entity, verify_citation, CitationHit, CitationResult,
    EntitySearchSummary,
};
pub use corpus::{extracted_corpus_hash, Corpus, CorpusEntry};
pub use manifest::{
    append_pending_promotion, assumption_manifest_body,
    emit_assumption_manifest, parse_assumption_manifest,
    ParsedAssumptionEntry,
};
pub use validator::{
    audit, audit_with_options, render_audit_report, validate, AuditReport,
    ClaimRecord, CorpusSource, ValidationReport, ValidationSummary,
    VALIDATION_REPORT_VERSION,
};

// Re-export the Phase 1 hash functions and the budget contract so
// consumers of this crate get a single import path.
pub use factory_contracts::provenance::{anchor_hash, quote_hash};
pub use factory_contracts::AssumptionBudget;
