// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

#[cfg(feature = "analysis-structure")]
pub mod structure;

#[cfg(feature = "analysis-call-graph")]
pub mod call_graph;

pub mod deps;

#[cfg(feature = "analysis-embeddings")]
pub mod embeddings;
