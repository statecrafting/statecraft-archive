// Spec: 108-member-dispatch
//! Member dispatch (spec 108): the umbrella's local, account-less face.
//!
//! A member is a separately built binary named `statecraft-<name>` that
//! answers `--member-manifest` with one JSON object (spec
//! 042 B-3). `statecraft <name> <args...>`, where `<name>` is not a built-in
//! verb, resolves to that binary and hands it the arguments verbatim: argv
//! only, never a shell (§6); stdio inherited, never buffered (D-5); the exit
//! code returned unchanged (§7, design doc 01 D18). Failures of the dispatch
//! layer itself take the reserved range at 64 and above, which no member
//! emits (D-4).
//!
//! Nothing here reads a credential, resolves a base URL, or touches the
//! config file (§8): the local loop is the free half of the product and must
//! not depend on the paid half.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
// Spec 111: the contract's data types come from the crate every Rust member
// shares; this module keeps discovery, dispatch and rendering (111 D-2).
pub use statecraft_contract::{exit, Manifest, MANIFEST_FLAG, MEMBER_PREFIX};

use crate::error::{AppError, AppResult};
use crate::output::{self, OutputFormat};
use crate::verbs::{error_envelope, success_envelope_value};

// --- the contract ------------------------------------------------------------

/// The member-contract versions this umbrella dispatches to (§6). A member
/// outside the range is refused by name with both versions stated; the range
/// is a closed interval over the contract id, so today it is exactly `042`.
pub const CONTRACT_MIN: &str = "042";
pub const CONTRACT_MAX: &str = "042";

/// `STATECRAFT_MEMBER_DIR` overrides the managed member directory (§4).
pub const MEMBER_DIR_ENV: &str = "STATECRAFT_MEMBER_DIR";

/// Reserved dispatch-layer exit codes (§7, D-4), defined by the contract
/// crate (111 B-2). Members bind themselves to codes below `exit::FLOOR`.
pub const EXIT_MEMBER_NOT_FOUND: u8 = exit::MEMBER_NOT_FOUND;
pub const EXIT_MANIFEST_REFUSED: u8 = exit::MANIFEST_REFUSED;
pub const EXIT_CONTRACT_SKEW: u8 = exit::CONTRACT_SKEW;
pub const EXIT_UNKNOWN_SUBVERB: u8 = exit::UNKNOWN_SUBVERB;

/// Whether a member's contract version falls inside the supported range.
pub fn contract_supported(manifest: &Manifest) -> bool {
    contract_in_range(&manifest.contract)
}

fn contract_in_range(contract: &str) -> bool {
    contract >= CONTRACT_MIN && contract <= CONTRACT_MAX
}

// --- locations --------------------------------------------------------------

/// Where a member binary was found. The managed directory is searched first
/// (D-2), so a member installed through the umbrella is never shadowed by an
/// unrelated binary earlier on `PATH`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Location {
    Managed,
    Path,
}

impl Location {
    fn label(self) -> &'static str {
        match self {
            Location::Managed => "managed",
            Location::Path => "PATH",
        }
    }
}

/// The managed member directory (§4): `STATECRAFT_MEMBER_DIR`, else
/// `$XDG_DATA_HOME/statecraft/members`, else the platform data directory
/// (`~/.local/share/statecraft/members` on Linux, `~/Library/Application
/// Support/statecraft/members` on macOS).
pub fn member_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os(MEMBER_DIR_ENV).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(xdg).join("statecraft").join("members"));
    }
    directories::ProjectDirs::from("", "", "statecraft").map(|d| d.data_dir().join("members"))
}

/// A binary that carries the member prefix at one location. Nothing has been
/// executed at this point.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Candidate {
    name: String,
    path: PathBuf,
    location: Location,
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.is_file()
            && path
                .metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// The dispatch key of a file name, if it carries the member prefix and is
