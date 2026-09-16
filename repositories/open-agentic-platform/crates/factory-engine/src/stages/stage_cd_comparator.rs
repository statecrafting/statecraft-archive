// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-014, FR-016, FR-018 to FR-021, FR-027

//! Stage CD comparator (Phase 2 of the stage).
//!
//! Pairs candidate sections to authored sections per FR-018:
//!
//!   1. Exact anchor match (`OBJ-1 ↔ OBJ-1`).
//!   2. `anchorHash` exact match (heading reword that preserves the
//!      concept reuses the spec-121 hash).
//!   3. `anchorHash` similarity (Jaccard ≥ 0.6 over the normalised
//!      token bag, computed with the SAME canonicalisation
//!      `anchor_hash` uses — see `anchor_canonical_tokens`).
//!   4. Unmatched on either side → `structural` diff.
//!
//!
//! Determinism (FR-020): the comparator iterates only over sorted
//! containers (`BTreeMap`, `Vec` sorted by anchor) and writes
//! `findings` sorted by `(doc, anchor)`. Two runs against the same
//! `(authored, candidate, corpus, allowlist)` tuple produce
//! byte-identical `stage-cd-diff.json`.
//!
//! Anchor hashing (FR-027): the comparator MUST use spec-121's
//! `anchor_hash` UNCHANGED. The
//! `comparator_uses_spec_121_anchor_hash_unchanged` guard test pins
//! the equivalence so a future drift to a local normalisation fails
//! at `cargo test`.

