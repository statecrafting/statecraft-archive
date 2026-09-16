// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md — §5 / T043

//! `materialise_run_root` — content-addressed cache I/O for a factory run.
//!
//! Builds the per-run cache directory from the reservation's `source_shas`
//! and the platform's adapter / contract / process bodies. Writes resolved
//! agent bodies through spec 123's `AgentResolver`. Cross-checks every
//! triple against the reservation's `source_shas.agents[]`; a drift aborts
//! materialisation rather than producing a half-built cache.
//!
//! Atomic-rename guarantee: the materialiser writes into a sibling temp
//! directory (`<cache_root>.tmp.<pid>.<rand>`) and only on success
//! `rename`s it into place. A concurrent run with identical `source_shas`
//! that completes first wins the rename; the racer observes the directory
//! exists, removes its temp dir, and reuses the warm cache.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use factory_engine::agent_resolver::{
    AgentReference, AgentResolver, ResolveError, ResolvedAgent,
};

use crate::cache_root::cache_root_for;
use crate::client::PlatformClient;
use crate::error::FactoryClientError;
use crate::wire::{RunReservation, WireAgentRef};

/// Result handed back by `materialise_run_root`. The `path` matches the
/// in-tree shape `factory-engine` already expects (spec 124 §5), so the
/// existing `factory_root` config keeps working without an API change.
#[derive(Debug, Clone)]
pub struct RunRoot {
    pub path: PathBuf,
    pub source_shas: crate::SourceShas,
    /// Warm-cache hit: directory existed prior to this call and was
    /// reused without re-fetching. Useful for telemetry — the desktop
    /// can show "cache hit" in the run-detail view.
    pub warm: bool,
}

impl PlatformClient {
    /// Materialise the per-run cache root described by `reservation`.
    ///
    /// Layout (spec §5):
    ///
    /// ```text
    /// <cache_root>/
    ///  ├── adapters/<adapter_name>/manifest.yaml
    ///  ├── process/manifest.yaml
    ///  ├── process/agents/<role>.md
    ///  ├── adapters/<adapter_name>/agents/<role>.md
    ///  └── contract/<name>.schema.json
    /// ```
    ///
    /// Behaviour:
    ///
    /// * If the cache directory already exists, returns it warm — no
    ///   network calls. (The directory is content-addressed by
    ///   `source_shas.run_sha()`, so its presence asserts content
    ///   equality with the current reservation.)
    /// * Otherwise: fetches the adapter / process / contract bodies,
    ///   resolves every agent reference in the process via
    ///   `agent_resolver`, cross-checks each triple against
    ///   `reservation.source_shas.agents[]`, writes everything to a temp
    ///   dir, and `rename`s into place atomically.
    pub async fn materialise_run_root(
        &self,
        reservation: &RunReservation,
        adapter_name: &str,
        process_name: &str,
        agent_resolver: &AgentResolver,
    ) -> Result<RunRoot, FactoryClientError> {
        let source_shas: crate::SourceShas = reservation.source_shas.clone().into();
        let final_path = cache_root_for(&source_shas);

        // Warm-cache short circuit. We don't validate the contents — the
        // directory's *existence* under the content-addressed path is the
        // assertion. A user that wipes individual files inside should
        // wipe the directory.
        if final_path.exists() {
            return Ok(RunRoot {
                path: final_path,
                source_shas,
                warm: true,
            });
        }

        // Fetch the bodies up-front so a partial write does not happen.
        let adapter = self.get_adapter(adapter_name).await?;
        let process = self.get_process(process_name).await?;

        // Walk the process for agent references and resolve each. We
        // collect all triples before writing to disk so a resolver
        // failure (retired agent, etc.) propagates without leaving a
        // half-built temp dir.
        let refs = walk_process_for_agent_refs(&process.definition);
        let mut resolved: Vec<(String, ResolvedAgent)> = Vec::with_capacity(refs.len());
        for r in &refs {
            let role = role_name_for_reference(r);
            let resolved_agent = agent_resolver
                .resolve(r.clone())
                .await
                .map_err(map_resolve_err)?;
            resolved.push((role, resolved_agent));
        }

        // Cross-check the resolver's triples against the reservation's
        // `agents[]`. Both sides should agree element-wise because the
        // platform's reservation walk uses the same process body — but a
        // drift here is a hard halt (T043 / spec 124 §6).
        cross_check_triples(&resolved, &reservation.source_shas.agents)?;

        // Walk contracts referenced by the process (`contract: <name>`
        // string fields) and fetch each.
        let contract_names = collect_contract_names(&process.definition);
        let mut contract_bodies = Vec::with_capacity(contract_names.len());
        for name in &contract_names {
            let body = self.get_contract(name).await?;
            contract_bodies.push((name.clone(), body));
        }

        // Write into a sibling temp dir, then `rename` into place.
        let tmp_path = sibling_tmp_path(&final_path);
        // If any predecessor temp exists (unlikely — the suffix is
        // unique per process per call), wipe it before populating.
        if tmp_path.exists() {
            fs::remove_dir_all(&tmp_path)?;
        }
        let materialise_result = (|| -> Result<(), FactoryClientError> {
            fs::create_dir_all(&tmp_path)?;
            write_adapter(&tmp_path, adapter_name, &adapter)?;
            write_process(&tmp_path, &process)?;
            for (role, agent) in &resolved {
                write_agent(&tmp_path, adapter_name, role, agent)?;
            }
            for (name, contract) in &contract_bodies {
                write_contract(&tmp_path, name, contract)?;
            }
            Ok(())
        })();

        if let Err(e) = materialise_result {
            // Best-effort cleanup of the temp dir on failure.
            let _ = fs::remove_dir_all(&tmp_path);
            return Err(e);
        }

        // Ensure parent of `final_path` exists, then rename.
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }
        match fs::rename(&tmp_path, &final_path) {
            Ok(()) => {}
            Err(_) if final_path.exists() => {
                // Another concurrent materialisation raced and won. Drop
                // our temp dir and reuse the winner's cache (idempotent
                // by content-addressing).
                let _ = fs::remove_dir_all(&tmp_path);
            }
            Err(e) => return Err(e.into()),
        }

