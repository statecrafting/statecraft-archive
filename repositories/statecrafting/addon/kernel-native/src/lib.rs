// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Bartek Kus

//! `kernel-native`: the governance kernel of the governed cell, composed from
//! four domain-neutral primitives and generalized from chancery's
//! kernel-addon (the donor) to arbitrary effects.
//!
//! - [`action-gate-core`](action_gate_core): the pure decision gate. The
//!   kernel's structural enforcement (ceiling membership, constraints, trust)
//!   emits its decisions; the model's roster checks run inside it.
//! - [`attest-ledger-core`](attest_ledger_core): the hash-linked Decision
//!   ledger. The kernel's [`EffectDecision`](payload::EffectDecision) is one
//!   record's payload; the deploy's genesis commits to the model hash.
//! - [`trust-window`](trust_window): the rolling-window trust scorer behind
//!   the agent ladder.
//! - [`canonical-keysort-json`](canonical_keysort_json): the canonical
//!   serialization the model hash and the ledger hash through.
//!
//! The kernel boots from `app-model.json` (enrahitu spec 020), builds its
//! per-service enforcement tables, and refuses to start on any integrity or
//! configuration mismatch. It is a pure function of its inputs: no host
//! calls, no wall clock, no database. Persistence (the Decision chain, trust
//! snapshots) and the precomputation of I/O-bound signals are the consumer's
//! job; the one piece of process state is the write-once booted model
//! (spec 004 section 3.2). That is what keeps the kernel deterministic and
//! golden-testable.

pub mod adjudicate;
pub mod gate;
pub mod kernel;
pub mod kinds;
pub mod ladder;
pub mod model;
pub mod payload;
pub mod tables;
pub mod wire;

/// The napi-rs addon surface: JSON-in / JSON-out `#[napi]` functions the
/// consuming Encore.ts app calls, thin delegators over [`wire`]. Present only
/// under the `napi` feature (opt-in); the pure core does not depend on it.
#[cfg(feature = "napi")]
pub mod napi_api;

pub use adjudicate::{CapabilityRef, EffectRequest};
pub use kernel::{Adjudication, BootReceipt, Kernel};
pub use ladder::{ScoreResult, score};
pub use model::{AppModel, compute_model_hash, parse_and_verify};
pub use payload::{EffectDecision, GenesisPayload, build_record, verify_effect_chain};
pub use tables::EnforcementTables;

// Re-export the primitive types a consumer of this kernel touches directly,
// so they need not depend on the four crates individually.
pub use action_gate_core::{ActionContext, Decision, Gate, Outcome};
pub use attest_ledger_core::{LedgerRecord, VerifyError};
pub use trust_window::{Level, Sample, WindowConfig, WindowSnapshot};
