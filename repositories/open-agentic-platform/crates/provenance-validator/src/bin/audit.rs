// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-036, FR-037, FR-038

//! `provenance-validator audit --project <path> [--corpus <path>]`
//!
//! Read-only retroactive audit. Walks an existing project directory,
//! parses its BRD, loads the corpus (typed → legacy `.txt` → empty),
//! runs the validator, and writes the markdown report to
//! `<project>/requirements/audit/retroactive-provenance-report.md`.
//!
//! Argument parsing is hand-rolled to keep the crate's `[dependencies]`
//! exactly at the FR-001 five (factory-contracts, serde, serde_json,
//! sha2, unicode-normalization). No clap.
//!
//! Exit codes:
//!   0  audit completed (findings reported; read-only diagnostic)
//!   1  validator panic (fail-closed; panicReason emitted to stderr)
//!   2  project directory not readable
//!   3  argument parsing error
//!   4  failed to write the report file

use provenance_validator::{audit_with_options, render_audit_report};
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = match parse_args(&args) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("provenance-validator: {e}\n");
            eprintln!("{}", USAGE);
            return ExitCode::from(3);
        }
    };
    if parsed.help {
        println!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    let project = match parsed.project {
        Some(p) => p,
        None => {
            eprintln!("provenance-validator: --project is required\n");
            eprintln!("{}", USAGE);
            return ExitCode::from(3);
        }
    };
    if !project.is_dir() {
        eprintln!(
            "provenance-validator: project directory not found or not a directory: {}",
            project.display(),
        );
        return ExitCode::from(2);
    }

    let report = audit_with_options(&project, parsed.corpus.as_deref());

    let dest = project
        .join("requirements")
        .join("audit")
        .join("retroactive-provenance-report.md");
    if let Some(parent) = dest.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        eprintln!(
            "provenance-validator: failed to create {}: {e}",
            parent.display(),
        );
        return ExitCode::from(4);
    }
    let body = render_audit_report(&report);
    if let Err(e) = std::fs::write(&dest, body) {
        eprintln!(
            "provenance-validator: failed to write {}: {e}",
            dest.display(),
        );
        return ExitCode::from(4);
    }
    println!(
        "provenance-validator: report written to {}",
        dest.display(),
    );
    println!(
        "  total={} derived={} assumption={} rejected={} synthesizedCorpus={}",
        report.validation.summary.total,
        report.validation.summary.derived_count,
        report.validation.summary.assumption_count,
        report.validation.summary.rejected_count,
        report.synthesized_corpus,
    );
    if let Some(panic_reason) = &report.validation.panic_reason {
        eprintln!(
            "provenance-validator: validator panic — {panic_reason}",
        );
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

const USAGE: &str = "\
Usage: provenance-validator audit --project <path> [--corpus <path>]

Read-only retroactive audit (spec 121 FR-036). Writes
  <project>/requirements/audit/retroactive-provenance-report.md

Options:
  --project <path>   Project directory to audit (required)
  --corpus <path>    Override the corpus path (typed JSON or legacy .txt dir)
  -h, --help         Print this message

Exit codes:
  0   audit completed
  1   validator panicked (fail-closed)
  2   project directory not readable
  3   argument parsing error
  4   failed to write report
";

#[derive(Debug, Default)]
struct ParsedArgs {
    project: Option<PathBuf>,
    corpus: Option<PathBuf>,
    help: bool,
}

fn parse_args(args: &[String]) -> Result<ParsedArgs, String> {
    let mut out = ParsedArgs::default();
    let mut i = 0;
    // Tolerate an optional leading `audit` subcommand for ergonomic
    // future expansion (FR-036 names the binary as
    // `provenance-validator audit`, suggesting a subcommand structure).
    if let Some(first) = args.first()
        && first == "audit"
    {
        i = 1;
    }
    while i < args.len() {
        let arg = args[i].as_str();
        match arg {
            "-h" | "--help" => {
                out.help = true;
                i += 1;
            }
            "--project" => {
                i += 1;
                let v = args.get(i).ok_or_else(|| {
                    "--project requires a path argument".to_string()
                })?;
                out.project = Some(PathBuf::from(v));
                i += 1;
            }
            "--corpus" => {
                i += 1;
                let v = args.get(i).ok_or_else(|| {
                    "--corpus requires a path argument".to_string()
                })?;
                out.corpus = Some(PathBuf::from(v));
                i += 1;
            }
            other if other.starts_with("--project=") => {
                let v = &other["--project=".len()..];
                out.project = Some(PathBuf::from(v));
                i += 1;
            }
            other if other.starts_with("--corpus=") => {
                let v = &other["--corpus=".len()..];
                out.corpus = Some(PathBuf::from(v));
                i += 1;
            }
            other => {
                return Err(format!("unknown argument: {other}"));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_args_basic() {
        let args = vec![
            "--project".into(),
            "/tmp/foo".into(),
            "--corpus".into(),
            "/tmp/bar".into(),
        ];
        let p = parse_args(&args).unwrap();
        assert_eq!(p.project.unwrap(), PathBuf::from("/tmp/foo"));
        assert_eq!(p.corpus.unwrap(), PathBuf::from("/tmp/bar"));
    }

    #[test]
    fn parse_args_with_audit_subcommand() {
        let args = vec![
            "audit".into(),
            "--project".into(),
            "/tmp/foo".into(),
        ];
        let p = parse_args(&args).unwrap();
        assert_eq!(p.project.unwrap(), PathBuf::from("/tmp/foo"));
    }

    #[test]
    fn parse_args_equals_form() {
        let args = vec!["--project=/tmp/foo".into()];
        let p = parse_args(&args).unwrap();
        assert_eq!(p.project.unwrap(), PathBuf::from("/tmp/foo"));
    }

    #[test]
    fn parse_args_missing_value_errors() {
        let args = vec!["--project".into()];
        assert!(parse_args(&args).is_err());
    }

    #[test]
    fn parse_args_unknown_flag_errors() {
        let args = vec!["--bogus".into()];
        assert!(parse_args(&args).is_err());
    }

    #[test]
    fn parse_args_help() {
        let args = vec!["--help".into()];
        let p = parse_args(&args).unwrap();
        assert!(p.help);
    }
}
