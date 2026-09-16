// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 6 — deterministic baseline synthesiser. Consumes the outputs
// of stages 2 (fingerprint) and 3 (clusters) and emits one draft
// spec.md per cluster under s6-synthesis/specs/<slug>/spec.md.
//
// Every emitted spec satisfies:
//
//   - FR-005 (spec 147 kind grammar): declared `kind: capability`.
//   - FR-006 (spec 154 logical-unit grammar): each `establishes:`
//     entry carries `{ unit: { kind, path } }`.
//   - FR-004 (spec 161 emission contract): exactly one
//     `references:` entry with `role: decomposition-origin` and a
//     `provenance:` block bearing `kind: code-fingerprint`, the
//     stage-2 fingerprint hash as `source:`, and `derived_at:` set
//     to the stage's started_at.
//
// The LLM swap (follow-up F-001) replaces this module's `synthesise`
// function while keeping the on-disk shape identical.

use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, SecondsFormat, Utc};
use sha2::{Digest, Sha256};

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_file, hash_stage_dir};
use crate::stages::clustering;
use crate::types::{
    Cluster, DegradedReason, DraftSpecRef, PipelineConfig, StageId, StageRecord, StageStatus,
};

/// Evidence handed to a [`Synthesiser`] to produce one draft `spec.md`.
/// Borrowed from the run's stage outputs; a richer (LLM) synthesiser can
/// be given more fields here without changing the orchestrator.
pub struct SynthesisInput<'a> {
    /// The semantic cluster this draft spec is derived from (stage 3).
    pub cluster: &'a Cluster,
    /// Full SHA-256 of the stage-2 xray fingerprint artifact — the body of
    /// the `xray-fingerprint://<sha256>` provenance ref (spec 156).
    pub fingerprint_hash: &'a str,
    /// Synthesis-stage start time, stamped into the draft frontmatter.
    pub started_at: DateTime<Utc>,
}

/// Stage 6's pluggable backend (spec 165 §2.1 "LLM synthesis"). The
/// deterministic baseline and any LLM-backed impl both satisfy this trait;
/// the orchestrator never names a concrete backend. `identity` and
/// `prompt_template_hash` are bound into the governance certificate (§2.3)
/// so a promoted decomposition records *who* synthesised it and *under
/// which prompt*.
pub trait Synthesiser: Send + Sync {
    /// Produce the full `spec.md` text for one cluster's evidence.
    fn synthesise(&self, input: &SynthesisInput) -> Result<String, PipelineError>;

    /// Stable backend identity, e.g. `"deterministic-baseline"` or
    /// `"anthropic:claude-sonnet-4-20250514"`.
    fn identity(&self) -> String;

    /// SHA-256 hex of the prompt template / format this backend uses.
    fn prompt_template_hash(&self) -> String;
}

/// Identifier hashed to produce the deterministic synthesiser's
/// `prompt_template_hash`. Bump the suffix when `render_spec`'s shape
/// changes so the certificate reflects a different template.
const DETERMINISTIC_TEMPLATE_ID: &str = "opc-decomposition-deterministic-template-v1";

/// The default, CI-safe stage-6 backend: the templated baseline that turns
/// a cluster + fingerprint into a spec.md satisfying the emission contract.
/// No network, fully deterministic.
#[derive(Debug, Default, Clone, Copy)]
pub struct DeterministicSynthesiser;

impl Synthesiser for DeterministicSynthesiser {
    fn synthesise(&self, input: &SynthesisInput) -> Result<String, PipelineError> {
        Ok(render_spec(input.cluster, input.fingerprint_hash, input.started_at))
    }

    fn identity(&self) -> String {
        "deterministic-baseline".to_string()
    }

    fn prompt_template_hash(&self) -> String {
        hex::encode(Sha256::digest(DETERMINISTIC_TEMPLATE_ID.as_bytes()))
    }
}

/// System prompt for the LLM-backed synthesiser. Hashed to produce
/// `ProviderSynthesiser::prompt_template_hash`; bump it when the prompt
/// shape changes so the certificate reflects a different template.
#[cfg(feature = "llm-synthesis")]
const PROVIDER_SYSTEM_TEMPLATE: &str = "\
You are a spec-spine decomposition synthesiser. Given a cluster of related \
source files from a project, emit a single Markdown spec document. It MUST \
begin with YAML frontmatter containing: status: draft; origin with \
retroactive: true; a declared kind: from the spec-kind grammar; an \
establishes: list declaring each source path as a logical unit \
{ kind: file, path: ... }; and a references: entry with \
role: decomposition-origin and a provenance: block (kind: code-fingerprint, \
the supplied fingerprint hash as source). Write an intent-first summary of \
what the cluster does. Output only the spec.md content, no commentary.";

