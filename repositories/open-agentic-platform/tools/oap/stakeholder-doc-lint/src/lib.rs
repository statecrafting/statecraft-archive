// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-005, FR-034

//! Stakeholder-doc grammar lint (spec 122).
//!
//! Validates authored stakeholder docs (`requirements/stakeholder/charter.md`
//! and `requirements/stakeholder/client-document.md`) against the grammar
//! defined in `factory_contracts::stakeholder_docs`. Emits non-fatal
//! warnings W-122-001 through W-122-005:
//!
//!   * `W-122-001` — section heading without an anchor token.
//!   * `W-122-002` — frontmatter `version` bumped above `1.0.0` without
//!     a corresponding `appliedFrom` chain entry.
//!   * `W-122-003` — duplicate section anchor in the same document. The
//!     comparator MUST refuse to run when this fires (spec 122 FR-028).
//!   * `W-122-004` — citation `source` references a path absent from the
//!     project's artifact store (only checked when `--corpus-dir` is
//!     supplied — without project context, citation paths cannot be
//!     resolved).
//!   * `W-122-005` — section body contains an unallowed external entity
//!     per the spec-121 allowlist (only checked when `--project-name` /
//!     `--corpus-dir` are supplied so the allowlist can be derived).
//!
//! By default the lint exits 0 even when warnings fire (parity with
//! `spec-lint`); `--fail-on-warn` flips to exit 1 for stricter
//! enforcement on `make ci`.
//!
//! The lint reuses spec 121's allowlist derivation pipeline UNCHANGED via
//! `provenance_validator::detect_external_entities`. No alternate
//! external-entity logic exists at the stakeholder-doc layer (FR-019).

use factory_contracts::knowledge::ExtractionOutput;
use factory_contracts::stakeholder_docs::{
    AnchorKind, AnchoredSection, AppliedFromEntry, AuthoringStatus, DocKind,
    SectionAnchor, SemVer, StakeholderDoc, StakeholderDocParseError,
    StakeholderFrontmatter,
};
use factory_contracts::provenance::Citation;
use provenance_validator::{
    derive_allowlist, detect_external_entities, Allowlist,
    CapitalizationHeuristic, ProjectContext,
};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    pub code: &'static str,
    pub path: String,
    pub message: String,
    /// 1-based line number for the offending construct, when available.
    pub line: Option<usize>,
}

/// One stakeholder doc with its parsed grammar shape.
#[derive(Debug, Clone)]
pub struct ParsedDoc {
    pub doc: StakeholderDoc,
}

/// Minimal project context for W-122-004 / W-122-005. When `None`, the
/// lint emits W-122-001..003 only — citation-source and external-entity
/// checks require an artifact store and project metadata.
#[derive(Debug, Clone)]
pub struct LintProjectContext {
    /// Directory the lint should walk for artifact-store files. Citation
    /// `source` paths are interpreted as relative to this dir; W-122-004
    /// fires when the resolved path is absent.
    pub corpus_dir: PathBuf,
    /// Pre-loaded `ExtractionOutput` records used to derive the
    /// spec-121 allowlist. The lint loads them lazily from
    /// `corpus_dir/*.extraction.json` if not pre-supplied.
    pub corpus: Vec<ExtractionOutput>,
    pub project_name: String,
    pub project_slug: String,
    pub workspace_name: String,
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/// Wire-shape of the YAML frontmatter on disk. Mirrors
/// `StakeholderFrontmatter` but uses bare types so optional fields are
/// permissive on parse and the lint can detect missing keys explicitly.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFrontmatter {
    pub status: Option<String>,
    pub owner: Option<String>,
    pub version: Option<String>,
    pub supersedes: Option<String>,
    #[serde(default)]
    pub citations: Vec<Citation>,
    #[serde(default)]
    pub migrated: bool,
    #[serde(default)]
    pub migrated_at: Option<factory_contracts::DateTime<factory_contracts::Utc>>,
    pub migrated_from: Option<String>,
    #[serde(default)]
    pub applied_from: Vec<AppliedFromEntry>,
    #[serde(default)]
    pub manually_edited: bool,
    pub kind: Option<String>,
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Lint every `requirements/stakeholder/*.md` under `project_root`,
/// returning warnings in deterministic order (by path then by line).
pub fn lint_project(
    project_root: &Path,
    ctx: Option<&LintProjectContext>,
) -> Vec<Warning> {
    let stakeholder_dir = project_root.join("requirements/stakeholder");
    let mut all = Vec::new();
    if !stakeholder_dir.is_dir() {
        return all;
    }
    let mut paths: Vec<PathBuf> = walkdir::WalkDir::new(&stakeholder_dir)
        .max_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .collect();
    paths.sort();
    let allowlist = ctx.map(|c| {
        derive_allowlist(&ProjectContext {
            corpus: &c.corpus,
            project_name: &c.project_name,
            project_slug: &c.project_slug,
            workspace_name: &c.workspace_name,
            entity_model_yaml: None,
            charter_vocabulary: None,
            capitalized_token_frequency_threshold: 1,
        })
    });
    let known_sources: Option<HashSet<PathBuf>> = ctx.map(|c| {
        walkdir::WalkDir::new(&c.corpus_dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                e.path().strip_prefix(&c.corpus_dir).ok().map(|p| p.to_path_buf())
            })
            .collect()
    });

