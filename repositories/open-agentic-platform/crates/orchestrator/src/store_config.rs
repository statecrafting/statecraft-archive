// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052: Store backend configuration and builder.
//
// Provides the `StoreBackend` enum and `build_persistence` function for
// constructing the appropriate `WorkflowStore` + `EventNotifier` pair
// based on the selected backend.

use crate::OrchestratorError;
use crate::store::{EventNotifier, WorkflowStore};
use std::sync::Arc;

/// Selects which storage backend to use for workflow persistence.
pub enum StoreBackend {
    /// Single-node file-based SQLite (default for development and testing).
    #[cfg(feature = "local-sqlite")]
    Local {
        /// Path to the SQLite database file.
        db_path: std::path::PathBuf,
    },

    /// Hiqlite Raft cluster for distributed HA.
    #[cfg(feature = "distributed")]
    Distributed {
        /// Already-initialised hiqlite client (from `hiqlite::start_node`).
        client: hiqlite::Client,
    },
}

/// Persistence context combining a store and a notifier.
pub struct PersistencePair {
    pub store: Arc<dyn WorkflowStore>,
    pub notifier: Arc<dyn EventNotifier>,
}

/// Constructs the appropriate `WorkflowStore` + `EventNotifier` pair.
pub async fn build_persistence(
    backend: StoreBackend,
) -> Result<PersistencePair, OrchestratorError> {
    match backend {
        #[cfg(feature = "local-sqlite")]
        StoreBackend::Local { db_path } => {
            let store = crate::sqlite_state::SqliteWorkflowStore::open(&db_path)?;
            let notifier = crate::sqlite_state::LocalEventNotifier::new();
            Ok(PersistencePair {
                store: Arc::new(store),
                notifier: Arc::new(notifier),
            })
        }

        #[cfg(feature = "distributed")]
        StoreBackend::Distributed { client } => {
            let store = crate::hiqlite_store::HiqliteWorkflowStore::new(client.clone());
            store.migrate().await?;
            let notifier = crate::hiqlite_store::HiqliteEventNotifier::new(client);
            Ok(PersistencePair {
                store: Arc::new(store),
                notifier: Arc::new(notifier),
            })
        }
    }
}
