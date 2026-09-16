// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! Born-with spec-spine kernel emission (spec 167).
//!
//! > **Distribution-shape note (spec 167 self-amend, 2026-06-11).** The
//! > canonical born-with kernel is the *published `spec-spine` npm
//! > distribution* carried by the prebuilt template (a pinned devDependency +
//! > `spec-spine.toml` + a born-clean corpus + committed `.derived/` +
//! > `spec-spine.yml` CI), materialised by statecraft's Create flow
//! > (`platform/services/statecraft/api/projects/scaffold/`, which stamps
//! > `.kernel-version`). The Rust `emit_kernel` path below is the
//! > **adapter-determined fallback** for non-npm adapters (spec 167 OQ-6);
//! > npm is the first and only realised mode. The vendored-binary CI workflow
//! > template (`tenant-ci.yml.tmpl`) and the synthetic scaffold-claim
//! > generator (`adapter_specs.rs`) were retired: the npm shape ships CI from
//! > the template's `spec-spine.yml` and a born-clean corpus, and the
//! > corpus-less-adapter fallback survives as a spec-text concept only (OQ-1).
//!
//! The fallback `emit_kernel` writes:
//!
//! 1. A copy of the source `specs/000-bootstrap-spec-system/spec.md`.
//! 2. A copy of the source `standards/spec/` directory.
//! 3. A pre-compiled `.derived/spec-registry/registry.json`.
//! 4. A `.kernel-version` marker recording source commit + content hash,
//!    factory-engine version, adapter identity + manifest hash, and the
//!    distribution mode (FR-005).
//! 5. A tenant Makefile target + `.factory/toolchain.yaml` (spec 168).
//!
//! Emission is deterministic: two invocations on identical inputs produce
//! hash-equal kernels (FR-009).

pub mod emit;
pub mod gather;
pub mod templates;
pub mod version;

pub use emit::{EmissionMode, KernelEmissionConfig, KernelEmissionReport, emit_kernel};
pub use version::ToolchainMode;
pub use gather::{KernelContent, KernelSource, compute_kernel_hash, gather_kernel_content};
pub use templates::{
    TenantGateContext, TenantToolchainContext, render_tenant_makefile, render_tenant_toolchain,
};
pub use version::{AdapterIdentity, CertificateToolchainRef, KernelOrigin, KernelVersion};

use thiserror::Error;

/// Errors raised by the kernel-emission pipeline.
#[derive(Debug, Error)]
pub enum KernelEmissionError {
    #[error("kernel source path not found: {0}")]
    SourceNotFound(String),

    #[error("kernel source missing required entry: {0}")]
    SourceIncomplete(String),

    #[error("target path is not empty: {0}")]
    TargetNotEmpty(String),

    #[error("filesystem error during emission: {0}")]
    Io(#[from] std::io::Error),

    #[error("template render error: {0}")]
    Template(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("adapter manifest invalid: {0}")]
    InvalidAdapter(String),
}
