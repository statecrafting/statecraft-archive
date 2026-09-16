// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md — T044, T045

//! Mock-server tests for `PlatformClient` (T044) and `materialise_run_root`
//! (T043) — covers the warm/cold cache paths and the partial-failure
//! cleanup invariant.
//!
//! The integration leg gated on `OAP_INTEGRATION=1` (T045) lives at the
//! bottom of this file behind a `#[cfg(...)]`-equivalent runtime gate;
//! when the env var is unset the integration test is a no-op.

use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use async_trait::async_trait;
use factory_engine::agent_resolver::{
    AgentResolver, CatalogClient, CatalogClientError, CatalogRow,
};
use factory_platform_client::{
    cache_root_for, FactoryClientError, OidcTokenProvider, PlatformClient,
    ReserveRunRequest, RunReservation, StaticTokenProvider,
};
use serde_json::json;
use wiremock::{
    matchers::{header, method, path},
    Mock, MockServer, ResponseTemplate,
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/// Process-wide lock serialising every test that mutates `XDG_CACHE_HOME`.
/// Mirrors the `ENV_LOCK` pattern in `src/cache_root.rs` — set_var is
/// global, so concurrent tests calling `isolate_cache_dir()` would race
/// on the env var and on the content-addressed cache paths it controls.
/// Held by `EnvScope` for the lifetime of each test.
fn env_lock() -> &'static Mutex<()> {
    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_LOCK.get_or_init(|| Mutex::new(()))
}

/// RAII bundle: holds the `ENV_LOCK` guard for the lifetime of the test
/// and owns the `TempDir` that backs `XDG_CACHE_HOME`. Drop order is
/// guard-then-tempdir which is fine — the next test waits on the lock
/// before touching the env var, so the tempdir of the prior test is
/// always already dropped by the time the next set_var fires.
struct EnvScope {
    _guard: MutexGuard<'static, ()>,
    _dir: tempfile::TempDir,
}

/// Set XDG_CACHE_HOME to a fresh temp directory so the materialiser writes
/// inside the test's scratch space — no leakage across test runs and no
/// dependency on the host's real cache directory. The returned `EnvScope`
/// MUST be bound for the duration of the test (e.g. `let _scratch = …`);
/// dropping it early releases the env-lock and any subsequent test would
/// race on `XDG_CACHE_HOME`.
fn isolate_cache_dir() -> EnvScope {
    // Recover from poisoning: if a prior test panicked while holding the
    // lock, std::sync::Mutex marks it poisoned and `lock()` returns Err.
    // Tests should still be able to run — the poison only signals that
    // some earlier test panicked, not that the data is corrupt.
    let guard = env_lock().lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("tempdir");
    // SAFETY: ENV_LOCK above serialises every env-mutating test in this
    // file. The wiremock test runtime is multi-threaded, but the lock
    // ensures no two tests touch XDG_CACHE_HOME concurrently.
    unsafe {
        std::env::set_var("XDG_CACHE_HOME", dir.path());
    }
    EnvScope {
        _guard: guard,
        _dir: dir,
    }
}

fn provider() -> Arc<dyn OidcTokenProvider> {
    Arc::new(StaticTokenProvider("test-token".to_string()))
}

// ---------------------------------------------------------------------------
// REST-surface tests (T042 + T044)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_adapter_round_trips_and_sends_bearer_auth() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/factory/adapters/spec124-rest"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "spec124-rest",
            "version": "v1",
            "sourceSha": "ada-sha-1",
            "syncedAt": "2026-05-01T12:00:00Z",
            "manifest": { "kind": "adapter", "stages": [] }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let body = client.get_adapter("spec124-rest").await.unwrap();
    assert_eq!(body.name, "spec124-rest");
    assert_eq!(body.source_sha, "ada-sha-1");
    assert_eq!(body.manifest["kind"], "adapter");
}

#[tokio::test]
async fn list_processes_round_trips_and_unwraps_envelope() {
    // Spec 124 §6.2 — the desktop resolves the default process from the
    // platform's process list (no client-baked name). `list_processes`
    // hits the un-parameterised `/api/factory/processes` endpoint and
    // unwraps the `{ processes: [...] }` envelope.
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/factory/processes"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "processes": [
                { "name": "7-stage-build", "version": "v1", "sourceSha": "proc-sha-1", "syncedAt": "2026-05-01T12:00:00Z" }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let processes = client.list_processes().await.unwrap();
    assert_eq!(processes.len(), 1);
    assert_eq!(processes[0].name, "7-stage-build");
    assert_eq!(processes[0].source_sha, "proc-sha-1");
}

