// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-007 to FR-012

//! Reclassification migration for spec 122.
//!
//! `migrate_stakeholder_docs(opts)` moves legacy
//! `requirements/client/charter.md` and
//! `requirements/client/client-document.md` files to the canonical
//! `requirements/stakeholder/` paths and rewrites them in-place to:
//!
//!   1. Add `frontmatter.migrated: true`, `migratedAt`, `migratedFrom`.
//!   2. Insert section anchors (`<KIND>-<NNN>`) under existing `### `
//!      headings, with an inline `<!-- anchorHash: sha256:... -->`
//!      comment per FR-029 so the operator can audit pairing decisions.
//!   3. Surface migration findings under
//!      `requirements/audit/stakeholder-doc-migration.md` (FR-012).
//!
//! The migration is idempotent (FR-009): re-running on a project that
//! is already migrated returns `MigrationOutcome::AlreadyMigrated` with
//! zero filesystem mutations. A project with no legacy
//! `requirements/client/*.md` files returns
//! `MigrationOutcome::NothingToMigrate`.
//!
//! Spec-121's `detect_external_entities` is invoked over each section
//! body so the migration report flags fabrications inherited from the
//! contaminated Stage CD generator (FR-011). The function does NOT
//! auto-fix flagged sections; the migration produces a punch list and
//! humans clean it up.

