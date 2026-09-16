// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-010

//! Verification check runners for Factory pipeline gates.
//!
//! Seven check types matching the verification contract: artifact existence,
//! JSON Schema validation, grep absent/present, shell command execution,
//! file existence, and cross-reference validation.

use factory_contracts::adapter_manifest::Severity;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use walkdir::WalkDir;

/// Result of a single verification check.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckResult {
    pub id: String,
    pub passed: bool,
    pub message: String,
    pub severity: Severity,
}

impl CheckResult {
    pub fn pass(id: impl Into<String>, message: impl Into<String>, severity: Severity) -> Self {
        Self {
            id: id.into(),
            passed: true,
            message: message.into(),
            severity,
        }
    }

    pub fn fail(id: impl Into<String>, message: impl Into<String>, severity: Severity) -> Self {
        Self {
            id: id.into(),
            passed: false,
            message: message.into(),
            severity,
        }
    }
}

// ── Check Runner 1: Artifact Exists ──────────────────────────────────

/// Check that a file exists and is non-empty.
pub fn run_artifact_exists(check_id: &str, path: &Path, severity: Severity) -> CheckResult {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() == 0 => CheckResult::fail(
            check_id,
            format!("File is empty: {}", path.display()),
            severity,
        ),
        Ok(_) => CheckResult::pass(
            check_id,
            format!("File exists: {}", path.display()),
            severity,
        ),
        Err(_) => CheckResult::fail(
            check_id,
            format!("File not found: {}", path.display()),
            severity,
        ),
    }
}

// ── Check Runner 2: Schema Validation ────────────────────────────────

/// Validate a JSON artifact against a JSON Schema.
pub fn run_schema_validation(
    check_id: &str,
    artifact_path: &Path,
    schema_path: &Path,
    severity: Severity,
) -> CheckResult {
    let artifact_str = match std::fs::read_to_string(artifact_path) {
        Ok(s) => s,
        Err(e) => {
            return CheckResult::fail(check_id, format!("File not found: {e}"), severity);
        }
    };

    let data: serde_json::Value = match serde_json::from_str(&artifact_str) {
        Ok(v) => v,
        Err(e) => {
            return CheckResult::fail(check_id, format!("Invalid JSON: {e}"), severity);
        }
    };

    let schema_str = match std::fs::read_to_string(schema_path) {
        Ok(s) => s,
        Err(e) => {
            return CheckResult::fail(check_id, format!("Schema file not found: {e}"), severity);
        }
    };

    let schema: serde_json::Value = match serde_json::from_str(&schema_str) {
        Ok(v) => v,
        Err(e) => {
            return CheckResult::fail(check_id, format!("Invalid schema JSON: {e}"), severity);
        }
    };

    match jsonschema::validate(&schema, &data) {
        Ok(()) => CheckResult::pass(check_id, "Schema validation passed", severity),
        Err(e) => CheckResult::fail(check_id, format!("Validation failed: {e}"), severity),
    }
}

// ── Check Runner 3: Grep Absent ──────────────────────────────────────

/// Ensure a regex pattern does NOT appear in any files under scope.
pub fn run_grep_absent(
    check_id: &str,
    pattern: &str,
    scope: &Path,
    severity: Severity,
    excludes: Option<&[String]>,
) -> CheckResult {
    let re = match Regex::new(pattern) {
        Ok(r) => r,
        Err(e) => {
            return CheckResult::fail(check_id, format!("Invalid regex pattern: {e}"), severity);
        }
    };

    let mut matches = Vec::new();
    let mut total_count = 0usize;

    for entry in WalkDir::new(scope).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy();
        if let Some(excl) = excludes
            && excl.iter().any(|e| file_name.contains(e.as_str()))
        {
            continue;
        }

        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue, // skip binary / unreadable files
        };

        for (line_no, line) in content.lines().enumerate() {
            if re.is_match(line) {
                total_count += 1;
                if matches.len() < 5 {
                    matches.push(format!(
                        "{}:{}:{}",
                        entry.path().display(),
                        line_no + 1,
                        line.trim()
                    ));
                }
            }
        }
    }

    if total_count > 0 {
        CheckResult::fail(
            check_id,
            format!(
                "Pattern found ({total_count} matches): {}",
                matches.join("; ")
            ),
            severity,
        )
    } else {
        CheckResult::pass(
            check_id,
            format!("Pattern not found in {}", scope.display()),
            severity,
        )
    }
}

