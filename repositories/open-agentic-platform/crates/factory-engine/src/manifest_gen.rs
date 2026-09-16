// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-002, FR-003

//! Manifest generation for Factory workflows.
//!
//! Two functions:
//! - `generate_process_manifest()` — Build Spec derivation (stages s0–s5)
//! - `generate_scaffold_manifest()` — Dynamic fan-out from Build Spec (s6a–s6h)

use crate::FactoryError;
use crate::topo_sort::topological_sort_entities;
use factory_contracts::PatternResolver;
use factory_contracts::adapter_manifest::AdapterManifest;
use factory_contracts::build_spec::BuildSpec;
use orchestrator::effort::EffortLevel;
use orchestrator::manifest::{StepGateConfig, VerifyCommand, WorkflowManifest, WorkflowStep};
use std::path::Path;

/// Factory workflow metadata embedded in the manifest (FR-001).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FactoryManifestMetadata {
    /// Always `"factory"`.
    #[serde(rename = "type")]
    pub workflow_type: String,
    /// Adapter name (e.g., `"acme-vue-encore"`).
    pub adapter: String,
    /// Step ID that produces the frozen Build Spec.
    pub build_spec_step: String,
    /// Output artifact name for the Build Spec.
    pub build_spec_output: String,
}

// ── Stage Definitions ────────────────────────────────────────────────────────

struct StageDefinition {
    id: &'static str,
    agent_role: &'static str,
    instruction: &'static str,
    effort: EffortLevel,
    outputs: Vec<&'static str>,
    gate: Option<StepGateConfig>,
}

fn process_stages() -> Vec<StageDefinition> {
    vec![
        StageDefinition {
            id: "s0-preflight",
            agent_role: "pipeline-orchestrator",
            instruction: "Run pre-flight checks: validate business documents exist, adapter is available, all dependencies are installed.",
            effort: EffortLevel::Quick,
            outputs: vec!["preflight-report.yaml"],
            gate: None,
        },
        StageDefinition {
            id: "s1-business-requirements",
            agent_role: "business-requirements-analyst",
            instruction: "Analyze business documents and produce the business requirements deliverables: entity models, use cases, audiences, and sitemap.",
            effort: EffortLevel::Deep,
            outputs: vec![
                "entity-model.yaml",
                "use-cases.yaml",
                "audiences.yaml",
                "sitemap.yaml",
            ],
            gate: Some(StepGateConfig::Checkpoint {
                label: Some("Review business requirements".into()),
            }),
        },
        StageDefinition {
            id: "s2-service-requirements",
            agent_role: "service-designer",
            instruction: "Design service requirements from business requirements: business rules, integrations, audit requirements, and security requirements.",
            effort: EffortLevel::Deep,
            outputs: vec![
                "business-rules.yaml",
                "integrations.yaml",
                "audit-spec.yaml",
                "security-spec.yaml",
            ],
            gate: Some(StepGateConfig::Checkpoint {
                label: Some("Review service requirements".into()),
            }),
        },
        StageDefinition {
            id: "s3-data-model",
            agent_role: "data-architect",
            instruction: "Generate the data model from entity models and business rules: entity definitions with fields, constraints, relationships, and lifecycle states.",
            effort: EffortLevel::Deep,
            outputs: vec!["data-model.yaml"],
            gate: Some(StepGateConfig::Checkpoint {
                label: Some("Review data model".into()),
            }),
        },
        StageDefinition {
            id: "s4-api-specification",
            agent_role: "api-architect",
            instruction: "Generate the API specification from the data model and use cases: resources, operations, request/response schemas, auth requirements.",
            effort: EffortLevel::Deep,
            outputs: vec!["api-spec.yaml"],
            gate: Some(StepGateConfig::Checkpoint {
                label: Some("Review API specification".into()),
            }),
        },
        StageDefinition {
            id: "s5-ui-specification",
            agent_role: "ui-architect",
            instruction: "Generate the UI specification from the API spec and sitemap: pages, navigation, data sources, view types. Freeze the Build Spec.",
            effort: EffortLevel::Deep,
            outputs: vec!["ui-spec.yaml", "build-spec.yaml"],
            gate: Some(StepGateConfig::Approval {
                timeout_ms: 3_600_000, // 1 hour
                escalation: None,
                checkpoint_id: None,
            }),
        },
    ]
}

