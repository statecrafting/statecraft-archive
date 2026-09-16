// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-001 through FR-006

//! Rust contract types for authored stakeholder docs (spec 122).
//!
//! `StakeholderDoc` is the typed view of an authored markdown document
//! under `requirements/stakeholder/` (charter or client-document). The
//! document carries:
//!
//!   - `StakeholderFrontmatter` — document-level metadata: authoring
//!     status, owner, semver version, supersedes chain, doc-level
//!     citations, migration trail, and an `appliedFrom` history that
//!     records every operator-confirmed Stage CD candidate apply.
//!   - `Vec<AnchoredSection>` — sections keyed by `<KIND>-<NNN>` anchors
//!     (`OBJ-1`, `STAKEHOLDER-3`, `IN-SCOPE-2`, etc.). Each section
//!     carries the heading text, body, per-section citations, and a
//!     spec-121 `AnchorHash` computed from the heading content.
//!
//! Anchor kinds are exhaustive for V1 (`OBJ`, `STAKEHOLDER`, `OUTCOME`,
//! `IN-SCOPE`, `OUT-SCOPE`, `OWNER`, `ASSUMPTION`, `RISK`). Adding a new
//! kind requires a spec amendment; this module rejects unknown kinds at
//! parse time.
//!
//! Schema version `STAKEHOLDER_DOC_SCHEMA_VERSION = "1.0.0"` is the
//! compile-time anchor `tools/oap/schema-parity-check` records on the
//! Rust side. The TS mirror reservation lives at
//! `platform/services/statecraft/api/governance/stakeholderDocPolicy.ts`
//! and is null-safe until authored.

use crate::provenance::{AnchorHash, Citation};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::str::FromStr;

/// Shared schema version. The TS mirror at `stakeholderDocPolicy.ts`
/// (reserved by spec 122) keeps this same constant byte-for-byte.
pub const STAKEHOLDER_DOC_SCHEMA_VERSION: &str = "1.0.0";

// ---------------------------------------------------------------------------
// DocKind — closed set; new kinds require a spec amendment.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocKind {
    Charter,
    ClientDocument,
}

impl DocKind {
    pub fn canonical_filename(&self) -> &'static str {
        match self {
            DocKind::Charter => "charter.md",
            DocKind::ClientDocument => "client-document.md",
        }
    }
}

// ---------------------------------------------------------------------------
// AuthoringStatus — gate enforcement keys on `authored`. `draft` runs the
// comparator but does NOT block (Edge Case in spec 122 §4). The set is
// intentionally tiny so promotion is an explicit operator gesture.
// ---------------------------------------------------------------------------

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum AuthoringStatus {
    Draft,
    Authored,
}

// ---------------------------------------------------------------------------
// SectionAnchor — `<KIND>-<NNN>` with KIND fixed to the V1 enum and NNN
// a monotonically-increasing integer per kind (zero-padding optional in
// authored markdown but stored as the integer, so `OBJ-1` and `OBJ-001`
// round-trip to the same anchor).
// ---------------------------------------------------------------------------

/// Anchor kinds permitted in stakeholder docs. The set is closed for V1;
/// adding a new kind requires a spec amendment per FR-003.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum AnchorKind {
    Obj,
    Stakeholder,
    Outcome,
    InScope,
    OutScope,
    Owner,
    Assumption,
    Risk,
}

