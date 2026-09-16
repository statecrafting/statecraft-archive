// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 043-agent-organizer — registry integration (specs/043-agent-organizer/spec.md FR-007, FR-010)

use crate::complexity::score_complexity;
use crate::dispatch::{MandatoryOutcome, evaluate_mandatory_triggers};
use crate::plan::{
    AgentRole, ComplexityBand, ComplexityBlock, ComplexityBreakdown, ExecutionPlan, ModelTier,
    PlanContext, PlanMode, TeamAgent, TeamBlock, WorkflowBlock, WorkflowPhase,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const FR010_WARNING: &str =
    "agent_registry_empty_or_unavailable: degraded to direct mode per FR-010";

/// Planner interface for delegated plans (Phase 4 — Haiku-backed in production).
pub trait OrganizerPlanner {
    fn plan_delegated(
        &self,
        prompt: &str,
        breakdown: &ComplexityBreakdown,
        snapshot: &AgentRegistrySnapshot,
    ) -> (TeamBlock, WorkflowBlock, Vec<String>);
}

/// Default deterministic planner used in tests and legacy callers.
///
/// In production, a Haiku-backed planner can implement [`OrganizerPlanner`] and be
/// injected via `plan_with_planner`.
#[derive(Debug, Default)]
pub struct DeterministicOrganizerPlanner;

impl OrganizerPlanner for DeterministicOrganizerPlanner {
    fn plan_delegated(
        &self,
        prompt: &str,
        breakdown: &ComplexityBreakdown,
        snapshot: &AgentRegistrySnapshot,
    ) -> (TeamBlock, WorkflowBlock, Vec<String>) {
        assemble_delegated_plan(snapshot, breakdown.band, prompt)
    }
}

/// Single row from the agent catalog (Feature 042 injection surface).
///
/// Enriched with Tier 1 frontmatter fields from spec 054 for
/// governance-aware team selection by the organizer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentRegistryEntry {
    pub id: String,
    pub description: String,
    /// Agent execution type (spec 054 FR-004).
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "type")]
    pub agent_type: Option<String>,
    /// LLM model identifier (spec 054).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Catalog tags (spec 054).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Safety tier classification (spec 054 FR-006).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safety_tier: Option<String>,
}

/// Snapshot injected from desktop / SQLite (O-002).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentRegistrySnapshot {
    pub agents: Vec<AgentRegistryEntry>,
}

impl AgentRegistrySnapshot {
    /// Load agent registry from a JSON config file.
    ///
    /// Expected format: `{ "agents": [{ "id": "...", "description": "..." }, ...] }`
    pub fn from_config(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            format!(
                "Failed to read agent registry config at {}: {}",
                path.display(),
                e
            )
        })?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse agent registry config: {}", e))
    }

    /// Load from config file, falling back to `legacy_stub` on failure.
    #[allow(deprecated)]
    pub fn from_config_or_stub(path: &std::path::Path) -> Self {
        Self::from_config(path).unwrap_or_else(|_| Self::legacy_stub())
    }

    /// Default path for the agent registry config file relative to the workspace root.
    pub const DEFAULT_REGISTRY_PATH: &'static str = "build/agent-registry.json";

    /// Loads the agent registry from the default path within a workspace root,
    /// falling back to the legacy stub if the file is missing.
    pub fn from_workspace_root(root: &std::path::Path) -> Self {
        Self::from_config_or_stub(&root.join(Self::DEFAULT_REGISTRY_PATH))
    }

    /// Six placeholder agents for backward compatibility and test determinism.
    #[deprecated(note = "Use from_config() or from_config_or_stub() with a real agent registry")]
    pub fn legacy_stub() -> Self {
        Self {
            agents: (1..=6)
                .map(|i| AgentRegistryEntry {
                    id: format!("stub-agent-{i}"),
                    description:
                        "Phase 2 compatibility placeholder; replace with real registry rows."
                            .to_string(),
                    agent_type: None,
                    model: None,
                    tags: vec![],
                    safety_tier: None,
                })
                .collect(),
        }
    }
}

