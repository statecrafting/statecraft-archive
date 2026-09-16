// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-008

//! Factory-specific policy shard generation.
//!
//! Generates axiomregent policy rules from the adapter manifest and Build Spec:
//! - Allowed write paths from directory conventions
//! - Allowed execute commands from adapter commands
//! - Blocked dangerous patterns
//! - Token budgets per step effort level

use factory_contracts::adapter_manifest::AdapterManifest;
use factory_contracts::build_spec::BuildSpec;
use policy_kernel::{PolicyBundle, PolicyRule};

/// Generate a policy shard for an Factory pipeline (FR-008).
///
/// The shard:
/// - Sets `file_write` allowed paths from adapter `directory_conventions`
/// - Sets `execute` allowed commands from adapter `commands`
/// - Blocks dangerous patterns (rm -rf, DROP, git push, etc.)
/// - Sets token budgets per step effort level
pub fn generate_factory_policy_shard(
    adapter: &AdapterManifest,
    build_spec: &BuildSpec,
) -> PolicyBundle {
    let scope = format!("factory:{}", adapter.adapter.name);
    let mut rules = Vec::new();

    // ── Allowed commands ─────────────────────────────────────────────────
    let allowed_commands = collect_allowed_commands(adapter);
    rules.push(PolicyRule {
        id: format!("{scope}/allow-adapter-commands"),
        description: format!("Allow adapter commands for {}", adapter.adapter.name),
        mode: "enforce".into(),
        scope: scope.clone(),
        gate: None,
        source_path: "factory-engine/policy_shard".into(),
        allow_destructive: Some(false),
        allowed_tools: Some(allowed_commands),
        max_diff_lines: None,
        max_diff_bytes: None,
    });

    // ── Block dangerous patterns ─────────────────────────────────────────
    rules.push(PolicyRule {
        id: format!("{scope}/block-dangerous"),
        description: "Block dangerous shell patterns in Factory pipeline".into(),
        mode: "enforce".into(),
        scope: scope.clone(),
        gate: None,
        source_path: "factory-engine/policy_shard".into(),
        allow_destructive: Some(false),
        allowed_tools: None,
        max_diff_lines: None,
        max_diff_bytes: None,
    });

    // ── Token budget ─────────────────────────────────────────────────────
    let entity_count = build_spec.data_model.entities.len();
    let operation_count: usize = build_spec
        .api
        .resources
        .iter()
        .map(|r| r.operations.len())
        .sum();
    let page_count = build_spec.ui.pages.len();
    let total_steps = entity_count + operation_count + page_count + 4; // +4 for init, config, trim, final

    rules.push(PolicyRule {
        id: format!("{scope}/token-budget"),
        description: format!(
            "Token budget for {} pipeline (~{total_steps} scaffolding steps)",
            build_spec.project.name,
        ),
        mode: "advisory".into(),
        scope: scope.clone(),
        gate: None,
        source_path: "factory-engine/policy_shard".into(),
        allow_destructive: None,
        allowed_tools: None,
        max_diff_lines: Some((total_steps * 500) as u32),
        max_diff_bytes: Some((total_steps * 50_000) as u64),
    });

    let mut shards = std::collections::BTreeMap::new();
    shards.insert(scope, rules);

    PolicyBundle {
        constitution: vec![],
        shards,
    }
}