    for path in paths {
        let warnings = lint_file(
            project_root,
            &path,
            allowlist.as_ref(),
            known_sources.as_ref(),
        );
        all.extend(warnings);
    }
    all
}

/// Lint a single stakeholder doc. `repo_root` is used only to render
/// relative paths in warning output. `allowlist` and `known_sources` are
/// `None` when the project context is absent (skipping W-122-004/005).
pub fn lint_file(
    repo_root: &Path,
    path: &Path,
    allowlist: Option<&Allowlist>,
    known_sources: Option<&HashSet<PathBuf>>,
) -> Vec<Warning> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rel = render_rel_path(repo_root, path);
    let mut warnings = Vec::new();

    let (parsed, parse_issues) = match parse_doc(path, &raw) {
        Ok(pair) => pair,
        Err(fatal) => {
            // Frontmatter-level failures abort lint for this file (we
            // don't know the doc kind / sections), but every other
            // file in the project still lints.
            for (line, msg) in fatal {
                warnings.push(Warning {
                    code: "W-122-PARSE",
                    path: rel.clone(),
                    message: msg,
                    line: Some(line),
                });
            }
            return warnings;
        }
    };

    // Section-level parse issues (e.g. unknown anchor kind) surface as
    // their own warnings but do NOT suppress W-122-002..005 for the
    // remainder of the file — the operator should see every actionable
    // problem at once instead of drip-feed remediation.
    for (line, msg) in parse_issues {
        warnings.push(Warning {
            code: "W-122-PARSE",
            path: rel.clone(),
            message: msg,
            line: Some(line),
        });
    }

    warnings.extend(check_w_122_001(&rel, &raw));
    warnings.extend(check_w_122_002(&rel, &parsed));
    warnings.extend(check_w_122_003(&rel, &raw));
    if let Some(known) = known_sources {
        warnings.extend(check_w_122_004(&rel, &parsed, known));
    }
    if let Some(al) = allowlist {
        warnings.extend(check_w_122_005(&rel, &parsed, al));
    }

    warnings
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse the markdown file into a `StakeholderDoc`. The `Ok` branch
/// returns the parsed doc plus any non-fatal section-level issues
/// (e.g. unknown anchor kind) so the caller can emit them as
/// `W-122-PARSE` warnings WITHOUT suppressing the W-122-002..005 checks
/// over the remainder of the file. The `Err` branch carries fatal
/// frontmatter-level failures only.
#[allow(clippy::type_complexity)]
fn parse_doc(
    path: &Path,
    raw: &str,
) -> Result<(ParsedDoc, Vec<(usize, String)>), Vec<(usize, String)>> {
    let mut errors = Vec::new();

    // Split frontmatter. The format is `---\n<yaml>\n---\n<body>`.
    let (raw_front, body, frontmatter_end_line) = split_frontmatter(raw)
        .ok_or_else(|| {
            vec![(
                1,
                "missing YAML frontmatter (`---` fence)".to_string(),
            )]
        })?;

    let raw_fm: RawFrontmatter = match serde_yaml::from_str(raw_front) {
        Ok(v) => v,
        Err(e) => {
            errors.push((1, format!("frontmatter parse error: {e}")));
            return Err(errors);
        }
    };

    let kind = match resolve_doc_kind(path, raw_fm.kind.as_deref()) {
        Ok(k) => k,
        Err(msg) => {
            errors.push((1, msg));
            return Err(errors);
        }
    };

    let status = match raw_fm.status.as_deref().unwrap_or("draft") {
        "draft" => AuthoringStatus::Draft,
        "authored" => AuthoringStatus::Authored,
        other => {
            errors.push((
                1,
                format!(
                    "unknown frontmatter status '{}': expected 'draft' or 'authored'",
                    other
                ),
            ));
            return Err(errors);
        }
    };

    let owner = raw_fm.owner.unwrap_or_default();
    let version = SemVer(raw_fm.version.unwrap_or_else(|| "0.0.0".into()));

    let frontmatter = StakeholderFrontmatter {
        status,
        owner,
        version,
        supersedes: raw_fm.supersedes.map(SemVer),
        citations: raw_fm.citations,
        migrated: raw_fm.migrated,
        migrated_at: raw_fm.migrated_at,
        migrated_from: raw_fm.migrated_from.map(PathBuf::from),
        applied_from: raw_fm.applied_from,
        manually_edited: raw_fm.manually_edited,
    };

    let mut section_issues = Vec::new();
    let sections =
        parse_sections(body, frontmatter_end_line, &mut section_issues);

    Ok((
        ParsedDoc {
            doc: StakeholderDoc {
                kind,
                frontmatter,
                sections,
            },
        },
        section_issues,
    ))
}