fn merge_breakdown(breakdown: ComplexityBreakdown, label: Option<&str>) -> ComplexityBlock {
    let mut block: ComplexityBlock = breakdown.into();
    block.mandatory_trigger = label.map(String::from);
    block
}

/// Band-specific team cardinality (Architecture § score bands + phased plan Phase 3).
fn band_team_bounds(band: ComplexityBand) -> (usize, usize) {
    match band {
        // Delegation with a "simple" score still uses a small team (treat like moderate).
        ComplexityBand::Simple => (1, 2),
        ComplexityBand::Moderate => (1, 2),
        ComplexityBand::Complex => (2, 3),
        ComplexityBand::HighlyComplex => (3, 5),
    }
}

fn desired_team_count(band: ComplexityBand) -> usize {
    match band {
        ComplexityBand::Simple | ComplexityBand::Moderate => 2,
        ComplexityBand::Complex => 3,
        ComplexityBand::HighlyComplex => 4,
    }
}

/// Returns chosen size and whether we are below the band minimum (partial registry).
fn pick_team_size(band: ComplexityBand, available: usize) -> (usize, bool) {
    let (lo, hi) = band_team_bounds(band);
    if available == 0 {
        return (0, false);
    }
    let want = desired_team_count(band).clamp(lo, hi);
    let capped = want.min(available);
    let degraded = capped < lo;
    (capped, degraded)
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty() && s.len() > 1)
        .map(std::string::ToString::to_string)
        .collect()
}

fn keyword_overlap_score(request_tokens: &BTreeSet<String>, entry: &AgentRegistryEntry) -> usize {
    let desc = entry.description.to_lowercase();
    let id = entry.id.to_lowercase();
    request_tokens
        .iter()
        .filter(|t| desc.contains(t.as_str()) || id.contains(t.as_str()))
        .count()
}

/// Deterministic selection: sort by (score desc, id asc), take first `n`. Phase 4 replaces with Haiku.
fn select_entries<'a>(
    snapshot: &'a AgentRegistrySnapshot,
    band: ComplexityBand,
    prompt: &str,
) -> (Vec<&'a AgentRegistryEntry>, Vec<String>) {
    let mut warnings = Vec::new();
    let available = snapshot.agents.len();
    let (n, degraded) = pick_team_size(band, available);
    if degraded && n > 0 {
        warnings.push(format!(
            "team_size_below_band_minimum: band={band:?} (partial catalog)"
        ));
    }
    if n == 0 {
        return (vec![], warnings);
    }

    let tokens: BTreeSet<String> = tokenize(prompt).into_iter().collect();
    let mut scored: Vec<(usize, &str, &AgentRegistryEntry)> = snapshot
        .agents
        .iter()
        .map(|e| {
            let s = keyword_overlap_score(&tokens, e);
            (s, e.id.as_str(), e)
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(b.1)));

    let picked: Vec<&AgentRegistryEntry> = scored.into_iter().take(n).map(|(_, _, e)| e).collect();
    (picked, warnings)
}

fn build_team_agents(entries: &[&AgentRegistryEntry]) -> Vec<TeamAgent> {
    const ROLES: [AgentRole; 4] = [
        AgentRole::Lead,
        AgentRole::Support,
        AgentRole::Reviewer,
        AgentRole::Support,
    ];
    const MODELS: [ModelTier; 4] = [
        ModelTier::Sonnet,
        ModelTier::Sonnet,
        ModelTier::Sonnet,
        ModelTier::Opus,
    ];

    fn truncate_for_justification(text: &str, max_bytes: usize) -> String {
        if text.len() <= max_bytes {
            return text.to_string();
        }
        let mut end = 0;
        for (idx, _) in text.char_indices() {
            if idx > max_bytes {
                break;
            }
            end = idx;
        }
        if end == 0 {
            // Defensive fallback: if a single codepoint exceeds max_bytes,
            // fall back to the original string rather than panicking.
            text.to_string()
        } else {
            format!("{}…", &text[..end])
        }
    }

    entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let desc = truncate_for_justification(&e.description, 120);
            TeamAgent {
                agent_id: e.id.clone(),
                role: ROLES[i % ROLES.len()],
                justification: format!("Registry selection (deterministic keyword match): {desc}"),
                model: MODELS[i % MODELS.len()],
            }
        })
        .collect()
}

