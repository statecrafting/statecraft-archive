//! OAP-side enricher for the generic spec-spine registry.
//!
//! Cut D W-06a (spec 217): reads the committed `.derived/spec-registry`
//! shards via the published library reader, walks
//! `specs/*/spec.md` for `compliance:` frontmatter and the repository
//! tree for `.factory/build-spec.yaml` files, and emits
//! `build/spec-registry/registry-oap.json` with the OAP-specific
//! extensions overlaid on the generic registry.
//!
//! During W-06a → W-06c transition, spec-compiler still emits
//! `compliance` and `factoryProjects` in `registry.json` directly, so
//! reads from either artifact return the same data. After W-06c the
//! generic compiler drops those fields and the enricher's output
//! becomes the sole authoritative source for OAP-specific extensions.

use open_agentic_spec_types::{FrontmatterError, split_frontmatter_required};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use spec_spine_core::load_committed_registry;
use spec_spine_types::Registry;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub mod authority;
pub mod validate_graph;

#[derive(Debug)]
pub enum EnrichError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Yaml(serde_yaml::Error),
    /// Spec 217 engine swap: the library registry-read error, as a string.
    Registry(String),
    InvalidFrontmatter { path: PathBuf, msg: String },
}

impl std::fmt::Display for EnrichError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnrichError::Io(e) => write!(f, "{e}"),
            EnrichError::Json(e) => write!(f, "{e}"),
            EnrichError::Yaml(e) => write!(f, "{e}"),
            EnrichError::Registry(e) => write!(f, "{e}"),
            EnrichError::InvalidFrontmatter { path, msg } => {
                write!(f, "{}: invalid frontmatter — {msg}", path.display())
            }
        }
    }
}

impl std::error::Error for EnrichError {}

impl From<std::io::Error> for EnrichError {
    fn from(e: std::io::Error) -> Self {
        EnrichError::Io(e)
    }
}
impl From<serde_json::Error> for EnrichError {
    fn from(e: serde_json::Error) -> Self {
        EnrichError::Json(e)
    }
}
impl From<serde_yaml::Error> for EnrichError {
    fn from(e: serde_yaml::Error) -> Self {
        EnrichError::Yaml(e)
    }
}

/// A compliance framework mapping entry (spec 102 FR-023/FR-024).
/// Wire-compatible with spec-compiler's pre-W-06c emission.
#[derive(Clone, Debug, Serialize)]
pub struct ComplianceEntry {
    pub framework: String,
    pub controls: Vec<String>,
}

/// A Factory Build Spec project discovered in the repository (spec 074 FR-007).
/// Wire-compatible with spec-compiler's pre-W-06c emission.
#[derive(Clone, Debug, Serialize)]
pub struct FactoryProjectRecord {
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(rename = "buildSpecPath")]
    pub build_spec_path: String,
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
    #[serde(rename = "pipelineStatus", skip_serializing_if = "Option::is_none")]
    pub pipeline_status: Option<String>,
}

/// Top-level enricher entry point. Reads the spec-spine registry,
/// computes OAP-specific extensions, and returns the enriched
/// registry-oap.json bytes (deterministic, sorted, pretty-printed).
pub fn enrich(repo_root: &Path) -> Result<Vec<u8>, EnrichError> {
    // Spec 217 engine swap: read the committed registry shards via the library.
    let cfg = load_spec_spine_config(repo_root);
    let registry =
        load_committed_registry(&cfg, repo_root).map_err(|e| EnrichError::Registry(e.to_string()))?;
    let compliance_by_spec = collect_compliance(repo_root, &registry)?;
    let factory_projects = collect_factory_projects(repo_root)?;
    let enriched = build_enriched_registry(&registry, &compliance_by_spec, &factory_projects)?;
    let bytes = canonical_json_bytes(&enriched)?;
    Ok(bytes)
}

/// Load the spec-spine config for `repo_root` (spec 217 engine swap): the
/// committed `spec-spine.toml` when present, else `Config::default()`.
fn load_spec_spine_config(repo_root: &Path) -> spec_spine_types::Config {
    std::fs::read_to_string(repo_root.join("spec-spine.toml"))
        .ok()
        .and_then(|src| spec_spine_types::load_config(&src).ok())
        .unwrap_or_default()
}

/// Load the committed registry for `repo_root` via the published library
/// (spec 217 FR-302 surface, shared by the `by-authority` verb).
pub fn load_registry(repo_root: &Path) -> Result<Registry, EnrichError> {
    let cfg = load_spec_spine_config(repo_root);
    load_committed_registry(&cfg, repo_root).map_err(|e| EnrichError::Registry(e.to_string()))
}