impl AnchorKind {
    /// The literal token used in markdown anchors (`OBJ-1`, `IN-SCOPE-3`).
    pub const fn token(&self) -> &'static str {
        match self {
            AnchorKind::Obj => "OBJ",
            AnchorKind::Stakeholder => "STAKEHOLDER",
            AnchorKind::Outcome => "OUTCOME",
            AnchorKind::InScope => "IN-SCOPE",
            AnchorKind::OutScope => "OUT-SCOPE",
            AnchorKind::Owner => "OWNER",
            AnchorKind::Assumption => "ASSUMPTION",
            AnchorKind::Risk => "RISK",
        }
    }

    /// Closed iteration over the V1 set. Order is the canonical
    /// declaration order so `cargo test` snapshots stay stable.
    pub const ALL: &'static [AnchorKind] = &[
        AnchorKind::Obj,
        AnchorKind::Stakeholder,
        AnchorKind::Outcome,
        AnchorKind::InScope,
        AnchorKind::OutScope,
        AnchorKind::Owner,
        AnchorKind::Assumption,
        AnchorKind::Risk,
    ];
}

impl FromStr for AnchorKind {
    type Err = StakeholderDocParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "OBJ" => Ok(AnchorKind::Obj),
            "STAKEHOLDER" => Ok(AnchorKind::Stakeholder),
            "OUTCOME" => Ok(AnchorKind::Outcome),
            "IN-SCOPE" => Ok(AnchorKind::InScope),
            "OUT-SCOPE" => Ok(AnchorKind::OutScope),
            "OWNER" => Ok(AnchorKind::Owner),
            "ASSUMPTION" => Ok(AnchorKind::Assumption),
            "RISK" => Ok(AnchorKind::Risk),
            other => Err(StakeholderDocParseError::UnknownAnchorKind(
                other.to_string(),
            )),
        }
    }
}

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord,
)]
pub struct SectionAnchor {
    pub kind: AnchorKind,
    pub index: u32,
}

impl SectionAnchor {
    pub fn new(kind: AnchorKind, index: u32) -> Self {
        SectionAnchor { kind, index }
    }

    /// Render as `<KIND>-<N>` without zero-padding. The lint accepts
    /// padded forms on input (`OBJ-001`) but the canonical text form is
    /// unpadded.
    pub fn render(&self) -> String {
        format!("{}-{}", self.kind.token(), self.index)
    }
}

impl std::fmt::Display for SectionAnchor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.render())
    }
}

impl FromStr for SectionAnchor {
    type Err = StakeholderDocParseError;

    /// Parse `<KIND>-<NNN>`. The KIND match is a longest-prefix scan so
    /// `IN-SCOPE-3` is parsed as `(IN-SCOPE, 3)` not `(IN, ...)`. Index
    /// digits are right-stripped of leading zeros before parsing.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let trimmed = s.trim();
        // Find the LAST '-' followed by ASCII digits — the suffix is the
        // index, everything before is the KIND token. This handles
        // `IN-SCOPE-3` and `OBJ-1` uniformly.
        let last_dash = trimmed.rfind('-').ok_or_else(|| {
            StakeholderDocParseError::MalformedAnchor(trimmed.to_string())
        })?;
        let (kind_part, index_part_with_dash) = trimmed.split_at(last_dash);
        let index_part = &index_part_with_dash[1..];
        if index_part.is_empty() || !index_part.chars().all(|c| c.is_ascii_digit()) {
            return Err(StakeholderDocParseError::MalformedAnchor(
                trimmed.to_string(),
            ));
        }
        let index: u32 = index_part.parse().map_err(|_| {
            StakeholderDocParseError::MalformedAnchor(trimmed.to_string())
        })?;
        let kind = AnchorKind::from_str(kind_part)?;
        Ok(SectionAnchor { kind, index })
    }
}

impl Serialize for SectionAnchor {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&self.render())
    }
}

impl<'de> Deserialize<'de> for SectionAnchor {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        SectionAnchor::from_str(&s).map_err(serde::de::Error::custom)
    }
}

// ---------------------------------------------------------------------------
// SemVer — light wrapper. The `bump_patch` helper is the canonical bump
// path for `Accept candidate` (FR-025) and the only mutation the
// comparator's apply-action performs to the version field.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SemVer(pub String);

