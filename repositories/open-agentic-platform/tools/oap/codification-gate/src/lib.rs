//! Codification gate (spec 174).
//!
//! Stop-hook entry that blocks session closure until every CRITICAL/HIGH
//! finding emitted by `axiomregent`, `provenance-validator`, or
//! `policy-kernel` during the session is represented in the spec spine.
//!
//! The gate runs as a chain entry on the spec 166 Stop-hook chain. Its
//! contract:
//!
//! - **Input.** A findings directory containing JSON finding artifacts
//!   produced by the three substrate binaries. The format is intentionally
//!   small: each finding has an id, title, severity, source (one of
//!   `axiomregent`, `provenance-validator`, `policy-kernel`), and optional
//!   tags + implicated spec id. Substrate binaries that emit findings drop
//!   one JSON file per finding into this directory; the gate reads them via
//!   `walkdir` (the consumer surface for substrate-emitted artifacts —
//!   typed JSON, not ad-hoc parsing, per spec 103).
//! - **Filter.** Only CRITICAL and HIGH severities trigger the gate
//!   (FR-003). LOW and MEDIUM findings pass.
//! - **Class match.** Heuristic keyword match: the finding's id, the first
//!   three significant words of its title, and any category tags are
//!   searched across `standards/security/**/spec.md`, and against the
//!   `§Constraints` section of the implicated spec when one is named
//!   (FR-004, FR-005). The match is conservative — false positives over
//!   false negatives (spec 174 §2.2 explicit posture).
//! - **Override.** Per-finding override entries in
//!   `.codification-override.yaml` mark a finding as
//!   intentionally-not-codified, with a reason and operator id that surface
//!   in the audit log (FR-007).
//! - **Exit.** Zero if every CRITICAL/HIGH finding is either codified or
//!   overridden. Two with a structured diagnostic if any finding is
//!   uncovered (FR-006).
//!
//! The substrate binaries do not yet emit findings in this format
//! (forward-compat — spec 174 §5 "Out of scope: codification of historical
//! findings"). The gate is engineered to no-op cleanly when no findings
//! directory exists, so wiring it into the Stop chain today is safe; once
//! the substrates start emitting findings, the gate begins firing on real
//! signal.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Severity rungs the gate recognises. Serialised case-insensitively from
/// substrate-emitted JSON; `Severity::from_str` normalises common spellings
/// (`critical`, `Critical`, `CRITICAL`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn blocks_gate(self) -> bool {
        matches!(self, Severity::Critical | Severity::High)
    }

    pub fn parse_loose(raw: &str) -> Option<Severity> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "low" => Some(Severity::Low),
            "medium" | "med" => Some(Severity::Medium),
            "high" => Some(Severity::High),
            "critical" | "crit" => Some(Severity::Critical),
            _ => None,
        }
    }
}

/// One finding emitted by a substrate. The JSON shape is the public contract
/// between substrates and the gate; substrate authors target this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Finding {
    pub id: String,
    pub title: String,
    #[serde(deserialize_with = "deserialize_severity_loose")]
    pub severity: Severity,
    pub source: FindingSource,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional spec id whose `§Constraints` section is the natural home
    /// for this finding's codification. When set, the gate checks the
    /// implicated spec in addition to `standards/security/`.
    #[serde(default)]
    pub implicated_spec: Option<String>,
}

fn deserialize_severity_loose<'de, D: serde::Deserializer<'de>>(
    de: D,
) -> Result<Severity, D::Error> {
    let raw = String::deserialize(de)?;
    Severity::parse_loose(&raw)
        .ok_or_else(|| serde::de::Error::custom(format!("unknown severity {raw:?}")))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FindingSource {
    Axiomregent,
    ProvenanceValidator,
    PolicyKernel,
}

/// Override entries declare a per-finding waiver with operator reasoning.
/// Logged to the certificate chain (FR-007); deserialised from
/// `.codification-override.yaml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverrideEntry {
    pub finding_id: String,
    pub reason: String,
    pub operator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OverrideFile {
    #[serde(default)]
    pub overrides: Vec<OverrideEntry>,
}

/// Outcome for a single finding evaluated by the gate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FindingOutcome {
    /// Finding's class is represented in the spine at the named location.
    Codified { location: PathBuf },
    /// Finding is waived by an operator override.
    Overridden { reason: String, operator: String },
    /// Finding has no representation in the spine and no override.
    Missing { searched: Vec<PathBuf> },
}

