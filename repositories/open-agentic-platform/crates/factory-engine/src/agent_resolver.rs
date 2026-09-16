// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/123-agent-catalog-org-rescope/spec.md — §8.2, A-8

//! Agent resolver for Factory pipelines (spec 123 §8.2).
//!
//! Resolves a pipeline's agent reference (`{org_agent_id, version}`,
//! `{name, version}`, or `{name, latest}`) against the org catalog,
//! returning a `ResolvedAgent` that carries a stable `content_hash`.
//!
//! Two runs against two distinct projects that reference the same org agent
//! will receive identical `ResolvedAgent` values (byte-equal `content_hash`)
//! as long as they resolve from the same org catalog state. This is the
//! spec A-8 acceptance criterion: cross-project Stage CD comparator runs
//! produce deterministic, comparable agent definitions.
//!
//! # Design
//!
//! The resolver operates against a `CatalogClient` trait that models the
//! org catalog HTTP endpoints:
//!
//!   * `GET /api/orgs/:orgId/agents`        — list
//!   * `GET /api/orgs/:orgId/agents/:id`    — detail
//!
//! Tests supply a `MockCatalogClient` instead of a live statecraft
//! instance. The real HTTP client lives in the desktop crate / tauri
//! bindings and implements `CatalogClient` there; factory-engine carries
//! no HTTP dependency itself.
//!
//! An in-process cache keyed by `(org_agent_id, version)` is valid for
//! the lifetime of the resolver instance. A new Factory run receives a
//! new resolver (constructed by the engine before each pipeline), so the
//! cache never spans runs.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Wire types (matches the statecraft GET /api/orgs/:orgId/agents response)
// ---------------------------------------------------------------------------

/// A single row from the org catalog as returned by statecraft.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogRow {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub version: i64,
    pub status: String,
    pub content_hash: String,
    pub frontmatter: serde_json::Value,
    pub body_markdown: String,
}

// ---------------------------------------------------------------------------
// CatalogClient trait
// ---------------------------------------------------------------------------

/// Abstracts the two statecraft endpoints the resolver needs.
/// The real implementation lives in the desktop Tauri crate
/// (which has HTTP); tests use `MockCatalogClient`.
#[async_trait]
pub trait CatalogClient: Send + Sync {
    /// `GET /api/orgs/:orgId/agents` — returns all rows for the org,
    /// regardless of status, unless the caller filters downstream.
    async fn list_agents(
        &self,
        org_id: &str,
    ) -> Result<Vec<CatalogRow>, CatalogClientError>;

    /// `GET /api/orgs/:orgId/agents/:id` — returns the detail row.
    async fn get_agent(
        &self,
        org_id: &str,
        org_agent_id: &str,
    ) -> Result<CatalogRow, CatalogClientError>;
}

#[derive(Debug, Error)]
pub enum CatalogClientError {
    #[error("network error: {0}")]
    Network(String),
    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },
    #[error("not found: org={org_id} id={id}")]
    NotFound { org_id: String, id: String },
    #[error("decode error: {0}")]
    Decode(String),
}

// ---------------------------------------------------------------------------
// AgentReference
// ---------------------------------------------------------------------------

/// Describes how a Factory pipeline refers to an org catalog agent.
///
/// Mirrors the `AgentReference` enum in `factory-contracts` (T083) but
/// lives here for resolver-internal use. The two enums are isomorphic;
/// the contracts crate exposes the typed form for pipeline definitions.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum AgentReference {
    /// Resolve the exact row at `(org_agent_id, version)`.
    ById { org_agent_id: String, version: i64 },
    /// Resolve by `(name, version)` — the unique constraint on the org
    /// catalog guarantees at most one row.
    ByName { name: String, version: i64 },
    /// Resolve by `name`, choosing the highest published version.
    ByNameLatest { name: String },
}

// ---------------------------------------------------------------------------
// ResolvedAgent
// ---------------------------------------------------------------------------