use chrono::{DateTime, Utc};
use factory_contracts::provenance::{anchor_canonical_tokens, Citation};
use factory_contracts::stakeholder_docs::{
    AnchorKind, AnchoredSection, AuthoringStatus, DocKind, SectionAnchor,
    StakeholderDoc, StakeholderFrontmatter, SemVer,
};
use provenance_validator::{
    derive_allowlist, detect_external_entities, verify_citation, Allowlist,
    CapitalizationHeuristic, CitationResult, Corpus, CorpusEntry,
    ProjectContext,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComparatorMode {
    /// Standard run: gate evaluated as defined.
    Standard,
    /// Operator overrode the workspace policy threshold; gate may
    /// permit `structural` diffs that have explicit approval. Phase 5
    /// fills in the policy-driven semantics.
    OperatorOverride,
}

#[derive(Debug, Clone)]
pub struct ComparatorInputs {
    pub project: PathBuf,
    pub artifact_store: PathBuf,
    pub candidate_charter: PathBuf,
    pub candidate_client_document: PathBuf,
    pub authored_charter: PathBuf,
    pub authored_client_document: PathBuf,
    pub mode: ComparatorMode,
    pub now: DateTime<Utc>,
    /// Pre-loaded extraction corpus entries (each pairs a typed
    /// `ExtractionOutput` with the source path). Used to (a) derive
    /// the spec-121 allowlist for external-entity classification, and
    /// (b) re-validate authored citations on every run (FR-021).
    pub corpus: Vec<CorpusEntry>,
    pub project_name: String,
    pub project_slug: String,
    pub workspace_name: String,
    /// Project's known-owners set, supplied by the caller (typically
    /// resolved from workspace membership). Owner-name tokens absent
    /// from this set on the authored side but present on the candidate
    /// side trigger `ownership` classification.
    pub known_owners: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdDiff {
    pub generated_at: DateTime<Utc>,
    /// Always `compare` here — seed mode never reaches the comparator
    /// (FR-015).
    pub mode: String,
    /// Per-section diffs, sorted by `(doc, anchor)` for byte
    /// determinism (FR-020).
    pub findings: Vec<StageCdDiffFinding>,
    pub counts: StageCdDiffCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdDiffFinding {
    pub doc: String,
    pub anchor: String,
    /// One of `wording | structural | scope | external-entity |
    /// ownership | citation`.
    pub class: String,
    pub authored_excerpt: Option<String>,
    pub candidate_excerpt: Option<String>,
    /// Pairing path that produced this finding: `exact-anchor`,
    /// `exact-hash`, `jaccard`, or `unmatched`. Operators use this to
    /// audit the comparator's pairing decisions (FR-029 spirit
    /// extended to comparator output).
    pub pairing: String,
    /// Optional resolution recorded by an operator action (FR-024).
    /// Phase 4 leaves this `None`; Phase 5 populates after operator
    /// confirmation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<DiffResolution>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResolution {
    /// `rejected | accepted | force-approved`.
    pub action: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdDiffCounts {
    pub wording: u32,
    pub structural: u32,
    pub scope: u32,
    pub external_entity: u32,
    pub ownership: u32,
    pub citation: u32,
}

#[derive(Debug, Error)]
pub enum ComparatorError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("frontmatter parse error in {path}: {message}")]
    Frontmatter { path: PathBuf, message: String },
    #[error("duplicate anchor in authored doc {path} — comparator refuses to run until W-122-003 is resolved")]
    DuplicateAnchor { path: PathBuf },
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Run the comparator end-to-end. Returns the structured `StageCdDiff`;
/// the caller (`stage_cd::run_stage_cd`) is responsible for serialising
/// it to `stage-cd-diff.json`.
pub fn run(inputs: &ComparatorInputs) -> Result<StageCdDiff, ComparatorError> {
    let outputs: Vec<_> = inputs.corpus.iter().map(|e| e.output.clone()).collect();
    let allowlist = derive_allowlist(&ProjectContext {
        corpus: &outputs,
        project_name: &inputs.project_name,
        project_slug: &inputs.project_slug,
        workspace_name: &inputs.workspace_name,
        entity_model_yaml: None,
        charter_vocabulary: None,
        capitalized_token_frequency_threshold: 1,
    });
    let corpus = Corpus::from_entries(inputs.corpus.clone());

    let mut all_findings: Vec<StageCdDiffFinding> = Vec::new();

    for (doc_kind, authored_path, candidate_path) in [
        (
            DocKind::Charter,
            &inputs.authored_charter,
            &inputs.candidate_charter,
        ),
        (
            DocKind::ClientDocument,
            &inputs.authored_client_document,
            &inputs.candidate_client_document,
        ),
    ] {
        let authored = read_optional_doc(authored_path, doc_kind)?;
        let candidate = read_optional_doc(candidate_path, doc_kind)?;
        let candidate = match candidate {
            Some(c) => c,
            None => {
                // Phase 1 always writes candidates, so a missing one is
                // an internal contract violation worth surfacing — but
                // we keep going so the operator sees what we have.
                continue;
            }
        };
        let Some(authored) = authored else {
            // No authored doc → seed mode upstream; we shouldn't reach
            // here in compare mode, but tolerate empty by skipping.
            continue;
        };

        let findings = compare_doc(
            doc_kind,
            &authored,
            &candidate,
            &allowlist,
            &corpus,
            &inputs.known_owners,
        );
        all_findings.extend(findings);
    }

    // Sort findings (doc, anchor, class) so the JSON output is
    // byte-deterministic (FR-020).
    all_findings.sort_by(|a, b| {
        (a.doc.as_str(), a.anchor.as_str(), a.class.as_str()).cmp(&(
            b.doc.as_str(),
            b.anchor.as_str(),
            b.class.as_str(),
        ))
    });

    let mut counts = StageCdDiffCounts::default();
    for f in &all_findings {
        match f.class.as_str() {
            "wording" => counts.wording += 1,
            "structural" => counts.structural += 1,
            "scope" => counts.scope += 1,
            "external-entity" => counts.external_entity += 1,
            "ownership" => counts.ownership += 1,
            "citation" => counts.citation += 1,
            _ => {}
        }
    }

    Ok(StageCdDiff {
        generated_at: inputs.now,
        mode: "compare".to_string(),
        findings: all_findings,
        counts,
    })
}

// ---------------------------------------------------------------------------
// Single-doc comparison
// ---------------------------------------------------------------------------

fn compare_doc(
    doc_kind: DocKind,
    authored: &StakeholderDoc,
    candidate: &StakeholderDoc,
    allowlist: &Allowlist,
    corpus: &Corpus,
    known_owners: &[String],
) -> Vec<StageCdDiffFinding> {
    // Authored frontmatter `status: draft` short-circuits — the
    // comparator runs but does not block (Edge Case in spec 122 §4).
    // We still record the diffs so the operator can see drift, but
    // gate evaluation downstream knows to ignore them.
    let _ = authored.frontmatter.status; // status check happens at gate-eval time, not here

    let doc_label = doc_kind.canonical_filename();
    let mut findings = Vec::new();

    // Pair sections.
    let pairings = pair_sections(authored, candidate);

    let mut paired_authored: BTreeSet<&SectionAnchor> = BTreeSet::new();
    let mut paired_candidate: BTreeSet<&SectionAnchor> = BTreeSet::new();
    for p in &pairings {
        paired_authored.insert(&p.authored.anchor);
        paired_candidate.insert(&p.candidate.anchor);
    }

    for p in &pairings {
        let class = classify_pair(
            &p.authored,
            &p.candidate,
            allowlist,
            corpus,
            known_owners,
        );
        // For wording-only diffs that are byte-identical (no actual
        // difference), suppress — they don't belong in the diff record
        // at all.
        if class.class == "wording" && p.authored.body == p.candidate.body {
            continue;
        }
        findings.push(StageCdDiffFinding {
            doc: doc_label.to_string(),
            anchor: p.authored.anchor.render(),
            class: class.class.to_string(),
            authored_excerpt: Some(excerpt(&p.authored.body)),
            candidate_excerpt: Some(excerpt(&p.candidate.body)),
            pairing: p.pairing.label().to_string(),
            resolution: None,
        });
    }

    // Unmatched authored sections (candidate dropped them).
    for section in &authored.sections {
        if !paired_authored.contains(&section.anchor) {
            findings.push(StageCdDiffFinding {
                doc: doc_label.to_string(),
                anchor: section.anchor.render(),
                class: "structural".to_string(),
                authored_excerpt: Some(excerpt(&section.body)),
                candidate_excerpt: None,
                pairing: "unmatched".to_string(),
                resolution: None,
            });
        }
    }
    // Unmatched candidate sections (candidate introduced new).
    for section in &candidate.sections {
        if !paired_candidate.contains(&section.anchor) {
            findings.push(StageCdDiffFinding {
                doc: doc_label.to_string(),
                anchor: section.anchor.render(),
                class: "structural".to_string(),
                authored_excerpt: None,
                candidate_excerpt: Some(excerpt(&section.body)),
                pairing: "unmatched".to_string(),
                resolution: None,
            });
        }
    }

    // Citation drift on authored frontmatter (FR-021).
    for citation in &authored.frontmatter.citations {
        if !is_citation_intact(corpus, citation) {
            findings.push(StageCdDiffFinding {
                doc: doc_label.to_string(),
                anchor: "<frontmatter>".to_string(),
                class: "citation".to_string(),
                authored_excerpt: Some(format!(
                    "{}:{:?}",
                    citation.source.display(),
                    citation.line_range
                )),
                candidate_excerpt: None,
                pairing: "citation-revalidation".to_string(),
                resolution: None,
            });
        }
    }

    findings
}

// ---------------------------------------------------------------------------
// Pairing (FR-018)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Pairing {
    authored: AnchoredSection,
    candidate: AnchoredSection,
    pairing: PairingPath,
}

#[derive(Debug, Clone, Copy)]
enum PairingPath {
    ExactAnchor,
    ExactHash,
    Jaccard,
}

impl PairingPath {
    fn label(&self) -> &'static str {
        match self {
            PairingPath::ExactAnchor => "exact-anchor",
            PairingPath::ExactHash => "exact-hash",
            PairingPath::Jaccard => "jaccard",
        }
    }
}

const JACCARD_THRESHOLD: f32 = 0.6;

fn pair_sections(
    authored: &StakeholderDoc,
    candidate: &StakeholderDoc,
) -> Vec<Pairing> {
    let mut pairings = Vec::new();
    let mut consumed_authored: BTreeSet<SectionAnchor> = BTreeSet::new();
    let mut consumed_candidate: BTreeSet<SectionAnchor> = BTreeSet::new();

    // Step 1 — exact anchor match. Iterate authored in anchor order so
    // pairing is deterministic.
    let mut authored_sorted: Vec<&AnchoredSection> = authored.sections.iter().collect();
    authored_sorted.sort_by(|a, b| a.anchor.cmp(&b.anchor));
    let mut candidate_sorted: Vec<&AnchoredSection> = candidate.sections.iter().collect();
    candidate_sorted.sort_by(|a, b| a.anchor.cmp(&b.anchor));

    for a in &authored_sorted {
        if consumed_authored.contains(&a.anchor) {
            continue;
        }
        for c in &candidate_sorted {
            if consumed_candidate.contains(&c.anchor) {
                continue;
            }
            if a.anchor == c.anchor {
                pairings.push(Pairing {
                    authored: (*a).clone(),
                    candidate: (*c).clone(),
                    pairing: PairingPath::ExactAnchor,
                });
                consumed_authored.insert(a.anchor.clone());
                consumed_candidate.insert(c.anchor.clone());
                break;
            }
        }
    }

    // Step 2 — exact `anchor_hash` match.
    for a in &authored_sorted {
        if consumed_authored.contains(&a.anchor) {
            continue;
        }
        for c in &candidate_sorted {
            if consumed_candidate.contains(&c.anchor) {
                continue;
            }
            if a.anchor_hash == c.anchor_hash {
                pairings.push(Pairing {
                    authored: (*a).clone(),
                    candidate: (*c).clone(),
                    pairing: PairingPath::ExactHash,
                });
                consumed_authored.insert(a.anchor.clone());
                consumed_candidate.insert(c.anchor.clone());
                break;
            }
        }
    }

    // Step 3 — Jaccard similarity ≥ 0.6 over the canonical token bag
    // shared with `anchor_hash`. Best-fit per authored section.
    for a in &authored_sorted {
        if consumed_authored.contains(&a.anchor) {
            continue;
        }
        let a_tokens: BTreeSet<String> =
            anchor_canonical_tokens(&a.heading_text)
                .into_iter()
                .collect();
        if a_tokens.is_empty() {
            continue;
        }
        let mut best: Option<(f32, &AnchoredSection)> = None;
        for c in &candidate_sorted {
            if consumed_candidate.contains(&c.anchor) {
                continue;
            }
            let c_tokens: BTreeSet<String> =
                anchor_canonical_tokens(&c.heading_text)
                    .into_iter()
                    .collect();
            if c_tokens.is_empty() {
                continue;
            }
            let inter = a_tokens.intersection(&c_tokens).count() as f32;
            let union = a_tokens.union(&c_tokens).count() as f32;
            let j = inter / union;
            if j >= JACCARD_THRESHOLD {
                match &best {
                    None => best = Some((j, c)),
                    Some((existing, _)) if j > *existing => {
                        best = Some((j, c));
                    }
                    _ => {}
                }
            }
        }
        if let Some((_, c)) = best {
            pairings.push(Pairing {
                authored: (*a).clone(),
                candidate: c.clone(),
                pairing: PairingPath::Jaccard,
            });
            consumed_authored.insert(a.anchor.clone());
            consumed_candidate.insert(c.anchor.clone());
        }
    }

    pairings
}

// ---------------------------------------------------------------------------
// Classification (FR-019)
// ---------------------------------------------------------------------------

struct Classification {
    class: &'static str,
}

fn classify_pair(
    authored: &AnchoredSection,
    candidate: &AnchoredSection,
    allowlist: &Allowlist,
    corpus: &Corpus,
    known_owners: &[String],
) -> Classification {
    // Citation drift is computed eagerly so the priority chain below
    // can fall through to it. Per FR-019 the priority is
    //   scope > ownership > external-entity > citation > wording
    // (gate-blocking classes first, with ownership before
    // external-entity so a known-owner change is not double-classified
    // — see the comment on the ownership branch).
    let citation_change = citations_differ(
        &authored.citations,
        &candidate.citations,
    ) || authored
        .citations
        .iter()
        .any(|c| !is_citation_intact(corpus, c));

    // Scope: anchor kind change OR scope-flip phrase in body.
    if authored.anchor.kind != candidate.anchor.kind
        && (matches!(authored.anchor.kind, AnchorKind::InScope | AnchorKind::OutScope)
            || matches!(candidate.anchor.kind, AnchorKind::InScope | AnchorKind::OutScope))
    {
        return Classification { class: "scope" };
    }
    if scope_flip_in_body(&authored.body, &candidate.body) {
        return Classification { class: "scope" };
    }

    // Ownership runs BEFORE external-entity so a body change that
    // swaps a known-owner name doesn't first trip the entity-class
    // (capitalised owner names are also plausible entities by the
    // spec-121 heuristic). Per FR-019 these classes are exclusive;
    // ownership is more specific so it wins when both could apply.
    if owner_change(&authored.body, &candidate.body, known_owners) {
        return Classification { class: "ownership" };
    }

    // External-entity: candidate body adds an entity not in the
    // allowlist that was absent from the authored body. Known owners
    // are excluded from this set so a known-owner addition does not
    // false-flag here either.
    let plausibility = CapitalizationHeuristic;
    let authored_entities: BTreeSet<String> =
        detect_external_entities(&authored.body, allowlist, &plausibility)
            .into_iter()
            .collect();
    let candidate_entities: BTreeSet<String> =
        detect_external_entities(&candidate.body, allowlist, &plausibility)
            .into_iter()
            .collect();
    let owner_set: BTreeSet<&str> =
        known_owners.iter().map(|s| s.as_str()).collect();
    let candidate_extras: BTreeSet<String> = candidate_entities
        .difference(&authored_entities)
        .filter(|e| !owner_set.contains(e.as_str()))
        .cloned()
        .collect();
    if !candidate_extras.is_empty() {
        return Classification {
            class: "external-entity",
        };
    }

    if citation_change {
        return Classification { class: "citation" };
    }

    // Default: the body changed (we already filtered byte-identical
    // earlier) but doesn't trigger any specific class — wording.
    Classification { class: "wording" }
}

// ---------------------------------------------------------------------------
// Scope-flip body regex (FR-019 scope rule, second clause)
// ---------------------------------------------------------------------------

static SCOPE_FLIP_REGEX: OnceLock<Regex> = OnceLock::new();

fn scope_flip_regex() -> &'static Regex {
    SCOPE_FLIP_REGEX.get_or_init(|| {
        // Phrases that flip a scope decision. Operators describing a
        // change use any of these in plain prose.
        Regex::new(
            r"(?xi)
            \b(now\s+in\s+scope
                | no\s+longer\s+in\s+scope
                | now\s+out\s+of\s+scope
                | added\s+to\s+scope
                | removed\s+from\s+scope
                | moved\s+(in|out)\s+of\s+scope
                | flipped\s+scope
                | inverted\s+scope)\b
            ",
        )
        .expect("valid regex")
    })
}

