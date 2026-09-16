// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! `factory-project-detect` — CLI façade over the detection crate.
//!
//! Callers (notably statecraft Node code) invoke this binary to get a
//! typed detection report without parsing YAML schemas or JSON files on
//! their own. Per `.claude/rules/governed-artifact-reads.md`, this is the
//! designated consumer entrypoint.

use clap::{Parser, Subcommand};
use factory_project_detect::detect;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "factory-project-detect",
    about = "Detect whether a directory is a factory-produced project (spec 112)"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Inspect a directory and emit a JSON detection report.
    Inspect {
        /// Path to the repository root.
        path: PathBuf,
        /// Emit structured JSON (the only supported output).
        #[arg(long)]
        json: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Inspect { path, json: _ } => match detect(&path) {
            Ok(report) => {
                match serde_json::to_string_pretty(&report) {
                    Ok(s) => {
                        println!("{s}");
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("failed to serialise detection report: {e}");
                        ExitCode::from(2)
                    }
                }
            }
            Err(e) => {
                eprintln!("detection failed: {e}");
                ExitCode::from(1)
            }
        },
    }
}
