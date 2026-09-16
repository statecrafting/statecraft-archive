// Spec 198 FR-005/FR-014 — run-side governance for factory pipelines.
//
// The desktop is the keyless executor (ASI10 m6): before any stage runs it
// must (1) verify the platform's admission seal over the factory content it
// is about to trust (ASI04 m1), (2) file the run's intent capsule and obtain
// a signed run-grant, and (3) renew that grant at every stage boundary —
// a refused renewal fails the step fail-closed (goal-shift / revocation
// propagation, ASI01 m4/m7). At emission the certificate binds the admitted
// envelope + capsule, and the platform countersign is patched in when the
// completion round-trip succeeds.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use factory_engine::governance_certificate::{CapsuleBinding, ConsumedOverride};
use factory_engine::intent_capsule::IntentCapsule;
use factory_engine::platform_jws::{PlatformJwks, TYP_ADMISSION_SEAL, verify_compact_jws};
use orchestrator::PreStepGate;

use super::factory_platform::{GrantOutcome, GrantRenewArgs, GrantRequestArgs, RunEmitter};
use super::statecraft_client::StatecraftClient;
use super::sync_client::FactoryAgentRef;

/// Everything a governed run carries from admission verification to
/// certificate sealing. Constructed once per run by [`establish`].
pub struct RunGovernance {
    pub capsule: IntentCapsule,
    pub envelope_hash: String,
    pub jwks: PlatformJwks,
    /// Spec 198 FR-013(c) — overrides of admitted factory content this run
    /// consumes, from the bundle's admission block (platform
    /// predicate-checked); bound into the certificate at emission.
    pub consumed_overrides: Vec<ConsumedOverride>,
    /// Sequence of the most recent grant the platform issued. The next
    /// renewal presents `last_seq + 1`; the reply's seq is stored back
    /// (issuance after an engine restart may resume above 0).
    pub last_seq: AtomicI64,
    emitter: RunEmitter,
}

impl RunGovernance {
    pub fn capsule_binding(&self) -> CapsuleBinding {
        CapsuleBinding {
            admitted_envelope_hash: self.envelope_hash.clone(),
            goal_id: self.capsule.goal_id.clone(),
            intent_capsule_hash: self.capsule.capsule_hash(),
            consumed_overrides: self.consumed_overrides.clone(),
        }
    }
}

