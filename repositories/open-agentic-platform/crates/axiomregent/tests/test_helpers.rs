// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//! Shared test helpers for axiomregent integration tests.

use axiomregent::lease::LeaseStore;
use axiomregent::router::Router;
use axiomregent::router::legacy_provider::LegacyToolProvider;
use axiomregent::router::provider::ToolProvider;
use hiqlite::Client;
use std::sync::Arc;

/// Initialise a hiqlite client and return it together with a `LeaseStore`
/// backed by the same database at `data_dir`.
///
/// Use this in tests that need both a `Client` (to pass to `Store::new` or
/// `RunTools::new`) and a `LeaseStore`.  Calling `init_hiqlite` twice for the
/// same directory can cause Raft port conflicts, so always obtain the client
/// from this helper and clone it as needed.
#[allow(dead_code)]
pub async fn make_client_and_lease_store(data_dir: &std::path::Path) -> (Client, Arc<LeaseStore>) {
    let client = axiomregent::db::init_hiqlite(data_dir)
        .await
        .expect("init_hiqlite failed");
    let lease_store = Arc::new(LeaseStore::new(client.clone()));
    (client, lease_store)
}

/// Create a `LeaseStore` backed by a temporary hiqlite database at `data_dir`.
///
/// Panics if the database cannot be initialised. Use inside `#[tokio::test]` fns.
#[allow(dead_code)]
pub async fn make_lease_store(data_dir: &std::path::Path) -> Arc<LeaseStore> {
    let client = axiomregent::db::init_hiqlite(data_dir)
        .await
        .expect("init_hiqlite failed");
    Arc::new(LeaseStore::new(client))
}

/// Build a `Router` from a `LeaseStore` and a set of pre-constructed tools.
/// Uses the current `LegacyToolProvider` structure.
#[allow(dead_code)]
pub async fn make_router(
    lease_store: Arc<LeaseStore>,
    workspace_tools: Arc<axiomregent::workspace::WorkspaceTools>,
    featuregraph_tools: Arc<axiomregent::featuregraph::tools::FeatureGraphTools>,
    xray_tools: Arc<axiomregent::xray::tools::XrayTools>,
    agent_tools: Arc<axiomregent::agent_tools::AgentTools>,
    run_tools: Arc<axiomregent::run_tools::RunTools>,
) -> Router {
    let legacy = Arc::new(LegacyToolProvider {
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    });
    let providers: Vec<Arc<dyn ToolProvider>> = vec![legacy];
    Router::new(providers, lease_store, None).await
}