/// Convenience: compute + write `registry-oap.json` to
/// `build/spec-registry/`.
pub fn enrich_and_write(repo_root: &Path) -> Result<PathBuf, EnrichError> {
    let bytes = enrich(repo_root)?;
    let out_dir = repo_root.join(".derived/spec-registry");
    fs::create_dir_all(&out_dir)?;
    let out = out_dir.join("registry-oap.json");
    fs::write(&out, bytes)?;
    Ok(out)
}

fn collect_compliance(
    repo_root: &Path,
    registry: &Registry,
) -> Result<std::collections::BTreeMap<String, Vec<ComplianceEntry>>, EnrichError> {
    let mut out = std::collections::BTreeMap::new();
    for feature in &registry.specs {
        // `spec_path` is a required String on the library SpecRecord.
        let abs = repo_root.join(&feature.spec_path);
        let raw = match fs::read_to_string(&abs) {
            Ok(r) => r,
            Err(_) => continue, // spec.md not on disk; skip (typed reader handles missing earlier).
        };
        let (fm, _) = match split_frontmatter_required(&raw) {
            Ok(v) => v,
            Err(FrontmatterError::MissingFrontmatter) => continue,
            Err(FrontmatterError::Yaml(e)) => return Err(EnrichError::Yaml(e)),
        };
        let Some(m) = fm.as_mapping() else { continue };
        if let Some(entries) = parse_compliance(m) {
            out.insert(feature.id.clone(), entries);
        }
    }
    Ok(out)
}

fn collect_factory_projects(repo_root: &Path) -> Result<Vec<FactoryProjectRecord>, EnrichError> {
    let build_specs = discover_factory_build_specs(repo_root)?;
    let mut projects: Vec<FactoryProjectRecord> = Vec::new();
    for bp in &build_specs {
        if let Some(record) = parse_factory_project(repo_root, bp)? {
            projects.push(record);
        }
    }
    projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));
    Ok(projects)
}

fn build_enriched_registry(
    registry: &Registry,
    compliance_by_spec: &std::collections::BTreeMap<String, Vec<ComplianceEntry>>,
    factory_projects: &[FactoryProjectRecord],
) -> Result<Value, EnrichError> {
    // Spec 217 engine swap: the in-tree reader exposed a verbatim `raw` Value to
    // overlay onto. The library `Registry` is strongly typed and drops raw, so we
    // build the enriched artifact from the typed records. The registry-oap.json
    // top-level shape is preserved (`specVersion` / `build` / `features` /
    // `validation` / `factoryProjects`); each `features` entry is the serialized
    // library `SpecRecord` with the OAP `compliance` overlay injected by id.
    let mut features: Vec<Value> = Vec::with_capacity(registry.specs.len());
    for spec in &registry.specs {
        let mut fv = serde_json::to_value(spec)?;
        if let (Some(obj), Some(entries)) = (fv.as_object_mut(), compliance_by_spec.get(&spec.id)) {
            obj.insert("compliance".to_string(), serde_json::to_value(entries)?);
        }
        features.push(fv);
    }

    // Build block, tagged with the enricher so consumers can distinguish the
    // enriched artifact from the generic one.
    let mut build = serde_json::to_value(&registry.build)?;
    if let Some(b) = build.as_object_mut() {
        b.insert(
            "enricherId".to_string(),
            Value::String("oap-registry-enrich".to_string()),
        );
        b.insert(
            "enricherVersion".to_string(),
            Value::String(env!("CARGO_PKG_VERSION").to_string()),
        );
    }

    let mut top = Map::new();
    top.insert(
        "specVersion".to_string(),
        Value::String(registry.spec_version.clone()),
    );
    top.insert("build".to_string(), build);
    top.insert("features".to_string(), Value::Array(features));
    top.insert(
        "validation".to_string(),
        serde_json::to_value(&registry.validation)?,
    );
    // Overlay factoryProjects only when at least one was discovered.
    if !factory_projects.is_empty() {
        top.insert(
            "factoryProjects".to_string(),
            serde_json::to_value(factory_projects)?,
        );
    }

    Ok(Value::Object(top))
}

fn canonical_json_bytes(value: &Value) -> Result<Vec<u8>, EnrichError> {
    let sorted = sort_json_value(value.clone());
    let s = serde_json::to_string_pretty(&sorted)?;
    Ok(s.into_bytes())
}

fn sort_json_value(v: Value) -> Value {
    use std::collections::BTreeMap;
    match v {
        Value::Object(map) => {
            let mut out: BTreeMap<String, Value> = BTreeMap::new();
            for (k, val) in map {
                out.insert(k, sort_json_value(val));
            }
            let mut m = Map::new();
            for (k, v) in out {
                m.insert(k, v);
            }
            Value::Object(m)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sort_json_value).collect()),
        other => other,
    }
}

