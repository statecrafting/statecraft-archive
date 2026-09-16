// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use crate::graph::{FeatureGraph, FeatureNode, Violation};
use ignore::WalkBuilder;
use regex::Regex;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq)]
pub struct FileHeader {
    pub feature_id: Option<String>,
    pub spec_path: Option<String>,
}

#[derive(Error, Debug, Clone, PartialEq)]
pub enum HeaderError {
    #[error("Multiple Feature directives found")]
    MultipleFeatures,
    #[error("Multiple Spec directives found")]
    MultipleSpecs,
    #[error("Invalid header format: {0}")]
    InvalidFormat(String),
}

// Strict regexes as per spec
const FEATURE_REGEX: &str = r"^(//|#)\s*Feature:\s*([A-Z][A-Z0-9_]{2,63})\s*$";
// The `// Spec:` directive resolves against the canonical `specs/NNN-slug/spec.md`
// layout (spec 034 amendment 2026-07-08). `specs?/` still tolerates the legacy
// singular `spec/` prefix during the cross-crate header migration. The trailing
// `(\s.*)?` group accepts an optional whitespace-separated annotation after the
// `.md` (the corpus notes the FR or section a file implements there); only the
// path is captured in group 2, the annotation itself is not parsed.
const SPEC_REGEX: &str = r"^(//|#)\s*Spec:\s*(specs?/[A-Za-z0-9_/\.-]+\.md)(\s.*)?$";
// "Looks like" regexes for checking intent (soft rule)
const ATTEMPTED_FEATURE: &str = r"^\s*(//|#)\s*Feature\s*:";
const ATTEMPTED_SPEC: &str = r"^\s*(//|#)\s*Spec\s*:";

pub struct HeaderParser {
    feature_re: Regex,
    spec_re: Regex,
    attempt_feature_re: Regex,
    attempt_spec_re: Regex,
}

impl Default for HeaderParser {
    fn default() -> Self {
        Self::new()
    }
}

impl HeaderParser {
    pub fn new() -> Self {
        Self {
            feature_re: Regex::new(FEATURE_REGEX).expect("Invalid FEATURE_REGEX"),
            spec_re: Regex::new(SPEC_REGEX).expect("Invalid SPEC_REGEX"),
            attempt_feature_re: Regex::new(ATTEMPTED_FEATURE).expect("Invalid ATTEMPTED_FEATURE"),
            attempt_spec_re: Regex::new(ATTEMPTED_SPEC).expect("Invalid ATTEMPTED_SPEC"),
        }
    }

    pub fn parse_file<P: AsRef<Path>>(&self, path: P) -> Result<FileHeader, HeaderError> {
        let file =
            File::open(path).map_err(|e| HeaderError::InvalidFormat(format!("IO error: {}", e)))?;
        let reader = BufReader::new(file);

        let mut feature_id = None;
        let mut spec_path = None;

        let lines = reader.lines();
        let mut line_count = 0;
        let max_lines = 40;

        for line_res in lines {
            line_count += 1;
            if line_count > max_lines {
                break;
            }

            let line =
                line_res.map_err(|e| HeaderError::InvalidFormat(format!("IO error: {}", e)))?;
            let trimmed = line.trim();

            if line_count == 1 && line.starts_with("#!") {
                continue;
            }

            if trimmed.is_empty() {
                continue;
            }

            let is_comment = trimmed.starts_with("//") || trimmed.starts_with("#");
            if !is_comment {
                break;
            }

            if let Some(caps) = self.feature_re.captures(&line) {
                if feature_id.is_some() {
                    return Err(HeaderError::MultipleFeatures);
                }
                feature_id = Some(caps.get(2).unwrap().as_str().to_string());
                continue;
            } else if self.attempt_feature_re.is_match(&line) {
                return Err(HeaderError::InvalidFormat(format!(
                    "Malformed Feature directive: {}",
                    line
                )));
            }

            if let Some(caps) = self.spec_re.captures(&line) {
                if spec_path.is_some() {
                    return Err(HeaderError::MultipleSpecs);
                }
                spec_path = Some(caps.get(2).unwrap().as_str().to_string());
                continue;
            } else if self.attempt_spec_re.is_match(&line) {
                return Err(HeaderError::InvalidFormat(format!(
                    "Malformed Spec directive: {}",
                    line
                )));
            }
        }

        Ok(FileHeader {
            feature_id,
            spec_path,
        })
    }
}

#[derive(Debug, Deserialize)]
struct FeaturesYaml {
    features: Vec<FeatureEntry>,
}

