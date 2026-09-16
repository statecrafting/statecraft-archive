// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md — §4 / T042

//! Wire shapes for `/api/factory/*` responses.
//!
//! Mirrors the camelCase JSON the statecraft endpoints emit (see
//! `platform/services/statecraft/api/factory/browse.ts` for adapters /
//! contracts / processes and `runs.ts` for the reservation/list/detail
//! surface). Field shapes are derived from those response types, not
//! invented here — so a drift between the platform and the client surfaces
//! at compile time once a fixture is updated.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------------------
// Adapters / Contracts / Processes — detail bodies returned by
// GET /api/factory/{adapters|contracts|processes}/:name
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterBody {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    /// Free-form JSON body. The shape is governed by spec 074
    /// `AdapterManifest`; we accept it here as `serde_json::Value` so a
    /// schema bump in the contracts crate doesn't force a release of the
    /// platform client.
    pub manifest: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContractBody {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    pub schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessBody {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    pub definition: serde_json::Value,
}

/// Summary row from `GET /api/factory/processes` (the list endpoint,
/// `api/factory/browse.ts::listProcesses`). Like [`ProcessBody`] but
/// without `definition` — that is fetched per-process via `get_process`.
///
/// The desktop uses this to resolve the org's process by the platform's
/// *current* name when the caller did not pass one, instead of baking a
/// process name into the client. The platform owns process naming
/// (spec 124 §6); a rename there must not require a client rebuild.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSummary {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
}

/// Response envelope for `GET /api/factory/processes`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListProcessesResponse {
    pub processes: Vec<ProcessSummary>,
}

/// Summary row from `GET /api/factory/adapters` (the list endpoint,
/// `api/factory/browse.ts::listAdapters`). Like [`AdapterBody`] but
/// without the `manifest` — that is fetched per-adapter via `get_adapter`.
///
/// The desktop populates its adapter picker from this list so the set of
/// selectable adapters is whatever the platform reports for the org, not a
/// constant compiled into the client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSummary {
    /// `(orgId, name)`-stable synthesised id; informational for the picker.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
}

/// Response envelope for `GET /api/factory/adapters`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListAdaptersResponse {
    pub adapters: Vec<AdapterSummary>,
}

// ---------------------------------------------------------------------------
// /api/factory/runs — reservation + read shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReserveRunRequest {
    pub adapter_name: String,
    pub process_name: String,
    /// Optional project binding. `None` → ad-hoc run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub client_run_id: String,
}

/// Spec 124 §3 wire projection of `ResolvedAgent` returned by the
/// reservation. camelCase per the duplex-envelope convention.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct WireAgentRef {
    pub org_agent_id: String,
    pub version: i64,
    pub content_hash: String,
}

/// Wire `source_shas` payload (camelCase) returned to the desktop. The
/// `BTreeMap` for `contracts` keeps key iteration deterministic so a
/// `run_sha()` recomputation matches across desktop/platform.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WireSourceShas {
    pub adapter: String,
    pub process: String,
    pub contracts: BTreeMap<String, String>,
    pub agents: Vec<WireAgentRef>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunReservation {
    pub run_id: String,
    pub source_shas: WireSourceShas,
    /// `false` when the platform observed an idempotent replay against an
    /// existing row.
    pub reserved: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunStageProgressEntry {
    pub stage_id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub agent_ref: Option<WireAgentRef>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunTokenSpend {
    pub input: i64,
    pub output: i64,
    pub total: i64,
}

/// Detail row returned by `GET /api/factory/runs/:id`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunRow {
    pub id: String,
    pub org_id: String,
    pub project_id: Option<String>,
    pub triggered_by: String,
    pub adapter_id: String,
    pub process_id: String,
    pub client_run_id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub last_event_at: String,
    pub error: Option<String>,
    pub stage_progress: Vec<RunStageProgressEntry>,
    pub source_shas: WireSourceShas,
    pub token_spend: Option<RunTokenSpend>,
}

/// Spec 124 §4 — summary row returned by the list endpoint
/// (`GET /api/factory/runs`). Lighter than [`RunRow`]: no per-stage
/// progress or source_shas blob, since list rendering only needs the
/// status pill, timestamps, and identifiers.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummaryRow {
    pub id: String,
    pub org_id: String,
    pub project_id: Option<String>,
    pub triggered_by: String,
    pub adapter_id: String,
    pub process_id: String,
    pub client_run_id: String,
    pub status: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub last_event_at: String,
    pub error: Option<String>,
}

