// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-001
//
// Lint: `provenance-validator` MUST NOT depend on any LLM client crate
// or HTTP client. The validator's contract is structural LLM-
// independence: it cannot be fooled by the same model that minted the
// claims it validates. Failure here is a workflow violation.
//
// Scope: this test covers DIRECT [dependencies] and [dev-dependencies]
// only. The current transitive chain is:
//   provenance-validator → factory-contracts → agent-frontmatter
// Any banned dep added to either upstream would bypass this test. The
// upstream Cargo.tomls do not currently pull LLM clients (verified
// 2026-04-30); adding one would require a workspace-level review since
// every other validator-adjacent crate would also be affected. A future
// stronger guard (cargo metadata walk, or cargo tree snapshot) can be
// added if upstream churn warrants it.

const BANNED_DEPS: &[&str] = &[
    // LLM SDKs
    "anthropic",
    "anthropic-rs",
    "anthropic-sdk",
    "openai",
    "openai-rust",
    "openai-api-rs",
    "azure-openai",
    "google-genai",
    "genai",
    "tiktoken-rs",
    "rust-bert",
    "langchain-rust",
    // Workspace crates that ARE LLM clients — these depend on Anthropic/
    // model SDKs transitively. Including them here makes the structural
    // intent visible: even via path = "..." the validator must not pull
    // them in.
    "axiomregent",
    "agent",
    "provider-registry",
    "claude-code-bridge",
    // HTTP clients (model endpoints) — verbatim citation matching needs
    // no network access; banning HTTP makes accidental network reads
    // impossible.
    "reqwest",
    "ureq",
    "isahc",
    "hyper",
    "hyper-tls",
];

#[test]
fn no_llm_or_http_client_deps() {
    let cargo_toml = include_str!("../Cargo.toml");
    let parsed: toml::Value =
        toml::from_str(cargo_toml).expect("parse Cargo.toml");
    let mut violations: Vec<&str> = Vec::new();

    let deps = parsed
        .get("dependencies")
        .and_then(|v| v.as_table())
        .expect("[dependencies] table missing");
    for banned in BANNED_DEPS {
        if deps.contains_key(*banned) {
            violations.push(*banned);
        }
    }

    if let Some(dev) = parsed.get("dev-dependencies").and_then(|v| v.as_table())
    {
        for banned in BANNED_DEPS {
            if dev.contains_key(*banned) {
                violations.push(*banned);
            }
        }
    }

    assert!(
        violations.is_empty(),
        "spec 121 FR-001 violation — banned dependencies in provenance-validator: {violations:?}",
    );
}
