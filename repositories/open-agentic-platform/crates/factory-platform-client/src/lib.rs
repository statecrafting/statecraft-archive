// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md

//! Factory Platform Client (spec 124).
//!
//! Crate scope: typed access to the platform's `/api/factory/*` surface and
//! content-addressed materialisation of adapter / contract / process bodies
//! into a per-run cache directory. The desktop's `commands/factory.rs`
//! migrates from the spec-108 in-tree walk-up (`resolve_factory_root`) to
//! this crate in spec 124 Phase 5.
//!
//! Phase 0 laid out the cache-root layout (`source_shas` → `PathBuf`) and
//! the `SourceShas` projection type. Phase 4 (T040..T045) added:
//!
//!   * `PlatformClient` — typed REST surface + OIDC token plumbing,
//!     also implements spec 123's `factory_engine::agent_resolver::CatalogClient`
//!     so a single client instance feeds both the run pipeline and the
//!     agent resolver.
//!   * `materialise_run_root` — content-addressed materialisation with
//!     atomic-rename, agent-resolver cross-check, and warm-cache short
//!     circuit.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;

pub mod cache_root;
pub mod client;
pub mod error;
pub mod materialise;
pub mod wire;

pub use cache_root::cache_root_for;
pub use client::{OidcTokenProvider, PlatformClient, StaticTokenProvider};
pub use error::FactoryClientError;
pub use materialise::{
    collect_contract_names, walk_process_for_agent_refs, RunRoot,
};
pub use wire::{
    AdapterBody, AdapterSummary, ContractBody, ListAdaptersResponse, ListProcessesResponse,
    ListRunsQuery, ListRunsResponse, ProcessBody, ProcessSummary, ReserveRunRequest,
    RunReservation, RunRow, RunSummaryRow, WireAgentRef, WireSourceShas,
};

/// Spec 124 §3 — projection of spec-123 `ResolvedAgent` carried in
/// `factory_runs.source_shas.agents[]`. Field names mirror the snake_case
/// JSONB shape stored on the platform side. The desktop's wire envelopes
/// project this into `FactoryAgentRef` (camelCase) when emitting
/// `factory.run.stage_started`; the platform handler converts back when
/// persisting to the JSONB column.
///
/// Identity is `(org_agent_id, version, content_hash)` — the spec 122
/// Stage CD comparator depends on the triple being byte-identical across
/// runs of the same logical agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct AgentRef {
    pub org_agent_id: String,
    pub version: i64,
    pub content_hash: String,
}

/// Spec 124 §3 — content-addressed identity of a factory run's inputs.
///
/// Matches the JSONB shape platform statecraft writes to
/// `factory_runs.source_shas`:
///
/// ```json
/// {
///   "adapter": "<sha>",
///   "process": "<sha>",
///   "contracts": { "<name>": "<sha>", ... },
///   "agents":    [ {"org_agent_id":"...","version":3,"content_hash":"..."}, ... ]
/// }
/// ```
///
/// Field ordering is deterministic via `BTreeMap` for `contracts`; `agents`
/// retain stage-occurrence order as set by the reservation walk on the
/// platform side. Both sides MUST produce the same `run_sha()` from the
/// same inputs (spec 124 T043 cross-check).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceShas {
    /// sha-256 of the adapter manifest body (`factory_adapters.content_hash`).
    pub adapter: String,
    /// sha-256 of the process body (`factory_processes.content_hash`).
    pub process: String,
    /// `name → sha-256` for each contract referenced by the process. Sorted
    /// for deterministic hashing.
    pub contracts: BTreeMap<String, String>,
    /// Per-stage agent triples, in stage-occurrence order.
    pub agents: Vec<AgentRef>,
}

impl SourceShas {
    /// Composite SHA-256 over the canonical inputs. Used as the cache
    /// directory key (`oap-factory/<short>/`). Determinism is guaranteed
    /// by:
    ///
    ///   * `BTreeMap` for `contracts` (sorted keys),
    ///   * preserved stage-order for `agents`,
    ///   * a fixed `\n`-delimited canonical string format.
    ///
    /// The full hex-encoded SHA-256 is returned; callers truncate as
    /// needed. `cache_root_for` uses the leading 12 hex characters, which
    /// is sufficient for collision-resistance at developer-machine scale.
    pub fn run_sha(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"adapter\t");
        hasher.update(self.adapter.as_bytes());
        hasher.update(b"\nprocess\t");
        hasher.update(self.process.as_bytes());
        hasher.update(b"\ncontracts\t");
        for (name, sha) in &self.contracts {
            hasher.update(name.as_bytes());
            hasher.update(b"=");
            hasher.update(sha.as_bytes());
            hasher.update(b";");
        }
        hasher.update(b"\nagents\t");
        for agent in &self.agents {
            hasher.update(agent.org_agent_id.as_bytes());
            hasher.update(b"@");
            hasher.update(agent.version.to_string().as_bytes());
            hasher.update(b"#");
            hasher.update(agent.content_hash.as_bytes());
            hasher.update(b";");
        }
        let digest = hasher.finalize();
        hex_encode(&digest)
    }
}

