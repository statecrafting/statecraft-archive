// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Factory pipeline stages that execute as in-process Rust code rather than
//! through the LLM-agent dispatch path. Today this is `s-1-extract`
//! (spec 120) and the spec-121 quality gate `QG-13_ExternalProvenance`
//! (spec 121); future Rust stages live alongside.

pub mod cascade_check;
pub mod quality_gates;
pub mod s_minus_1_extract;
pub mod stage_cd;
pub mod stage_cd_actions;
pub mod stage_cd_comparator;
pub mod stage_cd_gate;