// ── Check Runner 4: Grep Present ─────────────────────────────────────

/// Ensure a regex pattern DOES appear in at least one file under scope.
pub fn run_grep_present(
    check_id: &str,
    pattern: &str,
    scope: &Path,
    severity: Severity,
) -> CheckResult {
    let re = match Regex::new(pattern) {
        Ok(r) => r,
        Err(e) => {
            return CheckResult::fail(check_id, format!("Invalid regex pattern: {e}"), severity);
        }
    };

    let mut matching_files = Vec::new();

    for entry in WalkDir::new(scope).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }

        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if content.lines().any(|line| re.is_match(line)) {
            matching_files.push(entry.path().to_path_buf());
        }
    }

    if matching_files.is_empty() {
        CheckResult::fail(
            check_id,
            format!("Pattern not found in {}", scope.display()),
            severity,
        )
    } else {
        CheckResult::pass(
            check_id,
            format!("Pattern found in {} file(s)", matching_files.len()),
            severity,
        )
    }
}

// ── Check Runner 5: Command Execution ────────────────────────────────

/// Run a shell command and check exit code.
///
/// SECURITY BOUNDARY: `command` is executed via `sh -c`, i.e. with full
/// shell interpretation, on the host running the factory pipeline. It
/// comes from the pipeline/adapter's check manifest (config/spec-derived),
/// not from an untrusted end-user request path; this runner trusts that
/// manifest by design, the same way the pipeline trusts every other
/// command it's configured to run. There is currently no flag on this
/// runner to route through the spec 162 `SandboxClient` isolation
/// contract (`crate::sandbox`) instead of the host shell; if untrusted or
/// third-party check manifests become a supported input, wire this call
/// through that contract rather than adding ad-hoc sanitization here.
pub async fn run_command(
    check_id: &str,
    command: &str,
    cwd: &Path,
    severity: Severity,
    timeout_secs: u64,
) -> CheckResult {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output(),
    )
    .await;

    match result {
        Ok(Ok(output)) if output.status.success() => {
            CheckResult::pass(check_id, format!("Command succeeded: {command}"), severity)
        }
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut combined = format!("{stdout}{stderr}").trim().to_string();
            if combined.len() > 2000 {
                combined = format!("...{}", &combined[combined.len() - 2000..]);
            }
            let code = output.status.code().unwrap_or(-1);
            CheckResult::fail(
                check_id,
                format!("Command failed (exit {code}): {combined}"),
                severity,
            )
        }
        Ok(Err(e)) => CheckResult::fail(check_id, format!("Command error: {e}"), severity),
        Err(_) => CheckResult::fail(
            check_id,
            format!("Command timed out after {timeout_secs}s: {command}"),
            severity,
        ),
    }
}

// ── Check Runner 6: File Check ───────────────────────────────────────

/// Check that all expected files exist.
pub fn run_file_check(check_id: &str, paths: &[&Path], severity: Severity) -> CheckResult {
    let missing: Vec<_> = paths.iter().filter(|p| !p.exists()).collect();
    if missing.is_empty() {
        CheckResult::pass(
            check_id,
            format!("All {} files exist", paths.len()),
            severity,
        )
    } else {
        let paths_str: Vec<_> = missing.iter().map(|p| p.display().to_string()).collect();
        CheckResult::fail(
            check_id,
            format!("Missing files: {}", paths_str.join(", ")),
            severity,
        )
    }
}

// ── Check Runner 7: Cross-Reference ──────────────────────────────────