/// Lower-case hex encoding of a byte slice. Inlined here to avoid pulling
/// in a fresh dependency for a single use-site.
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Re-exported convenience: build a `SourceShas` for testing without
/// constructing the `BTreeMap` literally each time.
pub fn source_shas_from_pairs(
    adapter: impl Into<String>,
    process: impl Into<String>,
    contracts: impl IntoIterator<Item = (String, String)>,
    agents: Vec<AgentRef>,
) -> SourceShas {
    SourceShas {
        adapter: adapter.into(),
        process: process.into(),
        contracts: contracts.into_iter().collect(),
        agents,
    }
}

/// Convenience alias: cache-root paths returned by [`cache_root_for`].
pub type CacheRootPath = PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_sha_is_deterministic_for_equivalent_inputs() {
        let a = SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            contracts: BTreeMap::from_iter([
                ("c1".to_string(), "h1".to_string()),
                ("c2".to_string(), "h2".to_string()),
            ]),
            agents: vec![AgentRef {
                org_agent_id: "a-1".into(),
                version: 3,
                content_hash: "h-3".into(),
            }],
        };
        let b = SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            // BTreeMap normalises insertion order — same logical map.
            contracts: BTreeMap::from_iter([
                ("c2".to_string(), "h2".to_string()),
                ("c1".to_string(), "h1".to_string()),
            ]),
            agents: vec![AgentRef {
                org_agent_id: "a-1".into(),
                version: 3,
                content_hash: "h-3".into(),
            }],
        };
        assert_eq!(a.run_sha(), b.run_sha());
    }

    #[test]
    fn run_sha_changes_when_any_input_changes() {
        let base = SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            contracts: BTreeMap::from_iter([("c1".to_string(), "h1".to_string())]),
            agents: vec![AgentRef {
                org_agent_id: "a-1".into(),
                version: 3,
                content_hash: "h-3".into(),
            }],
        };
        let base_sha = base.run_sha();

        let mut diff_adapter = base.clone();
        diff_adapter.adapter = "DIFFERENT".into();
        assert_ne!(base_sha, diff_adapter.run_sha());

        let mut diff_process = base.clone();
        diff_process.process = "DIFFERENT".into();
        assert_ne!(base_sha, diff_process.run_sha());

        let mut diff_contract = base.clone();
        diff_contract
            .contracts
            .insert("c1".to_string(), "DIFFERENT".to_string());
        assert_ne!(base_sha, diff_contract.run_sha());

        let mut diff_agent_version = base.clone();
        diff_agent_version.agents[0].version = 4;
        assert_ne!(base_sha, diff_agent_version.run_sha());

        let mut diff_agent_hash = base.clone();
        diff_agent_hash.agents[0].content_hash = "DIFFERENT".into();
        assert_ne!(base_sha, diff_agent_hash.run_sha());
    }

    #[test]
    fn run_sha_preserves_agent_order() {
        // Stage-order matters — re-ordering agents must produce a
        // different sha so a process that swaps two stages doesn't
        // hash-collide with the original.
        let a = SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            contracts: BTreeMap::new(),
            agents: vec![
                AgentRef {
                    org_agent_id: "a-1".into(),
                    version: 1,
                    content_hash: "h-1".into(),
                },
                AgentRef {
                    org_agent_id: "a-2".into(),
                    version: 2,
                    content_hash: "h-2".into(),
                },
            ],
        };
        let mut b = a.clone();
        b.agents.reverse();
        assert_ne!(a.run_sha(), b.run_sha());
    }

    #[test]
    fn run_sha_returns_64_hex_chars() {
        let s = SourceShas {
            adapter: "ada".into(),
            process: "proc".into(),
            contracts: BTreeMap::new(),
            agents: vec![],
        };
        let sha = s.run_sha();
        assert_eq!(sha.len(), 64);
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn source_shas_from_pairs_helper_works() {
        let s = source_shas_from_pairs(
            "ada",
            "proc",
            [("c1".to_string(), "h1".to_string())],
            vec![AgentRef {
                org_agent_id: "a-1".into(),
                version: 1,
                content_hash: "h-1".into(),
            }],
        );
        assert_eq!(s.adapter, "ada");
        assert_eq!(s.contracts.get("c1"), Some(&"h1".to_string()));
        assert_eq!(s.agents.len(), 1);
    }
}
