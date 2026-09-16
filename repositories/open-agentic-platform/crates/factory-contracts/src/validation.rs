// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Schema validation for Factory contract types.
//!
//! Validates YAML/JSON files against the typed Rust representations with
//! error accumulation — reports all issues found, not just the first one.

use crate::adapter_manifest::AdapterManifest;
use crate::build_spec::{BuildSpec, FieldType};
use crate::pipeline_state::PipelineState;
use crate::verification::VerificationContract;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("IO error reading {path}: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },

    #[error("YAML parse error in {path}: {source}")]
    YamlParse {
        path: String,
        source: serde_yaml::Error,
    },

    #[error("JSON parse error in {path}: {source}")]
    JsonParse {
        path: String,
        source: serde_json::Error,
    },

    #[error("{path}: {message}")]
    Semantic { path: String, message: String },
}

/// Validate and parse a Build Spec from a YAML or JSON file.
///
/// Returns the parsed `BuildSpec` or a list of all validation errors found.
pub fn validate_build_spec(path: &Path) -> Result<BuildSpec, Vec<ValidationError>> {
    let path_str = path.display().to_string();
    let contents = std::fs::read_to_string(path).map_err(|e| {
        vec![ValidationError::Io {
            path: path_str.clone(),
            source: e,
        }]
    })?;

    let spec: BuildSpec = parse_yaml_or_json(&path_str, &contents)?;

    let mut errors = Vec::new();
    validate_build_spec_semantics(&path_str, &spec, &mut errors);

    if errors.is_empty() {
        Ok(spec)
    } else {
        Err(errors)
    }
}

/// Validate and parse an Adapter Manifest from a YAML or JSON file.
pub fn validate_adapter_manifest(path: &Path) -> Result<AdapterManifest, Vec<ValidationError>> {
    let path_str = path.display().to_string();
    let contents = std::fs::read_to_string(path).map_err(|e| {
        vec![ValidationError::Io {
            path: path_str.clone(),
            source: e,
        }]
    })?;

    let manifest: AdapterManifest = parse_yaml_or_json(&path_str, &contents)?;

    let mut errors = Vec::new();
    validate_adapter_manifest_semantics(&path_str, &manifest, &mut errors);

    if errors.is_empty() {
        Ok(manifest)
    } else {
        Err(errors)
    }
}

/// Validate and parse a Pipeline State from a YAML or JSON file.
pub fn validate_pipeline_state(path: &Path) -> Result<PipelineState, Vec<ValidationError>> {
    let path_str = path.display().to_string();
    let contents = std::fs::read_to_string(path).map_err(|e| {
        vec![ValidationError::Io {
            path: path_str.clone(),
            source: e,
        }]
    })?;

    let state: PipelineState = parse_yaml_or_json(&path_str, &contents)?;
    Ok(state)
}

/// Validate and parse a Verification Contract from a YAML or JSON file.
pub fn validate_verification_contract(
    path: &Path,
) -> Result<VerificationContract, Vec<ValidationError>> {
    let path_str = path.display().to_string();
    let contents = std::fs::read_to_string(path).map_err(|e| {
        vec![ValidationError::Io {
            path: path_str.clone(),
            source: e,
        }]
    })?;

    let contract: VerificationContract = parse_yaml_or_json(&path_str, &contents)?;
    Ok(contract)
}

// ── Helpers ───────────────────────────────────────────────────────────

fn parse_yaml_or_json<T: serde::de::DeserializeOwned>(
    path: &str,
    contents: &str,
) -> Result<T, Vec<ValidationError>> {
    if path.ends_with(".json") {
        serde_json::from_str(contents).map_err(|e| {
            vec![ValidationError::JsonParse {
                path: path.to_string(),
                source: e,
            }]
        })
    } else {
        serde_yaml::from_str(contents).map_err(|e| {
            vec![ValidationError::YamlParse {
                path: path.to_string(),
                source: e,
            }]
        })
    }
}

