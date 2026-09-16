// SPDX-License-Identifier: Apache-2.0

//! Composition tests: a synthesized app-model through boot, adjudication, the
//! Decision chain, and the wire boundary. Models are built the way a producer
//! would build them: pin the roster hash via `gate::roster_config_hash`, then
//! seal the integrity hash via `model::compute_model_hash`.

use kernel_native::adjudicate::{CapabilityRef, EffectRequest};
use kernel_native::{EffectDecision, Kernel, build_record, verify_effect_chain};
use serde_json::{Value, json};

/// A minimal valid model: one service, one agent, four grants.
fn base_model() -> Value {
    json!({
        "contract": { "name": "app-model", "version": "0.1.0" },
        "app": { "name": "worked-example", "org": "statecrafting" },
        "source": { "revision": "e61cfd2a", "uncommittedChanges": false },
        "extraction": { "producers": [], "verified": true },
        "types": [],
        "resources": {
            "databases": [{ "name": "app" }],
            "kv": [{ "name": "sessions" }],
            "secrets": [{ "name": "github-app-key" }]
        },
        "capabilities": [
            { "id": "cap.db.app.rw", "kind": "db.write", "resource": "app",
              "constraints": { "tables": ["stamp_job", "tenant"] } },
            { "id": "cap.egress.github", "kind": "http.egress", "resource": "*",
              "constraints": { "domains": ["api.github.com"] } },
            { "id": "cap.kv.sessions", "kind": "kv.get", "resource": "sessions" },
            { "id": "cap.ledger.append", "kind": "ledger.append", "resource": "*" }
        ],
        "services": [
            { "name": "factory", "tier": "ts",
              "capabilities": ["cap.db.app.rw", "cap.egress.github",
                               "cap.kv.sessions", "cap.ledger.append"],
              "endpoints": [] }
        ],
        "agents": [
            { "name": "stamp-shepherd", "service": "factory",
              "trust": { "initial": "restricted", "direction": "degrade-only" },
              "capabilities": ["cap.db.app.rw", "cap.ledger.append"],
              "entry": "backend/factory/agents/stamp-shepherd.ts" }
        ],
        "trust": { "levels": ["full", "restricted", "read-only", "suspended"] },
        "gate": { "checks": ["secrets"], "configHash": "unpinned" },
        "ledger": {
            "recordSchema": "decision/v1",
            "maxRecordBytes": 1024,
            "signing": { "algorithm": "ed25519", "keyEnv": "ATTEST_LEDGER_SIGNING_KEY" }
        },
        "observability": { "metricsPath": "/metrics", "otel": true },
        "integrity": { "algorithm": "sha256-canonical-keysort-v1", "hash": "unsealed" }
    })
}

