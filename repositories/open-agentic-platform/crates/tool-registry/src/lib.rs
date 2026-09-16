// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Unified Tool Definition Registry (spec 067).
//!
//! Every tool in the platform — Rust crate tools, OPC Tauri commands, and
//! MCP-bridged tools — registers through a single schema-driven interface.

pub mod async_registry;
mod event;
mod mcp;
pub mod policy_bridge;
mod registry;
pub mod strictness;
mod types;

pub use async_registry::{AsyncToolDef, AsyncToolRegistry};
pub use event::{ToolEvent, ToolEventKind};
pub use mcp::McpToolDef;
pub use policy_bridge::PolicyKernelBridge;
pub use registry::{PermissiveRegistration, RegistryError, ToolRegistry};
pub use strictness::{PermissivePattern, validate_strict_schema};
pub use types::{
    PermissionResult, PolicyEvaluator, PolicyKernelHandle, ToolContext, ToolDef, ToolResult,
};

#[cfg(test)]
mod tests;