impl SemVer {
    pub fn parse(input: &str) -> Result<(u32, u32, u32), StakeholderDocParseError> {
        let parts: Vec<&str> = input.trim().split('.').collect();
        if parts.len() != 3 {
            return Err(StakeholderDocParseError::MalformedSemVer(
                input.to_string(),
            ));
        }
        let major: u32 = parts[0].parse().map_err(|_| {
            StakeholderDocParseError::MalformedSemVer(input.to_string())
        })?;
        let minor: u32 = parts[1].parse().map_err(|_| {
            StakeholderDocParseError::MalformedSemVer(input.to_string())
        })?;
        let patch: u32 = parts[2].parse().map_err(|_| {
            StakeholderDocParseError::MalformedSemVer(input.to_string())
        })?;
        Ok((major, minor, patch))
    }

    /// Increment patch component. `1.0.0` → `1.0.1`.
    pub fn bump_patch(&self) -> Result<SemVer, StakeholderDocParseError> {
        let (major, minor, patch) = SemVer::parse(&self.0)?;
        Ok(SemVer(format!("{major}.{minor}.{}", patch + 1)))
    }

    pub fn is_above_initial(&self) -> bool {
        match SemVer::parse(&self.0) {
            Ok((1, 0, 0)) | Ok((0, _, _)) => false,
            Ok(_) => true,
            Err(_) => false,
        }
    }
}

// ---------------------------------------------------------------------------
// AppliedFromEntry — recorded by FR-025 every time an `Accept candidate`
// action commits a Stage CD candidate section to the authored doc.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedFromEntry {
    /// Factory run that produced the applied candidate.
    pub run_id: String,
    /// Path under the artifact store of the candidate that was applied
    /// (e.g. `runs/<id>/charter.candidate.md`).
    pub candidate_path: PathBuf,
    /// AnchorHash of the authored section before apply.
    pub from_hash: AnchorHash,
    /// AnchorHash of the candidate section that became the new authored
    /// content.
    pub to_hash: AnchorHash,
    /// Workspace-member identity of the operator who confirmed the apply.
    pub actor: String,
    pub applied_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// StakeholderFrontmatter
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StakeholderFrontmatter {
    pub status: AuthoringStatus,
    pub owner: String,
    pub version: SemVer,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub supersedes: Option<SemVer>,
    /// Document-level citations (whole-doc claims, FR-004 a).
    #[serde(default)]
    pub citations: Vec<Citation>,
    /// Migration trail — set by `factory migrate stakeholder-docs`.
    #[serde(default)]
    pub migrated: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub migrated_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub migrated_from: Option<PathBuf>,
    /// Append-only history of operator-confirmed Stage CD `Accept
    /// candidate` actions. Each entry records the source run, the
    /// candidate file, the before/after AnchorHashes, the operator
    /// identity, and the apply timestamp (FR-025).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub applied_from: Vec<AppliedFromEntry>,
    /// True when the migration tool detected manual edits relative to
    /// the prior Stage CD generation (Edge Case in spec 122 §4).
    #[serde(default, skip_serializing_if = "is_false")]
    pub manually_edited: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

// ---------------------------------------------------------------------------
// AnchoredSection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchoredSection {
    pub anchor: SectionAnchor,
    /// Heading text after the anchor — `Reduce form-correction cycles
    /// by 50%` for `### OBJ-1: Reduce form-correction cycles by 50%`.
    pub heading_text: String,
    /// Section body after the heading and before the next heading.
    /// Stored verbatim (the comparator computes its own diff over body
    /// content; the lint never edits the body).
    pub body: String,
    /// Per-section citations (FR-004 b).
    #[serde(default)]
    pub citations: Vec<Citation>,
    /// AnchorHash computed via spec 121's `anchor_hash` over the
    /// heading text (FR-027). Stored explicitly so the comparator never
    /// needs to call the function ad-hoc — the constructor writes it
    /// once, the comparator pairs by it.
    pub anchor_hash: AnchorHash,
}

