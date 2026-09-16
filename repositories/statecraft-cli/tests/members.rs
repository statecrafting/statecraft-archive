//! Spec 108 acceptance (§9): discovery, dispatch, the reserved exit range and
//! the account-less face, driven through the built `statecraft` binary against
//! a fixture directory of stub member scripts.
//!
//! The stubs are POSIX shell scripts, so this file is unix-only. The umbrella
//! itself never uses a shell: it spawns the script by path with argv (§6), and
//! the kernel runs the interpreter named on the shebang line.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

const CONTRACT: &str = "042";

/// A fresh, unique fixture root with `managed/` and `path/` directories.
struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Fixture {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "statecraft-members-{label}-{}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("managed")).expect("create managed dir");
        std::fs::create_dir_all(root.join("path")).expect("create path dir");
        Fixture { root }
    }

    fn managed(&self) -> PathBuf {
        self.root.join("managed")
    }

    fn path_dir(&self) -> PathBuf {
        self.root.join("path")
    }

    /// Write an executable stub member `statecraft-<name>` into `dir`.
    fn stub(&self, dir: &Path, name: &str, body: &str) -> PathBuf {
        let file = dir.join(format!("statecraft-{name}"));
        std::fs::write(&file, body).expect("write stub");
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755))
            .expect("chmod stub");
        file
    }

    /// Run the umbrella with the managed directory pointed at this fixture and
    /// `PATH` reduced to the fixture's `path/` plus the system dirs the shell
    /// interpreter needs. Every plane-facing variable is stripped (§8).
    fn run(&self, args: &[&str]) -> Output {
        self.run_env(args, &[])
    }

    fn run_env(&self, args: &[&str], extra: &[(&str, &str)]) -> Output {
        let path = format!("{}:/usr/bin:/bin", self.path_dir().display());
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_statecraft"));
        cmd.args(args)
            .env_clear()
            .env("PATH", path)
            .env("STATECRAFT_MEMBER_DIR", self.managed())
            // No home: no config file, no credential store, no base URL (§8).
            .env("HOME", self.root.join("no-home"));
        for (key, value) in extra {
            cmd.env(key, value);
        }
        cmd.output().expect("failed to run statecraft binary")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A well-formed member stub. It answers the manifest flag with `name`,
/// `contract` and `verbs`; its `echo` verb prints argv one token per bracket
/// on stdout and a marker on stderr; its `exit` verb exits with the given
/// code; and every invocation appends one line to `<log>` so a test can count
/// how often it ran.
fn member_script(name: &str, contract: &str, verbs: &[&str], log: &Path) -> String {
    let verbs_json = verbs
        .iter()
        .map(|v| format!("\"{v}\""))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"#!/bin/sh
printf 'run\n' >> "{log}"
if [ "$1" = "--member-manifest" ]; then
  printf '%s\n' '{{"schemaVersion":"1","name":"statecraft-{name}","version":"9.9.9","contract":"{contract}","verbs":[{verbs_json}],"capabilityTier":"basic","exitCodes":{{"0":"ok","1":"operational","2":"unreachable","3":"usage"}},"envelope":"ok-data"}}'
  exit 0
fi
case "$1" in
  echo)
    shift
    printf 'argv:'
    for a in "$@"; do printf ' [%s]' "$a"; done
    printf '\n'
    printf 'stderr-marker\n' >&2
    printf '\377raw\n'
    exit 0 ;;
  exit)
    exit "$2" ;;
  stdin)
    cat ;;
esac
exit 0
"#,
        log = log.display()
    )
}

