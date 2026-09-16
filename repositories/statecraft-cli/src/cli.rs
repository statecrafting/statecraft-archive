//! The `statecraft` command tree (spec 102 §2).
//!
//! Stub verbs are present from day one so `--help` is honest: each carries
//! about-text naming the spec that implements it, and its handler exits 2.

use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};

use crate::output::OutputFormat;

/// Statecraft: governance verbs for humans (CLI) and agents (MCP).
#[derive(Debug, Parser)]
#[command(
    name = "statecraft",
    version,
    about = "Statecraft governance verbs: CLI subcommands for humans, MCP server for agents.",
    subcommand_required = true,
    arg_required_else_help = true,
    // Spec 108 §2: a first token that is not a built-in verb names a member
    // binary `statecraft-<name>`, git-plugin style, and everything after it
    // is that member's argv.
    allow_external_subcommands = true
)]
pub struct Cli {
    /// Output format: human-readable text, or stable machine JSON.
    #[arg(long, global = true, value_enum, value_name = "FORMAT")]
    pub output: Option<OutputFormat>,

    /// Statecraft control-plane base URL (overrides config / env).
    #[arg(long, global = true, value_name = "URL")]
    pub base_url: Option<String>,

    /// Path to the config file (defaults to the platform config directory).
    #[arg(long, global = true, value_name = "PATH")]
    pub config: Option<PathBuf>,

    /// Dump request/response metadata to stderr (never credential material).
    #[arg(long, global = true)]
    pub debug: bool,

    #[command(subcommand)]
    pub command: Command,
}

/// Top-level verbs. Stubs name their owning spec in about-text.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Authenticate against a Statecraft control plane (spec 103).
    Login,
    /// Show the currently authenticated identity (spec 103).
    Whoami,
    /// Inspect tenants (spec 104).
    Tenants {
        #[command(subcommand)]
        command: TenantsCommand,
    },
    /// Governance stamps (spec 104).
    Stamp {
        #[command(subcommand)]
        command: StampCommand,
    },
    /// Fleet operations (spec 104).
    Fleet {
        #[command(subcommand)]
        command: FleetCommand,
    },
    /// Chassis template upgrades, run in a stamped app checkout (spec 106).
    Template {
        #[command(subcommand)]
        command: TemplateCommand,
    },
    /// Run the MCP server over stdio (spec 105).
    Mcp {
        /// Print the .mcp.json install snippet for this server, then exit.
        #[arg(long)]
        print_config: bool,
    },
    /// Print version information.
    Version,
    /// Inspect configuration.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Generate a shell completion script.
    Completions {
        /// Target shell.
        shell: clap_complete::Shell,
    },
    /// Discover the member binaries the umbrella dispatches to (spec 108).
    Members {
        #[command(subcommand)]
        command: MembersCommand,
    },
    /// `statecraft <name> <args...>`: dispatch to the member `statecraft-<name>` (spec 108).
    #[command(external_subcommand)]
    External(Vec<OsString>),
}

#[derive(Debug, Subcommand)]
pub enum MembersCommand {
    /// One row per discovered member: name, version, contract, tier, location (spec 108 §5).
    List {
        /// Also print each member's declared verbs and exit-code table.
        #[arg(long)]
        verbose: bool,
    },
    /// Print one member's manifest (spec 108 §5).
    Show {
        /// Member name, with or without the `statecraft-` prefix.
        name: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum TenantsCommand {
    /// List the tenants you own (spec 104).
    List,
    /// Show one tenant, including its installations (spec 104).
    Show {
        /// Tenant id.
        id: String,
    },
    /// Print the GitHub App install URL for a tenant (spec 104).
    InstallUrl {
        /// Tenant id.
        id: String,
        /// Open the URL in the default browser instead of only printing it.
        #[arg(long)]
        open: bool,
    },
}

/// Governance posture for a stamp. Required with no default: the platform
/// rejects a defaulted posture, so the CLI never invents one (spec 104 §5.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Posture {
    /// No autonomous action; every step is operator-driven.
    None,
    /// Agent may act with a human in the loop.
    Assisted,
    /// Agent may act autonomously within its guardrails.
    Autonomous,
}

impl Posture {
    /// The wire token sent to the control plane (`posture` field).
    pub fn as_wire(self) -> &'static str {
        match self {
            Posture::None => "none",
            Posture::Assisted => "assisted",
            Posture::Autonomous => "autonomous",
        }
    }

    /// Parse a wire token back into a posture (the MCP `stamp_new` tool validates
    /// its enum by hand, spec 105). Unknown tokens are rejected, not defaulted:
    /// the platform never invents a posture and neither does either face.
    pub fn from_wire(token: &str) -> Option<Self> {
        match token {
            "none" => Some(Posture::None),
            "assisted" => Some(Posture::Assisted),
            "autonomous" => Some(Posture::Autonomous),
            _ => None,
        }
    }
}

#[derive(Debug, Subcommand)]
pub enum StampCommand {
    /// Request a new governance stamp: born-green repo in a customer org (spec 104).
    New {
        /// Tenant id the stamp is charged to.
        #[arg(long)]
        tenant: String,
        /// Application name for the stamped repo.
        #[arg(long)]
        app: String,
        /// Target GitHub org the repo is created in.
        #[arg(long)]
        org: String,
        /// Optional frontend flavor slot (e.g. `vue`).
        #[arg(long)]
        frontend: Option<String>,
        /// Governance posture (required; the platform never defaults it).
        #[arg(long, value_enum)]
        posture: Posture,
    },
    /// Check stamp status; `--watch` streams until the job settles (spec 104).
    Status {
        /// Stamp job id.
        job_id: String,
        /// Poll until the job reaches green or failed, streaming state changes.
        #[arg(long)]
        watch: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum FleetCommand {
    /// List a tenant's fleet apps (spec 104).
    List {
        /// Tenant id whose fleet is listed.
        #[arg(long)]
        tenant: String,
    },
    /// Deploy an image as a new fleet app (spec 104).
    Deploy {
        /// Tenant id the app belongs to.
        #[arg(long)]
        tenant: String,
        /// Fleet app name.
        #[arg(long)]
        app: String,
        /// Container image reference to place.
        #[arg(long)]
        image: String,
    },
    /// Roll a fleet app to a new image (spec 104).
    Update {
        /// Fleet app id.
        app_id: String,
        /// New container image reference.
        #[arg(long)]
        image: String,
    },
    /// Back up a fleet app's volume (spec 104).
    Backup {
        /// Fleet app id.
        app_id: String,
    },
    /// Remove a fleet app; `--confirm <name>` must echo the app name (spec 104).
    Remove {
        /// Fleet app id.
        app_id: String,
        /// The app's literal name, echoed to authorize the teardown.
        #[arg(long)]
        confirm: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum TemplateCommand {
    /// Upgrade a stamped app's chassis pins to a newer template version (spec 106).
    ///
    /// Run from the repo root of a stamped app. Reads template.toml, bumps the
    /// chassis package pins, refreshes the lockfile, runs template-owned
    /// codemods, runs the contract's verify verb, and commits on a branch.
    Upgrade {
        /// Target template version; omit to resolve the latest compatible one.
        #[arg(long, value_name = "VERSION")]
        to: Option<String>,
        /// Print the plan and diffs without changing anything.
        #[arg(long)]
        dry_run: bool,
        /// Commit on the current branch instead of a new template-upgrade branch.
        #[arg(long)]
        no_branch: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    /// Print the effective, merged configuration with sources annotated.
    Show,
}
