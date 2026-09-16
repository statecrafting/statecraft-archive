// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Per-stage implementations. Each module owns one stage end-to-end:
//! its inputs, its on-disk output shape, and its content-hashing.
//!
//! Stages do not call into each other. The orchestrator in
//! `crate::pipeline` walks stage 1 -> 6 and feeds in any cross-stage
//! evidence stage 6 needs.

pub mod callgraph;
pub mod clustering;
pub mod extraction;
pub mod fingerprint;
pub mod lineage;
pub mod synthesis;
