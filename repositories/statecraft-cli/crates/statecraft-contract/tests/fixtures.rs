//! Spec 111 B-5: every contract type written as a JSON fixture from a Rust
//! value, byte-identical to the committed file. The members' test
//! `members/src/members/contract-fixtures.test.ts` parses every one of these
//! through the TypeScript codecs; a shape cannot move on one side without
//! the other noticing.
//!
//! Set `STATECRAFT_CONTRACT_WRITE_FIXTURES=1` to regenerate after a deliberate
//! change, then commit the files with the spec edit that changed the shape.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use statecraft_contract::{
    exit, Capability, CapabilityTier, Classification, DriverEvent, Envelope, Manifest, ModelTier,
    OverflowInfo, Requirements, SessionRequest, SessionResult, TerminationKind, CHILD_ENV_DENY,
    CONTRACT, MANIFEST_SCHEMA_VERSION, SESSION_REQUEST_SCHEMA_VERSION,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn check(name: &str, value: &Value) {
    let rendered = format!(
        "{}\n",
        serde_json::to_string_pretty(value).expect("serialize")
    );
    let path = fixtures_dir().join(format!("{name}.json"));
    if std::env::var_os("STATECRAFT_CONTRACT_WRITE_FIXTURES").is_some() {
        std::fs::create_dir_all(fixtures_dir()).expect("mkdir fixtures");
        std::fs::write(&path, &rendered).expect("write fixture");
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture {} is missing ({e}); regenerate with STATECRAFT_CONTRACT_WRITE_FIXTURES=1",
            path.display()
        )
    });
    assert_eq!(
        committed,
        rendered,
        "fixture {} differs from the Rust type; a shape moved",
        path.display()
    );
}

fn to_value<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("to_value")
}