fn validate_build_spec_semantics(path: &str, spec: &BuildSpec, errors: &mut Vec<ValidationError>) {
    // Check entity names are non-empty
    for entity in &spec.data_model.entities {
        if entity.name.is_empty() {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: "Entity has empty name".to_string(),
            });
        }

        // Check fields reference valid enum values when type is Enum
        for field in &entity.fields {
            if field.field_type == FieldType::Enum && field.enum_values.is_none() {
                errors.push(ValidationError::Semantic {
                    path: path.to_string(),
                    message: format!(
                        "Entity '{}' field '{}' is type enum but has no enum_values",
                        entity.name, field.name
                    ),
                });
            }

            // Check reference fields have a reference target
            if field.field_type == FieldType::Reference && field.ref_entity.is_none() {
                errors.push(ValidationError::Semantic {
                    path: path.to_string(),
                    message: format!(
                        "Entity '{}' field '{}' is type reference but has no ref_entity",
                        entity.name, field.name
                    ),
                });
            }
        }
    }

    // Check business rule IDs are unique
    let mut br_ids = std::collections::HashSet::new();
    for rule in &spec.business_rules {
        if !br_ids.insert(&rule.id) {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!("Duplicate business rule ID: {}", rule.id),
            });
        }
    }

    // Check API operation IDs are unique and business rule refs are valid
    let mut op_ids = std::collections::HashSet::new();
    for resource in &spec.api.resources {
        for op in &resource.operations {
            if !op_ids.insert(&op.id) {
                errors.push(ValidationError::Semantic {
                    path: path.to_string(),
                    message: format!("Duplicate API operation ID: {}", op.id),
                });
            }

            if let Some(refs) = &op.business_rules {
                for br_ref in refs {
                    if !br_ids.contains(br_ref) {
                        errors.push(ValidationError::Semantic {
                            path: path.to_string(),
                            message: format!(
                                "Operation '{}' references unknown business rule '{}'",
                                op.id, br_ref
                            ),
                        });
                    }
                }
            }
        }
    }

    // Check page IDs are unique
    let mut page_ids = std::collections::HashSet::new();
    for page in &spec.ui.pages {
        if !page_ids.insert(&page.id) {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!("Duplicate page ID: {}", page.id),
            });
        }
    }
}

fn validate_adapter_manifest_semantics(
    path: &str,
    manifest: &AdapterManifest,
    errors: &mut Vec<ValidationError>,
) {
    // Adapter name must be non-empty
    if manifest.adapter.name.is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "Adapter name is empty".to_string(),
        });
    }

    // Scaffold source must carry a usable identifier — either a non-empty
    // local relative path (`Local`) or a non-empty upstream remote (`Upstream`).
    if manifest.scaffold.source.is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "Scaffold source is empty (set a local path or an upstream remote)"
                .to_string(),
        });
    }

    // Validation invariant IDs must be unique
    let mut inv_ids = std::collections::HashSet::new();
    for inv in &manifest.validation.invariants {
        if !inv_ids.insert(&inv.id) {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!("Duplicate validation invariant ID: {}", inv.id),
            });
        }
    }

    // feature_verify commands should be non-empty strings
    for cmd in &manifest.commands.feature_verify {
        if cmd.trim().is_empty() {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: "Empty feature_verify command".to_string(),
            });
        }
    }

    // ── Spec 198 FR-012: schema_version ↔ governance coherence ──────
    if !crate::adapter_manifest::ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS
        .contains(&manifest.schema_version.as_str())
    {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: format!(
                "Unsupported adapter-manifest schema_version '{}' (accepted: {})",
                manifest.schema_version,
                crate::adapter_manifest::ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS.join(", ")
            ),
        });
    }
    match (&manifest.schema_version[..], &manifest.governance) {
        ("1.1.0", None) => errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "schema_version 1.1.0 requires a governance: section (spec 198 FR-012)"
                .to_string(),
        }),
        ("1.0.0", Some(_)) => errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "governance: section requires schema_version 1.1.0".to_string(),
        }),
        _ => {}
    }
    if let Some(gov) = &manifest.governance {
        if gov.file_write_scope.is_empty() {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: "governance.file_write_scope is empty (an adapter that writes nowhere scaffolds nothing)".to_string(),
            });
        }
        if gov.allowed_commands_from != "commands" {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!(
                    "governance.allowed_commands_from '{}' — the only defined value is 'commands'",
                    gov.allowed_commands_from
                ),
            });
        }
        if gov.agents_from != "agents" {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!(
                    "governance.agents_from '{}' — the only defined value is 'agents'",
                    gov.agents_from
                ),
            });
        }
        if gov.scaffold_execution.isolation != "sandbox-required" {
            errors.push(ValidationError::Semantic {
                path: path.to_string(),
                message: format!(
                    "governance.scaffold_execution.isolation '{}' — the only defined value is 'sandbox-required' (fail-closed on unknown isolation)",
                    gov.scaffold_execution.isolation
                ),
            });
        }
    }
}