#[derive(Debug, Deserialize)]
struct FeatureEntry {
    id: String,
    title: String,
    spec: String,
    governance: String,
    owner: String,
    group: String,
    depends_on: Vec<String>,
    /// Design lifecycle status (draft/approved/superseded/retired).
    #[serde(default)]
    status: String,
    /// Implementation lifecycle status (pending/in-progress/complete/n/a).
    implementation: Option<String>,
    /// Deprecated IDs that map to this canonical feature.
    /// Files declaring `// Feature: <alias>` are attributed to this feature.
    #[serde(default)]
    aliases: Vec<String>,
}

/// Serialize a spec-spine enum (`Status`, `Risk`, `Implementation`) to its
/// lowercase/kebab string form. These were plain strings in the in-tree
/// registry; the library models them as typed enums, so we round-trip through
/// serde to recover the exact string featuregraph stored (spec 217 engine swap).
fn enum_str<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl FeatureEntry {
    fn from_registry_record(r: &crate::registry_source::RegistryFeatureRecord) -> Self {
        Self {
            id: r.id.clone(),
            // `title` and `spec_path` are required `String` on the library
            // record (were `Option` in the in-tree reader).
            title: r.title.clone(),
            spec: r.spec_path.clone(),
            governance: r.risk.map(|risk| enum_str(&risk)).unwrap_or_default(),
            owner: r.owner.clone().unwrap_or_default(),
            group: String::new(),
            depends_on: r.depends_on.clone(),
            status: enum_str(&r.status),
            implementation: r.implementation.map(|impl_kind| enum_str(&impl_kind)),
            aliases: r.code_aliases.clone(),
        }
    }
}

/// Prefer **`build/spec-registry/registry.json`** (spec-compiler); fall back to **`spec/features.yaml`**.
fn load_feature_entries(root: &Path) -> Result<(Vec<FeatureEntry>, String), anyhow::Error> {
    // Spec 217 engine swap: the committed registry is sharded
    // (`.derived/spec-registry/by-spec/*.json`); the library assembles it from
    // `repo_root` rather than from a monolithic `registry.json` path.
    let registry_shards = root.join(".derived/spec-registry/by-spec");
    let features_yaml = root.join("spec/features.yaml");

    if registry_shards.is_dir() {
        let records = crate::registry_source::load_registry_records(root)?;
        let features: Vec<FeatureEntry> = records
            .iter()
            .map(FeatureEntry::from_registry_record)
            .collect();
        return Ok((features, ".derived/spec-registry/by-spec".to_string()));
    }

    if features_yaml.is_file() {
        let features_file = File::open(&features_yaml)?;
        let parsed: FeaturesYaml = serde_yaml::from_reader(features_file)?;
        let rel = features_yaml
            .strip_prefix(root)
            .unwrap_or(&features_yaml)
            .to_string_lossy()
            .replace('\\', "/");
        return Ok((parsed.features, rel));
    }

    anyhow::bail!(
        "Feature manifest not found: need {} (run `spec-spine compile`) or {}",
        registry_shards.display(),
        features_yaml.display()
    );
}

pub struct Scanner {
    root: PathBuf,
    parser: HeaderParser,
}