/// Verify the bundle's admission seal, file the intent capsule, and obtain
/// the issuance grant. Every failure is fail-closed: the caller MUST NOT
/// dispatch any stage on `Err` (spec 198 FR-001/FR-005/FR-014).
pub async fn establish(
    sc: &StatecraftClient,
    emitter: RunEmitter,
    statecraft_project_id: &str,
    platform_run_id: &str,
    goal: &str,
    run_dir: &Path,
) -> Result<Arc<RunGovernance>, String> {
    // Phase logging (spec 198 governance): establish() previously ran
    // silently to completion, so a stall in any await (bundle fetch, JWKS
    // fetch, or the grant round-trip) left the run wedged at "Waiting for
    // agent output" with nothing in the OPC log to say which phase blocked.
    // These INFO lines bound the diagnosis to a phase without changing any
    // control flow.
    log::info!(
        "run governance: establish start (project={statecraft_project_id}, run={platform_run_id})"
    );

    // 1. The standing admission, with the platform seal (ASI04 m1).
    log::info!("run governance: fetching project bundle for admission check");
    let bundle = sc
        .get_project_opc_bundle(statecraft_project_id)
        .await
        .map_err(|e| format!("cannot fetch project bundle for admission check: {e}"))?;
    let admission = bundle.admission.ok_or_else(|| {
        "factory is not admitted for this org — a run cannot start ungoverned; \
         re-sync the factory and resolve the admission refusal (spec 198 FR-001)"
            .to_string()
    })?;
    let seal = admission.seal_jws.ok_or_else(|| {
        "factory admission is UNSEALED (no platform signature) — refuse fail-closed; \
         re-sync after the platform signing authority is configured (spec 198 FR-014)"
            .to_string()
    })?;

    log::info!("run governance: fetching platform JWKS for seal verification");
    let jwks = sc
        .fetch_factory_jwks()
        .await
        .map_err(|e| format!("cannot fetch platform JWKS for seal verification: {e}"))?;
    let verified = verify_compact_jws(&seal, &jwks, TYP_ADMISSION_SEAL)
        .map_err(|e| format!("admission seal rejected: {e} (spec 198 FR-014)"))?;
    let sealed_origin = verified.payload["origin"].as_str().unwrap_or("");
    if sealed_origin != admission.origin {
        return Err(format!(
            "admission seal binds origin '{sealed_origin}' but the bundle claims '{}'",
            admission.origin
        ));
    }
    let envelope_hash = verified.payload["envelope_hash"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if envelope_hash.is_empty()
        || admission.envelope_hash.as_deref() != Some(envelope_hash.as_str())
    {
        return Err(
            "admission seal envelope hash does not match the bundle's admission block".into(),
        );
    }

    // Spec 198 FR-013(c) — carry the consumed overrides into the run's
    // certificate binding. The platform already enforced the envelope's
    // `overrides.require_verified` predicate at bundle assembly; the
    // engine's job is traceability, not re-adjudication.
    let consumed_overrides: Vec<ConsumedOverride> = admission
        .consumed_overrides
        .iter()
        .map(|o| ConsumedOverride {
            artifact_id: o.artifact_id.clone(),
            path: o.path.clone(),
            content_hash: o.content_hash.clone(),
            author: o.author.clone(),
            modified_at: o.modified_at.clone(),
            verified: o.verified,
            verified_by: o.verified_by.clone(),
        })
        .collect();

    // 2. File the intent capsule (FR-005) — persisted next to the run's
    //    other governance artifacts for audit + certificate binding.
    let capsule = IntentCapsule::new(
        goal,
        Vec::new(),
        envelope_hash.clone(),
        statecraft_project_id,
        platform_run_id,
    );
    capsule
        .persist(run_dir)
        .map_err(|e| format!("cannot persist intent capsule: {e}"))?;

    // 3. Issuance grant. A refusal or an unreachable platform halts the
    //    run before s0; the executor never self-starts governed work.
    //    This is the duplex round-trip (30s timeout in send_and_await_reply);
    //    if the platform never sends a correlated `factory.run.grant` reply
    //    the request fails closed here rather than wedging the run.
    log::info!(
        "run governance: requesting run-grant from platform (goal_id={})",
        capsule.goal_id
    );
    let outcome = emitter
        .request_grant(GrantRequestArgs {
            goal_id: &capsule.goal_id,
            goal: &capsule.goal,
            capsule_hash: &capsule.capsule_hash(),
            envelope_hash: &envelope_hash,
            build_spec_hash: None,
            project_id: Some(statecraft_project_id),
            constraints: Some(capsule.constraints.clone()),
        })
        .await
        .map_err(|e| format!("run-grant request failed (fail closed): {e}"))?;
    let seq = match outcome {
        GrantOutcome::Granted { seq, .. } => seq,
        GrantOutcome::Refused { reason, detail } => {
            return Err(format!(
                "run-grant refused: {reason}{} (spec 198 FR-005)",
                detail.map(|d| format!(" — {d}")).unwrap_or_default()
            ));
        }
    };

    log::info!("run governance: run-grant obtained (seq={seq}); governance established");
    Ok(Arc::new(RunGovernance {
        capsule,
        envelope_hash,
        jwks,
        consumed_overrides,
        last_seq: AtomicI64::new(seq),
        emitter,
    }))
}

/// Stage-boundary grant renewal (spec 198 FR-005 — "signed per execution
/// cycle"). Wired into `DispatchOptions.pre_step`; an `Err` fails the step
/// and halts the run with the platform's attributable refusal.
pub struct GrantRenewalGate {
    gov: Arc<RunGovernance>,
    /// Reads the frozen Build-Spec hash from the run's live pipeline state;
    /// presented from the freeze boundary onward (the platform records it
    /// one-way on the grant chain).
    build_spec_hash: Box<dyn Fn() -> Option<String> + Send + Sync>,
    /// Spec 208 FR-001/AC-3: per-stage agent triple captured at reservation
    /// time (the same map `TauriStepEventHandler` uses to stamp
    /// `factory.run.stage_started`). `before_step` looks up the step's
    /// `org_agent_id` and presents it on renewal so an agent-profile-scoped
    /// org halt refuses the run before the stage executes.
    stage_agents: Arc<HashMap<String, FactoryAgentRef>>,
}

impl GrantRenewalGate {
    pub fn new(
        gov: Arc<RunGovernance>,
        build_spec_hash: Box<dyn Fn() -> Option<String> + Send + Sync>,
        stage_agents: Arc<HashMap<String, FactoryAgentRef>>,
    ) -> Self {
        Self {
            gov,
            build_spec_hash,
            stage_agents,
        }
    }
}

/// Spec 208 FR-001/AC-3: resolve the agent profile (org_agent_id) about to
/// execute `step_id` from the reservation-time stage-agent map. An absent
/// mapping or an empty org_agent_id yields `None` (attribution is absent, never
/// a spoofable empty scope key), so the renewal presents no `agentProfile` and
/// an agent-profile halt cannot match a blank key.
fn resolve_stage_profile(
    stage_agents: &HashMap<String, FactoryAgentRef>,
    step_id: &str,
) -> Option<String> {
    stage_agents
        .get(step_id)
        .map(|r| r.org_agent_id.clone())
        .filter(|s| !s.is_empty())
}

#[async_trait::async_trait]
impl PreStepGate for GrantRenewalGate {
    async fn before_step(&self, step_id: &str) -> Result<(), String> {
        let next = self.gov.last_seq.load(Ordering::Acquire) + 1;
        let build_spec = (self.build_spec_hash)();
        // Spec 208 FR-001/AC-3: resolve the agent profile about to execute this
        // stage from the reservation-time map (see resolve_stage_profile).
        let agent_profile = resolve_stage_profile(&self.stage_agents, step_id);
        let outcome = self
            .gov
            .emitter
            .renew_grant(GrantRenewArgs {
                goal_id: &self.gov.capsule.goal_id,
                capsule_hash: &self.gov.capsule.capsule_hash(),
                seq: next,
                stage_id: Some(step_id),
                agent_profile: agent_profile.as_deref(),
                build_spec_hash: build_spec.as_deref(),
            })
            .await
            .map_err(|e| {
                format!("run-grant renewal unavailable at {step_id}: {e} (fail closed)")
            })?;
        match outcome {
            GrantOutcome::Granted { seq, .. } => {
                self.gov.last_seq.store(seq, Ordering::Release);
                Ok(())
            }
            GrantOutcome::Refused { reason, detail } => Err(format!(
                "run-grant renewal refused at {step_id}: {reason}{} (spec 198 FR-005)",
                detail.map(|d| format!(" — {d}")).unwrap_or_default()
            )),
        }
    }
}

/// The per-run directory governance artifacts live in
/// (`<project>/.factory/runs/<run-id>/`).
pub fn run_dir_for(project_path: &Path, run_id: &str) -> PathBuf {
    project_path.join(".factory").join("runs").join(run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_ref(org_agent_id: &str) -> FactoryAgentRef {
        FactoryAgentRef {
            org_agent_id: org_agent_id.to_string(),
            version: 1,
            content_hash: "hash".to_string(),
        }
    }

    // Spec 208 FR-001/AC-3: the agent-profile seam resolves the profile about to
    // execute a stage from the reservation-time map. This is the load-bearing
    // new logic; an agent-profile halt is only as honest as this resolution.

    #[test]
    fn resolve_stage_profile_returns_the_mapped_org_agent_id() {
        let mut map = HashMap::new();
        map.insert("s1-scaffold".to_string(), agent_ref("api-scaffolder"));
        assert_eq!(
            resolve_stage_profile(&map, "s1-scaffold"),
            Some("api-scaffolder".to_string())
        );
    }

    #[test]
    fn resolve_stage_profile_is_none_for_an_unmapped_step() {
        let map: HashMap<String, FactoryAgentRef> = HashMap::new();
        // No mapping means no attribution, so no agentProfile is presented.
        assert_eq!(resolve_stage_profile(&map, "s0-preflight"), None);
    }

    #[test]
    fn resolve_stage_profile_treats_an_empty_org_agent_id_as_absent() {
        let mut map = HashMap::new();
        map.insert("s2".to_string(), agent_ref(""));
        // An empty org_agent_id must NOT become an empty-string scope key that an
        // agent-profile halt could match; it resolves to None.
        assert_eq!(resolve_stage_profile(&map, "s2"), None);
    }
}