#[test]
fn manifests_of_the_three_members() {
    let engine = Manifest {
        schema_version: MANIFEST_SCHEMA_VERSION.to_string(),
        name: "statecraft-engine".to_string(),
        version: "0.1.0".to_string(),
        contract: CONTRACT.to_string(),
        verbs: vec!["orchestrator".to_string()],
        capability_tier: CapabilityTier::Basic,
        // Spec 120 B-2: the engine supports no session token.
        capabilities: Some(Vec::new()),
        exit_codes: exit::d4_taxonomy(),
        envelope: "ok-data".to_string(),
    };
    let driver = Manifest {
        name: "statecraft-driver-claude".to_string(),
        verbs: vec!["models".to_string(), "session".to_string()],
        capability_tier: CapabilityTier::Reference,
        // Spec 120 B-2: the four request tokens and hook enforcement; not
        // workspace-write (D-2).
        capabilities: Some(vec![
            Capability::ToolAllowlist,
            Capability::MaxTurns,
            Capability::McpConfig,
            Capability::Cost,
            Capability::HookEnforcement,
        ]),
        ..engine.clone()
    };
    let codex = Manifest {
        name: "statecraft-driver-codex".to_string(),
        capability_tier: CapabilityTier::Basic,
        capabilities: Some(vec![
            Capability::WorkspaceWrite,
            Capability::HookEnforcement,
        ]),
        ..driver.clone()
    };
    let sensor = Manifest {
        name: "statecraft-sensor-claude".to_string(),
        verbs: [
            "watch", "log", "stats", "snapshot", "diff", "explain", "peek", "daemon",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
        exit_codes: exit::sensor_taxonomy(),
        ..engine.clone()
    };
    check("manifest-engine", &to_value(&engine));
    check("manifest-driver", &to_value(&driver));
    check("manifest-driver-codex", &to_value(&codex));
    check("manifest-sensor", &to_value(&sensor));
    // Round trip through the parser 108 applies.
    for m in [&engine, &driver, &codex, &sensor] {
        let text = serde_json::to_string(m).unwrap();
        assert_eq!(&Manifest::parse(text.as_bytes()).unwrap(), m);
    }
    // Spec 120 B-2: a tier that disagrees with its tokens is refused; an
    // older manifest without the field is not checked.
    let lying = Manifest {
        capability_tier: CapabilityTier::Reference,
        ..codex.clone()
    };
    let err = Manifest::parse(serde_json::to_string(&lying).unwrap().as_bytes()).unwrap_err();
    assert!(err.contains("derive basic"), "{err}");
    let older = Manifest {
        capabilities: None,
        ..driver.clone()
    };
    assert!(Manifest::parse(serde_json::to_string(&older).unwrap().as_bytes()).is_ok());
}

/// Spec 121 B-3: the environment deny list, as both sides assert it.
#[test]
fn child_env_deny() {
    check("child-env-deny", &json!(CHILD_ENV_DENY));
}

/// Spec 120 B-1: the vocabulary, in wire order, as both sides assert it.
#[test]
fn capabilities() {
    check(
        "capabilities",
        &json!(Capability::ALL
            .iter()
            .map(|c| c.as_str())
            .collect::<Vec<_>>()),
    );
    assert_eq!(
        CapabilityTier::for_capabilities(&Capability::ALL),
        CapabilityTier::Reference
    );
    assert_eq!(
        CapabilityTier::for_capabilities(&Capability::REQUEST),
        CapabilityTier::Reference
    );
    assert_eq!(
        CapabilityTier::for_capabilities(&[
            Capability::WorkspaceWrite,
            Capability::HookEnforcement
        ]),
        CapabilityTier::Basic
    );
    assert_eq!(
        Capability::ordered(&[
            Capability::Cost,
            Capability::Cost,
            Capability::ToolAllowlist
        ]),
        vec![Capability::ToolAllowlist, Capability::Cost]
    );
}

#[test]
fn exit_codes() {
    check(
        "exit-codes",
        &json!({
            "floor": exit::FLOOR,
            "memberNotFound": exit::MEMBER_NOT_FOUND,
            "manifestRefused": exit::MANIFEST_REFUSED,
            "contractSkew": exit::CONTRACT_SKEW,
            "unknownSubverb": exit::UNKNOWN_SUBVERB,
            "d4": exit::d4_taxonomy(),
        }),
    );
}

#[test]
fn envelopes() {
    let ok: Envelope<Value> = Envelope::ok(json!({"members": []}));
    let err: Envelope<Value> =
        Envelope::err("unreachable", "no daemon at http://127.0.0.1:1", None);
    let http: Envelope<Value> = Envelope::err(
        "api",
        "tenants not enabled on this control plane",
        Some(404),
    );
    check("envelope-ok", &to_value(&ok));
    check("envelope-error", &to_value(&err));
    check("envelope-error-status", &to_value(&http));
}

#[test]
fn session_request() {
    let request = SessionRequest {
        schema_version: SESSION_REQUEST_SCHEMA_VERSION.to_string(),
        repo: "/work/target".to_string(),
        prompt: "Implement spec 012.".to_string(),
        tier: Some(ModelTier::Strong),
        model: None,
        max_turns: Some(40),
        timeout_ms: Some(1_800_000),
        mcp_config_path: None,
        profile: Some(json!({
            "mode": "guarded",
            "allowedTools": ["Read", "Bash(git:*)"],
            "disallowedTools": null,
            "models": null,
            "driver": "codex",
            "require": ["workspace-write"]
        })),
        kill_grace_ms: None,
        // Spec 120 B-3.
        requirements: Some(Requirements {
            required: vec![Capability::WorkspaceWrite],
            preferred: vec![Capability::Cost],
        }),
    };
    check("session-request", &to_value(&request));
    let minimal = SessionRequest {
        tier: None,
        max_turns: None,
        timeout_ms: None,
        profile: None,
        requirements: None,
        ..request
    };
    check("session-request-minimal", &to_value(&minimal));
}

fn completed() -> SessionResult {
    let mut usage = BTreeMap::new();
    usage.insert("input_tokens".to_string(), 100);
    usage.insert("output_tokens".to_string(), 42);
    SessionResult {
        classification: Classification {
            kind: TerminationKind::Completed,
            reset_at_ms: None,
            detail: "result event reported is_error: false".to_string(),
        },
        exit_code: Some(0),
        duration_ms: 597,
        num_turns: Some(2),
        cost_micro_usd: Some(12345),
        usage: Some(usage),
        session_id: Some("sess-seam".to_string()),
        transcript_path: Some("/home/u/.claude/projects/-work-target/sess-seam.jsonl".to_string()),
        overflow: OverflowInfo::default(),
        stderr_tail: String::new(),
        // Spec 119 B-6: the completed fixture carries one denial so both
        // parsers prove they read the field; the quota one carries none.
        denials: 1,
        denial_samples: vec!["Bash operation blocked by hook: [pr-gate] BLOCKED".to_string()],
    }
}

#[test]
fn session_results_and_events() {
    check("session-result-completed", &to_value(&completed()));
    let quota = SessionResult {
        classification: Classification {
            kind: TerminationKind::Quota,
            reset_at_ms: Some(1_700_000_000_000),
            detail: "You have hit your usage limit.".to_string(),
        },
        exit_code: Some(1),
        num_turns: None,
        cost_micro_usd: None,
        usage: None,
        overflow: OverflowInfo {
            lines: vec!["not json".to_string()],
            truncated_count: 0,
        },
        stderr_tail: "rate limited".to_string(),
        denials: 0,
        denial_samples: Vec::new(),
        ..completed()
    };
    check("session-result-quota", &to_value(&quota));
    let events = vec![
        DriverEvent::Stream {
            raw: json!({"type": "system", "subtype": "init", "session_id": "sess-seam"}),
        },
        DriverEvent::Journal {
            kind: "session.init".to_string(),
            payload: json!({"claudeBin": "claude", "repo": "/work/target", "model": "claude-opus-5", "maxTurns": 40, "timeoutMs": 1800000, "sessionId": "sess-seam", "profile": {"mode": "bypass", "allowedTools": null, "disallowedTools": null, "models": null}}),
        },
        DriverEvent::Result {
            result: completed(),
        },
    ];
    check("driver-events", &to_value(&events));
}