impl Scanner {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            parser: HeaderParser::new(),
        }
    }

    pub fn scan(&self) -> Result<FeatureGraph, anyhow::Error> {
        let (features, manifest_path) = load_feature_entries(&self.root)?;

        let mut graph = FeatureGraph::new();
        let mut feature_map: HashMap<String, FeatureNode> = HashMap::new();
        // Maps deprecated/alias IDs → canonical feature ID
        let mut alias_map: HashMap<String, String> = HashMap::new();
        let mut global_violations: Vec<Violation> = Vec::new();

        // Populate from manifest (compiled registry or legacy yaml)
        for entry in features {
            if feature_map.contains_key(&entry.id) {
                global_violations.push(Violation {
                    code: "DUPLICATE_FEATURE_ID".to_string(),
                    severity: "error".to_string(),
                    path: manifest_path.clone(),
                    feature_id: Some(entry.id.clone()),
                    message: format!("Duplicate feature ID: {}", entry.id),
                    suggested_fix: Some("Remove duplicate entry".to_string()),
                });
                continue;
            }

            feature_map.insert(
                entry.id.clone(),
                FeatureNode {
                    feature_id: entry.id.clone(),
                    title: entry.title.clone(),
                    spec_path: entry.spec.clone(),
                    status: entry.status.clone(),
                    implementation: entry.implementation.clone().unwrap_or_default(),
                    governance: entry.governance.clone(),
                    owner: entry.owner.clone(),
                    group: entry.group.clone(),
                    depends_on: entry.depends_on.clone(),
                    impl_files: Vec::new(),
                    test_files: Vec::new(),
                    violations: Vec::new(),
                },
            );

            // Register aliases so deprecated Feature IDs resolve to this canonical entry
            for alias in &entry.aliases {
                alias_map.insert(alias.clone(), entry.id.clone());
            }

            // Check MISSING_SPEC_FILE
            let spec_abs_path = self.root.join(&entry.spec);
            if !spec_abs_path.exists()
                && let Some(node) = feature_map.get_mut(&entry.id)
            {
                node.violations.push(Violation {
                    code: "MISSING_SPEC_FILE".to_string(),
                    severity: "error".to_string(),
                    path: entry.spec.clone(),
                    feature_id: Some(entry.id.clone()),
                    message: format!("Spec file {} does not exist", entry.spec),
                    suggested_fix: Some(
                        "Re-run `spec-compiler compile` to regenerate the registry, or create the spec file"
                            .to_string(),
                    ),
                });
            }
        }

        // Walk FS
        let walker = WalkBuilder::new(&self.root)
            .hidden(false)
            .git_ignore(true)
            .build();

        for result in walker {
            match result {
                Ok(entry) => {
                    if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                        continue;
                    }
                    let path = entry.path();
                    let rel_path = path.strip_prefix(&self.root)?.to_string_lossy().to_string();
                    let rel_path_norm = rel_path.replace("\\", "/");

                    if !is_eligible_file(&rel_path_norm) {
                        continue;
                    }

                    match self.parser.parse_file(path) {
                        Ok(header) => {
                            if let Some(fid) = header.feature_id {
                                // Resolve alias → canonical ID (e.g. VERIFICATION_SKILLS → VERIFY_PROTOCOL)
                                let canonical_id =
                                    alias_map.get(&fid).cloned().unwrap_or_else(|| fid.clone());
                                if let Some(node) = feature_map.get_mut(&canonical_id) {
                                    let is_test = is_test_file(&rel_path_norm);
                                    if is_test {
                                        node.test_files.push(rel_path_norm.clone());
                                    } else {
                                        node.impl_files.push(rel_path_norm.clone());
                                    }

                                    if let Some(declared_spec) = header.spec_path
                                        && declared_spec != node.spec_path
                                    {
                                        node.violations.push(Violation {
                                            code: "SPEC_PATH_MISMATCH".to_string(),
                                            severity: "warning".to_string(),
                                            path: rel_path_norm.clone(),
                                            feature_id: Some(canonical_id.clone()),
                                            message: format!(
                                                "File declares spec {} but registry says {}",
                                                declared_spec, node.spec_path
                                            ),
                                            suggested_fix: Some(format!(
                                                "Update header to Spec: {}",
                                                node.spec_path
                                            )),
                                        });
                                    }
                                } else {
                                    global_violations.push(Violation {
                                        code: "DANGLING_FEATURE_ID".to_string(),
                                        severity: "error".to_string(),
                                        path: rel_path_norm.clone(),
                                        feature_id: Some(fid.clone()),
                                        message: format!("Feature {} not found in registry", fid),
                                        suggested_fix: Some(
                                            "Add feature to build/spec-registry/registry.json (via spec-compiler) or spec/features.yaml, or register as alias".to_string(),
                                        ),
                                    });
                                }
                            }
                        }
                        Err(HeaderError::InvalidFormat(msg)) => {
                            global_violations.push(Violation {
                                code: "INVALID_HEADER_FORMAT".to_string(),
                                severity: "error".to_string(),
                                path: rel_path_norm.clone(),
                                feature_id: None,
                                message: msg,
                                suggested_fix: Some("Fix header format".to_string()),
                            });
                        }
                        Err(HeaderError::MultipleFeatures) => {
                            global_violations.push(Violation {
                                code: "INVALID_HEADER_FORMAT".to_string(),
                                severity: "error".to_string(),
                                path: rel_path_norm.clone(),
                                feature_id: None,
                                message: "Multiple Feature directives found".to_string(),
                                suggested_fix: Some("Remove extra Feature directives".to_string()),
                            });
                        }
                        Err(HeaderError::MultipleSpecs) => {
                            global_violations.push(Violation {
                                code: "INVALID_HEADER_FORMAT".to_string(),
                                severity: "error".to_string(),
                                path: rel_path_norm.clone(),
                                feature_id: None,
                                message: "Multiple Spec directives found".to_string(),
                                suggested_fix: Some("Remove extra Spec directives".to_string()),
                            });
                        }
                    }
                }
                Err(err) => {
                    eprintln!("Walk error: {}", err);
                }
            }
        }

        let mut features: Vec<FeatureNode> = feature_map.into_values().collect();
        features.sort_by(|a, b| a.feature_id.cmp(&b.feature_id));
        for f in &mut features {
            f.impl_files.sort();
            f.test_files.sort();
            f.violations
                .sort_by(|a, b| a.code.cmp(&b.code).then(a.path.cmp(&b.path)));
        }
        global_violations.sort_by(|a, b| a.code.cmp(&b.code).then(a.path.cmp(&b.path)));

        graph.features = features;
        graph.violations = global_violations;

        let mut hasher = Sha256::new();
        if let Ok(json_bytes) = serde_json::to_vec(&graph) {
            hasher.update(json_bytes);
        }
        graph.graph_fingerprint = format!("sha256:{}", hex::encode(hasher.finalize()));

        Ok(graph)
    }
}

