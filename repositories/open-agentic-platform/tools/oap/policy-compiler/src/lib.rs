use chrono::{SecondsFormat, Utc};
use open_agentic_spec_types::split_frontmatter_optional;
pub use open_agentic_policy_kernel::PolicyRule;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

const COMPILER_ID: &str = "open-agentic-policy-compiler";
const POLICY_BUNDLE_VERSION: &str = "1";

#[derive(Debug)]
pub enum CompileError {
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl From<std::io::Error> for CompileError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for CompileError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl std::fmt::Display for CompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CompileError::Io(e) => write!(f, "{e}"),
            CompileError::Json(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for CompileError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicySource {
    pub path: String,
    pub precedence: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Violation {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileOutput {
    pub sources: Vec<PolicySource>,
    pub rules: Vec<PolicyRule>,
    pub violations: Vec<Violation>,
    #[serde(rename = "validationPassed")]
    pub validation_passed: bool,
    /// Canonical bundle hash (payload excludes `compiledAt`, `policyBundleHash`, and `validation`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub policy_bundle_hash: Option<String>,
    pub constitution: Vec<PolicyRule>,
    pub shards: BTreeMap<String, Vec<PolicyRule>>,
}

pub fn compile_and_write(repo_root: &Path) -> Result<CompileOutput, CompileError> {
    let out = compile(repo_root)?;
    let out_dir = repo_root.join(".derived/policy-bundles");
    fs::create_dir_all(&out_dir)?;
    let json = serde_json::to_vec_pretty(&build_bundle_json_value(&out))?;
    fs::write(out_dir.join("policy-bundle.json"), json)?;
    Ok(out)
}

/// Builds the JSON object written to `policy-bundle.json` (includes timestamp when applicable).
pub fn build_bundle_json_value(out: &CompileOutput) -> Value {
    let compiler_version = env!("CARGO_PKG_VERSION");
    let compiled_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let sources_val = serde_json::to_value(&out.sources).expect("sources");
    let viol_val = serde_json::to_value(&out.violations).expect("violations");
    let constitution_val = serde_json::to_value(&out.constitution).expect("constitution");
    let shards_val = serde_json::to_value(&out.shards).expect("shards");

    let mut metadata = json!({
        "compilerId": COMPILER_ID,
        "compilerVersion": compiler_version,
        "sources": sources_val,
    });
    if let Some(ref h) = out.policy_bundle_hash {
        metadata
            .as_object_mut()
            .expect("metadata object")
            .insert("policyBundleHash".into(), Value::String(h.clone()));
        metadata
            .as_object_mut()
            .expect("metadata object")
            .insert("compiledAt".into(), Value::String(compiled_at));
    }

    json!({
        "policyBundleVersion": POLICY_BUNDLE_VERSION,
        "metadata": metadata,
        "validation": {
            "passed": out.validation_passed,
            "violations": viol_val,
        },
        "constitution": constitution_val,
        "shards": shards_val,
    })
}

/// Payload hashed for [`CompileOutput::policy_bundle_hash`]: no `compiledAt`, no `policyBundleHash`.
/// Excludes `validation` so the hash reflects policy content only (P2-001).
pub fn bundle_hash_payload_value(out: &CompileOutput) -> Value {
    let compiler_version = env!("CARGO_PKG_VERSION");
    let sources_val = serde_json::to_value(&out.sources).expect("sources");
    let constitution_val = serde_json::to_value(&out.constitution).expect("constitution");
    let shards_val = serde_json::to_value(&out.shards).expect("shards");

    json!({
        "policyBundleVersion": POLICY_BUNDLE_VERSION,
        "metadata": {
            "compilerId": COMPILER_ID,
            "compilerVersion": compiler_version,
            "sources": sources_val,
        },
        "constitution": constitution_val,
        "shards": shards_val,
    })
}

pub fn compute_policy_bundle_hash(out: &CompileOutput) -> String {
    let v = bundle_hash_payload_value(out);
    hash_canonical_json(&v)
}

fn hash_canonical_json(value: &Value) -> String {
    let sorted = sort_json_value(value.clone());
    let s = serde_json::to_string(&sorted).expect("canonical json");
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn sort_json_value(v: Value) -> Value {
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

/// FR-003: `scope == global` and `mode == enforce` → constitution; all other rules → shards by scope tag.
pub fn classify_rules(
    rules: &[PolicyRule],
) -> (Vec<PolicyRule>, BTreeMap<String, Vec<PolicyRule>>) {
    let mut constitution = Vec::new();
    let mut shards: BTreeMap<String, Vec<PolicyRule>> = BTreeMap::new();
    for r in rules {
        if r.scope == "global" && r.mode == "enforce" {
            constitution.push(r.clone());
        } else {
            shards.entry(r.scope.clone()).or_default().push(r.clone());
        }
    }
    constitution.sort_by(|a, b| a.id.cmp(&b.id));
    for entry in shards.values_mut() {
        entry.sort_by(|a, b| a.id.cmp(&b.id));
    }
    (constitution, shards)
}

pub fn compile(repo_root: &Path) -> Result<CompileOutput, CompileError> {
    let discovered = discover_policy_sources(repo_root)?;
    let mut violations = Vec::new();
    let mut rules = Vec::new();
    let mut owners: BTreeMap<String, (u8, String)> = BTreeMap::new();

    for source in &discovered {
        let source_abs = repo_root.join(&source.path);
        let raw = fs::read_to_string(source_abs)?;
        let policy_body = split_frontmatter_optional(&raw)
            .map(|(_, body)| body)
            .unwrap_or(raw);
        let parsed = parse_policy_blocks(&policy_body, &source.path, &mut violations);
        for rule in parsed {
            if let Some((existing_precedence, existing_path)) = owners.get(&rule.id) {
                violations.push(Violation {
                    code: "V-103".into(),
                    severity: "error".into(),
                    message: format!(
                        "duplicate rule id {:?} ignored due to precedence (kept {})",
                        rule.id, existing_path
                    ),
                    path: Some(rule.source_path.clone()),
                });
                if source.precedence < *existing_precedence {
                    owners.insert(
                        rule.id.clone(),
                        (source.precedence, rule.source_path.clone()),
                    );
                    if let Some(idx) = rules.iter().position(|r: &PolicyRule| r.id == rule.id) {
                        rules[idx] = rule;
                    }
                }
                continue;
            }
            owners.insert(
                rule.id.clone(),
                (source.precedence, rule.source_path.clone()),
            );
            rules.push(rule);
        }
    }

    rules.sort_by(|a, b| a.id.cmp(&b.id));
    let validation_passed = !violations.iter().any(|v| v.severity == "error");
    let (constitution, shards) = classify_rules(&rules);
    let mut out = CompileOutput {
        sources: discovered,
        rules,
        violations,
        validation_passed,
        policy_bundle_hash: None,
        constitution,
        shards,
    };
    if validation_passed {
        out.policy_bundle_hash = Some(compute_policy_bundle_hash(&out));
    }
    Ok(out)
}

pub fn discover_policy_sources(repo_root: &Path) -> Result<Vec<PolicySource>, CompileError> {
    let mut out = Vec::new();

    let root_claude = repo_root.join("CLAUDE.md");
    if root_claude.is_file() {
        out.push(PolicySource {
            path: "CLAUDE.md".into(),
            precedence: 0,
        });
    }

    let policies_dir = repo_root.join(".claude/policies");
    if policies_dir.is_dir() {
        let mut policy_files = Vec::new();
        for entry in fs::read_dir(policies_dir)? {
            let path = entry?.path();
            if path.is_file() && path.extension().and_then(|x| x.to_str()) == Some("md") {
                policy_files.push(path);
            }
        }
        policy_files.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
        for path in policy_files {
            out.push(PolicySource {
                path: normalize_repo_path(repo_root, &path),
                precedence: 1,
            });
        }
    }

    let mut subdir_claudes = Vec::new();
    for entry in WalkDir::new(repo_root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !should_prune_walk_entry(e))
    {
        let entry = entry.map_err(|e| std::io::Error::other(format!("walkdir: {e}")))?;
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.file_name() != "CLAUDE.md" {
            continue;
        }
        let path = entry.path();
        if path == root_claude {
            continue;
        }
        if path
            .strip_prefix(repo_root)
            .ok()
            .map(|rel| rel.starts_with(".claude"))
            .unwrap_or(false)
        {
            continue;
        }
        subdir_claudes.push(path.to_path_buf());
    }
    subdir_claudes.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    for path in subdir_claudes {
        out.push(PolicySource {
            path: normalize_repo_path(repo_root, &path),
            precedence: 2,
        });
    }

    Ok(out)
}

/// P1-001: prune directories so WalkDir does not descend into heavy or irrelevant trees.
fn should_prune_walk_entry(e: &walkdir::DirEntry) -> bool {
    if !e.file_type().is_dir() {
        return false;
    }
    e.file_name()
        .to_str()
        .map(|n| matches!(n, ".git" | ".claude" | "node_modules" | "target" | "build"))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
struct RawRuleBlock {
    id: Option<String>,
    description: Option<String>,
    mode: Option<String>,
    scope: Option<String>,
    gate: Option<String>,
    allow_destructive: Option<bool>,
    allowed_tools: Option<Vec<String>>,
    max_diff_lines: Option<u32>,
    max_diff_bytes: Option<u64>,
}

fn parse_policy_blocks(
    raw: &str,
    source_path: &str,
    violations: &mut Vec<Violation>,
) -> Vec<PolicyRule> {
    let mut rules = Vec::new();
    let mut in_block = false;
    let mut block = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if !in_block && trimmed == "```policy" {
            in_block = true;
            block.clear();
            continue;
        }
        if in_block && trimmed == "```" {
            match parse_rule_block(&block, source_path) {
                Ok(rule) => rules.push(rule),
                Err(mut block_violations) => violations.append(&mut block_violations),
            }
            in_block = false;
            block.clear();
            continue;
        }
        if in_block {
            block.push_str(line);
            block.push('\n');
        }
    }

    if in_block {
        violations.push(Violation {
            code: "V-101".into(),
            severity: "error".into(),
            message: "unterminated fenced policy block".into(),
            path: Some(source_path.into()),
        });
    }

    rules
}

fn parse_rule_block(block: &str, source_path: &str) -> Result<PolicyRule, Vec<Violation>> {
    let parsed: RawRuleBlock = match serde_yaml::from_str(block) {
        Ok(v) => v,
        Err(e) => {
            return Err(vec![Violation {
                code: "V-101".into(),
                severity: "error".into(),
                message: format!("invalid policy block YAML: {e}"),
                path: Some(source_path.into()),
            }]);
        }
    };

    let mut violations = Vec::new();
    let id = required_field(parsed.id, "id", source_path, &mut violations);
    let description = required_field(
        parsed.description,
        "description",
        source_path,
        &mut violations,
    );
    let mode = required_field(parsed.mode, "mode", source_path, &mut violations);
    let scope = required_field(parsed.scope, "scope", source_path, &mut violations);
    let gate = parsed.gate;

    if let Some(mode_val) = &mode {
        if !matches!(mode_val.as_str(), "enforce" | "warn" | "log") {
            violations.push(Violation {
                code: "V-104".into(),
                severity: "error".into(),
                message: format!("invalid mode {:?}", mode_val),
                path: Some(source_path.into()),
            });
        }
    }

    if let Some(scope_val) = &scope {
        if !valid_scope(scope_val) {
            violations.push(Violation {
                code: "V-105".into(),
                severity: "error".into(),
                message: format!("invalid scope {:?}", scope_val),
                path: Some(source_path.into()),
            });
        }
    }

    if let Some(gate_val) = &gate {
        if !matches!(
            gate_val.as_str(),
            "destructive_operation"
                | "secrets_scanner"
                | "tool_allowlist"
                | "diff_size_limiter"
                | "spec_code_coherence"  // CONST-005, spec 131 (behavioral; no kernel impl)
        ) {
            violations.push(Violation {
                code: "V-106".into(),
                severity: "error".into(),
                message: format!("invalid gate {:?}", gate_val),
                path: Some(source_path.into()),
            });
        }
    }

    if !violations.is_empty() {
        return Err(violations);
    }

    Ok(PolicyRule {
        id: id.unwrap_or_default(),
        description: description.unwrap_or_default(),
        mode: mode.unwrap_or_default(),
        scope: scope.unwrap_or_default(),
        gate,
        source_path: source_path.into(),
        allow_destructive: parsed.allow_destructive,
        allowed_tools: parsed.allowed_tools,
        max_diff_lines: parsed.max_diff_lines,
        max_diff_bytes: parsed.max_diff_bytes,
    })
}

fn valid_scope(scope: &str) -> bool {
    if scope == "global" {
        return true;
    }
    if let Some(rest) = scope.strip_prefix("domain:") {
        return !rest.trim().is_empty();
    }
    if let Some(rest) = scope.strip_prefix("task:") {
        return !rest.trim().is_empty();
    }
    false
}

fn required_field(
    value: Option<String>,
    key: &str,
    source_path: &str,
    violations: &mut Vec<Violation>,
) -> Option<String> {
    if value
        .as_deref()
        .map(|v| v.trim().is_empty())
        .unwrap_or(true)
    {
        violations.push(Violation {
            code: "V-102".into(),
            severity: "error".into(),
            message: format!("missing required field {:?}", key),
            path: Some(source_path.into()),
        });
        return None;
    }
    value
}

fn normalize_repo_path(repo_root: &Path, p: &Path) -> String {
    p.strip_prefix(repo_root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn discovers_sources_in_precedence_order() {
        let tmp = TempDir::new().expect("tempdir");
        fs::write(tmp.path().join("CLAUDE.md"), "root").expect("root");
        fs::create_dir_all(tmp.path().join(".claude/policies")).expect("policies");
        fs::write(tmp.path().join(".claude/policies/a.md"), "a").expect("a");
        fs::write(tmp.path().join(".claude/policies/b.md"), "b").expect("b");
        fs::create_dir_all(tmp.path().join("apps/opc")).expect("apps");
        fs::write(tmp.path().join("apps/opc/CLAUDE.md"), "sub").expect("sub");

        let got = discover_policy_sources(tmp.path()).expect("discover");
        let paths: Vec<String> = got.iter().map(|s| s.path.clone()).collect();
        assert_eq!(
            paths,
            vec![
                "CLAUDE.md",
                ".claude/policies/a.md",
                ".claude/policies/b.md",
                "apps/opc/CLAUDE.md"
            ]
        );
        assert_eq!(got[0].precedence, 0);
        assert_eq!(got[1].precedence, 1);
        assert_eq!(got[3].precedence, 2);
    }

    #[test]
    fn walkdir_does_not_descend_into_target_for_subdir_claude() {
        let tmp = TempDir::new().expect("tempdir");
        fs::write(tmp.path().join("CLAUDE.md"), "# root\n").expect("root");
        fs::create_dir_all(tmp.path().join("target/nested")).expect("target");
        let hidden_rule = r#"
```policy
id: HIDDEN
description: should not be discovered
mode: enforce
scope: global
```
"#;
        fs::write(tmp.path().join("target/nested/CLAUDE.md"), hidden_rule).expect("hidden");

        let got = discover_policy_sources(tmp.path()).expect("discover");
        let has_hidden = got.iter().any(|s| s.path.contains("target/"));
        assert!(
            !has_hidden,
            "expected target/ subtree to be pruned from discovery"
        );
    }

    #[test]
    fn parses_valid_policy_block() {
        let raw = r#"
text
```policy
id: P-001
description: block destructive commands
mode: enforce
scope: global
gate: destructive_operation
```
"#;
        let mut violations = Vec::new();
        let rules = parse_policy_blocks(raw, "CLAUDE.md", &mut violations);
        assert!(violations.is_empty());
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "P-001");
    }

    #[test]
    fn accepts_const_005_spec_code_coherence_gate() {
        // Spec 131: CONST-005 declares gate `spec_code_coherence`.
        // Must compile without V-106 (invalid gate).
        let raw = r#"
```policy
id: CONST-005-spec-code-coherence
description: refuse spec/code drift
mode: enforce
scope: global
gate: spec_code_coherence
```
"#;
        let mut violations = Vec::new();
        let rules = parse_policy_blocks(raw, "CLAUDE.md", &mut violations);
        assert!(violations.is_empty(), "got violations: {violations:?}");
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].id, "CONST-005-spec-code-coherence");
        assert_eq!(rules[0].gate.as_deref(), Some("spec_code_coherence"));
    }

    #[test]
    fn reports_invalid_mode_and_scope() {
        let raw = r#"
```policy
id: P-002
description: bad values
mode: strict
scope: invalid
```
"#;
        let mut violations = Vec::new();
        let rules = parse_policy_blocks(raw, "CLAUDE.md", &mut violations);
        assert!(rules.is_empty());
        assert!(violations.iter().any(|v| v.code == "V-104"));
        assert!(violations.iter().any(|v| v.code == "V-105"));
    }

    #[test]
    fn duplicate_rule_prefers_higher_precedence_source() {
        let tmp = TempDir::new().expect("tempdir");
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "```policy\nid: P-003\ndescription: root\nmode: enforce\nscope: global\n```\n",
        )
        .expect("root");
        fs::create_dir_all(tmp.path().join(".claude/policies")).expect("policies");
        fs::write(
            tmp.path().join(".claude/policies/override.md"),
            "```policy\nid: P-003\ndescription: lower\nmode: warn\nscope: domain:test\n```\n",
        )
        .expect("policy");

        let out = compile(tmp.path()).expect("compile");
        assert_eq!(out.rules.len(), 1);
        assert_eq!(out.rules[0].description, "root");
        assert!(out.violations.iter().any(|v| v.code == "V-103"));
    }

    #[test]
    fn sc001_constitution_and_shards_classification() {
        let tmp = TempDir::new().expect("tempdir");
        fs::write(
            tmp.path().join("CLAUDE.md"),
            r#"
```policy
id: C-1
description: core
mode: enforce
scope: global
```
```policy
id: S-1
description: domain rule
mode: warn
scope: domain:payments
```
"#,
        )
        .expect("claude");

        let out = compile(tmp.path()).expect("compile");
        assert!(out.validation_passed);
        assert_eq!(out.constitution.len(), 1);
        assert_eq!(out.constitution[0].id, "C-1");
        assert_eq!(out.shards.len(), 1);
        assert_eq!(out.shards.get("domain:payments").unwrap().len(), 1);
        assert_eq!(out.shards.get("domain:payments").unwrap()[0].id, "S-1");

        let v = build_bundle_json_value(&out);
        assert!(v.get("constitution").is_some());
        assert!(v.get("shards").is_some());
        assert!(v.pointer("/metadata/policyBundleHash").is_some());
    }

    #[test]
    fn sc002_identical_inputs_same_policy_bundle_hash() {
        let tmp = TempDir::new().expect("tempdir");
        fs::write(
            tmp.path().join("CLAUDE.md"),
            "```policy\nid: X\ndescription: x\nmode: enforce\nscope: global\n```\n",
        )
        .expect("write");

        let a = compile(tmp.path()).expect("compile");
        let b = compile(tmp.path()).expect("compile");
        assert_eq!(
            a.policy_bundle_hash, b.policy_bundle_hash,
            "hash must not depend on compilation timestamp"
        );
        let va = build_bundle_json_value(&a);
        let vb = build_bundle_json_value(&b);
        assert_eq!(
            va.pointer("/metadata/policyBundleHash"),
            vb.pointer("/metadata/policyBundleHash")
        );
        // `compiledAt` may match within the same UTC second; SC-002 is satisfied by stable hash.
    }
}
