// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-007

//! Lint: `artifact-extract` MUST NOT depend on any LLM client crate or
//! HTTP client. Failure here is a workflow violation; the deterministic
//! extractor is contractually offline (FR-007).

const BANNED_DEPS: &[&str] = &[
    // LLM SDKs
    "anthropic",
    "anthropic-rs",
    "anthropic-sdk",
    "openai",
    "openai-rust",
    "azure-openai",
    "google-genai",
    "genai",
    "tiktoken-rs",
    "rust-bert",
    "langchain-rust",
    // HTTP clients (model endpoints) — none are needed by the deterministic
    // extractors and the spec forbids reqwest-equivalent direct deps.
    "reqwest",
    "ureq",
    "isahc",
    "hyper",
    "hyper-tls",
];

#[test]
fn no_llm_or_http_client_deps() {
    let cargo_toml = include_str!("../Cargo.toml");
    let parsed: toml::Value = toml::from_str(cargo_toml).expect("parse Cargo.toml");
    let deps = parsed
        .get("dependencies")
        .and_then(|v| v.as_table())
        .expect("[dependencies] table missing");
    let mut violations: Vec<&str> = Vec::new();
    for banned in BANNED_DEPS {
        if deps.contains_key(*banned) {
            violations.push(*banned);
        }
    }
    assert!(
        violations.is_empty(),
        "spec 120 FR-007 violation — banned dependencies in artifact-extract: {violations:?}",
    );
}