fn is_eligible_file(path: &str) -> bool {
    let allowed_exts = [
        ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".c", ".cc", ".cpp", ".h", ".hpp", ".java",
        ".kt", ".py", ".sh", ".bash", ".zsh",
    ];
    for ext in allowed_exts {
        if path.ends_with(ext) {
            return true;
        }
    }
    false
}

fn is_test_file(path: &str) -> bool {
    if path.contains("/tests/") || path.contains("/test/") {
        return true;
    }
    if path.ends_with("_test.go") || path.ends_with("_test.rs") {
        return true;
    }
    if path.ends_with(".test.ts") || path.ends_with(".test.tsx") || path.ends_with(".spec.ts") {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_valid_header() {
        let parser = HeaderParser::new();
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "// Feature: MY_FEATURE").unwrap();
        writeln!(file, "// Spec: spec/my_feature.md").unwrap();
        writeln!(file).unwrap();
        writeln!(file, "func main() {{}}").unwrap();

        let header = parser.parse_file(file.path()).unwrap();
        assert_eq!(header.feature_id, Some("MY_FEATURE".to_string()));
        assert_eq!(header.spec_path, Some("spec/my_feature.md".to_string()));
    }

    #[test]
    fn test_invalid_feature_format() {
        let parser = HeaderParser::new();
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "// Feature: my_feature").unwrap();

        let err = parser.parse_file(file.path()).unwrap_err();
        match err {
            HeaderError::InvalidFormat(_) => (),
            _ => panic!("Expected InvalidFormat"),
        }
    }

    #[test]
    fn registry_code_aliases_populate_feature_entry() {
        // RegistryFeatureRecord is now spec_spine_types::SpecRecord (spec 217);
        // construct via JSON parse so the literal stays compact across the
        // larger field set. `created` + `summary` are required on SpecRecord.
        let r: crate::registry_source::RegistryFeatureRecord = serde_json::from_value(
            serde_json::json!({
                "id": "034-featuregraph-registry-scanner-fix",
                "title": "t",
                "specPath": "specs/034-featuregraph-registry-scanner-fix/spec.md",
                "status": "approved",
                "created": "2026-03-29",
                "summary": "x",
                "implementation": "complete",
                "codeAliases": ["FEATUREGRAPH_REGISTRY"]
            }),
        )
        .expect("decode feature record");
        let e = FeatureEntry::from_registry_record(&r);
        assert_eq!(e.aliases, vec!["FEATUREGRAPH_REGISTRY"]);
        // Typed enums round-trip to their string form.
        assert_eq!(e.status, "approved");
        assert_eq!(e.implementation.as_deref(), Some("complete"));
    }

    #[test]
    fn registry_enriched_fields_populate_feature_entry() {
        let r: crate::registry_source::RegistryFeatureRecord = serde_json::from_value(
            serde_json::json!({
                "id": "087-unified-workspace-architecture",
                "title": "Unified Workspace Architecture",
                "specPath": "specs/087-unified-workspace-architecture/spec.md",
                "status": "approved",
                "created": "2026-05-01",
                "summary": "x",
                "implementation": "in-progress",
                "dependsOn": ["033", "068"],
                "owner": "bart",
                "risk": "high"
            }),
        )
        .expect("decode feature record");
        let e = FeatureEntry::from_registry_record(&r);
        assert_eq!(e.depends_on, vec!["033", "068"]);
        assert_eq!(e.owner, "bart");
        assert_eq!(e.governance, "high");
        assert_eq!(e.implementation.as_deref(), Some("in-progress"));
    }
}