/// Split `---\nyaml\n---\nbody`, returning `(yaml, body, fm_lines)`
/// where `fm_lines` is the line count consumed by the frontmatter
/// (used to anchor 1-based line numbers in section warnings).
fn split_frontmatter(raw: &str) -> Option<(&str, &str, usize)> {
    let bytes = raw.as_bytes();
    if !raw.starts_with("---") {
        return None;
    }
    let after_open = raw.find('\n')? + 1;
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
            let body = &raw[body_start.min(raw.len())..];
            let fm_lines = raw[..body_start.min(raw.len())]
                .matches('\n')
                .count();
            return Some((yaml, body, fm_lines));
        }
        let advance = idx + 1;
        absolute_offset += advance;
        search = &search[advance..];
    }
    None
}

fn resolve_doc_kind(
    path: &Path,
    declared: Option<&str>,
) -> Result<DocKind, String> {
    if let Some(text) = declared {
        return match text {
            "charter" => Ok(DocKind::Charter),
            "client-document" => Ok(DocKind::ClientDocument),
            other => Err(format!(
                "unknown frontmatter kind '{}': expected 'charter' or 'client-document'",
                other
            )),
        };
    }
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    match filename {
        "charter.md" => Ok(DocKind::Charter),
        "client-document.md" => Ok(DocKind::ClientDocument),
        _ => Err(format!(
            "cannot infer DocKind from filename '{}': supply frontmatter `kind: charter` or `kind: client-document`",
            filename
        )),
    }
}

