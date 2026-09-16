//! `factory-schema-lockstep` — CLI for the cross-repo factory contract gate
//! (spec 212). Compares OAP's canonical contract surface against a local
//! factory `contract/schemas/**` checkout under the three-mode
//! structural compare + the spec-197 FR-005 GoA-concept guard.
//!
//! Exit codes:
//!   0 — parity holds (Tier-B gaps and notes are advisory, not failures)
//!   1 — a structural divergence or a GoA-concept guard hit (hard failure)
//!   2 — operational error (missing dir, unparseable file) — never skipped-green

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use open_agentic_factory_schema_lockstep::{run_check, Report};

#[derive(Parser, Debug)]
#[command(
    name = "factory-schema-lockstep",
    about = "Cross-repo factory contract lockstep check (spec 212)"
)]
struct Cli {
    /// OAP canonical contract surface.
    #[arg(long, default_value = "standards/schemas/factory")]
    oap_dir: PathBuf,

    /// Local factory contract/schemas tree (the fetched far side).
    #[arg(long)]
    factory_dir: PathBuf,

    /// Emit a machine-readable JSON report instead of text.
    #[arg(long)]
    json: bool,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run_check(&cli.oap_dir, &cli.factory_dir) {
        Ok(report) => {
            if cli.json {
                print_json(&report);
            } else {
                print_text(&report);
            }
            if report.failed() {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
        Err(e) => {
            eprintln!("factory-schema-lockstep: operational error: {e}");
            ExitCode::from(2)
        }
    }
}

fn print_text(r: &Report) {
    for note in &r.notes {
        println!("note: {note}");
    }
    for gap in &r.tier_b_gaps {
        println!("tier-b (advisory): {gap}");
    }
    if !r.divergences.is_empty() {
        eprintln!("\nstructural divergences ({}):", r.divergences.len());
        for d in &r.divergences {
            let loc = if d.path.is_empty() { d.file.clone() } else { format!("{}:{}", d.file, d.path) };
            eprintln!("  - {loc}: {}", d.detail);
        }
    }
    if !r.guard_hits.is_empty() {
        eprintln!("\nGoA-concept guard hits ({}):", r.guard_hits.len());
        for h in &r.guard_hits {
            eprintln!("  - {}:{}: forbidden token `{}` ({})", h.file, h.line, h.token, h.clause);
        }
    }
    if r.failed() {
        eprintln!("\nfactory-schema-lockstep: FAIL");
    } else {
        println!("factory-schema-lockstep: OK (parity holds at the pinned contract)");
    }
}

fn print_json(r: &Report) {
    let divergences: Vec<serde_json::Value> = r
        .divergences
        .iter()
        .map(|d| serde_json::json!({ "file": d.file, "path": d.path, "detail": d.detail }))
        .collect();
    let guard_hits: Vec<serde_json::Value> = r
        .guard_hits
        .iter()
        .map(|h| serde_json::json!({ "file": h.file, "line": h.line, "token": h.token, "clause": h.clause }))
        .collect();
    let out = serde_json::json!({
        "ok": !r.failed(),
        "divergences": divergences,
        "guard_hits": guard_hits,
        "tier_b_gaps": r.tier_b_gaps,
        "notes": r.notes,
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
