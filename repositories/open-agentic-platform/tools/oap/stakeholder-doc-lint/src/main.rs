// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-005, FR-035

use clap::Parser;
use open_agentic_stakeholder_doc_lint::{lint_project, LintProjectContext};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "stakeholder-doc-lint",
    version,
    about = "Stakeholder-doc grammar lint (specs/122)"
)]
struct Cli {
    /// Project root containing `requirements/stakeholder/`.
    #[arg(long, default_value = ".")]
    project: PathBuf,

    /// Optional artifact-store / corpus directory used to resolve
    /// citation sources (W-122-004) and derive the spec-121 allowlist
    /// for external-entity detection (W-122-005). When omitted, those
    /// two checks are skipped.
    #[arg(long)]
    corpus_dir: Option<PathBuf>,

    #[arg(long, default_value = "")]
    project_name: String,

    #[arg(long, default_value = "")]
    project_slug: String,

    #[arg(long, default_value = "")]
    workspace_name: String,

    /// Exit with status 1 if any warning was emitted.
    #[arg(long)]
    fail_on_warn: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let ctx = cli.corpus_dir.map(|dir| LintProjectContext {
        corpus_dir: dir,
        corpus: vec![],
        project_name: cli.project_name,
        project_slug: cli.project_slug,
        workspace_name: cli.workspace_name,
    });
    let warnings = lint_project(&cli.project, ctx.as_ref());
    for w in &warnings {
        match w.line {
            Some(line) => eprintln!(
                "{} {}:{}: {}",
                w.code, w.path, line, w.message
            ),
            None => eprintln!("{} {}: {}", w.code, w.path, w.message),
        }
    }
    if warnings.is_empty() {
        ExitCode::SUCCESS
    } else if cli.fail_on_warn {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