/// LLM-backed stage-6 synthesiser (spec 165 §2.1). Provider-agnostic: it
/// holds an injected [`provider_registry::ProviderAdapter`], so tests use a
/// mock and the OPC layer supplies the concrete (e.g. Anthropic) adapter.
/// Falls back to the deterministic baseline if the model output misses the
/// emission-contract markers, so FR-004/FR-005 hold regardless of the model.
#[cfg(feature = "llm-synthesis")]
pub struct ProviderSynthesiser {
    adapter: std::sync::Arc<dyn provider_registry::ProviderAdapter>,
    model: String,
    max_tokens: u32,
}

#[cfg(feature = "llm-synthesis")]
impl ProviderSynthesiser {
    pub fn new(
        adapter: std::sync::Arc<dyn provider_registry::ProviderAdapter>,
        model: impl Into<String>,
        max_tokens: u32,
    ) -> Self {
        Self {
            adapter,
            model: model.into(),
            max_tokens,
        }
    }
}

/// Build the per-cluster user prompt from stage-3 evidence. Pure.
#[cfg(feature = "llm-synthesis")]
fn build_user_prompt(cluster: &Cluster, fingerprint_hash: &str) -> String {
    let files = cluster.paths.join("\n");
    format!(
        "Cluster id: {id}\nRoot directory: {root}\nStage-3 summary: {summary}\n\
         xray fingerprint hash (use as provenance source): {fp}\n\
         Files in this cluster:\n{files}\n",
        id = cluster.id,
        root = cluster.root_dir,
        summary = cluster.summary,
        fp = fingerprint_hash,
        files = files,
    )
}

