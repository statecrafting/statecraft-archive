//! Adapter scopes compiler (spec 105 Phase 1; derivation source amended by
//! spec 198 FR-012).
//!
//! Reads every `<adapters-dir>/*/manifest.yaml` from a factory source
//! checkout (e.g. factory) and emits the enforcement snapshot
//! `adapter-scopes.json` as a DERIVED PROJECTION of each adapter's
//! `governance:` sub-envelope:
//!
//! - `file_write_scope` — verbatim from `governance.file_write_scope`
//!   (the declared, admission-validated write globs; spec 198 FR-012).
//! - `allowed_commands` — unique binary names from every command string
//!   under `commands:`. The compiler always reads the manifest's own
//!   `commands:` map (one home per fact); the admission gate separately
//!   enforces that `governance.allowed_commands_from` declares `commands`
//!   (the only defined value), so the two stay consistent by construction.
//!
//! A manifest without a `governance:` section fails the compile: the
//! snapshot projects the *admitted* sub-envelope(s), and a manifest lacking
//! one is not admissible (adapter-manifest schema 1.1.0, spec 198 FR-012).
//! The pre-198 heuristic (top-level directories scraped from
//! `directory_conventions:`) is retired — OAP materialises the snapshot;
//! it no longer authors the facts.
//!
//! Replaces `scripts/compile-adapter-scopes.js`. Output is deterministic —
//! no timestamp — so the committed artifact is stable across regenerations.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

/// Keys under `commands:` whose scalar value is a single executable command.
/// Mirrors the JS COMMAND_KEYS set exactly.
const TOP_LEVEL_COMMAND_KEYS: &[&str] = &[
    "install",
    "compile",
    "test",
    "lint",
    "dev",
    "format_check",
    "format",
    "type_check",
    "seed",
    "migrate",
    "gen_client",
];

/// Snapshot header emitted into the compiled JSON. States provenance and
/// the no-hand-edit rule next to the facts it governs.
const SNAPSHOT_COMMENT: &str = "Spec 198 FR-012 — DERIVED PROJECTION of the \
admitted adapter sub-envelope(s) (manifest governance: section). Generated \
by adapter-scopes-compiler from the factory source's adapters/*/manifest.yaml; \
do not hand-edit. One home per fact: the manifest declares, this snapshot \
materialises enforcement.";

#[derive(Debug, Deserialize)]
struct Manifest {
    adapter: AdapterSection,
    #[serde(default)]
    commands: serde_yaml::Value,
    governance: Option<GovernanceSection>,
}

