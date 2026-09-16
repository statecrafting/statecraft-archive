// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! ts-rs export coverage + JSONB round-trip checks for spec 111 Phase 2.
//!
//! ts-rs 12's `#[ts(export)]` attribute generates files as a side-effect of
//! `cargo test`. This file asserts the generated bindings land in the expected
//! location and that a canonical `UnifiedFrontmatter` serde-round-trips
//! through a JSON value (the JSONB wire form used by statecraft's catalog).
//!
//! `make ci` runs these tests and then `git diff --exit-code` on the
//! generated directory — the drift gate for the "no schema drift" invariant
//! in spec 111 §2.1.

use std::path::{Path, PathBuf};

use agent_frontmatter::{
    AgentType, AllowedTools, GovernanceRequirement, HookDeclaration, HookHandlerType,
    MutationCapability, SafetyTier, UnifiedFrontmatter,
};

fn bindings_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("platform/services/statecraft/api/agents/frontmatter")
}

/// The set of generated files that must be present after `cargo test`.
/// Keep this in sync with every `#[derive(TS)]` type in `src/types.rs`.
const EXPECTED_BINDINGS: &[&str] = &[
    "AgentType.ts",
    "GovernanceRequirement.ts",
    "HookDeclaration.ts",
    "HookHandlerType.ts",
    "MutationCapability.ts",
    "SafetyTier.ts",
    "UnifiedFrontmatter.ts",
];

/// ts-rs auto-exports every `#[ts(export)]`-marked type whenever `cargo test`
/// runs — see the docstring on `ts_rs::TS::export`. This test just asserts
/// the side-effect actually landed in the expected location. The `make ci`
/// drift gate (git diff --exit-code) does the subsequent freshness check.
#[test]
fn ts_rs_writes_every_expected_file() {
    let dir = bindings_dir();
    assert!(
        dir.is_dir(),
        "bindings directory missing: {}",
        dir.display()
    );

    for name in EXPECTED_BINDINGS {
        let path = dir.join(name);
        assert!(
            path.is_file(),
            "expected generated binding {} missing at {}",
            name,
            path.display()
        );
    }
}

#[test]
fn canonical_frontmatter_round_trips_through_jsonb() {
    let mut fm = UnifiedFrontmatter {
        name: "triage-agent".to_string(),
        description: Some("A triage agent that classifies incoming GitHub issues.".to_string()),
        agent_type: AgentType::Agent,
        model: Some("opus".to_string()),
        tags: vec!["triage".to_string(), "github".to_string()],
        display_name: Some("Triage".to_string()),
        trigger: Some("issue.opened".to_string()),
        allowed_tools: AllowedTools::list(vec!["read".to_string(), "edit".to_string()]),
        safety_tier: Some(SafetyTier::Tier2),
        mutation: Some(MutationCapability::ReadWrite),
        mutation_scope: vec!["apps/api/**".to_string()],
        optional: false,
        hooks: {
            let mut h = std::collections::HashMap::new();
            h.insert(
                "pre_tool".to_string(),
                vec![HookDeclaration {
                    name: "audit".to_string(),
                    handler_type: HookHandlerType::Bash,
                    condition: Some("tool == 'Bash'".to_string()),
                    run: "echo audited".to_string(),
                }],
            );
            h
        },
        governance: Some(GovernanceRequirement::Enforced),
        max_spec_risk: Some("medium".to_string()),
        version: Some("1.0.0".to_string()),
        author: Some("bart".to_string()),
        priority: Some(10),
        icon: Some("star".to_string()),
        stage: None,
        context_budget: None,
        standards_category: None,
        standards_tags: vec![],
        extra: std::collections::HashMap::new(),
    };
    fm.extra.insert(
        "x_future_key".to_string(),
        serde_json::json!({ "nested": [1, 2, 3] }),
    );

    let json: serde_json::Value = serde_json::to_value(&fm).expect("serialize");

    // Unknown fields travel at the top level via `#[serde(flatten)]`.
    assert_eq!(json["x_future_key"]["nested"][1], serde_json::json!(2));
    // The canonical tier form is the string; round-trip never emits `1`.
    assert_eq!(json["safety_tier"], serde_json::json!("tier2"));
    // Untagged AllowedTools::List → bare array on the wire.
    assert_eq!(
        json["allowed_tools"],
        serde_json::json!(["read", "edit"])
    );

    let back: UnifiedFrontmatter =
        serde_json::from_value(json.clone()).expect("deserialize");
    let re: serde_json::Value = serde_json::to_value(&back).expect("re-serialize");
    assert_eq!(json, re, "JSONB round-trip lost or rewrote a field");
}