/// Concatenate the `TextComplete` payloads from a provider's events. Pure.
#[cfg(feature = "llm-synthesis")]
fn extract_text(events: Vec<provider_registry::AgentEvent>) -> String {
    events
        .into_iter()
        .filter_map(|e| match e {
            provider_registry::AgentEvent::TextComplete { text } => Some(text),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Does the model output carry the minimum emission-contract markers
/// (FR-004 provenance role + FR-005 kind)? If not, the caller falls back
/// to the deterministic baseline. Pure.
#[cfg(feature = "llm-synthesis")]
fn passes_emission_guard(text: &str) -> bool {
    text.contains("role: decomposition-origin") && text.contains("kind:")
}

/// Drive an async future to completion from a synchronous context. The
/// pipeline always runs on a blocking thread (the Tauri commands wrap it
/// in `spawn_blocking`), so a fresh current-thread runtime is safe; do not
/// call this from within an async runtime worker.
#[cfg(feature = "llm-synthesis")]
fn run_blocking<F: std::future::Future>(fut: F) -> Result<F::Output, PipelineError> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| PipelineError::Synthesis(format!("tokio runtime: {e}")))?;
    Ok(rt.block_on(fut))
}

#[cfg(feature = "llm-synthesis")]
impl Synthesiser for ProviderSynthesiser {
    fn synthesise(&self, input: &SynthesisInput) -> Result<String, PipelineError> {
        use provider_registry::{Message, MessageContent, QueryParams, Role};

        let params = QueryParams {
            model: Some(self.model.clone()),
            messages: vec![Message {
                role: Role::User,
                content: MessageContent::Text(build_user_prompt(
                    input.cluster,
                    input.fingerprint_hash,
                )),
            }],
            system_prompt: Some(PROVIDER_SYSTEM_TEMPLATE.to_string()),
            tools: Vec::new(),
            max_tokens: Some(self.max_tokens),
            temperature: Some(0.2),
        };

        let adapter = self.adapter.clone();
        let events = run_blocking(async move {
            let session = adapter
                .spawn(None)
                .await
                .map_err(|e| PipelineError::Synthesis(format!("spawn: {e}")))?;
            adapter
                .query(&session, params)
                .await
                .map_err(|e| PipelineError::Synthesis(format!("query: {e}")))
        })??;

        let text = extract_text(events);
        if passes_emission_guard(&text) {
            Ok(text)
        } else {
            // Model output is not contract-compliant; guarantee FR-004/005
            // by falling back to the deterministic baseline for this cluster.
            DeterministicSynthesiser.synthesise(input)
        }
    }

    fn identity(&self) -> String {
        format!("provider:{}", self.model)
    }

    fn prompt_template_hash(&self) -> String {
        hex::encode(Sha256::digest(PROVIDER_SYSTEM_TEMPLATE.as_bytes()))
    }
}

pub struct SynthesisOutput {
    pub record: StageRecord,
    pub emitted: Vec<DraftSpecRef>,
    /// Backend identity + prompt-template hash, lifted into the run
    /// manifest and the governance certificate (spec 165 §2.3).
    pub synthesiser_identity: String,
    pub prompt_template_hash: String,
}

pub fn run(
    _config: &PipelineConfig,
    run_dir: &RunDirectory,
    synthesiser: &dyn Synthesiser,
) -> Result<SynthesisOutput, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::Synthesis);
    let specs_dir = run_dir.synthesis_specs_dir();
    fs::create_dir_all(&specs_dir).map_err(|e| PipelineError::io(&specs_dir, e))?;

    // Full SHA-256 of the stage-2 fingerprint artifact — the provenance
    // ref anchor. xray's `Fingerprint.hash` is an 8-char short hash, which
    // is NOT a valid `xray-fingerprint://<sha256>` body (spec 156 V-028);
    // the artifact's full content hash is.
    let fp_digest =
        hash_file(&run_dir.stage_dir(StageId::Fingerprint).join("fingerprint.json"))?;
    let clusters = clustering::load_clusters(run_dir)?;

    let mut emitted: Vec<DraftSpecRef> = Vec::new();
    let mut degraded: Option<DegradedReason> = None;
    if clusters.clusters.is_empty() {
        degraded = Some(DegradedReason::EmptyProjectTree);
    }

    for cluster in &clusters.clusters {
        if cluster.paths.is_empty() {
            continue;
        }
        let slug = slug_for(cluster);
        let dir = specs_dir.join(&slug);
        fs::create_dir_all(&dir).map_err(|e| PipelineError::io(&dir, e))?;
        let spec_path = dir.join("spec.md");
        let input = SynthesisInput {
            cluster,
            fingerprint_hash: &fp_digest,
            started_at,
        };
        let body = synthesiser.synthesise(&input)?;
        fs::write(&spec_path, &body).map_err(|e| PipelineError::io(&spec_path, e))?;

        let content_hash = hash_file(&spec_path)?;
        let relpath = make_relpath(&specs_dir, &spec_path, &stage_dir);
        emitted.push(DraftSpecRef {
            slug,
            relpath,
            content_hash,
        });
    }

    // Record the synthesiser identity + prompt-template hash as a stage
    // artifact so the governance certificate (spec 165 §2.3) binds them via
    // per-file hashing and an auditor can read them back verbatim.
    let meta_path = stage_dir.join("synthesiser.json");
    let synth_meta = serde_json::json!({
        "identity": synthesiser.identity(),
        "promptTemplateHash": synthesiser.prompt_template_hash(),
    });
    fs::write(&meta_path, serde_json::to_vec_pretty(&synth_meta)?)
        .map_err(|e| PipelineError::io(&meta_path, e))?;

    let content_hash = hash_stage_dir(&stage_dir)?;
    let status = if emitted.is_empty() || degraded.is_some() {
        StageStatus::Degraded
    } else {
        StageStatus::Complete
    };
    let record = StageRecord {
        id: StageId::Synthesis,
        status,
        content_hash,
        output_relpath: StageId::Synthesis.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    };
    Ok(SynthesisOutput {
        record,
        emitted,
        synthesiser_identity: synthesiser.identity(),
        prompt_template_hash: synthesiser.prompt_template_hash(),
    })
}

fn make_relpath(_specs_dir: &std::path::Path, spec_path: &std::path::Path, stage_dir: &std::path::Path) -> String {
    spec_path
        .strip_prefix(stage_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| spec_path.to_string_lossy().into_owned())
}

fn slug_for(cluster: &Cluster) -> String {
    // Use a 999- prefix to flag "needs renumbering at promotion". Slug
    // body kebab-cases the cluster root so a human glancing at staging
    // can match emitted specs back to clusters without opening files.
    let sanitised = sanitise(&cluster.root_dir);
    format!("999-decomposed-{}-{}", sanitised, cluster.id)
}

