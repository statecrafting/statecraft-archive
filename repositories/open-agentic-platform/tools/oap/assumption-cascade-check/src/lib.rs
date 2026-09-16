// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-034

//! `assumption-cascade-check` — CI tool that fails if generated factory
//! artifacts reference an `Assumption`-tagged claim's vendor surface
//! form outside `pending-promotion.md`.
//!
//! The tool walks `<repo>` for any `assumption-only-manifest.md`,
//! resolves the corresponding `.artifacts/generated/` tree, runs
//! `factory_engine::stages::cascade_check::check_assumption_only_cascade`,
//! and accumulates violations. Fail-soft: zero manifests → exit 0.

use factory_engine::stages::cascade_check::{
    check_assumption_only_cascade, CascadeCheckOutcome, CascadeViolation,
};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckSummary {
    pub manifests_scanned: usize,
    pub violations: Vec<CascadeViolation>,
}

impl CheckSummary {
    pub fn is_clean(&self) -> bool {
        self.violations.is_empty()
    }
}

/// Run the cascade check across every `assumption-only-manifest.md`
/// found under `repo_root`. Returns a summary; the binary entry point
/// translates this to an exit code.
pub fn run(repo_root: &Path) -> CheckSummary {
    let manifests = find_manifests(repo_root);
    let mut violations: Vec<CascadeViolation> = Vec::new();
    for manifest_path in &manifests {
        let parent = match manifest_path.parent() {
            Some(p) => p,
            None => continue,
        };
        let generated_dir = parent.join("generated");
        let pending_promotion = parent.join("pending-promotion.md");
        match check_assumption_only_cascade(
            &generated_dir,
            manifest_path,
            &pending_promotion,
        ) {
            Ok(CascadeCheckOutcome::Clean) => {}
            Ok(CascadeCheckOutcome::NothingToVerify) => {}
            Ok(CascadeCheckOutcome::Violations(v)) => {
                violations.extend(v);
            }
            Err(e) => {
                eprintln!(
                    "assumption-cascade-check: error reading {}: {e}",
                    manifest_path.display(),
                );
            }
        }
    }
    CheckSummary {
        manifests_scanned: manifests.len(),
        violations,
    }
}

/// Find every `assumption-only-manifest.md` under `root`. Recursive.
pub fn find_manifests(root: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if !root.is_dir() {
        return out;
    }
    walk(root, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    // Skip target / node_modules / .git for performance — those trees
    // never contain factory output.
    if let Some(name) = dir.file_name().and_then(|n| n.to_str())
        && matches!(
            name,
            "target" | "node_modules" | ".git" | "build" | "dist"
        )
    {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n == "assumption-only-manifest.md")
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fail_soft_on_empty_repo() {
        let dir = tempfile::tempdir().unwrap();
        let s = run(dir.path());
        assert_eq!(s.manifests_scanned, 0);
        assert!(s.is_clean());
    }

    #[test]
    fn finds_manifest_in_subdir() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("p1/.artifacts");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            project.join("assumption-only-manifest.md"),
            "# Assumption-Only Manifest\n\n_None_\n",
        )
        .unwrap();
        let manifests = find_manifests(dir.path());
        assert_eq!(manifests.len(), 1);
    }

    #[test]
    fn skips_target_and_node_modules() {
        let dir = tempfile::tempdir().unwrap();
        for ignored in ["target", "node_modules", ".git", "build", "dist"] {
            let p = dir.path().join(ignored);
            std::fs::create_dir_all(&p).unwrap();
            std::fs::write(
                p.join("assumption-only-manifest.md"),
                "noise",
            )
            .unwrap();
        }
        let manifests = find_manifests(dir.path());
        assert!(manifests.is_empty());
    }

    #[test]
    fn run_detects_violation_in_generated_artifact() {
        // Build a synthetic manifest + offending generated file.
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("p1/.artifacts");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join("assumption-only-manifest.md"),
            "# Assumption-Only Manifest\n\
             \n\
             ## INT-003\n\
             \n\
             - **id**: `INT-003`\n\
             - **kind**: `INT`\n\
             - **anchorHash**: `anchor-abc`\n\
             - **owner**: ops\n\
             - **rationale**: x\n\
             - **expiresAt**: 2026-07-30T00:00:00Z\n\
             - **extractedEntityCandidates**: `Globex`\n\
             - **pendingPromotionPath**: `pending-promotion.md`\n\
             \n",
        )
        .unwrap();
        let gen_dir = proj.join("generated");
        std::fs::create_dir_all(&gen_dir).unwrap();
        std::fs::write(gen_dir.join("a.sql"), "CREATE TABLE globex_x ();\n")
            .unwrap();

        let s = run(dir.path());
        assert_eq!(s.manifests_scanned, 1);
        assert_eq!(s.violations.len(), 1);
        assert_eq!(s.violations[0].surface_form, "Globex");
    }
}