#[derive(Debug, Deserialize)]
struct AdapterSection {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GovernanceSection {
    file_write_scope: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AdapterScope {
    pub file_write_scope: Vec<String>,
    pub allowed_commands: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CompiledOutput {
    #[serde(rename = "_comment")]
    pub comment: String,
    pub adapters: BTreeMap<String, AdapterScope>,
}

/// Discover every adapter directory that contains a `manifest.yaml`, compile
/// each, and return the combined output with adapters keyed by name.
pub fn compile_from_adapters_dir(adapters_dir: &Path) -> Result<CompiledOutput, String> {
    let mut entries: Vec<_> = fs::read_dir(adapters_dir)
        .map_err(|e| {
            format!(
                "reading --adapters-dir {}: {e}",
                adapters_dir.display()
            )
        })?
        .filter_map(Result::ok)
        .filter(|e| e.path().join("manifest.yaml").is_file())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    if entries.is_empty() {
        return Err(format!(
            "no adapter manifests under {}",
            adapters_dir.display()
        ));
    }

    let mut adapters = BTreeMap::new();
    for entry in entries {
        let manifest_path = entry.path().join("manifest.yaml");
        let text = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("reading {}: {e}", manifest_path.display()))?;
        let manifest: Manifest = serde_yaml::from_str(&text)
            .map_err(|e| format!("parsing {}: {e}", manifest_path.display()))?;

        let scope = compile_adapter(&manifest)?;
        if adapters.contains_key(&manifest.adapter.name) {
            return Err(format!(
                "duplicate adapter name '{}' (second manifest: {}) — each \
                 adapter.name keys one snapshot entry; a silent overwrite would \
                 drop an admitted scope set",
                manifest.adapter.name,
                manifest_path.display()
            ));
        }
        adapters.insert(manifest.adapter.name, scope);
    }

    Ok(CompiledOutput {
        comment: SNAPSHOT_COMMENT.to_string(),
        adapters,
    })
}

fn compile_adapter(m: &Manifest) -> Result<AdapterScope, String> {
    let Some(governance) = &m.governance else {
        return Err(format!(
            "adapter '{}': manifest has no governance: section — the snapshot \
             projects the admitted adapter sub-envelope (spec 198 FR-012), and a \
             manifest without one is not admissible (adapter-manifest schema 1.1.0)",
            m.adapter.name
        ));
    };
    if governance.file_write_scope.is_empty() {
        return Err(format!(
            "adapter '{}': governance.file_write_scope is empty (an adapter that \
             writes nowhere scaffolds nothing)",
            m.adapter.name
        ));
    }

    let mut binaries: BTreeSet<String> = BTreeSet::new();
    for cmd in extract_commands(&m.commands) {
        if let Some(bin) = first_word(&cmd) {
            binaries.insert(bin.to_string());
        }
    }

    Ok(AdapterScope {
        // Verbatim, declaration order preserved: these are the admitted
        // write globs, not an OAP-derived approximation.
        file_write_scope: governance.file_write_scope.clone(),
        allowed_commands: binaries.into_iter().collect(),
    })
}

/// Walk `commands:` and collect every executable command string.
/// - Top-level scalar values: only if the key is in TOP_LEVEL_COMMAND_KEYS.
/// - List values: every scalar item, or `command:` field from mapping items.
fn extract_commands(value: &serde_yaml::Value) -> Vec<String> {
    let mut out = Vec::new();
    let Some(mapping) = value.as_mapping() else {
        return out;
    };
    for (k, v) in mapping {
        let Some(key) = k.as_str() else { continue };
        match v {
            serde_yaml::Value::String(s) if TOP_LEVEL_COMMAND_KEYS.contains(&key) => {
                out.push(s.trim().to_string());
            }
            serde_yaml::Value::Sequence(seq) => {
                for item in seq {
                    match item {
                        serde_yaml::Value::String(s) => out.push(s.trim().to_string()),
                        serde_yaml::Value::Mapping(m) => {
                            if let Some(cmd) =
                                m.get(serde_yaml::Value::String("command".into()))
                                    .and_then(|v| v.as_str())
                            {
                                out.push(cmd.trim().to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn first_word(s: &str) -> Option<&str> {
    s.split_whitespace().next()
}

/// Serialize to JSON with 2-space indentation and a trailing newline,
/// matching the JavaScript `JSON.stringify(v, null, 2) + "\n"` shape.
pub fn serialize_to_string(output: &CompiledOutput) -> Result<String, String> {
    let mut s = serde_json::to_string_pretty(output)
        .map_err(|e| format!("serialize: {e}"))?;
    s.push('\n');
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(yaml: &str) -> Manifest {
        serde_yaml::from_str(yaml).unwrap()
    }

    #[test]
    fn first_word_basic() {
        assert_eq!(first_word("npm install"), Some("npm"));
        assert_eq!(first_word("  npx tsc --noEmit"), Some("npx"));
        assert_eq!(first_word("cargo"), Some("cargo"));
        assert_eq!(first_word(""), None);
    }

    #[test]
    fn governance_scope_is_projected_verbatim_in_declared_order() {
        let m = manifest(
            r#"
adapter:
  name: "acme-vue-encore"
commands:
  install: "npm install"
  test: "npm test"
governance:
  max_tier: tier2
  file_write_scope:
    - "apps/api/**"
    - "apps/web/**"
    - "package.json"
    - ".env.external.example"
  allowed_commands_from: commands
"#,
        );
        let scope = compile_adapter(&m).unwrap();
        assert_eq!(
            scope.file_write_scope,
            vec![
                "apps/api/**",
                "apps/web/**",
                "package.json",
                ".env.external.example"
            ]
        );
        assert_eq!(scope.allowed_commands, vec!["npm"]);
    }

    #[test]
    fn manifest_without_governance_fails_closed() {
        let m = manifest(
            r#"
adapter:
  name: "legacy-adapter"
commands:
  install: "npm install"
"#,
        );
        let err = compile_adapter(&m).unwrap_err();
        assert!(err.contains("no governance: section"), "got: {err}");
        assert!(err.contains("spec 198 FR-012"), "got: {err}");
    }

    #[test]
    fn empty_file_write_scope_fails_closed() {
        let m = manifest(
            r#"
adapter:
  name: "empty-scope"
governance:
  file_write_scope: []
"#,
        );
        let err = compile_adapter(&m).unwrap_err();
        assert!(err.contains("file_write_scope is empty"), "got: {err}");
    }

    #[test]
    fn extract_commands_top_level_filters_by_keys() {
        let y: serde_yaml::Value = serde_yaml::from_str(
            r#"
install: "npm install"
timeout_ms: 30000
test: "npm test"
custom_unknown: "should not appear"
"#,
        )
        .unwrap();
        let cmds = extract_commands(&y);
        assert!(cmds.contains(&"npm install".to_string()));
        assert!(cmds.contains(&"npm test".to_string()));
        assert!(!cmds.contains(&"should not appear".to_string()));
    }

    #[test]
    fn extract_commands_list_items() {
        let y: serde_yaml::Value = serde_yaml::from_str(
            r#"
feature_verify:
  - "npm run build"
  - "npm test"
pre_verify:
  - command: "npx tsc --noEmit"
    working_dir: "."
    timeout_ms: 30000
"#,
        )
        .unwrap();
        let cmds = extract_commands(&y);
        assert!(cmds.contains(&"npm run build".to_string()));
        assert!(cmds.contains(&"npm test".to_string()));
        assert!(cmds.contains(&"npx tsc --noEmit".to_string()));
    }
}