fn sanitise(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = false;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("root");
    }
    out
}

fn render_spec(cluster: &Cluster, fingerprint_hash: &str, started_at: DateTime<Utc>) -> String {
    let slug = slug_for(cluster);
    let id = slug.clone();
    // spec 161 FR-007 (spec-lint W-161) requires an ISO-8601 timestamp on
    // every `role: decomposition-origin` provenance entry.
    let derived_at = started_at.to_rfc3339_opts(SecondsFormat::Secs, true);
    let created = started_at.format("%Y-%m-%d").to_string();

    let mut establishes = String::new();
    for path in &cluster.paths {
        establishes.push_str("  - unit: { kind: file, path: ");
        establishes.push_str(&yaml_path(path));
        establishes.push_str(" }\n");
    }

    let mut sources_md = String::new();
    for path in &cluster.paths {
        sources_md.push_str("- `");
        sources_md.push_str(path);
        sources_md.push_str("`\n");
    }

    // Single-line, double-quoted scalar. A YAML block scalar (`summary: >`)
    // is brittle to emit from a Rust format string — line-continuations
    // strip the required continuation indentation and the spec-compiler's
    // serde_yaml parser then rejects it. One quoted line round-trips through
    // both spec-lint and the spec-compiler.
    let summary_line = format!(
        "Draft spec emitted by the OPC decomposition pipeline (spec 165) from \
cluster {cluster_id} rooted at {root}, synthesised from {n_files} file(s) by \
the deterministic baseline synthesiser. Review, rename, and renumber before \
promotion.",
        cluster_id = cluster.id,
        root = cluster.root_dir,
        n_files = cluster.paths.len(),
    );

    format!(
        "---\n\
id: \"{id}\"\n\
slug: {slug}\n\
title: \"Decomposed unit from cluster {cluster_id} rooted at {root}\"\n\
status: draft\n\
implementation: pending\n\
owner: opc-decomposition-pipeline\n\
created: \"{created}\"\n\
kind: capability\n\
risk: medium\n\
origin:\n  retroactive: true\n\
summary: \"{summary_line}\"\n\
establishes:\n{establishes}\
references:\n  - role: decomposition-origin\n    provenance:\n      kind: code-fingerprint\n      ref: \"xray-fingerprint://{fingerprint_hash}\"\n      derived_at: \"{derived_at}\"\n\
---\n\n\
# {id} — Decomposed unit from cluster {cluster_id}\n\n\
This draft spec was synthesised by the OPC decomposition pipeline\n\
(spec 165) from the following project artifacts. The deterministic\n\
baseline synthesiser produces this scaffold so a developer can\n\
review, refine, and promote it into the project's spec spine.\n\n\
## Cluster\n\n\
- **ID:** {cluster_id}\n\
- **Root:** `{root}`\n\
- **Summary (from stage 3):** {cluster_summary}\n\
- **Files:** {n_files}\n\n\
## Source files (logical units)\n\n\
{sources_md}\n\
## Provenance\n\n\
The `references:` edge above carries `role: decomposition-origin`\n\
with `provenance.kind: code-fingerprint` per spec 161 §2.1. The\n\
`ref:` is `xray-fingerprint://<sha256>` of the project's stage-2\n\
xray structural fingerprint at synthesis time; see\n\
`crates/xray::fingerprint`.\n\n\
## Next steps\n\n\
1. Rename the spec to a meaningful slug.\n\
2. Renumber to fit the project's spec sequence.\n\
3. Replace the auto-generated summary with intent-first prose.\n\
4. Confirm or narrow the `establishes:` paths.\n\
5. Add `kind: capability` refinements (`shape:`, `category:`) per\n\
   spec 147 if the project's grammar uses them.\n",
        id = id,
        slug = slug,
        cluster_id = cluster.id,
        root = cluster.root_dir,
        n_files = cluster.paths.len(),
        cluster_summary = cluster.summary,
        fingerprint_hash = fingerprint_hash,
        derived_at = derived_at,
        created = created,
        establishes = establishes,
        sources_md = sources_md,
        summary_line = summary_line,
    )
}

/// Wrap a path in double quotes if it contains characters that would
/// confuse the YAML flow scalar `unit: { kind: file, path: <here> }`.
fn yaml_path(p: &str) -> String {
    let needs_quotes = p.chars().any(|c| matches!(c, ',' | '{' | '}' | '[' | ']' | ':' | '#' | '"'));
    if needs_quotes {
        format!("\"{}\"", p.replace('"', "\\\""))
    } else {
        p.to_string()
    }
}