/// Check that all source IDs appear in the target set.
pub fn run_cross_reference(
    check_id: &str,
    source_ids: &[String],
    target_ids: &HashSet<String>,
    description: &str,
    severity: Severity,
) -> CheckResult {
    let missing: Vec<_> = source_ids
        .iter()
        .filter(|id| !target_ids.contains(*id))
        .collect();

    if missing.is_empty() {
        CheckResult::pass(
            check_id,
            format!("{description}: all {} IDs found", source_ids.len()),
            severity,
        )
    } else {
        let first_five: Vec<_> = missing.iter().take(5).map(|s| s.as_str()).collect();
        CheckResult::fail(
            check_id,
            format!(
                "{description}: missing {} — {}",
                missing.len(),
                first_five.join(", ")
            ),
            severity,
        )
    }
}

// ── Check Runner 8: Security Scan (102 FR-034, FR-039) ──────────────

/// Run a security scan on generated output files using the output filter.
///
/// Walks `project_root` for source files and scans each for secrets patterns.
/// Returns a failing check if any findings are detected.
pub fn run_security_scan(check_id: &str, project_root: &Path, severity: Severity) -> CheckResult {
    let extensions = ["ts", "js", "rs", "yaml", "yml", "json", "env", "toml"];
    let mut total_findings = 0u32;
    let mut files_with_findings = Vec::new();

    for entry in WalkDir::new(project_root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !extensions.contains(&ext) {
            continue;
        }
        // Skip node_modules, .git, target directories.
        let path_str = path.to_string_lossy();
        if path_str.contains("node_modules")
            || path_str.contains("/.git/")
            || path_str.contains("/target/")
        {
            continue;
        }

        if let Ok(content) = std::fs::read_to_string(path) {
            let result = orchestrator::output_filter::scan_content(&content);
            if !result.clean {
                total_findings += result.findings.len() as u32;
                files_with_findings.push(path.display().to_string());
            }
        }
    }

    if total_findings == 0 {
        CheckResult::pass(
            check_id,
            "Security scan: no secrets or sensitive patterns detected".to_string(),
            severity,
        )
    } else {
        CheckResult::fail(
            check_id,
            format!(
                "Security scan: {total_findings} finding(s) in {} file(s): {}",
                files_with_findings.len(),
                files_with_findings
                    .iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            severity,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn tmp_file(dir: &TempDir, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    // ── Artifact Exists ──────────────────────────────────────────────

    #[test]
    fn artifact_exists_pass() {
        let dir = TempDir::new().unwrap();
        let path = tmp_file(&dir, "data.json", r#"{"ok": true}"#);
        let r = run_artifact_exists("AE-001", &path, Severity::Error);
        assert!(r.passed);
    }

    #[test]
    fn artifact_exists_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nope.json");
        let r = run_artifact_exists("AE-002", &path, Severity::Error);
        assert!(!r.passed);
        assert!(r.message.contains("File not found"));
    }

    #[test]
    fn artifact_exists_empty() {
        let dir = TempDir::new().unwrap();
        let path = tmp_file(&dir, "empty.json", "");
        let r = run_artifact_exists("AE-003", &path, Severity::Error);
        assert!(!r.passed);
        assert!(r.message.contains("empty"));
    }

    // ── Schema Validation ────────────────────────────────────────────

    #[test]
    fn schema_validation_pass() {
        let dir = TempDir::new().unwrap();
        let schema = tmp_file(
            &dir,
            "schema.json",
            r#"{"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}"#,
        );
        let artifact = tmp_file(&dir, "data.json", r#"{"name": "test"}"#);
        let r = run_schema_validation("SV-001", &artifact, &schema, Severity::Error);
        assert!(r.passed, "message: {}", r.message);
    }

    #[test]
    fn schema_validation_fail() {
        let dir = TempDir::new().unwrap();
        let schema = tmp_file(
            &dir,
            "schema.json",
            r#"{"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}"#,
        );
        let artifact = tmp_file(&dir, "data.json", r#"{"age": 42}"#);
        let r = run_schema_validation("SV-002", &artifact, &schema, Severity::Error);
        assert!(!r.passed);
        assert!(r.message.contains("Validation failed"));
    }

    // ── Grep Absent ──────────────────────────────────────────────────

    #[test]
    fn grep_absent_pass() {
        let dir = TempDir::new().unwrap();
        tmp_file(&dir, "code.rs", "fn main() {}\n");
        let r = run_grep_absent("GA-001", "TODO", dir.path(), Severity::Error, None);
        assert!(r.passed);
    }

    #[test]
    fn grep_absent_fail() {
        let dir = TempDir::new().unwrap();
        tmp_file(
            &dir,
            "code.rs",
            "// TODO: fix this\nlet x = 1;\n// TODO: and this\n",
        );
        let r = run_grep_absent("GA-002", "TODO", dir.path(), Severity::Error, None);
        assert!(!r.passed);
        assert!(r.message.contains("2 matches"));
    }

    // ── Grep Present ─────────────────────────────────────────────────

    #[test]
    fn grep_present_pass() {
        let dir = TempDir::new().unwrap();
        tmp_file(&dir, "lib.rs", "pub fn hello() {}\n");
        let r = run_grep_present("GP-001", "pub fn", dir.path(), Severity::Error);
        assert!(r.passed);
        assert!(r.message.contains("1 file(s)"));
    }

    #[test]
    fn grep_present_fail() {
        let dir = TempDir::new().unwrap();
        tmp_file(&dir, "lib.rs", "fn private() {}\n");
        let r = run_grep_present("GP-002", "pub fn", dir.path(), Severity::Error);
        assert!(!r.passed);
    }

    // ── Command ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn command_succeeds() {
        let dir = TempDir::new().unwrap();
        let r = run_command("CMD-001", "echo hello", dir.path(), Severity::Error, 10).await;
        assert!(r.passed);
    }

    #[tokio::test]
    async fn command_fails() {
        let dir = TempDir::new().unwrap();
        let r = run_command("CMD-002", "exit 1", dir.path(), Severity::Error, 10).await;
        assert!(!r.passed);
        assert!(r.message.contains("Command failed"));
    }

    #[tokio::test]
    async fn command_timeout() {
        let dir = TempDir::new().unwrap();
        let r = run_command("CMD-003", "sleep 30", dir.path(), Severity::Error, 1).await;
        assert!(!r.passed);
        assert!(r.message.contains("timed out"));
    }

    // ── File Check ───────────────────────────────────────────────────

    #[test]
    fn file_check_pass() {
        let dir = TempDir::new().unwrap();
        let p1 = tmp_file(&dir, "a.txt", "a");
        let p2 = tmp_file(&dir, "b.txt", "b");
        let r = run_file_check("FC-001", &[p1.as_path(), p2.as_path()], Severity::Error);
        assert!(r.passed);
    }

    #[test]
    fn file_check_fail() {
        let dir = TempDir::new().unwrap();
        let p1 = tmp_file(&dir, "a.txt", "a");
        let p2 = dir.path().join("missing.txt");
        let r = run_file_check("FC-002", &[p1.as_path(), p2.as_path()], Severity::Error);
        assert!(!r.passed);
        assert!(r.message.contains("missing.txt"));
    }

    // ── Cross-Reference ──────────────────────────────────────────────

    #[test]
    fn cross_reference_pass() {
        let source = vec!["a".into(), "b".into()];
        let target: HashSet<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let r = run_cross_reference("CR-001", &source, &target, "Entity refs", Severity::Error);
        assert!(r.passed);
        assert!(r.message.contains("all 2 IDs found"));
    }

    #[test]
    fn cross_reference_fail() {
        let source = vec!["a".into(), "b".into(), "d".into()];
        let target: HashSet<String> = ["a", "c"].iter().map(|s| s.to_string()).collect();
        let r = run_cross_reference("CR-002", &source, &target, "Entity refs", Severity::Error);
        assert!(!r.passed);
        assert!(r.message.contains("missing 2"));
    }
}