#[derive(Debug, Clone)]
pub struct EvaluatedFinding {
    pub finding: Finding,
    pub outcome: FindingOutcome,
}

/// Final report the binary surfaces.
#[derive(Debug, Clone, Default)]
pub struct Report {
    pub considered: usize,
    pub filtered_out: usize,
    pub codified: Vec<EvaluatedFinding>,
    pub overridden: Vec<EvaluatedFinding>,
    pub missing: Vec<EvaluatedFinding>,
}

impl Report {
    pub fn blocks(&self) -> bool {
        !self.missing.is_empty()
    }
}

/// Load every finding artifact under `findings_dir`. Each `*.json` file is
/// expected to contain either a single Finding object or a top-level
/// `{"findings": [...]}` array — substrate binaries are free to batch.
///
/// A missing or empty directory is *not* an error: the gate is forward-compat
/// and no-ops when substrates aren't yet emitting (spec 174 §5).
pub fn load_findings(findings_dir: &Path) -> Result<Vec<Finding>, String> {
    if !findings_dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(findings_dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let bytes = fs::read(path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        // Try batch shape first; fall back to single-finding shape.
        if let Ok(batch) = serde_json::from_slice::<FindingBatch>(&bytes) {
            out.extend(batch.findings);
            continue;
        }
        let single: Finding = serde_json::from_slice(&bytes)
            .map_err(|e| format!("parse {}: {e}", path.display()))?;
        out.push(single);
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct FindingBatch {
    findings: Vec<Finding>,
}

/// Load overrides from `<repo_root>/.codification-override.yaml` if present.
/// Returns an empty map (no overrides) when the file is absent.
pub fn load_overrides(repo_root: &Path) -> Result<BTreeMap<String, OverrideEntry>, String> {
    let path = repo_root.join(".codification-override.yaml");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let parsed: OverrideFile = serde_yaml::from_slice(&bytes)
        .map_err(|e| format!("parse {}: {e}", path.display()))?;
    let mut map = BTreeMap::new();
    for entry in parsed.overrides {
        map.insert(entry.finding_id.clone(), entry);
    }
    Ok(map)
}

/// Run the gate's evaluation over a set of findings.
pub fn evaluate(
    repo_root: &Path,
    findings: Vec<Finding>,
    overrides: &BTreeMap<String, OverrideEntry>,
) -> Result<Report, String> {
    let mut report = Report {
        considered: findings.len(),
        ..Default::default()
    };

    let security_corpus = collect_security_corpus(repo_root)?;

    for finding in findings {
        if !finding.severity.blocks_gate() {
            report.filtered_out += 1;
            continue;
        }
        if let Some(entry) = overrides.get(&finding.id) {
            report.overridden.push(EvaluatedFinding {
                finding,
                outcome: FindingOutcome::Overridden {
                    reason: entry.reason.clone(),
                    operator: entry.operator.clone(),
                },
            });
            continue;
        }
        let mut searched = Vec::new();
        let needles = build_needles(&finding);
        let codified_at = match_in_corpus(&security_corpus, &needles, &mut searched);
        match codified_at {
            Some(location) => report.codified.push(EvaluatedFinding {
                finding,
                outcome: FindingOutcome::Codified { location },
            }),
            None => {
                if let Some(implicated) = &finding.implicated_spec {
                    let implicated_path =
                        repo_root.join("specs").join(implicated).join("spec.md");
                    searched.push(implicated_path.clone());
                    if implicated_path.exists()
                        && matches_constraints_section(&implicated_path, &needles)?
                    {
                        report.codified.push(EvaluatedFinding {
                            finding,
                            outcome: FindingOutcome::Codified {
                                location: implicated_path,
                            },
                        });
                        continue;
                    }
                }
                report.missing.push(EvaluatedFinding {
                    finding,
                    outcome: FindingOutcome::Missing { searched },
                });
            }
        }
    }

    Ok(report)
}

#[derive(Debug)]
struct SecurityDoc {
    path: PathBuf,
    body_lower: String,
}

fn collect_security_corpus(repo_root: &Path) -> Result<Vec<SecurityDoc>, String> {
    let dir = repo_root.join("standards").join("security");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&dir).into_iter().flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.file_name().and_then(|s| s.to_str()) != Some("spec.md") {
            continue;
        }
        let body = fs::read_to_string(path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        out.push(SecurityDoc {
            path: path.to_path_buf(),
            body_lower: body.to_lowercase(),
        });
    }
    Ok(out)
}

/// Build the keyword needles used for class-matching. The harness's
/// `check-finding-codified.mjs` uses "first 3 significant words of a finding
/// title, or the finding ID" — we mirror that, plus tags (which substrate
/// binaries are free to emit).
fn build_needles(finding: &Finding) -> Vec<String> {
    let mut needles = Vec::new();
    needles.push(finding.id.to_lowercase());
    for word in significant_words(&finding.title).into_iter().take(3) {
        needles.push(word);
    }
    for tag in &finding.tags {
        needles.push(tag.to_lowercase());
    }
    needles.retain(|n| !n.is_empty());
    needles.sort();
    needles.dedup();
    needles
}

fn significant_words(title: &str) -> Vec<String> {
    const STOPWORDS: &[&str] = &[
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has",
        "have", "if", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the",
        "this", "to", "was", "were", "will", "with", "without",
    ];
    title
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .filter(|w| !w.is_empty())
        .map(|w| w.to_ascii_lowercase())
        .filter(|w| !STOPWORDS.contains(&w.as_str()))
        .collect()
}

fn match_in_corpus(
    corpus: &[SecurityDoc],
    needles: &[String],
    searched: &mut Vec<PathBuf>,
) -> Option<PathBuf> {
    for doc in corpus {
        searched.push(doc.path.clone());
        if needles.iter().any(|n| doc.body_lower.contains(n)) {
            return Some(doc.path.clone());
        }
    }
    None
}

/// Check the `§Constraints` (or `## Constraints`) section of an implicated
/// spec for any of the needles. Anything outside that section is ignored —
/// codification belongs in a marked section so the next reader can find it.
fn matches_constraints_section(path: &Path, needles: &[String]) -> Result<bool, String> {
    let body = fs::read_to_string(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    let section = extract_constraints_section(&body);
    let section_lower = section.to_lowercase();
    Ok(needles.iter().any(|n| section_lower.contains(n)))
}

/// Extract a `§Constraints` or `## Constraints` (case-insensitive) section
/// from a markdown body. Returns the section body up to the next heading at
/// the same or shallower depth, or empty string when no such section exists.
pub fn extract_constraints_section(body: &str) -> String {
    let mut in_section = false;
    let mut section_depth: usize = 0;
    let mut out = String::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        if let Some(depth) = heading_depth(trimmed) {
            let heading_text = trimmed.trim_start_matches('#').trim().to_ascii_lowercase();
            // Accept both `Constraints` and `§Constraints` (the spec text
            // uses § when describing the section in prose, but markdown
            // heading bodies typically drop the §).
            let is_constraints = heading_text == "constraints"
                || heading_text.ends_with(" constraints")
                || heading_text.starts_with("§constraints")
                || heading_text == "§constraints"
                || heading_text.contains("constraints");
            if in_section && depth <= section_depth {
                break;
            }
            if !in_section && is_constraints {
                in_section = true;
                section_depth = depth;
                continue;
            }
        }
        if in_section {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn heading_depth(line: &str) -> Option<usize> {
    let depth = line.chars().take_while(|c| *c == '#').count();
    if depth == 0 || depth > 6 {
        return None;
    }
    // Require a space after the # run.
    if line.chars().nth(depth) == Some(' ') {
        Some(depth)
    } else {
        None
    }
}

/// Format a Report as the structured stderr diagnostic the Stop hook
/// chain consumes. The first line is a single-line JSON envelope; per-finding
/// detail lines follow.
pub fn format_blocking_diagnostic(report: &Report) -> String {
    let mut out = String::new();
    out.push_str("codification-gate: blocking — uncoded CRITICAL/HIGH findings:\n");
    for ev in &report.missing {
        out.push_str(&format!(
            "  - [{:?}] {} ({}): {}\n",
            ev.finding.severity,
            ev.finding.id,
            source_label(ev.finding.source),
            ev.finding.title
        ));
    }
    out.push_str("To resolve, codify the finding class in one of:\n");
    out.push_str("  - standards/security/<id>-<slug>/spec.md (preferred for cross-cutting classes)\n");
    out.push_str("  - the implicated spec's §Constraints section\n");
    out.push_str(
        "Or add an entry to .codification-override.yaml with a reason and operator id.\n",
    );
    out
}

fn source_label(s: FindingSource) -> &'static str {
    match s {
        FindingSource::Axiomregent => "axiomregent",
        FindingSource::ProvenanceValidator => "provenance-validator",
        FindingSource::PolicyKernel => "policy-kernel",
    }
}

/// Emit a JSONL audit line describing the gate's outcome, suitable for the
/// governance certificate chain to ingest (FR-007). Each line is one JSON
/// object. The caller writes these to `<run-dir>/codification-gate.jsonl`
/// or similar; we surface the formatter as a library function so tests can
/// snapshot it.
pub fn format_audit_lines(report: &Report) -> Vec<String> {
    let mut lines = Vec::new();
    for ev in &report.codified {
        lines.push(audit_line("codified", &ev.finding, Some(&ev.outcome)));
    }
    for ev in &report.overridden {
        lines.push(audit_line("overridden", &ev.finding, Some(&ev.outcome)));
    }
    for ev in &report.missing {
        lines.push(audit_line("missing", &ev.finding, Some(&ev.outcome)));
    }
    lines
}

fn audit_line(state: &str, finding: &Finding, outcome: Option<&FindingOutcome>) -> String {
    #[derive(Serialize)]
    struct AuditPayload<'a> {
        spec: &'a str,
        state: &'a str,
        finding_id: &'a str,
        severity: Severity,
        source: FindingSource,
        title: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        codified_at: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        override_reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        override_operator: Option<String>,
    }
    let mut payload = AuditPayload {
        spec: "174-codification-gate",
        state,
        finding_id: &finding.id,
        severity: finding.severity,
        source: finding.source,
        title: &finding.title,
        codified_at: None,
        override_reason: None,
        override_operator: None,
    };
    if let Some(o) = outcome {
        match o {
            FindingOutcome::Codified { location } => {
                payload.codified_at = Some(location.to_string_lossy().into_owned());
            }
            FindingOutcome::Overridden { reason, operator } => {
                payload.override_reason = Some(reason.clone());
                payload.override_operator = Some(operator.clone());
            }
            FindingOutcome::Missing { .. } => {}
        }
    }
    serde_json::to_string(&payload).expect("audit payload is serialisable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture_finding(id: &str, title: &str, severity: Severity) -> Finding {
        Finding {
            id: id.to_string(),
            title: title.to_string(),
            severity,
            source: FindingSource::Axiomregent,
            tags: vec![],
            implicated_spec: None,
        }
    }

    #[test]
    fn severity_blocks_only_high_and_critical() {
        assert!(Severity::Critical.blocks_gate());
        assert!(Severity::High.blocks_gate());
        assert!(!Severity::Medium.blocks_gate());
        assert!(!Severity::Low.blocks_gate());
    }

    #[test]
    fn parse_loose_normalises_case() {
        assert_eq!(Severity::parse_loose("critical"), Some(Severity::Critical));
        assert_eq!(Severity::parse_loose("CRITICAL"), Some(Severity::Critical));
        assert_eq!(Severity::parse_loose("Critical"), Some(Severity::Critical));
        assert_eq!(Severity::parse_loose("med"), Some(Severity::Medium));
        assert_eq!(Severity::parse_loose("garbage"), None);
    }

    #[test]
    fn significant_words_drops_stopwords_and_lowercases() {
        let words = significant_words("Memory poisoning in the agent context");
        assert_eq!(words, vec!["memory", "poisoning", "agent", "context"]);
    }

    #[test]
    fn build_needles_includes_id_title_first_three_and_tags() {
        let f = Finding {
            id: "F-001".into(),
            title: "Memory Poisoning detected".into(),
            severity: Severity::Critical,
            source: FindingSource::Axiomregent,
            tags: vec!["context".into()],
            implicated_spec: None,
        };
        let needles = build_needles(&f);
        assert!(needles.contains(&"f-001".to_string()));
        assert!(needles.contains(&"memory".to_string()));
        assert!(needles.contains(&"poisoning".to_string()));
        assert!(needles.contains(&"detected".to_string()));
        assert!(needles.contains(&"context".to_string()));
    }

    #[test]
    fn empty_findings_dir_is_not_an_error() {
        let dir = tempdir().unwrap();
        let findings = load_findings(&dir.path().join("does-not-exist")).unwrap();
        assert!(findings.is_empty());
    }

    #[test]
    fn loads_single_and_batch_findings() {
        let dir = tempdir().unwrap();
        let findings_dir = dir.path().join("findings");
        fs::create_dir(&findings_dir).unwrap();
        let single = r#"{"id":"F1","title":"single","severity":"critical","source":"axiomregent"}"#;
        let batch = r#"{"findings":[
            {"id":"F2","title":"a","severity":"high","source":"policy-kernel"},
            {"id":"F3","title":"b","severity":"low","source":"provenance-validator"}
        ]}"#;
        fs::write(findings_dir.join("a.json"), single).unwrap();
        fs::write(findings_dir.join("b.json"), batch).unwrap();
        let mut got = load_findings(&findings_dir).unwrap();
        got.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].id, "F1");
        assert_eq!(got[1].id, "F2");
        assert_eq!(got[2].id, "F3");
    }

    #[test]
    fn evaluate_blocks_when_no_codification_present() {
        let dir = tempdir().unwrap();
        let report = evaluate(
            dir.path(),
            vec![fixture_finding(
                "F-CRIT-1",
                "Memory poisoning vector",
                Severity::Critical,
            )],
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(report.blocks());
        assert_eq!(report.missing.len(), 1);
        assert_eq!(report.codified.len(), 0);
    }

    #[test]
    fn evaluate_passes_when_security_spec_mentions_keywords() {
        let dir = tempdir().unwrap();
        let sec = dir.path().join("standards/security/001-memory-poisoning");
        fs::create_dir_all(&sec).unwrap();
        fs::write(
            sec.join("spec.md"),
            "# Memory poisoning class\nFindings about memory poisoning vectors land here.\n",
        )
        .unwrap();
        let report = evaluate(
            dir.path(),
            vec![fixture_finding(
                "F-CRIT-1",
                "Memory poisoning detected",
                Severity::Critical,
            )],
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(!report.blocks());
        assert_eq!(report.codified.len(), 1);
    }

    #[test]
    fn evaluate_passes_via_implicated_constraints_section() {
        let dir = tempdir().unwrap();
        let spec_dir = dir.path().join("specs/067-tool-definition-registry");
        fs::create_dir_all(&spec_dir).unwrap();
        fs::write(
            spec_dir.join("spec.md"),
            "# 067 — Tool registry\n\n## 3. Requirements\nlorem\n\n## Constraints\n\nTool schemas must not be permissive (codified after F-CRIT-7).\n",
        )
        .unwrap();
        let mut f = fixture_finding(
            "F-CRIT-7",
            "Permissive tool schema accepted",
            Severity::Critical,
        );
        f.implicated_spec = Some("067-tool-definition-registry".into());
        let report = evaluate(dir.path(), vec![f], &BTreeMap::new()).unwrap();
        assert!(!report.blocks(), "report should not block; got {:?}", report);
        assert_eq!(report.codified.len(), 1);
    }

    #[test]
    fn evaluate_does_not_match_keywords_outside_constraints_section() {
        let dir = tempdir().unwrap();
        let spec_dir = dir.path().join("specs/067-tool-definition-registry");
        fs::create_dir_all(&spec_dir).unwrap();
        fs::write(
            spec_dir.join("spec.md"),
            "# 067 — Tool registry\n\n## 3. Requirements\nTool schemas must not be permissive.\n",
        )
        .unwrap();
        let mut f = fixture_finding(
            "F-CRIT-7",
            "Permissive tool schema accepted",
            Severity::Critical,
        );
        f.implicated_spec = Some("067-tool-definition-registry".into());
        let report = evaluate(dir.path(), vec![f], &BTreeMap::new()).unwrap();
        assert!(report.blocks());
    }

    #[test]
    fn evaluate_respects_overrides() {
        let dir = tempdir().unwrap();
        let mut overrides = BTreeMap::new();
        overrides.insert(
            "F-TRANSIENT".to_string(),
            OverrideEntry {
                finding_id: "F-TRANSIENT".into(),
                reason: "transient; no generalisable class".into(),
                operator: "bart".into(),
            },
        );
        let report = evaluate(
            dir.path(),
            vec![fixture_finding(
                "F-TRANSIENT",
                "one-off thing",
                Severity::Critical,
            )],
            &overrides,
        )
        .unwrap();
        assert!(!report.blocks());
        assert_eq!(report.overridden.len(), 1);
    }

    #[test]
    fn low_and_medium_findings_pass_without_codification() {
        let dir = tempdir().unwrap();
        let report = evaluate(
            dir.path(),
            vec![
                fixture_finding("F-LOW", "trivial", Severity::Low),
                fixture_finding("F-MED", "noteworthy", Severity::Medium),
            ],
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(!report.blocks());
        assert_eq!(report.filtered_out, 2);
    }

    #[test]
    fn extract_constraints_recognises_a_numbered_constraints_heading() {
        let body = "# 100\n## 1. Foo\nx\n## 2. Constraints\nthe rule\n## 3. Bar\ny\n";
        let section = extract_constraints_section(body);
        assert!(section.contains("the rule"));
        assert!(!section.contains("Foo"));
        assert!(!section.contains("Bar"));
    }

    #[test]
    fn format_blocking_diagnostic_names_each_missing_finding() {
        let dir = tempdir().unwrap();
        let report = evaluate(
            dir.path(),
            vec![
                fixture_finding("F-1", "alpha vector", Severity::Critical),
                fixture_finding("F-2", "beta vector", Severity::High),
            ],
            &BTreeMap::new(),
        )
        .unwrap();
        let diag = format_blocking_diagnostic(&report);
        assert!(diag.contains("F-1"));
        assert!(diag.contains("F-2"));
        assert!(diag.contains("alpha vector"));
        assert!(diag.contains("beta vector"));
    }

    #[test]
    fn audit_lines_are_emitted_for_every_outcome() {
        let dir = tempdir().unwrap();
        let sec = dir.path().join("standards/security/001-memory-poisoning");
        fs::create_dir_all(&sec).unwrap();
        fs::write(
            sec.join("spec.md"),
            "## Memory poisoning\nclass description.\n",
        )
        .unwrap();
        let mut overrides = BTreeMap::new();
        overrides.insert(
            "F-OVR".to_string(),
            OverrideEntry {
                finding_id: "F-OVR".into(),
                reason: "transient".into(),
                operator: "bart".into(),
            },
        );
        let report = evaluate(
            dir.path(),
            vec![
                fixture_finding("F-COD", "memory poisoning detected", Severity::Critical),
                fixture_finding("F-OVR", "transient probe", Severity::High),
                fixture_finding("F-MISS", "unrelated trampoline regression", Severity::High),
                fixture_finding("F-LOW", "trivial", Severity::Low),
            ],
            &overrides,
        )
        .unwrap();
        let lines = format_audit_lines(&report);
        assert_eq!(lines.len(), 3);
        assert!(lines.iter().any(|l| l.contains("\"state\":\"codified\"")));
        assert!(lines.iter().any(|l| l.contains("\"state\":\"overridden\"")));
        assert!(lines.iter().any(|l| l.contains("\"state\":\"missing\"")));
    }
}
