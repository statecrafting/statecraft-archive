// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-008

//! `factory migrate stakeholder-docs` entry point.
//!
//! Wraps `factory_engine::migration::stakeholder_docs::migrate_stakeholder_docs`
//! with a clap CLI surface. The actual migration logic lives in the
//! library so it stays unit-testable.

use clap::Parser;
use factory_contracts::Utc;
use factory_engine::migration::stakeholder_docs::{
    migrate_stakeholder_docs, MigrateOptions, MigrationOutcome,
};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "factory-migrate-stakeholder-docs",
    version,
    about = "One-shot reclassification migration for spec 122 stakeholder docs"
)]
struct Cli {
    /// Project root containing `requirements/client/` and target
    /// `requirements/stakeholder/`.
    #[arg(long)]
    project: PathBuf,

    /// Rename legacy `requirements/client/*.md` files as `*.legacy.md`
    /// instead of deleting them.
    #[arg(long)]
    keep_legacy: bool,

    /// Project name (used to derive the spec-121 allowlist).
    #[arg(long, default_value = "")]
    project_name: String,

    /// Project slug (used to derive the spec-121 allowlist).
    #[arg(long, default_value = "")]
    project_slug: String,

    /// Workspace name (used to derive the spec-121 allowlist).
    #[arg(long, default_value = "")]
    workspace_name: String,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let opts = MigrateOptions {
        project: cli.project,
        keep_legacy: cli.keep_legacy,
        corpus: vec![],
        project_name: cli.project_name,
        project_slug: cli.project_slug,
        workspace_name: cli.workspace_name,
        now: Utc::now(),
    };

    match migrate_stakeholder_docs(&opts) {
        Ok(MigrationOutcome::Migrated {
            files_moved,
            anchors_inserted,
            findings,
            report_path,
        }) => {
            println!("migration: ok");
            println!("  files moved: {}", files_moved.len());
            println!("  anchors inserted: {}", anchors_inserted.len());
            println!("  findings: {}", findings.len());
            println!("  report: {}", report_path.display());
            ExitCode::SUCCESS
        }
        Ok(MigrationOutcome::AlreadyMigrated { docs }) => {
            println!("migration: already_migrated");
            for d in &docs {
                println!("  {}", d.display());
            }
            ExitCode::SUCCESS
        }
        Ok(MigrationOutcome::NothingToMigrate) => {
            println!("migration: nothing_to_migrate");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("migration: error: {e}");
            ExitCode::from(1)
        }
    }
}