/// not the umbrella itself. `statecraft-engine` gives `engine`.
fn member_name(file_name: &OsStr) -> Option<String> {
    let name = file_name.to_str()?;
    let stripped = name.strip_prefix(MEMBER_PREFIX)?;
    // Windows carries an extension the dispatch key does not.
    let stripped = stripped
        .strip_suffix(std::env::consts::EXE_SUFFIX)
        .unwrap_or(stripped);
    if stripped.is_empty() {
        return None;
    }
    Some(stripped.to_string())
}

fn candidates_in(dir: &Path, location: Location, only: Option<&str>) -> Vec<Candidate> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<Candidate> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = member_name(&entry.file_name())?;
            if only.is_some_and(|wanted| wanted != name) {
                return None;
            }
            let path = entry.path();
            is_executable(&path).then_some(Candidate {
                name,
                path,
                location,
            })
        })
        .collect();
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// Every candidate in the fixed search order (§2): the managed directory,
/// then each `PATH` entry in order. Duplicates are kept; `resolve` decides
/// which wins and reports the rest as shadowed.
fn candidates(only: Option<&str>) -> Vec<Candidate> {
    let mut all = Vec::new();
    if let Some(dir) = member_dir() {
        all.extend(candidates_in(&dir, Location::Managed, only));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            if dir.as_os_str().is_empty() {
                continue;
            }
            all.extend(candidates_in(&dir, Location::Path, only));
        }
    }
    all
}

// --- discovery --------------------------------------------------------------

/// A shadowed candidate: the same name found at a later location (§2).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Shadowed {
    pub location: Location,
    pub path: String,
}

/// One discovered member: the winning candidate, its manifest or the reason
/// it was refused, and every candidate it shadows.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Member {
    pub name: String,
    pub location: Location,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<Manifest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub shadows: Vec<Shadowed>,
}

/// Ask one binary for its manifest. This is the only way the umbrella runs a
/// member other than dispatching to it, and a candidate whose answer is
/// refused is not run again (§2).
fn read_manifest(path: &Path) -> Result<Manifest, String> {
    let output = Command::new(path)
        .arg(MANIFEST_FLAG)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("cannot run {}: {e}", path.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{MANIFEST_FLAG} exited {}",
            output
                .status
                .code()
                .map_or_else(|| "by signal".to_string(), |c| c.to_string())
        ));
    }
    Manifest::parse(&output.stdout)
}

/// Group candidates by name in search order: the first occurrence wins and
/// the rest are recorded as shadowed. Nothing is executed here.
fn group(candidates: Vec<Candidate>) -> Vec<(Candidate, Vec<Shadowed>)> {
    let mut grouped: Vec<(Candidate, Vec<Shadowed>)> = Vec::new();
    for candidate in candidates {
        match grouped.iter_mut().find(|(c, _)| c.name == candidate.name) {
            Some((winner, shadows)) => {
                if winner.path != candidate.path {
                    shadows.push(Shadowed {
                        location: candidate.location,
                        path: candidate.path.display().to_string(),
                    });
                }
            }
            None => grouped.push((candidate, Vec::new())),
        }
    }
    grouped.sort_by(|(a, _), (b, _)| a.name.cmp(&b.name));
    grouped
}

fn identify((candidate, shadows): (Candidate, Vec<Shadowed>)) -> Member {
    let (manifest, refused) = match read_manifest(&candidate.path) {
        Ok(manifest) => (Some(manifest), None),
        Err(reason) => (None, Some(reason)),
    };
    Member {
        name: candidate.name,
        location: candidate.location,
        path: candidate.path.display().to_string(),
        manifest,
        refused,
        shadows,
    }
}

/// Discover every member: read each winning candidate's manifest before any
/// of them is dispatched to (D-3).
pub fn discover() -> Vec<Member> {
    group(candidates(None)).into_iter().map(identify).collect()
}

/// Resolve one name: the same search order and the same identification,
/// scoped to the member being dispatched to.
pub fn resolve(name: &str) -> Option<Member> {
    group(candidates(Some(name)))
        .into_iter()
        .find(|(c, _)| c.name == name)
        .map(identify)
}

// --- `statecraft members` (§5) ------------------------------------------------

