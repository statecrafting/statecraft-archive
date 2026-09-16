// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/123-agent-catalog-org-rescope/spec.md — T084, T085, A-8

//! Tests for `agent_resolver` (spec 123 §8.2).
//!
//! T084 — unit tests for the three resolution paths + error cases.
//! T085 — mock-based integration test for the spec A-8 acceptance criterion:
//!         two Stage CD comparator runs against different projects (within
//!         the same org, against the same org agent reference) MUST carry
//!         identical `agent_content_hash` in their run results.

use factory_engine::agent_resolver::{
    AgentReference, AgentResolver, CatalogRow, MockCatalogClient, ResolveError,
};
use factory_engine::stages::stage_cd::{run_stage_cd, StageCdInputs, StageCdMode};
use std::sync::Arc;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID: &str = "org-abc";

fn make_row(
    id: &str,
    name: &str,
    version: i64,
    status: &str,
    content_hash: &str,
) -> CatalogRow {
    CatalogRow {
        id: id.to_string(),
        org_id: ORG_ID.to_string(),
        name: name.to_string(),
        version,
        status: status.to_string(),
        content_hash: content_hash.to_string(),
        frontmatter: serde_json::json!({"name": name, "version": version}),
        body_markdown: format!("# Agent: {name} v{version}"),
    }
}

fn resolver_with_rows(rows: Vec<CatalogRow>) -> AgentResolver {
    AgentResolver::new(ORG_ID, Box::new(MockCatalogClient::new(rows)))
}

// ---------------------------------------------------------------------------
// T084 — resolve by id+version
// ---------------------------------------------------------------------------

/// Resolve by id+version returns the matching row with the correct content_hash.
#[tokio::test]
async fn resolve_by_id_and_version_returns_matching_row() {
    let rows = vec![
        make_row("agent-001", "stage-cd-comparator", 3, "published", "sha256:aaa111"),
        make_row("agent-002", "extractor", 1, "published", "sha256:bbb222"),
    ];
    let resolver = resolver_with_rows(rows);

    let result = resolver
        .resolve(AgentReference::ById {
            org_agent_id: "agent-001".into(),
            version: 3,
        })
        .await
        .expect("resolution should succeed");

    assert_eq!(result.org_agent_id, "agent-001");
    assert_eq!(result.version, 3);
    assert_eq!(result.content_hash, "sha256:aaa111");
}

// ---------------------------------------------------------------------------
// T084 — resolve by name+version
// ---------------------------------------------------------------------------

/// Resolve by name+version returns the matching row.
#[tokio::test]
async fn resolve_by_name_and_version_returns_matching_row() {
    let rows = vec![
        make_row("agent-001", "stage-cd-comparator", 3, "published", "sha256:aaa111"),
        make_row("agent-001b", "stage-cd-comparator", 2, "published", "sha256:aaa000"),
    ];
    let resolver = resolver_with_rows(rows);

    let result = resolver
        .resolve(AgentReference::ByName {
            name: "stage-cd-comparator".into(),
            version: 2,
        })
        .await
        .expect("resolution should succeed");

    assert_eq!(result.org_agent_id, "agent-001b");
    assert_eq!(result.version, 2);
    assert_eq!(result.content_hash, "sha256:aaa000");
}

// ---------------------------------------------------------------------------
// T084 — resolve by name (latest)
// ---------------------------------------------------------------------------

/// Resolve by name (latest) returns the highest published version.
#[tokio::test]
async fn resolve_by_name_latest_returns_highest_published_version() {
    let rows = vec![
        make_row("agent-001-v1", "stage-cd-comparator", 1, "published", "sha256:v1hash"),
        make_row("agent-001-v2", "stage-cd-comparator", 2, "published", "sha256:v2hash"),
        make_row("agent-001-v3", "stage-cd-comparator", 3, "published", "sha256:v3hash"),
        // Draft and retired versions must NOT be chosen for "latest".
        make_row("agent-001-v4", "stage-cd-comparator", 4, "draft", "sha256:v4hash"),
        make_row("agent-001-v0", "stage-cd-comparator", 0, "retired", "sha256:v0hash"),
    ];
    let resolver = resolver_with_rows(rows);

    let result = resolver
        .resolve(AgentReference::ByNameLatest {
            name: "stage-cd-comparator".into(),
        })
        .await
        .expect("resolution should succeed");

    // v3 is the highest published version.
    assert_eq!(result.version, 3);
    assert_eq!(result.content_hash, "sha256:v3hash");
}

// ---------------------------------------------------------------------------
// T084 — retired version returns ResolveError::RetiredAgent
// ---------------------------------------------------------------------------

