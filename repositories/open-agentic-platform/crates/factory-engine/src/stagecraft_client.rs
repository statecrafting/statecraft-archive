// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-016, FR-018, FR-019

//! Trait abstraction for the statecraft endpoints the `s-1-extract` stage
//! needs (yield-extraction, fetch-extraction-output, post-extraction-output).
//! The desktop crate (`apps/opc/src-tauri`) provides the real HTTP impl;
//! tests use `MockStatecraftClient`.
//!
//! Keeping the trait inside `factory-engine` means the engine has no Tauri
//! or HTTP dependency.

use async_trait::async_trait;
use factory_contracts::knowledge::ExtractionOutput;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::sync::oneshot;

#[derive(Debug, thiserror::Error)]
pub enum StatecraftClientError {
    #[error("statecraft client unavailable: {0}")]
    Unavailable(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("server returned {status}: {body}")]
    Server { status: u16, body: String },
    #[error("decode error: {0}")]
    Decode(String),
}

type YieldOutcome = Result<ExtractionOutput, StatecraftClientError>;

/// One-shot subscription handle for `knowledge.object.updated` notifications
/// scoped to a specific `(object_id, content_hash)` pair. The implementation
/// is responsible for cleaning up the subscription if the receiver is
/// dropped without being awaited.
pub struct YieldSubscription {
    pub run_id: String,
    pub topic: String,
    pub completion: oneshot::Receiver<YieldOutcome>,
}

#[async_trait]
pub trait StatecraftClient: Send + Sync {
    /// FR-018 — request a server-side agent extraction. Returns the run id
    /// and a oneshot subscription that fires when the duplex channel
    /// reports the object as `extracted`.
    async fn yield_extraction(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
        requested_kind: Option<&str>,
        reason: &str,
    ) -> Result<YieldSubscription, StatecraftClientError>;

    /// FR-019 — fetch a typed extraction-output by content hash.
    async fn fetch_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
    ) -> Result<Option<ExtractionOutput>, StatecraftClientError>;

    /// FR-016 — post a typed extraction-output produced by OPC. Idempotent
    /// on `(object_id, content_hash, extractor.version)` server-side.
    async fn post_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        output: &ExtractionOutput,
    ) -> Result<PostOutputResult, StatecraftClientError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostOutputResult {
    pub duplicate: bool,
    pub extraction_run_id: String,
}

/// In-memory mock for tests. Captures invocations and resolves yield
/// subscriptions on a cue from the test driver.
pub struct MockStatecraftClient {
    pub posted: Mutex<Vec<(String, String, ExtractionOutput)>>,
    pub yields: Mutex<HashMap<(String, String), oneshot::Sender<YieldOutcome>>>,
    pub fetched: Mutex<HashMap<(String, String, String), ExtractionOutput>>,
    pub run_counter: Mutex<u64>,
}

impl Default for MockStatecraftClient {
    fn default() -> Self {
        Self {
            posted: Mutex::new(Vec::new()),
            yields: Mutex::new(HashMap::new()),
            fetched: Mutex::new(HashMap::new()),
            run_counter: Mutex::new(0),
        }
    }
}

impl MockStatecraftClient {
    /// Resolve an in-flight yield with a successful output. The test driver
    /// calls this to simulate the server-side worker completing.
    pub fn resolve_yield(&self, project_id: &str, content_hash: &str, output: ExtractionOutput) {
        let key = (project_id.to_string(), content_hash.to_string());
        // Recover the guard on poison rather than panicking: this is a test
        // fixture, and a panic in one concurrent test task shouldn't mask a
        // sibling task's real assertion failure behind a "lock poisoned"
        // panic instead.
        if let Some(tx) = self
            .yields
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&key)
        {
            let _ = tx.send(Ok(output));
        }
    }

    /// Pre-populate a fetch response for `(project_id, object_id, content_hash)`.
    pub fn seed_fetch(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
        output: ExtractionOutput,
    ) {
        self.fetched
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (
                    project_id.to_string(),
                    object_id.to_string(),
                    content_hash.to_string(),
                ),
                output,
            );
    }
}

#[async_trait]
impl StatecraftClient for MockStatecraftClient {
    async fn yield_extraction(
        &self,
        project_id: &str,
        _object_id: &str,
        content_hash: &str,
        _requested_kind: Option<&str>,
        _reason: &str,
    ) -> Result<YieldSubscription, StatecraftClientError> {
        let (tx, rx) = oneshot::channel();
        self.yields
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert((project_id.into(), content_hash.into()), tx);
        let mut counter = self
            .run_counter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *counter += 1;
        let run_id = format!("mock-run-{}", *counter);
        Ok(YieldSubscription {
            run_id: run_id.clone(),
            topic: format!("knowledge.object.updated/{content_hash}"),
            completion: rx,
        })
    }

    async fn fetch_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
    ) -> Result<Option<ExtractionOutput>, StatecraftClientError> {
        Ok(self
            .fetched
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&(project_id.into(), object_id.into(), content_hash.into()))
            .cloned())
    }

    async fn post_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        output: &ExtractionOutput,
    ) -> Result<PostOutputResult, StatecraftClientError> {
        self.posted
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push((project_id.into(), object_id.into(), output.clone()));
        let mut counter = self
            .run_counter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *counter += 1;
        Ok(PostOutputResult {
            duplicate: false,
            extraction_run_id: format!("mock-post-{}", *counter),
        })
    }
}