/// Parse `### <ANCHOR>: <heading>` sections from the body. Anchorless
/// `###` headings are recorded so W-122-001 can flag them; the resulting
/// `AnchoredSection` list omits them (they have no anchor).
fn parse_sections(
    body: &str,
    frontmatter_end_line: usize,
    errors: &mut Vec<(usize, String)>,
) -> Vec<AnchoredSection> {
    let mut out = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("### ") {
            let absolute_line = frontmatter_end_line + i + 1;
            // Try to parse `<ANCHOR>: heading` shape.
            if let Some((anchor_token, heading_text)) = rest.split_once(':') {
                let anchor_token = anchor_token.trim();
                match anchor_token.parse::<SectionAnchor>() {
                    Ok(anchor) => {
                        let heading_text = heading_text.trim().to_string();
                        // Body is everything until the next `### ` or
                        // end of body.
                        let mut j = i + 1;
                        while j < lines.len() && !lines[j].starts_with("### ") {
                            j += 1;
                        }
                        let body_text = lines[(i + 1)..j].join("\n");
                        out.push(AnchoredSection::new(
                            anchor,
                            heading_text,
                            body_text,
                            vec![],
                        ));
                        i = j;
                        continue;
                    }
                    Err(StakeholderDocParseError::UnknownAnchorKind(k)) => {
                        errors.push((
                            absolute_line,
                            format!(
                                "section heading uses unknown anchor kind '{}': V1 set is OBJ, STAKEHOLDER, OUTCOME, IN-SCOPE, OUT-SCOPE, OWNER, ASSUMPTION, RISK",
                                k
                            ),
                        ));
                    }
                    Err(_) => {
                        // Non-anchor heading; W-122-001 picks it up.
                    }
                }
            }
        }
        i += 1;
    }
    out
}

// ---------------------------------------------------------------------------
// Lint rules
// ---------------------------------------------------------------------------

/// W-122-001 — `### ` heading whose first colon-prefix token does not
/// parse as a `SectionAnchor`. Operators may have hand-edited a heading
/// and forgotten the anchor marker.
fn check_w_122_001(rel: &str, raw: &str) -> Vec<Warning> {
    let mut out = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        if !line.starts_with("### ") {
            continue;
        }
        let rest = &line[4..];
        let token = rest.split(':').next().unwrap_or("").trim();
        if token.is_empty() {
            continue;
        }
        if token.parse::<SectionAnchor>().is_err() {
            out.push(Warning {
                code: "W-122-001",
                path: rel.to_string(),
                message: format!(
                    "section heading without anchor: '{}' (expected '### <KIND>-<NNN>: <heading>')",
                    line.trim()
                ),
                line: Some(idx + 1),
            });
        }
    }
    out
}

/// W-122-002 — frontmatter `version` is above `1.0.0` but the
/// `appliedFrom` chain is empty. A version bump without an apply trail
/// is suspicious: either a manual edit happened without governance, or
/// the apply audit was forgotten.
fn check_w_122_002(rel: &str, parsed: &ParsedDoc) -> Vec<Warning> {
    let fm = &parsed.doc.frontmatter;
    if fm.version.is_above_initial() && fm.applied_from.is_empty() {
        return vec![Warning {
            code: "W-122-002",
            path: rel.to_string(),
            message: format!(
                "frontmatter version '{}' is above 1.0.0 but no `appliedFrom` chain is recorded — version bumped without an apply audit",
                fm.version.0
            ),
            line: Some(1),
        }];
    }
    Vec::new()
}

