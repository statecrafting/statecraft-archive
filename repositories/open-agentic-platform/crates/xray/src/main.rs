// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use xray::{docs, history, schema};

#[derive(Parser)]
#[command(name = "xray")]
#[command(about = "Deterministic repository scanner", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Scans the repository and updates .axiomregent
    Scan {
        /// Target directory to scan (default: .)
        #[arg(default_value = ".")]
        target: String,

        /// Output directory override
        #[arg(long)]
        output: Option<String>,

        /// Path to previous index.json for incremental scanning
        #[arg(long)]
        previous: Option<String>,
    },
    /// Generate documentation from index
    Docs {
        /// Input index.json path (default: index.json)
        #[arg(long, default_value = "index.json")]
        input: String,

        /// Output directory (default: docs)
        #[arg(long, default_value = "docs")]
        output: String,
    },
    /// Show churn report from scan history
    History {
        /// Path to history.jsonl (default: .axiomregent/data/history.jsonl)
        #[arg(long)]
        path: Option<String>,

        /// Number of top churning files to show
        #[arg(long, default_value = "20")]
        top: usize,
    },
    /// Run scan + docs pipeline
    All,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Scan {
            target,
            output,
            previous,
        } => {
            let target_path = PathBuf::from(target);
            let final_output = match output {
                Some(p) => Some(PathBuf::from(p)),
                None => {
                    let repo_root = std::env::current_dir()?;
                    Some(repo_root.join(".axiomregent").join("data"))
                }
            };

            if let Some(prev_path) = previous {
                xray::scan_target_incremental(
                    &target_path,
                    final_output,
                    &PathBuf::from(prev_path),
                )?;
            } else {
                xray::scan_target(&target_path, final_output)?;
            }
            Ok(())
        }
        Commands::Docs { input, output } => {
            let input_path = std::path::Path::new(input);
            let output_path = std::path::Path::new(output);

            eprintln!("Reading index from {:?}", input_path);
            let index_bytes = std::fs::read(input_path).context("Failed to read index file")?;
            let index: schema::XrayIndex =
                serde_json::from_slice(&index_bytes).context("Failed to parse index JSON")?;

            eprintln!("Generating docs to {:?}", output_path);
            let generator = docs::DocsGenerator::new(&index, output_path);
            generator.generate()?;

            eprintln!("Docs generated successfully.");
            Ok(())
        }
        Commands::History { path, top } => {
            let history_path = match path {
                Some(p) => PathBuf::from(p),
                None => {
                    let repo_root = std::env::current_dir()?;
                    repo_root
                        .join(".axiomregent")
                        .join("data")
                        .join("history.jsonl")
                }
            };

            let entries = history::load_history(&history_path)?;
            if entries.is_empty() {
                eprintln!("No history found at {}", history_path.display());
                return Ok(());
            }

            let churn = history::churn_report(&entries, *top);
            let growth = history::growth_report(&entries);

            eprintln!(
                "History: {} scans, {} → {} files (delta: {:+})",
                growth.entries,
                growth.first_file_count,
                growth.latest_file_count,
                growth.file_count_delta
            );
            eprintln!("\nTop {} churning files:", top);
            for entry in &churn {
                eprintln!("  {:4} changes  {}", entry.changes, entry.path);
            }
            Ok(())
        }
        Commands::All => {
            let target_path = PathBuf::from(".");
            let repo_root = std::env::current_dir()?;
            let data_dir = repo_root.join(".axiomregent").join("data");

            let index = xray::scan_target(&target_path, Some(data_dir))?;

            let docs_dir = repo_root.join(".axiomregent").join("docs");
            let generator = docs::DocsGenerator::new(&index, &docs_dir);
            generator.generate()?;

            eprintln!("All steps complete. Index + docs written to .axiomregent/");
            Ok(())
        }
    }
}
