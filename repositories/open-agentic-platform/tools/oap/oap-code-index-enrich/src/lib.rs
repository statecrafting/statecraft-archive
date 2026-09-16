//! OAP-side enricher for the generic codebase index.
//!
//! Walks the OAP-specific directories (`factory/adapters/`,
//! `.claude/{agents,commands,rules,schemas}/`, `.github/workflows/`) and
//! emits `.derived/codebase-index/index-oap.json` with Layers 3-5 overlaid on
//! the generic Layers 1-2.
//!
//! Spec 217 engine swap: the generic Layers 1-2 are assembled from the
//! committed sharded index (`.derived/codebase-index/by-spec`, `by-package`)
//! via `spec_spine_core::load_committed_index` and projected to JSON, replacing
//! the former in-tree indexer's load of a monolithic
//! `index.json` (the library emits no monolith). The typed `CodebaseIndex` is
//! the Layer 1-2 base; the OAP overlay is layered on top.

use spec_spine_core::load_committed_index;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub mod render;
pub mod scanners {
    pub mod factory;
    pub mod infra;
    pub mod workflows;
}

pub mod types;

pub use scanners::factory::scan_adapters;
pub use scanners::infra::scan_infrastructure;
pub use scanners::workflows::{ScanResult as WorkflowScanResult, scan_workflows};
pub use types::{
    AdapterRecord, EnrichDiagnostic, Infrastructure, NamedEntry, ToolEntry, WorkflowTrace,
    WorkflowTraceSource,
};

#[derive(Debug)]
pub enum EnrichError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Index(String),
    Invalid(String),
}

impl std::fmt::Display for EnrichError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnrichError::Io(e) => write!(f, "{e}"),
            EnrichError::Json(e) => write!(f, "{e}"),
            EnrichError::Index(e) => write!(f, "{e}"),
            EnrichError::Invalid(msg) => write!(f, "{msg}"),
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

/// Load the spec-spine config for `repo_root` (spec 217 engine swap): the
/// committed `spec-spine.toml` when present, else `Config::default()` (which
/// already points `derived_dir` at `.derived`).
fn load_spec_spine_config(repo_root: &Path) -> spec_spine_types::Config {
    fs::read_to_string(repo_root.join("spec-spine.toml"))
        .ok()
        .and_then(|src| spec_spine_types::load_config(&src).ok())
        .unwrap_or_default()
}

/// Compute the enriched index bytes (deterministic, sorted, pretty).
pub fn enrich(repo_root: &Path) -> Result<Vec<u8>, EnrichError> {
    // Spec 217 engine swap: the committed index is the sharded by-spec /
    // by-package tree (no monolithic index.json). Assemble the typed
    // CodebaseIndex via the library and project Layers 1-2 from it.
    let cfg = load_spec_spine_config(repo_root);
    let index =
        load_committed_index(&cfg, repo_root).map_err(|e| EnrichError::Index(e.to_string()))?;

    let (adapters, factory_diags) = scan_adapters(repo_root);
    let infrastructure = scan_infrastructure(repo_root);
    let workflow_scan = scan_workflows(repo_root);

    // The typed library index serializes to the generic Layers 1-2 shape
    // (camelCase: schemaVersion / build / packages / traceability /
    // diagnostics). Overlay Layers 3-5 onto it.
    let mut enriched: Value = serde_json::to_value(&index)?;
    let obj = enriched.as_object_mut().ok_or_else(|| {
        EnrichError::Invalid("serialized index is not an object".to_string())
    })?;

    // Overlay Layer 3 (factory adapters).
    obj.insert("factory".to_string(), serde_json::to_value(&adapters)?);

    // Overlay Layer 4 (infrastructure).
    obj.insert(
        "infrastructure".to_string(),
        serde_json::to_value(&infrastructure)?,
    );

    // Overlay Layer 5 (workflow traceability).
    obj.insert(
        "workflowTraceability".to_string(),
        serde_json::to_value(&workflow_scan.traces)?,
    );

    // Merge diagnostics: union of generic's existing diagnostics +
    // enricher's new ones. Generic diagnostics still live on the
    // pre-W-07c CodebaseIndex; we preserve them and append the
    // enricher's emissions so reviewers see both classes.
    let mut all_diags: Vec<EnrichDiagnostic> = Vec::new();
    all_diags.extend(factory_diags);
    all_diags.extend(workflow_scan.diagnostics);
    if !all_diags.is_empty() {
        let diagnostics = obj
            .entry("diagnostics".to_string())
            .or_insert_with(|| {
                serde_json::json!({ "warnings": [], "errors": [] })
            })
            .as_object_mut()
            .ok_or_else(|| EnrichError::Invalid("diagnostics is not an object".into()))?;
        let warnings = diagnostics
            .entry("warnings".to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| EnrichError::Invalid("warnings is not an array".into()))?;
        for d in &all_diags {
            warnings.push(serde_json::to_value(d)?);
        }
    }

    // Tag the enricher in the build block.
    let build = obj
        .entry("build".to_string())
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| EnrichError::Invalid("build is not an object".into()))?;
    build.insert(
        "enricherId".to_string(),
        Value::String("oap-code-index-enrich".to_string()),
    );
    build.insert(
        "enricherVersion".to_string(),
        Value::String(env!("CARGO_PKG_VERSION").to_string()),
    );

    canonical_json_bytes(&enriched)
}

