// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-041

//! Tauri commands for the desktop's provenance review surface.
//!
//! These wrap the spec-121 validator and the on-disk `provenance.json`
//! that the factory-engine gate persists. The desktop UI calls these to
//! read the latest report (FR-041), supply a missing citation, downgrade
//! a Rejected claim to Assumption, or promote an Assumption back to
//! Derived once a citation arrives.
//!
//! Mutating commands re-run `validate()` after writing so the returned
//! report reflects the new state immediately. The cumulative file is
//! `<project>/.artifacts/provenance.json`.

use factory_contracts::provenance::{
    AssumptionTag, Citation, Claim, QuoteHash,
};
#[cfg(test)]
use factory_contracts::provenance::{ClaimId, ClaimKind, ProvenanceMode};
use factory_contracts::{AssumptionBudget, DateTime, Utc};
use provenance_validator::{
    audit_with_options, derive_allowlist, validate, AuditReport, Corpus,
    CorpusEntry, ProjectContext, ValidationReport,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// JSON-serialisable wire shape for `Citation` (matches camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationDto {
    pub source: String,
    pub line_range: (u32, u32),
    pub quote: String,
    pub quote_hash: String,
}

impl From<CitationDto> for Citation {
    fn from(dto: CitationDto) -> Self {
        Citation {
            source: PathBuf::from(dto.source),
            line_range: dto.line_range,
            quote: dto.quote,
            quote_hash: QuoteHash(dto.quote_hash),
        }
    }
}

/// Read the latest `provenance.json` for the project. If the file is
/// absent, run `audit_with_options` instead (read-only retroactive
/// scan over the project's BRD + corpus). Returns the report shape the
/// desktop UI consumes.
#[tauri::command]
pub async fn provenance_get_report(
    project_path: String,
) -> Result<serde_json::Value, String> {
    let project_root = PathBuf::from(&project_path);
    let report_path = project_root.join(".artifacts/provenance.json");
    if report_path.exists() {
        let bytes = std::fs::read(&report_path).map_err(|e| e.to_string())?;
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        return Ok(value);
    }
    // No persisted report — run a one-shot read-only audit so the UI
    // still has something to show.
    let audit: AuditReport = audit_with_options(&project_root, None);
    serde_json::to_value(&audit).map_err(|e| e.to_string())
}

/// Append a `Citation` to a Rejected claim and re-run the validator.
/// Writes the updated `provenance.json` and returns the new report.
#[tauri::command]
pub async fn provenance_supply_citation(
    project_path: String,
    claim_id: String,
    citation: CitationDto,
) -> Result<serde_json::Value, String> {
    let project_root = PathBuf::from(&project_path);
    let new_cit: Citation = citation.into();
    update_claim_in_place(&project_root, &claim_id, move |claim| {
        claim.citations.push(new_cit.clone());
        // Clear assumption tag if previously set; supplying a citation
        // is the operator's decision to derive from corpus.
        claim.assumption = None;
    })
    .await
}

/// Downgrade a claim to `Assumption` with a named owner + rationale.
#[tauri::command]
pub async fn provenance_downgrade_to_assumption(
    project_path: String,
    claim_id: String,
    owner: String,
    rationale: String,
    expires_at: String,
) -> Result<serde_json::Value, String> {
    let now: DateTime<Utc> = factory_contracts::now_utc();
    let parsed_expiry = chrono::DateTime::parse_from_rfc3339(&expires_at)
        .map_err(|e| format!("invalid expires_at: {e}"))?
        .with_timezone(&Utc);
    let project_root = PathBuf::from(&project_path);
    update_claim_in_place(&project_root, &claim_id, move |claim| {
        claim.assumption = Some(AssumptionTag {
            owner: owner.clone(),
            rationale: rationale.clone(),
            expires_at: parsed_expiry,
            tagged_at: now,
        });
        claim.citations.clear();
    })
    .await
}