#[tokio::test]
async fn list_adapters_round_trips_and_unwraps_envelope() {
    // Spec 124 §6.2 — the desktop populates its adapter picker from the
    // platform's adapter list (no client-baked set). `list_adapters` hits the
    // un-parameterised `/api/factory/adapters` endpoint and unwraps the
    // `{ adapters: [...] }` envelope. The first row carries the optional
    // synthesised `id`, the second omits it — exercising the
    // `#[serde(default)]` on `AdapterSummary::id` in both directions.
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/factory/adapters"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "adapters": [
                {
                    "id": "org-1:acme-vue-encore",
                    "name": "acme-vue-encore",
                    "version": "v1",
                    "sourceSha": "ada-sha-1",
                    "syncedAt": "2026-05-01T12:00:00Z"
                },
                {
                    "name": "second-adapter",
                    "version": "v2",
                    "sourceSha": "ada-sha-2",
                    "syncedAt": "2026-05-01T12:00:00Z"
                }
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let adapters = client.list_adapters().await.unwrap();
    assert_eq!(adapters.len(), 2);
    assert_eq!(adapters[0].name, "acme-vue-encore");
    assert_eq!(adapters[0].id.as_deref(), Some("org-1:acme-vue-encore"));
    assert_eq!(adapters[0].source_sha, "ada-sha-1");
    assert_eq!(adapters[1].name, "second-adapter");
    assert_eq!(adapters[1].id, None);
    assert_eq!(adapters[1].source_sha, "ada-sha-2");
}

#[tokio::test]
async fn reserve_run_posts_camel_case_body_and_decodes_response() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/factory/runs"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "runId": "r-1",
            "sourceShas": {
                "adapter": "ada-sha-1",
                "process": "proc-sha-1",
                "contracts": {},
                "agents": [
                    {
                        "orgAgentId": "ag-1",
                        "version": 1,
                        "contentHash": "h-ag-1"
                    }
                ]
            },
            "reserved": true
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let res = client
        .reserve_run(ReserveRunRequest {
            adapter_name: "spec124-rest".into(),
            process_name: "proc".into(),
            project_id: Some("p-1".into()),
            client_run_id: "cli-1".into(),
        })
        .await
        .unwrap();
    assert_eq!(res.run_id, "r-1");
    assert!(res.reserved);
    assert_eq!(res.source_shas.agents.len(), 1);
    assert_eq!(res.source_shas.agents[0].org_agent_id, "ag-1");
}

#[tokio::test]
async fn reserve_run_412_surfaces_as_retired_agent() {
    let server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/api/factory/runs"))
        .respond_with(ResponseTemplate::new(412).set_body_string(
            r#"agent "extract" (ag-1 v3) is retired upstream"#,
        ))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let err = client
        .reserve_run(ReserveRunRequest {
            adapter_name: "ada".into(),
            process_name: "proc".into(),
            project_id: None,
            client_run_id: "cli-1".into(),
        })
        .await
        .unwrap_err();
    match err {
        FactoryClientError::RetiredAgent(m) => {
            assert!(m.contains("retired upstream"));
        }
        other => panic!("expected RetiredAgent, got {other:?}"),
    }
}

#[tokio::test]
async fn get_run_404_surfaces_as_not_found() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/factory/runs/nope"))
        .respond_with(ResponseTemplate::new(404).set_body_string("run not found"))
        // GETs retry transient errors but NOT 404s — exactly one call.
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let err = client.get_run("nope").await.unwrap_err();
    assert!(matches!(err, FactoryClientError::NotFound(_)));
}

#[tokio::test]
async fn get_adapter_retries_on_5xx_then_succeeds() {
    let server = MockServer::start().await;
    // First call: 503. Subsequent: 200. The retry helper attempts up to
    // three times — wiremock does not coordinate sequencing across mocks
    // by default; instead we use `up_to_n_times` to scope the failure.
    Mock::given(method("GET"))
        .and(path("/api/factory/adapters/transient"))
        .respond_with(ResponseTemplate::new(503).set_body_string("flap"))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/factory/adapters/transient"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "transient",
            "version": "v1",
            "sourceSha": "s",
            "syncedAt": "2026-05-01T12:00:00Z",
            "manifest": {}
        })))
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let body = client.get_adapter("transient").await.unwrap();
    assert_eq!(body.name, "transient");
}