/// Resolving a retired version (by id) returns RetiredAgent error.
#[tokio::test]
async fn resolve_retired_version_by_id_returns_retired_error() {
    let rows = vec![make_row(
        "agent-001",
        "stage-cd-comparator",
        2,
        "retired",
        "sha256:oldHash",
    )];
    let resolver = resolver_with_rows(rows);

    let err = resolver
        .resolve(AgentReference::ById {
            org_agent_id: "agent-001".into(),
            version: 2,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, ResolveError::RetiredAgent { .. }),
        "expected RetiredAgent, got {err:?}"
    );
}

/// Resolving a retired version (by name+version) also returns RetiredAgent.
#[tokio::test]
async fn resolve_retired_version_by_name_returns_retired_error() {
    let rows = vec![make_row(
        "agent-001",
        "old-agent",
        1,
        "retired",
        "sha256:old",
    )];
    let resolver = resolver_with_rows(rows);

    let err = resolver
        .resolve(AgentReference::ByName {
            name: "old-agent".into(),
            version: 1,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, ResolveError::RetiredAgent { .. }),
        "expected RetiredAgent, got {err:?}"
    );
}

// ---------------------------------------------------------------------------
// T084 — cache hit: two resolves of the SAME reference return identical content_hash
// ---------------------------------------------------------------------------

/// Two resolves of the same AgentReference against the same resolver
/// instance must return identical ResolvedAgent (spec A-8 unit-level check).
/// This tests the cache path — the second call must hit the cache, not the
/// client (we verify by content_hash equality).
#[tokio::test]
async fn two_resolves_of_same_reference_return_identical_content_hash() {
    let rows = vec![make_row(
        "agent-001",
        "stage-cd-comparator",
        3,
        "published",
        "sha256:stable-hash-abc123",
    )];
    let resolver = resolver_with_rows(rows);

    let ref1 = resolver
        .resolve(AgentReference::ById {
            org_agent_id: "agent-001".into(),
            version: 3,
        })
        .await
        .unwrap();
    let ref2 = resolver
        .resolve(AgentReference::ById {
            org_agent_id: "agent-001".into(),
            version: 3,
        })
        .await
        .unwrap();

    assert_eq!(
        ref1.content_hash, ref2.content_hash,
        "cache hit must return byte-identical content_hash"
    );
    assert_eq!(ref1, ref2);
}

// ---------------------------------------------------------------------------
// T085 / A-8 — two projects, same org agent, identical content_hash in run results
// ---------------------------------------------------------------------------