fn stdout(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn runs_logged(log: &Path) -> usize {
    std::fs::read_to_string(log)
        .map(|s| s.lines().count())
        .unwrap_or(0)
}

// --- discovery (§2, §5) -------------------------------------------------------

#[test]
fn an_empty_set_lists_nothing_and_exits_0() {
    let fx = Fixture::new("empty");
    let out = fx.run(&["members", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(stdout(&out).contains("no members found"));

    let out = fx.run(&["--output", "json", "members", "list"]);
    assert_eq!(out.status.code(), Some(0));
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    assert_eq!(value["ok"], true);
    assert_eq!(value["data"], serde_json::json!([]));
}

#[test]
fn managed_and_path_members_are_listed_with_their_locations() {
    let fx = Fixture::new("locations");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["orchestrator"], &log),
    );
    fx.stub(
        &fx.path_dir(),
        "sensor-claude",
        &member_script("sensor-claude", CONTRACT, &["watch", "log"], &log),
    );

    let out = fx.run(&["members", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let text = stdout(&out);
    assert!(text.contains("engine"), "{text}");
    assert!(text.contains("managed ("), "{text}");
    assert!(text.contains("sensor-claude"), "{text}");
    assert!(text.contains("PATH ("), "{text}");
    // Discovery read each manifest exactly once.
    assert_eq!(runs_logged(&log), 2);

    let out = fx.run(&["--output", "json", "members", "list"]);
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    assert_eq!(value["ok"], true);
    let members = value["data"].as_array().expect("data is an array");
    assert_eq!(members.len(), 2);
    let engine = members
        .iter()
        .find(|m| m["name"] == "engine")
        .expect("engine listed");
    assert_eq!(engine["location"], "managed");
    assert_eq!(engine["manifest"]["contract"], CONTRACT);
    assert_eq!(
        engine["manifest"]["verbs"],
        serde_json::json!(["orchestrator"])
    );
    let sensor = members
        .iter()
        .find(|m| m["name"] == "sensor-claude")
        .expect("sensor listed");
    assert_eq!(sensor["location"], "path");
}

#[test]
fn managed_wins_over_path_and_list_names_both() {
    let fx = Fixture::new("shadow");
    let log_managed = fx.root.join("log-managed");
    let log_path = fx.root.join("log-path");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["echo"], &log_managed),
    );
    fx.stub(
        &fx.path_dir(),
        "engine",
        &member_script("engine", CONTRACT, &["echo"], &log_path),
    );

    let out = fx.run(&["members", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let text = stdout(&out);
    assert!(text.contains("managed ("), "{text}");
    assert!(text.contains("shadows: PATH ("), "{text}");
    // The shadowed candidate was never executed, not even for its manifest.
    assert_eq!(runs_logged(&log_managed), 1);
    assert_eq!(runs_logged(&log_path), 0);

    let out = fx.run(&["engine", "echo", "x"]);
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        runs_logged(&log_managed),
        3,
        "resolve then dispatch, both managed"
    );
    assert_eq!(runs_logged(&log_path), 0);
}

#[test]
fn an_unparseable_manifest_is_listed_as_refused_and_never_run_again() {
    let fx = Fixture::new("refused");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "broken",
        &format!(
            "#!/bin/sh\nprintf 'run\\n' >> \"{}\"\nprintf 'this is not json\\n'\nexit 0\n",
            log.display()
        ),
    );

    let out = fx.run(&["members", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let text = stdout(&out);
    assert!(text.contains("broken"), "{text}");
    assert!(text.contains("REFUSED"), "{text}");
    assert!(text.contains("does not parse"), "{text}");
    assert_eq!(runs_logged(&log), 1);

    let out = fx.run(&["--output", "json", "members", "list"]);
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    let entry = &value["data"][0];
    assert_eq!(entry["name"], "broken");
    assert!(entry["refused"]
        .as_str()
        .unwrap()
        .contains("does not parse"));
    assert!(entry.get("manifest").is_none());
}

#[test]
fn members_show_prints_one_manifest_and_verbose_list_prints_the_tables() {
    let fx = Fixture::new("show");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["orchestrator"], &log),
    );

    let out = fx.run(&["members", "show", "engine"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(stdout(&out).contains("name:      statecraft-engine"));

    let out = fx.run(&["--output", "json", "members", "show", "statecraft-engine"]);
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid JSON");
    assert_eq!(value["ok"], true);
    assert_eq!(value["data"]["name"], "statecraft-engine");
    assert_eq!(value["data"]["contract"], CONTRACT);

    let out = fx.run(&["members", "list", "--verbose"]);
    let text = stdout(&out);
    assert!(text.contains("verbs: orchestrator"), "{text}");
    assert!(text.contains("2=unreachable"), "{text}");
    assert!(text.contains("3=usage"), "{text}");

    let out = fx.run(&["members", "show", "nope"]);
    assert_eq!(out.status.code(), Some(64));
}

// --- dispatch (§6, §7) --------------------------------------------------------

#[test]
fn dispatch_passes_argv_and_stdio_through_verbatim() {
    let fx = Fixture::new("passthrough");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["echo", "exit", "stdin"], &log),
    );

    let out = fx.run(&[
        "engine",
        "echo",
        "--json",
        "a b",
        "--url=http://x",
        "$HOME",
        "'quoted'",
        "--",
        "-x",
    ]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    // Bytes, not text: the member wrote a byte that is not UTF-8 and the
    // umbrella must not have re-encoded it.
    let expected: Vec<u8> = [
        b"argv: [--json] [a b] [--url=http://x] [$HOME] ['quoted'] [--] [-x]\n".as_slice(),
        b"\xffraw\n",
    ]
    .concat();
    assert_eq!(out.stdout, expected);
    assert_eq!(out.stderr, b"stderr-marker\n");
}

#[test]
fn dispatch_returns_each_member_exit_code_unchanged() {
    let fx = Fixture::new("codes");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["exit"], &log),
    );
    for code in ["0", "1", "2", "3"] {
        let out = fx.run(&["engine", "exit", code]);
        assert_eq!(
            out.status.code(),
            Some(code.parse::<i32>().unwrap()),
            "code {code}: {}",
            stderr(&out)
        );
        // Nothing of the umbrella's own on either stream.
        assert!(out.stdout.is_empty());
        assert!(out.stderr.is_empty());
    }
}