// ─────────────────────────────────────────────────────────────────────
// Compliance + factoryProjects parsers (mirrored from spec-compiler
// pre-W-06c). When W-06c removes them from spec-compiler, these are
// the canonical home.
// ─────────────────────────────────────────────────────────────────────

/// Parse the optional `compliance` frontmatter field (spec 102 FR-023).
///
/// Expects:
/// ```yaml
/// compliance:
///   - framework: "owasp-asi-2026"
///     controls: ["ASI01", "ASI05"]
/// ```
pub fn parse_compliance(m: &serde_yaml::Mapping) -> Option<Vec<ComplianceEntry>> {
    let v = m.get("compliance")?;
    let arr = v.as_sequence()?;
    let mut entries = Vec::new();
    for item in arr {
        let map = item.as_mapping()?;
        let framework = map
            .get(serde_yaml::Value::String("framework".into()))?
            .as_str()?
            .to_string();
        let controls_val = map.get(serde_yaml::Value::String("controls".into()))?;
        let controls_seq = controls_val.as_sequence()?;
        let controls: Vec<String> = controls_seq
            .iter()
            .filter_map(|c| c.as_str().map(|s| s.to_string()))
            .collect();
        entries.push(ComplianceEntry {
            framework,
            controls,
        });
    }
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

/// Discover all `.factory/build-spec.yaml` files under the repository root.
pub fn discover_factory_build_specs(repo_root: &Path) -> Result<Vec<PathBuf>, EnrichError> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(repo_root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            !is_factory_scan_skip_dir(name)
        })
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if file_name != "build-spec.yaml" {
            continue;
        }
        let parent = match p.parent() {
            Some(d) => d,
            None => continue,
        };
        let parent_name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if parent_name != ".factory" {
            continue;
        }
        let rel = normalize_repo_path(repo_root, p);
        // Skip examples under factory/ (factory/contract/examples/ etc).
        if rel.starts_with("factory/") {
            continue;
        }
        paths.push(p.to_path_buf());
    }
    paths.sort();
    Ok(paths)
}

fn is_factory_scan_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "target" | "node_modules" | ".git" | "build" | "dist" | ".next" | "out"
    )
}

