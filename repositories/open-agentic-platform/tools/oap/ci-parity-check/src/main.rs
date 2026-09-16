use clap::Parser;
use open_agentic_ci_parity_check::{check_parity, check_preconditions, ENFORCING_WORKFLOWS};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "ci-parity-check",
    version,
    about = "Assert the root Makefile's ci targets mirror every enforcing GitHub Actions workflow (spec 104)."
)]
struct Cli {
    /// Repository root (defaults to the current working directory).
    #[arg(long)]
    repo: Option<PathBuf>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let root = cli
        .repo
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));

    let parity = match check_parity(&root) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("ci-parity-check: parity: {e}");
            return ExitCode::from(2);
        }
    };
    let preconditions = match check_preconditions(&root) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("ci-parity-check: preconditions: {e}");
            return ExitCode::from(2);
        }
    };

    if parity.is_empty() && preconditions.is_empty() {
        println!(
            "ci-parity-check: OK — Makefile mirrors {} enforcing workflow(s); fresh-clone preconditions satisfied.",
            ENFORCING_WORKFLOWS.len()
        );
        return ExitCode::SUCCESS;
    }

    if !parity.is_empty() {
        eprintln!("ci-parity-check: {} command-parity drift(s) detected", parity.len());
        for d in &parity {
            eprintln!(
                "  [{}] {} / {} — missing token: `{}`",
                d.workflow, d.job, d.step, d.missing_token,
            );
            eprintln!("    line: {}", d.source_line);
        }
        eprintln!();
        eprintln!("Each line is a `run:` step in an enforcing workflow whose command");
        eprintln!("tokens are not all present in the root Makefile. Add the missing");
        eprintln!("recipe to the Makefile (spec 104), or extend the allow list in");
        eprintln!("tools/ci-parity-check/src/lib.rs if the step has no local analogue.");
    }

    if !preconditions.is_empty() {
        if !parity.is_empty() {
            eprintln!();
        }
        eprintln!(
            "ci-parity-check: {} precondition drift(s) detected",
            preconditions.len()
        );
        for d in &preconditions {
            eprintln!(
                "  [{}] {} / {} — consumer reads `{}`",
                d.workflow, d.job, d.step, d.missing_artifact,
            );
            eprintln!("    line: {}", d.consumer_line);
            eprintln!(
                "    neither produced by an earlier step in this job nor tracked in git"
            );
        }
        eprintln!();
        eprintln!("On a fresh CI clone the artifact doesn't exist, so the consumer");
        eprintln!("step will fail even though the command is correct. Either commit");
        eprintln!("the artifact to git, or add a produce step before the consumer.");
    }

    ExitCode::from(1)
}
