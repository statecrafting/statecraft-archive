// SPDX-License-Identifier: Apache-2.0

//! The booted kernel: a verified model compiled and held.
//!
//! [`Kernel::from_model_json`] is the pure compilation the tests drive
//! directly (any number of instances). The process-global slot below is the
//! one honest piece of state in the crate (spec 004 section 3.2): the model
//! crosses the boundary once, at boot, integrity-checked; passing the tables
//! back in on every call would make the caller the custodian of its own
//! ceiling. A second `boot` with the same model hash is idempotent; a
//! different model is an error (changing the model means restarting the
//! process).

use std::sync::OnceLock;

use action_gate_core::{Decision, Gate};
use serde::Serialize;
use trust_window::WindowConfig;

use crate::adjudicate::{self, EffectRequest};
use crate::model;
use crate::tables::EnforcementTables;

/// What `boot` returns: the anchored identities plus table sizes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootReceipt {
    pub model_hash: String,
    pub gate_config_hash: String,
    pub contract_version: String,
    pub app: String,
    pub services: usize,
    pub agents: usize,
    pub capabilities: usize,
}

/// The result of one adjudication: the decision bound to both anchors.
#[derive(Debug, Clone)]
pub struct Adjudication {
    pub decision: Decision,
    pub gate_config_hash: String,
    pub model_hash: String,
}

/// A verified, compiled model.
pub struct Kernel {
    pub model_hash: String,
    pub contract_version: String,
    pub app_name: String,
    pub window_config: WindowConfig,
    tables: EnforcementTables,
    roster: Gate,
}

impl std::fmt::Debug for Kernel {
    // Manual: `Gate` (a list of boxed checks) has no `Debug`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Kernel")
            .field("model_hash", &self.model_hash)
            .field("contract_version", &self.contract_version)
            .field("app_name", &self.app_name)
            .finish_non_exhaustive()
    }
}

impl Kernel {
    /// Parse, verify, and compile a model. Every refusal of spec 004 section
    /// 3.3 surfaces here as an `Err`; a kernel that constructs is a kernel
    /// that may start.
    pub fn from_model_json(model_json: &str) -> Result<Self, String> {
        let (model, model_hash) = model::parse_and_verify(model_json)?;
        let tables = EnforcementTables::compile(&model)?;
        let roster = crate::gate::assemble_roster(&model.gate.checks)?;
        let assembled = roster.config_hash();
        if assembled != model.gate.config_hash {
            return Err(format!(
                "gate.configHash mismatch: pinned {} but the roster assembles to {assembled}",
                model.gate.config_hash
            ));
        }
        let window_config = match model.trust.window_config {
            None => WindowConfig::default(),
            Some(v) => serde_json::from_value(v).map_err(|e| {
                format!("trust.windowConfig does not parse as trust-window WindowConfig: {e}")
            })?,
        };
        Ok(Self {
            model_hash,
            contract_version: model.contract.version,
            app_name: model.app.name,
            window_config,
            tables,
            roster,
        })
    }

    /// Adjudicate one effect against this kernel's tables.
    pub fn adjudicate(&self, req: &EffectRequest) -> Adjudication {
        Adjudication {
            decision: adjudicate::adjudicate(&self.tables, &self.roster, req),
            gate_config_hash: self.roster.config_hash(),
            model_hash: self.model_hash.clone(),
        }
    }

    /// The boot receipt for this kernel.
    pub fn receipt(&self) -> BootReceipt {
        BootReceipt {
            model_hash: self.model_hash.clone(),
            gate_config_hash: self.roster.config_hash(),
            contract_version: self.contract_version.clone(),
            app: self.app_name.clone(),
            services: self.tables.services.len(),
            agents: self.tables.agents.len(),
            capabilities: self.tables.grants.len(),
        }
    }
}

static BOOTED: OnceLock<Kernel> = OnceLock::new();

/// Boot the process-global kernel. Write-once: re-booting with the same model
/// hash returns the receipt again; a different model is an error.
pub fn boot(model_json: &str) -> Result<BootReceipt, String> {
    if let Some(existing) = BOOTED.get() {
        return reboot_receipt(existing, model_json);
    }
    let kernel = Kernel::from_model_json(model_json)?;
    match BOOTED.set(kernel) {
        Ok(()) => Ok(BOOTED.get().expect("just set").receipt()),
        // Lost a boot race; defer to the winner.
        Err(_) => reboot_receipt(BOOTED.get().expect("racing boot set"), model_json),
    }
}

fn reboot_receipt(existing: &Kernel, model_json: &str) -> Result<BootReceipt, String> {
    let incoming = model::document_hash(model_json)?;
    if incoming == existing.model_hash {
        Ok(existing.receipt())
    } else {
        Err(format!(
            "kernel already booted with model {}; a different model ({incoming}) requires a process restart",
            existing.model_hash
        ))
    }
}

/// The booted kernel, or an error naming the missing boot.
pub fn booted() -> Result<&'static Kernel, String> {
    BOOTED
        .get()
        .ok_or_else(|| "kernel not booted: call boot(modelJson) first".to_string())
}