/// `members list`: one row per discovered member, refused ones included.
pub fn list(format: OutputFormat, verbose: bool) -> AppResult<()> {
    let members = discover();
    let data = serde_json::to_value(&members).expect("serializing owned members cannot fail");
    match format {
        OutputFormat::Json => {
            output::emit(format, &success_envelope_value(&data), String::new);
        }
        OutputFormat::Human => println!("{}", render_list(&members, verbose)),
    }
    Ok(())
}

fn render_list(members: &[Member], verbose: bool) -> String {
    use std::fmt::Write;

    if members.is_empty() {
        let dir = member_dir().map_or_else(
            || "(no data directory)".to_string(),
            |d| d.display().to_string(),
        );
        return format!("no members found (managed directory: {dir}; then PATH)");
    }
    let mut out = String::new();
    let _ = writeln!(
        out,
        "{:<16} {:<10} {:<9} {:<10} LOCATION",
        "NAME", "VERSION", "CONTRACT", "TIER"
    );
    for member in members {
        match &member.manifest {
            Some(m) => {
                let _ = writeln!(
                    out,
                    "{:<16} {:<10} {:<9} {:<10} {} ({})",
                    member.name,
                    m.version,
                    m.contract,
                    m.capability_tier.as_str(),
                    member.location.label(),
                    member.path
                );
                if verbose {
                    let _ = writeln!(out, "    verbs: {}", m.verbs.join(", "));
                    let codes: Vec<String> = m
                        .exit_codes
                        .iter()
                        .map(|(c, meaning)| format!("{c}={meaning}"))
                        .collect();
                    let _ = writeln!(out, "    exit codes: {}", codes.join(", "));
                }
            }
            None => {
                let _ = writeln!(
                    out,
                    "{:<16} {:<10} {:<9} {:<10} {} ({}) REFUSED: {}",
                    member.name,
                    "-",
                    "-",
                    "-",
                    member.location.label(),
                    member.path,
                    member.refused.as_deref().unwrap_or("unknown reason")
                );
            }
        }
        for shadowed in &member.shadows {
            let _ = writeln!(
                out,
                "    shadows: {} ({})",
                shadowed.location.label(),
                shadowed.path
            );
        }
    }
    out.trim_end().to_string()
}

/// `members show <name>`: one member's manifest.
pub fn show(format: OutputFormat, name: &str) -> AppResult<()> {
    let key = name.strip_prefix(MEMBER_PREFIX).unwrap_or(name);
    let Some(member) = resolve(key) else {
        return refuse(
            format,
            "member-not-found",
            format!("no member named `{key}` ({MEMBER_PREFIX}{key} is not in the managed directory or on PATH)"),
            EXIT_MEMBER_NOT_FOUND,
        );
    };
    match &member.manifest {
        Some(manifest) => {
            let data =
                serde_json::to_value(manifest).expect("serializing an owned manifest cannot fail");
            match format {
                OutputFormat::Json => {
                    output::emit(format, &success_envelope_value(&data), String::new)
                }
                OutputFormat::Human => println!("{}", render_manifest(&member, manifest)),
            }
            Ok(())
        }
        None => refuse(
            format,
            "manifest-refused",
            format!(
                "member `{key}` at {} refused: {}",
                member.path,
                member.refused.as_deref().unwrap_or("unknown reason")
            ),
            EXIT_MANIFEST_REFUSED,
        ),
    }
}

fn render_manifest(member: &Member, m: &Manifest) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(out, "name:      {}", m.name);
    let _ = writeln!(out, "version:   {}", m.version);
    let _ = writeln!(out, "contract:  {}", m.contract);
    let _ = writeln!(out, "tier:      {}", m.capability_tier.as_str());
    let _ = writeln!(out, "envelope:  {}", m.envelope);
    let _ = writeln!(out, "verbs:     {}", m.verbs.join(", "));
    let codes: Vec<String> = m
        .exit_codes
        .iter()
        .map(|(c, meaning)| format!("{c}={meaning}"))
        .collect();
    let _ = writeln!(out, "exit codes: {}", codes.join(", "));
    let _ = write!(
        out,
        "location:  {} ({})",
        member.location.label(),
        member.path
    );
    out
}

