// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! Integration test for the born-with kernel emission via `FactoryEngine`.
//!
//! Validates that:
//! - `FactoryEngine::emit_project_kernel` resolves the named adapter,
//!   builds an `AdapterIdentity` (with a deterministic manifest hash),
//!   and emits the kernel into the target directory.
//! - The emitted kernel contains every file the spec mandates.
//! - The `.kernel-version` round-trips back to the struct and records
//!   the correct adapter id and toolchain mode.

use std::fs;
use std::path::PathBuf;

use factory_contracts::adapter_manifest::*;
use factory_contracts::AdapterRegistry;
use factory_engine::factory_root::FactoryRoot;
use factory_engine::kernel_emission::{KernelVersion, ToolchainMode};
use factory_engine::{FactoryEngine, FactoryEngineConfig};

fn write_kernel_source(root: &std::path::Path) {
    let entries: &[(&str, &str)] = &[
        (
            "specs/000-bootstrap-spec-system/spec.md",
            "# spec 000\nfixture content\n",
        ),
        ("standards/spec/constitution.md", "# c\n"),
        ("standards/spec/contract.md", "# k\n"),
        ("standards/spec/templates/spec-template.md", "# tmpl\n"),
        (
            ".derived/spec-registry/registry.json",
            r#"{"specVersion":"0.1.0","specs":[]}"#,
        ),
    ];
    for (rel, body) in entries {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }
}

fn minimal_manifest() -> AdapterManifest {
    AdapterManifest {
        schema_version: "1.0.0".into(),
        adapter: AdapterIdentity {
            name: "acme-vue-encore".into(),
            display_name: "ACME Vue Node".into(),
            version: "0.1.0".into(),
            description: None,
        },
        stack: StackSpec {
            language: "typescript".into(),
            runtime: "node-22".into(),
            backend: BackendSpec {
                framework: "express-5".into(),
                description: "minimal".into(),
            },
            frontend: FrontendSpec {
                framework: "vue-3".into(),
                state_management: "pinia".into(),
                design_system: "none".into(),
                description: "minimal".into(),
            },
            database: None,
        },
        capabilities: Capabilities {
            dual_stack: false,
            bff_pattern: false,
            single_stack: true,
            session_auth: false,
            token_auth: false,
            api_key_auth: false,
            module_system: false,
            file_uploads: false,
            background_jobs: false,
            realtime: false,
            email_notifications: false,
            audit_logging: false,
            direct_sql: false,
            orm_based: false,
            api_proxy: false,
            extra: Default::default(),
        },
        supported_auth: vec![],
        supported_session_stores: None,
        commands: Commands {
            install: "npm install".into(),
            compile: "npm run build".into(),
            test: "npm test".into(),
            lint: "npm run lint".into(),
            dev: "npm run dev".into(),
            format_check: None,
            type_check: None,
            seed: None,
            feature_verify: vec![],
            extra: Default::default(),
        },
        directory_conventions: DirectoryConventions {
            api_service: None,
            api_controller: None,
            api_route: None,
            api_test: None,
            api_types: None,
            api_middleware: None,
            ui_view: None,
            ui_store: None,
            ui_route_config: None,
            ui_test: None,
            ui_component: None,
            migration: None,
            seed: None,
            schema_types: None,
            env_file: None,
            env_file_per_stack: None,
            extra: Default::default(),
        },
        patterns: Patterns {
            api: None,
            ui: None,
            data: None,
            page_types: None,
        },
        agents: Agents {
            api_scaffolder: "agents/api.md".into(),
            ui_scaffolder: "agents/ui.md".into(),
            data_scaffolder: "agents/data.md".into(),
            configurer: "agents/configurer.md".into(),
            trimmer: "agents/trimmer.md".into(),
            seed_generator: None,
            reviewer: None,
            security_auditor: None,
        },
        scaffold: Scaffold {
            source: ScaffoldSource::Local("scaffold/".into()),
            description: "base".into(),
            modules: std::collections::HashMap::new(),
            setup_commands: vec![],
            ..Default::default()
        },
        validation: Validation {
            invariants: vec![],
            invariants_file: None,
        },
        dual_stack: None,
        governance: None,
    }
}

#[test]
fn factory_engine_emits_kernel_for_named_adapter() {
    let oap_source = tempfile::tempdir().unwrap();
    write_kernel_source(oap_source.path());
    let target = tempfile::tempdir().unwrap();

    let registry = AdapterRegistry::from_manifests(vec![minimal_manifest()]);
    let cfg = FactoryEngineConfig {
        factory_root: FactoryRoot::Filesystem(PathBuf::from("factory")),
        project_path: PathBuf::from("."),
        concurrency_limit: 1,
    };
    let engine = FactoryEngine::with_adapters(cfg, registry);

    let report = engine
        .emit_project_kernel(
            "acme-vue-encore",
            target.path(),
            oap_source.path(),
            vec!["apps/".into(), "packages/".into()],
            Some("file://adapter-scopes.json#acme-vue-encore".into()),
            ToolchainMode::VendorBinaries,
            "fixturecommit".into(),
        )
        .expect("kernel emission succeeded");

    assert_eq!(report.kernel_version.adapter.id, "acme-vue-encore");
    assert_eq!(report.kernel_version.adapter.version, "0.1.0");
    assert_eq!(
        report.kernel_version.toolchain_mode,
        ToolchainMode::VendorBinaries
    );
    assert_eq!(report.kernel_version.kernel.source_commit, "fixturecommit");
    assert_eq!(report.kernel_hash.len(), 64);

    // Every required path landed in the target.
    for rel in &[
        "specs/000-bootstrap-spec-system/spec.md",
        "standards/spec/constitution.md",
        "standards/spec/contract.md",
        "standards/spec/templates/spec-template.md",
        ".derived/spec-registry/registry.json",
        ".kernel-version",
        "Makefile",
        ".factory/toolchain.yaml",
    ] {
        assert!(target.path().join(rel).exists(), "missing {rel}");
    }

    // The retired vendored-binary surfaces are NOT emitted (spec 167
    // self-amend): the CI workflow template and the scaffold-claim generator.
    assert!(!target.path().join(".github/workflows/ci-spec-code-coupling.yml").exists());
    assert!(!target.path().join("specs/001-acme-vue-encore-scaffold-claim/spec.md").exists());

    // `.kernel-version` parses back to the same struct shape.
    let yaml = fs::read_to_string(target.path().join(".kernel-version")).unwrap();
    let parsed = KernelVersion::from_yaml(&yaml).unwrap();
    assert_eq!(parsed.adapter.id, "acme-vue-encore");
    assert!(!parsed.adapter.manifest_hash.is_empty());
}

#[test]
fn unknown_adapter_returns_adapter_not_found() {
    let oap_source = tempfile::tempdir().unwrap();
    write_kernel_source(oap_source.path());
    let target = tempfile::tempdir().unwrap();

    let registry = AdapterRegistry::from_manifests(vec![minimal_manifest()]);
    let cfg = FactoryEngineConfig::default();
    let engine = FactoryEngine::with_adapters(cfg, registry);

    let err = engine
        .emit_project_kernel(
            "no-such-adapter",
            target.path(),
            oap_source.path(),
            vec![],
            None,
            ToolchainMode::VendorBinaries,
            "".into(),
        )
        .unwrap_err();
    let msg = format!("{err}");
    assert!(msg.contains("no-such-adapter"), "error did not surface name: {msg}");
}