/// The result of a successful resolution. Carries the stable identity
/// fields a Factory pipeline (and its audit record) needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAgent {
    pub org_agent_id: String,
    pub version: i64,
    /// SHA-256 content hash of the agent definition as stored in the
    /// org catalog. Two resolutions of the same agent MUST produce
    /// identical `content_hash` values (spec A-8).
    pub content_hash: String,
    /// Full frontmatter as a JSON value. Use `agent-frontmatter` to
    /// deserialize into `UnifiedFrontmatter` when structured access is
    /// needed.
    pub frontmatter: serde_json::Value,
    pub body_markdown: String,
}

// ---------------------------------------------------------------------------
// ResolveError
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ResolveError {
    #[error("agent not found: reference={reference:?}")]
    NotFound { reference: String },

    #[error("agent is retired: org_agent_id={org_agent_id} version={version}")]
    RetiredAgent { org_agent_id: String, version: i64 },

    #[error("ambiguous name resolution: name={name} matched {count} rows (expected ≤1)")]
    AmbiguousName { name: String, count: usize },

    #[error("version mismatch: requested version={requested} but catalog row has version={actual}")]
    VersionMismatch { requested: i64, actual: i64 },

    #[error("catalog client error: {0}")]
    Client(#[from] CatalogClientError),
}

// ---------------------------------------------------------------------------
// AgentResolver
// ---------------------------------------------------------------------------

/// Resolves Factory pipeline agent references against the org catalog.
///
/// Cache entries are valid for the lifetime of the resolver instance.
/// Construct one resolver per Factory run; do not share across runs.
pub struct AgentResolver {
    org_id: String,
    client: Box<dyn CatalogClient>,
    /// Keyed by `(org_agent_id, version)`.
    cache: Mutex<HashMap<(String, i64), ResolvedAgent>>,
}

impl std::fmt::Debug for AgentResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Recover the guard on poison: `Debug` formatting must not itself
        // panic just because some earlier cache access panicked while
        // holding the lock (e.g. during a test failure inspecting state).
        let cache_len = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len();
        f.debug_struct("AgentResolver")
            .field("org_id", &self.org_id)
            .field("cache_entries", &cache_len)
            .finish()
    }
}