/// A dispatch-layer refusal from a built-in `members` verb: the envelope on
/// stdout under `--output json`, a stderr line otherwise, and the reserved
/// code either way.
fn refuse(format: OutputFormat, kind: &'static str, message: String, code: u8) -> AppResult<()> {
    match format {
        OutputFormat::Json => {
            output::emit(format, &error_envelope(kind, message, None), String::new);
            Err(AppError::Rendered { code })
        }
        OutputFormat::Human => {
            eprintln!("error: {message}");
            Err(AppError::Rendered { code })
        }
    }
}

// --- dispatch (§6, §7) --------------------------------------------------------

/// `statecraft <name> <args...>`: resolve the member, check the contract and
/// the subverb, then hand over stdin, stdout, stderr and the exit code.
pub fn dispatch(name: &str, args: &[std::ffi::OsString]) -> AppResult<()> {
    let Some(member) = resolve(name) else {
        eprintln!(
            "error: no member named `{name}`: {MEMBER_PREFIX}{name} is not in the managed directory or on PATH (see `statecraft members list`)"
        );
        return Err(AppError::Rendered {
            code: EXIT_MEMBER_NOT_FOUND,
        });
    };
    let manifest = match &member.manifest {
        Some(manifest) => manifest,
        None => {
            eprintln!(
                "error: member `{name}` at {} refused: {}",
                member.path,
                member.refused.as_deref().unwrap_or("unknown reason")
            );
            return Err(AppError::Rendered {
                code: EXIT_MANIFEST_REFUSED,
            });
        }
    };
    if !contract_supported(manifest) {
        eprintln!(
            "error: member `{name}` implements member contract {} but this statecraft supports {}; \
             neither is changed silently, upgrade one of them",
            manifest.contract,
            supported_range()
        );
        return Err(AppError::Rendered {
            code: EXIT_CONTRACT_SKEW,
        });
    }
    // A subverb the member does not declare is refused before any process is
    // spawned (§3). A leading flag is not a subverb: it goes through so the
    // member's own parser can answer it.
    if let Some(first) = args.first().and_then(|a| a.to_str()) {
        if !first.starts_with('-') && !manifest.verbs.iter().any(|v| v == first) {
            eprintln!(
                "error: member `{name}` declares no verb `{first}` (it offers: {})",
                manifest.verbs.join(", ")
            );
            return Err(AppError::Rendered {
                code: EXIT_UNKNOWN_SUBVERB,
            });
        }
    }
    let code = spawn_inherited(Path::new(&member.path), args)?;
    if code == 0 {
        Ok(())
    } else {
        Err(AppError::Rendered { code })
    }
}

fn supported_range() -> String {
    if CONTRACT_MIN == CONTRACT_MAX {
        CONTRACT_MIN.to_string()
    } else {
        format!("{CONTRACT_MIN} to {CONTRACT_MAX}")
    }
}

/// Spawn the member with argv, inherited stdio, and signal forwarding; return
/// its exit code unchanged. A member killed by a signal reports as the shell
/// would, 128 plus the signal number.
fn spawn_inherited(path: &Path, args: &[std::ffi::OsString]) -> AppResult<u8> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| anyhow::anyhow!("cannot run member {}: {e}", path.display()))?;
    signals::forward_to(child.id());
    let status = child
        .wait()
        .map_err(|e| anyhow::anyhow!("waiting for member {}: {e}", path.display()))?;
    signals::stop_forwarding();
    Ok(exit_code_of(status))
}

fn exit_code_of(status: std::process::ExitStatus) -> u8 {
    if let Some(code) = status.code() {
        return u8::try_from(code).unwrap_or(u8::MAX);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return u8::try_from(128 + signal).unwrap_or(u8::MAX);
        }
    }
    u8::MAX
}

/// Signal forwarding (§6): while a member runs, SIGINT and SIGTERM reaching
/// the umbrella are forwarded to it and the umbrella keeps waiting, so Ctrl-C
/// stops an orchestrator run the way it would if the member had been invoked
/// directly. The handler is installed after the spawn, so the member inherits
/// the default dispositions rather than the umbrella's.
#[cfg(unix)]
mod signals {
    use std::sync::atomic::{AtomicI32, Ordering};

