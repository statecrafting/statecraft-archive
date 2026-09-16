use clap::{Parser, Subcommand};
use open_agentic_code_index_enrich::{EnrichError, enrich_and_write, render};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "oap-code-index-enrich",
    version,
    about = "OAP-side enricher: emits index-oap.json + renders CODEBASE-INDEX.md (Cut D W-07a + W-07b)."
)]
struct Cli {
    /// Repository root (default: current working directory)
    #[arg(long = "repo-root", value_name = "PATH")]
    repo_root: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Compute and write build/codebase-index/index-oap.json (default).
    Enrich,
    /// Render build/codebase-index/CODEBASE-INDEX.md from index-oap.json.
    /// Moved from `codebase-indexer render` in Cut D W-07b.
    Render,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let repo_root = cli
        .repo_root
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    match cli.command.unwrap_or(Command::Enrich) {
        Command::Enrich => match enrich_and_write(&repo_root) {
            Ok(path) => {
                println!("wrote {}", path.display());
                ExitCode::SUCCESS
            }
            Err(EnrichError::Index(e)) => {
                eprintln!("oap-code-index-enrich: codebase-index read failed: {e}");
                ExitCode::from(3)
            }
            Err(e) => {
                eprintln!("oap-code-index-enrich: {e}");
                ExitCode::from(3)
            }
        },
        Command::Render => match render::render_to_file(&repo_root) {
            Ok(()) => {
                println!(
                    "wrote {}",
                    repo_root
                        .join(".derived/codebase-index/CODEBASE-INDEX.md")
                        .display()
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("oap-code-index-enrich: render failed: {e}");
                ExitCode::from(3)
            }
        },
    }
}