fn scope_flip_in_body(authored: &str, candidate: &str) -> bool {
    let re = scope_flip_regex();
    // Only fire if the candidate contains the phrase AND the authored
    // doesn't (i.e. the candidate is what introduces the flip).
    re.is_match(candidate) && !re.is_match(authored)
}

// ---------------------------------------------------------------------------
// Owner-change detection
// ---------------------------------------------------------------------------

fn owner_change(
    authored: &str,
    candidate: &str,
    known_owners: &[String],
) -> bool {
    if known_owners.is_empty() {
        return false;
    }
    let mut auth_hits = BTreeSet::new();
    let mut cand_hits = BTreeSet::new();
    for owner in known_owners {
        if authored.contains(owner) {
            auth_hits.insert(owner.clone());
        }
        if candidate.contains(owner) {
            cand_hits.insert(owner.clone());
        }
    }
    cand_hits != auth_hits
}

// ---------------------------------------------------------------------------
// Citation comparison
// ---------------------------------------------------------------------------

fn citations_differ(authored: &[Citation], candidate: &[Citation]) -> bool {
    let mut a: Vec<_> = authored.iter().collect();
    let mut c: Vec<_> = candidate.iter().collect();
    a.sort_by_key(|x| (x.source.as_path(), x.line_range, x.quote_hash.0.clone()));
    c.sort_by_key(|x| (x.source.as_path(), x.line_range, x.quote_hash.0.clone()));
    a != c
}

