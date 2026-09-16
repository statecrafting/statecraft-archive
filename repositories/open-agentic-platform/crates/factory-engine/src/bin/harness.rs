// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! `factory-harness` CLI — standalone verification harness for Factory pipelines.
//!
//! Provides the same interface as the former Python harness (`python -m factory`).

use clap::{Parser, Subcommand};
use factory_contracts::adapter_manifest::Severity;
use factory_engine::checks::CheckResult;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "factory-harness", about = "Factory verification harness")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate inputs before pipeline starts
    Preflight {
        #[arg(long)]
        build_spec: PathBuf,
        #[arg(long)]
        adapter: PathBuf,
        #[arg(long)]
        artifacts: Option<PathBuf>,
    },
    /// Run stage gate checks
    Gate {
        #[arg(long)]
        stage: String,
        #[arg(long)]
        project: PathBuf,
        #[arg(long)]
        checks_file: PathBuf,
    },
    /// Verify a scaffolded feature
    Feature {
        #[arg(long)]
        feature_id: String,
        #[arg(long, name = "type")]
        feature_type: String,
        #[arg(long)]
        project: PathBuf,
        #[arg(long, num_args = 1..)]
        commands: Vec<String>,
        #[arg(long, num_args = 0..)]
        files: Option<Vec<PathBuf>>,
    },
    /// Run adapter architecture invariants
    Invariants {
        #[arg(long)]
        project: PathBuf,
        #[arg(long)]
        adapter: PathBuf,
    },
    /// Pipeline state management
    State {
        #[command(subcommand)]
        action: StateAction,
    },
}

#[derive(Subcommand)]
enum StateAction {
    /// Initialize a new pipeline state
    Init {
        #[arg(long)]
        adapter_name: String,
        #[arg(long)]
        adapter_version: String,
        #[arg(long)]
        build_spec: PathBuf,
        #[arg(long)]
        state: PathBuf,
    },
    /// Show pipeline state summary
    Show {
        #[arg(long)]
        state: PathBuf,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        Commands::Preflight {
            build_spec,
            adapter,
            artifacts,
        } => {
            let results = factory_engine::preflight::run_preflight(
                &build_spec,
                &adapter,
                artifacts.as_deref(),
            );
            report(&results)
        }

        Commands::Gate {
            stage,
            project,
            checks_file,
        } => {
            let content = match std::fs::read_to_string(&checks_file) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to read checks file: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let checks: Vec<factory_engine::gate::GateCheckConfig> =
                match serde_yaml::from_str(&content) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("Failed to parse checks YAML: {e}");
                        return ExitCode::FAILURE;
                    }
                };
            let (_passed, results) =
                factory_engine::gate::run_stage_gate(&stage, &project, &checks).await;
            report(&results)
        }

        Commands::Feature {
            feature_id,
            feature_type,
            project,
            commands,
            files,
        } => {
            let file_paths = files.unwrap_or_default();
            let expected = if file_paths.is_empty() {
                None
            } else {
                Some(file_paths.as_slice())
            };
            let (_passed, results) = factory_engine::gate::run_feature_gate(
                &feature_id,
                &feature_type,
                &project,
                &commands,
                expected,
            )
            .await;
            report(&results)
        }

        Commands::Invariants { project, adapter } => {
            let manifest_path = adapter.join("manifest.yaml");
            let content = match std::fs::read_to_string(&manifest_path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Failed to read adapter manifest: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let manifest: factory_contracts::adapter_manifest::AdapterManifest =
                match serde_yaml::from_str(&content) {
                    Ok(m) => m,
                    Err(e) => {
                        eprintln!("Failed to parse adapter manifest: {e}");
                        return ExitCode::FAILURE;
                    }
                };
            let (_passed, results) =
                factory_engine::gate::run_invariants(&project, &manifest.validation.invariants)
                    .await;
            report(&results)
        }

        Commands::State { action } => match action {
            StateAction::Init {
                adapter_name,
                adapter_version,
                build_spec,
                state,
            } => {
                let hash = match factory_engine::preflight::hash_file(&build_spec) {
                    Ok(h) => h,
                    Err(e) => {
                        eprintln!("Failed to hash build spec: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                match factory_engine::harness_state::init_state(
                    &adapter_name,
                    &adapter_version,
                    &build_spec.display().to_string(),
                    &hash,
                    &state,
                ) {
                    Ok(s) => {
                        println!(
                            "{{\"status\": \"initialized\", \"pipeline_id\": \"{}\"}}",
                            s.pipeline.id
                        );
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize state: {e}");
                        ExitCode::FAILURE
                    }
                }
            }
            StateAction::Show { state } => {
                match factory_engine::harness_state::load_state(&state) {
                    Some(s) => {
                        println!("Pipeline: {}", s.pipeline.id);
                        println!("Status:   {:?}", s.pipeline.status);
                        println!(
                            "Adapter:  {} v{}",
                            s.pipeline.adapter.name, s.pipeline.adapter.version
                        );
                        println!("Started:  {}", s.pipeline.started_at);
                        println!("Updated:  {}", s.pipeline.updated_at);
                        if let Some(completed) = s.pipeline.completed_at {
                            println!("Completed: {completed}");
                        }
                        println!("\nStages ({}):", s.stages.len());
                        for (id, stage) in &s.stages {
                            let gate_str = stage
                                .gate
                                .as_ref()
                                .map(|g| {
                                    if g.passed {
                                        " [GATE PASS]"
                                    } else {
                                        " [GATE FAIL]"
                                    }
                                })
                                .unwrap_or("");
                            println!("  {id}: {:?}{gate_str}", stage.status);
                        }
                        if let Some(ref scaffolding) = s.scaffolding {
                            println!("\nScaffolding:");
                            println!(
                                "  API: {} completed, {} remaining, {} failed",
                                scaffolding.api.operations_completed.len(),
                                scaffolding.api.operations_remaining.len(),
                                scaffolding.api.operations_failed.len(),
                            );
                            println!(
                                "  UI:  {} completed, {} remaining, {} failed",
                                scaffolding.ui.pages_completed.len(),
                                scaffolding.ui.pages_remaining.len(),
                                scaffolding.ui.pages_failed.len(),
                            );
                            println!(
                                "  Data: {} completed, {} remaining",
                                scaffolding.data.entities_completed.len(),
                                scaffolding.data.entities_remaining.len(),
                            );
                        }
                        if !s.errors.is_empty() {
                            println!("\nLast errors:");
                            for err in s.errors.iter().rev().take(3) {
                                println!(
                                    "  [{:?}] {}: {}",
                                    err.error_type,
                                    err.stage.as_deref().unwrap_or("?"),
                                    err.message
                                );
                            }
                        }
                        ExitCode::SUCCESS
                    }
                    None => {
                        eprintln!("No pipeline state found.");
                        ExitCode::FAILURE
                    }
                }
            }
        },
    }
}

fn report(results: &[CheckResult]) -> ExitCode {
    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut warned = 0u32;

    for r in results {
        let tag = if r.passed {
            passed += 1;
            "PASS"
        } else if matches!(r.severity, Severity::Warning) {
            warned += 1;
            "WARN"
        } else {
            failed += 1;
            "FAIL"
        };
        println!("  [{tag}] {}: {}", r.id, r.message);
    }

    println!("\n{passed} passed, {failed} failed, {warned} warnings");

    if failed > 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