/// Validate and parse a Governance Envelope (the process-layer half of the
/// spec 198 admission contract) from a YAML or JSON file.
pub fn validate_governance_envelope(
    path: &Path,
) -> Result<crate::governance_envelope::GovernanceEnvelope, Vec<ValidationError>> {
    let path_str = path.display().to_string();
    let contents = std::fs::read_to_string(path).map_err(|e| {
        vec![ValidationError::Io {
            path: path_str.clone(),
            source: e,
        }]
    })?;

    let envelope: crate::governance_envelope::GovernanceEnvelope =
        parse_yaml_or_json(&path_str, &contents)?;

    let mut errors = Vec::new();
    validate_governance_envelope_semantics(&path_str, &envelope, &mut errors);

    if errors.is_empty() {
        Ok(envelope)
    } else {
        Err(errors)
    }
}

fn validate_governance_envelope_semantics(
    path: &str,
    envelope: &crate::governance_envelope::GovernanceEnvelope,
    errors: &mut Vec<ValidationError>,
) {
    if envelope.schema_version != crate::governance_envelope::GOVERNANCE_ENVELOPE_SCHEMA_VERSION {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: format!(
                "Unsupported governance-envelope schema_version '{}' (expected {})",
                envelope.schema_version,
                crate::governance_envelope::GOVERNANCE_ENVELOPE_SCHEMA_VERSION
            ),
        });
    }
    if envelope.process.id.trim().is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "process.id is empty".to_string(),
        });
    }
    if envelope.process.objective_class.trim().is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "process.objective_class is empty (the intent-capsule template must declare an objective class — ASI01 m5)".to_string(),
        });
    }
    if envelope.emits.is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "emits is empty (a run that emits nothing is not governable)".to_string(),
        });
    }
    if envelope.constituents.agents.trim().is_empty() {
        errors.push(ValidationError::Semantic {
            path: path.to_string(),
            message: "constituents.agents is empty (the envelope must point at the agent frontmatter it composes)".to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_validate_minimal_build_spec() {
        let yaml = r#"
schema_version: "1.0.0"
project:
  name: test-app
  display_name: Test App
  org: test-org
  description: A test application
  variant: single-public
auth:
  audiences:
    staff:
      method: oidc
      provisioning_model: admin-only
      roles:
        - role_code: admin
          display_name: Administrator
          description: Admin role
data_model:
  entities:
    - name: User
      fields:
        - name: id
          type: uuid
          required: true
        - name: email
          type: string
          required: true
business_rules:
  - id: BR-001
    name: Unique emails
    description: Users must have unique emails
    type: validation
    enforced_at: service
    entities: ["User"]
api:
  resources:
    - name: users
      entity: User
      operations:
        - id: list-users
          method: GET
          path: /
          auth: required
          response:
            type: list
            entity: User
ui:
  pages:
    - id: login
      title: Login
      path: /login
      page_type: login
      audience: staff
      view_type: public
      requires_auth: false
"#;
        let mut file = NamedTempFile::with_suffix(".yaml").unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let result = validate_build_spec(file.path());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
    }

    #[test]
    fn test_validate_build_spec_detects_duplicate_br_ids() {
        let yaml = r#"
schema_version: "1.0.0"
project:
  name: test-app
  display_name: Test App
  org: test-org
  description: A test application
  variant: dual
auth:
  audiences:
    staff:
      method: oidc
      provisioning_model: admin-only
      roles: []
data_model:
  entities: []
business_rules:
  - id: BR-001
    name: First rule
    description: First rule description
    type: constraint
    enforced_at: service
    entities: []
  - id: BR-001
    name: Duplicate rule
    description: Duplicate rule description
    type: constraint
    enforced_at: service
    entities: []
api:
  resources: []
ui:
  pages: []
"#;
        let mut file = NamedTempFile::with_suffix(".yaml").unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let result = validate_build_spec(file.path());
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(
            errs.iter()
                .any(|e| e.to_string().contains("Duplicate business rule ID"))
        );
    }

    #[test]
    fn test_validate_build_spec_detects_enum_without_values() {
        let yaml = r#"
schema_version: "1.0.0"
project:
  name: test-app
  display_name: Test App
  org: test-org
  description: A test
  variant: single-internal
auth:
  audiences:
    staff:
      method: mock
      provisioning_model: admin-only
      roles: []
data_model:
  entities:
    - name: Order
      fields:
        - name: status
          type: enum
          required: true
business_rules: []
api:
  resources: []
ui:
  pages: []
"#;
        let mut file = NamedTempFile::with_suffix(".yaml").unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let result = validate_build_spec(file.path());
        assert!(result.is_err());
        let errs = result.unwrap_err();
        assert!(
            errs.iter()
                .any(|e| e.to_string().contains("enum but has no enum_values"))
        );
    }

    #[test]
    fn test_round_trip_build_spec() {
        let yaml = r#"
schema_version: "1.0.0"
project:
  name: round-trip
  display_name: Round Trip
  org: test
  description: Tests round-trip fidelity
  variant: dual
auth:
  audiences:
    citizen:
      method: saml
      provider: gov-citizen-account
      provisioning_model: open-authenticated
      roles:
        - role_code: applicant
          display_name: Applicant
          description: A facility applicant
data_model:
  entities:
    - name: Item
      fields:
        - name: id
          type: uuid
          primary: true
          required: true
        - name: name
          type: string
          required: true
business_rules:
  - id: BR-001
    name: Items must have names
    description: Items must have names
    type: validation
    enforced_at: service
    entities: ["Item"]
api:
  resources:
    - name: items
      entity: Item
      operations:
        - id: get-item
          method: GET
          path: /:id
          auth: required
          response:
            type: single
            entity: Item
ui:
  pages:
    - id: items-list
      title: Items
      path: /items
      page_type: list
      audience: citizen
      view_type: public-authenticated
      requires_auth: true
"#;
        let spec: BuildSpec = serde_yaml::from_str(yaml).unwrap();
        let serialized = serde_yaml::to_string(&spec).unwrap();
        let reparsed: BuildSpec = serde_yaml::from_str(&serialized).unwrap();

        // Verify key fields survive round-trip
        assert_eq!(spec.project.name, reparsed.project.name);
        assert_eq!(spec.project.variant, reparsed.project.variant);
        assert_eq!(
            spec.data_model.entities.len(),
            reparsed.data_model.entities.len()
        );
        assert_eq!(spec.business_rules.len(), reparsed.business_rules.len());
        assert_eq!(spec.api.resources.len(), reparsed.api.resources.len());
        assert_eq!(spec.ui.pages.len(), reparsed.ui.pages.len());
    }

    #[test]
    fn test_parse_real_build_spec_example() {
        let path = std::path::Path::new(
            "../../factory/contract/examples/community-grant-portal.build-spec.yaml",
        );
        if path.exists() {
            let result = validate_build_spec(path);
            assert!(
                result.is_ok(),
                "Failed to parse real example: {:?}",
                result.err()
            );
        }
    }

    #[test]
    fn test_parse_real_adapter_manifest_example() {
        let path = std::path::Path::new(
            "../../factory/contract/examples/acme-vue-node.adapter-manifest.yaml",
        );
        if path.exists() {
            let result = validate_adapter_manifest(path);
            assert!(
                result.is_ok(),
                "Failed to parse real manifest: {:?}",
                result.err()
            );
        }
    }

    // ── SC-001: All contract examples parse without error ────────────────

    #[test]
    fn test_parse_site_monitor_build_spec_example() {
        let path =
            std::path::Path::new("../../factory/contract/examples/site-monitor.build-spec.yaml");
        if !path.exists() {
            return;
        }
        let result = validate_build_spec(path);
        assert!(
            result.is_ok(),
            "Failed to parse site-monitor example: {:?}",
            result.err()
        );
    }

    #[test]
    fn test_all_contract_examples_parse() {
        use std::path::Path;
        let examples_dir = Path::new("../../factory/contract/examples");
        if !examples_dir.exists() {
            return;
        }

        let build_specs = [
            "community-grant-portal.build-spec.yaml",
            "site-monitor.build-spec.yaml",
        ];
        for name in &build_specs {
            let path = examples_dir.join(name);
            assert!(path.exists(), "example file missing: {name}");
            let result = validate_build_spec(&path);
            assert!(result.is_ok(), "failed to parse {name}: {:?}", result.err());
        }

        let manifests = ["acme-vue-node.adapter-manifest.yaml"];
        for name in &manifests {
            let path = examples_dir.join(name);
            assert!(path.exists(), "example file missing: {name}");
            let result = validate_adapter_manifest(&path);
            assert!(result.is_ok(), "failed to parse {name}: {:?}", result.err());
        }
    }

    // ── SC-004: Round-trip YAML → Rust → YAML against real examples ─────

    #[test]
    fn test_round_trip_community_grant_portal() {
        use crate::build_spec::BuildSpec;
        let path = std::path::Path::new(
            "../../factory/contract/examples/community-grant-portal.build-spec.yaml",
        );
        if !path.exists() {
            return;
        }
        let spec = validate_build_spec(path).expect("parse original");
        let serialized = serde_yaml::to_string(&spec).unwrap();
        let reparsed: BuildSpec = serde_yaml::from_str(&serialized).unwrap();

        assert_eq!(spec.project.name, reparsed.project.name);
        assert_eq!(spec.project.variant, reparsed.project.variant);
        assert_eq!(spec.project.org, reparsed.project.org);
        assert_eq!(
            spec.data_model.entities.len(),
            reparsed.data_model.entities.len()
        );
        assert_eq!(spec.business_rules.len(), reparsed.business_rules.len());
        assert_eq!(spec.api.resources.len(), reparsed.api.resources.len());
        assert_eq!(spec.ui.pages.len(), reparsed.ui.pages.len());
        assert_eq!(spec.auth.audiences.len(), reparsed.auth.audiences.len());
    }

    #[test]
    fn test_round_trip_site_monitor() {
        use crate::build_spec::BuildSpec;
        let path =
            std::path::Path::new("../../factory/contract/examples/site-monitor.build-spec.yaml");
        if !path.exists() {
            return;
        }
        let spec = validate_build_spec(path).expect("parse original");
        let serialized = serde_yaml::to_string(&spec).unwrap();
        let reparsed: BuildSpec = serde_yaml::from_str(&serialized).unwrap();

        assert_eq!(spec.project.name, reparsed.project.name);
        assert_eq!(spec.project.variant, reparsed.project.variant);
        assert_eq!(
            spec.data_model.entities.len(),
            reparsed.data_model.entities.len()
        );
        assert_eq!(spec.api.resources.len(), reparsed.api.resources.len());
        assert_eq!(spec.ui.pages.len(), reparsed.ui.pages.len());
    }
}
