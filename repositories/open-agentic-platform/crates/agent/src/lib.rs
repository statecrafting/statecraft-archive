// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

pub mod agent;
pub mod canonical;
pub mod complexity;
pub mod dispatch;
pub mod executor;
pub mod id;
pub mod plan;
pub mod prompt;
pub mod registry;
pub mod safety;
pub mod schemas;
pub mod validator;
pub mod verification;

pub use dispatch::{MandatoryOutcome, evaluate_mandatory_triggers};
pub use registry::{
    AgentRegistryEntry, AgentRegistrySnapshot, DeterministicOrganizerPlanner, OrganizerPlanner,
    build_execution_plan, plan, plan_with_planner,
};