fn build_workflow(team: &[TeamAgent], request: &str) -> WorkflowBlock {
    let ids: Vec<String> = team.iter().map(|a| a.agent_id.clone()).collect();
    let n = ids.len();
    let task_base = if request.len() > 120 {
        let mut end = 0;
        for (idx, _) in request.char_indices() {
            if idx > 120 {
                break;
            }
            end = idx;
        }
        if end == 0 {
            request.to_string()
        } else {
            format!("{}…", &request[..end])
        }
    } else {
        request.to_string()
    };

    if n == 0 {
        return WorkflowBlock { phases: vec![] };
    }
    if n == 1 {
        return WorkflowBlock {
            phases: vec![WorkflowPhase {
                id: "phase-1".to_string(),
                name: "Execution".to_string(),
                agents: ids.clone(),
                task: format!("Complete task: {task_base}"),
                depends_on: vec![],
                output: "deliverables".to_string(),
                success_gate: "Task complete".to_string(),
                model: ModelTier::Sonnet,
            }],
        };
    }

    let mut phases = vec![
        WorkflowPhase {
            id: "phase-1".to_string(),
            name: "Analysis".to_string(),
            agents: vec![ids[0].clone()],
            task: format!("Analyze requirements: {task_base}"),
            depends_on: vec![],
            output: "analysis-notes.md".to_string(),
            success_gate: "Scope and risks documented".to_string(),
            model: ModelTier::Sonnet,
        },
        WorkflowPhase {
            id: "phase-2".to_string(),
            name: "Implementation".to_string(),
            agents: ids.iter().take(2).cloned().collect(),
            task: "Implement per analysis".to_string(),
            depends_on: vec!["phase-1".to_string()],
            output: "implementation".to_string(),
            success_gate: "Build succeeds and tests pass".to_string(),
            model: ModelTier::Opus,
        },
    ];
    if n >= 3 {
        phases.push(WorkflowPhase {
            id: "phase-3".to_string(),
            name: "Verification".to_string(),
            agents: vec![ids[n - 1].clone()],
            task: "Review and verify".to_string(),
            depends_on: vec!["phase-2".to_string()],
            output: "review-report.md".to_string(),
            success_gate: "No critical findings".to_string(),
            model: ModelTier::Sonnet,
        });
    }
    WorkflowBlock { phases }
}

fn assemble_delegated_plan(
    snapshot: &AgentRegistrySnapshot,
    band: ComplexityBand,
    prompt: &str,
) -> (TeamBlock, WorkflowBlock, Vec<String>) {
    let (entries, warnings) = select_entries(snapshot, band, prompt);
    let agents = build_team_agents(&entries);
    let wf = build_workflow(&agents, prompt);
    (TeamBlock { agents }, wf, warnings)
}

fn fr010_plan(
    request_id: String,
    breakdown: ComplexityBreakdown,
    label: Option<&str>,
) -> ExecutionPlan {
    ExecutionPlan {
        request_id,
        mode: PlanMode::Direct,
        complexity: merge_breakdown(breakdown, label),
        team: None,
        workflow: None,
        warnings: Some(vec![FR010_WARNING.to_string()]),
    }
}