/// Parse a factory build-spec YAML into a lightweight project record.
pub fn parse_factory_project(
    repo_root: &Path,
    spec_path: &Path,
) -> Result<Option<FactoryProjectRecord>, EnrichError> {
    let raw = match fs::read_to_string(spec_path) {
        Ok(r) => r,
        Err(_) => return Ok(None), // missing or unreadable; skip silently.
    };

    let yaml: serde_yaml::Value = match serde_yaml::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Ok(None), // unparseable; skip silently.
    };

    let project = yaml.get("project");
    let Some(project_name) = project
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    else {
        return Ok(None);
    };

    let variant = project
        .and_then(|p| p.get("variant"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let org = project
        .and_then(|p| p.get("org"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Compute content hash (matches spec-compiler's pattern: rel-path
    // + 0x00 separator + normalized content).
    let normalized = normalize_text(&raw);
    let rel = normalize_repo_path(repo_root, spec_path);
    let mut hasher = Sha256::new();
    hasher.update(rel.as_bytes());
    hasher.update([0u8]);
    hasher.update(&normalized);
    let content_hash = hex_lower(&hasher.finalize());

    // Check for sibling pipeline-state.json (carries adapter + status).
    let factory_dir = spec_path.parent().unwrap_or(Path::new("."));
    let state_path = factory_dir.join("pipeline-state.json");
    let (adapter, pipeline_status) = if state_path.is_file() {
        let state_raw = fs::read_to_string(&state_path).unwrap_or_default();
        let state_yaml: serde_yaml::Value =
            serde_yaml::from_str(&state_raw).unwrap_or(serde_yaml::Value::Null);
        let adapter = state_yaml
            .get("adapter")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let status = state_yaml
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        (adapter, status)
    } else {
        (None, None)
    };

    Ok(Some(FactoryProjectRecord {
        project_name,
        build_spec_path: rel,
        content_hash,
        variant,
        org,
        adapter,
        pipeline_status,
    }))
}

fn normalize_text(raw: &str) -> Vec<u8> {
    // Trim trailing whitespace per line; ensure single trailing newline.
    let mut out: Vec<u8> = Vec::with_capacity(raw.len());
    for line in raw.lines() {
        let stripped = line.trim_end();
        out.extend(stripped.as_bytes());
        out.push(b'\n');
    }
    out
}

fn normalize_repo_path(repo_root: &Path, path: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        write!(&mut s, "{b:02x}").expect("write to String");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_compliance_recognizes_canonical_shape() {
        let yaml = r#"
compliance:
  - framework: owasp-asi-2026
    controls:
      - ASI01
      - ASI05
        "#;
        let value: serde_yaml::Value = serde_yaml::from_str(yaml).unwrap();
        let m = value.as_mapping().unwrap();
        let entries = parse_compliance(m).expect("compliance entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].framework, "owasp-asi-2026");
        assert_eq!(entries[0].controls, vec!["ASI01", "ASI05"]);
    }

    #[test]
    fn parse_compliance_returns_none_when_missing() {
        let value: serde_yaml::Value = serde_yaml::from_str("title: foo").unwrap();
        let m = value.as_mapping().unwrap();
        assert!(parse_compliance(m).is_none());
    }

    #[test]
    fn parse_factory_project_extracts_project_name_and_optional_fields() {
        let dir = tempfile::tempdir().unwrap();
        let factory_dir = dir.path().join("my-project/.factory");
        fs::create_dir_all(&factory_dir).unwrap();
        let bp = factory_dir.join("build-spec.yaml");
        fs::write(
            &bp,
            r#"
project:
  name: my-project
  variant: production
  org: oap
"#,
        )
        .unwrap();

        let rec = parse_factory_project(dir.path(), &bp).unwrap().unwrap();
        assert_eq!(rec.project_name, "my-project");
        assert_eq!(rec.variant.as_deref(), Some("production"));
        assert_eq!(rec.org.as_deref(), Some("oap"));
        assert!(rec.adapter.is_none()); // no sibling pipeline-state.json
    }

    #[test]
    fn parse_factory_project_skips_when_name_missing() {
        let dir = tempfile::tempdir().unwrap();
        let factory_dir = dir.path().join(".factory");
        fs::create_dir_all(&factory_dir).unwrap();
        let bp = factory_dir.join("build-spec.yaml");
        fs::write(&bp, "project:\n  variant: x\n").unwrap();
        assert!(parse_factory_project(dir.path(), &bp).unwrap().is_none());
    }

    /// Spec 217: the committed registry is the sharded `by-spec` tree. Write one
    /// fabricated registry shard (`load_committed_registry` does not validate the
    /// shard hash, only the MAJOR schema version, so a placeholder hash is fine).
    fn write_registry_shard(repo: &Path, id: &str, spec_path: &str) {
        let by_spec = repo.join(".derived/spec-registry/by-spec");
        fs::create_dir_all(&by_spec).unwrap();
        let shard = serde_json::json!({
            "specVersion": "1.0.0",
            "shardHash": "0",
            "record": {
                "id": id,
                "title": id,
                "status": "approved",
                "created": "2026-01-01",
                "summary": "x",
                "specPath": spec_path,
            }
        });
        fs::write(
            by_spec.join(format!("{id}.json")),
            serde_json::to_string_pretty(&shard).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn enrich_walks_compliance_from_specs() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        // One committed shard pointing at a spec.md.
        write_registry_shard(repo, "001-x", "specs/001-x/spec.md");
        // Spec on disk with compliance frontmatter (read by the compliance walk).
        let spec_dir = repo.join("specs/001-x");
        fs::create_dir_all(&spec_dir).unwrap();
        fs::write(
            spec_dir.join("spec.md"),
            "---\nid: 001-x\ntitle: X\nstatus: approved\ncompliance:\n  - framework: owasp-asi-2026\n    controls:\n      - ASI01\n---\nbody\n",
        )
        .unwrap();

        let path = enrich_and_write(repo).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        let feature = v["features"][0].as_object().unwrap();
        let compliance = feature
            .get("compliance")
            .and_then(|c| c.as_array())
            .expect("compliance injected");
        assert_eq!(compliance.len(), 1);
        assert_eq!(compliance[0]["framework"], "owasp-asi-2026");
        // Enricher tag present.
        let build = v["build"].as_object().unwrap();
        assert_eq!(build["enricherId"], "oap-registry-enrich");
    }

    #[test]
    fn enrich_walks_factory_build_specs() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        // Empty committed registry (the dir must exist for the library reader).
        fs::create_dir_all(repo.join(".derived/spec-registry/by-spec")).unwrap();
        // Build spec under a project dir.
        let bp_dir = repo.join("p1/.factory");
        fs::create_dir_all(&bp_dir).unwrap();
        fs::write(
            bp_dir.join("build-spec.yaml"),
            "project:\n  name: p1\n  variant: prod\n",
        )
        .unwrap();

        let path = enrich_and_write(repo).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        let fp = v["factoryProjects"].as_array().expect("factoryProjects array");
        assert_eq!(fp.len(), 1);
        assert_eq!(fp[0]["projectName"], "p1");
    }
}