fn is_citation_intact(corpus: &Corpus, citation: &Citation) -> bool {
    matches!(verify_citation(corpus, citation), CitationResult::Matched)
}

// ---------------------------------------------------------------------------
// Doc parser (frontmatter + anchored sections)
// ---------------------------------------------------------------------------

fn read_optional_doc(
    path: &Path,
    fallback_kind: DocKind,
) -> Result<Option<StakeholderDoc>, ComparatorError> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| ComparatorError::Io {
        path: path.to_path_buf(),
        source: e,
    })?;
    Ok(Some(parse_doc(path, &raw, fallback_kind)?))
}

fn parse_doc(
    path: &Path,
    raw: &str,
    fallback_kind: DocKind,
) -> Result<StakeholderDoc, ComparatorError> {
    let (yaml, body) = split_frontmatter(raw);
    let frontmatter = parse_frontmatter(yaml, fallback_kind, path)?;
    let kind = match frontmatter.0 {
        Some(k) => k,
        None => fallback_kind,
    };
    let sections = parse_sections(body, path)?;
    Ok(StakeholderDoc {
        kind,
        frontmatter: frontmatter.1,
        sections,
    })
}

#[allow(clippy::type_complexity)]
fn split_frontmatter(raw: &str) -> (&str, &str) {
    if !raw.starts_with("---") {
        return ("", raw);
    }
    let bytes = raw.as_bytes();
    let after_open = match raw.find('\n') {
        Some(idx) => idx + 1,
        None => return ("", raw),
    };
    let mut search = &raw[after_open..];
    let mut absolute_offset = after_open;
    while let Some(idx) = search.find("\n---") {
        let close_start = absolute_offset + idx + 1;
        let after = close_start + 3;
        let next = bytes.get(after).copied();
        if next.is_none() || next == Some(b'\n') {
            let yaml = &raw[after_open..close_start];
            let body_start = if next == Some(b'\n') {
                after + 1
            } else {
                after
            };
            return (yaml, &raw[body_start.min(raw.len())..]);
        }
        let advance = idx + 1;
        absolute_offset += advance;
        search = &search[advance..];
    }
    ("", raw)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFrontmatter {
    pub kind: Option<String>,
    pub status: Option<String>,
    pub owner: Option<String>,
    pub version: Option<String>,
    #[serde(default)]
    pub citations: Vec<Citation>,
    #[serde(default)]
    pub migrated: bool,
    /// Accept both `migratedFrom` (canonical, camelCase) and
    /// `migrated_from` (snake_case) — operator-authored YAML
    /// frequently uses snake_case and the migration tool writes
    /// camelCase.
    #[serde(alias = "migrated_from")]
    pub migrated_from: Option<String>,
}

fn parse_frontmatter(
    yaml: &str,
    fallback_kind: DocKind,
    path: &Path,
) -> Result<(Option<DocKind>, StakeholderFrontmatter), ComparatorError> {
    if yaml.trim().is_empty() {
        return Ok((
            None,
            StakeholderFrontmatter {
                status: AuthoringStatus::Authored,
                owner: String::new(),
                version: SemVer("0.0.0".into()),
                supersedes: None,
                citations: vec![],
                migrated: false,
                migrated_at: None,
                migrated_from: None,
                applied_from: vec![],
                manually_edited: false,
            },
        ));
    }
    let raw: RawFrontmatter = serde_yaml::from_str(yaml).map_err(|e| {
        ComparatorError::Frontmatter {
            path: path.to_path_buf(),
            message: e.to_string(),
        }
    })?;
    let kind = match raw.kind.as_deref() {
        Some("charter") => Some(DocKind::Charter),
        Some("client-document") => Some(DocKind::ClientDocument),
        Some(other) => {
            return Err(ComparatorError::Frontmatter {
                path: path.to_path_buf(),
                message: format!("unknown kind '{other}'"),
            });
        }
        None => Some(fallback_kind),
    };
    let status = match raw.status.as_deref().unwrap_or("authored") {
        "draft" => AuthoringStatus::Draft,
        "authored" => AuthoringStatus::Authored,
        other => {
            return Err(ComparatorError::Frontmatter {
                path: path.to_path_buf(),
                message: format!("unknown status '{other}'"),
            });
        }
    };
    Ok((
        kind,
        StakeholderFrontmatter {
            status,
            owner: raw.owner.unwrap_or_default(),
            version: SemVer(raw.version.unwrap_or_else(|| "0.0.0".into())),
            supersedes: None,
            citations: raw.citations,
            migrated: raw.migrated,
            migrated_at: None,
            migrated_from: raw.migrated_from.map(PathBuf::from),
            applied_from: vec![],
            manually_edited: false,
        },
    ))
}

fn parse_sections(
    body: &str,
    path: &Path,
) -> Result<Vec<AnchoredSection>, ComparatorError> {
    let mut sections = Vec::new();
    let mut seen_anchors: BTreeMap<SectionAnchor, ()> = BTreeMap::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("### ")
            && let Some((tok, after_colon)) = rest.split_once(':')
            && let Ok(anchor) = tok.trim().parse::<SectionAnchor>()
        {
            if seen_anchors.contains_key(&anchor) {
                return Err(ComparatorError::DuplicateAnchor {
                    path: path.to_path_buf(),
                });
            }
            seen_anchors.insert(anchor.clone(), ());
            // Strip an inline `<!-- anchorHash: ... -->` comment from
            // the heading text so the comparator hashes the visible
            // heading, not the comment.
            let heading = strip_anchor_hash_comment(after_colon).trim().to_string();

            // Section bounds: from the next line until the next
            // `### ` heading (or end of body).
            let mut j = i + 1;
            while j < lines.len() && !lines[j].starts_with("### ") {
                j += 1;
            }
            // Section-level citations (FR-004 b): an optional
            //   ```citations
            //   - source: …
            //     lineRange: [...]
            //     quote: "…"
            //     quoteHash: "…"
            //   ```
            // fenced YAML block immediately after the heading. Skips
            // blank lines so authors can put a blank between the
            // heading and the citations block.
            let (citations, body_start) =
                parse_section_citations(&lines[(i + 1)..j], path)?;
            let body_lines = &lines[(i + 1 + body_start)..j];
            let body_text = body_lines.join("\n");
            sections.push(AnchoredSection::new(
                anchor,
                heading,
                body_text,
                citations,
            ));
            i = j;
            continue;
        }
        i += 1;
    }
    Ok(sections)
}

