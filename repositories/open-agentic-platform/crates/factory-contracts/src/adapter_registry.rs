// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Adapter discovery and registration.
//!
//! Discovers adapters by scanning `<root>/adapters/*/manifest.yaml` and
//! provides capability matching against Build Specs. Per spec 108 the
//! authoritative source for adapters is the platform's `factory_adapters`
//! table; `<root>` is whichever directory the caller writes those manifests
//! into.

use crate::adapter_manifest::{AdapterManifest, Capabilities};
use crate::build_spec::{AudienceMethod, BuildSpec, Variant};
use crate::validation;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DiscoveryError {
    #[error("Factory root not found: {0}")]
    RootNotFound(PathBuf),

    #[error("No adapters directory at {0}")]
    NoAdaptersDir(PathBuf),

    #[error("Failed to read adapters directory: {0}")]
    ReadDir(#[from] std::io::Error),

    #[error("Glob pattern error: {0}")]
    Glob(#[from] glob::PatternError),

    #[error("Invalid manifest at {path}: {errors:?}")]
    InvalidManifest {
        path: PathBuf,
        errors: Vec<validation::ValidationError>,
    },
}

/// A capability gap identified during matching.
#[derive(Debug, Clone)]
pub struct CapabilityGap {
    pub capability: String,
    pub required: bool,
    pub message: String,
}

/// Result of matching an adapter's capabilities against a Build Spec.
#[derive(Debug, Clone)]
pub struct CapabilityReport {
    pub adapter_name: String,
    pub compatible: bool,
    pub gaps: Vec<CapabilityGap>,
}

/// Registry of discovered Factory adapters.
#[derive(Debug, Clone)]
pub struct AdapterRegistry {
    adapters: HashMap<String, AdapterManifest>,
}

impl AdapterRegistry {
    /// Discover all adapters under `factory_root/adapters/*/manifest.yaml`.
    pub fn discover(factory_root: &Path) -> Result<Self, DiscoveryError> {
        if !factory_root.exists() {
            return Err(DiscoveryError::RootNotFound(factory_root.to_path_buf()));
        }

        let adapters_dir = factory_root.join("adapters");
        if !adapters_dir.exists() {
            return Err(DiscoveryError::NoAdaptersDir(adapters_dir));
        }

        let pattern = adapters_dir.join("*/manifest.yaml").display().to_string();

        let mut adapters = HashMap::new();

        for entry in glob::glob(&pattern)? {
            let manifest_path = entry.map_err(std::io::Error::other)?;

            match validation::validate_adapter_manifest(&manifest_path) {
                Ok(manifest) => {
                    adapters.insert(manifest.adapter.name.clone(), manifest);
                }
                Err(errors) => {
                    return Err(DiscoveryError::InvalidManifest {
                        path: manifest_path,
                        errors,
                    });
                }
            }
        }

        Ok(Self { adapters })
    }

    /// Build a registry from pre-loaded manifests (useful for testing).
    pub fn from_manifests(manifests: Vec<AdapterManifest>) -> Self {
        let adapters = manifests
            .into_iter()
            .map(|m| (m.adapter.name.clone(), m))
            .collect();
        Self { adapters }
    }

    /// Get an adapter by name.
    pub fn get(&self, name: &str) -> Option<&AdapterManifest> {
        self.adapters.get(name)
    }

    /// List all adapter names.
    pub fn list(&self) -> Vec<&str> {
        self.adapters.keys().map(|s| s.as_str()).collect()
    }

    /// Check whether an adapter's capabilities satisfy a Build Spec's requirements.
    pub fn capabilities_match(&self, name: &str, spec: &BuildSpec) -> CapabilityReport {
        let Some(manifest) = self.adapters.get(name) else {
            return CapabilityReport {
                adapter_name: name.to_string(),
                compatible: false,
                gaps: vec![CapabilityGap {
                    capability: "existence".to_string(),
                    required: true,
                    message: format!("Adapter '{}' not found in registry", name),
                }],
            };
        };

        let caps = &manifest.capabilities;
        let mut gaps = Vec::new();

        check_variant_support(spec, caps, &mut gaps);
        check_auth_support(spec, caps, &mut gaps);
        check_feature_support(spec, caps, &mut gaps);

        let compatible = !gaps.iter().any(|g| g.required);

        CapabilityReport {
            adapter_name: name.to_string(),
            compatible,
            gaps,
        }
    }
}

fn check_variant_support(spec: &BuildSpec, caps: &Capabilities, gaps: &mut Vec<CapabilityGap>) {
    match spec.project.variant {
        Variant::Dual => {
            if !caps.dual_stack {
                gaps.push(CapabilityGap {
                    capability: "dual_stack".to_string(),
                    required: true,
                    message:
                        "Build Spec requires dual variant but adapter does not support dual_stack"
                            .to_string(),
                });
            }
        }
        Variant::SinglePublic | Variant::SingleInternal => {
            if !caps.single_stack {
                gaps.push(CapabilityGap {
                    capability: "single_stack".to_string(),
                    required: true,
                    message: "Build Spec requires single variant but adapter does not support single_stack".to_string(),
                });
            }
        }
    }
}

fn check_auth_support(spec: &BuildSpec, caps: &Capabilities, gaps: &mut Vec<CapabilityGap>) {
    for audience in spec.auth.audiences.values() {
        match audience.method {
            AudienceMethod::Saml | AudienceMethod::Oidc | AudienceMethod::Basic => {
                if !caps.token_auth && !caps.session_auth {
                    gaps.push(CapabilityGap {
                        capability: "token_auth".to_string(),
                        required: true,
                        message: "Build Spec uses SAML/OIDC/Basic auth but adapter does not support token_auth or session_auth".to_string(),
                    });
                }
            }
            AudienceMethod::Session => {
                if !caps.session_auth {
                    gaps.push(CapabilityGap {
                        capability: "session_auth".to_string(),
                        required: true,
                        message:
                            "Build Spec uses session auth but adapter does not support session_auth"
                                .to_string(),
                    });
                }
            }
            AudienceMethod::ApiKey => {
                if !caps.api_key_auth {
                    gaps.push(CapabilityGap {
                        capability: "api_key_auth".to_string(),
                        required: true,
                        message: "Build Spec uses API key auth but adapter does not support it"
                            .to_string(),
                    });
                }
            }
            AudienceMethod::Mock => {}
        }
    }
}

fn check_feature_support(spec: &BuildSpec, caps: &Capabilities, gaps: &mut Vec<CapabilityGap>) {
    if spec.notifications.is_some() && !caps.email_notifications {
        gaps.push(CapabilityGap {
            capability: "email_notifications".to_string(),
            required: false,
            message:
                "Build Spec has notifications but adapter does not support email_notifications"
                    .to_string(),
        });
    }

    if spec.audit.is_some() && !caps.audit_logging {
        gaps.push(CapabilityGap {
            capability: "audit_logging".to_string(),
            required: false,
            message: "Build Spec has audit spec but adapter does not support audit_logging"
                .to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter_manifest::*;
    use crate::build_spec::*;

    fn minimal_capabilities(dual: bool) -> Capabilities {
        Capabilities {
            dual_stack: dual,
            bff_pattern: false,
            single_stack: !dual,
            session_auth: true,
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
            extra: Default::default(),
        }
    }

    fn minimal_manifest(name: &str, dual: bool) -> AdapterManifest {
        AdapterManifest {
            schema_version: "1.0.0".into(),
            adapter: AdapterIdentity {
                name: name.to_string(),
                display_name: name.to_string(),
                version: "1.0.0".to_string(),
                description: None,
            },
            stack: StackSpec {
                language: "typescript".into(),
                runtime: "node-22".into(),
                backend: BackendSpec {
                    framework: "express-5".into(),
                    description: "Express with Route → Controller → Service".into(),
                },
                frontend: FrontendSpec {
                    framework: "vue-3".into(),
                    state_management: "pinia".into(),
                    design_system: "none".into(),
                    description: "Vue 3 Composition API".into(),
                },
                database: None,
            },
            capabilities: minimal_capabilities(dual),
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
                api_service: Some("apps/{stack}/src/services/{resource}.service.ts".into()),
                api_controller: Some(
                    "apps/{stack}/src/controllers/{resource}.controller.ts".into(),
                ),
                api_route: Some("apps/{stack}/src/routes/{resource}.routes.ts".into()),
                api_test: Some("apps/{stack}/src/services/{resource}.service.test.ts".into()),
                api_types: Some("packages/shared/src/types/{entity}.types.ts".into()),
                api_middleware: Some("apps/{stack}/src/middleware/{name}.middleware.ts".into()),
                ui_view: Some("apps/{stack}/src/views/{PageName}View.vue".into()),
                ui_store: Some("apps/{stack}/src/stores/{resource}.store.ts".into()),
                ui_route_config: Some("apps/{stack}/src/router/index.ts".into()),
                ui_test: Some("apps/{stack}/src/views/{PageName}View.test.ts".into()),
                ui_component: Some("apps/{stack}/src/components/{Name}.vue".into()),
                migration: Some("database/migrations/{timestamp}_{name}.sql".into()),
                seed: Some("database/seeds/{name}.sql".into()),
                schema_types: Some("packages/shared/src/schemas/{entity}.schema.ts".into()),
                env_file: Some(".env.example".into()),
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
                api_scaffolder: "agents/api-scaffolder.md".into(),
                ui_scaffolder: "agents/ui-scaffolder.md".into(),
                data_scaffolder: "agents/data-scaffolder.md".into(),
                configurer: "agents/configurer.md".into(),
                trimmer: "agents/trimmer.md".into(),
                seed_generator: None,
                reviewer: None,
                security_auditor: None,
            },
            scaffold: Scaffold {
                source: ScaffoldSource::Local("scaffold/".into()),
                description: "Base scaffold".into(),
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

    fn minimal_build_spec(variant: Variant, method: AudienceMethod) -> BuildSpec {
        let mut audiences = std::collections::HashMap::new();
        audiences.insert(
            "default".to_string(),
            Audience {
                method,
                provider: None,
                roles: vec![],
                provisioning_model: ProvisioningModel::OpenAuthenticated,
            },
        );
        BuildSpec {
            schema_version: "1.0.0".into(),
            project: ProjectSpec {
                name: "test".into(),
                display_name: "Test".into(),
                org: "org".into(),
                description: "desc".into(),
                variant,
                domain: None,
                fiscal_context: None,
            },
            auth: AuthSpec {
                audiences,
                service_to_service: None,
                session: None,
            },
            data_model: DataModelSpec {
                entities: vec![],
                relationships: None,
            },
            business_rules: vec![],
            api: ApiSpec {
                resources: vec![],
                base_path: None,
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

    #[test]
    fn test_capabilities_match_dual_supported() {
        let manifest = minimal_manifest("acme-vue-encore", true);
        let registry = AdapterRegistry::from_manifests(vec![manifest]);
        let spec = minimal_build_spec(Variant::Dual, AudienceMethod::Saml);

        let report = registry.capabilities_match("acme-vue-encore", &spec);
        assert!(report.compatible, "Gaps: {:?}", report.gaps);
    }

    #[test]
    fn test_capabilities_match_dual_unsupported() {
        let manifest = minimal_manifest("single-stack-example", false);
        let registry = AdapterRegistry::from_manifests(vec![manifest]);
        let spec = minimal_build_spec(Variant::Dual, AudienceMethod::Oidc);

        let report = registry.capabilities_match("single-stack-example", &spec);
        assert!(!report.compatible);
        assert!(report.gaps.iter().any(|g| g.capability == "dual_stack"));
    }

    #[test]
    fn test_capabilities_match_missing_adapter() {
        let registry = AdapterRegistry::from_manifests(vec![]);
        let spec = minimal_build_spec(Variant::SinglePublic, AudienceMethod::Mock);

        let report = registry.capabilities_match("nonexistent", &spec);
        assert!(!report.compatible);
    }

    #[test]
    fn test_list_adapters() {
        let registry = AdapterRegistry::from_manifests(vec![
            minimal_manifest("a", true),
            minimal_manifest("b", false),
        ]);
        let mut names = registry.list();
        names.sort();
        assert_eq!(names, vec!["a", "b"]);
    }

    #[test]
    fn test_discover_real_adapters() {
        let factory_root = std::path::Path::new("../../factory");
        if !factory_root.exists() {
            return;
        }
        let registry =
            AdapterRegistry::discover(factory_root).expect("Failed to discover adapters");
        let mut names = registry.list();
        names.sort();
        assert_eq!(
            names,
            vec!["acme-vue-node", "encore-react", "next-prisma", "rust-axum"]
        );
    }

    #[test]
    fn test_capabilities_match_real_example() {
        let factory_root = std::path::Path::new("../../factory");
        let spec_path =
            factory_root.join("contract/examples/community-grant-portal.build-spec.yaml");
        if !spec_path.exists() {
            return;
        }
        let registry =
            AdapterRegistry::discover(factory_root).expect("Failed to discover adapters");
        let spec =
            crate::validation::validate_build_spec(&spec_path).expect("Failed to parse build spec");

        // acme-vue-node should be compatible with community-grant-portal (dual, saml+oidc)
        let report = registry.capabilities_match("acme-vue-node", &spec);
        assert!(
            report.compatible,
            "acme-vue-node should be compatible. Gaps: {:?}",
            report.gaps
        );

        // next-prisma should NOT be compatible (no dual_stack)
        let report = registry.capabilities_match("next-prisma", &spec);
        assert!(
            !report.compatible,
            "next-prisma should not be compatible with dual variant"
        );
    }

    #[test]
    fn test_acme_vue_node_declares_spec_112_scaffold_extension() {
        // Spec 112 Phase 4 exit criteria: acme-vue-node's manifest declares the new
        // scaffold block with entry_point, runtime, profiles, and emits populated.
        let factory_root = std::path::Path::new("../../factory");
        if !factory_root.exists() {
            return;
        }
        let registry =
            AdapterRegistry::discover(factory_root).expect("Failed to discover adapters");
        let manifest = registry
            .get("acme-vue-node")
            .expect("acme-vue-node adapter should be discovered");
        let scaffold = &manifest.scaffold;
        assert_eq!(scaffold.entry_point.as_deref(), Some("scripts/setup-app.ts"));
        assert_eq!(scaffold.runtime.as_deref(), Some("node-24"));
        assert!(
            scaffold.args_schema.is_some(),
            "args_schema must be declared for Create-eligibility"
        );
        assert!(
            !scaffold.profiles.is_empty(),
            "scaffold.profiles must enumerate variant/profile combinations"
        );
        assert!(
            scaffold.profiles.iter().any(|p| p.default),
            "exactly one profile must be marked default"
        );
        let variants: std::collections::HashSet<_> =
            scaffold.profiles.iter().map(|p| p.variant.as_str()).collect();
        assert!(variants.contains("single-public"));
        assert!(variants.contains("single-internal"));
        assert!(variants.contains("dual"));
        assert!(
            scaffold.emits.iter().any(|e| e.path == ".factory/pipeline-state.json"),
            "emits must advertise the .factory/pipeline-state.json L0 seed path"
        );
    }
}
