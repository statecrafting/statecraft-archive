//! `statecraft-journal` (spec 113 B-5): the verifier that shares no code
//! with the writer, as a member the umbrella dispatches to.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use statecraft_contract::{
    exit, CapabilityTier, Envelope, Manifest, CONTRACT, MANIFEST_FLAG, MANIFEST_SCHEMA_VERSION,
};
use statecraft_journal::bundle::{
    attest_absent, attestation_absent, export_from_root, parse_bundle, redaction_policy,
    run_corpus_attest, serialize_bundle, verify_attestation, verify_bundle,
    AttestationVerification, BundleVerifyResult,
};
use statecraft_journal::chain::{verify_chain, VerifyResult};

const NAME: &str = "statecraft-journal";
const VERBS: [&str; 3] = ["verify", "verify-bundle", "export"];

// 023 D-4's taxonomy, as the manifest declares it.
const EXIT_OK: i32 = 0;
const EXIT_FAILURE: i32 = 1;
const EXIT_USAGE: i32 = 3;

const USAGE: &str = "usage: statecraft-journal <verb> [--json]

  verify [--dir <state root>] [--chain work|decisions|both]   recompute every hash and link
  verify-bundle <path>                                          verify an exported bundle offline
  export --dir <state root> [--project <name>] [--out <path>] [--no-attest]
                                                                write the redacted, verifiable bundle
";

fn manifest() -> Manifest {
    Manifest {
        schema_version: MANIFEST_SCHEMA_VERSION.to_string(),
        name: NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        contract: CONTRACT.to_string(),
        verbs: VERBS.iter().map(|v| v.to_string()).collect(),
        capability_tier: CapabilityTier::Basic,
        // Spec 120 B-2: a sensor or journal member supports no session token.
        capabilities: Some(Vec::new()),
        exit_codes: exit::d4_taxonomy(),
        envelope: "ok-data".to_string(),
    }
}

struct Args {
    verb: Option<String>,
    positionals: Vec<String>,
    json: bool,
    dir: Option<PathBuf>,
    chain: String,
    project: Option<String>,
    out: Option<PathBuf>,
    no_attest: bool,
}

fn parse(argv: &[String]) -> Result<Args, String> {
    let mut args = Args {
        verb: None,
        positionals: Vec::new(),
        json: false,
        dir: None,
        chain: "both".to_string(),
        project: None,
        out: None,
        no_attest: false,
    };
    let mut i = 0;
    while i < argv.len() {
        let a = &argv[i];
        let value = |i: &mut usize| -> Result<String, String> {
            *i += 1;
            argv.get(*i)
                .cloned()
                .ok_or_else(|| format!("{a} needs a value"))
        };
        match a.as_str() {
            "--json" => args.json = true,
            "--no-attest" => args.no_attest = true,
            "--dir" => args.dir = Some(PathBuf::from(value(&mut i)?)),
            "--chain" => args.chain = value(&mut i)?,
            "--project" => args.project = Some(value(&mut i)?),
            "--out" => args.out = Some(PathBuf::from(value(&mut i)?)),
            flag if flag.starts_with("--") => return Err(format!("unknown flag {flag}")),
            _ => {
                if args.verb.is_none() {
                    args.verb = Some(a.clone());
                } else {
                    args.positionals.push(a.clone());
                }
            }
        }
        i += 1;
    }
    Ok(args)
}

fn emit(json: bool, ok: bool, data: Value, human: &str) {
    if json {
        let envelope: Envelope<Value> = if ok {
            Envelope::ok(data)
        } else {
            Envelope::err("failed", human.to_string(), None)
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&envelope).expect("envelope serializes")
        );
    } else {
        println!("{human}");
    }
}

fn usage(json: bool, message: &str) -> i32 {
    if json {
        let envelope: Envelope<Value> = Envelope::err("usage", message.to_string(), None);
        println!(
            "{}",
            serde_json::to_string_pretty(&envelope).expect("envelope serializes")
        );
    } else {
        eprintln!("error: {message}");
        eprint!("{USAGE}");
    }
    EXIT_USAGE
}

fn verify_verb(args: &Args) -> i32 {
    let dir = args.dir.clone().unwrap_or_else(|| PathBuf::from("."));
    let chains: Vec<(&str, Option<&str>)> = match args.chain.as_str() {
        "work" => vec![("work", None)],
        "decisions" => vec![("decisions", Some("decisions"))],
        "both" => vec![("work", None), ("decisions", Some("decisions"))],
        other => {
            return usage(
                args.json,
                &format!("--chain must be work, decisions or both, not {other}"),
            )
        }
    };
    let mut all_ok = true;
    let mut report = Vec::new();
    let mut lines = Vec::new();
    for (name, basename) in chains {
        match verify_chain(&dir, basename) {
            Ok(VerifyResult::Ok { count }) => {
                report.push(json!({"chain": name, "ok": true, "count": count}));
                lines.push(format!("{name}: intact ({count} records)"));
            }
            Ok(VerifyResult::Broken { broken_seq, reason }) => {
                all_ok = false;
                report.push(
                    json!({"chain": name, "ok": false, "brokenSeq": broken_seq, "reason": reason}),
                );
                lines.push(format!("{name}: BROKEN at seq {broken_seq}: {reason}"));
            }
            Err(e) => {
                all_ok = false;
                report.push(json!({"chain": name, "ok": false, "reason": e.to_string()}));
                lines.push(format!("{name}: {e}"));
            }
        }
    }
    emit(
        args.json,
        all_ok,
        json!({"dir": dir.display().to_string(), "chains": report}),
        &lines.join("\n"),
    );
    if all_ok {
        EXIT_OK
    } else {
        EXIT_FAILURE
    }
}

