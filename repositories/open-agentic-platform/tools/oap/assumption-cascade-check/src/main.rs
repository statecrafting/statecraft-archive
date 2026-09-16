// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-034

//! `assumption-cascade-check` CI binary.
//!
//! Walks the repo (default: cwd; override via `--repo <path>`) for any
//! `assumption-only-manifest.md`, runs the spec-121 cascade check
//! against the corresponding `generated/` directory, and exits non-zero
//! on any violation. Fail-soft when no manifests are found (the check
//! is a guard for projects that USE the assumption budget; pure
//! libraries and tooling crates have nothing to verify).

use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
Usage: assumption-cascade-check [--repo <path>]

Scans <path> recursively for `assumption-only-manifest.md` files and
verifies (per spec 121 FR-034) that no generated factory artifact
references an assumption-tagged claim's surface form outside
`pending-promotion.md`.

Options:
  --repo <path>   Repository / directory to scan (default: cwd)
  -h, --help      Print this message

Exit codes:
  0   no violations (or no manifests found — fail-soft)
  1   one or more violations found
  2   argument parsing error
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = match parse_args(&args) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("assumption-cascade-check: {e}\n");
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    if parsed.help {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    let root = parsed
        .repo
        .unwrap_or_else(|| std::env::current_dir().unwrap_or(PathBuf::from(".")));

    let summary = open_agentic_assumption_cascade_check::run(&root);

    if summary.manifests_scanned == 0 {
        println!(
            "assumption-cascade-check: OK — no assumption manifests found under {}",
            root.display(),
        );
        return ExitCode::SUCCESS;
    }
    if summary.is_clean() {
        println!(
            "assumption-cascade-check: OK — {} manifest(s) scanned, no violations",
            summary.manifests_scanned,
        );
        return ExitCode::SUCCESS;
    }
    eprintln!(
        "assumption-cascade-check: FAIL — {} violation(s) across {} manifest(s)",
        summary.violations.len(),
        summary.manifests_scanned,
    );
    for v in &summary.violations {
        eprintln!(
            "  - {}:{} references `{}` (claim {}, anchor {})",
            v.offending_file.display(),
            v.line_number,
            v.surface_form,
            v.claim_id,
            v.anchor_hash,
        );
    }
    eprintln!(
        "\nFR-034: any reference to an assumption-tagged claim's surface form\n\
         outside pending-promotion.md FAILs the gate. Either supply a citation\n\
         (promoting the claim to DERIVED) or remove the reference."
    );
    ExitCode::from(1)
}

#[derive(Debug, Default)]
struct ParsedArgs {
    repo: Option<PathBuf>,
    help: bool,
}

fn parse_args(args: &[String]) -> Result<ParsedArgs, String> {
    let mut out = ParsedArgs::default();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "-h" | "--help" => {
                out.help = true;
                i += 1;
            }
            "--repo" => {
                i += 1;
                let v = args
                    .get(i)
                    .ok_or_else(|| "--repo requires a path argument".to_string())?;
                out.repo = Some(PathBuf::from(v));
                i += 1;
            }
            other if other.starts_with("--repo=") => {
                out.repo = Some(PathBuf::from(&other["--repo=".len()..]));
                i += 1;
            }
            other => {
                return Err(format!("unknown argument: {other}"));
            }
        }
    }
    Ok(out)
}
