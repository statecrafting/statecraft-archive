use clap::Parser;
use open_agentic_adapter_scopes_compiler::{compile_from_adapters_dir, serialize_to_string};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(
    name = "adapter-scopes-compiler",
    version,
    about = "Project the admitted adapter sub-envelope(s) (manifest governance: \
             sections) into adapter-scopes.json (spec 105, derivation per spec 198 FR-012).",
    after_help = "EXAMPLE (from the OAP repo root, factory checkout as sibling):\n  \
                  adapter-scopes-compiler --repo . --adapters-dir ../factory/adapters"
)]
struct Cli {
    /// Repository root. The tool writes outputs relative to this.
    #[arg(long)]
    repo: Option<PathBuf>,

    /// Adapters directory of a factory source checkout (e.g.
    /// `../factory/adapters`). Required: the in-repo
    /// `factory/adapters` directory was retired by spec 108.
    #[arg(long)]
    adapters_dir: PathBuf,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let repo = cli
        .repo
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));
    let adapters_dir = cli.adapters_dir;

    let compiled = match compile_from_adapters_dir(&adapters_dir) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("adapter-scopes-compiler: {e}");
            return ExitCode::from(1);
        }
    };

    let json = match serialize_to_string(&compiled) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("adapter-scopes-compiler: {e}");
            return ExitCode::from(1);
        }
    };

    let statecraft_path = repo
        .join("platform")
        .join("services")
        .join("statecraft")
        .join("api")
        .join("factory")
        .join("adapter-scopes.json");
    if let Err(e) = std::fs::write(&statecraft_path, &json) {
        eprintln!(
            "adapter-scopes-compiler: write {}: {e}",
            statecraft_path.display()
        );
        return ExitCode::from(1);
    }
    println!("wrote {}", statecraft_path.display());

    for (name, scope) in &compiled.adapters {
        println!("  {name}:");
        println!("    file_write_scope: [{}]", scope.file_write_scope.join(", "));
        println!("    allowed_commands: [{}]", scope.allowed_commands.join(", "));
    }

    ExitCode::SUCCESS
}