        Ok(RunRoot {
            path: final_path,
            source_shas,
            warm: false,
        })
    }
}

// ---------------------------------------------------------------------------
// Pure helpers — public to support unit testing without an HTTP server.
// ---------------------------------------------------------------------------

/// Walk a process definition's JSON for embedded `AgentReference`
/// instances. Externally-tagged: `{"by_id": …}`, `{"by_name": …}`,
/// `{"by_name_latest": …}`. Mirrors the TypeScript walker in
/// `platform/services/statecraft/api/factory/agentRefWalker.ts`.
pub fn walk_process_for_agent_refs(node: &serde_json::Value) -> Vec<AgentReference> {
    let mut out = Vec::new();
    walk(node, &mut out);
    out
}

fn walk(node: &serde_json::Value, out: &mut Vec<AgentReference>) {
    if let Some(r) = as_agent_reference(node) {
        out.push(r);
        return;
    }
    if let Some(arr) = node.as_array() {
        for item in arr {
            walk(item, out);
        }
        return;
    }
    if let Some(map) = node.as_object() {
        for v in map.values() {
            walk(v, out);
        }
    }
}

fn as_agent_reference(node: &serde_json::Value) -> Option<AgentReference> {
    let map = node.as_object()?;
    if map.len() != 1 {
        return None;
    }
    let (key, inner) = map.iter().next()?;
    let inner = inner.as_object()?;
    match key.as_str() {
        "by_id" => Some(AgentReference::ById {
            org_agent_id: inner.get("org_agent_id")?.as_str()?.to_string(),
            version: inner.get("version")?.as_i64()?,
        }),
        "by_name" => Some(AgentReference::ByName {
            name: inner.get("name")?.as_str()?.to_string(),
            version: inner.get("version")?.as_i64()?,
        }),
        "by_name_latest" => Some(AgentReference::ByNameLatest {
            name: inner.get("name")?.as_str()?.to_string(),
        }),
        _ => None,
    }
}

/// Choose the per-stage on-disk filename used under `process/agents/` and
/// `adapters/<name>/agents/`. Spec §5 leaves the role-naming convention
/// to this crate. We use the agent name when known (`by_name` / `by_name_latest`)
/// and fall back to the org id for `by_id` so two distinct stages can never
/// collide.
fn role_name_for_reference(r: &AgentReference) -> String {
    match r {
        AgentReference::ById { org_agent_id, .. } => org_agent_id.clone(),
        AgentReference::ByName { name, .. }
        | AgentReference::ByNameLatest { name } => name.clone(),
    }
}