/// Generate Phase 1 (process stages) manifest from adapter and document paths (FR-002).
pub fn generate_process_manifest(
    adapter: &AdapterManifest,
    business_doc_paths: &[impl AsRef<Path>],
    _factory_root: &Path,
    project_id: Option<String>,
) -> Result<WorkflowManifest, FactoryError> {
    let stages = process_stages();
    let mut steps = Vec::with_capacity(stages.len());

    for (i, stage) in stages.iter().enumerate() {
        // Agent IDs match the frontmatter `id` field in process agent files
        // (e.g., `pipeline-orchestrator`, not `factory-pipeline-orchestrator`).
        let agent_id = stage.agent_role.to_string();

        // First stage takes business documents as inputs; subsequent stages
        // take outputs from the previous stage.
        let inputs: Vec<String> = if i == 0 {
            // Canonicalize to absolute paths so the orchestrator's split_input_ref
            // does not misinterpret relative paths as "producer_step/artifact".
            business_doc_paths
                .iter()
                .map(|p| {
                    let path = p.as_ref();
                    path.canonicalize()
                        .unwrap_or_else(|_| std::path::absolute(path).unwrap_or(path.to_path_buf()))
                        .to_string_lossy()
                        .into_owned()
                })
                .collect()
        } else {
            let prev = &stages[i - 1];
            prev.outputs
                .iter()
                .map(|o| format!("{}/{o}", prev.id))
                .collect()
        };

        let mut instruction = stage.instruction.to_string();
        instruction.push_str(&format!("\n\nAdapter: {}", adapter.adapter.name));

        steps.push(WorkflowStep {
            id: stage.id.into(),
            agent: agent_id,
            effort: stage.effort,
            inputs,
            outputs: stage.outputs.iter().map(|s| (*s).to_string()).collect(),
            instruction,
            gate: stage.gate.clone(),
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        });
    }

    Ok(WorkflowManifest {
        steps,
        project_id,
    })
}

