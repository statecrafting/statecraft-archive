// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! Tenant-side gate wiring templates for the fallback emit path (spec 167
//! §2.1.5, FR-008).
//!
//! > **Distribution-shape note (spec 167 self-amend, 2026-06-11).** The
//! > vendored-binary CI workflow template (`tenant-ci.yml.tmpl`) is retired:
//! > the canonical npm born-with kernel ships its CI as the prebuilt
//! > template's `spec-spine.yml` (`npx --no-install spec-spine {compile,lint,
//! > index check,couple}`), not a Rust-rendered workflow that execs vendored
//! > `tools/spec-spine/` binaries. The Makefile + toolchain templates below
//! > remain for the adapter-determined fallback path (OQ-6).

use super::KernelEmissionError;

/// Embedded template text (built at compile time via include_str!).
const TENANT_MAKEFILE_TMPL: &str =
    include_str!("../../templates/kernel/tenant.makefile.tmpl");
const TENANT_TOOLCHAIN_TMPL: &str =
    include_str!("../../templates/kernel/toolchain.yaml.tmpl");

/// Context for rendering the tenant gate templates.
#[derive(Debug, Clone)]
pub struct TenantGateContext {
    /// Path (relative to the tenant project root) where the tenant-resident
    /// spine binaries live. Default: `tools/spec-spine`.
    pub binaries_dir: String,
    /// Path to the tenant codebase index manifest input. Default:
    /// `.derived/codebase-index/index.json`.
    pub index_path: String,
    /// Path to the spec registry the tenant's coupling gate reads.
    pub registry_path: String,
}

impl Default for TenantGateContext {
    fn default() -> Self {
        Self {
            binaries_dir: "tools/spec-spine".into(),
            index_path: ".derived/codebase-index/index.json".into(),
            registry_path: ".derived/spec-registry/registry.json".into(),
        }
    }
}

/// Render the tenant Makefile `pr-prep` target.
pub fn render_tenant_makefile(ctx: &TenantGateContext) -> Result<String, KernelEmissionError> {
    substitute(TENANT_MAKEFILE_TMPL, ctx)
}

/// Context for rendering the spec 168 toolchain manifest.
#[derive(Debug, Clone)]
pub struct TenantToolchainContext {
    /// Tenant-resident binaries dir; reuses the gate-context default
    /// when constructed via [`TenantToolchainContext::from`].
    pub binaries_dir: String,
    /// Pinned `factory-engine` semver — the version that emitted the
    /// kernel. Recorded into `.kernel-version` as well so the two stay
    /// in lockstep (FR-008).
    pub factory_engine_version: String,
    /// Distribution mode chosen by the adapter (FR-005 of spec 167).
    /// Serialised as `vendor-binaries` or `pinned-toolchain`.
    pub toolchain_mode: String,
}

impl TenantToolchainContext {
    /// Construct a toolchain context inheriting `binaries_dir` from the
    /// existing tenant gate context.
    pub fn new(
        gate_ctx: &TenantGateContext,
        factory_engine_version: impl Into<String>,
        toolchain_mode: impl Into<String>,
    ) -> Self {
        Self {
            binaries_dir: gate_ctx.binaries_dir.clone(),
            factory_engine_version: factory_engine_version.into(),
            toolchain_mode: toolchain_mode.into(),
        }
    }
}

/// Render the tenant `.factory/toolchain.yaml` (spec 168 FR-001 / §2.2).
pub fn render_tenant_toolchain(
    ctx: &TenantToolchainContext,
) -> Result<String, KernelEmissionError> {
    let rendered = TENANT_TOOLCHAIN_TMPL
        .replace("@@binaries_dir@@", &ctx.binaries_dir)
        .replace("@@factory_engine_version@@", &ctx.factory_engine_version)
        .replace("@@toolchain_mode@@", &ctx.toolchain_mode);
    if let Some(idx) = rendered.find("@@") {
        let snippet: String = rendered[idx..].chars().take(40).collect();
        return Err(KernelEmissionError::Template(format!(
            "un-substituted placeholder near `{snippet}`"
        )));
    }
    Ok(rendered)
}

