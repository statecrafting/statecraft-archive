// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/139-factory-artifact-substrate/spec.md — T060
//
// Phase 3 — VirtualRoot fetch + cache + integrity-check tests.
//
// Drives the `VirtualRoot` materialiser against an `InMemoryArtifactFetcher`
// (no real HTTP needed for the contract tests). The production HTTP-backed
// fetcher lives in `virtual_root::HttpArtifactFetcher`; the trait abstraction
// keeps the cache + integrity-check logic exercisable in isolation.
//
// **Halt condition (per Phase 3 directive):** if the cache integrity check
// fails to fire on a body whose hash drifts from the manifest, the spec's
// audit primitive (SC-003 / SC-005) is unattainable.

use factory_engine::virtual_root::{
    ArtifactRef, InMemoryArtifactFetcher, VirtualRoot, VirtualRootError,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

const ORG_ID: &str = "00000000-0000-0000-0000-000000000099";

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

fn make_fetcher(
    bodies: &[(&str, &str, &str, &str)], // (origin, path, content, version)
) -> (Arc<InMemoryArtifactFetcher>, Vec<ArtifactRef>) {
    let mut store = HashMap::new();
    let mut manifest = Vec::new();
    for (origin, path, body, version) in bodies {
        let hash = sha256_hex(body);
        store.insert((origin.to_string(), path.to_string()), body.to_string());
        manifest.push(ArtifactRef {
            artifact_id: format!("art-{}-{}", origin, path).replace('/', "-"),
            origin: origin.to_string(),
            path: path.to_string(),
            version: version.parse().unwrap_or(1),
            content_hash: hash,
        });
    }
    (Arc::new(InMemoryArtifactFetcher::new(manifest.clone(), store)), manifest)
}

#[tokio::test]
async fn materialises_artifacts_into_cache_dir() {
    let (fetcher, _manifest) = make_fetcher(&[
        ("legacy-factory", "Factory Agent/factory-orchestration.md", "root body", "1"),
        ("template", "orchestration/template-orchestrator.md", "tpl body", "1"),
    ]);
    let cache_dir = TempDir::new().unwrap();
    let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), fetcher.clone());

    vr.materialize().await.expect("materialize succeeds");

    // The local cache root materialises every manifest entry, keyed by
    // (origin, path). The engine reads them as if they were on-disk.
    let local = vr.local_path();
    let body1 = tokio::fs::read_to_string(
        local.join("legacy-factory/Factory Agent/factory-orchestration.md"),
    )
    .await
    .expect("file present in cache");
    assert_eq!(body1, "root body");
    let body2 = tokio::fs::read_to_string(
        local.join("template/orchestration/template-orchestrator.md"),
    )
    .await
    .expect("file present in cache");
    assert_eq!(body2, "tpl body");
}

#[tokio::test]
async fn cache_integrity_check_rejects_hash_drift() {
    // Manifest claims hash X, fetcher returns body that hashes to Y.
    // VirtualRoot must refuse — failing loudly is the spec's audit
    // primitive (SC-003).
    let bad_manifest = vec![ArtifactRef {
        artifact_id: "art-1".into(),
        origin: "legacy-factory".into(),
        path: "Factory Agent/factory-orchestration.md".into(),
        version: 1,
        // Wrong hash on purpose — does NOT match the body the fetcher returns.
        content_hash: "deadbeef".repeat(8),
    }];
    let mut store = HashMap::new();
    store.insert(
        (
            "legacy-factory".to_string(),
            "Factory Agent/factory-orchestration.md".to_string(),
        ),
        "real body".to_string(),
    );
    let fetcher = Arc::new(InMemoryArtifactFetcher::new(bad_manifest, store));
    let cache_dir = TempDir::new().unwrap();
    let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), fetcher);

    let err = vr.materialize().await.expect_err("hash drift must error");
    match err {
        VirtualRootError::HashMismatch { .. } => {}
        other => panic!("expected HashMismatch, got {other:?}"),
    }
}

#[tokio::test]
async fn cache_hit_skips_refetch() {
    let (fetcher, _manifest) = make_fetcher(&[
        ("legacy-factory", "a.md", "alpha", "1"),
    ]);
    let cache_dir = TempDir::new().unwrap();
    let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), fetcher.clone());

    vr.materialize().await.unwrap();
    let calls_after_first = fetcher.fetch_calls();

    // Second materialise must not re-fetch since the cache entry's hash matches.
    vr.materialize().await.unwrap();
    let calls_after_second = fetcher.fetch_calls();
    assert_eq!(calls_after_first, calls_after_second);
}

#[tokio::test]
async fn read_artifact_returns_effective_body_by_origin_path() {
    let (fetcher, _manifest) = make_fetcher(&[
        ("oap-self", "adapters/acme-vue-encore/manifest.yaml", "manifest content", "1"),
    ]);
    let cache_dir = TempDir::new().unwrap();
    let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), fetcher);

    vr.materialize().await.unwrap();

    let body = vr
        .read_artifact("oap-self", "adapters/acme-vue-encore/manifest.yaml")
        .await
        .expect("artifact resolves");
    assert_eq!(body, "manifest content");
}