/// Collect every string under a `contract` key (recursively) from the
/// process definition. The contracts referenced may also live under
/// `contracts: [...]` lists; we accept both shapes.
pub fn collect_contract_names(node: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    fn walk_inner(node: &serde_json::Value, out: &mut Vec<String>) {
        if let Some(arr) = node.as_array() {
            for item in arr {
                walk_inner(item, out);
            }
            return;
        }
        if let Some(map) = node.as_object() {
            for (k, v) in map {
                if k == "contract"
                    && let Some(s) = v.as_str()
                {
                    if !out.contains(&s.to_string()) {
                        out.push(s.to_string());
                    }
                    continue;
                }
                if k == "contracts"
                    && let Some(arr) = v.as_array()
                {
                    for item in arr {
                        if let Some(s) = item.as_str()
                            && !out.contains(&s.to_string())
                        {
                            out.push(s.to_string());
                        }
                    }
                    continue;
                }
                walk_inner(v, out);
            }
        }
    }
    walk_inner(node, &mut out);
    out
}

fn cross_check_triples(
    resolved: &[(String, ResolvedAgent)],
    reservation_agents: &[WireAgentRef],
) -> Result<(), FactoryClientError> {
    if resolved.len() != reservation_agents.len() {
        return Err(FactoryClientError::AgentDrift(format!(
            "resolver produced {} triples; reservation has {}",
            resolved.len(),
            reservation_agents.len(),
        )));
    }
    for ((role, r), wire) in resolved.iter().zip(reservation_agents.iter()) {
        if r.org_agent_id != wire.org_agent_id
            || r.version != wire.version
            || r.content_hash != wire.content_hash
        {
            return Err(FactoryClientError::AgentDrift(format!(
                "stage {role}: resolver=({}, v{}, {}) reservation=({}, v{}, {})",
                r.org_agent_id,
                r.version,
                r.content_hash,
                wire.org_agent_id,
                wire.version,
                wire.content_hash,
            )));
        }
    }
    Ok(())
}

fn map_resolve_err(e: ResolveError) -> FactoryClientError {
    match e {
        ResolveError::RetiredAgent {
            org_agent_id,
            version,
        } => FactoryClientError::RetiredAgent(format!(
            "{org_agent_id} v{version}"
        )),
        ResolveError::NotFound { reference } => {
            FactoryClientError::Resolver(format!("not found: {reference}"))
        }
        ResolveError::AmbiguousName { name, count } => FactoryClientError::Resolver(
            format!("ambiguous name {name}: {count} matches"),
        ),
        ResolveError::VersionMismatch { requested, actual } => {
            FactoryClientError::Resolver(format!(
                "version mismatch: requested {requested}, catalog has {actual}",
            ))
        }
        ResolveError::Client(c) => FactoryClientError::Resolver(c.to_string()),
    }
}

// ---------------------------------------------------------------------------
// File writers
// ---------------------------------------------------------------------------

/// Reject a platform-supplied name before it becomes a path component under
/// the per-run cache root: empty, containing a path separator (`/` or `\`),
/// or a bare `.`/`..` component. `adapter_name`, contract names, and agent
/// roles all come from platform responses (or are derived from a name/id in
/// one); without this check a crafted response could steer
/// `root.join("adapters").join(adapter_name)` (and siblings) outside the
/// intended cache subtree.
fn validate_path_component(field: &'static str, value: &str) -> Result<(), FactoryClientError> {
    let invalid = value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\');
    if invalid {
        return Err(FactoryClientError::InvalidPathComponent {
            field,
            value: value.to_string(),
        });
    }
    Ok(())
}

fn write_adapter(
    root: &Path,
    adapter_name: &str,
    adapter: &crate::wire::AdapterBody,
) -> Result<(), FactoryClientError> {
    validate_path_component("adapter_name", adapter_name)?;
    let dir = root.join("adapters").join(adapter_name);
    fs::create_dir_all(&dir)?;
    // Spec 124: reject a non-spec-074 document before caching it. `manifest`
    // is an untyped `serde_json::Value`; an org whose substrate lacks a real
    // adapter-manifest row gets a knowledge/orchestration bundle (no
    // `schema_version`) that would otherwise be cached verbatim and fail later
    // in engine startup with a cryptic `missing field 'schema_version'`. This
    // cheap top-level guard catches that case early, attributably, and is
    // symmetric with the statecraft `getAdapter` guard; the engine still does
    // full `AdapterManifest` validation when it reads the cache.
    let has_schema_version = adapter
        .manifest
        .get("schema_version")
        .and_then(|v| v.as_str())
        .is_some();
    if !has_schema_version {
        return Err(FactoryClientError::CacheIo(format!(
            "statecraft served a non-spec-074 adapter manifest for '{adapter_name}' \
             (no string `schema_version`): the org's factory substrate is missing a valid \
             AdapterManifest for this adapter; trigger an upstream sync or seed the adapter \
             manifest on the platform."
        )));
    }
    let manifest_yaml = serde_yaml::to_string(&adapter.manifest)
        .map_err(|e| FactoryClientError::CacheIo(e.to_string()))?;
    fs::write(dir.join("manifest.yaml"), manifest_yaml)?;
    Ok(())
}

