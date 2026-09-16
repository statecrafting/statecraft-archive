// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Pattern file resolution for adapter manifests.
//!
//! Resolves pattern references from adapter manifests to absolute file paths
//! under the adapter's directory.

use crate::adapter_manifest::AdapterManifest;
use std::path::{Path, PathBuf};

/// Resolves pattern references from an adapter manifest to file paths.
pub struct PatternResolver {
    adapter_root: PathBuf,
    manifest: AdapterManifest,
}

impl PatternResolver {
    pub fn new(adapter_root: &Path, manifest: AdapterManifest) -> Self {
        Self {
            adapter_root: adapter_root.to_path_buf(),
            manifest,
        }
    }

    /// Resolve an API pattern by kind (e.g., "service", "controller", "route",
    /// "test", "middleware", "types").
    pub fn resolve_api_pattern(&self, kind: &str) -> Option<PathBuf> {
        let api = self.manifest.patterns.api.as_ref()?;
        let rel = match kind {
            "service" => api.service.as_deref(),
            "controller" => api.controller.as_deref(),
            "route" => api.route.as_deref(),
            "test" => api.test.as_deref(),
            "middleware" => api.middleware.as_deref(),
            "types" => api.types.as_deref(),
            _ => None,
        }?;
        Some(self.adapter_root.join(rel))
    }

    /// Resolve a UI pattern by kind (e.g., "view", "state", "route", "test",
    /// "layout", "component").
    pub fn resolve_ui_pattern(&self, kind: &str) -> Option<PathBuf> {
        let ui = self.manifest.patterns.ui.as_ref()?;
        let rel = match kind {
            "view" => ui.view.as_deref(),
            "state" => ui.state.as_deref(),
            "route" => ui.route.as_deref(),
            "test" => ui.test.as_deref(),
            "layout" => ui.layout.as_deref(),
            "component" => ui.component.as_deref(),
            _ => None,
        }?;
        Some(self.adapter_root.join(rel))
    }

    /// Resolve a data pattern by kind (e.g., "migration", "query", "seed",
    /// "validation_schema").
    pub fn resolve_data_pattern(&self, kind: &str) -> Option<PathBuf> {
        let data = self.manifest.patterns.data.as_ref()?;
        let rel = match kind {
            "migration" => data.migration.as_deref(),
            "query" => data.query.as_deref(),
            "seed" => data.seed.as_deref(),
            "fixture_factory" => data.fixture_factory.as_deref(),
            "validation_schema" => data.validation_schema.as_deref(),
            _ => None,
        }?;
        Some(self.adapter_root.join(rel))
    }

    /// Resolve a page-type pattern (e.g., "dashboard", "list", "form").
    ///
    /// Looks in the `page_types` group for the exact page type name.
    /// Falls back to the UI "view" pattern when no specific entry exists.
    pub fn resolve_page_type_pattern(&self, page_type: &str) -> Option<PathBuf> {
        // Try page_types group first
        if let Some(pt) = self.manifest.patterns.page_types.as_ref() {
            let rel = match page_type {
                "landing" => pt.landing.as_deref(),
                "dashboard" => pt.dashboard.as_deref(),
                "list" => pt.list.as_deref(),
                "detail" => pt.detail.as_deref(),
                "form" => pt.form.as_deref(),
                "content" => pt.content.as_deref(),
                "help" => pt.help.as_deref(),
                "profile" => pt.profile.as_deref(),
                "login" => pt.login.as_deref(),
                _ => None,
            };
            if let Some(p) = rel {
                return Some(self.adapter_root.join(p));
            }
        }
        // Fall back to generic UI view pattern
        self.resolve_ui_pattern("view")
    }