/// Generate Phase 2 (scaffolding) manifest from a frozen Build Spec (FR-003).
///
/// Produces steps:
/// - s6a: Scaffold initialization
/// - s6b-*: One per entity (dependency-ordered)
/// - s6c-*: One per API operation (grouped by resource)
/// - s6d-*: One per UI page
/// - s6e: Configuration
/// - s6f: Trim
/// - s6g: Review / repair (Deep effort — fixes test, lint, type errors)
/// - s6h: Final validation (read-only assertion)
pub fn generate_scaffold_manifest(
    build_spec: &BuildSpec,
    adapter: &AdapterManifest,
    factory_root: &Path,
    project_id: Option<String>,
) -> Result<WorkflowManifest, FactoryError> {
    let adapter_root = factory_root.join("adapters").join(&adapter.adapter.name);
    let resolver = PatternResolver::new(&adapter_root, adapter.clone());

    let verify_commands = build_verify_commands(adapter);
    let compile_and_lint = compile_and_lint_verify_commands(adapter);

    let mut steps: Vec<WorkflowStep> = Vec::new();

    // ── s6a: Scaffold initialization ─────────────────────────────────────
    // The project directory already contains the seeded scaffold (statecraft
    // owns scaffold provisioning at create/import time, regardless of whether
    // the adapter source is a vendored local dir or an upstream pointer).
    // This step runs setup commands and verifies the project compiles before
    // any feature scaffolding begins; OPC never re-resolves the source.
    steps.push(WorkflowStep {
        id: "s6a-scaffold-init".into(),
        agent: format!("{}-configurer", adapter.adapter.name),
        effort: EffortLevel::Investigate,
        inputs: vec![],
        instruction: format!(
            "Initialize the project for scaffolding.\n\
             The project directory is the working directory (already contains the seeded scaffold).\n\
             Adapter: {}\n\n\
             Run these setup commands in order:\n{}\n\n\
             After setup completes, verify the project compiles with: {}\n\n\
             Write a scaffold-init-report.yaml summarizing what was done.",
            adapter.adapter.name,
            adapter
                .scaffold
                .setup_commands
                .iter()
                .map(|c| format!("  - {c}"))
                .collect::<Vec<_>>()
                .join("\n"),
            adapter.commands.compile,
        ),
        outputs: vec!["scaffold-init-report.yaml".into()],
        gate: None,
        pre_verify: None,
        post_verify: Some(vec![
            VerifyCommand {
                command: adapter.commands.install.clone(),
                working_dir: ".".into(),
                timeout_ms: 120_000,
            },
            VerifyCommand {
                command: adapter.commands.compile.clone(),
                working_dir: ".".into(),
                timeout_ms: 60_000,
            },
        ]),
        max_retries: Some(3),
    });

    // ── s6b-*: Data entities (dependency-ordered, FR-004) ────────────────
    let entity_order = topological_sort_entities(&build_spec.data_model.entities)?;
    let mut prev_entity_ids: Vec<String> = vec!["s6a-scaffold-init".into()];

    for entity_name in &entity_order {
        let entity = build_spec
            .data_model
            .entities
            .iter()
            .find(|e| &e.name == entity_name)
            .ok_or_else(|| FactoryError::ManifestGeneration {
                reason: format!("entity {entity_name} not found after topo sort"),
            })?;

        let step_id = format!("s6b-data-{}", entity_name);

        // Inputs: chain to the last entity step to enforce topological ordering.
        // Each entity step depends on the previous one so the orchestrator
        // cannot parallelise them out of FK dependency order.
        let inputs: Vec<String> = prev_entity_ids
            .last()
            .map(|prev| {
                let artifact = if prev == "s6a-scaffold-init" {
                    "scaffold-init-report.yaml".to_string()
                } else {
                    let prev_entity = prev.strip_prefix("s6b-data-").unwrap_or(prev);
                    format!("{prev_entity}-entity-report.yaml")
                };
                vec![format!("{prev}/{artifact}")]
            })
            .unwrap_or_default();

        let data_pattern = resolver
            .resolve_data_pattern("migration")
            .map(|p| format!("\nData pattern: {}", p.display()))
            .unwrap_or_default();

        steps.push(WorkflowStep {
            id: step_id.clone(),
            agent: format!("{}-data-scaffolder", adapter.adapter.name),
            effort: EffortLevel::Investigate,
            inputs,
            outputs: vec![format!("{entity_name}-entity-report.yaml")],
            instruction: format!(
                "Generate data model for entity: {}\n\
                 Description: {}\n\
                 Fields: {}\n\
                 Adapter: {}{data_pattern}",
                entity.name,
                entity.description.as_deref().unwrap_or(""),
                entity
                    .fields
                    .iter()
                    .map(format_field_for_instruction)
                    .collect::<Vec<_>>()
                    .join(", "),
                adapter.adapter.name,
            ),
            gate: None,
            pre_verify: None,
            post_verify: Some(compile_and_lint.clone()),
            max_retries: Some(3),
        });

        prev_entity_ids.push(step_id);
    }

    // ── s6b-seed: Seed data & fixture generation ────────────────────────
    // Runs after ALL entity data steps complete, producing reference data
    // seeds, dev fixtures, a runner script, and a fixture factory module.
    if adapter.agents.seed_generator.is_some() {
        let seed_inputs: Vec<String> = prev_entity_ids
            .iter()
            .filter(|id| id.starts_with("s6b-data-"))
            .map(|id| {
                let entity = id.strip_prefix("s6b-data-").unwrap_or(id);
                format!("{id}/{entity}-entity-report.yaml")
            })
            .collect();

        let seed_pattern = resolver
            .resolve_data_pattern("seed")
            .map(|p| format!("\nSeed pattern: {}", p.display()))
            .unwrap_or_default();

        let fixture_pattern = resolver
            .resolve_data_pattern("fixture_factory")
            .map(|p| format!("\nFixture factory pattern: {}", p.display()))
            .unwrap_or_default();

        let seed_command = adapter
            .commands
            .extra
            .get("seed")
            .and_then(|v| v.as_str())
            .map(|c| format!("\nSeed command: {c}"))
            .unwrap_or_default();

        steps.push(WorkflowStep {
            id: "s6b-seed".into(),
            agent: format!("{}-seed-generator", adapter.adapter.name),
            effort: EffortLevel::Investigate,
            inputs: seed_inputs,
            outputs: vec![
                "reference-data.sql".into(),
                "dev-fixtures.sql".into(),
                "run-seeds.ts".into(),
                "fixture-factory.ts".into(),
            ],
            instruction: format!(
                "Generate seed data, development fixtures, seed runner, and fixture factory module.\n\
                 Entities: {}\n\
                 Auth audiences: {}\n\
                 Adapter: {}{seed_pattern}{fixture_pattern}{seed_command}",
                entity_order.join(", "),
                build_spec.auth.audiences.keys().cloned().collect::<Vec<_>>().join(", "),
                adapter.adapter.name,
            ),
            gate: None,
            pre_verify: None,
            post_verify: Some(compile_and_lint.clone()),
            max_retries: Some(3),
        });
    }

    // ── s6c-*: API operations (grouped by resource) ──────────────────────

    // Resolve all API pattern files once (service, controller, route, test + data/query).
    let api_patterns_block = {
        let kinds = ["service", "controller", "route", "test"];
        let mut lines: Vec<String> = kinds
            .iter()
            .filter_map(|k| {
                resolver
                    .resolve_api_pattern(k)
                    .map(|p| format!("  {k}: {}", p.display()))
            })
            .collect();
        if let Some(p) = resolver.resolve_data_pattern("query") {
            lines.push(format!("  query: {}", p.display()));
        }
        if lines.is_empty() {
            String::new()
        } else {
            format!(
                "\nPattern files (read ALL before writing code):\n{}",
                lines.join("\n")
            )
        }
    };

    // Build directory conventions string once.
    let dir_conventions_block = {
        let dc = &adapter.directory_conventions;
        let mut parts = Vec::new();
        if let Some(ref v) = dc.api_service {
            parts.push(format!("  service: {v}"));
        }
        if let Some(ref v) = dc.api_controller {
            parts.push(format!("  controller: {v}"));
        }
        if let Some(ref v) = dc.api_route {
            parts.push(format!("  route: {v}"));
        }
        if let Some(ref v) = dc.api_test {
            parts.push(format!("  test: {v}"));
        }
        if parts.is_empty() {
            String::new()
        } else {
            format!("\nDirectory conventions:\n{}", parts.join("\n"))
        }
    };

    for resource in &build_spec.api.resources {
        // Look up the entity's fields from the data model for context.
        let entity_fields_block = build_spec
            .data_model
            .entities
            .iter()
            .find(|e| e.name == resource.entity)
            .map(|e| {
                let fields: Vec<String> =
                    e.fields.iter().map(format_field_for_instruction).collect();
                format!("\nEntity fields: {}", fields.join(", "))
            })
            .unwrap_or_default();

        // The data-entity step for this resource (if it exists) is an input dependency.
        let data_step_id = format!("s6b-data-{}", resource.entity);
        let data_step_input = if steps.iter().any(|s| s.id == data_step_id) {
            vec![format!(
                "{data_step_id}/{}-entity-report.yaml",
                resource.entity
            )]
        } else {
            vec![]
        };

        for operation in &resource.operations {
            let step_id = format!("s6c-api-{}-{}", resource.name, operation.id);

            let stack_line = operation
                .stack
                .as_ref()
                .map(|s| {
                    let name = match s {
                        factory_contracts::build_spec::StackTarget::Public => "public",
                        factory_contracts::build_spec::StackTarget::Internal => "internal",
                        factory_contracts::build_spec::StackTarget::Both => "both",
                    };
                    format!("\nStack: {name}")
                })
                .unwrap_or_default();

            steps.push(WorkflowStep {
                id: step_id,
                agent: format!("{}-api-scaffolder", adapter.adapter.name),
                effort: EffortLevel::Investigate,
                inputs: data_step_input.clone(),
                outputs: vec![format!("{}-{}-report.yaml", resource.name, operation.id)],
                instruction: format!(
                    "Generate API operation: {} {}\n\
                     Resource: {} (entity: {})\n\
                     Operation: {} — {}\n\
                     Auth: {:?}{stack_line}\n\
                     Adapter: {}{entity_fields_block}{api_patterns_block}{dir_conventions_block}",
                    operation.method.as_str(),
                    operation.path,
                    resource.name,
                    resource.entity,
                    operation.id,
                    operation.description.as_deref().unwrap_or(""),
                    operation.auth,
                    adapter.adapter.name,
                ),
                gate: None,
                pre_verify: None,
                post_verify: Some(verify_commands.clone()),
                max_retries: Some(3),
            });
        }
    }

    // ── s6d-*: UI pages ──────────────────────────────────────────────────

    // Resolve all UI pattern files once (view, state, route, test).
    let ui_patterns_block = {
        let kinds = ["view", "state", "route", "test"];
        let lines: Vec<String> = kinds
            .iter()
            .filter_map(|k| {
                resolver
                    .resolve_ui_pattern(k)
                    .map(|p| format!("  {k}: {}", p.display()))
            })
            .collect();
        if lines.is_empty() {
            String::new()
        } else {
            format!(
                "\nUI pattern files (read ALL before writing code):\n{}",
                lines.join("\n")
            )
        }
    };

    // Build UI directory conventions string once.
    let ui_dir_conventions_block = {
        let dc = &adapter.directory_conventions;
        let mut parts = Vec::new();
        if let Some(ref v) = dc.ui_view {
            parts.push(format!("  view: {v}"));
        }
        if let Some(ref v) = dc.ui_store {
            parts.push(format!("  store: {v}"));
        }
        if let Some(ref v) = dc.ui_route_config {
            parts.push(format!("  route_config: {v}"));
        }
        if let Some(ref v) = dc.ui_test {
            parts.push(format!("  test: {v}"));
        }
        if let Some(ref v) = dc.ui_component {
            parts.push(format!("  component: {v}"));
        }
        if parts.is_empty() {
            String::new()
        } else {
            format!("\nDirectory conventions:\n{}", parts.join("\n"))
        }
    };

    for page in &build_spec.ui.pages {
        let step_id = format!("s6d-ui-{}", page.id);

        let page_type_str = format!("{:?}", page.page_type).to_lowercase();
        let page_pattern = resolver
            .resolve_page_type_pattern(&page_type_str)
            .map(|p| format!("\nPage type pattern: {}", p.display()))
            .unwrap_or_default();

        // Determine the target app (web-public vs web-internal) from view_type + dual_stack.
        let stack_block = match &adapter.dual_stack {
            Some(ds) => {
                let (variant_name, web_app) = match page.view_type {
                    factory_contracts::build_spec::ViewType::Public
                    | factory_contracts::build_spec::ViewType::PublicAuthenticated => {
                        ("public", &ds.variants.public.web)
                    }
                    factory_contracts::build_spec::ViewType::PrivateAuthenticated => {
                        ("internal", &ds.variants.internal.web)
                    }
                };
                format!("\nVariant: {variant_name} (app: {web_app})")
            }
            None => String::new(),
        };

        // Resolve the audience's auth method so the scaffolding agent knows
        // which driver (SAML, OIDC, etc.) to wire into route guards.
        let audience_method = build_spec
            .auth
            .audiences
            .get(&page.audience)
            .map(|aud| format!("\nAudience: {} (auth: {:?})", page.audience, aud.method))
            .unwrap_or_else(|| format!("\nAudience: {}", page.audience));

        steps.push(WorkflowStep {
            id: step_id,
            agent: format!("{}-ui-scaffolder", adapter.adapter.name),
            effort: EffortLevel::Investigate,
            inputs: vec![],
            outputs: vec![format!("{}-page-report.yaml", page.id)],
            instruction: format!(
                "Generate UI page: {} ({})\n\
                 Path: {}\n\
                 Type: {:?}, View: {:?}\n\
                 Auth required: {}{audience_method}\n\
                 Data sources: {}\n\
                 Adapter: {}{stack_block}{page_pattern}{ui_patterns_block}{ui_dir_conventions_block}",
                page.title,
                page.id,
                page.path,
                page.page_type,
                page.view_type,
                page.requires_auth,
                page.data_sources
                    .as_ref()
                    .map(|ds| ds
                        .iter()
                        .map(|d| d.operation_id.as_str())
                        .collect::<Vec<_>>()
                        .join(", "))
                    .unwrap_or_default(),
                adapter.adapter.name,
            ),
            gate: None,
            pre_verify: None,
            post_verify: Some(compile_and_lint.clone()),
            max_retries: Some(3),
        });
    }

    // ── s6e: Configuration ───────────────────────────────────────────────
    let audience_lines: String = build_spec
        .auth
        .audiences
        .iter()
        .map(|(name, aud)| format!("  - {name}: {:?}", aud.method))
        .collect::<Vec<_>>()
        .join("\n");

    steps.push(WorkflowStep {
        id: "s6e-configure".into(),
        agent: format!("{}-configurer", adapter.adapter.name),
        effort: EffortLevel::Investigate,
        inputs: vec![],
        outputs: vec!["configure-report.yaml".into()],
        instruction: format!(
            "Apply project configuration: set project identity ({}), wire auth, \
             configure environment variables, apply deployment variant ({:?}).\n\
             Audiences:\n{audience_lines}\n\
             Adapter: {}",
            build_spec.project.name, build_spec.project.variant, adapter.adapter.name,
        ),
        gate: None,
        pre_verify: None,
        post_verify: Some(compile_and_lint.clone()),
        max_retries: Some(3),
    });

    // ── s6f: Trim ────────────────────────────────────────────────────────
    steps.push(WorkflowStep {
        id: "s6f-trim".into(),
        agent: format!("{}-trimmer", adapter.adapter.name),
        effort: EffortLevel::Investigate,
        inputs: vec![],
        outputs: vec!["trim-report.yaml".into()],
        instruction: format!(
            "Remove unused scaffold artifacts. Clean up placeholder files, unused imports, \
             and template remnants.\nAdapter: {}",
            adapter.adapter.name,
        ),
        gate: None,
        pre_verify: None,
        post_verify: Some(compile_and_lint.clone()),
        max_retries: Some(3),
    });

    // ── s6g: Review / repair ────────────────────────────────────────────
    // Dedicated repair step that runs the full suite, fixes all failures,
    // and absorbs the iterative fix-rerun loop that previously overloaded
    // the final-validation step. Uses Deep effort (2× max_turns).
    {
        let reviewer_agent = if adapter.agents.reviewer.is_some() {
            format!("{}-reviewer", adapter.adapter.name)
        } else {
            "pipeline-orchestrator".into()
        };
        steps.push(WorkflowStep {
            id: "s6g-review".into(),
            agent: reviewer_agent,
            effort: EffortLevel::Deep,
            inputs: vec![],
            outputs: vec!["review-report.yaml".into()],
            instruction: format!(
                "Run the full project quality suite and fix every failure:\n\
                 1. Run build: {}\n\
                 2. Run tests: {}\n\
                 3. Run lint: {}\n\
                 {}\
                 Fix ALL errors and warnings — broken tests, lint violations, type errors, \
                 unused imports, selector mismatches, mock drift.\n\
                 Write review-report.yaml summarizing every file changed and why.\n\
                 Adapter: {}",
                adapter.commands.compile,
                adapter.commands.test,
                adapter.commands.lint,
                adapter
                    .commands
                    .type_check
                    .as_ref()
                    .map(|tc| format!("4. Run type check: {tc}\n"))
                    .unwrap_or_default(),
                adapter.adapter.name,
            ),
            gate: None,
            pre_verify: None,
            post_verify: Some(build_full_verify_commands(adapter)),
            max_retries: Some(3),
        });
    }

    // ── s6h: Final validation (read-only assertion) ─────────────────────
    // This step ONLY runs commands and reports results. It must NOT fix
    // anything — if the review step did its job, this is a 3-5 turn pass.
    steps.push(WorkflowStep {
        id: "s6h-final-validation".into(),
        agent: "pipeline-orchestrator".into(),
        effort: EffortLevel::Investigate,
        inputs: vec![],
        outputs: vec!["final-validation-report.yaml".into()],
        instruction: format!(
            "Run the full project validation suite and report results.\n\
             IMPORTANT: This is a READ-ONLY assertion step. Do NOT edit any source files.\n\
             Run each command, record its exit code and output summary:\n\
             1. Build: {}\n\
             2. Tests: {}\n\
             3. Lint: {}\n\
             {}\
             Write final-validation-report.yaml with pass/fail status for each check.\n\
             If any check fails, report the failure details — do NOT attempt to fix them.\n\
             Adapter: {}",
            adapter.commands.compile,
            adapter.commands.test,
            adapter.commands.lint,
            adapter
                .commands
                .type_check
                .as_ref()
                .map(|tc| format!("4. Type check: {tc}\n"))
                .unwrap_or_default(),
            adapter.adapter.name,
        ),
        gate: Some(StepGateConfig::Checkpoint {
            label: Some("Review final validation results".into()),
        }),
        pre_verify: None,
        post_verify: Some(build_full_verify_commands(adapter)),
        max_retries: Some(3),
    });

    Ok(WorkflowManifest {
        steps,
        project_id,
    })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Compile + test verification commands (for API scaffolding steps).
fn build_verify_commands(adapter: &AdapterManifest) -> Vec<VerifyCommand> {
    let mut cmds = vec![VerifyCommand {
        command: adapter.commands.compile.clone(),
        working_dir: ".".into(),
        timeout_ms: 60_000,
    }];
    // Add feature_verify commands.
    for cmd in &adapter.commands.feature_verify {
        cmds.push(VerifyCommand {
            command: cmd.clone(),
            working_dir: ".".into(),
            timeout_ms: 60_000,
        });
    }
    cmds
}

/// Compile + lint verification (for data/UI/config/trim steps).
///
/// Catches both compile errors and lint violations incrementally so they
/// don't accumulate until final validation.
fn compile_and_lint_verify_commands(adapter: &AdapterManifest) -> Vec<VerifyCommand> {
    vec![
        VerifyCommand {
            command: adapter.commands.compile.clone(),
            working_dir: ".".into(),
            timeout_ms: 60_000,
        },
        VerifyCommand {
            command: adapter.commands.lint.clone(),
            working_dir: ".".into(),
            timeout_ms: 60_000,
        },
    ]
}

/// Full verification for final validation step.
fn build_full_verify_commands(adapter: &AdapterManifest) -> Vec<VerifyCommand> {
    let mut cmds = vec![
        VerifyCommand {
            command: adapter.commands.compile.clone(),
            working_dir: ".".into(),
            timeout_ms: 120_000,
        },
        VerifyCommand {
            command: adapter.commands.test.clone(),
            working_dir: ".".into(),
            timeout_ms: 300_000,
        },
        VerifyCommand {
            command: adapter.commands.lint.clone(),
            working_dir: ".".into(),
            timeout_ms: 60_000,
        },
    ];
    if let Some(ref tc) = adapter.commands.type_check {
        cmds.push(VerifyCommand {
            command: tc.clone(),
            working_dir: ".".into(),
            timeout_ms: 60_000,
        });
    }
    cmds
}

/// Format a field definition for inclusion in agent instructions.
///
/// Includes enum values, reference targets, max_length, and precision/scale
/// inline so the scaffolding agent has the full spec — preventing it from
/// improvising or simplifying enum values.
fn format_field_for_instruction(f: &factory_contracts::build_spec::Field) -> String {
    use factory_contracts::build_spec::FieldType;

    let type_str = match f.field_type {
        FieldType::Enum => {
            if let Some(ref vals) = f.enum_values {
                format!("Enum({})", vals.join("|"))
            } else {
                "Enum".to_string()
            }
        }
        FieldType::Reference => {
            if let Some(ref entity) = f.ref_entity {
                let field = f.ref_field.as_deref().unwrap_or("id");
                let on_delete = f
                    .ref_on_delete
                    .as_ref()
                    .map(|d| format!(" ON DELETE {:?}", d))
                    .unwrap_or_default();
                format!("Reference({}.{}{})", entity, field, on_delete)
            } else {
                "Reference".to_string()
            }
        }
        FieldType::Decimal => match (f.precision, f.scale) {
            (Some(p), Some(s)) => format!("Decimal({},{})", p, s),
            (Some(p), None) => format!("Decimal({})", p),
            _ => "Decimal".to_string(),
        },
        FieldType::String => {
            if let Some(max) = f.max_length {
                format!("String({})", max)
            } else {
                "String".to_string()
            }
        }
        ref other => format!("{:?}", other),
    };

    let required = if f.required { "" } else { "?" };
    let primary = if f.primary { " PK" } else { "" };

    format!("{}: {}{}{}", f.name, type_str, required, primary)
}

/// Helper: HttpMethod to string.
trait HttpMethodStr {
    fn as_str(&self) -> &'static str;
}

impl HttpMethodStr for factory_contracts::build_spec::HttpMethod {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
            Self::Head => "HEAD",
            Self::Options => "OPTIONS",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_manifest_has_six_stages() {
        let adapter = test_adapter();
        let manifest = generate_process_manifest(
            &adapter,
            &["/docs/business-doc.md"],
            Path::new("/tmp/factory"),
            None,
        )
        .unwrap();

        assert_eq!(manifest.steps.len(), 6);
        assert_eq!(manifest.steps[0].id, "s0-preflight");
        assert_eq!(manifest.steps[5].id, "s5-ui-specification");

        // Stage 5 should have approval gate.
        assert!(matches!(
            manifest.steps[5].gate,
            Some(StepGateConfig::Approval { .. })
        ));

        // Stage 1-4 should have checkpoint gates.
        for step in &manifest.steps[1..5] {
            assert!(matches!(step.gate, Some(StepGateConfig::Checkpoint { .. })));
        }
    }

    #[test]
    fn process_manifest_agent_ids_match_frontmatter() {
        let adapter = test_adapter();
        let manifest = generate_process_manifest(
            &adapter,
            &["/docs/input.md"],
            Path::new("/tmp/factory"),
            None,
        )
        .unwrap();

        // Agent IDs should match the frontmatter `id` field in process agent files
        // (e.g., "pipeline-orchestrator", "business-requirements-analyst").
        let expected = [
            "pipeline-orchestrator",
            "business-requirements-analyst",
            "service-designer",
            "data-architect",
            "api-architect",
            "ui-architect",
        ];
        for (step, expected_id) in manifest.steps.iter().zip(expected.iter()) {
            assert_eq!(
                step.agent, *expected_id,
                "step {} should have agent {}",
                step.id, expected_id
            );
        }
    }

    #[test]
    fn project_id_threads_through_process_manifest() {
        let adapter = test_adapter();
        let manifest = generate_process_manifest(
            &adapter,
            &["/docs/input.md"],
            Path::new("/tmp/factory"),
            Some("ws-test-092".into()),
        )
        .unwrap();
        assert_eq!(manifest.project_id, Some("ws-test-092".into()));
    }

    #[test]
    fn project_id_none_when_omitted() {
        let adapter = test_adapter();
        let manifest = generate_process_manifest(
            &adapter,
            &["/docs/input.md"],
            Path::new("/tmp/factory"),
            None,
        )
        .unwrap();
        assert_eq!(manifest.project_id, None);
    }

    fn test_adapter() -> AdapterManifest {
        use factory_contracts::adapter_manifest::*;
        use std::collections::HashMap;

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
                runtime: "node".into(),
                backend: BackendSpec {
                    framework: "express".into(),
                    description: "Express.js".into(),
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
                feature_verify: vec!["npx tsc --noEmit".into()],
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
                description: "Base project".into(),
                modules: HashMap::new(),
                setup_commands: vec!["npm install".into()],
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
    fn format_field_includes_enum_values() {
        use factory_contracts::build_spec::{Field, FieldType};

        let field = Field {
            name: "requestStatus".into(),
            field_type: FieldType::Enum,
            primary: false,
            required: true,
            unique: None,
            default: None,
            description: None,
            enum_values: Some(vec![
                "draft".into(),
                "submitted".into(),
                "under-review".into(),
                "approved".into(),
                "denied".into(),
            ]),
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: None,
            ref_field: None,
            ref_on_delete: None,
        };

        let result = format_field_for_instruction(&field);
        assert_eq!(
            result,
            "requestStatus: Enum(draft|submitted|under-review|approved|denied)"
        );
    }

    #[test]
    fn format_field_includes_reference_target() {
        use factory_contracts::build_spec::{Field, FieldType, RefOnDelete};

        let field = Field {
            name: "organizationId".into(),
            field_type: FieldType::Reference,
            primary: false,
            required: true,
            unique: None,
            default: None,
            description: None,
            enum_values: None,
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: Some("Organization".into()),
            ref_field: Some("organizationId".into()),
            ref_on_delete: Some(RefOnDelete::Cascade),
        };

        let result = format_field_for_instruction(&field);
        assert_eq!(
            result,
            "organizationId: Reference(Organization.organizationId ON DELETE Cascade)"
        );
    }

    #[test]
    fn format_field_optional_marker() {
        use factory_contracts::build_spec::{Field, FieldType};

        let field = Field {
            name: "submittedBy".into(),
            field_type: FieldType::Reference,
            primary: false,
            required: false,
            unique: None,
            default: None,
            description: None,
            enum_values: None,
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: Some("PortalUser".into()),
            ref_field: Some("userId".into()),
            ref_on_delete: None,
        };

        let result = format_field_for_instruction(&field);
        assert_eq!(result, "submittedBy: Reference(PortalUser.userId)?");
    }

    #[test]
    fn format_field_decimal_with_precision() {
        use factory_contracts::build_spec::{Field, FieldType};

        let field = Field {
            name: "amount".into(),
            field_type: FieldType::Decimal,
            primary: false,
            required: true,
            unique: None,
            default: None,
            description: None,
            enum_values: None,
            precision: Some(14),
            scale: Some(2),
            max_length: None,
            min_length: None,
            ref_entity: None,
            ref_field: None,
            ref_on_delete: None,
        };

        let result = format_field_for_instruction(&field);
        assert_eq!(result, "amount: Decimal(14,2)");
    }

    #[test]
    fn format_field_primary_key_marker() {
        use factory_contracts::build_spec::{Field, FieldType};

        let field = Field {
            name: "id".into(),
            field_type: FieldType::Uuid,
            primary: true,
            required: true,
            unique: None,
            default: None,
            description: None,
            enum_values: None,
            precision: None,
            scale: None,
            max_length: None,
            min_length: None,
            ref_entity: None,
            ref_field: None,
            ref_on_delete: None,
        };

        let result = format_field_for_instruction(&field);
        assert_eq!(result, "id: Uuid PK");
    }
}