fn write_process(
    root: &Path,
    process: &crate::wire::ProcessBody,
) -> Result<(), FactoryClientError> {
    let dir = root.join("process");
    fs::create_dir_all(&dir)?;
    let yaml = serde_yaml::to_string(&process.definition)
        .map_err(|e| FactoryClientError::CacheIo(e.to_string()))?;
    fs::write(dir.join("manifest.yaml"), yaml)?;
    Ok(())
}

fn write_contract(
    root: &Path,
    name: &str,
    contract: &crate::wire::ContractBody,
) -> Result<(), FactoryClientError> {
    validate_path_component("contract_name", name)?;
    let dir = root.join("contract");
    fs::create_dir_all(&dir)?;
    let pretty = serde_json::to_vec_pretty(&contract.schema)?;
    fs::write(dir.join(format!("{name}.schema.json")), pretty)?;
    Ok(())
}

fn write_agent(
    root: &Path,
    adapter_name: &str,
    role: &str,
    agent: &ResolvedAgent,
) -> Result<(), FactoryClientError> {
    validate_path_component("adapter_name", adapter_name)?;
    validate_path_component("role", role)?;
    let body = compose_agent_markdown(&agent.frontmatter, &agent.body_markdown)?;
    // Spec §5 layout — duplicate under both `process/agents/` and
    // `adapters/<adapter>/agents/`. factory-engine reads from both
    // depending on which entity owns the agent definition; we keep both
    // copies to preserve the in-tree shape.
    let process_dir = root.join("process").join("agents");
    fs::create_dir_all(&process_dir)?;
    fs::write(process_dir.join(format!("{role}.md")), &body)?;

    let adapter_dir = root
        .join("adapters")
        .join(adapter_name)
        .join("agents");
    fs::create_dir_all(&adapter_dir)?;
    fs::write(adapter_dir.join(format!("{role}.md")), &body)?;
    Ok(())
}

fn compose_agent_markdown(
    frontmatter: &serde_json::Value,
    body: &str,
) -> Result<String, FactoryClientError> {
    let yaml = serde_yaml::to_string(frontmatter)
        .map_err(|e| FactoryClientError::CacheIo(e.to_string()))?;
    let body_trimmed = body.trim_start_matches('\n');
    Ok(format!("---\n{yaml}---\n{body_trimmed}"))
}

// ---------------------------------------------------------------------------
// Temp-dir naming
// ---------------------------------------------------------------------------

static TMP_COUNTER: AtomicU32 = AtomicU32::new(0);