// --- the reserved range (§7) ----------------------------------------------------

#[test]
fn an_unknown_member_exits_64() {
    let fx = Fixture::new("notfound");
    let out = fx.run(&["nosuch", "anything"]);
    assert_eq!(out.status.code(), Some(64));
    assert!(stderr(&out).contains("statecraft-nosuch"));
    assert!(out.stdout.is_empty());
}

#[test]
fn an_unparseable_manifest_exits_65_without_a_second_run() {
    let fx = Fixture::new("skew65");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "broken",
        &format!(
            "#!/bin/sh\nprintf 'run\\n' >> \"{}\"\nprintf '{{\"name\":\"x\"}}\\n'\nexit 0\n",
            log.display()
        ),
    );
    let out = fx.run(&["broken", "go"]);
    assert_eq!(out.status.code(), Some(65), "{}", stderr(&out));
    assert!(stderr(&out).contains("refused"));
    assert_eq!(runs_logged(&log), 1, "identified once, never dispatched");
}

#[test]
fn a_contract_outside_the_supported_range_exits_66() {
    let fx = Fixture::new("skew66");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "future",
        &member_script("future", "099", &["echo"], &log),
    );
    let out = fx.run(&["future", "echo"]);
    assert_eq!(out.status.code(), Some(66), "{}", stderr(&out));
    let text = stderr(&out);
    assert!(text.contains("099"), "{text}");
    assert!(text.contains(CONTRACT), "{text}");
    assert_eq!(
        runs_logged(&log),
        1,
        "manifest read, member never dispatched"
    );
}

#[test]
fn a_subverb_outside_the_declared_verbs_exits_67_without_spawning() {
    let fx = Fixture::new("skew67");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["orchestrator"], &log),
    );
    let out = fx.run(&["engine", "watch"]);
    assert_eq!(out.status.code(), Some(67), "{}", stderr(&out));
    assert!(stderr(&out).contains("orchestrator"));
    assert_eq!(
        runs_logged(&log),
        1,
        "manifest read, member never dispatched"
    );
}

// --- the account-less face (§8) -----------------------------------------------

#[test]
fn list_and_dispatch_work_with_no_credential_store_and_no_base_url() {
    let fx = Fixture::new("accountless");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["echo"], &log),
    );
    // `Fixture::run` already clears the environment and points HOME at a
    // directory that does not exist, so there is no config file and no
    // credential store. A plane verb under the same environment refuses;
    // the member family must not.
    let plane = fx.run(&["tenants", "list"]);
    assert_ne!(plane.status.code(), Some(0));

    let out = fx.run(&["members", "list"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    let out = fx.run(&["engine", "echo", "hi"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(stdout(&out).starts_with("argv: [hi]"));
}

#[test]
fn a_malformed_plane_configuration_does_not_touch_a_dispatch() {
    let fx = Fixture::new("badconfig");
    let log = fx.root.join("log");
    fx.stub(
        &fx.managed(),
        "engine",
        &member_script("engine", CONTRACT, &["echo"], &log),
    );
    // An invalid STATECRAFT_OUTPUT is a usage error for a built-in verb; a
    // dispatch never loads the config layers, so it is untouched.
    let out = fx.run_env(&["engine", "echo", "hi"], &[("STATECRAFT_OUTPUT", "yaml")]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert!(stdout(&out).starts_with("argv: [hi]"));
}

#[test]
fn help_names_the_members_verb() {
    let fx = Fixture::new("help");
    let out = fx.run(&["--help"]);
    assert_eq!(out.status.code(), Some(0));
    assert!(stdout(&out).contains("members"));
}
