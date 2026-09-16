//! codification-gate binary (spec 174).
//!
//! Runs as a chain entry on the spec 166 Stop-hook surface. Exit codes:
//!
//! - `0` — every CRITICAL/HIGH finding is codified in the spec spine, or
//!   waived by an explicit operator override.
//! - `2` — at least one CRITICAL/HIGH finding has no spine representation
//!   and no override. The structured diagnostic on stderr names each
//!   missing finding and where the gate looked.
//! - `1` — usage / IO error (the gate could not complete an honest check).
//!
//! The default findings directory is `<repo>/.derived/findings/`; that path
//! is the agreed drop-site for substrate-emitted finding JSON files
//! (axiomregent / provenance-validator / policy-kernel). Substrate
//! emission is forward-compatible: when the directory does not exist, the
//! gate cleanly passes with `considered = 0` and emits a one-line note.

use clap::Parser;
use open_agentic_codification_gate::{
    evaluate, format_audit_lines, format_blocking_diagnostic, load_findings, load_overrides,
};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "codification-gate",
    version,
    about = "Block session closure until every CRITICAL/HIGH finding is codified in the spec spine (spec 174)."
)]
struct Cli {
    /// Repository root. Defaults to the current working directory.
    #[arg(long)]
    repo: Option<PathBuf>,

    /// Directory containing substrate-emitted finding JSON artifacts.
    /// Defaults to `<repo>/.derived/findings`.
    #[arg(long)]
    findings_dir: Option<PathBuf>,

    /// Optional path to write the JSONL audit log. When set, every outcome
    /// (codified / overridden / missing) emits one JSON line for the
    /// governance certificate chain to ingest.
    #[arg(long)]
    audit_log: Option<PathBuf>,

    /// Emit a verbose summary on stdout even when the gate passes.
    #[arg(long)]
    verbose: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let repo = match cli.repo {
        Some(p) => p,
        None => match std::env::current_dir() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("codification-gate: cannot resolve cwd: {e}");
                return ExitCode::from(1);
            }
        },
    };
    let findings_dir = cli
        .findings_dir
        .unwrap_or_else(|| repo.join(".derived").join("findings"));

    let findings = match load_findings(&findings_dir) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("codification-gate: load findings: {e}");
            return ExitCode::from(1);
        }
    };

    let overrides = match load_overrides(&repo) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("codification-gate: load overrides: {e}");
            return ExitCode::from(1);
        }
    };

    let report = match evaluate(&repo, findings, &overrides) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("codification-gate: evaluate: {e}");
            return ExitCode::from(1);
        }
    };

    if let Some(audit_path) = cli.audit_log.as_ref() {
        let lines = format_audit_lines(&report);
        if let Some(parent) = audit_path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = fs::create_dir_all(parent);
            }
        }
        match fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(audit_path)
        {
            Ok(mut f) => {
                for line in &lines {
                    if let Err(e) = writeln!(f, "{line}") {
                        eprintln!(
                            "codification-gate: audit append failed ({}): {e}",
                            audit_path.display()
                        );
                        break;
                    }
                }
            }
            Err(e) => {
                eprintln!(
                    "codification-gate: cannot open audit log {}: {e}",
                    audit_path.display()
                );
            }
        }
    }

    if report.blocks() {
        eprint!("{}", format_blocking_diagnostic(&report));
        return ExitCode::from(2);
    }

    if cli.verbose || report.considered > 0 {
        println!(
            "codification-gate: OK — considered={} filtered_out={} codified={} overridden={}",
            report.considered,
            report.filtered_out,
            report.codified.len(),
            report.overridden.len()
        );
    } else {
        println!(
            "codification-gate: OK — no findings under {} (substrate emission not yet wired)",
            findings_dir.display()
        );
    }
    ExitCode::SUCCESS
}
