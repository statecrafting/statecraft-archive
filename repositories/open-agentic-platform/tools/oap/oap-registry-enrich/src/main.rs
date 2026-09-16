use clap::{Parser, Subcommand};
use open_agentic_registry_enrich::{EnrichError, enrich_and_write};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "oap-registry-enrich",
    version,
    about = "OAP-side enricher: emits build/spec-registry/registry-oap.json from the generic registry.json + spec corpus + .factory/build-spec.yaml walk (specs 074 / 102). Hosts the compliance-report subcommand migrated from registry-consumer (Cut D W-06b)."
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
    /// Compute and write build/spec-registry/registry-oap.json (default).
    Enrich,
    /// Generate compliance framework-to-spec mapping (spec 102 FR-025).
    /// Moved from `registry-consumer compliance-report` in Cut D W-06b.
    /// Post-W-06c the default registry path is the enriched
    /// `registry-oap.json` (compliance is no longer emitted by
    /// spec-compiler into the generic `registry.json`).
    ComplianceReport {
        /// Path to the enriched registry-oap.json (default:
        /// build/spec-registry/registry-oap.json)
        #[arg(long = "registry-path", value_name = "PATH")]
        registry_path: Option<PathBuf>,
        /// Filter to a specific framework identifier (e.g. "owasp-asi-2026")
        #[arg(long)]
        framework: Option<String>,
        /// Emit as JSON
        #[arg(long)]
        json: bool,
    },
    /// Output the authority set for a code path (spec 217 FR-302: the
    /// authority-resolver verb migrated from `registry-consumer`). Reads the
    /// committed registry via `spec-spine-core::load_committed_registry`.
    ByAuthority {
        /// Repo-relative code path to resolve authority for.
        path: String,
        /// Filter co_authority entries to this section/anchor name.
        #[arg(long)]
        section: Option<String>,
        /// Emit structured JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate the spec relationship graph (spec 217 FR-302): every spec id
    /// named by a relationship edge resolves, and the supersession graph is
    /// acyclic. Reads the committed registry via
    /// `spec-spine-core::load_committed_registry`. Exit 0 when well-formed, 1
    /// otherwise. The dangling-reference check restates, over the committed
    /// registry, the rejection `spec-spine compile` already performs.
    ValidateGraph {
        /// Emit structured JSON.
        #[arg(long)]
        json: bool,
    },
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
            Err(EnrichError::Registry(e)) => {
                eprintln!("oap-registry-enrich: registry read failed: {e}");
                ExitCode::from(3)
            }
            Err(e) => {
                eprintln!("oap-registry-enrich: {e}");
                ExitCode::from(3)
            }
        },
        Command::ComplianceReport {
            registry_path,
            framework,
            json,
        } => {
            let path = registry_path
                .unwrap_or_else(|| repo_root.join(".derived/spec-registry/registry-oap.json"));
            // Spec 217 engine swap: registry-oap.json is the OAP overlay artifact
            // this binary itself emits. Read it directly into the minimal shape the
            // report needs, rather than via the (deleted) in-tree registry reader.
            #[derive(serde::Deserialize)]
            struct OapRegistry {
                #[serde(default)]
                features: Vec<OapFeature>,
            }
            #[derive(serde::Deserialize)]
            struct OapFeature {
                id: String,
                #[serde(default)]
                compliance: Option<serde_json::Value>,
            }
            let registry: OapRegistry = match std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
            {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("oap-registry-enrich: {}: {e}", path.display());
                    return ExitCode::from(3);
                }
            };
            let mut features = registry.features;
            features.sort_by(|a, b| a.id.cmp(&b.id));
            let mut control_map: std::collections::BTreeMap<String, Vec<String>> =
                std::collections::BTreeMap::new();
            for f in &features {
                let Some(compliance) = f.compliance.as_ref().and_then(|v| v.as_array()) else {
                    continue;
                };
                for entry in compliance {
                    let fw = entry
                        .get("framework")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if let Some(ref filter) = framework {
                        if fw != filter.as_str() {
                            continue;
                        }
                    }
                    if let Some(controls) = entry.get("controls").and_then(|v| v.as_array()) {
                        for c in controls {
                            if let Some(ctrl) = c.as_str() {
                                let key = format!("{fw}/{ctrl}");
                                control_map.entry(key).or_default().push(f.id.clone());
                            }
                        }
                    }
                }
            }
            if control_map.is_empty() {
                eprintln!("No compliance mappings found.");
                return ExitCode::from(0);
            }
            if json {
                let rows: Vec<serde_json::Value> = control_map
                    .iter()
                    .map(|(control, specs)| {
                        serde_json::json!({
                            "control": control,
                            "specIds": specs,
                            "count": specs.len()
                        })
                    })
                    .collect();
                match serde_json::to_string_pretty(&rows) {
                    Ok(s) => println!("{s}"),
                    Err(e) => {
                        eprintln!("oap-registry-enrich: {e}");
                        return ExitCode::from(3);
                    }
                }
            } else {
                println!("{:<40} {:<6} specs", "control", "count");
                for (control, specs) in &control_map {
                    println!("{:<40} {:<6} {}", control, specs.len(), specs.join(", "));
                }
            }
            ExitCode::SUCCESS
        }
        Command::ByAuthority {
            path,
            section,
            json,
        } => {
            let registry = match open_agentic_registry_enrich::load_registry(&repo_root) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("oap-registry-enrich: registry read failed: {e}");
                    return ExitCode::from(3);
                }
            };
            let result = open_agentic_registry_enrich::authority::authority_for_path(
                &registry,
                &path,
                section.as_deref(),
            );
            if json {
                match serde_json::to_string_pretty(&result) {
                    Ok(s) => println!("{s}"),
                    Err(e) => {
                        eprintln!("oap-registry-enrich: {e}");
                        return ExitCode::from(3);
                    }
                }
            } else if result.is_empty() {
                println!("No specs claim authority over: {path}");
            } else {
                println!("Authority set for path: {path}");
                for entry in &result {
                    println!("  {:<44} via: {}", entry.spec_id, entry.relationship);
                }
            }
            ExitCode::SUCCESS
        }
        Command::ValidateGraph { json } => {
            let registry = match open_agentic_registry_enrich::load_registry(&repo_root) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("oap-registry-enrich: registry read failed: {e}");
                    return ExitCode::from(3);
                }
            };
            let report =
                open_agentic_registry_enrich::validate_graph::validate_graph(&registry);
            if json {
                match serde_json::to_string_pretty(&report) {
                    Ok(s) => println!("{s}"),
                    Err(e) => {
                        eprintln!("oap-registry-enrich: {e}");
                        return ExitCode::from(3);
                    }
                }
            } else if report.ok {
                println!(
                    "validate-graph: OK: {} spec(s), graph well-formed (edges resolve, supersession acyclic).",
                    report.spec_count
                );
            } else {
                eprintln!(
                    "validate-graph: {} finding(s) over {} spec(s):",
                    report.findings.len(),
                    report.spec_count
                );
                for f in &report.findings {
                    eprintln!("  [{}] {}", f.code, f.message);
                }
            }
            if report.ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            }
        }
    }
}