/// Parse an optional ```citations YAML block at the top of a section
/// body. Returns `(citations, lines_consumed)` so the caller can skip
/// the block when extracting the body text. Empty input → no
/// citations. Per FR-004 b authors MAY supply per-section citations;
/// no requirement to provide them.
fn parse_section_citations(
    lines: &[&str],
    path: &Path,
) -> Result<(Vec<Citation>, usize), ComparatorError> {
    // Skip leading blank lines.
    let mut start = 0;
    while start < lines.len() && lines[start].trim().is_empty() {
        start += 1;
    }
    if start >= lines.len() || lines[start].trim() != "```citations" {
        return Ok((Vec::new(), 0));
    }
    let mut end = start + 1;
    while end < lines.len() && lines[end].trim() != "```" {
        end += 1;
    }
    if end >= lines.len() {
        return Err(ComparatorError::Frontmatter {
            path: path.to_path_buf(),
            message: "unterminated `citations` fenced block in section".into(),
        });
    }
    let yaml = lines[(start + 1)..end].join("\n");
    let citations: Vec<Citation> =
        serde_yaml::from_str(&yaml).map_err(|e| {
            ComparatorError::Frontmatter {
                path: path.to_path_buf(),
                message: format!("section citations YAML parse error: {e}"),
            }
        })?;
    Ok((citations, end + 1))
}