fn plan_inner<P: OrganizerPlanner>(
    prompt: &str,
    ctx: &PlanContext,
    snapshot: &AgentRegistrySnapshot,
    planner: &P,
) -> ExecutionPlan {
    let request_id = ctx
        .request_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let breakdown = score_complexity(prompt);
    let mandatory = evaluate_mandatory_triggers(prompt);

    match mandatory {
        MandatoryOutcome::Direct(label) => ExecutionPlan {
            request_id,
            mode: PlanMode::Direct,
            complexity: merge_breakdown(breakdown, Some(label)),
            team: None,
            workflow: None,
            warnings: None,
        },
        MandatoryOutcome::Delegated(label) => {
            if snapshot.agents.is_empty() {
                return fr010_plan(request_id, breakdown, Some(label));
            }
            let (team, workflow, w) = planner.plan_delegated(prompt, &breakdown, snapshot);
            ExecutionPlan {
                request_id,
                mode: PlanMode::Delegated,
                complexity: merge_breakdown(breakdown, Some(label)),
                team: Some(team),
                workflow: Some(workflow),
                warnings: if w.is_empty() { None } else { Some(w) },
            }
        }
        MandatoryOutcome::None => {
            if breakdown.score <= 25 {
                ExecutionPlan {
                    request_id,
                    mode: PlanMode::Direct,
                    complexity: merge_breakdown(breakdown, None),
                    team: None,
                    workflow: None,
                    warnings: None,
                }
            } else if snapshot.agents.is_empty() {
                fr010_plan(request_id, breakdown, None)
            } else {
                let (team, workflow, w) = planner.plan_delegated(prompt, &breakdown, snapshot);
                ExecutionPlan {
                    request_id,
                    mode: PlanMode::Delegated,
                    complexity: merge_breakdown(breakdown, None),
                    team: Some(team),
                    workflow: Some(workflow),
                    warnings: if w.is_empty() { None } else { Some(w) },
                }
            }
        }
    }
}

/// Full organizer plan: mandatory triggers, complexity, registry-backed team/workflow when delegated.
pub fn plan(prompt: &str, ctx: &PlanContext, snapshot: &AgentRegistrySnapshot) -> ExecutionPlan {
    let planner = DeterministicOrganizerPlanner;
    plan_inner(prompt, ctx, snapshot, &planner)
}

/// Planner-injection variant for Haiku-backed OrganizerPlanner implementations.
pub fn plan_with_planner<P: OrganizerPlanner>(
    prompt: &str,
    ctx: &PlanContext,
    snapshot: &AgentRegistrySnapshot,
    planner: &P,
) -> ExecutionPlan {
    plan_inner(prompt, ctx, snapshot, planner)
}