/// Compute the enriched index and write to
/// `build/codebase-index/index-oap.json`.
pub fn enrich_and_write(repo_root: &Path) -> Result<PathBuf, EnrichError> {
    let bytes = enrich(repo_root)?;
    let out_dir = repo_root.join(".derived/codebase-index");
    fs::create_dir_all(&out_dir)?;
    let out = out_dir.join("index-oap.json");
    fs::write(&out, bytes)?;
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Spec 217: the committed index is the sharded by-spec / by-package tree
    /// under `.derived/codebase-index`. The enricher's job is the OAP overlay
    /// (Layers 3-5), so these tests exercise it against an empty committed
    /// index (the shard dirs exist but hold no shards). `load_committed_index`
    /// then yields an empty `CodebaseIndex` onto which the overlay is layered.
    fn write_empty_index_shards(repo: &Path) {
        let base = repo.join(".derived/codebase-index");
        fs::create_dir_all(base.join("by-spec")).unwrap();
        fs::create_dir_all(base.join("by-package")).unwrap();
    }

    #[test]
    fn enrich_walks_factory_adapters() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        write_empty_index_shards(repo);

        let adapter_dir = repo.join("factory/adapters/my-adapter");
        fs::create_dir_all(&adapter_dir).unwrap();
        fs::write(
            adapter_dir.join("manifest.yaml"),
            "adapter:\n  name: my-adapter\n  version: \"1.0\"\nstack:\n  language: rust\n",
        )
        .unwrap();

        let path = enrich_and_write(repo).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let factory = v["factory"].as_array().expect("factory array");
        assert_eq!(factory.len(), 1);
        assert_eq!(factory[0]["name"], "my-adapter");
        assert_eq!(factory[0]["version"], "1.0");
    }

    #[test]
    fn enrich_walks_claude_dirs_for_infrastructure() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        write_empty_index_shards(repo);

        let agents_dir = repo.join(".claude/agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(
            agents_dir.join("my-agent.md"),
            "---\nname: my-agent\ndescription: Test agent\n---\nbody\n",
        )
        .unwrap();

        let path = enrich_and_write(repo).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let infra = v["infrastructure"].as_object().expect("infrastructure obj");
        let agents = infra["agents"].as_array().expect("agents array");
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0]["name"], "my-agent");
        assert_eq!(agents[0]["description"], "Test agent");
    }

    #[test]
    fn enrich_emits_workflow_traceability_and_i105_diagnostic() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        write_empty_index_shards(repo);

        let wf_dir = repo.join(".github/workflows");
        fs::create_dir_all(&wf_dir).unwrap();
        fs::write(
            wf_dir.join("with-spec.yml"),
            "# Spec: 042-multi-provider-agent-registry\nname: x\n",
        )
        .unwrap();
        fs::write(wf_dir.join("orphan.yml"), "name: orphan\n").unwrap();

        let path = enrich_and_write(repo).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let traces = v["workflowTraceability"].as_array().expect("trace array");
        assert_eq!(traces.len(), 2);
        // I-105 diagnostic appears for the orphan workflow.
        let warnings = v["diagnostics"]["warnings"].as_array().expect("warnings");
        let i105 = warnings.iter().find(|w| w["code"] == "I-105");
        assert!(i105.is_some(), "I-105 diagnostic missing");
    }

    #[test]
    fn enrich_tags_build_block() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        write_empty_index_shards(repo);

        let path = enrich_and_write(repo).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let build = v["build"].as_object().expect("build object");
        assert_eq!(build["enricherId"], "oap-code-index-enrich");
    }

    #[test]
    fn enrich_succeeds_against_committed_shard_tree() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        write_empty_index_shards(repo);
        let _path = enrich_and_write(repo)
            .expect("enrich must succeed on the sharded committed index");
    }
}