impl AnchoredSection {
    /// Construct from an anchor + heading text + body, computing the
    /// `AnchorHash` via spec 121's UNCHANGED `anchor_hash` function.
    /// FR-027 forbids alternate normalisation at the stakeholder-doc
    /// layer; this constructor is the only sanctioned shortcut, and it
    /// re-exports the spec-121 hash so callers cannot accidentally
    /// shadow it.
    pub fn new(
        anchor: SectionAnchor,
        heading_text: impl Into<String>,
        body: impl Into<String>,
        citations: Vec<Citation>,
    ) -> Self {
        let heading_text = heading_text.into();
        let anchor_hash = crate::provenance::anchor_hash(&heading_text);
        AnchoredSection {
            anchor,
            heading_text,
            body: body.into(),
            citations,
            anchor_hash,
        }
    }
}

// ---------------------------------------------------------------------------
// StakeholderDoc
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StakeholderDoc {
    pub kind: DocKind,
    pub frontmatter: StakeholderFrontmatter,
    pub sections: Vec<AnchoredSection>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum StakeholderDocParseError {
    #[error("unknown anchor kind '{0}' (V1 set: OBJ, STAKEHOLDER, OUTCOME, IN-SCOPE, OUT-SCOPE, OWNER, ASSUMPTION, RISK)")]
    UnknownAnchorKind(String),
    #[error("malformed anchor '{0}' (expected <KIND>-<NNN>)")]
    MalformedAnchor(String),
    #[error("malformed semver '{0}'")]
    MalformedSemVer(String),
}

// ---------------------------------------------------------------------------
// Schema fingerprint — recorded under build/schema-parity/ for parity
// against the (eventual) TS mirror, in the same shape spec 121 uses.
// ---------------------------------------------------------------------------

/// Canonical structural fingerprint of the stakeholder-doc schema. The
/// matching `tools/oap/schema-parity-check` will compute the same shape from
/// `stakeholderDocPolicy.ts` once the TS mirror lands and assert
/// equality. Field lists at every nesting level are emitted in
/// alphabetical order so the comparison is order-independent.
pub fn stakeholder_doc_schema_fingerprint() -> Value {
    let citation = serde_json::json!({
        "kind": "object",
        "fields": [
            {"name": "lineRange", "required": true, "type": {
                "kind": "tuple",
                "items": [{"kind": "int"}, {"kind": "int"}],
            }},
            {"name": "quote", "required": true, "type": {"kind": "string"}},
            {"name": "quoteHash", "required": true, "type": {"kind": "string"}},
            {"name": "source", "required": true, "type": {"kind": "string"}},
        ],
    });

    let applied_from_entry = serde_json::json!({
        "kind": "object",
        "fields": [
            {"name": "actor", "required": true, "type": {"kind": "string"}},
            {"name": "appliedAt", "required": true, "type": {"kind": "string"}},
            {"name": "candidatePath", "required": true, "type": {"kind": "string"}},
            {"name": "fromHash", "required": true, "type": {"kind": "string"}},
            {"name": "runId", "required": true, "type": {"kind": "string"}},
            {"name": "toHash", "required": true, "type": {"kind": "string"}},
        ],
    });

    let authoring_status = serde_json::json!({
        "kind": "enum",
        "values": ["authored", "draft"],
    });

    let doc_kind = serde_json::json!({
        "kind": "enum",
        "values": ["charter", "client-document"],
    });

    let anchor_kind = serde_json::json!({
        "kind": "enum",
        "values": [
            "ASSUMPTION", "IN-SCOPE", "OBJ", "OUT-SCOPE",
            "OUTCOME", "OWNER", "RISK", "STAKEHOLDER",
        ],
    });

    let frontmatter = serde_json::json!({
        "kind": "object",
        "fields": [
            {"name": "appliedFrom", "required": false, "type": {
                "kind": "array",
                "element": applied_from_entry,
            }},
            {"name": "citations", "required": false, "type": {
                "kind": "array",
                "element": citation.clone(),
            }},
            {"name": "manuallyEdited", "required": false, "type": {"kind": "boolean"}},
            {"name": "migrated", "required": false, "type": {"kind": "boolean"}},
            {"name": "migratedAt", "required": false, "type": {"kind": "string"}},
            {"name": "migratedFrom", "required": false, "type": {"kind": "string"}},
            {"name": "owner", "required": true, "type": {"kind": "string"}},
            {"name": "status", "required": true, "type": authoring_status.clone()},
            {"name": "supersedes", "required": false, "type": {"kind": "string"}},
            {"name": "version", "required": true, "type": {"kind": "string"}},
        ],
    });

    let anchored_section = serde_json::json!({
        "kind": "object",
        "fields": [
            {"name": "anchor", "required": true, "type": {"kind": "string"}},
            {"name": "anchorHash", "required": true, "type": {"kind": "string"}},
            {"name": "body", "required": true, "type": {"kind": "string"}},
            {"name": "citations", "required": false, "type": {
                "kind": "array",
                "element": citation.clone(),
            }},
            {"name": "headingText", "required": true, "type": {"kind": "string"}},
        ],
    });

    let stakeholder_doc = serde_json::json!({
        "kind": "object",
        "fields": [
            {"name": "frontmatter", "required": true, "type": frontmatter.clone()},
            {"name": "kind", "required": true, "type": doc_kind.clone()},
            {"name": "sections", "required": true, "type": {
                "kind": "array",
                "element": anchored_section.clone(),
            }},
        ],
    });

    serde_json::json!({
        "version": STAKEHOLDER_DOC_SCHEMA_VERSION,
        "stakeholderDoc": stakeholder_doc,
        "frontmatter": frontmatter,
        "anchoredSection": anchored_section,
        "anchorKind": anchor_kind,
        "authoringStatus": authoring_status,
        "docKind": doc_kind,
        "appliedFromEntry": applied_from_entry,
        "citation": citation,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provenance::{anchor_hash, quote_hash, QuoteHash};
    use std::path::PathBuf;

    fn workspace_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn schema_version_is_1_0_0() {
        assert_eq!(STAKEHOLDER_DOC_SCHEMA_VERSION, "1.0.0");
    }

    #[test]
    fn writes_stakeholder_docs_fingerprint_file() {
        let dest = workspace_root()
            .join(".derived/schema-parity/rust-stakeholder-doc-schema.json");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        let json = serde_json::to_string_pretty(
            &stakeholder_doc_schema_fingerprint(),
        )
        .unwrap();
        std::fs::write(&dest, json + "\n").unwrap();
    }

    #[test]
    fn anchor_kind_round_trips_all_variants() {
        for k in AnchorKind::ALL {
            assert_eq!(AnchorKind::from_str(k.token()).unwrap(), *k);
        }
    }

    #[test]
    fn anchor_kind_rejects_unknown() {
        let err = AnchorKind::from_str("CONSTRAINT").unwrap_err();
        assert_eq!(
            err,
            StakeholderDocParseError::UnknownAnchorKind("CONSTRAINT".into())
        );
    }

    #[test]
    fn anchor_kind_rejects_lowercase() {
        // The wire format is uppercase; lowercase is a different token.
        AnchorKind::from_str("obj").unwrap_err();
    }

    #[test]
    fn section_anchor_round_trips() {
        let cases = [
            ("OBJ-1", AnchorKind::Obj, 1),
            ("STAKEHOLDER-3", AnchorKind::Stakeholder, 3),
            ("IN-SCOPE-7", AnchorKind::InScope, 7),
            ("OUT-SCOPE-3", AnchorKind::OutScope, 3),
            ("OWNER-12", AnchorKind::Owner, 12),
            ("ASSUMPTION-1", AnchorKind::Assumption, 1),
            ("RISK-9", AnchorKind::Risk, 9),
            ("OUTCOME-2", AnchorKind::Outcome, 2),
        ];
        for (text, kind, idx) in cases {
            let parsed: SectionAnchor = text.parse().unwrap();
            assert_eq!(parsed.kind, kind);
            assert_eq!(parsed.index, idx);
            assert_eq!(parsed.render(), text);
        }
    }

    #[test]
    fn section_anchor_accepts_zero_padded_index() {
        let parsed: SectionAnchor = "OBJ-001".parse().unwrap();
        assert_eq!(parsed.index, 1);
        // Canonical render is unpadded.
        assert_eq!(parsed.render(), "OBJ-1");
    }

    #[test]
    fn section_anchor_rejects_unknown_kind() {
        let err: StakeholderDocParseError = "MILESTONE-1".parse::<SectionAnchor>().unwrap_err();
        assert_eq!(
            err,
            StakeholderDocParseError::UnknownAnchorKind("MILESTONE".into())
        );
    }

    #[test]
    fn section_anchor_rejects_malformed() {
        for bad in ["OBJ", "OBJ-", "OBJ-abc", "-1", "1-OBJ"] {
            assert!(
                bad.parse::<SectionAnchor>().is_err(),
                "should reject {bad}"
            );
        }
    }

    #[test]
    fn section_anchor_serde_string_form() {
        let a = SectionAnchor::new(AnchorKind::InScope, 7);
        let j = serde_json::to_value(&a).unwrap();
        assert_eq!(j.as_str(), Some("IN-SCOPE-7"));
        let back: SectionAnchor = serde_json::from_value(j).unwrap();
        assert_eq!(back, a);
    }

    #[test]
    fn semver_bump_patch() {
        let v = SemVer("1.0.0".into());
        assert_eq!(v.bump_patch().unwrap().0, "1.0.1");
        let v2 = SemVer("2.3.7".into());
        assert_eq!(v2.bump_patch().unwrap().0, "2.3.8");
    }

    #[test]
    fn semver_rejects_malformed() {
        let v = SemVer("not.a.semver".into());
        assert!(v.bump_patch().is_err());
        let v2 = SemVer("1.0".into());
        assert!(v2.bump_patch().is_err());
    }

    #[test]
    fn semver_is_above_initial_boundary_cases() {
        // The lint defaults missing `version` keys to "0.0.0" so the 0.x
        // family must stay below-initial. The 1.0.0 boundary itself is
        // also below-initial — a 1.0.0 doc is the canonical seed-once
        // commit (W-122-002 silent).
        assert!(!SemVer("0.0.0".into()).is_above_initial());
        assert!(!SemVer("0.9.9".into()).is_above_initial());
        assert!(!SemVer("1.0.0".into()).is_above_initial());
        assert!(SemVer("1.0.1".into()).is_above_initial());
        assert!(SemVer("1.1.0".into()).is_above_initial());
        assert!(SemVer("2.0.0".into()).is_above_initial());
        // Malformed versions stay false (we don't false-flag W-122-002
        // on a doc whose semver itself is broken — that's a separate
        // class of issue).
        assert!(!SemVer("not-a-semver".into()).is_above_initial());
    }

    fn sample_citation() -> Citation {
        let q = "60+ forms returned for correction per cycle";
        Citation {
            source: PathBuf::from("extracted/business-case.docx.txt"),
            line_range: (21, 23),
            quote: q.to_string(),
            quote_hash: QuoteHash(quote_hash(q).0),
        }
    }

    fn sample_section() -> AnchoredSection {
        let heading = "Reduce form-correction cycles by 50%";
        AnchoredSection::new(
            SectionAnchor::new(AnchorKind::Obj, 1),
            heading,
            "Body of the OBJ-1 section.",
            vec![sample_citation()],
        )
    }

    #[test]
    fn anchored_section_uses_spec_121_anchor_hash_unchanged() {
        let s = sample_section();
        // FR-027 binds: the AnchoredSection constructor MUST call
        // factory_contracts::provenance::anchor_hash directly. This
        // test pins the equivalence so a future drift to a local
        // normalisation fails at cargo test.
        assert_eq!(
            s.anchor_hash,
            anchor_hash("Reduce form-correction cycles by 50%"),
        );
    }

    #[test]
    fn stakeholder_doc_round_trip() {
        let doc = StakeholderDoc {
            kind: DocKind::Charter,
            frontmatter: StakeholderFrontmatter {
                status: AuthoringStatus::Authored,
                owner: "a-pmo@example.com".into(),
                version: SemVer("1.0.0".into()),
                supersedes: None,
                citations: vec![],
                migrated: false,
                migrated_at: None,
                migrated_from: None,
                applied_from: vec![],
                manually_edited: false,
            },
            sections: vec![sample_section()],
        };
        let j = serde_json::to_string(&doc).unwrap();
        let back: StakeholderDoc = serde_json::from_str(&j).unwrap();
        assert_eq!(doc, back);
    }

    #[test]
    fn stakeholder_doc_serde_emits_camel_case() {
        let doc = StakeholderDoc {
            kind: DocKind::ClientDocument,
            frontmatter: StakeholderFrontmatter {
                status: AuthoringStatus::Authored,
                owner: "owner".into(),
                version: SemVer("1.0.0".into()),
                supersedes: None,
                citations: vec![],
                migrated: true,
                migrated_at: Some(
                    chrono::Utc
                        .with_ymd_and_hms(2026, 4, 30, 0, 0, 0)
                        .unwrap(),
                ),
                migrated_from: Some(PathBuf::from(
                    "requirements/client/client-document.md",
                )),
                applied_from: vec![],
                manually_edited: false,
            },
            sections: vec![],
        };
        let j = serde_json::to_value(&doc).unwrap();
        assert_eq!(
            j["kind"].as_str(),
            Some("client-document"),
            "DocKind serialises kebab-case",
        );
        assert!(j["frontmatter"]["migratedAt"].is_string());
        assert!(j["frontmatter"]["migratedFrom"].is_string());
        assert_eq!(j["frontmatter"]["status"].as_str(), Some("authored"));
    }

    #[test]
    fn applied_from_serialises_camel_case() {
        let entry = AppliedFromEntry {
            run_id: "run-001".into(),
            candidate_path: PathBuf::from(
                "runs/run-001/charter.candidate.md",
            ),
            from_hash: AnchorHash("aaa".into()),
            to_hash: AnchorHash("bbb".into()),
            actor: "operator@example.com".into(),
            applied_at: chrono::Utc
                .with_ymd_and_hms(2026, 4, 30, 12, 0, 0)
                .unwrap(),
        };
        let j = serde_json::to_value(&entry).unwrap();
        assert!(j.get("runId").is_some());
        assert!(j.get("candidatePath").is_some());
        assert!(j.get("fromHash").is_some());
        assert!(j.get("toHash").is_some());
        assert!(j.get("appliedAt").is_some());
    }

    #[test]
    fn fingerprint_carries_schema_version() {
        let fp = stakeholder_doc_schema_fingerprint();
        assert_eq!(
            fp["version"],
            serde_json::json!(STAKEHOLDER_DOC_SCHEMA_VERSION)
        );
    }

    #[test]
    fn fingerprint_drift_is_detected() {
        // Deliberate-drift regression — mirrors the provenance.rs and
        // knowledge.rs sanity checks. A perturbed fingerprint must NOT
        // compare equal to the baseline.
        let baseline = stakeholder_doc_schema_fingerprint();
        let mut drifted = baseline.clone();
        drifted["stakeholderDoc"]["fields"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "name": "syntheticDrift",
                "required": true,
                "type": {"kind": "string"},
            }));
        assert_ne!(baseline, drifted);
    }

    use chrono::TimeZone;
}
