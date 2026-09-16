// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/139-factory-artifact-substrate/spec.md — T062
//
// Phase 3 — VirtualRoot offline cache test (SC-005 load-bearing).
//
// Pre-populates the cache directory; asserts VirtualRoot reads succeed
// without ever calling the fetcher (i.e. the cache is sufficient for
// replay even with no network reachability).

use factory_engine::virtual_root::{
    ArtifactRef, InMemoryArtifactFetcher, VirtualRoot,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use tempfile::TempDir;

const ORG_ID: &str = "22222222-0000-0000-0000-000000000099";

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

#[tokio::test]
async fn cache_warm_reads_succeed_with_empty_fetcher() {
    let body = "warm cache body";
    let hash = sha256_hex(body);

    // Phase 1: warm the cache with a real fetcher.
    let cache_dir = TempDir::new().unwrap();
    let manifest = vec![ArtifactRef {
        artifact_id: "art-warm".into(),
        origin: "oap-self".into(),
        path: "adapters/acme-vue-encore/manifest.yaml".into(),
        version: 1,
        content_hash: hash.clone(),
    }];
    {
        let mut store = HashMap::new();
        store.insert(
            (
                "oap-self".to_string(),
                "adapters/acme-vue-encore/manifest.yaml".to_string(),
            ),
            body.to_string(),
        );
        let warm_fetcher = Arc::new(InMemoryArtifactFetcher::new(manifest.clone(), store));
        let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), warm_fetcher);
        vr.materialize().await.unwrap();
    }

    // Phase 2: open VirtualRoot with an EMPTY fetcher store. Reads must
    // still succeed because the cache is warm.
    {
        let empty_fetcher = Arc::new(InMemoryArtifactFetcher::new(
            manifest.clone(),
            HashMap::new(),
        ));
        let calls_before = empty_fetcher.fetch_calls();
        let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), empty_fetcher.clone());

        let body_read = vr
            .read_artifact("oap-self", "adapters/acme-vue-encore/manifest.yaml")
            .await
            .expect("offline read succeeds");
        assert_eq!(body_read, body);
        assert_eq!(
            empty_fetcher.fetch_calls(),
            calls_before,
            "offline read must not invoke the fetcher",
        );
    }
}

#[tokio::test]
async fn missing_cache_entry_with_empty_fetcher_errors_clearly() {
    // Cache is empty AND the fetcher is empty — read must error rather
    // than return a default. Defensive against silent loss of audit
    // primitives.
    let cache_dir = TempDir::new().unwrap();
    let manifest = vec![ArtifactRef {
        artifact_id: "missing".into(),
        origin: "oap-self".into(),
        path: "missing.md".into(),
        version: 1,
        content_hash: sha256_hex("doesn't matter"),
    }];
    let empty_fetcher = Arc::new(InMemoryArtifactFetcher::new(manifest, HashMap::new()));
    let vr = VirtualRoot::new(ORG_ID, cache_dir.path().to_path_buf(), empty_fetcher);

    let err = vr
        .read_artifact("oap-self", "missing.md")
        .await
        .expect_err("missing artifact must error");
    let msg = format!("{err}");
    assert!(
        msg.contains("not found") || msg.contains("missing"),
        "error message should name the missing artifact: {msg}"
    );
}