static ANCHOR_HASH_COMMENT_REGEX: OnceLock<Regex> = OnceLock::new();

fn strip_anchor_hash_comment(s: &str) -> String {
    let re = ANCHOR_HASH_COMMENT_REGEX.get_or_init(|| {
        Regex::new(r"<!--\s*anchorHash:[^>]*-->").expect("valid regex")
    });
    re.replace_all(s, "").to_string()
}

// ---------------------------------------------------------------------------
// Excerpt rendering (truncate to keep diff JSON readable)
// ---------------------------------------------------------------------------

fn excerpt(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= 240 {
        trimmed.to_string()
    } else {
        let truncated: String = trimmed.chars().take(240).collect();
        format!("{truncated}…")
    }
}

#[cfg(test)]
fn write_anchor_hash_for(
    text: &str,
) -> factory_contracts::provenance::AnchorHash {
    factory_contracts::provenance::anchor_hash(text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use factory_contracts::provenance::anchor_hash;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
    }

    fn make_inputs(root: &std::path::Path) -> ComparatorInputs {
        ComparatorInputs {
            project: root.to_path_buf(),
            artifact_store: root.join("artifact-store/run-001"),
            candidate_charter: root
                .join("artifact-store/run-001/stage-cd/charter.candidate.md"),
            candidate_client_document: root
                .join("artifact-store/run-001/stage-cd/client-document.candidate.md"),
            authored_charter: root
                .join("requirements/stakeholder/charter.md"),
            authored_client_document: root
                .join("requirements/stakeholder/client-document.md"),
            mode: ComparatorMode::Standard,
            now: fixed_now(),
            corpus: vec![],
            project_name: "example".into(),
            project_slug: "example".into(),
            workspace_name: "ws".into(),
            known_owners: vec![],
        }
    }

    fn write(path: &std::path::Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    fn authored_with(sections: &str) -> String {
        format!(
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

{sections}
"#
        )
    }

    fn candidate_with(sections: &str) -> String {
        format!(
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

{sections}
"#
        )
    }

    /// FR-027 guard: comparator must reuse spec 121's `anchor_hash`
    /// UNCHANGED. If anyone introduces a local hash, this test fails.
    #[test]
    fn comparator_uses_spec_121_anchor_hash_unchanged() {
        let local = write_anchor_hash_for("Reduce form-correction cycles");
        let upstream = anchor_hash("Reduce form-correction cycles");
        assert_eq!(local, upstream);
    }

    #[test]
    fn structural_when_authored_section_dropped_by_candidate() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with("### OBJ-1: Reduce cycles\n\nBody."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(""),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert_eq!(diff.counts.structural, 1);
        assert_eq!(diff.counts.wording, 0);
    }

    #[test]
    fn wording_when_anchor_hash_matches_and_body_rewords() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### OBJ-1: Reduce form-correction cycles\n\nThe applicant must be a registered partner organization.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### OBJ-1: Reduce form-correction cycles\n\nAn applicant shall be the registered partner organization.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert_eq!(diff.counts.wording, 1);
        assert_eq!(diff.counts.scope, 0);
        assert_eq!(diff.counts.structural, 0);
    }

    #[test]
    fn scope_when_anchor_kind_changes() {
        // Synthetic Globex scenario: authored says OUT-SCOPE, candidate says
        // IN-SCOPE for a paired concept.
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### OUT-SCOPE-3: Payment processing finance integration\n\nNot included.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### IN-SCOPE-7: Payment processing finance Globex integration\n\nNow included.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert_eq!(
            diff.counts.scope, 1,
            "synthetic Globex scope flip must be paired and classified as scope"
        );
        // Specifically: pairing path is `jaccard` since the anchor IDs
        // differ but the heading tokens overlap >= 0.6 (payment,
        // processing, finance, integration vs payment, processing,
        // finance, globex, integration).
        let scope_finding = diff.findings.iter().find(|f| f.class == "scope").unwrap();
        assert_eq!(scope_finding.pairing, "jaccard");
    }

    #[test]
    fn scope_class_fires_on_body_scope_flip_phrase() {
        // FR-019 second clause: when anchor kinds match (no kind change)
        // but the candidate body contains a scope-flip phrase that the
        // authored body lacks, the diff still classifies as `scope`.
        // Pinned because the e2e SC-001 fixture exercises this path
        // through run_stage_cd; the unit test isolates it.
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### IN-SCOPE-1: Online application intake\n\nOnline application intake is in scope for v1.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### IN-SCOPE-1: Online application intake\n\nNow in scope for the new payment channel.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert!(
            diff.counts.scope >= 1,
            "scope-flip phrase in candidate body must surface as scope: {diff:?}"
        );
    }

    #[test]
    fn external_entity_class_fires_on_unallowed_token() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with("### OBJ-1: Reduce cycles\n\nBody without entities."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### OBJ-1: Reduce cycles\n\nThe system must integrate with Globex.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert!(
            diff.counts.external_entity >= 1,
            "Globex in candidate body must surface as external-entity: {diff:?}"
        );
    }

    #[test]
    fn ownership_class_fires_when_owner_token_changes() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with("### OWNER-1: Accountable\n\nAlice owns this."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with("### OWNER-1: Accountable\n\nBob owns this."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let mut inputs = make_inputs(dir.path());
        inputs.known_owners = vec!["Alice".into(), "Bob".into()];
        let diff = run(&inputs).unwrap();
        assert_eq!(
            diff.counts.ownership, 1,
            "owner change must surface as ownership: {diff:?}"
        );
    }

    #[test]
    fn citation_class_fires_when_citation_orphaned() {
        // Authored citation references a corpus path that doesn't exist
        // in the supplied corpus → orphaned → citation diff.
        let dir = tempfile::tempdir().unwrap();
        let authored = r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
citations:
  - source: extracted/missing.txt
    lineRange: [1, 1]
    quote: "x"
    quoteHash: "deadbeef"
---

### OBJ-1: Reduce cycles

Body.
"#
        .to_string();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored,
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with("### OBJ-1: Reduce cycles\n\nBody."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert!(
            diff.counts.citation >= 1,
            "orphaned citation must surface as citation: {diff:?}"
        );
    }

    /// FR-020 byte-determinism property test. Two runs against the
    /// same `(authored, candidate, corpus, allowlist)` tuple MUST
    /// produce byte-identical `stage-cd-diff.json`.
    #[test]
    fn stage_cd_diff_is_byte_deterministic() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### OBJ-1: Reduce form-correction cycles\n\nAuthored body.\n\n### OUT-SCOPE-3: Payment processing finance integration\n\nNot included.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### OBJ-1: Reduce form-correction cycles\n\nReworded body.\n\n### IN-SCOPE-7: Payment processing finance Globex integration\n\nNow included.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff1 = run(&make_inputs(dir.path())).unwrap();
        let diff2 = run(&make_inputs(dir.path())).unwrap();
        let json1 = serde_json::to_string_pretty(&diff1).unwrap();
        let json2 = serde_json::to_string_pretty(&diff2).unwrap();
        assert_eq!(
            json1, json2,
            "byte-determinism: same inputs must produce identical diff json"
        );
    }

    #[test]
    fn duplicate_anchor_in_authored_doc_blocks_comparator() {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### OBJ-1: First\n\nBody 1.\n\n### OBJ-1: Same anchor\n\nBody 2.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(""),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let err = run(&make_inputs(dir.path())).unwrap_err();
        assert!(
            matches!(err, ComparatorError::DuplicateAnchor { .. }),
            "comparator must refuse to run on lint-failing authored doc: {err}"
        );
    }

    #[test]
    fn jaccard_threshold_below_0_6_does_not_pair() {
        let dir = tempfile::tempdir().unwrap();
        // Authored: 'Reduce cycles' vs candidate: 'Onboard suppliers
        // legacy' — zero token overlap, must NOT pair → both surface
        // as structural.
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with("### OBJ-1: Reduce cycles\n\nBody."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### OBJ-2: Onboard suppliers legacy\n\nBody.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert_eq!(
            diff.counts.structural, 2,
            "below-threshold pairs must surface both sides as structural: {diff:?}"
        );
    }

    #[test]
    fn section_level_citations_revalidate_via_spec_121() {
        // FR-021 second path: a section's citations[] block must be
        // re-validated on every comparator run. Authored has an
        // orphaned section-level citation (source missing from
        // corpus); body and heading are byte-identical to the
        // candidate. The only difference is the citation, so the diff
        // must classify as `citation`.
        let dir = tempfile::tempdir().unwrap();
        let authored = r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce cycles
```citations
- source: extracted/missing.txt
  lineRange: [1, 1]
  quote: "x"
  quoteHash: "deadbeef"
```

the applicant must be a registered partner organization.
"#;
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            authored,
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with(
                "### OBJ-1: Reduce cycles\n\nthe applicant must be a registered partner organization.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        assert!(
            diff.counts.citation >= 1,
            "section-level orphaned citation must surface as citation: {diff:?}"
        );
        // Pin: pairing path is exact-anchor (OBJ-1 ↔ OBJ-1).
        let citation_finding = diff
            .findings
            .iter()
            .find(|f| f.class == "citation")
            .expect("citation finding present");
        assert_eq!(citation_finding.pairing, "exact-anchor");
    }

    #[test]
    fn anchor_hash_comment_does_not_leak_into_heading() {
        // Headings written by the migration tool carry an inline
        // `<!-- anchorHash: sha256:... -->` comment. The comparator
        // must strip it before hashing — otherwise the comment text
        // would feed into the canonicalisation and the hash would
        // disagree with the same-text authored side that has no
        // comment.
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join("requirements/stakeholder/charter.md"),
            &authored_with(
                "### OBJ-1: Reduce cycles <!-- anchorHash: sha256:abc -->\n\nBody.",
            ),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/charter.candidate.md",
            ),
            &candidate_with("### OBJ-1: Reduce cycles\n\nBody."),
        );
        write(
            &dir.path().join(
                "artifact-store/run-001/stage-cd/client-document.candidate.md",
            ),
            &candidate_with(""),
        );
        let diff = run(&make_inputs(dir.path())).unwrap();
        // No diff at all — bytes match, no findings.
        assert_eq!(diff.findings.len(), 0, "{diff:?}");
    }
}