/// spec 123 §7.1 — verify that a `UnifiedFrontmatter` embedded in a v2
/// `agent.catalog.updated` envelope round-trips through `serde_json`. This
/// mirrors how the desktop sync code preserves frontmatter through the JSONB
/// round-trip when applying a catalog update.
///
/// The test constructs a minimal v2 envelope shape (as `serde_json::Value`),
/// extracts the frontmatter field, and asserts it deserialises back to the
/// canonical `UnifiedFrontmatter` without loss.
#[test]
fn v2_catalog_updated_frontmatter_round_trips() {
    // Build a `UnifiedFrontmatter` and embed it in a v2 envelope JSON value.
    let fm = UnifiedFrontmatter {
        name: "spec-123-agent".to_string(),
        description: Some("round-trip test for spec 123 §7.1".to_string()),
        agent_type: AgentType::Agent,
        model: Some("sonnet".to_string()),
        tags: vec!["spec-123".to_string()],
        display_name: Some("Spec-123 Agent".to_string()),
        trigger: None,
        allowed_tools: AllowedTools::all(),
        safety_tier: Some(SafetyTier::Tier2),
        mutation: None,
        mutation_scope: vec![],
        optional: false,
        hooks: std::collections::HashMap::new(),
        governance: Some(GovernanceRequirement::Enforced),
        max_spec_risk: None,
        version: Some("2.0.0".to_string()),
        author: Some("bart".to_string()),
        priority: None,
        icon: Some("globe".to_string()),
        stage: None,
        context_budget: None,
        standards_category: None,
        standards_tags: vec![],
        extra: std::collections::HashMap::new(),
    };

    let fm_value: serde_json::Value = serde_json::to_value(&fm).expect("fm to value");

    // Construct a minimal v2 agent.catalog.updated envelope — the shape the
    // Rust sync_client.rs decoder and agent_catalog_sync.rs handlers deal with.
    let envelope = serde_json::json!({
        "kind": "agent.catalog.updated",
        "meta": {
            "v": 1,
            "eventId": "e-spec123",
            "sentAt": "2026-05-01T00:00:00Z",
            "orgCursor": "cur-spec123",
            "orgId": "org-spec123"          // v2 shape: org_id on meta
        },
        // Spec 123 §7.1 — v:2 fields.
        "agentId": "ag-spec123",
        "name": "spec-123-agent",
        "version": 2,
        "status": "published",
        "contentHash": "spec123contenthash",
        "frontmatter": fm_value,
        "bodyMarkdown": "# spec 123 agent body",
        "updatedAt": "2026-05-01T00:01:00Z"
    });

    // Verify the envelope is valid JSON.
    let re_serialised = serde_json::to_string(&envelope).expect("re-serialise envelope");
    let reparsed: serde_json::Value =
        serde_json::from_str(&re_serialised).expect("re-parse envelope");

    // Extract and deserialise the frontmatter.
    let fm_json = reparsed["frontmatter"].clone();
    let fm_back: UnifiedFrontmatter =
        serde_json::from_value(fm_json.clone()).expect("fm deserialise");

    assert_eq!(fm_back.name, "spec-123-agent");
    assert_eq!(fm_back.agent_type, AgentType::Agent);
    assert_eq!(fm_back.model.as_deref(), Some("sonnet"));
    assert!(fm_back.allowed_tools.is_all());

    // Round-trip: re-serialise the deserialised frontmatter and compare.
    let fm_re: serde_json::Value =
        serde_json::to_value(&fm_back).expect("fm re-serialise");
    assert_eq!(
        fm_json, fm_re,
        "frontmatter must survive v2 envelope round-trip without loss"
    );

    // Also verify the org_id is carried on the meta (spec 123 §7.1 change from spec 111).
    assert_eq!(
        reparsed["meta"]["orgId"].as_str(),
        Some("org-spec123"),
        "v2 envelope meta must carry orgId"
    );
}

#[test]
fn allowed_tools_wildcard_round_trips() {
    let fm = UnifiedFrontmatter {
        name: "wild".into(),
        description: None,
        agent_type: AgentType::Prompt,
        model: None,
        tags: vec![],
        display_name: None,
        trigger: None,
        allowed_tools: AllowedTools::all(),
        safety_tier: None,
        mutation: None,
        mutation_scope: vec![],
        optional: false,
        hooks: std::collections::HashMap::new(),
        governance: None,
        max_spec_risk: None,
        version: None,
        author: None,
        priority: None,
        icon: None,
        stage: None,
        context_budget: None,
        standards_category: None,
        standards_tags: vec![],
        extra: std::collections::HashMap::new(),
    };
    let json = serde_json::to_value(&fm).unwrap();
    // Wildcard emits the bare "*" string — matches the "*" | string[]
    // union in the TS mirror.
    assert_eq!(json["allowed_tools"], serde_json::json!("*"));
    let back: UnifiedFrontmatter = serde_json::from_value(json).unwrap();
    assert!(back.allowed_tools.is_all());
}