    static CHILD: AtomicI32 = AtomicI32::new(0);

    extern "C" fn forward(signal: libc::c_int) {
        let pid = CHILD.load(Ordering::SeqCst);
        if pid > 0 {
            // SAFETY: `kill` is async-signal-safe; the pid is our own child,
            // recorded before the handler was installed and cleared once it
            // has been reaped, so a recycled pid is never signalled.
            unsafe {
                libc::kill(pid, signal);
            }
        }
    }

    pub fn forward_to(pid: u32) {
        CHILD.store(pid as i32, Ordering::SeqCst);
        // SAFETY: installing a plain C handler for two standard signals; the
        // handler touches only an atomic and calls an async-signal-safe
        // function.
        unsafe {
            libc::signal(libc::SIGINT, forward as *const () as libc::sighandler_t);
            libc::signal(libc::SIGTERM, forward as *const () as libc::sighandler_t);
        }
    }

    pub fn stop_forwarding() {
        CHILD.store(0, Ordering::SeqCst);
        // SAFETY: restoring the default dispositions.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_DFL);
            libc::signal(libc::SIGTERM, libc::SIG_DFL);
        }
    }
}

#[cfg(not(unix))]
mod signals {
    pub fn forward_to(_pid: u32) {}
    pub fn stop_forwarding() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_json(contract: &str) -> String {
        format!(
            r#"{{"schemaVersion":"1","name":"statecraft-engine","version":"0.1.0","contract":"{contract}","verbs":["orchestrator"],"capabilityTier":"basic","exitCodes":{{"0":"ok","1":"operational","2":"unreachable","3":"usage"}},"envelope":"ok-data"}}"#
        )
    }

    #[test]
    fn manifest_parses_the_042_shape() {
        let m = Manifest::parse(manifest_json("042").as_bytes()).expect("parses");
        assert_eq!(m.name, "statecraft-engine");
        assert_eq!(m.verbs, vec!["orchestrator"]);
        assert_eq!(
            m.exit_codes.get("2").map(String::as_str),
            Some("unreachable")
        );
        assert!(contract_supported(&m));
        let skewed = Manifest::parse(manifest_json("099").as_bytes()).expect("parses");
        assert!(!contract_supported(&skewed));
    }

    #[test]
    fn contract_range_is_a_closed_interval() {
        assert!(contract_in_range("042"));
        assert!(!contract_in_range("041"));
        assert!(!contract_in_range("043"));
    }

    #[test]
    fn member_name_strips_only_the_prefix() {
        assert_eq!(
            member_name(OsStr::new("statecraft-engine")).as_deref(),
            Some("engine")
        );
        assert_eq!(
            member_name(OsStr::new("statecraft-sensor-claude")).as_deref(),
            Some("sensor-claude")
        );
        assert_eq!(member_name(OsStr::new("statecraft")), None);
        assert_eq!(member_name(OsStr::new("statecraft-")), None);
        assert_eq!(member_name(OsStr::new("other-engine")), None);
    }

    #[test]
    fn first_candidate_wins_and_later_ones_are_shadowed() {
        let managed = Candidate {
            name: "engine".into(),
            path: PathBuf::from("/managed/statecraft-engine"),
            location: Location::Managed,
        };
        let on_path = Candidate {
            name: "engine".into(),
            path: PathBuf::from("/usr/bin/statecraft-engine"),
            location: Location::Path,
        };
        let grouped = group(vec![managed.clone(), on_path]);
        assert_eq!(grouped.len(), 1);
        assert_eq!(grouped[0].0, managed);
        assert_eq!(grouped[0].1[0].location, Location::Path);
        assert_eq!(grouped[0].1[0].path, "/usr/bin/statecraft-engine");
    }

    #[test]
    fn exit_codes_below_the_floor_stay_verbatim() {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            for code in [0, 1, 2, 3, 63] {
                assert_eq!(
                    exit_code_of(std::process::ExitStatus::from_raw(code << 8)),
                    code as u8
                );
            }
        }
    }
}