/// W-122-003 — the same `<KIND>-<NNN>` anchor appears twice in the same
/// document. The comparator MUST refuse to run when this fires
/// (FR-028) so the operator resolves the conflict before pairing.
fn check_w_122_003(rel: &str, raw: &str) -> Vec<Warning> {
    let mut counts: BTreeMap<SectionAnchor, Vec<usize>> = BTreeMap::new();
    for (idx, line) in raw.lines().enumerate() {
        if let Some(rest) = line.strip_prefix("### ") {
            if let Some((tok, _)) = rest.split_once(':') {
                if let Ok(anchor) = tok.trim().parse::<SectionAnchor>() {
                    counts
                        .entry(anchor)
                        .or_default()
                        .push(idx + 1);
                }
            }
        }
    }
    let mut out = Vec::new();
    for (anchor, lines) in counts {
        if lines.len() > 1 {
            for line in &lines {
                out.push(Warning {
                    code: "W-122-003",
                    path: rel.to_string(),
                    message: format!(
                        "duplicate anchor '{}' (also at lines {})",
                        anchor.render(),
                        lines
                            .iter()
                            .filter(|l| *l != line)
                            .map(|l| l.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    line: Some(*line),
                });
            }
        }
    }
    out
}

/// W-122-004 — citation references a source path absent from the
/// project's artifact store. `known_sources` carries paths relative to
/// the corpus dir; the lint compares the citation's `source` against
/// that set.
fn check_w_122_004(
    rel: &str,
    parsed: &ParsedDoc,
    known: &HashSet<PathBuf>,
) -> Vec<Warning> {
    let mut out = Vec::new();
    let mut seen: BTreeSet<PathBuf> = BTreeSet::new();
    for citation in parsed.doc.frontmatter.citations.iter().chain(
        parsed.doc.sections.iter().flat_map(|s| s.citations.iter()),
    ) {
        if !seen.insert(citation.source.clone()) {
            continue;
        }
        if !known.contains(&citation.source) {
            out.push(Warning {
                code: "W-122-004",
                path: rel.to_string(),
                message: format!(
                    "citation source '{}' is not present in the artifact store",
                    citation.source.display()
                ),
                line: None,
            });
        }
    }
    out
}

/// W-122-005 — section body contains a token classified as a plausible
/// external entity by the spec-121 capitalisation heuristic AND not in
/// the project allowlist.
fn check_w_122_005(
    rel: &str,
    parsed: &ParsedDoc,
    allowlist: &Allowlist,
) -> Vec<Warning> {
    let plausibility = CapitalizationHeuristic;
    let mut out = Vec::new();
    for section in &parsed.doc.sections {
        let entities = detect_external_entities(
            &section.body,
            allowlist,
            &plausibility,
        );
        if entities.is_empty() {
            continue;
        }
        let kind = section.anchor.kind;
        // OWNER sections legitimately name people/orgs by design — the
        // allowlist won't always cover them. The lint surfaces them as
        // operator-review hints rather than blocking.
        let suffix = if matches!(kind, AnchorKind::Owner) {
            " (review whether each is allowlisted; OWNER sections often legitimately introduce new names)"
        } else {
            ""
        };
        out.push(Warning {
            code: "W-122-005",
            path: rel.to_string(),
            message: format!(
                "section {} body names unallowed external entities: {}{}",
                section.anchor.render(),
                entities.join(", "),
                suffix,
            ),
            line: None,
        });
    }
    out
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn render_rel_path(repo_root: &Path, p: &Path) -> String {
    p.strip_prefix(repo_root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, body: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    fn happy_charter() -> &'static str {
        r#"---
status: authored
owner: pmo@example.com
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce form-correction cycles by 50%

The applicant must be a registered partner organization.

### IN-SCOPE-1: Online application

Online intake is in scope.
"#
    }

    #[test]
    fn happy_charter_emits_no_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(&path, happy_charter());
        let warnings = lint_project(dir.path(), None);
        assert!(
            warnings.iter().all(|w| !w.code.starts_with("W-122-PARSE")),
            "should parse cleanly: {:?}",
            warnings
        );
        assert!(
            warnings.iter().all(|w| {
                !matches!(w.code, "W-122-001" | "W-122-002" | "W-122-003")
            }),
            "happy doc should not emit anchor/version/dup warnings: {:?}",
            warnings
        );
    }

    #[test]
    fn w_122_001_fires_on_anchorless_heading() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### Objectives

Free-form section without an anchor.
"#,
        );
        let warnings = lint_project(dir.path(), None);
        assert!(warnings.iter().any(|w| w.code == "W-122-001"));
    }

    #[test]
    fn w_122_002_fires_on_version_bump_without_applied_from() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.5"
kind: charter
---

### OBJ-1: Reduce cycles

Body.
"#,
        );
        let warnings = lint_project(dir.path(), None);
        assert!(warnings.iter().any(|w| w.code == "W-122-002"));
    }

    #[test]
    fn w_122_002_silent_when_applied_from_present() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.5"