use chrono::{DateTime, Utc};
use factory_contracts::knowledge::ExtractionOutput;
use factory_contracts::provenance::anchor_hash;
use factory_contracts::stakeholder_docs::{AnchorKind, DocKind, SectionAnchor};
use provenance_validator::{
    derive_allowlist, detect_external_entities, CapitalizationHeuristic,
    ProjectContext,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct MigrateOptions {
    /// Project root containing `requirements/client/` and target
    /// `requirements/stakeholder/`.
    pub project: PathBuf,
    /// When true, rename the legacy files `*.legacy.md` instead of
    /// deleting them.
    pub keep_legacy: bool,
    /// Optional pre-loaded extraction corpus. When supplied, the
    /// migration uses it to derive the spec-121 allowlist for
    /// external-entity detection. When `None`, allowlist is derived
    /// against an empty corpus (so only the built-in core allowlist +
    /// project metadata applies).
    pub corpus: Vec<ExtractionOutput>,
    pub project_name: String,
    pub project_slug: String,
    pub workspace_name: String,
    /// Override the wall-clock for deterministic tests.
    pub now: DateTime<Utc>,
}

impl Default for MigrateOptions {
    fn default() -> Self {
        MigrateOptions {
            project: PathBuf::new(),
            keep_legacy: false,
            corpus: Vec::new(),
            project_name: String::new(),
            project_slug: String::new(),
            workspace_name: String::new(),
            now: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// Migration ran and rewrote at least one file.
    Migrated {
        files_moved: Vec<MovedFile>,
        anchors_inserted: Vec<InsertedAnchor>,
        findings: Vec<MigrationFinding>,
        report_path: PathBuf,
    },
    /// At least one of the docs was already migrated. No mutations.
    AlreadyMigrated { docs: Vec<PathBuf> },
    /// Project has no legacy `requirements/client/*.md` files.
    NothingToMigrate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MovedFile {
    pub from: PathBuf,
    pub to: PathBuf,
    pub legacy_kept: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InsertedAnchor {
    pub doc: PathBuf,
    pub anchor: SectionAnchor,
    pub heading_text: String,
    pub anchor_hash_hex: String,
    /// `true` when the heading-to-kind heuristic fell back to OBJ
    /// because no clear mapping existed (FR-010). Operators should
    /// review these.
    pub heuristic_fallback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationFinding {
    pub doc: PathBuf,
    pub anchor: SectionAnchor,
    pub kind: FindingKind,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FindingKind {
    /// Section body names external entities not in the spec-121
    /// allowlist. The migration does not block, but the report calls
    /// these out so the operator can supply citation, downgrade to
    /// ASSUMPTION, or remove (FR-011).
    UnallowedExternalEntity { entities: Vec<String> },
    /// Section heading didn't match any heuristic; defaulted to OBJ.
    HeuristicFallback,
}

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("frontmatter parse error in {path}: {message}")]
    Frontmatter { path: PathBuf, message: String },
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Run the migration end-to-end. Returns the structured outcome; the
/// caller is responsible for surfacing the report path / findings to
/// the operator (the binary in `bin/migrate_stakeholder_docs.rs` does
/// this).
pub fn migrate_stakeholder_docs(
    opts: &MigrateOptions,
) -> Result<MigrationOutcome, MigrationError> {
    let legacy_dir = opts.project.join("requirements/client");
    let target_dir = opts.project.join("requirements/stakeholder");
    let audit_dir = opts.project.join("requirements/audit");

    let legacy_charter = legacy_dir.join("charter.md");
    let legacy_client = legacy_dir.join("client-document.md");
    let target_charter = target_dir.join(DocKind::Charter.canonical_filename());
    let target_client =
        target_dir.join(DocKind::ClientDocument.canonical_filename());

    // Idempotency check (FR-009): if the target already has a doc whose
    // frontmatter declares `migrated: true`, return AlreadyMigrated
    // with the matching docs. We check *before* touching legacy files.
    let mut already: Vec<PathBuf> = Vec::new();
    for target in [&target_charter, &target_client] {
        if target.is_file() {
            let raw = read_file(target)?;
            if frontmatter_says_migrated(&raw) {
                already.push(target.clone());
            }
        }
    }
    if !already.is_empty() {
        return Ok(MigrationOutcome::AlreadyMigrated { docs: already });
    }

    // Nothing-to-migrate (FR-008 / acceptance #5): project has no
    // legacy `requirements/client/*.md`.
    let candidates: Vec<(DocKind, &PathBuf, &PathBuf)> = vec![
        (DocKind::Charter, &legacy_charter, &target_charter),
        (DocKind::ClientDocument, &legacy_client, &target_client),
    ];
    let any_legacy = candidates
        .iter()
        .any(|(_, src, _)| src.is_file());
    if !any_legacy {
        return Ok(MigrationOutcome::NothingToMigrate);
    }

    fs::create_dir_all(&target_dir).map_err(|e| MigrationError::Io {
        path: target_dir.clone(),
        source: e,
    })?;
    fs::create_dir_all(&audit_dir).map_err(|e| MigrationError::Io {
        path: audit_dir.clone(),
        source: e,
    })?;

    let allowlist = derive_allowlist(&ProjectContext {
        corpus: &opts.corpus,
        project_name: &opts.project_name,
        project_slug: &opts.project_slug,
        workspace_name: &opts.workspace_name,
        entity_model_yaml: None,
        charter_vocabulary: None,
        capitalized_token_frequency_threshold: 1,
    });
    let plausibility = CapitalizationHeuristic;

    let mut moved = Vec::new();
    let mut inserted = Vec::new();
    let mut findings = Vec::new();

    for (kind, src, dst) in candidates {
        if !src.is_file() {
            continue;
        }
        let original = read_file(src)?;
        let rewritten = rewrite_document(
            kind,
            &original,
            src,
            opts.now,
            &mut inserted,
            &mut findings,
            dst,
            &allowlist,
            &plausibility,
        )?;
        write_file(dst, &rewritten)?;
        let legacy_kept = if opts.keep_legacy {
            let kept = src.with_extension("legacy.md");
            // `with_extension("legacy.md")` produces `charter.legacy.md`
            // when the original is `charter.md`.
            fs::rename(src, &kept).map_err(|e| MigrationError::Io {
                path: src.clone(),
                source: e,
            })?;
            Some(kept)
        } else {
            fs::remove_file(src).map_err(|e| MigrationError::Io {
                path: src.clone(),
                source: e,
            })?;
            None
        };
        moved.push(MovedFile {
            from: src.clone(),
            to: dst.clone(),
            legacy_kept,
        });
    }

    let report_path = audit_dir.join("stakeholder-doc-migration.md");
    let report = render_report(opts, &moved, &inserted, &findings);
    write_file(&report_path, &report)?;

    Ok(MigrationOutcome::Migrated {
        files_moved: moved,
        anchors_inserted: inserted,
        findings,
        report_path,
    })
}

// ---------------------------------------------------------------------------
// Rewrite — frontmatter + section anchor insertion
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn rewrite_document(
    kind: DocKind,
    original: &str,
    src: &Path,
    now: DateTime<Utc>,
    inserted: &mut Vec<InsertedAnchor>,
    findings: &mut Vec<MigrationFinding>,
    dst: &Path,
    allowlist: &provenance_validator::Allowlist,
    plausibility: &dyn provenance_validator::EntityPlausibility,
) -> Result<String, MigrationError> {
    let (frontmatter_yaml, body, fm_present) = split_frontmatter(original);
    let frontmatter = upsert_frontmatter(
        kind,
        frontmatter_yaml,
        src,
        now,
    )?;

    let (rewritten_body, body_inserts, body_findings) = insert_anchors(
        body,
        dst,
        allowlist,
        plausibility,
    );
    inserted.extend(body_inserts);
    findings.extend(body_findings);

    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&frontmatter);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n");
    if !fm_present {
        // Original had no frontmatter, so make sure body starts cleanly.
        if !body.starts_with('\n') && !body.is_empty() {
            out.push('\n');
        }
    }
    out.push_str(&rewritten_body);
    Ok(out)
}

/// Returns `(yaml_inner, body, fm_present)`.
fn split_frontmatter(raw: &str) -> (&str, &str, bool) {
    if !raw.starts_with("---") {
        return ("", raw, false);
    }
    let bytes = raw.as_bytes();
    let after_open = match raw.find('\n') {
        Some(idx) => idx + 1,
        None => return ("", raw, false),
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
            let body = &raw[body_start.min(raw.len())..];
            return (yaml, body, true);
        }
        let advance = idx + 1;
        absolute_offset += advance;
        search = &search[advance..];
    }
    ("", raw, false)
}

/// Build the migrated frontmatter string from any existing
/// frontmatter plus the migration metadata. Preserves operator-set
/// keys (owner, version, etc.) when present; supplies defaults when
/// absent.
fn upsert_frontmatter(
    kind: DocKind,
    existing: &str,
    src: &Path,
    now: DateTime<Utc>,
) -> Result<String, MigrationError> {
    // Parse minimally — we only need to know which keys are already
    // present so we can avoid clobbering operator-set values.
    let existing_map: serde_yaml::Mapping = if existing.trim().is_empty() {
        serde_yaml::Mapping::new()
    } else {
        serde_yaml::from_str(existing).map_err(|e| {
            MigrationError::Frontmatter {
                path: src.to_path_buf(),
                message: e.to_string(),
            }
        })?
    };

    let kind_str = match kind {
        DocKind::Charter => "charter",
        DocKind::ClientDocument => "client-document",
    };

    // Merge: defaults < existing < migration. We want migration keys to
    // overwrite any prior `migrated: false` that might already be in
    // place, but we want to preserve operator-set `owner` / `version`.
    let mut out = serde_yaml::Mapping::new();
    out.insert("kind".into(), kind_str.into());
    out.insert(
        "status".into(),
        existing_map
            .get(serde_yaml::Value::String("status".into()))
            .cloned()
            .unwrap_or_else(|| "authored".into()),
    );
    out.insert(
        "owner".into(),
        existing_map
            .get(serde_yaml::Value::String("owner".into()))
            .cloned()
            .unwrap_or_else(|| "unassigned".into()),
    );
    out.insert(
        "version".into(),
        existing_map
            .get(serde_yaml::Value::String("version".into()))
            .cloned()
            .unwrap_or_else(|| "1.0.0".into()),
    );
    if let Some(s) =
        existing_map.get(serde_yaml::Value::String("supersedes".into()))
    {
        out.insert("supersedes".into(), s.clone());
    }
    if let Some(c) =
        existing_map.get(serde_yaml::Value::String("citations".into()))
    {
        out.insert("citations".into(), c.clone());
    }
    out.insert("migrated".into(), serde_yaml::Value::Bool(true));
    out.insert(
        "migratedAt".into(),
        serde_yaml::Value::String(now.to_rfc3339()),
    );
    out.insert(
        "migratedFrom".into(),
        serde_yaml::Value::String(
            src.strip_prefix(
                src.parent()
                    .and_then(|p| p.parent())
                    .and_then(|p| p.parent())
                    .unwrap_or(src),
            )
            .unwrap_or(src)
            .to_string_lossy()
            .replace('\\', "/"),
        ),
    );
    // FR-001 manuallyEdited heuristic — when the existing file already
    // declares it, preserve.
    if let Some(m) = existing_map
        .get(serde_yaml::Value::String("manuallyEdited".into()))
    {
        out.insert("manuallyEdited".into(), m.clone());
    }

    serde_yaml::to_string(&out).map_err(|e| MigrationError::Frontmatter {
        path: src.to_path_buf(),
        message: e.to_string(),
    })
}

fn frontmatter_says_migrated(raw: &str) -> bool {
    let (yaml, _, present) = split_frontmatter(raw);
    if !present {
        return false;
    }
    if let Ok(map) = serde_yaml::from_str::<serde_yaml::Mapping>(yaml) {
        return map
            .get(serde_yaml::Value::String("migrated".into()))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    }
    false
}

// ---------------------------------------------------------------------------
// Anchor insertion (FR-010, FR-029)
// ---------------------------------------------------------------------------

/// Walk the body line-by-line; any `### ` heading without an existing
/// anchor token gets one prepended. The kind heuristic looks at the
/// heading text; on no match we fall back to `OBJ` and surface a
/// `HeuristicFallback` finding for operator review (FR-010). Each
/// inserted anchor carries an inline `<!-- anchorHash: sha256:... -->`
/// comment per FR-029.
fn insert_anchors(
    body: &str,
    dst: &Path,
    allowlist: &provenance_validator::Allowlist,
    plausibility: &dyn provenance_validator::EntityPlausibility,
) -> (
    String,
    Vec<InsertedAnchor>,
    Vec<MigrationFinding>,
) {
    let mut counts: BTreeMap<AnchorKind, u32> = BTreeMap::new();
    let mut inserted = Vec::new();
    let mut findings = Vec::new();

    // First pass: locate `### ` headings so we know section boundaries.
    let lines: Vec<&str> = body.lines().collect();
    let mut current_anchor: Option<SectionAnchor> = None;
    let mut current_body: Vec<String> = Vec::new();
    let mut output_lines: Vec<String> = Vec::new();

    let flush_section_findings = |anchor: &Option<SectionAnchor>,
                                  body_text: &str,
                                  findings: &mut Vec<MigrationFinding>| {
        if let Some(a) = anchor.as_ref() {
            let entities = detect_external_entities(
                body_text,
                allowlist,
                plausibility,
            );
            if !entities.is_empty() {
                findings.push(MigrationFinding {
                    doc: dst.to_path_buf(),
                    anchor: a.clone(),
                    kind: FindingKind::UnallowedExternalEntity {
                        entities: entities.clone(),
                    },
                    detail: format!(
                        "section body names {} that are not in the project allowlist; supply a citation, downgrade to ASSUMPTION, or remove",
                        entities.join(", ")
                    ),
                });
            }
        }
    };

    for line in lines {
        if let Some(rest) = line.strip_prefix("### ") {
            // Flush prior section's body into the findings stream
            // before opening the new one.
            let body_text = current_body.join("\n");
            flush_section_findings(&current_anchor, &body_text, &mut findings);
            current_body.clear();

            let trimmed = rest.trim();
            // If this heading already has an anchor, leave it
            // unchanged.
            if let Some((tok, _)) = trimmed.split_once(':')
                && let Ok(existing) = tok.trim().parse::<SectionAnchor>()
            {
                output_lines.push(line.to_string());
                current_anchor = Some(existing);
                continue;
            }

            // Otherwise, classify by heading heuristic.
            let (kind, fallback) = classify_heading(trimmed);
            let next = counts.entry(kind).or_insert(0);
            *next += 1;
            let anchor = SectionAnchor::new(kind, *next);
            let heading_text = trimmed.to_string();
            let hash = anchor_hash(&heading_text);
            output_lines.push(format!(
                "### {}: {} <!-- anchorHash: sha256:{} -->",
                anchor.render(),
                heading_text,
                hash.0,
            ));
            inserted.push(InsertedAnchor {
                doc: dst.to_path_buf(),
                anchor: anchor.clone(),
                heading_text: heading_text.clone(),
                anchor_hash_hex: hash.0,
                heuristic_fallback: fallback,
            });
            if fallback {
                findings.push(MigrationFinding {
                    doc: dst.to_path_buf(),
                    anchor: anchor.clone(),
                    kind: FindingKind::HeuristicFallback,
                    detail: format!(
                        "heading '{}' had no clear kind mapping; defaulted to OBJ — operator should confirm or recategorize",
                        heading_text
                    ),
                });
            }
            current_anchor = Some(anchor);
        } else {
            current_body.push(line.to_string());
            output_lines.push(line.to_string());
        }
    }

    // Flush trailing section.
    let body_text = current_body.join("\n");
    flush_section_findings(&current_anchor, &body_text, &mut findings);

    let mut out = output_lines.join("\n");
    if body.ends_with('\n') && !out.ends_with('\n') {
        out.push('\n');
    }
    (out, inserted, findings)
}

/// Classify a `### ` heading text into a `<KIND>`. Returns `(kind,
/// fallback)` where `fallback = true` indicates the OBJ default fired.
fn classify_heading(heading: &str) -> (AnchorKind, bool) {
    let lower = heading.to_lowercase();
    // Most-specific patterns first so `out of scope` wins over `scope`.
    if lower.contains("out of scope")
        || lower.contains("out-of-scope")
        || lower.contains("excluded")
        || lower.contains("not in scope")
    {
        return (AnchorKind::OutScope, false);
    }
    if lower.contains("in scope")
        || lower.contains("in-scope")
        || lower.contains("scope")
    {
        return (AnchorKind::InScope, false);
    }
    if lower.starts_with("objective")
        || lower.starts_with("goal")
        || lower.starts_with("target")
        || lower.contains("outcomes & goals")
    {
        return (AnchorKind::Obj, false);
    }
    if lower.starts_with("outcome") {
        return (AnchorKind::Outcome, false);
    }
    if lower.starts_with("stakeholder") {
        return (AnchorKind::Stakeholder, false);
    }
    if lower.starts_with("owner") || lower.starts_with("accountable") {
        return (AnchorKind::Owner, false);
    }
    if lower.starts_with("assumption") {
        return (AnchorKind::Assumption, false);
    }
    if lower.starts_with("risk") {
        return (AnchorKind::Risk, false);
    }
    (AnchorKind::Obj, true)
}

// ---------------------------------------------------------------------------
// Report rendering (FR-012)
// ---------------------------------------------------------------------------

fn render_report(
    opts: &MigrateOptions,
    moved: &[MovedFile],
    inserted: &[InsertedAnchor],
    findings: &[MigrationFinding],
) -> String {
    let mut out = String::new();
    out.push_str("# Stakeholder Doc Migration\n\n");
    out.push_str(&format!("- **Project:** {}\n", opts.project_name));
    out.push_str(&format!("- **Slug:** {}\n", opts.project_slug));
    out.push_str(&format!("- **Workspace:** {}\n", opts.workspace_name));
    out.push_str(&format!("- **Migrated at:** {}\n", opts.now.to_rfc3339()));
    out.push_str("- **Spec:** specs/122-stakeholder-doc-inversion/spec.md\n");
    out.push_str("\n## Files moved\n\n");
    if moved.is_empty() {
        out.push_str("- _none_\n");
    } else {
        for m in moved {
            out.push_str(&format!(
                "- `{}` → `{}`{}\n",
                m.from.display(),
                m.to.display(),
                m.legacy_kept
                    .as_ref()
                    .map(|p| format!(" (legacy retained at `{}`)", p.display()))
                    .unwrap_or_default(),
            ));
        }
    }

    out.push_str("\n## Anchors inserted\n\n");
    if inserted.is_empty() {
        out.push_str("- _none_\n");
    } else {
        out.push_str(
            "| Doc | Anchor | Heading | anchorHash | Heuristic |\n",
        );
        out.push_str("|-----|--------|---------|------------|-----------|\n");
        for a in inserted {
            out.push_str(&format!(
                "| `{}` | `{}` | {} | `sha256:{}` | {} |\n",
                a.doc
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                a.anchor.render(),
                a.heading_text,
                a.anchor_hash_hex,
                if a.heuristic_fallback {
                    "fallback (OBJ)"
                } else {
                    "matched"
                },
            ));
        }
    }

    out.push_str("\n## Findings\n\n");
    if findings.is_empty() {
        out.push_str("- _none_ — migrated content passed all checks.\n");
    } else {
        for f in findings {
            let label = match &f.kind {
                FindingKind::UnallowedExternalEntity { .. } => {
                    "external-entity"
                }
                FindingKind::HeuristicFallback => "heuristic-fallback",
            };
            out.push_str(&format!(
                "- **{}** — `{}` {}: {}\n",
                label,
                f.doc
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                f.anchor.render(),
                f.detail,
            ));
        }
    }

    out.push_str("\n## Next steps\n\n");
    out.push_str("- Review every flagged section above.\n");
    out.push_str("- For each `external-entity` finding, supply a citation, downgrade the section to ASSUMPTION, or remove the entity.\n");
    out.push_str("- For each `heuristic-fallback` finding, confirm the OBJ classification or recategorize the anchor.\n");
    out.push_str("- Run `factory` Stage CD; the comparator will surface any remaining drift between authored and candidate.\n");

    out
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

fn read_file(p: &Path) -> Result<String, MigrationError> {
    fs::read_to_string(p).map_err(|e| MigrationError::Io {
        path: p.to_path_buf(),
        source: e,
    })
}

fn write_file(p: &Path, body: &str) -> Result<(), MigrationError> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| MigrationError::Io {
            path: parent.to_path_buf(),
            source: e,
        })?;
    }
    fs::write(p, body).map_err(|e| MigrationError::Io {
        path: p.to_path_buf(),
        source: e,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
    }

    fn example_charter() -> &'static str {
        r#"# Project Charter

## Background

Background prose.

### Objectives

Reduce form-correction cycles by 50%.

### In Scope

Online intake.

### Out of Scope

Payment processing (Finance systems).

### Stakeholders

PMO, Operations.

### Notes

Free-form notes.
"#
    }

    fn example_client_document() -> &'static str {
        r#"# Client Document

### Outcomes

Reduced cycle time.

### Risks

Schedule slip.

### Globex Integration

The system must integrate with Globex for payments.
"#
    }

    fn make_legacy_project(root: &Path) {
        let dir = root.join("requirements/client");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("charter.md"), example_charter()).unwrap();
        fs::write(dir.join("client-document.md"), example_client_document()).unwrap();
    }

    fn opts_for(root: &Path, keep_legacy: bool) -> MigrateOptions {
        MigrateOptions {
            project: root.to_path_buf(),
            keep_legacy,
            corpus: vec![],
            project_name: "example".into(),
            project_slug: "example".into(),
            workspace_name: "ws".into(),
            now: fixed_now(),
        }
    }

    #[test]
    fn migration_moves_files_and_inserts_anchors() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        let outcome =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        match outcome {
            MigrationOutcome::Migrated {
                files_moved,
                anchors_inserted,
                ..
            } => {
                assert_eq!(files_moved.len(), 2);
                assert!(!dir.path().join("requirements/client/charter.md").exists());
                assert!(dir
                    .path()
                    .join("requirements/stakeholder/charter.md")
                    .exists());
                assert!(dir
                    .path()
                    .join("requirements/stakeholder/client-document.md")
                    .exists());
                // Charter should produce at least: OBJ-1, IN-SCOPE-1,
                // OUT-SCOPE-1, STAKEHOLDER-1, plus a fallback OBJ-2 for
                // "Notes".
                let charter_anchors: Vec<&SectionAnchor> = anchors_inserted
                    .iter()
                    .filter(|a| {
                        a.doc.file_name().unwrap() == "charter.md"
                    })
                    .map(|a| &a.anchor)
                    .collect();
                assert!(
                    charter_anchors.iter().any(|a| {
                        a.kind == AnchorKind::Obj && a.index == 1
                    }),
                    "expected OBJ-1 in charter, got {charter_anchors:?}"
                );
                assert!(charter_anchors.iter().any(|a| {
                    a.kind == AnchorKind::OutScope
                }));
                assert!(charter_anchors.iter().any(|a| {
                    a.kind == AnchorKind::Stakeholder
                }));
            }
            other => panic!("expected Migrated, got {other:?}"),
        }
    }

    #[test]
    fn migration_records_anchor_hash_inline() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        let body = fs::read_to_string(
            dir.path().join("requirements/stakeholder/charter.md"),
        )
        .unwrap();
        // FR-029 — every inserted heading carries the inline anchorHash
        // comment.
        assert!(body.contains("<!-- anchorHash: sha256:"));
    }

    #[test]
    fn migration_inserts_migrated_frontmatter_keys() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        let body = fs::read_to_string(
            dir.path().join("requirements/stakeholder/charter.md"),
        )
        .unwrap();
        assert!(body.starts_with("---"));
        assert!(body.contains("migrated: true"));
        assert!(body.contains("migratedAt:"));
        assert!(body.contains("migratedFrom:"));
        assert!(body.contains("kind: charter"));
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        let _first =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        let charter_after_first = fs::read_to_string(
            dir.path().join("requirements/stakeholder/charter.md"),
        )
        .unwrap();
        let second =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        assert!(matches!(second, MigrationOutcome::AlreadyMigrated { .. }));
        let charter_after_second = fs::read_to_string(
            dir.path().join("requirements/stakeholder/charter.md"),
        )
        .unwrap();
        // Bytes-on-disk identical: zero mutations on the second pass.
        assert_eq!(charter_after_first, charter_after_second);
    }

    #[test]
    fn migration_returns_nothing_when_no_legacy() {
        let dir = tempfile::tempdir().unwrap();
        let outcome =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        assert_eq!(outcome, MigrationOutcome::NothingToMigrate);
    }

    #[test]
    fn keep_legacy_renames_to_legacy_md() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        migrate_stakeholder_docs(&opts_for(dir.path(), true)).unwrap();
        // Original legacy is gone, but `.legacy.md` remains.
        assert!(!dir.path().join("requirements/client/charter.md").exists());
        assert!(dir
            .path()
            .join("requirements/client/charter.legacy.md")
            .exists());
        assert!(dir
            .path()
            .join("requirements/client/client-document.legacy.md")
            .exists());
    }

    #[test]
    fn migration_flags_external_entity_in_finding() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        let outcome =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        match outcome {
            MigrationOutcome::Migrated { findings, .. } => {
                let entity_findings: Vec<&MigrationFinding> = findings
                    .iter()
                    .filter(|f| {
                        matches!(
                            f.kind,
                            FindingKind::UnallowedExternalEntity { .. }
                        )
                    })
                    .collect();
                // `Globex` from the client-document body is the synthetic
                // fabrication that this finding must surface.
                let detail_text = entity_findings
                    .iter()
                    .map(|f| f.detail.clone())
                    .collect::<Vec<_>>()
                    .join("\n");
                assert!(
                    detail_text.contains("Globex"),
                    "expected 'Globex' to surface in findings, got {detail_text}"
                );
            }
            other => panic!("expected Migrated, got {other:?}"),
        }
    }

    #[test]
    fn migration_writes_audit_report() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        let outcome =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        match outcome {
            MigrationOutcome::Migrated { report_path, .. } => {
                assert_eq!(
                    report_path,
                    dir.path().join("requirements/audit/stakeholder-doc-migration.md")
                );
                let report = fs::read_to_string(&report_path).unwrap();
                assert!(report.contains("# Stakeholder Doc Migration"));
                assert!(report.contains("## Files moved"));
                assert!(report.contains("## Anchors inserted"));
                assert!(report.contains("## Findings"));
            }
            other => panic!("expected Migrated, got {other:?}"),
        }
    }

    #[test]
    fn fallback_section_is_flagged() {
        let dir = tempfile::tempdir().unwrap();
        make_legacy_project(dir.path());
        let outcome =
            migrate_stakeholder_docs(&opts_for(dir.path(), false)).unwrap();
        match outcome {
            MigrationOutcome::Migrated { findings, .. } => {
                // The "Notes" heading in the charter has no obvious
                // kind mapping; should emit a HeuristicFallback finding.
                assert!(findings.iter().any(|f| {
                    matches!(f.kind, FindingKind::HeuristicFallback)
                }));
            }
            other => panic!("expected Migrated, got {other:?}"),
        }
    }

    #[test]
    fn classify_heading_basic_cases() {
        assert_eq!(classify_heading("Objectives").0, AnchorKind::Obj);
        assert_eq!(classify_heading("Goals").0, AnchorKind::Obj);
        assert_eq!(classify_heading("Outcomes").0, AnchorKind::Outcome);
        assert_eq!(classify_heading("Stakeholders").0, AnchorKind::Stakeholder);
        assert_eq!(classify_heading("In Scope").0, AnchorKind::InScope);
        assert_eq!(classify_heading("Out of Scope").0, AnchorKind::OutScope);
        assert_eq!(classify_heading("Excluded").0, AnchorKind::OutScope);
        assert_eq!(classify_heading("Risks").0, AnchorKind::Risk);
        assert_eq!(classify_heading("Assumptions").0, AnchorKind::Assumption);
        assert_eq!(classify_heading("Owners").0, AnchorKind::Owner);
        assert_eq!(classify_heading("Notes").0, AnchorKind::Obj);
        assert!(classify_heading("Notes").1, "Notes should fall back");
        assert!(!classify_heading("In Scope").1, "In Scope should not fall back");
    }
}
