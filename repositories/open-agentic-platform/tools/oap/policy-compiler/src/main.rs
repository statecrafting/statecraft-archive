use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(
    name = "policy-compiler",
    version,
    about = "Compile and validate policy rules from markdown"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand, Debug)]
enum Command {
    /// Compile policy inputs and write `build/policy-bundles/policy-bundle.json`
    Compile {
        /// Repository root (default: current directory)
        #[arg(long)]
        repo: Option<PathBuf>,
    },
    /// Validate policy inputs and print violations
    Validate {
        /// Repository root (default: current directory)
        #[arg(long)]
        repo: Option<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Command::Compile { repo } => {
            let root = repo.unwrap_or_else(|| std::env::current_dir().expect("cwd"));
            match open_agentic_policy_compiler::compile_and_write(&root) {
                Ok(out) => {
                    if out.validation_passed {
                        0
                    } else {
                        1
                    }
                }
                Err(e) => {
                    eprintln!("policy-compiler: {e}");
                    3
                }
            }
        }
        Command::Validate { repo } => {
            let root = repo.unwrap_or_else(|| std::env::current_dir().expect("cwd"));
            match open_agentic_policy_compiler::compile(&root) {
                Ok(out) => {
                    for violation in &out.violations {
                        let path = violation.path.as_deref().unwrap_or("-");
                        eprintln!(
                            "{} [{}] {} ({})",
                            violation.code, violation.severity, violation.message, path
                        );
                    }
                    if out.validation_passed { 0 } else { 1 }
                }
                Err(e) => {
                    eprintln!("policy-compiler: {e}");
                    3
                }
            }
        }
    };
    std::process::exit(code);
}