/// Backward-compatible entrypoint: uses a fixed stub catalog so existing callers keep stable agent ids.
#[allow(deprecated)]
pub fn build_execution_plan(prompt: &str, ctx: &PlanContext) -> ExecutionPlan {
    plan(prompt, ctx, &AgentRegistrySnapshot::legacy_stub())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::band_from_score;

    #[test]
    fn sc001_simple_typo_request_is_direct_low_score() {
        let p = "fix the typo in README.md";
        let plan = build_execution_plan(p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Direct);
        assert!(plan.complexity.score <= 25);
        assert!(plan.team.is_none());
    }

    #[test]
    fn sc002_complex_oauth_request_is_delegated_with_team_and_workflow() {
        let p = "implement user authentication with OAuth2 across the API and frontend, add tests, and update the docs";
        let plan = build_execution_plan(p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Delegated);
        let team = plan.team.as_ref().expect("team");
        assert!((2..=4).contains(&team.agents.len()));
        let wf = plan.workflow.as_ref().expect("workflow");
        assert!(!wf.phases.is_empty());
    }

    #[test]
    fn sc003_mandatory_delegate_short_prompt_still_delegated() {
        let p = "implement feature";
        let plan = build_execution_plan(p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Delegated);
        assert!(
            plan.complexity.score <= 25,
            "score should be low but mode still delegated"
        );
        assert_eq!(
            plan.complexity.mandatory_trigger.as_deref(),
            Some("diagram_implement_feature")
        );
    }

    #[test]
    fn sc004_mandatory_direct_overrides_high_score() {
        let p = format!("what is {}{}", "x".repeat(1900), " create ".repeat(16));
        let plan = build_execution_plan(&p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Direct);
        assert!(plan.complexity.score > 25, "expected inflated score");
        assert_eq!(
            plan.complexity.mandatory_trigger.as_deref(),
            Some("diagram_what_is")
        );
    }

    #[test]
    fn direct_wins_before_delegate_when_both_substrings_present() {
        let p = "what is implement feature";
        let plan = build_execution_plan(p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Direct);
    }

    #[test]
    fn build_project_is_direct_not_delegate_build() {
        let p = "please build project locally";
        let plan = build_execution_plan(p, &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Direct);
    }

    #[test]
    fn empty_string_is_score_only_direct() {
        let plan = build_execution_plan("", &PlanContext::default());
        assert_eq!(plan.mode, PlanMode::Direct);
        assert_eq!(plan.complexity.score, 0);
    }

    #[test]
    fn fr010_empty_registry_forces_direct_with_warning() {
        let empty = AgentRegistrySnapshot::default();
        let p = "implement user authentication with OAuth2 across the API and frontend, add tests, and update the docs";
        let plan = plan(p, &PlanContext::default(), &empty);
        assert_eq!(plan.mode, PlanMode::Direct);
        let w = plan.warnings.as_ref().expect("warnings");
        assert!(
            w.iter()
                .any(|x| x.contains("FR-010") || x.contains("per FR-010")),
            "{w:?}"
        );
        assert!(plan.team.is_none());
    }

    #[test]
    fn fr010_empty_registry_high_score_forces_direct() {
        let empty = AgentRegistrySnapshot::default();
        let p = "implement user authentication with OAuth2 across the API and frontend, add tests, and update the docs";
        let plan = plan(p, &PlanContext::default(), &empty);
        assert_eq!(plan.mode, PlanMode::Direct);
        assert!(plan.complexity.score > 25);
    }

    #[test]
    fn team_size_respects_band_when_catalog_sufficient() {
        let mut agents: Vec<AgentRegistryEntry> = (1..=10)
            .map(|i| AgentRegistryEntry {
                id: format!("agent-{i:02}"),
                description: format!("specialist {i} for api frontend testing"),
                agent_type: None,
                model: None,
                tags: vec![],
                safety_tier: None,
            })
            .collect();
        agents.sort_by(|a, b| a.id.cmp(&b.id));
        let snap = AgentRegistrySnapshot { agents };

        let p = "implement user authentication with OAuth2 across the API and frontend, add tests, and update the docs";
        let pl = plan(p, &PlanContext::default(), &snap);
        assert_eq!(pl.mode, PlanMode::Delegated);
        let team = pl.team.as_ref().unwrap();
        let n = team.agents.len();
        assert!((1..=5).contains(&n));
        assert!(
            (2..=3).contains(&n),
            "complex band expects 2–3 agents when available: {n}"
        );
    }

    #[test]
    fn multi_byte_descriptions_and_requests_do_not_panic_or_split_chars() {
        let agents = vec![AgentRegistryEntry {
            id: "agent-emoji".to_string(),
            description: "🚀 very capable agent with unicode description 🚀".repeat(10),
            agent_type: None,
            model: None,
            tags: vec![],
            safety_tier: None,
        }];
        let snap = AgentRegistrySnapshot { agents };
        let prompt = "Plan work on 🚀 unicode-heavy request 🚀".repeat(20);
        let breakdown = ComplexityBreakdown {
            score: 80,
            band: band_from_score(80),
            signals: Default::default(),
        };

        let (team, workflow, _warnings) = assemble_delegated_plan(&snap, breakdown.band, &prompt);

        assert!(!team.agents.is_empty());
        let justification = &team.agents[0].justification;
        assert!(
            justification.is_char_boundary(justification.len()),
            "justification must end on a char boundary"
        );

        let wf = workflow.phases.first().expect("at least one phase");
        assert!(
            wf.task.is_char_boundary(wf.task.len()),
            "task must end on a char boundary"
        );
    }
}
