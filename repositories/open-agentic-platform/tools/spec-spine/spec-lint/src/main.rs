use clap::Parser;
use open_agentic_spec_lint::lint_repo;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "spec-lint",
    version,
    about = "Conformance warnings W-001+ (specs/006-conformance-lint-mvp; spec 128 §7 severity tiers)"
)]
struct Cli {
    /// Repository root (default: current directory)
    #[arg(long)]
    repo: Option<PathBuf>,

    /// Exit with status 1 if any warning-tier diagnostic was emitted.
    /// Info-tier diagnostics (spec 128 §7.1, introduced by spec 147)
    /// are NOT gated by this flag — they emit alongside but do not
    /// cause non-zero exit. The empty-W-set audit posture established
    /// by spec 128 §2 applies to the warning tier only.
    #[arg(long)]
    fail_on_warn: bool,

    /// Reserved flag (spec 128 §7.1). When set, exit with status 1 if
    /// any info-tier diagnostic was emitted. Off by default; no CI
    /// invocation uses it today. Provided so strict-mode runs can
    /// optionally gate on advisory observations.
    #[arg(long)]
    fail_on_info: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let root = cli
        .repo
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));

    let diagnostics = lint_repo(&root);
    for d in &diagnostics {
        eprintln!("{} [{}] {}: {}", d.code, d.severity, d.path, d.message);
    }

    let error_tier_count = diagnostics.iter().filter(|d| d.severity == "error").count();
    let warning_tier_count = diagnostics.iter().filter(|d| d.severity == "warning").count();
    let info_tier_count = diagnostics.iter().filter(|d| d.severity == "info").count();

    // Spec 161 §2.3 / SC-004 — `error`-tier diagnostics fail spec-lint
    // unconditionally; they are reserved-contract violations, not
    // conformance hints, and cannot be silenced by omitting
    // `--fail-on-warn`. The warning and info tiers remain CLI-gated as
    // before (spec 128 §7.1, amended by spec 147).
    let fail_error = error_tier_count > 0;
    let fail_warn = cli.fail_on_warn && warning_tier_count > 0;
    let fail_info = cli.fail_on_info && info_tier_count > 0;

    if fail_error || fail_warn || fail_info {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
