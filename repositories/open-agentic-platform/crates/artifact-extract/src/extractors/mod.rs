// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-005, FR-006, FR-009

//! Per-mime deterministic extractors. Each `extract(...)` returns a typed
//! `ExtractionOutput`. None call any model.

pub mod docx;
pub mod pdf;
pub mod text;

pub(crate) mod ooxml_text;