#[tokio::test]
async fn catalog_client_list_agents_uses_org_path_and_unwraps_envelope() {
    let server = MockServer::start().await;

    Mock::given(method("GET"))
        .and(path("/api/orgs/org-1/agents"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "agents": [{
                "id": "ag-1",
                "org_id": "org-1",
                "name": "extract",
                "version": 1,
                "status": "published",
                "content_hash": "h-1",
                "frontmatter": {},
                "body_markdown": "# extract"
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = PlatformClient::new(server.uri(), provider());
    let agents: Vec<CatalogRow> =
        <PlatformClient as CatalogClient>::list_agents(&client, "org-1")
            .await
            .unwrap();
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].name, "extract");
}

// ---------------------------------------------------------------------------
// materialise_run_root (T043) — cold cache, warm cache, partial-failure
// ---------------------------------------------------------------------------

fn process_def_with_one_agent() -> serde_json::Value {
    json!({
        "stages": [
            {
                "id": "s0",
                "agent_ref": { "by_name_latest": { "name": "extract" } }
            }
        ]
    })
}

async fn mount_minimal_factory_endpoints(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/api/factory/adapters/spec124-rest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "spec124-rest",
            "version": "v1",
            "sourceSha": "ada-sha-1",
            "syncedAt": "2026-05-01T12:00:00Z",
            "manifest": { "kind": "adapter", "schema_version": "1.0.0" }
        })))
        .mount(server)
        .await;

    Mock::given(method("GET"))
        .and(path("/api/factory/processes/proc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "proc",
            "version": "v1",
            "sourceSha": "proc-sha-1",
            "syncedAt": "2026-05-01T12:00:00Z",
            "definition": process_def_with_one_agent()
        })))
        .mount(server)
        .await;
}

/// In-process catalog stub for the resolver.
struct StaticCatalog {
    rows: Vec<CatalogRow>,
}

#[async_trait]
impl CatalogClient for StaticCatalog {
    async fn list_agents(
        &self,
        _: &str,
    ) -> Result<Vec<CatalogRow>, CatalogClientError> {
        Ok(self.rows.clone())
    }
    async fn get_agent(
        &self,
        org_id: &str,
        org_agent_id: &str,
    ) -> Result<CatalogRow, CatalogClientError> {
        self.rows
            .iter()
            .find(|r| r.org_id == org_id && r.id == org_agent_id)
            .cloned()
            .ok_or_else(|| CatalogClientError::NotFound {
                org_id: org_id.into(),
                id: org_agent_id.into(),
            })
    }
}

fn reservation_for_extract_at(content_hash: &str) -> RunReservation {
    serde_json::from_value(json!({
        "runId": "r-1",
        "sourceShas": {
            "adapter": "ada-sha-1",
            "process": "proc-sha-1",
            "contracts": {},
            "agents": [
                {
                    "orgAgentId": "ag-1",
                    "version": 1,
                    "contentHash": content_hash
                }
            ]
        },
        "reserved": true
    }))
    .unwrap()
}

fn published_extract_row(content_hash: &str) -> CatalogRow {
    CatalogRow {
        id: "ag-1".into(),
        org_id: "org-1".into(),
        name: "extract".into(),
        version: 1,
        status: "published".into(),
        content_hash: content_hash.into(),
        frontmatter: json!({ "name": "extract", "kind": "agent" }),
        body_markdown: "# extract\nbody".into(),
    }
}

#[tokio::test]
async fn materialise_run_root_cold_cache_writes_layout() {
    let _scratch = isolate_cache_dir();
    let server = MockServer::start().await;
    mount_minimal_factory_endpoints(&server).await;
    let client = PlatformClient::new(server.uri(), provider());

    let resolver = AgentResolver::new(
        "org-1",
        Box::new(StaticCatalog {
            rows: vec![published_extract_row("h-1")],
        }),
    );

    let reservation = reservation_for_extract_at("h-1");
    let root = client
        .materialise_run_root(&reservation, "spec124-rest", "proc", &resolver)
        .await
        .unwrap();

    assert!(!root.warm);
    let p = &root.path;
    assert!(p.join("adapters/spec124-rest/manifest.yaml").is_file());
    assert!(p.join("process/manifest.yaml").is_file());
    assert!(p.join("process/agents/extract.md").is_file());
    assert!(p.join("adapters/spec124-rest/agents/extract.md").is_file());
}