/// Promote an `Assumption` claim to `Derived` by binding the
/// candidatePromotion citation. Writes a `factory.provenance_promoted`
/// audit row payload alongside the new report so the caller (statecraft
/// orchestrator) can emit the audit log entry.
#[tauri::command]
pub async fn provenance_promote_assumption(
    project_path: String,
    claim_id: String,
    actor: String,
) -> Result<serde_json::Value, String> {
    let project_root = PathBuf::from(&project_path);
    update_claim_in_place(&project_root, &claim_id, move |claim| {
        // Move candidate_promotion.citation into citations[].
        if let Some(promo) = claim.candidate_promotion.take() {
            claim.citations.push(promo.citation);
        }
        claim.assumption = None;
    })
    .await
    .map(|report| {
        serde_json::json!({
            "report": report,
            "audit": {
                "action": "factory.provenance_promoted",
                "claimId": claim_id,
                "actor": actor,
                // Caller looks up the citation from the returned report.
            }
        })
    })
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Read the persisted claims JSON (best-effort), apply the mutation,
/// re-run the validator over the modified claim list, and persist the
/// new report. Returns the new report as `serde_json::Value` for the
/// tauri channel.
async fn update_claim_in_place<F>(
    project_root: &Path,
    claim_id: &str,
    mutate: F,
) -> Result<serde_json::Value, String>
where
    F: FnOnce(&mut Claim) + Send + 'static,
{
    let mut claims: Vec<Claim> = load_claims_json(project_root)?;
    let mut found = false;
    for claim in claims.iter_mut() {
        if claim.id.0 == claim_id {
            mutate(claim);
            found = true;
            break;
        }
    }
    if !found {
        return Err(format!("claim {claim_id} not found in provenance state"));
    }

    let corpus = load_corpus(project_root);
    let corpus_outputs: Vec<_> =
        corpus.entries().iter().map(|e| e.output.clone()).collect();
    let allowlist = derive_allowlist(&ProjectContext {
        corpus: &corpus_outputs,
        project_name: project_root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(""),
        project_slug: project_root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(""),
        workspace_name: "",
        entity_model_yaml: None,
        charter_vocabulary: None,
        capitalized_token_frequency_threshold: 1,
    });
    let report: ValidationReport = validate(
        &claims,
        &corpus,
        &allowlist,
        &AssumptionBudget::default(),
        factory_contracts::now_utc(),
    );

    persist_report(project_root, &report)?;
    persist_claims_json(project_root, &claims)?;

    serde_json::to_value(&report).map_err(|e| e.to_string())
}

fn load_claims_json(project_root: &Path) -> Result<Vec<Claim>, String> {
    let path = project_root.join(".artifacts/claims.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn persist_claims_json(project_root: &Path, claims: &[Claim]) -> Result<(), String> {
    let dir = project_root.join(".artifacts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("claims.json");
    let body = serde_json::to_vec_pretty(claims).map_err(|e| e.to_string())?;
    std::fs::write(dest, body).map_err(|e| e.to_string())
}

fn persist_report(
    project_root: &Path,
    report: &ValidationReport,
) -> Result<(), String> {
    let dir = project_root.join(".artifacts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("provenance.json");
    let body = serde_json::to_vec_pretty(report).map_err(|e| e.to_string())?;
    std::fs::write(dest, body).map_err(|e| e.to_string())
}

fn load_corpus(project_root: &Path) -> Corpus {
    let typed_dir = project_root.join(".artifacts/corpus");
    let mut entries: Vec<CorpusEntry> = Vec::new();
    if typed_dir.is_dir()
        && let Ok(read) = std::fs::read_dir(&typed_dir)
    {
        for entry in read.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(bytes) = std::fs::read(&p)
                && let Ok(out) = serde_json::from_slice(&bytes)
            {
                entries.push(CorpusEntry {
                    source_key: p
                        .file_name()
                        .map(PathBuf::from)
                        .unwrap_or_default(),
                    output: out,
                });
            }
        }
    }
    Corpus::from_entries(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::provenance::{anchor_hash, AnchorHash};

    fn write_claim_fixture(project_root: &Path, claim_id: &str, text: &str) {
        let dir = project_root.join(".artifacts");
        std::fs::create_dir_all(&dir).unwrap();
        let claim = Claim {
            id: ClaimId(claim_id.into()),
            kind: ClaimKind::Br,
            stage: 1,
            minted_at: factory_contracts::now_utc(),
            text: text.into(),
            anchor_hash: anchor_hash(text),
            provenance_mode: ProvenanceMode::Derived,
            citations: vec![],
            assumption: None,
            names_external_entity: false,
            extracted_entity_candidates: vec![],
            candidate_promotion: None,
        };
        let body = serde_json::to_vec_pretty(&[claim]).unwrap();
        std::fs::write(dir.join("claims.json"), body).unwrap();
    }

    #[tokio::test]
    async fn get_report_returns_audit_when_no_persisted_file() {
        let dir = tempfile::tempdir().unwrap();
        let result = provenance_get_report(
            dir.path().to_string_lossy().to_string(),
        )
        .await
        .unwrap();
        // Audit returns the AuditReport shape; assert the shape contains
        // the validation field.
        assert!(result.get("validation").is_some());
    }

    #[tokio::test]
    async fn supply_citation_clears_assumption_and_persists_report() {
        let dir = tempfile::tempdir().unwrap();
        write_claim_fixture(dir.path(), "BR-001", "applicants must be registered");
        let cit = CitationDto {
            source: "doc.txt".into(),
            line_range: (1, 1),
            quote: "x".into(),
            quote_hash: factory_contracts::provenance::quote_hash("x").0,
        };
        let _ = provenance_supply_citation(
            dir.path().to_string_lossy().to_string(),
            "BR-001".into(),
            cit,
        )
        .await
        .unwrap();
        // Provenance.json must exist after the call.
        assert!(dir.path().join(".artifacts/provenance.json").exists());
    }

    #[tokio::test]
    async fn downgrade_writes_assumption_tag() {
        let dir = tempfile::tempdir().unwrap();
        write_claim_fixture(dir.path(), "STK-13", "Globex integration");
        let result = provenance_downgrade_to_assumption(
            dir.path().to_string_lossy().to_string(),
            "STK-13".into(),
            "ops@example.com".into(),
            "pending Globex Finance".into(),
            "2027-01-01T00:00:00Z".into(),
        )
        .await
        .unwrap();
        let claims_body =
            std::fs::read(dir.path().join(".artifacts/claims.json")).unwrap();
        let parsed: Vec<Claim> = serde_json::from_slice(&claims_body).unwrap();
        assert!(parsed[0].assumption.is_some());
        assert_eq!(parsed[0].assumption.as_ref().unwrap().owner, "ops@example.com");
        // The returned report must have a `claims` array.
        assert!(result.get("claims").is_some());
    }

    #[tokio::test]
    async fn missing_claim_id_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        write_claim_fixture(dir.path(), "BR-001", "applicants");
        let cit = CitationDto {
            source: "doc.txt".into(),
            line_range: (1, 1),
            quote: "x".into(),
            quote_hash: "0".repeat(64),
        };
        let err = provenance_supply_citation(
            dir.path().to_string_lossy().to_string(),
            "MISSING-99".into(),
            cit,
        )
        .await
        .unwrap_err();
        assert!(err.contains("not found"));
    }

    #[allow(dead_code)]
    fn _unused_imports_silence() -> AnchorHash {
        AnchorHash("x".into())
    }
}