fn sibling_tmp_path(final_path: &Path) -> PathBuf {
    let pid = std::process::id();
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stem = final_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("oap-factory-tmp");
    let parent = final_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!(".{stem}.tmp.{pid}.{n}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn walks_process_for_agent_refs_in_stage_order() {
        let proc_def = json!({
            "stages": [
                { "id": "s0", "agent_ref": { "by_name_latest": { "name": "extract" } } },
                { "id": "s1", "agent_ref": { "by_name": { "name": "design", "version": 2 } } },
                { "id": "s2", "agent_ref": { "by_id": { "org_agent_id": "a-1", "version": 3 } } },
            ]
        });
        let refs = walk_process_for_agent_refs(&proc_def);
        assert_eq!(refs.len(), 3);
        assert!(matches!(refs[0], AgentReference::ByNameLatest { .. }));
        assert!(matches!(refs[1], AgentReference::ByName { .. }));
        assert!(matches!(refs[2], AgentReference::ById { .. }));
    }

    #[test]
    fn collect_contract_names_dedupes_referenced_contracts() {
        // Order is governed by serde_json's object iteration (alphabetical
        // with the default BTreeMap) — we only assert membership + dedup.
        let proc_def = json!({
            "stages": [
                { "contract": "build_spec" },
                { "contract": "manifest" },
                { "contract": "build_spec" },  // duplicate
            ],
            "shared": { "contracts": ["audit", "build_spec"] }
        });
        let mut names = collect_contract_names(&proc_def);
        names.sort();
        assert_eq!(names, vec!["audit", "build_spec", "manifest"]);
    }

    #[test]
    fn cross_check_triples_passes_on_match() {
        let resolved = vec![(
            "extract".to_string(),
            ResolvedAgent {
                org_agent_id: "ag-1".into(),
                version: 1,
                content_hash: "h-1".into(),
                frontmatter: serde_json::Value::Null,
                body_markdown: "".into(),
            },
        )];
        let wire = vec![WireAgentRef {
            org_agent_id: "ag-1".into(),
            version: 1,
            content_hash: "h-1".into(),
        }];
        cross_check_triples(&resolved, &wire).unwrap();
    }

    #[test]
    fn cross_check_triples_aborts_on_drift() {
        let resolved = vec![(
            "extract".to_string(),
            ResolvedAgent {
                org_agent_id: "ag-1".into(),
                version: 1,
                content_hash: "DIFFERENT".into(),
                frontmatter: serde_json::Value::Null,
                body_markdown: "".into(),
            },
        )];
        let wire = vec![WireAgentRef {
            org_agent_id: "ag-1".into(),
            version: 1,
            content_hash: "h-1".into(),
        }];
        let err = cross_check_triples(&resolved, &wire).unwrap_err();
        assert!(matches!(err, FactoryClientError::AgentDrift(_)));
    }

    #[test]
    fn cross_check_triples_aborts_on_count_mismatch() {
        let resolved = vec![];
        let wire = vec![WireAgentRef {
            org_agent_id: "ag-1".into(),
            version: 1,
            content_hash: "h-1".into(),
        }];
        let err = cross_check_triples(&resolved, &wire).unwrap_err();
        match err {
            FactoryClientError::AgentDrift(m) => {
                assert!(m.contains("0 triples; reservation has 1"));
            }
            _ => panic!("expected AgentDrift"),
        }
    }

    // ---------------------------------------------------------------------
    // Path-component validation: adapter_name / contract name / agent role
    // are platform-supplied and must not be able to steer a write outside
    // the per-run cache directory.
    // ---------------------------------------------------------------------

    #[test]
    fn validate_path_component_accepts_plain_names() {
        assert!(validate_path_component("adapter_name", "acme-vue-encore").is_ok());
        assert!(validate_path_component("role", "extract").is_ok());
    }

    #[test]
    fn validate_path_component_rejects_traversal_and_separators() {
        for bad in ["..", ".", "", "../evil", "a/b", "a\\b", "/etc/passwd"] {
            let err = validate_path_component("adapter_name", bad).unwrap_err();
            assert!(
                matches!(err, FactoryClientError::InvalidPathComponent { .. }),
                "expected InvalidPathComponent for {bad:?}, got {err:?}"
            );
        }
    }

    fn sample_adapter() -> crate::wire::AdapterBody {
        crate::wire::AdapterBody {
            name: "acme-vue-encore".into(),
            version: "1".into(),
            source_sha: "sha".into(),
            synced_at: "2026-01-01T00:00:00Z".into(),
            manifest: json!({ "schema_version": "1" }),
        }
    }

    #[test]
    fn write_adapter_rejects_traversal_in_adapter_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = write_adapter(dir.path(), "../../evil", &sample_adapter()).unwrap_err();
        assert!(matches!(
            err,
            FactoryClientError::InvalidPathComponent { .. }
        ));
        // Nothing should have been written outside (or even inside) the
        // per-run root: the rejection happens before any fs::write.
        assert!(!dir.path().parent().unwrap().join("evil").exists());
    }

    #[test]
    fn write_contract_rejects_traversal_in_name() {
        let dir = tempfile::tempdir().unwrap();
        let contract = crate::wire::ContractBody {
            name: "spec".into(),
            version: "1".into(),
            source_sha: "sha".into(),
            synced_at: "2026-01-01T00:00:00Z".into(),
            schema: json!({}),
        };
        let err = write_contract(dir.path(), "../evil", &contract).unwrap_err();
        assert!(matches!(
            err,
            FactoryClientError::InvalidPathComponent { .. }
        ));
    }

    #[test]
    fn write_agent_rejects_traversal_in_adapter_name_and_role() {
        let dir = tempfile::tempdir().unwrap();
        let agent = ResolvedAgent {
            org_agent_id: "ag-1".into(),
            version: 1,
            content_hash: "h-1".into(),
            frontmatter: serde_json::Value::Null,
            body_markdown: "body".into(),
        };
        let err = write_agent(dir.path(), "../evil", "extract", &agent).unwrap_err();
        assert!(matches!(
            err,
            FactoryClientError::InvalidPathComponent { .. }
        ));
        let err = write_agent(dir.path(), "acme-vue-encore", "../evil", &agent).unwrap_err();
        assert!(matches!(
            err,
            FactoryClientError::InvalidPathComponent { .. }
        ));
    }
}