fn substitute(template: &str, ctx: &TenantGateContext) -> Result<String, KernelEmissionError> {
    // `@@NAME@@` is the kernel-emission placeholder syntax. Chosen over
    // Jinja/Mustache `{{NAME}}` because the emitted CI workflows contain
    // GitHub Actions expressions (`${{ github.event… }}`) that would
    // otherwise collide with the un-substituted-placeholder check below.
    let rendered = template
        .replace("@@binaries_dir@@", &ctx.binaries_dir)
        .replace("@@index_path@@", &ctx.index_path)
        .replace("@@registry_path@@", &ctx.registry_path);
    if let Some(idx) = rendered.find("@@") {
        let snippet: String = rendered[idx..].chars().take(40).collect();
        return Err(KernelEmissionError::Template(format!(
            "un-substituted placeholder near `{snippet}`"
        )));
    }
    Ok(rendered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makefile_renders_with_defaults() {
        let ctx = TenantGateContext::default();
        let out = render_tenant_makefile(&ctx).unwrap();
        assert!(out.contains("pr-prep:"));
        // Spec 217: the tenant Makefile invokes the published `spec-spine` CLI
        // on PATH, not a vendored `tools/spec-spine/` binary directory.
        assert!(out.contains("spec-spine couple"));
        assert!(out.contains(".derived/codebase-index/index.json"));
        assert!(out.contains(".derived/spec-registry/registry.json"));
        assert!(!out.contains("@@"));
    }

    #[test]
    fn makefile_honours_index_and_registry_overrides() {
        // Spec 217: the Makefile no longer substitutes `binaries_dir` (it calls
        // the `spec-spine` CLI on PATH), so this exercises only the INDEX /
        // REGISTRY path overrides the Makefile still honours.
        let ctx = TenantGateContext {
            index_path: "build/index.json".into(),
            registry_path: "build/registry.json".into(),
            ..Default::default()
        };
        let out = render_tenant_makefile(&ctx).unwrap();
        assert!(out.contains("build/index.json"));
        assert!(out.contains("build/registry.json"));
    }

    #[test]
    fn unsubstituted_placeholder_is_rejected() {
        // Smuggle the placeholder syntax through a context value to
        // simulate a future template carrying a typo'd `@@foo@@`. Exercises
        // the shared `substitute` rejection via the Makefile renderer. Spec 217:
        // routed through `index_path` (still substituted into INDEX) since the
        // Makefile no longer substitutes `binaries_dir`.
        let ctx = TenantGateContext {
            index_path: "@@lurking_placeholder@@".into(),
            ..Default::default()
        };
        let err = render_tenant_makefile(&ctx).unwrap_err();
        assert!(matches!(err, KernelEmissionError::Template(_)));
    }

    // ── spec 168 toolchain template ──

    #[test]
    fn toolchain_renders_for_pinned_mode() {
        let gate = TenantGateContext::default();
        let ctx = TenantToolchainContext::new(&gate, "1.4.2", "pinned-toolchain");
        let out = render_tenant_toolchain(&ctx).unwrap();
        assert!(out.contains("mode: \"pinned-toolchain\""));
        assert!(out.contains("version: \"1.4.2\""));
        // Spec 219 FR-006 / AC-8: the verifier is the tenant-tail npm pin; the
        // cargo-install path (and its `--tag`) is retired.
        assert!(out.contains("npx --no-install tenant-tail verify-certificate"));
        assert!(!out.contains("cargo install"));
        assert!(!out.contains("--tag"));
        // Spec 220 FR-001: the emitter is now vended via the tenant-emit npm pin
        // (the emit-side counterpart of the verifier block above); the
        // `pending-spec-220` deferral 219 left is gone.
        assert!(out.contains("npx --no-install tenant-emit build-certificate"));
        assert!(out.contains("package: \"tenant-emit\""));
        assert!(!out.contains("pending-spec-220"));
        assert!(!out.contains("@@"));
    }

    #[test]
    fn toolchain_renders_for_vendor_mode() {
        let gate = TenantGateContext {
            binaries_dir: "vendor/spine".into(),
            ..Default::default()
        };
        let ctx = TenantToolchainContext::new(&gate, "0.9.0", "vendor-binaries");
        let out = render_tenant_toolchain(&ctx).unwrap();
        assert!(out.contains("mode: \"vendor-binaries\""));
        // `binaries_dir` is still substituted (provenance / spec 167 fallback path).
        assert!(out.contains("binaries_dir: \"vendor/spine\""));
        // Spec 219 FR-006: the npm-vended verifier is mode-independent (the same
        // invocation renders under vendor-binaries as under pinned-toolchain).
        assert!(out.contains("npx --no-install tenant-tail verify-certificate"));
        // Spec 220 FR-001: the npm-vended emitter is mode-independent too; the
        // tenant-emit pin renders identically under vendor-binaries.
        assert!(out.contains("npx --no-install tenant-emit build-certificate"));
        assert!(!out.contains("pending-spec-220"));
        assert!(!out.contains("@@"));
    }
}