#[allow(dead_code)] // used for testing in integration tests
pub fn list_emitted_specs(run_dir: &RunDirectory) -> Result<Vec<PathBuf>, PipelineError> {
    let specs_dir = run_dir.synthesis_specs_dir();
    let mut out = Vec::new();
    if !specs_dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(&specs_dir).map_err(|e| PipelineError::io(&specs_dir, e))? {
        let entry = entry.map_err(|e| PipelineError::io(&specs_dir, e))?;
        let spec_md = entry.path().join("spec.md");
        if spec_md.is_file() {
            out.push(spec_md);
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::stages::{clustering, fingerprint};
    use crate::types::{PipelineConfig, RunId};

    fn fresh_run_dir(out: &std::path::Path) -> RunDirectory {
        let rid = RunId(String::from("test-synth"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    fn prep(project: &std::path::Path, out: &std::path::Path) -> (PipelineConfig, RunDirectory) {
        let crates_a = project.join("crates").join("a");
        let tools = project.join("tools");
        fs::create_dir_all(&crates_a).unwrap();
        fs::create_dir_all(&tools).unwrap();
        fs::write(crates_a.join("lib.rs"), "fn a(){}\n").unwrap();
        fs::write(tools.join("main.rs"), "fn main(){}\n").unwrap();

        let cfg = PipelineConfig::new(project);
        let rd = fresh_run_dir(out);
        fingerprint::run(&cfg, &rd).unwrap();
        clustering::run(&cfg, &rd).unwrap();
        (cfg, rd)
    }

    /// A test double proving the orchestrator routes through the trait and
    /// never hard-codes the deterministic backend — the same seam the
    /// feature-gated provider synthesiser plugs into.
    struct MockSynthesiser;
    impl Synthesiser for MockSynthesiser {
        fn synthesise(&self, input: &SynthesisInput) -> Result<String, PipelineError> {
            Ok(format!(
                "MOCK SPEC for cluster {} ({} files)\n",
                input.cluster.id,
                input.cluster.paths.len()
            ))
        }
        fn identity(&self) -> String {
            "mock-synthesiser".to_string()
        }
        fn prompt_template_hash(&self) -> String {
            "deadbeef".to_string()
        }
    }

    #[test]
    fn routes_through_the_synthesiser_trait() {
        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let (cfg, rd) = prep(project.path(), out.path());
        let synth = run(&cfg, &rd, &MockSynthesiser).unwrap();
        assert!(!synth.emitted.is_empty());
        assert_eq!(synth.synthesiser_identity, "mock-synthesiser");
        assert_eq!(synth.prompt_template_hash, "deadbeef");
        let files = list_emitted_specs(&rd).unwrap();
        let body = fs::read_to_string(&files[0]).unwrap();
        assert!(body.starts_with("MOCK SPEC for cluster"), "mock body not used: {body}");
    }

    #[test]
    fn synthesises_one_spec_per_cluster() {
        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let (cfg, rd) = prep(project.path(), out.path());
        let synth = run(&cfg, &rd, &DeterministicSynthesiser).unwrap();
        assert!(!synth.emitted.is_empty());
        assert_eq!(synth.synthesiser_identity, "deterministic-baseline");
        for r in &synth.emitted {
            assert!(r.slug.starts_with("999-decomposed-"));
        }
        let files = list_emitted_specs(&rd).unwrap();
        assert!(!files.is_empty());
        let body = fs::read_to_string(&files[0]).unwrap();
        assert!(body.contains("role: decomposition-origin"));
        assert!(body.contains("kind: code-fingerprint"));
        assert!(body.contains("kind: capability"));
        assert!(body.contains("retroactive: true"));
        assert!(body.contains("establishes:"));
        assert!(body.contains("- unit: { kind: file, path:"));
    }

    #[test]
    fn handles_empty_project_tree() {
        let project = tempdir().unwrap();
        // Project has nothing — fingerprint will report file_count=0,
        // clustering will produce no clusters, synthesis will produce no specs.
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());
        fingerprint::run(&cfg, &rd).unwrap();
        clustering::run(&cfg, &rd).unwrap();

        let synth = run(&cfg, &rd, &DeterministicSynthesiser).unwrap();
        assert!(synth.emitted.is_empty());
        assert_eq!(synth.record.status, StageStatus::Degraded);
    }
}

#[cfg(all(test, feature = "llm-synthesis"))]
mod llm_tests {
    use super::*;
    use chrono::Utc;
    use provider_registry::{
        AgentEvent, AgentSession, ProviderAdapter, ProviderCapabilities, ProviderConfig,
        ProviderError, QueryParams,
    };
    use std::pin::Pin;
    use std::sync::Arc;

    /// Hand-rolled `ProviderAdapter` double: returns a fixed body from
    /// `query`, no network. Proves the async drive + event extraction +
    /// emission-guard fallback without a live model.
    struct StubAdapter {
        caps: ProviderCapabilities,
        body: String,
    }

    #[async_trait::async_trait]
    impl ProviderAdapter for StubAdapter {
        fn id(&self) -> &str {
            "stub"
        }
        fn capabilities(&self) -> &ProviderCapabilities {
            &self.caps
        }
        async fn spawn(
            &self,
            _config: Option<&ProviderConfig>,
        ) -> Result<AgentSession, ProviderError> {
            Ok(AgentSession {
                session_id: "s".into(),
                provider_id: "stub".into(),
                model: "stub-model".into(),
                created_at: 0,
            })
        }
        async fn query(
            &self,
            _session: &AgentSession,
            _params: QueryParams,
        ) -> Result<Vec<AgentEvent>, ProviderError> {
            Ok(vec![AgentEvent::TextComplete {
                text: self.body.clone(),
            }])
        }
        fn stream(
            &self,
            _session: AgentSession,
            _params: QueryParams,
        ) -> Pin<
            Box<dyn futures_core::Stream<Item = Result<AgentEvent, ProviderError>> + Send + 'static>,
        > {
            Box::pin(futures_util::stream::empty())
        }
        async fn abort(&self, _session: &AgentSession) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    fn caps() -> ProviderCapabilities {
        ProviderCapabilities {
            streaming: false,
            tool_use: false,
            vision: false,
            extended_thinking: false,
            max_context_tokens: 1000,
        }
    }

    fn cluster() -> Cluster {
        Cluster {
            id: "c001".into(),
            paths: vec!["crates/a/lib.rs".into()],
            root_dir: "crates".into(),
            summary: "x".into(),
        }
    }

    #[test]
    fn returns_compliant_model_output_verbatim() {
        let body = "---\nstatus: draft\nkind: capability\nreferences:\n  - role: decomposition-origin\n---\n# Spec\n".to_string();
        let synth = ProviderSynthesiser::new(Arc::new(StubAdapter { caps: caps(), body }), "stub-model", 1024);
        let c = cluster();
        let input = SynthesisInput { cluster: &c, fingerprint_hash: "abc123", started_at: Utc::now() };
        let out = synth.synthesise(&input).unwrap();
        assert!(out.contains("role: decomposition-origin"));
        assert!(out.starts_with("---"), "model body should be returned verbatim when compliant");
        assert_eq!(synth.identity(), "provider:stub-model");
        assert_eq!(synth.prompt_template_hash().len(), 64);
    }

    #[test]
    fn falls_back_to_deterministic_when_output_non_compliant() {
        let synth = ProviderSynthesiser::new(
            Arc::new(StubAdapter { caps: caps(), body: "just prose, no frontmatter".into() }),
            "stub-model",
            256,
        );
        let c = cluster();
        let input = SynthesisInput { cluster: &c, fingerprint_hash: "def456", started_at: Utc::now() };
        let out = synth.synthesise(&input).unwrap();
        // Guard tripped → deterministic baseline guarantees the contract.
        assert!(out.contains("role: decomposition-origin"));
        assert!(out.contains("kind: capability"));
        assert!(out.contains("establishes:"));
    }

    #[test]
    fn pure_helpers_behave() {
        assert!(passes_emission_guard("kind: x\nrole: decomposition-origin"));
        assert!(!passes_emission_guard("nothing useful"));
        let prompt = build_user_prompt(&cluster(), "fp123");
        assert!(prompt.contains("crates/a/lib.rs"));
        assert!(prompt.contains("fp123"));
        let text = extract_text(vec![
            AgentEvent::TextDelta { delta: "ignored".into() },
            AgentEvent::TextComplete { text: "kept".into() },
        ]);
        assert_eq!(text, "kept");
    }
}