fn verify_bundle_verb(args: &Args) -> i32 {
    let Some(path) = args.positionals.first() else {
        return usage(args.json, "verify-bundle needs a bundle path");
    };
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            emit(
                args.json,
                false,
                Value::Null,
                &format!("cannot read {path}: {e}"),
            );
            return EXIT_FAILURE;
        }
    };
    let bundle = match parse_bundle(&text) {
        Ok(b) => b,
        Err(reason) => {
            emit(args.json, false, Value::Null, &reason);
            return EXIT_FAILURE;
        }
    };
    let chains = verify_bundle(&bundle);
    let attestation = verify_attestation(&bundle);
    let mut lines = Vec::new();
    let ok = match &chains {
        BundleVerifyResult::Ok { chains } => {
            for c in chains {
                lines.push(format!(
                    "{}: intact ({} records: {} verified, {} redacted, {} withheld)",
                    c.chain,
                    c.records,
                    c.payloads_verified,
                    c.payloads_redacted,
                    c.payloads_withheld
                ));
            }
            true
        }
        BundleVerifyResult::Broken { chain, seq, reason } => {
            lines.push(format!(
                "{chain}: BROKEN{}: {reason}",
                seq.map(|s| format!(" at seq {s}")).unwrap_or_default()
            ));
            false
        }
    };
    lines.push(match &attestation {
        AttestationVerification::Intact { attestation_hash } => {
            format!("attestation: intact ({attestation_hash})")
        }
        AttestationVerification::Mismatch {
            attestation_hash,
            computed_hash,
        } => {
            format!("attestation: MISMATCH (declared {attestation_hash}, computed {computed_hash})")
        }
        AttestationVerification::Malformed { reason } => {
            format!("attestation: malformed ({reason})")
        }
        AttestationVerification::Absent { reason } => format!("attestation: absent ({reason})"),
    });
    emit(
        args.json,
        ok,
        json!({"chains": chains, "attestation": attestation}),
        &lines.join("\n"),
    );
    if ok {
        EXIT_OK
    } else {
        EXIT_FAILURE
    }
}

fn export_verb(args: &Args) -> i32 {
    let Some(dir) = args.dir.clone() else {
        return usage(args.json, "export needs --dir <state root>");
    };
    let attestation = if args.no_attest {
        Some(attestation_absent(attest_absent::NOT_RUN))
    } else {
        Some(run_corpus_attest(Path::new(".")))
    };
    let bundle = match export_from_root(
        &dir,
        args.project.as_deref(),
        &redaction_policy(),
        attestation,
    ) {
        Ok(b) => b,
        Err(reason) => {
            emit(args.json, false, Value::Null, &reason);
            return EXIT_FAILURE;
        }
    };
    let text = serialize_bundle(&bundle);
    match &args.out {
        Some(out) => {
            if let Some(parent) = out.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::write(out, &text) {
                emit(
                    args.json,
                    false,
                    Value::Null,
                    &format!("cannot write {}: {e}", out.display()),
                );
                return EXIT_FAILURE;
            }
            let counts: Vec<String> = bundle
                .chains
                .iter()
                .map(|c| format!("{} {}", c.record_count, c.chain))
                .collect();
            emit(
                args.json,
                true,
                json!({"out": out.display().to_string(), "chains": bundle.chains.iter().map(|c| json!({"chain": c.chain, "records": c.record_count})).collect::<Vec<_>>()}),
                &format!("bundle written: {} ({})", out.display(), counts.join(", ")),
            );
        }
        None => print!("{text}"),
    }
    EXIT_OK
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.iter().any(|a| a == MANIFEST_FLAG) {
        println!(
            "{}",
            serde_json::to_string(&manifest()).expect("manifest serializes")
        );
        std::process::exit(0);
    }
    let args = match parse(&argv) {
        Ok(a) => a,
        Err(message) => std::process::exit(usage(false, &message)),
    };
    let code = match args.verb.as_deref() {
        Some("verify") => verify_verb(&args),
        Some("verify-bundle") => verify_bundle_verb(&args),
        Some("export") => export_verb(&args),
        Some(other) => usage(args.json, &format!("unknown verb {other}")),
        None => usage(args.json, "a verb is required"),
    };
    std::process::exit(code);
}