#[tokio::test]
async fn materialise_run_root_warm_cache_skips_fetches() {
    let _scratch = isolate_cache_dir();
    let server = MockServer::start().await;
    mount_minimal_factory_endpoints(&server).await;
    let client = PlatformClient::new(server.uri(), provider());

    let resolver = AgentResolver::new(
        "org-1",
        Box::new(StaticCatalog {
            rows: vec![published_extract_row("h-1")],
        }),
    );

    let reservation = reservation_for_extract_at("h-1");

    // First call populates the directory.
    let first = client
        .materialise_run_root(&reservation, "spec124-rest", "proc", &resolver)
        .await
        .unwrap();
    assert!(!first.warm);

    // Second call MUST observe the warm cache and not hit the server.
    // We tear down the mock so any HTTP attempt returns a connection error.
    drop(server);

    let second = client
        .materialise_run_root(&reservation, "spec124-rest", "proc", &resolver)
        .await
        .unwrap();
    assert!(second.warm);
    assert_eq!(second.path, first.path);
    assert_eq!(second.path, cache_root_for(&reservation.source_shas.into()));
}

#[tokio::test]
async fn materialise_run_root_aborts_on_agent_drift() {
    let _scratch = isolate_cache_dir();
    let server = MockServer::start().await;
    mount_minimal_factory_endpoints(&server).await;
    let client = PlatformClient::new(server.uri(), provider());

    // Resolver returns h-X; reservation says h-1 — drift.
    let resolver = AgentResolver::new(
        "org-1",
        Box::new(StaticCatalog {
            rows: vec![published_extract_row("h-X")],
        }),
    );

    let reservation = reservation_for_extract_at("h-1");
    let err = client
        .materialise_run_root(&reservation, "spec124-rest", "proc", &resolver)
        .await
        .unwrap_err();
    match err {
        FactoryClientError::AgentDrift(m) => {
            assert!(m.contains("h-X"));
        }
        other => panic!("expected AgentDrift, got {other:?}"),
    }
    // Drift: no half-built cache directory remains.
    let final_path =
        cache_root_for(&reservation.source_shas.clone().into());
    assert!(
        !final_path.exists(),
        "drift must NOT leave a directory behind at {final_path:?}",
    );
}

#[tokio::test]
async fn materialise_run_root_aborts_on_retired_agent_resolver() {
    let _scratch = isolate_cache_dir();
    let server = MockServer::start().await;
    // Use a process definition with `by_name` (not `by_name_latest`) so the
    // resolver consults the row directly and surfaces RetiredAgent. The
    // `by_name_latest` path filters published rows up-front and would
    // surface NotFound — a different failure mode.
    Mock::given(method("GET"))
        .and(path("/api/factory/adapters/spec124-rest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "spec124-rest",
            "version": "v1",
            "sourceSha": "ada-sha-1",
            "syncedAt": "2026-05-01T12:00:00Z",
            "manifest": { "kind": "adapter" }
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/factory/processes/proc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "proc",
            "version": "v1",
            "sourceSha": "proc-sha-1",
            "syncedAt": "2026-05-01T12:00:00Z",
            "definition": {
                "stages": [{
                    "id": "s0",
                    "agent_ref": { "by_name": { "name": "extract", "version": 1 } }
                }]
            }
        })))
        .mount(&server)
        .await;
    let client = PlatformClient::new(server.uri(), provider());

    let mut row = published_extract_row("h-1");
    row.status = "retired".into();
    let resolver =
        AgentResolver::new("org-1", Box::new(StaticCatalog { rows: vec![row] }));

    let reservation = reservation_for_extract_at("h-1");
    let err = client
        .materialise_run_root(&reservation, "spec124-rest", "proc", &resolver)
        .await
        .unwrap_err();
    assert!(
        matches!(err, FactoryClientError::RetiredAgent(_)),
        "expected RetiredAgent, got {err:?}",
    );
    let final_path = cache_root_for(&reservation.source_shas.into());
    assert!(!final_path.exists());
}

// ---------------------------------------------------------------------------
// T045 — integration leg gated on OAP_INTEGRATION=1
// ---------------------------------------------------------------------------

#[tokio::test]
async fn integration_smoke_localhost_4000() {
    if std::env::var("OAP_INTEGRATION").ok().as_deref() != Some("1") {
        return;
    }
    // Real-token fixture must be set by the operator before running.
    let token = std::env::var("OAP_TEST_TOKEN").expect("OAP_TEST_TOKEN");
    let provider: Arc<dyn OidcTokenProvider> =
        Arc::new(StaticTokenProvider(token));
    let client = PlatformClient::new("http://localhost:4000", provider);
    // Trivial smoke — list returns a (possibly empty) JSON envelope.
    let _ = client.get_adapter("nonexistent-adapter").await;
}