impl AgentResolver {
    pub fn new(org_id: impl Into<String>, client: Box<dyn CatalogClient>) -> Self {
        Self {
            org_id: org_id.into(),
            client,
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Resolve an agent reference against the org catalog.
    ///
    /// Resolution strategy:
    ///
    /// * `ById` — fetch the detail row directly and verify the version
    ///   matches.
    /// * `ByName` — list all rows, find the unique match for
    ///   `(name, version)`. Multiple rows with the same `(name, version)`
    ///   is a catalog invariant violation → `AmbiguousName`.
    /// * `ByNameLatest` — list all rows, filter to `status: published`,
    ///   select the one with the highest version.
    ///
    /// Resolving a `retired` agent returns `ResolveError::RetiredAgent`.
    /// Results are cached in-process by `(org_agent_id, version)`.
    pub async fn resolve(
        &self,
        reference: AgentReference,
    ) -> Result<ResolvedAgent, ResolveError> {
        match reference {
            AgentReference::ById {
                ref org_agent_id,
                version,
            } => {
                // Check cache first. Recover the guard on poison rather than
                // panicking: a prior panicking holder of this Mutex
                // shouldn't cascade into every subsequent resolution for
                // the run.
                {
                    let guard = self
                        .cache
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if let Some(hit) = guard.get(&(org_agent_id.clone(), version)) {
                        return Ok(hit.clone());
                    }
                }

                let row = self
                    .client
                    .get_agent(&self.org_id, org_agent_id)
                    .await
                    .map_err(|e| match e {
                        CatalogClientError::NotFound { .. } => ResolveError::NotFound {
                            reference: format!("ById(id={org_agent_id}, v={version})"),
                        },
                        other => ResolveError::Client(other),
                    })?;

                if row.version != version {
                    return Err(ResolveError::VersionMismatch {
                        requested: version,
                        actual: row.version,
                    });
                }
                if row.status == "retired" {
                    return Err(ResolveError::RetiredAgent {
                        org_agent_id: org_agent_id.clone(),
                        version,
                    });
                }

                let resolved = ResolvedAgent {
                    org_agent_id: row.id.clone(),
                    version: row.version,
                    content_hash: row.content_hash,
                    frontmatter: row.frontmatter,
                    body_markdown: row.body_markdown,
                };
                self.cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .insert((row.id, row.version), resolved.clone());
                Ok(resolved)
            }

            AgentReference::ByName { ref name, version } => {
                // List all rows and filter.
                let rows = self.client.list_agents(&self.org_id).await?;
                let matches: Vec<&CatalogRow> = rows
                    .iter()
                    .filter(|r| &r.name == name && r.version == version)
                    .collect();

                match matches.len() {
                    0 => Err(ResolveError::NotFound {
                        reference: format!("ByName(name={name}, v={version})"),
                    }),
                    1 => {
                        let row = matches[0];

                        // Check cache. Recover the guard on poison rather
                        // than panicking (see the `ById` arm above).
                        {
                            let guard = self
                                .cache
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            if let Some(hit) =
                                guard.get(&(row.id.clone(), row.version))
                            {
                                return Ok(hit.clone());
                            }
                        }

                        if row.status == "retired" {
                            return Err(ResolveError::RetiredAgent {
                                org_agent_id: row.id.clone(),
                                version,
                            });
                        }

                        let resolved = ResolvedAgent {
                            org_agent_id: row.id.clone(),
                            version: row.version,
                            content_hash: row.content_hash.clone(),
                            frontmatter: row.frontmatter.clone(),
                            body_markdown: row.body_markdown.clone(),
                        };
                        self.cache
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner())
                            .insert((row.id.clone(), row.version), resolved.clone());
                        Ok(resolved)
                    }
                    n => Err(ResolveError::AmbiguousName {
                        name: name.clone(),
                        count: n,
                    }),
                }
            }

            AgentReference::ByNameLatest { ref name } => {
                let rows = self.client.list_agents(&self.org_id).await?;

                // Filter to published rows matching the name.
                let mut candidates: Vec<&CatalogRow> = rows
                    .iter()
                    .filter(|r| &r.name == name && r.status == "published")
                    .collect();

                if candidates.is_empty() {
                    return Err(ResolveError::NotFound {
                        reference: format!("ByNameLatest(name={name})"),
                    });
                }

                // Highest version wins.
                candidates.sort_by_key(|r| std::cmp::Reverse(r.version));
                let row = candidates[0];

                // Check cache. Recover the guard on poison rather than
                // panicking (see the `ById` arm above).
                {
                    let guard = self
                        .cache
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if let Some(hit) = guard.get(&(row.id.clone(), row.version)) {
                        return Ok(hit.clone());
                    }
                }

                let resolved = ResolvedAgent {
                    org_agent_id: row.id.clone(),
                    version: row.version,
                    content_hash: row.content_hash.clone(),
                    frontmatter: row.frontmatter.clone(),
                    body_markdown: row.body_markdown.clone(),
                };
                self.cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .insert((row.id.clone(), row.version), resolved.clone());
                Ok(resolved)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// MockCatalogClient
// ---------------------------------------------------------------------------

/// In-memory mock for tests. Populated by the test driver via `seed_rows`.
pub struct MockCatalogClient {
    rows: Mutex<Vec<CatalogRow>>,
}

impl MockCatalogClient {
    pub fn new(rows: Vec<CatalogRow>) -> Self {
        Self {
            rows: Mutex::new(rows),
        }
    }
}

#[async_trait]
impl CatalogClient for MockCatalogClient {
    async fn list_agents(
        &self,
        org_id: &str,
    ) -> Result<Vec<CatalogRow>, CatalogClientError> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.org_id == org_id)
            .cloned()
            .collect())
    }

    async fn get_agent(
        &self,
        org_id: &str,
        org_agent_id: &str,
    ) -> Result<CatalogRow, CatalogClientError> {
        self.rows
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.org_id == org_id && r.id == org_agent_id)
            .cloned()
            .ok_or_else(|| CatalogClientError::NotFound {
                org_id: org_id.to_string(),
                id: org_agent_id.to_string(),
            })
    }
}