/// Pin the roster hash and seal the integrity hash, the producer's two final
/// steps.
fn seal(mut doc: Value) -> String {
    let checks: Vec<String> = doc["gate"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    doc["gate"]["configHash"] = json!(kernel_native::gate::roster_config_hash(&checks).unwrap());
    let hash = kernel_native::compute_model_hash(&doc).unwrap();
    doc["integrity"]["hash"] = json!(hash);
    serde_json::to_string(&doc).unwrap()
}

fn booted() -> Kernel {
    Kernel::from_model_json(&seal(base_model())).unwrap()
}

fn request(kind: &str, resource: &str) -> EffectRequest {
    EffectRequest {
        service: "factory".to_string(),
        agent: None,
        capability: CapabilityRef {
            kind: kind.to_string(),
            resource: resource.to_string(),
        },
        trust: None,
        payload_summary: None,
        payload_body: None,
        attributes: Default::default(),
    }
}

// --- boot refusals ---------------------------------------------------------

#[test]
fn boot_accepts_a_sealed_model_and_receipts_it() {
    let kernel = booted();
    let receipt = kernel.receipt();
    assert!(receipt.model_hash.starts_with("sha256:"));
    assert_eq!(receipt.contract_version, "0.1.0");
    assert_eq!(receipt.app, "worked-example");
    assert_eq!(receipt.services, 1);
    assert_eq!(receipt.agents, 1);
    assert_eq!(receipt.capabilities, 4);
}

#[test]
fn tampering_after_seal_refuses() {
    let sealed = seal(base_model());
    let mut doc: Value = serde_json::from_str(&sealed).unwrap();
    doc["capabilities"][1]["constraints"]["domains"] = json!(["evil.example"]);
    let tampered = serde_json::to_string(&doc).unwrap();
    let err = Kernel::from_model_json(&tampered).unwrap_err();
    assert!(err.contains("integrity mismatch"), "got: {err}");
}

#[test]
fn wrong_gate_hash_refuses() {
    let mut doc = base_model();
    doc["gate"]["configHash"] = json!("sha256:0000");
    // Seal integrity by hand so only the gate hash is wrong.
    let hash = kernel_native::compute_model_hash(&doc).unwrap();
    doc["integrity"]["hash"] = json!(hash);
    let err = Kernel::from_model_json(&serde_json::to_string(&doc).unwrap()).unwrap_err();
    assert!(err.contains("gate.configHash mismatch"), "got: {err}");
}

#[test]
fn unknown_check_unknown_kind_and_dangling_ref_refuse() {
    let mut doc = base_model();
    doc["gate"]["checks"] = json!(["secrets", "vibes"]);
    let hash = kernel_native::compute_model_hash(&doc).unwrap();
    doc["integrity"]["hash"] = json!(hash);
    let err = Kernel::from_model_json(&serde_json::to_string(&doc).unwrap()).unwrap_err();
    assert!(err.contains("'vibes'"), "got: {err}");

    let mut doc = base_model();
    doc["capabilities"][0]["kind"] = json!("db.drop");
    let err = Kernel::from_model_json(&seal(doc)).unwrap_err();
    assert!(err.contains("unknown kind 'db.drop'"), "got: {err}");

    let mut doc = base_model();
    doc["services"][0]["capabilities"] = json!(["cap.missing"]);
    let err = Kernel::from_model_json(&seal(doc)).unwrap_err();
    assert!(
        err.contains("unknown capability 'cap.missing'"),
        "got: {err}"
    );
}

#[test]
fn unenforceable_constraint_key_refuses() {
    let mut doc = base_model();
    doc["capabilities"][0]["constraints"] = json!({ "tables": ["t"], "regions": ["us"] });
    let err = Kernel::from_model_json(&seal(doc)).unwrap_err();
    assert!(err.contains("unknown field"), "got: {err}");
}

#[test]
fn contract_version_outside_the_range_refuses() {
    let mut doc = base_model();
    doc["contract"]["version"] = json!("0.2.0");
    let err = Kernel::from_model_json(&seal(doc)).unwrap_err();
    assert!(err.contains("pinned range"), "got: {err}");
}

#[test]
fn model_hash_is_deterministic() {
    assert_eq!(
        Kernel::from_model_json(&seal(base_model()))
            .unwrap()
            .model_hash,
        Kernel::from_model_json(&seal(base_model()))
            .unwrap()
            .model_hash,
    );
}

// --- adjudication ----------------------------------------------------------

#[test]
fn declared_capability_allows() {
    let kernel = booted();
    let mut req = request("kv.get", "sessions");
    req.payload_summary = Some("session lookup".to_string());
    let out = kernel.adjudicate(&req);
    assert!(out.decision.is_allow(), "got: {:?}", out.decision);
    assert!(out.model_hash.starts_with("sha256:"));
    assert_eq!(out.gate_config_hash, kernel.receipt().gate_config_hash);
}

#[test]
fn undeclared_capability_denies_by_default() {
    let kernel = booted();
    // kv.put is not in the catalog at all; kv.get on an undeclared resource
    // is outside the grant's resource.
    for req in [request("kv.put", "sessions"), request("kv.get", "other")] {
        let out = kernel.adjudicate(&req);
        assert!(out.decision.blocking, "got: {:?}", out.decision);
        assert!(
            out.decision.reason.contains("undeclared"),
            "got: {:?}",
            out.decision
        );
    }
}

#[test]
fn unknown_service_denies() {
    let kernel = booted();
    let mut req = request("kv.get", "sessions");
    req.service = "phantom".to_string();
    let out = kernel.adjudicate(&req);
    assert!(
        out.decision.reason.contains("unknown_service"),
        "got: {:?}",
        out.decision
    );
}

#[test]
fn constraints_bind_the_grant() {
    let kernel = booted();

    // Declared domain passes.
    let mut req = request("http.egress", "*");
    req.attributes
        .insert("domain".to_string(), json!("api.github.com"));
    assert!(kernel.adjudicate(&req).decision.is_allow());

    // Undeclared domain is a blocking deny.
    let mut req = request("http.egress", "*");
    req.attributes
        .insert("domain".to_string(), json!("evil.example"));
    let out = kernel.adjudicate(&req);
    assert!(out.decision.blocking);
    assert!(
        out.decision.reason.contains("constraint:domains"),
        "got: {:?}",
        out.decision
    );

    // Unverifiable (no domain attribute) is denied, not excused.
    let out = kernel.adjudicate(&request("http.egress", "*"));
    assert!(
        out.decision.reason.contains("constraint:domains"),
        "got: {:?}",
        out.decision
    );

    // Table membership: declared table passes, undeclared denies.
    let mut req = request("db.write", "app");
    req.attributes.insert("table".to_string(), json!("tenant"));
    assert!(kernel.adjudicate(&req).decision.is_allow());
    let mut req = request("db.write", "app");
    req.attributes
        .insert("table".to_string(), json!("secrets_vault"));
    assert!(!kernel.adjudicate(&req).decision.is_allow());
}

#[test]
fn agent_intersection_and_trust_ceiling() {
    let kernel = booted();

    // The agent's rows do not include kv.get, though its service's do.
    let mut req = request("kv.get", "sessions");
    req.agent = Some("stamp-shepherd".to_string());
    let out = kernel.adjudicate(&req);
    assert!(
        out.decision.reason.contains("undeclared"),
        "got: {:?}",
        out.decision
    );

    // Within its rows, its declared level (restricted) allows a write.
    let mut req = request("db.write", "app");
    req.agent = Some("stamp-shepherd".to_string());
    req.attributes.insert("table".to_string(), json!("tenant"));
    assert!(kernel.adjudicate(&req).decision.is_allow());

    // At read-only (the consumer's current ladder position), the write is a
    // non-blocking deny: a human grant may override a trust throttle.
    req.trust = Some(kernel_native::Level::ReadOnly);
    let out = kernel.adjudicate(&req);
    assert!(
        out.decision.reason.contains("trust:read_only"),
        "got: {:?}",
        out.decision
    );
    assert!(!out.decision.blocking);

    // Suspended blocks outright.
    req.trust = Some(kernel_native::Level::Suspended);
    let out = kernel.adjudicate(&req);
    assert!(
        out.decision.reason.contains("trust:suspended"),
        "got: {:?}",
        out.decision
    );
    assert!(out.decision.blocking);
}

#[test]
fn roster_gate_catches_a_secret_in_the_payload() {
    let kernel = booted();
    let mut req = request("kv.get", "sessions");
    req.payload_body = Some("api_key = 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'".to_string());
    let out = kernel.adjudicate(&req);
    assert!(
        out.decision.reason.contains("secrets"),
        "got: {:?}",
        out.decision
    );
    assert!(out.decision.blocking);
}

// --- the Decision chain ----------------------------------------------------

#[test]
fn decisions_chain_and_verify() {
    let kernel = booted();
    let genesis = kernel_native::payload::genesis_payload(&seal(base_model())).unwrap();
    assert_eq!(genesis.model_hash, kernel.model_hash);
    assert_eq!(genesis.contract_version, "0.1.0");

    let out = kernel.adjudicate(&request("kv.get", "sessions"));
    let decision = EffectDecision {
        model_hash: out.model_hash.clone(),
        gate_config_hash: out.gate_config_hash.clone(),
        service: "factory".to_string(),
        agent: None,
        capability: CapabilityRef {
            kind: "kv.get".to_string(),
            resource: "sessions".to_string(),
        },
        context_hash: "sha256:c".to_string(),
        outcome: "allow".to_string(),
        reason: String::new(),
        check_ids: vec![],
        approver: None,
    };
    let first = build_record(
        "sha256:anchor",
        "rec-0".to_string(),
        "2026-07-20T00:00:00Z".to_string(),
        &decision,
    );
    let second = build_record(
        first.record_hash.as_str(),
        "rec-1".to_string(),
        "2026-07-20T00:00:01Z".to_string(),
        &decision,
    );
    let chain = vec![first, second];
    assert!(verify_effect_chain(&chain).is_ok());

    // Tampering any payload breaks verification.
    let mut tampered = chain.clone();
    tampered[0].payload["outcome"] = json!("deny");
    assert!(verify_effect_chain(&tampered).is_err());
}

// --- the wire boundary (global boot: one model per process) ----------------

#[test]
fn wire_boot_and_adjudicate() {
    let sealed = seal(base_model());
    let receipt = kernel_native::wire::boot(&sealed).unwrap();
    assert!(receipt.contains("\"modelHash\""), "got: {receipt}");

    // Idempotent for the same model; a different model is an error.
    assert!(kernel_native::wire::boot(&sealed).is_ok());
    let mut other = base_model();
    other["app"]["name"] = json!("someone-else");
    assert!(kernel_native::wire::boot(&seal(other)).is_err());

    let out = kernel_native::wire::adjudicate(
        r#"{"service":"factory","capability":{"kind":"kv.get","resource":"sessions"}}"#,
    )
    .unwrap();
    assert!(out.contains("\"outcome\":\"allow\""), "got: {out}");
    assert!(out.contains("\"modelHash\""), "got: {out}");

    let hash = kernel_native::wire::gate_config_hash(r#"["secrets"]"#).unwrap();
    assert!(hash.starts_with("sha256:"));
    assert!(
        kernel_native::wire::default_window_config()
            .unwrap()
            .contains("window_size")
    );
    assert!(kernel_native::wire::adjudicate("{ not json").is_err());
}