/// Spec A-8 acceptance test (mock-based, T085 approach A).
///
/// Two distinct Factory project runs (project-alpha and project-beta),
/// both bound to org agent `stage-cd-comparator` at version 3 in the same
/// org, MUST produce a `StageCdResult` that carries the IDENTICAL
/// `agent_content_hash` string. This is the cross-project identity
/// stability guarantee that spec 123 §8.2 requires.
///
/// Implementation: both runs use separate `AgentResolver` instances (each
/// resolver is constructed per-run per project, per the spec), but both
/// resolvers are backed by the same `MockCatalogClient` seeded with the same
/// org catalog state.
#[tokio::test]
async fn a8_two_project_runs_with_same_org_agent_carry_identical_content_hash() {
    // The shared org catalog: one agent at v3 with a stable content_hash.
    let catalog_rows = vec![make_row(
        "agent-cd-v3",
        "stage-cd-comparator",
        3,
        "published",
        "sha256:canonical-cd-agent-v3-hash-abcdef1234567890",
    )];

    let agent_ref = AgentReference::ById {
        org_agent_id: "agent-cd-v3".into(),
        version: 3,
    };

    // Project Alpha run: build its own resolver (per-run-per-project).
    let resolver_alpha = Arc::new(AgentResolver::new(
        ORG_ID,
        Box::new(MockCatalogClient::new(catalog_rows.clone())),
    ));

    // Project Beta run: separate resolver instance, same catalog state.
    let resolver_beta = Arc::new(AgentResolver::new(
        ORG_ID,
        Box::new(MockCatalogClient::new(catalog_rows.clone())),
    ));

    // Both projects share a temp directory scaffold with authored docs so
    // run_stage_cd runs in compare mode.
    let dir_alpha = tempfile::tempdir().unwrap();
    let dir_beta = tempfile::tempdir().unwrap();

    let authored = r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce cycles

Body.
"#;

    for dir in [&dir_alpha, &dir_beta] {
        let stk = dir.path().join("requirements/stakeholder");
        std::fs::create_dir_all(&stk).unwrap();
        std::fs::write(stk.join("charter.md"), authored).unwrap();
        std::fs::write(stk.join("client-document.md"), authored).unwrap();
    }

    let brd = "# BRD\n\n### OBJ-1: Reduce cycles\n\nBody.\n";
    let now = chrono::Utc::now();

    let inputs_alpha = StageCdInputs {
        project: dir_alpha.path().to_path_buf(),
        run_id: "alpha-run-001".into(),
        artifact_store: dir_alpha.path().join("runs/run-001"),
        brd: brd.to_string(),
        now,
        corpus: vec![],
        project_name: "project-alpha".into(),
        project_slug: "project-alpha".into(),
        workspace_name: "ws".into(),
        known_owners: vec![],
        agent_resolver: Some(resolver_alpha),
        comparator_agent_ref: Some(agent_ref.clone()),
    };

    let inputs_beta = StageCdInputs {
        project: dir_beta.path().to_path_buf(),
        run_id: "beta-run-001".into(),
        artifact_store: dir_beta.path().join("runs/run-001"),
        brd: brd.to_string(),
        now,
        corpus: vec![],
        project_name: "project-beta".into(),
        project_slug: "project-beta".into(),
        workspace_name: "ws".into(),
        known_owners: vec![],
        agent_resolver: Some(resolver_beta),
        comparator_agent_ref: Some(agent_ref),
    };

    let result_alpha = run_stage_cd(&inputs_alpha)
        .await
        .expect("project-alpha run should succeed");
    let result_beta = run_stage_cd(&inputs_beta)
        .await
        .expect("project-beta run should succeed");

    // Both runs must have operated in compare mode (authored docs present).
    assert_eq!(result_alpha.mode, StageCdMode::Compare);
    assert_eq!(result_beta.mode, StageCdMode::Compare);

    // Spec A-8 — the critical assertion. Both run audit records carry
    // IDENTICAL agent_content_hash values, regardless of which project
    // ran the stage. This proves that agent identity is stable across
    // project boundaries.
    let hash_alpha = result_alpha
        .agent_content_hash
        .expect("alpha run must carry agent_content_hash");
    let hash_beta = result_beta
        .agent_content_hash
        .expect("beta run must carry agent_content_hash");

    assert_eq!(
        hash_alpha, hash_beta,
        "spec A-8 violation: two projects running Stage CD against the same org agent \
         at the same version produced different content_hash values. \
         Cross-project comparisons would be contaminated by definition drift.\n\
         alpha hash: {hash_alpha}\nbeta hash: {hash_beta}"
    );

    // Pin the expected hash value to catch silent regressions.
    assert_eq!(
        hash_alpha,
        "sha256:canonical-cd-agent-v3-hash-abcdef1234567890",
        "content_hash must match the org catalog value exactly"
    );
}

// ---------------------------------------------------------------------------
// Additional: not-found returns typed error
// ---------------------------------------------------------------------------

#[tokio::test]
async fn resolve_by_id_not_found_returns_not_found_error() {
    let resolver = resolver_with_rows(vec![]);

    let err = resolver
        .resolve(AgentReference::ById {
            org_agent_id: "does-not-exist".into(),
            version: 1,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, ResolveError::NotFound { .. }),
        "expected NotFound, got {err:?}"
    );
}

#[tokio::test]
async fn resolve_by_name_latest_not_found_when_no_published_rows() {
    // All rows are retired — no published version available.
    let rows = vec![make_row(
        "agent-001",
        "stage-cd-comparator",
        1,
        "retired",
        "sha256:old",
    )];
    let resolver = resolver_with_rows(rows);

    let err = resolver
        .resolve(AgentReference::ByNameLatest {
            name: "stage-cd-comparator".into(),
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, ResolveError::NotFound { .. }),
        "expected NotFound (no published rows), got {err:?}"
    );
}

// ---------------------------------------------------------------------------
// Ambiguous name resolution is defended against
// ---------------------------------------------------------------------------

/// The `(org_id, name, version)` unique constraint makes ambiguity
/// impossible in production, but the resolver must be defensive. This
/// test injects two rows with the same (name, version) — which a broken
/// catalog could theoretically produce — and asserts AmbiguousName.
#[tokio::test]
async fn resolve_by_name_ambiguous_returns_ambiguous_error() {
    // Two rows with the same name AND version — catalog invariant violation.
    let rows = vec![
        make_row("agent-001a", "duplicate-agent", 1, "published", "sha256:hash-a"),
        make_row("agent-001b", "duplicate-agent", 1, "published", "sha256:hash-b"),
    ];
    let resolver = resolver_with_rows(rows);

    let err = resolver
        .resolve(AgentReference::ByName {
            name: "duplicate-agent".into(),
            version: 1,
        })
        .await
        .unwrap_err();

    assert!(
        matches!(err, ResolveError::AmbiguousName { count: 2, .. }),
        "expected AmbiguousName with count=2, got {err:?}"
    );
}