kind: charter
appliedFrom:
  - runId: run-001
    candidatePath: runs/run-001/charter.candidate.md
    fromHash: aaa
    toHash: bbb
    actor: o
    appliedAt: "2026-04-30T12:00:00Z"
---

### OBJ-1: Reduce cycles

Body.
"#,
        );
        let warnings = lint_project(dir.path(), None);
        assert!(!warnings.iter().any(|w| w.code == "W-122-002"));
    }

    #[test]
    fn w_122_003_fires_on_duplicate_anchor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: First objective

Body 1.

### OBJ-1: Same anchor again

Body 2.
"#,
        );
        let warnings = lint_project(dir.path(), None);
        // Two warnings emitted (one per occurrence) so the operator sees
        // both line numbers.
        let dup = warnings
            .iter()
            .filter(|w| w.code == "W-122-003")
            .count();
        assert_eq!(dup, 2, "expected two W-122-003 entries, got {dup}");
    }

    #[test]
    fn w_122_004_fires_on_unknown_citation_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
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

### OBJ-1: Cycles

Body.
"#,
        );
        let corpus_dir = dir.path().join("artifact-store");
        fs::create_dir_all(&corpus_dir).unwrap();
        // Real source exists at `extracted/present.txt` but the
        // citation references `extracted/missing.txt`.
        let real = corpus_dir.join("extracted/present.txt");
        write(&real, "real");
        let ctx = LintProjectContext {
            corpus_dir: corpus_dir.clone(),
            corpus: vec![],
            project_name: "p".into(),
            project_slug: "p".into(),
            workspace_name: "w".into(),
        };
        let warnings = lint_project(dir.path(), Some(&ctx));
        assert!(warnings.iter().any(|w| w.code == "W-122-004"));
    }

    #[test]
    fn w_122_005_fires_on_unallowed_external_entity() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        // `Globex` is the canonical external entity from the example forensic
        // and is not in the core allowlist.
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### IN-SCOPE-1: Globex integration

The system must integrate with Globex for payments.
"#,
        );
        let corpus_dir = dir.path().join("artifact-store");
        fs::create_dir_all(&corpus_dir).unwrap();
        let ctx = LintProjectContext {
            corpus_dir: corpus_dir.clone(),
            corpus: vec![],
            project_name: "p".into(),
            project_slug: "p".into(),
            workspace_name: "w".into(),
        };
        let warnings = lint_project(dir.path(), Some(&ctx));
        let entity_hits: Vec<_> = warnings
            .iter()
            .filter(|w| w.code == "W-122-005")
            .collect();
        assert!(
            !entity_hits.is_empty(),
            "expected W-122-005 for Globex, got {warnings:?}"
        );
        assert!(entity_hits[0].message.contains("Globex"));
    }

    #[test]
    fn lint_handles_missing_directory() {
        let dir = tempfile::tempdir().unwrap();
        // No requirements/stakeholder/ directory exists.
        let warnings = lint_project(dir.path(), None);
        assert!(warnings.is_empty());
    }

    #[test]
    fn unknown_anchor_kind_does_not_suppress_other_warnings() {
        // The reviewer flagged that an unknown anchor kind on one
        // section must NOT swallow W-122-002/003 elsewhere in the same
        // document. The operator should see every actionable problem at
        // once (no drip-feed remediation).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("requirements/stakeholder/charter.md");
        write(
            &path,
            r#"---
status: authored
owner: o
version: "1.0.5"
kind: charter
---

### MILESTONE-1: Out of grammar

Body.

### OBJ-1: First

Body 1.

### OBJ-1: Same anchor again

Body 2.
"#,
        );
        let warnings = lint_project(dir.path(), None);
        let codes: BTreeSet<&str> =
            warnings.iter().map(|w| w.code).collect();
        assert!(
            codes.contains("W-122-PARSE"),
            "unknown kind should surface a parse warning: {warnings:?}"
        );
        assert!(
            codes.contains("W-122-002"),
            "version-bump warning must still fire: {warnings:?}"
        );
        assert!(
            codes.contains("W-122-003"),
            "duplicate-anchor warning must still fire: {warnings:?}"
        );
    }
}