/// Filter parameters for `GET /api/factory/runs`. The desktop typically
/// passes `None` for everything except `status` (when the user filters
/// the Runs tab). `before` is an ISO-8601 timestamp cursor — the
/// platform returns rows with `started_at < before`.
#[derive(Debug, Clone, Default)]
pub struct ListRunsQuery {
    pub status: Option<String>,
    pub adapter: Option<String>,
    pub limit: Option<u32>,
    pub before: Option<String>,
}

/// Wire response: `{ runs: [...], nextCursor?: ISO-8601 }`. The cursor
/// is preserved so a future paginated React surface (Phase 7) can ask
/// for older rows; the desktop's current `list_factory_runs` consumes
/// the first page only.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListRunsResponse {
    pub runs: Vec<RunSummaryRow>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

// ---------------------------------------------------------------------------
// Conversions to/from `crate::SourceShas`
// ---------------------------------------------------------------------------

impl From<WireAgentRef> for crate::AgentRef {
    fn from(w: WireAgentRef) -> Self {
        crate::AgentRef {
            org_agent_id: w.org_agent_id,
            version: w.version,
            content_hash: w.content_hash,
        }
    }
}

impl From<&WireAgentRef> for crate::AgentRef {
    fn from(w: &WireAgentRef) -> Self {
        crate::AgentRef {
            org_agent_id: w.org_agent_id.clone(),
            version: w.version,
            content_hash: w.content_hash.clone(),
        }
    }
}

impl From<crate::AgentRef> for WireAgentRef {
    fn from(a: crate::AgentRef) -> Self {
        WireAgentRef {
            org_agent_id: a.org_agent_id,
            version: a.version,
            content_hash: a.content_hash,
        }
    }
}

impl From<WireSourceShas> for crate::SourceShas {
    fn from(w: WireSourceShas) -> Self {
        crate::SourceShas {
            adapter: w.adapter,
            process: w.process,
            contracts: w.contracts,
            agents: w.agents.into_iter().map(crate::AgentRef::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserve_run_request_serialises_camel_case() {
        let r = ReserveRunRequest {
            adapter_name: "ada".into(),
            process_name: "proc".into(),
            project_id: Some("p-1".into()),
            client_run_id: "cli-1".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&r).unwrap();
        assert_eq!(v["adapterName"], "ada");
        assert_eq!(v["processName"], "proc");
        assert_eq!(v["projectId"], "p-1");
        assert_eq!(v["clientRunId"], "cli-1");
    }

    #[test]
    fn reserve_run_request_skips_project_id_when_absent() {
        let r = ReserveRunRequest {
            adapter_name: "ada".into(),
            process_name: "proc".into(),
            project_id: None,
            client_run_id: "cli-1".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&r).unwrap();
        assert!(v.get("projectId").is_none());
    }

    #[test]
    fn run_reservation_round_trips_camel_case() {
        let json = serde_json::json!({
            "runId": "r-1",
            "sourceShas": {
                "adapter": "a",
                "process": "p",
                "contracts": { "c1": "h1" },
                "agents": [
                    { "orgAgentId": "ag-1", "version": 1, "contentHash": "h-ag-1" },
                ],
            },
            "reserved": true,
        });
        let res: RunReservation = serde_json::from_value(json).unwrap();
        assert_eq!(res.run_id, "r-1");
        assert_eq!(res.source_shas.agents.len(), 1);
        assert_eq!(res.source_shas.agents[0].org_agent_id, "ag-1");
        assert!(res.reserved);
    }

    #[test]
    fn wire_source_shas_converts_to_crate_source_shas() {
        let w = WireSourceShas {
            adapter: "a".into(),
            process: "p".into(),
            contracts: BTreeMap::from_iter([("c1".to_string(), "h1".to_string())]),
            agents: vec![WireAgentRef {
                org_agent_id: "ag-1".into(),
                version: 1,
                content_hash: "h-ag-1".into(),
            }],
        };
        let s: crate::SourceShas = w.into();
        assert_eq!(s.adapter, "a");
        assert_eq!(s.agents[0].org_agent_id, "ag-1");
        assert!(!s.run_sha().is_empty());
    }
}