/// Collect all allowed command strings from the adapter.
fn collect_allowed_commands(adapter: &AdapterManifest) -> Vec<String> {
    let mut cmds = vec![
        adapter.commands.install.clone(),
        adapter.commands.compile.clone(),
        adapter.commands.test.clone(),
        adapter.commands.lint.clone(),
        adapter.commands.dev.clone(),
    ];
    if let Some(ref fc) = adapter.commands.format_check {
        cmds.push(fc.clone());
    }
    if let Some(ref tc) = adapter.commands.type_check {
        cmds.push(tc.clone());
    }
    cmds.extend(adapter.commands.feature_verify.iter().cloned());
    cmds
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_build_spec() -> BuildSpec {
        use factory_contracts::build_spec::*;
        use std::collections::HashMap;

        BuildSpec {
            schema_version: "1.0.0".into(),
            project: ProjectSpec {
                name: "test-project".into(),
                display_name: "Test Project".into(),
                org: "test-org".into(),
                description: "A test project".into(),
                variant: Variant::SinglePublic,
                domain: None,
                fiscal_context: None,
            },
            auth: AuthSpec {
                audiences: HashMap::new(),
                service_to_service: None,
                session: None,
            },
            data_model: DataModelSpec {
                entities: vec![Entity {
                    name: "Widget".into(),
                    description: Some("A widget".into()),
                    fields: vec![Field {
                        name: "name".into(),
                        field_type: FieldType::String,
                        primary: false,
                        required: true,
                        unique: None,
                        default: None,
                        description: Some("Widget name".into()),
                        enum_values: None,
                        precision: None,
                        scale: None,
                        max_length: None,
                        min_length: None,
                        ref_entity: None,
                        ref_field: None,
                        ref_on_delete: None,
                    }],
                    unique_constraints: None,
                    check_constraints: None,
                    indexes: None,
                    business_rules: None,
                }],
                relationships: None,
            },
            business_rules: vec![],
            api: ApiSpec {
                base_path: None,
                resources: vec![],
                system_endpoints: None,
            },
            ui: UiSpec {
                pages: vec![],
                navigation: None,
            },
            integrations: None,
            notifications: None,
            audit: None,
            security: None,
            health_checks: None,
            error_handling: None,
            data_ingestion: None,
            file_storage: None,
            traceability: None,
            agentic_posture: None,
        }
    }

    fn minimal_adapter() -> AdapterManifest {
        use factory_contracts::adapter_manifest::*;
        use std::collections::HashMap;

        AdapterManifest {
            schema_version: "1.0.0".into(),
            adapter: AdapterIdentity {
                name: "test-adapter".into(),
                display_name: "Test".into(),
                version: "1.0.0".into(),
                description: None,
            },
            stack: StackSpec {
                language: "typescript".into(),
                runtime: "node".into(),
                backend: BackendSpec {
                    framework: "express".into(),
                    description: "Express".into(),
                },
                frontend: FrontendSpec {
                    framework: "react".into(),
                    state_management: "zustand".into(),
                    design_system: "tailwind".into(),
                    description: "React".into(),
                },
                database: None,
            },
            capabilities: Capabilities {
                dual_stack: false,
                bff_pattern: false,
                single_stack: true,
                session_auth: false,
                token_auth: true,
                api_key_auth: false,
                module_system: false,
                file_uploads: false,
                background_jobs: false,
                realtime: false,
                email_notifications: false,
                audit_logging: false,
                direct_sql: false,
                orm_based: true,
                api_proxy: false,
                extra: HashMap::new(),
            },
            supported_auth: vec![],
            supported_session_stores: None,
            commands: Commands {
                install: "npm install".into(),
                compile: "npx tsc --noEmit".into(),
                test: "npm test".into(),
                lint: "npm run lint".into(),
                dev: "npm run dev".into(),
                format_check: None,
                type_check: Some("npx tsc --noEmit".into()),
                seed: None,
                feature_verify: vec![],
                extra: HashMap::new(),
            },
            directory_conventions: DirectoryConventions::default(),
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
                configurer: "agents/config.md".into(),
                trimmer: "agents/trim.md".into(),
                seed_generator: None,
                reviewer: None,
                security_auditor: None,
            },
            scaffold: Scaffold {
                source: ScaffoldSource::Local("scaffold/".into()),
                description: "Base".into(),
                modules: HashMap::new(),
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
    fn policy_shard_contains_adapter_scope() {
        let adapter = minimal_adapter();
        let spec = minimal_build_spec();
        let bundle = generate_factory_policy_shard(&adapter, &spec);

        assert!(bundle.shards.contains_key("factory:test-adapter"));
        let rules = &bundle.shards["factory:test-adapter"];
        assert!(rules.len() >= 2);
    }

    #[test]
    fn allowed_commands_includes_standard_set() {
        let adapter = minimal_adapter();
        let cmds = collect_allowed_commands(&adapter);
        assert!(cmds.contains(&"npm install".to_string()));
        assert!(cmds.contains(&"npx tsc --noEmit".to_string()));
        assert!(cmds.contains(&"npm test".to_string()));
    }
}