    /// List all available pattern kinds across all groups as `(group, kind)` pairs.
    pub fn available_patterns(&self) -> Vec<(String, String)> {
        let mut result = Vec::new();

        if let Some(api) = &self.manifest.patterns.api {
            for kind in [
                "service",
                "controller",
                "route",
                "test",
                "middleware",
                "types",
            ] {
                let has = match kind {
                    "service" => api.service.is_some(),
                    "controller" => api.controller.is_some(),
                    "route" => api.route.is_some(),
                    "test" => api.test.is_some(),
                    "middleware" => api.middleware.is_some(),
                    "types" => api.types.is_some(),
                    _ => false,
                };
                if has {
                    result.push(("api".to_string(), kind.to_string()));
                }
            }
        }

        if let Some(ui) = &self.manifest.patterns.ui {
            for kind in ["view", "state", "route", "test", "layout", "component"] {
                let has = match kind {
                    "view" => ui.view.is_some(),
                    "state" => ui.state.is_some(),
                    "route" => ui.route.is_some(),
                    "test" => ui.test.is_some(),
                    "layout" => ui.layout.is_some(),
                    "component" => ui.component.is_some(),
                    _ => false,
                };
                if has {
                    result.push(("ui".to_string(), kind.to_string()));
                }
            }
        }

        if let Some(data) = &self.manifest.patterns.data {
            for kind in [
                "migration",
                "query",
                "seed",
                "fixture_factory",
                "validation_schema",
            ] {
                let has = match kind {
                    "migration" => data.migration.is_some(),
                    "query" => data.query.is_some(),
                    "seed" => data.seed.is_some(),
                    "fixture_factory" => data.fixture_factory.is_some(),
                    "validation_schema" => data.validation_schema.is_some(),
                    _ => false,
                };
                if has {
                    result.push(("data".to_string(), kind.to_string()));
                }
            }
        }

        if let Some(pt) = &self.manifest.patterns.page_types {
            for kind in [
                "landing",
                "dashboard",
                "list",
                "detail",
                "form",
                "content",
                "help",
                "profile",
                "login",
            ] {
                let has = match kind {
                    "landing" => pt.landing.is_some(),
                    "dashboard" => pt.dashboard.is_some(),
                    "list" => pt.list.is_some(),
                    "detail" => pt.detail.is_some(),
                    "form" => pt.form.is_some(),
                    "content" => pt.content.is_some(),
                    "help" => pt.help.is_some(),
                    "profile" => pt.profile.is_some(),
                    "login" => pt.login.is_some(),
                    _ => false,
                };
                if has {
                    result.push(("page_types".to_string(), kind.to_string()));
                }
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter_manifest::*;
    use std::collections::HashMap;

    fn test_manifest() -> AdapterManifest {
        AdapterManifest {
            schema_version: "1.0.0".into(),
            adapter: AdapterIdentity {
                name: "test-adapter".into(),
                display_name: "Test Adapter".into(),
                version: "1.0.0".into(),
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
                    description: "Vue 3 with Composition API".into(),
                },
                database: None,
            },
            capabilities: Capabilities {
                dual_stack: true,
                single_stack: true,
                session_auth: true,
                token_auth: true,
                module_system: true,
                direct_sql: true,
                ..Default::default()
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
                api_service: Some("apps/{stack}/src/services/{resource}.service.ts".into()),
                env_file: Some(".env.example".into()),
                extra: Default::default(),
                ..Default::default()
            },
            patterns: Patterns {
                api: Some(ApiPatterns {
                    service: Some("patterns/api/service.ts".into()),
                    controller: Some("patterns/api/controller.ts".into()),
                    ..Default::default()
                }),
                ui: Some(UiPatterns {
                    view: Some("patterns/ui/view.vue".into()),
                    ..Default::default()
                }),
                data: Some(DataPatterns {
                    migration: Some("patterns/data/migration.sql".into()),
                    ..Default::default()
                }),
                page_types: Some(PageTypePatterns {
                    dashboard: Some("patterns/page-types/dashboard.md".into()),
                    ..Default::default()
                }),
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
                description: "Monorepo scaffold".into(),
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
    fn test_resolve_api_pattern() {
        let resolver = PatternResolver::new(Path::new("/adapters/test"), test_manifest());
        let path = resolver.resolve_api_pattern("service").unwrap();
        assert_eq!(
            path,
            PathBuf::from("/adapters/test/patterns/api/service.ts")
        );
    }

    #[test]
    fn test_resolve_page_type_specific() {
        let resolver = PatternResolver::new(Path::new("/adapters/test"), test_manifest());
        let path = resolver.resolve_page_type_pattern("dashboard").unwrap();
        assert_eq!(
            path,
            PathBuf::from("/adapters/test/patterns/page-types/dashboard.md")
        );
    }

    #[test]
    fn test_resolve_page_type_fallback() {
        let resolver = PatternResolver::new(Path::new("/adapters/test"), test_manifest());
        // "settings" is not a known page_type key, falls back to ui.view
        let path = resolver.resolve_page_type_pattern("settings").unwrap();
        assert_eq!(path, PathBuf::from("/adapters/test/patterns/ui/view.vue"));
    }

    #[test]
    fn test_resolve_missing_pattern() {
        let resolver = PatternResolver::new(Path::new("/adapters/test"), test_manifest());
        // "middleware" is None in the test manifest
        assert!(resolver.resolve_api_pattern("middleware").is_none());
    }

    #[test]
    fn test_available_patterns() {
        let resolver = PatternResolver::new(Path::new("/adapters/test"), test_manifest());
        let patterns = resolver.available_patterns();
        assert!(patterns.len() >= 4);
        assert!(patterns.contains(&("api".to_string(), "service".to_string())));
        assert!(patterns.contains(&("data".to_string(), "migration".to_string())));
    }
}
